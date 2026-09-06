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

// Dynamic Multi-Tenant Registry (Easily scaled to 50+ routers, each with completely custom names)
const tenants = {
    "router1": {
        businessName: "ELITE HOTSPOT",
        customerCare: "0712345678",
        router: { host: "192.168.88.1", user: "admin", password: "password1", port: 8728 },
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    },
    "router2": {
        businessName: "SAVANNAH WI-FI",
        customerCare: "0722000000",
        router: { host: "192.168.99.1", user: "admin", password: "password2", port: 8728 },
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    }
    // You can register all 50+ routers here using unique identifiers (router3, router4, etc.)
};

// Helper function to resolve tenant configuration dynamically by ID, domain, or fallback defaults
function getActiveTenant(identifier) {
    if (identifier && tenants[identifier]) {
        return tenants[identifier];
    }
    
    // Dynamic fallback for any unlisted router ID so the system never breaks for your 50+ clients
    return {
        businessName: identifier ? `${identifier.toUpperCase()} HOTSPOT` : "VORTEX HOTSPOT",
        customerCare: "0113660340",
        router: {
            host: process.env.MIKROTIK_HOST || "192.168.88.1",
            user: process.env.MIKROTIK_USER || "admin",
            password: process.env.MIKROTIK_PASSWORD || "",
            port: 8728
        },
        packages: [
            { id: 1, name: "1 Hour", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "3 Hours", price: 20, profile: "3_Hours_Package" },
            { id: 3, name: "24 Hours", price: 50, profile: "24_Hours_Package" }
        ]
    };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Fetch specific tenant configuration using router ID or domain query
app.get('/api/config/:tenantId', (req, res) => {
    const tenantData = getActiveTenant(req.params.tenantId);
    res.json({ success: true, data: tenantData });
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

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const paymentData = req.body;
    const paymentStatus = paymentData.state || paymentData.status;
    const phoneNumber = paymentData.api_ref || paymentData.phone_number || paymentData.account;
    const amountPaid = parseFloat(paymentData.value || paymentData.amount || 0);
    const customerMac = paymentData.narration || paymentData.mac_address || 'unknown-mac';
    
    // Extract tenant identifier sent from the router's redirect URL (e.g. ?tenant=router1)
    const tenantId = paymentData.tenant || paymentData.callback_url_id || "router1";
    const activeTenant = getActiveTenant(tenantId);

    if (paymentStatus === 'COMPLETE' || paymentStatus === 'Complete' || paymentStatus === 'SUCCESS') {
      let selectedProfile = '1_Hour_Package';
      const matchedPkg = activeTenant.packages.find(p => p.price === amountPaid);
      if (matchedPkg) selectedProfile = matchedPkg.profile;

      if (phoneNumber) {
        await provisionMikroTikUser(phoneNumber, customerMac, selectedProfile, activeTenant.router);
      }

      return res.status(200).json({ success: true, message: `Provisioned successfully on ${activeTenant.businessName}` });
    }

    return res.status(400).json({ success: false, message: "Payment incomplete." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/sync-transaction', async (req, res) => {
    const { phoneNumber, amount, macAddress, tenant } = req.body;
    const activeTenant = getActiveTenant(tenant);
    
    try {
      if (phoneNumber && amount) {
        let profile = '1_Hour_Package';
        const matchedPkg = activeTenant.packages.find(p => p.price === parseFloat(amount));
        if (matchedPkg) profile = matchedPkg.profile;
        
        await provisionMikroTikUser(phoneNumber, macAddress || 'unknown', profile, activeTenant.router);
      }
    } catch (err) {
      console.error('Sync error:', err.message);
    }

    res.json({ success: true, sessionActive: true });
});

app.listen(PORT, () => {
    console.log(`Multi-Tenant Server running on port ${PORT}`);
});
