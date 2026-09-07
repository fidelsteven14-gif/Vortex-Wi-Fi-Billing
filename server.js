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

// In-Memory Store for Active STK Push Checkouts and Payment Statuses
const activeCheckouts = new Map();

// 50+ Multi-Tenant & Attendant Registry with 5% Super Admin Commission tracking
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

    // Filter transactions for this tenant
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

// Trigger M-Pesa STK Push Endpoint
app.post('/api/stk-push', async (req, res) => {
    try {
        const { phone, packageId, tenantId, macAddress } = req.body;

        if (!phone || !packageId) {
            return res.status(400).json({ success: false, message: 'Phone number and package ID are required.' });
        }

        let formattedPhone = phone.trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.substring(1);
        }

        const activeTenant = getActiveTenant(tenantId || "router1");

        const matchedPkg = activeTenant.packages.find(p => p.id == packageId || p.price == packageId);
        const amount = matchedPkg ? matchedPkg.price : 10;
        const selectedProfile = matchedPkg ? matchedPkg.profile : '1_Hour_Package';

        // Simulation or Sandbox fallback if consumer keys are not provided
        if (!activeTenant.consumerKey || activeTenant.env === 'sandbox') {
            const mockCheckoutId = `ws_CO_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            activeCheckouts.set(mockCheckoutId, {
                status: 'PENDING',
                phone: formattedPhone,
                amount,
                packageProfile: selectedProfile,
                tenantId: activeTenant.tenantId,
                macAddress: macAddress || 'unknown'
            });

            // FIXED: Removed the automatic 7-second fake success timer so it stays PENDING 
            // until manually simulated or completed by real webhook/actions.

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
            CallBackURL: `https://${req.headers.host}/api/mpesa-webhook`,
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
                macAddress: macAddress || 'unknown'
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

// Payment Status Polling Endpoint for Frontend Modal
app.get('/api/payment-status', (req, res) => {
    const { checkout_id } = req.query;
    if (!checkout_id || !activeCheckouts.has(checkout_id)) {
        return res.json({ status: 'PENDING', message: 'Waiting for payment confirmation...' });
    }
    const payment = activeCheckouts.get(checkout_id);
    res.json({
        status: payment.status,
        receipt: payment.receipt || null,
        message: payment.message || (payment.status === 'FAILED' ? payment.reason : 'Waiting for M-Pesa PIN entry...')
    });
});

// Safaricom Daraja Webhook & Callback Receiver
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

            activeCheckouts.set(checkoutId, {
                status: 'COMPLETE',
                receipt: mpesaReceiptNumber,
                message: 'Payment successful! Connecting you to the internet...'
            });
        } else {
            // Handle failure reasons like Insufficient Balance or Cancellation
            let userFriendlyMessage = resultDesc;
            if (resultCode === 1 || (resultDesc && resultDesc.toLowerCase().includes('balance'))) {
                userFriendlyMessage = 'Insufficient balance in your M-Pesa account. Please top up and try again.';
            } else if (resultCode === 1032 || (resultDesc && resultDesc.toLowerCase().includes('cancel'))) {
                userFriendlyMessage = 'Payment request was cancelled by the user.';
            }

            if (checkoutSession) {
                activeCheckouts.set(checkoutId, {
                    status: 'FAILED',
                    reason: userFriendlyMessage
                });
            }
        }

        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (err) {
        console.error('Webhook Error:', err);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal Server Error' });
    }
});

// Legacy Payment Webhook compatibility route
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const paymentData = req.body;
    const paymentStatus = paymentData.state || paymentData.status;
    const phoneNumber = paymentData.api_ref || paymentData.phone_number || paymentData.account;
    const amountPaid = parseFloat(paymentData.value || paymentData.amount || 0);
    const customerMac = paymentData.narration || paymentData.mac_address || 'unknown-mac';
    const tenantId = paymentData.tenant || "router1";

    const activeTenant = getActiveTenant(tenantId);

    if (paymentStatus === 'COMPLETE' || paymentStatus === 'Complete' || paymentStatus === 'SUCCESS') {
      let selectedProfile = '1_Hour_Package';
      const matchedPkg = activeTenant.packages.find(p => p.price === amountPaid);
      if (matchedPkg) selectedProfile = matchedPkg.profile;

      const commission = amountPaid * 0.05;

      globalTransactions.push({
          tenantId,
          phoneNumber,
          amount: amountPaid,
          commission,
          macAddress: customerMac,
          timestamp: new Date().toISOString()
      });

      if (phoneNumber) {
        await provisionMikroTikUser(phoneNumber, customerMac, selectedProfile, activeTenant.router);
      }

      return res.status(200).json({ success: true, message: "Payment verified and commission recorded." });
    }

    return res.status(400).json({ success: false, message: "Payment incomplete." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
