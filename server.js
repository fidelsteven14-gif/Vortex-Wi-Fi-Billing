const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const { RouterOSClient } = require('routeros-client');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Central Transaction Database & Super Admin Ledger
const globalTransactions = [];

/**
 * =========================================================================
 * M-PESA STK PUSH & WEBHOOK HANDSHAKE STATE MANAGEMENT
 * =========================================================================
 * This Map tracks active checkouts through their exact lifecycle stages:
 * 1. 'PENDING': STK push sent, waiting for user to type M-Pesa PIN.
 * 2. 'COMPLETE': Webhook received success response from Safaricom (ResultCode 0).
 * 3. 'FAILED': User cancelled, insufficient balance, or timeout.
 * =========================================================================
 */
const activeCheckouts = new Map();

// Multi-Tenant & Attendant Registry with 5% Super Admin Commission tracking
const tenants = {
    "router1": {
        businessName: "ELITE HOTSPOT",
        customerCare: "0712345678",
        attendantUsername: "elite_admin",
        attendantPassword: "password123",
        router: { host: "192.168.88.1", user: "admin", password: "routerpassword1", port: 8728 },
        tillNumber: process.env.MPESA_SHORTCODE || '174379',
        passKey: process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
        consumerKey: process.env.MPESA_CONSUMER_KEY || '',
        consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
        env: process.env.MPESA_ENV || 'sandbox',
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    },
    "router2": {
        businessName: "SAVANNAH WI-FI",
        customerCare: "0722000000",
        attendantUsername: "savannah_admin",
        attendantPassword: "password123",
        router: { host: "192.168.99.1", user: "admin", password: "routerpassword2", port: 8728 },
        tillNumber: process.env.MPESA_SHORTCODE || '174379',
        passKey: process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
        consumerKey: process.env.MPESA_CONSUMER_KEY || '',
        consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
        env: process.env.MPESA_ENV || 'sandbox',
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    }
};

function getActiveTenant(identifier) {
    if (identifier && tenants[identifier]) {
        return { tenantId: identifier, ...tenants[identifier] };
    }
    return {
        tenantId: "router1",
        businessName: "VORTEX HOTSPOT",
        customerCare: "0113660340",
        tillNumber: process.env.MPESA_SHORTCODE || '174379',
        passKey: process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
        consumerKey: process.env.MPESA_CONSUMER_KEY || '',
        consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
        env: process.env.MPESA_ENV || 'sandbox',
        router: { host: process.env.MIKROTIK_HOST || "192.168.88.1", user: process.env.MIKROTIK_USER || "admin", password: process.env.MIKROTIK_PASSWORD || "", port: 8728 },
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    };
}

async function getMpesaAccessToken(tenant) {
    const url = tenant.env === 'production'
        ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
        : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

    const auth = Buffer.from(`${tenant.consumerKey}:${tenant.consumerSecret}`).toString('base64');

    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('M-Pesa Auth Error:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with M-Pesa Daraja API.');
    }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Attendant Login Route
app.post('/api/attendant/login', (req, res) => {
    const { username, password } = req.body;
    for (const [tenantId, data] of Object.entries(tenants)) {
        if (data.attendantUsername === username && data.attendantPassword === password) {
            return res.json({
                success: true,
                tenantId: tenantId,
                businessName: data.businessName,
                message: "Login successful"
            });
        }
    }
    res.status(401).json({ success: false, message: "Invalid username or password." });
});

// Fetch Tenant Config
app.get('/api/config/:tenantId', (req, res) => {
    const tenantData = getActiveTenant(req.params.tenantId);
    res.json({ success: true, data: tenantData });
});

