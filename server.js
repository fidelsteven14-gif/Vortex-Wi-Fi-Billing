const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { RouterOSClient } = require('routeros-client');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Central Transaction Database & Super Admin Ledger
const globalTransactions = [];

// 50+ Multi-Tenant & Attendant Registry with 5% Super Admin Commission tracking
const tenants = {
    "router1": {
        businessName: "ELITE HOTSPOT",
        customerCare: "0712345678",
        attendantUsername: "elite_admin",
        attendantPassword: "password123",
        router: { host: "192.168.88.1", user: "admin", password: "routerpassword1", port: 8728 },
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
        router: { host: process.env.MIKROTIK_HOST || "192.168.88.1", user: process.env.MIKROTIK_USER || "admin", password: process.env.MIKROTIK_PASSWORD || "", port: 8728 },
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    };
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

        // Daily (Same day)
        if (txDate.toDateString() === now.toDateString()) {
            dailyRev += tx.amount;
        }
        // Weekly (Within last 7 days)
        const diffTime = Math.abs(now - txDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) {
            weeklyRev += tx.amount;
        }
        // Monthly (Same month and year)
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
                attendantNet: (dailyRev - (dailyRev * 0.05)) // Net after 5% super admin cut
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
      comment: `Paid via IntaSend - MAC: ${macAddress}`
    });
    await connection.close();
    return true;
  } catch (error) {
    console.error(`Router API Error on ${routerConfig.host}:`, error.message);
    throw new Error(`Router failure: ${error.message}`);
  }
}

// Payment Webhook with 5% Super Admin Commission calculation
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

      const commission = amountPaid * 0.05; // 5% Super Admin Commission

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
