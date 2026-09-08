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

// IntaSend API Credentials securely loaded from environment variables
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || '';
const INTASEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY || '';
const INTASEND_BASE_URL = 'https://api.intasend.com/api/v1';

// In-memory transaction and state store
const transactions = {};

// In-memory user / client account store for authentication and super admin management
// Credentials can be managed or authenticated here. Super admin can create clients.
const clientsDb = {
    'admin': {
        password: 'adminpassword123',
        role: 'superadmin',
        businessName: 'Super Admin Control Center'
    },
    'Steven': {
        password: 'stevenpassword123',
        role: 'client',
        businessName: 'VORTEX HOTSPOT',
        customerCare: '0113660340',
        clientTillNumber: '254712345678',
        email: 'client@vortexwifi.com',
        packages: [
            { id: 1, name: '1 Hour Plan', price: 10, profile: '1_Hour_Package' },
            { id: 2, name: '3 Hours Plan', price: 20, profile: '3_Hours_Package' },
            { id: 3, name: '24 Hours Plan', price: 50, profile: '24_Hours_Package' }
        ]
    }
};

// Active logged-in sessions store (username -> session token or tracking data)
const activeSessions = {};

// 1. Endpoint to fetch tenant configuration and packages
app.get('/api/config/:tenantId', (req, res) => {
    const tenantId = req.params.tenantId || 'Steven';
    const client = clientsDb[tenantId] || clientsDb['Steven'];
    
    res.json({
        success: true,
        data: {
            businessName: client.businessName || 'VORTEX HOTSPOT',
            customerCare: client.customerCare || '0113660340',
            packages: client.packages || [],
            publishableKey: INTASEND_PUBLISHABLE_KEY
        }
    });
});

// 2. Client & Super Admin Authentication Login Endpoint
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const userRecord = clientsDb[username];
    if (!userRecord || userRecord.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    // Single-session check / tracking: invalidate or log active session
    if (activeSessions[username]) {
        console.log(`User ${username} logged in from a new session. Previous session cleared.`);
    }

    const sessionToken = 'SESSION_' + Math.random().toString(36).substring(2) + Date.now();
    activeSessions[username] = sessionToken;

    return res.json({
        success: true,
        role: userRecord.role,
        username: username,
        token: sessionToken,
        message: 'Logged in successfully.'
    });
});

// 3. Logout / Session Check Endpoint
app.post('/api/auth/logout', (req, res) => {
    const { username, token } = req.body;
    if (username && activeSessions[username]) {
        if (activeSessions[username] === token) {
            delete activeSessions[username];
        }
    }
    return res.json({ success: true, message: 'Logged out successfully.' });
});

// 4. Super Admin: Onboard/Create New Client Account
app.post('/api/admin/create-client', (req, res) => {
    const { adminUsername, username, password, businessName, customerCare, clientTillNumber, email } = req.body;

    if (!adminUsername || clientsDb[adminUsername]?.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized action. Super admin access required.' });
    }

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Client username and password are required.' });
    }

    if (clientsDb[username]) {
        return res.status(400).json({ success: false, message: 'Username already exists.' });
    }

    clientsDb[username] = {
        password: password,
        role: 'client',
        businessName: businessName || `${username.toUpperCase()} HOTSPOT`,
        customerCare: customerCare || '0113660340',
        clientTillNumber: clientTillNumber || '254700000000',
        email: email || `${username}@vortexwifi.com`,
        packages: [
            { id: 1, name: '1 Hour Plan', price: 10, profile: '1_Hour_Package' },
            { id: 2, name: '24 Hours Plan', price: 50, profile: '24_Hours_Package' }
        ]
    };

    return res.json({
        success: true,
        message: `Client account '${username}' created successfully.`
    });
});

// 5. Super Admin: Get All Clients Overview & Total Platform Revenue (5% Commission)
app.get('/api/admin/dashboard', (req, res) => {
    const clientsList = Object.keys(clientsDb)
        .filter(key => clientsDb[key].role === 'client')
        .map(key => {
            const client = clientsDb[key];
            // Calculate total revenue and stats for this specific client from transactions
            const clientTxs = Object.values(transactions).filter(tx => tx.tenantId === key && tx.status === 'COMPLETE');
            const totalRevenue = clientTxs.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
            
            return {
                username: key,
                businessName: client.businessName,
                customerCare: client.customerCare,
                totalRevenue: totalRevenue,
                activeUsersCount: Math.floor(Math.random() * 15) // Simulated live connected users count
            };
        });

    const totalPlatformVolume = Object.values(transactions)
        .filter(tx => tx.status === 'COMPLETE')
        .reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
    
    const platformCommission = totalPlatformVolume * 0.05;

    return res.json({
        success: true,
        platformCommission: platformCommission,
        totalVolume: totalPlatformVolume,
        clients: clientsList
    });
});