// Attendant Dashboard Statistics & Revenue Endpoint
app.get('/api/attendant/stats/:tenantId', async (req, res) => {
    const tenantId = req.params.tenantId;
    const activeTenant = getActiveTenant(tenantId);
    
    let activeUsers = [];
    try {
        const connection = new RouterOSClient({
            host: activeTenant.router.host,
            user: activeTenant.router.user,
            password: activeTenant.router.password,
            port: activeTenant.router.port,
            tls: undefined
        });
        await connection.connect();
        const chan = connection.openChannel('stats-channel');
        activeUsers = await chan.write('/ip/hotspot/active/print');
        await connection.close();
    } catch (err) {
        console.log(`Could not fetch live router stats for ${tenantId}:`, err.message);
    }

    const tenantTx = globalTransactions.filter(tx => tx.tenantId === tenantId);
    const now = new Date();

    let dailyRev = 0;
    let weeklyRev = 0;
    let monthlyRev = 0;
    let superAdminCommissionTotal = 0;

    tenantTx.forEach(tx => {
        const txDate = new Date(tx.timestamp);
        superAdminCommissionTotal += tx.commission;

        if (txDate.toDateString() === now.toDateString()) {
            dailyRev += tx.amount;
        }
        const diffTime = Math.abs(now - txDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) {
            weeklyRev += tx.amount;
        }
        if (txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear()) {
            monthlyRev += tx.amount;
        }
    });

    res.json({
        success: true,
        stats: {
            businessName: activeTenant.businessName,
            activeConnectionsCount: activeUsers.length,
            activeUsers: activeUsers.map(u => ({ user: u.user, mac: u['mac-address'], ip: u.address, uptime: u.uptime })),
            revenue: {
                daily: dailyRev,
                weekly: weeklyRev,
                monthly: monthlyRev,
                superAdminCommission: superAdminCommissionTotal,
                attendantNet: (dailyRev - (dailyRev * 0.05))
            },
            recentTransactions: tenantTx.slice(-10).reverse()
        }
    });
});

async function provisionMikroTikUser(username, macAddress, packageProfile, routerConfig) {
  const connection = new RouterOSClient({
    host: routerConfig.host,
    user: routerConfig.user,
    password: routerConfig.password,
    port: routerConfig.port,
    tls: undefined
  });

  try {
    await connection.connect();
    const chan = connection.openChannel('hotspot-provisioner');
    await chan.write('/ip/hotspot/user/add', {
      name: username,
      password: username,
      profile: packageProfile || 'default',
      comment: `Paid via M-Pesa STK - MAC: ${macAddress}`
    });
    await connection.close();
    return true;
  } catch (error) {
    console.error(`Router API Error on ${routerConfig.host}:`, error.message);
    throw new Error(`Router failure: ${error.message}`);
  }
}

/**
 * =========================================================================
 * STEP 1: TRIGGER STK PUSH (Initial Handshake Start)
 * =========================================================================
 * Validates the phone number, sends the prompt to Safaricom, and stores the 
 * transaction state as 'PENDING'. It returns a checkout_request_id to the frontend.
 * =========================================================================
 */
