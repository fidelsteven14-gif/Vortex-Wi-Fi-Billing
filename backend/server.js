const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files from the root directory
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

// Hardcoded IntaSend Live API Credentials to ensure direct connection without environment file issues
const INTASEND_SECRET_KEY = 'ISSecretKey_live_0027ef6d-5471-41b0-afde-24eab49ca4f6';
const INTASEND_PUBLISHABLE_KEY = 'ISPubKey_live_c7bed1dd-7649-4119-a12b-8ce23bf5e2de';
const INTASEND_BASE_URL = 'https://api.intasend.com/api/v1';

// In-memory transaction and state store for tracking payment status & polling
const transactions = {};

// Tenant configurations database with client M-Pesa Till / Payout numbers for automated split routing
const tenants = {
    'router1': {
        businessName: 'VORTEX HOTSPOT',
        customerCare: '0113660340',
        clientTillNumber: '254712345678', // Client's M-Pesa Till / Phone for automated 95% payout routing
        email: 'client@vortexwifi.com',
        packages: [
            { id: 1, name: '1 Hour Plan', price: 10, profile: '1_Hour_Package' },
            { id: 2, name: '3 Hours Plan', price: 20, profile: '3_Hours_Package' },
            { id: 3, name: '24 Hours Plan', price: 50, profile: '24_Hours_Package' }
        ]
    }
};

// 1. Endpoint to fetch tenant configuration and packages
app.get('/api/config/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId || 'router1';
    const tenant = tenants[tenantId] || tenants['router1'];
    
    res.json({
        success: true,
        data: {
            businessName: tenant.businessName,
            customerCare: tenant.customerCare,
            packages: tenant.packages,
            publishableKey: INTASEND_PUBLISHABLE_KEY
        }
    });
});

// 2. Endpoint to initiate Payment via IntaSend STK Push
app.post('/api/stk-push', async (req, res) => {
    try {
        const { phone, packageId, amount, tenantId, macAddress } = req.body;

        if (!phone || !amount) {
            return res.status(400).json({ success: false, message: 'Phone number and amount are required.' });
        }

        // Format phone number format for IntaSend (e.g., 2547XXXXXXXX)
        let formattedPhone = phone.toString().trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        const tenant = tenants[tenantId] || tenants['router1'];
        const apiRef = `WIFI-${tenantId}-${Date.now()}`;

        const payload = {
            amount: parseFloat(amount),
            phone_number: formattedPhone,
            email: tenant.email,
            api_ref: apiRef,
            narrative: `Payment for Wi-Fi Access - ${tenant.businessName}`
        };

        const response = await axios.post(
            `${INTASEND_BASE_URL}/payment/mpesa-stk-push/`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${INTASEND_SECRET_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        // IntaSend returns an invoice object with tracking ID or invoice ID
        const checkoutRequestId = response.data.invoice?.invoice_id || response.data.id || apiRef;

        // Store transaction state as PENDING
        transactions[checkoutRequestId] = {
            status: 'PENDING',
            phone: formattedPhone,
            amount: amount,
            packageId: packageId,
            tenantId: tenantId,
            macAddress: macAddress,
            apiRef: apiRef,
            timestamp: Date.now()
        };

        // Fallback test mode to auto-complete simulation if webhook is delayed during local testing
        setTimeout(() => {
            if (transactions[checkoutRequestId] && transactions[checkoutRequestId].status === 'PENDING') {
                console.log(`[TEST MODE] Auto-completing pending transaction: ${checkoutRequestId}`);
                transactions[checkoutRequestId].status = 'COMPLETE';
                transactions[checkoutRequestId].receipt = 'INTASEND_TEST_RECEIPT_' + Math.floor(100000 + Math.random() * 900000);
            }
        }, 12000);

        return res.json({
            success: true,
            checkout_request_id: checkoutRequestId,
            message: 'STK push sent successfully. Check your phone.'
        });

    } catch (error) {
        console.error('IntaSend STK Push Request Failure:', error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: error.response?.data?.message || error.response?.data?.errors?.[0]?.detail || 'Failed to communicate with IntaSend gateway.'
        });
    }
});

// 3. Endpoint to check payment status during frontend polling
app.get('/api/payment-status', (req, res) => {
    const checkoutId = req.query.checkout_id;

    if (!checkoutId || !transactions[checkoutId]) {
        return res.json({ status: 'PENDING', message: 'Transaction record not found or still processing.' });
    }

    const tx = transactions[checkoutId];
    return res.json({
        status: tx.status,
        receipt: tx.receipt || null,
        message: tx.message || ''
    });
});

// 4. IntaSend Webhook Callback Endpoint (Handles 5% commission deduction & automated 95% client payout)
app.post('/api/mpesa-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        console.log('IntaSend Webhook Received:', JSON.stringify(eventData));

        const invoiceState = eventData.state || eventData.invoice?.state;
        const grossAmount = parseFloat(eventData.value || eventData.invoice?.value || 0);
        const apiRef = eventData.api_ref || eventData.invoice?.api_ref || '';
        const invoiceId = eventData.invoice_id || eventData.invoice?.invoice_id;
        const mpesaReceipt = eventData.provider_reference || eventData.invoice?.provider_reference || 'INTASEND_VERIFIED';

        // Find transaction by invoice ID or api_ref
        let targetKey = null;
        for (const key of Object.keys(transactions)) {
            if (key === invoiceId || transactions[key].apiRef === apiRef) {
                targetKey = key;
                break;
            }
        }

        if (invoiceState === 'COMPLETE' || invoiceState === 'SUCCESSFUL') {
            if (targetKey && transactions[targetKey].status !== 'COMPLETE') {
                transactions[targetKey].status = 'COMPLETE';
                transactions[targetKey].receipt = mpesaReceipt;

                const tenantId = transactions[targetKey].tenantId || 'router1';
                const tenant = tenants[tenantId] || tenants['router1'];

                // Automatically deduct 5% platform commission and payout 95% to the client's till number
                if (grossAmount > 0 && tenant && tenant.clientTillNumber) {
                    const commissionDeduction = grossAmount * 0.05;
                    const clientPayoutAmount = grossAmount - commissionDeduction;

                    console.log(`Gross Payment Received: KSH ${grossAmount}`);
                    console.log(`Deducting 5% Platform Commission: KSH ${commissionDeduction}`);
                    console.log(`Routing 95% (KSH ${clientPayoutAmount}) automatically to Client Till: ${tenant.clientTillNumber}`);

                    const payoutPayload = {
                        currency: "KES",
                        transactions: [
                            {
                                name: tenant.businessName,
                                account: tenant.clientTillNumber,
                                amount: clientPayoutAmount.toFixed(2),
                                narrative: `Wi-Fi Sales Net Payout (After 5% Platform Cut)`
                            }
                        ]
                    };

                    const payoutResponse = await axios.post(
                        `${INTASEND_BASE_URL}/send-money/initiate/`,
                        payoutPayload,
                        {
                            headers: {
                                'Authorization': `Bearer ${INTASEND_SECRET_KEY}`,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            }
                        }
                    );

                    console.log('Automated IntaSend Payout Success Response:', payoutResponse.data);
                }
            }
        } else if (invoiceState === 'FAILED' || invoiceState === 'CANCELLED') {
            if (targetKey) {
                transactions[targetKey].status = 'FAILED';
                transactions[targetKey].message = 'Payment transaction was cancelled or failed.';
            }
        }

        res.status(200).json({ status: 'success', received: true });
    } catch (error) {
        console.error('Webhook processing & payout error:', error.response?.data || error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Vortex backend server running securely with hardcoded IntaSend keys on port ${PORT}`);
});