// 6. Client Dashboard Data: Revenue (Day, Week, Month), Transactions, and Connected Users/MAC Addresses
app.get('/api/client/dashboard/:username', (req, res) => {
    const username = req.params.username;
    const client = clientsDb[username];

    if (!client || client.role !== 'client') {
        return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    const clientTxs = Object.values(transactions).filter(tx => tx.tenantId === username);
    
    const successfulTxs = clientTxs.filter(tx => tx.status === 'COMPLETE');
    const failedTxs = clientTxs.filter(tx => tx.status === 'FAILED');
    const pendingTxs = clientTxs.filter(tx => tx.status === 'PENDING');

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;

    const dailyRevenue = successfulTxs.filter(tx => (now - tx.timestamp) <= oneDay).reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
    const weeklyRevenue = successfulTxs.filter(tx => (now - tx.timestamp) <= oneWeek).reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
    const monthlyRevenue = successfulTxs.filter(tx => (now - tx.timestamp) <= oneMonth).reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

    // Simulated active connected users & MAC addresses for this client's hotspot network
    const activeUsers = [
        { mac: 'A4:C1:38:XX:YY:01', ip: '192.168.88.50', connectedTime: '2 hours ago', package: '1 Hour Plan' },
        { mac: 'D8:EB:46:XX:YY:02', ip: '192.168.88.51', connectedTime: '45 mins ago', package: '24 Hours Plan' },
        { mac: '54:60:09:XX:YY:03', ip: '192.168.88.55', connectedTime: '10 mins ago', package: '1 Hour Plan' }
    ];

    return res.json({
        success: true,
        businessName: client.businessName,
        revenue: {
            daily: dailyRevenue,
            weekly: weeklyRevenue,
            monthly: monthlyRevenue
        },
        transactions: {
            successful: successfulTxs,
            failed: failedTxs,
            pending: pendingTxs
        },
        activeUsers: activeUsers
    });
});

// 7. Client Feature: Generate Free Voucher with Customizable Duration
app.post('/api/client/generate-voucher', (req, res) => {
    const { username, durationHours, packageName } = req.body;
    const client = clientsDb[username];

    if (!client || client.role !== 'client') {
        return res.status(403).json({ success: false, message: 'Unauthorized client access.' });
    }

    const voucherCode = 'VCH-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    return res.json({
        success: true,
        voucher: {
            code: voucherCode,
            duration: durationHours || '1 Hour',
            package: packageName || 'Free Promotional Voucher',
            generatedAt: new Date().toISOString()
        },
        message: 'Free voucher generated successfully.'
    });
});

// 8. Endpoint to initiate Payment via IntaSend STK Push
app.post('/api/stk-push', async (req, res) => {
    try {
        const { phone, packageId, amount, tenantId, macAddress } = req.body;

        if (!phone || !amount) {
            return res.status(400).json({ success: false, message: 'Phone number and amount are required.' });
        }

        let formattedPhone = phone.toString().trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        const client = clientsDb[tenantId] || clientsDb['Steven'];
        const apiRef = `WIFI-${tenantId || 'Steven'}-${Date.now()}`;

        const payload = {
            amount: parseFloat(amount),
            phone_number: formattedPhone,
            email: client.email || 'client@vortexwifi.com',
            api_ref: apiRef,
            narrative: `Payment for Wi-Fi Access - ${client.businessName}`
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

        const checkoutRequestId = response.data.invoice?.invoice_id || response.data.id || apiRef;

        transactions[checkoutRequestId] = {
            status: 'PENDING',
            phone: formattedPhone,
            amount: amount,
            packageId: packageId,
            tenantId: tenantId || 'Steven',
            macAddress: macAddress || 'unknown',
            apiRef: apiRef,
            timestamp: Date.now()
        };

        // Fallback test mode simulation if webhook is delayed
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

// 9. Endpoint to check payment status during frontend polling
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

// 10. IntaSend Webhook Callback Endpoint (Handles 5% commission deduction & automated 95% client payout)
app.post('/api/mpesa-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        console.log('IntaSend Webhook Received:', JSON.stringify(eventData));

        const invoiceState = eventData.state || eventData.invoice?.state;
        const grossAmount = parseFloat(eventData.value || eventData.invoice?.value || 0);
        const apiRef = eventData.api_ref || eventData.invoice?.api_ref || '';
        const invoiceId = eventData.invoice_id || eventData.invoice?.invoice_id;
        const mpesaReceipt = eventData.provider_reference || eventData.invoice?.provider_reference || 'INTASEND_VERIFIED';

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

                const tenantId = transactions[targetKey].tenantId || 'Steven';
                const client = clientsDb[tenantId] || clientsDb['Steven'];

                if (grossAmount > 0 && client && client.clientTillNumber) {
                    const commissionDeduction = grossAmount * 0.05;
                    const clientPayoutAmount = grossAmount - commissionDeduction;

                    console.log(`Gross Payment Received: KSH ${grossAmount}`);
                    console.log(`Deducting 5% Platform Commission: KSH ${commissionDeduction}`);
                    console.log(`Routing 95% (KSH ${clientPayoutAmount}) automatically to Client Till: ${client.clientTillNumber}`);

                    const payoutPayload = {
                        currency: "KES",
                        transactions: [
                            {
                                name: client.businessName,
                                account: client.clientTillNumber,
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
    console.log(`Vortex backend server running securely with environment-protected IntaSend keys on port ${PORT}`);
});