app.post('/api/stk-push', async (req, res) => {
    try {
        console.log("Incoming STK Push Body:", req.body);
        const rawPhone = req.body.phone || req.body.phoneNumber || req.body.msisdn;
        const rawPackage = req.body.packageId || req.body.amount || req.body.package;
        const tenantId = req.body.tenantId || req.body.tenant;
        const macAddress = req.body.macAddress || req.body.mac;

        // FIXED: Replaced invalid `.trim` function check with proper string truthiness/emptiness validation
        if (!rawPhone || String(rawPhone).trim() === '' || !rawPackage) {
            return res.status(400).json({ 
                success: false, 
                message: 'A valid M-Pesa phone number and package selection are required.' 
            });
        }

        let formattedPhone = String(rawPhone).trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        if (formattedPhone.length !== 12 || !formattedPhone.startsWith('254')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX.' 
            });
        }

        const activeTenant = getActiveTenant(tenantId || "router1");
        const matchedPkg = activeTenant.packages.find(p => p.id == rawPackage || p.price == rawPackage);
        const amount = matchedPkg ? matchedPkg.price : (isNaN(Number(rawPackage)) ? 10 : Number(rawPackage));
        const selectedProfile = matchedPkg ? matchedPkg.profile : '1_Hour_Package';

        // Sandbox or Simulation fallback
        if (!activeTenant.consumerKey || activeTenant.env === 'sandbox') {
            const mockCheckoutId = `ws_CO_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            
            // Explicitly set to PENDING. Will NOT auto-complete until webhook or test simulation is fired.
            activeCheckouts.set(mockCheckoutId, {
                status: 'PENDING',
                phone: formattedPhone,
                amount,
                packageProfile: selectedProfile,
                tenantId: activeTenant.tenantId,
                macAddress: macAddress || 'unknown',
                message: 'STK push prompt sent. Enter your M-Pesa PIN on your phone...'
            });

            return res.json({
                success: true,
                checkout_request_id: mockCheckoutId,
                message: 'STK push prompt sent to phone successfully.'
            });
        }

        // Production Daraja STK Push Integration
        const accessToken = await getMpesaAccessToken(activeTenant);
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(`${activeTenant.tillNumber}${activeTenant.passKey}${timestamp}`).toString('base64');

        const stkUrl = activeTenant.env === 'production'
            ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
            : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

        const stkResponse = await axios.post(stkUrl, {
            BusinessShortCode: activeTenant.tillNumber,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: activeTenant.tillNumber,
            PhoneNumber: formattedPhone,
            CallBackURL: `https://hotspot-vortex-backend.onrender.com/api/mpesa-webhook`,
            AccountReference: activeTenant.businessName,
            TransactionDesc: `Hotspot Package ${amount}KES`
        }, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (stkResponse.data.ResponseCode === '0') {
            const checkoutId = stkResponse.data.CheckoutRequestID;
            activeCheckouts.set(checkoutId, {
                status: 'PENDING',
                phone: formattedPhone,
                amount,
                packageProfile: selectedProfile,
                tenantId: activeTenant.tenantId,
                macAddress: macAddress || 'unknown',
                message: 'STK push prompt sent. Enter your M-Pesa PIN...'
            });
            return res.json({ success: true, checkout_request_id: checkoutId });
        } else {
            throw new Error(stkResponse.data.errorMessage || 'M-Pesa STK push initiation failed.');
        }

    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.message || 'Internal server error during STK push.' });
    }
});

/**
 * =========================================================================
 * STEP 2 & 4: FRONTEND POLLING ENDPOINT (The Handshake Bridge)
 * =========================================================================
 * The frontend modal repeatedly calls this endpoint with the checkout_id.
 * It will continuously return 'PENDING' until the backend webhook updates 
 * the session state to 'COMPLETE' or 'FAILED'.
 * =========================================================================
 */
app.get('/api/payment-status', (req, res) => {
    const { checkout_id } = req.query;
    
    if (!checkout_id || !activeCheckouts.has(checkout_id)) {
        return res.json({ 
            status: 'PENDING', 
            message: 'Awaiting payment initialization...' 
        });
    }

    const payment = activeCheckouts.get(checkout_id);
    res.json({
        status: payment.status, // Remains 'PENDING' until STEP 3 processes the webhook
        receipt: payment.receipt || null,
        message: payment.message || (payment.status === 'FAILED' ? payment.reason : 'Waiting for M-Pesa PIN entry...')
    });
});

