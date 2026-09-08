const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files from the root directory
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

// In-memory transaction and state store for testing
const transactions = {};

// Tenant configurations mock database
const tenants = {
    'router1': {
        businessName: 'VORTEX HOTSPOT',
        customerCare: '0113660340',
        tillNumber: process.env.MPESA_SHORTCODE || '174379',
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
        data: tenant
    });
});

// Helper function to generate Safaricom Daraja access token
async function getDarajaAccessToken() {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const env = process.env.MPESA_ENV || 'sandbox';
    const url = env === 'production' 
        ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
        : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Daraja Access Token Error:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with M-Pesa API');
    }
}

// 2. Endpoint to initiate M-Pesa STK Push
app.post('/api/stk-push', async (req, res) => {
    try {
        const { phone, packageId, amount, tenantId, macAddress } = req.body;

        if (!phone || !amount) {
            return res.status(400).json({ success: false, message: 'Phone number and amount are required.' });
        }

        // Format phone number to 2547XXXXXXXX
        let formattedPhone = phone.toString().trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        const accessToken = await getDarajaAccessToken();
        const shortCode = process.env.MPESA_SHORTCODE || '174379';
        const passKey = process.env.MPESA_PASSKEY;

        const date = new Date();
        const timestamp = date.getFullYear() +
            String(date.getMonth() + 1).padStart(2, '0') +
            String(date.getDate()).padStart(2, '0') +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        const password = Buffer.from(shortCode + passKey + timestamp).toString('base64');

        const env = process.env.MPESA_ENV || 'sandbox';
        const stkUrl = env === 'production'
            ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
            : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

        const serverBaseUrl = req.protocol + '://' + req.get('host');
        const callbackUrl = `${serverBaseUrl}/api/mpesa-webhook`;

        const stkPayload = {
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: shortCode,
            PhoneNumber: formattedPhone,
            CallBackURL: callbackUrl,
            AccountReference: 'Vortex Hotspot',
            TransactionDesc: 'Wi-Fi Hotspot Access Package'
        };

        const stkResponse = await axios.post(stkUrl, stkPayload, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const checkoutRequestId = stkResponse.data.CheckoutRequestID;

        // Store transaction state as PENDING
        transactions[checkoutRequestId] = {
            status: 'PENDING',
            phone: formattedPhone,
            amount: amount,
            packageId: packageId,
            macAddress: macAddress,
            timestamp: Date.now()
        };

        // For local testing without physical router, mock auto-completion after 10 seconds if sandbox doesn't callback
        setTimeout(() => {
            if (transactions[checkoutRequestId] && transactions[checkoutRequestId].status === 'PENDING') {
                console.log(`[TEST MODE] Auto-completing pending transaction: ${checkoutRequestId}`);
                transactions[checkoutRequestId].status = 'COMPLETE';
                transactions[checkoutRequestId].receipt = 'TEST_RECEIPT_' + Math.floor(100000 + Math.random() * 900000);
            }
        }, 12000);

        return res.json({
            success: true,
            checkout_request_id: checkoutRequestId,
            message: 'STK push sent successfully. Check your phone.'
        });

    } catch (error) {
        console.error('STK Push Request Failure:', error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || 'Failed to communicate with M-Pesa gateway.'
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

// 4. M-Pesa Webhook Callback Endpoint
app.post('/api/mpesa-webhook', (req, res) => {
    try {
        const body = req.body;
        console.log('M-Pesa Webhook Received:', JSON.stringify(body));

        const stkCallback = body.Body?.stkCallback;
        if (!stkCallback) {
            return res.status(400).json({ result: 'Invalid payload' });
        }

        const checkoutRequestId = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;

        if (transactions[checkoutRequestId]) {
            if (resultCode === 0) {
                // Payment successful
                const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
                let receiptNumber = '';
                for (const item of callbackMetadata) {
                    if (item.Name === 'MpesaReceiptNumber') {
                        receiptNumber = item.Value;
                    }
                }

                transactions[checkoutRequestId].status = 'COMPLETE';
                transactions[checkoutRequestId].receipt = receiptNumber;
                console.log(`Payment confirmed successful for Checkout ID: ${checkoutRequestId}, Receipt: ${receiptNumber}`);
            } else {
                // Payment failed or cancelled
                transactions[checkoutRequestId].status = 'FAILED';
                transactions[checkoutRequestId].message = stkCallback.ResultDesc || 'Payment was cancelled or failed.';
                console.log(`Payment failed for Checkout ID: ${checkoutRequestId}`);
            }
        }

        res.json({ ResultCode: 0, ResultDesc: 'Success' });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Vortex backend server running on port ${PORT}`);
});