// Developer/Testing Helper: Manually simulate a successful PIN entry for local sandbox workflows
app.post('/api/test/simulate-success', async (req, res) => {
    try {
        const { checkout_id } = req.body;
        if (!checkout_id || !activeCheckouts.has(checkout_id)) {
            return res.status(404).json({ success: false, message: 'Checkout session not found.' });
        }

        const session = activeCheckouts.get(checkout_id);
        const fakeReceipt = `RND${Math.floor(100000000 + Math.random() * 900000000)}`;
        const commission = session.amount * 0.05;

        globalTransactions.push({
            tenantId: session.tenantId,
            phoneNumber: session.phone,
            amount: session.amount,
            commission,
            macAddress: session.macAddress,
            timestamp: new Date().toISOString()
        });

        const activeTenant = getActiveTenant(session.tenantId);
        await provisionMikroTikUser(session.phone, session.macAddress, session.packageProfile, activeTenant.router);

        // Transition status from PENDING to COMPLETE
        activeCheckouts.set(checkout_id, {
            status: 'COMPLETE',
            receipt: fakeReceipt,
            message: 'Payment verified successfully! Connecting you to the internet...'
        });

        res.json({ success: true, message: 'Simulation successful. Checkout marked as COMPLETE.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * =========================================================================
 * STEP 3: SAFARICOM DARAIJA WEBHOOK (The Backend Notification Receiver)
 * =========================================================================
 * Safaricom calls this endpoint ONLY after the user enters their M-Pesa PIN 
 * and the transaction resolves. 
 * - If ResultCode === 0 (Success): It records the transaction, provisions the 
 *   router user, and changes state to 'COMPLETE'.
 * - If ResultCode !== 0 (Cancelled/Insufficient Funds): It changes state to 'FAILED'.
 * =========================================================================
 */
app.post('/api/mpesa-webhook', async (req, res) => {
    try {
        const body = req.body.Body?.stkCallback;
        if (!body) return res.sendStatus(400);

        const checkoutId = body.CheckoutRequestID;
        const resultCode = body.ResultCode;
        const resultDesc = body.ResultDesc;

        const checkoutSession = activeCheckouts.get(checkoutId);

        if (resultCode === 0) {
            const callbackMetadata = body.CallbackMetadata?.Item;
            let mpesaReceiptNumber = '';
            if (callbackMetadata) {
                const receiptItem = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber');
                if (receiptItem) mpesaReceiptNumber = receiptItem.Value;
            }

            const amountPaid = checkoutSession ? checkoutSession.amount : 10;
            const tenantId = checkoutSession ? checkoutSession.tenantId : 'router1';
            const customerPhone = checkoutSession ? checkoutSession.phone : 'unknown';
            const customerMac = checkoutSession ? checkoutSession.macAddress : 'unknown';
            const packageProfile = checkoutSession ? checkoutSession.packageProfile : '1_Hour_Package';

            const commission = amountPaid * 0.05;

            globalTransactions.push({
                tenantId,
                phoneNumber: customerPhone,
                amount: amountPaid,
                commission,
                macAddress: customerMac,
                timestamp: new Date().toISOString()
            });

            const activeTenant = getActiveTenant(tenantId);
            if (customerPhone) {
                await provisionMikroTikUser(customerPhone, customerMac, packageProfile, activeTenant.router);
            }

            // MARK STATE AS COMPLETE SO THE FRONTEND POLLING GRABS IT
            activeCheckouts.set(checkoutId, {
                status: 'COMPLETE',
                receipt: mpesaReceiptNumber,
                message: 'Payment successful! Connecting you to the internet...'
            });
        } else {
            let userFriendlyMessage = resultDesc;
            if (resultCode === 1 || (resultDesc && resultDesc.toLowerCase().includes('balance'))) {
                userFriendlyMessage = 'Insufficient balance in your M-Pesa account. Please top up and try again.';
            } else if (resultCode === 1032 || (resultDesc && resultDesc.toLowerCase().includes('cancel'))) {
                userFriendlyMessage = 'Payment request was cancelled by the user. Please try again.';
            }

            if (checkoutSession) {
                activeCheckouts.set(checkoutId, {
                    status: 'FAILED',
                    reason: userFriendlyMessage,
                    message: userFriendlyMessage
                });
            }
        }

        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (err) {
        console.error('Webhook Error:', err);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal Server Error' });
    }
});

// Transaction Sync helper
app.post('/api/sync-transaction', async (req, res) => {
    const { phoneNumber, amount, macAddress, tenant } = req.body;
    const activeTenant = getActiveTenant(tenant || "router1");
    const amountPaid = parseFloat(amount || 0);
    const commission = amountPaid * 0.05;

    try {
      if (phoneNumber && amountPaid) {
        let profile = '1_Hour_Package';
        const matchedPkg = activeTenant.packages.find(p => p.price === amountPaid);
        if (matchedPkg) profile = matchedPkg.profile;
        
        globalTransactions.push({
            tenantId: tenant || "router1",
            phoneNumber,
            amount: amountPaid,
            commission,
            macAddress: macAddress || 'unknown',
            timestamp: new Date().toISOString()
        });

        await provisionMikroTikUser(phoneNumber, macAddress || 'unknown', profile, activeTenant.router);
      }
    } catch (err) {
      console.error('Sync error:', err.message);
    }

    res.json({ success: true, sessionActive: true });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
