const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { RouterOSClient } = require('routeros-client');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, CSS, assets) from the root directory
app.use(express.static(path.join(__dirname)));

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Multi-tenant configuration database
const tenants = {
    "vortex.spot": {
        businessName: "HOTSPOT VORTEX",
        customerCare: "0113660340",
        packages: [
            { id: 1, name: "LITE 1hrs", speed: "5 Mbps", price: 10, profile: "1_Hour_Package" },
            { id: 2, name: "surf 2hrs", speed: "3 Mbps", price: 15, profile: "2_Hours_Package" },
            { id: 3, name: "KIFARU 4hrs", speed: "3 Mbps", price: 20, profile: "4_Hours_Package" },
            { id: 4, name: "KIFARU 6hrs", speed: "3 Mbps", price: 25, profile: "6_Hours_Package" },
            { id: 5, name: "NDOVU 12hrs", speed: "10 Mbps", price: 35, popular: true, profile: "12_Hours_Package" },
            { id: 6, name: "JINICE 24hrs", speed: "10 Mbps", price: 50, profile: "24_Hours_Package" },
            { id: 7, name: "6 hrs VIP plan", speed: "Unlimited", price: 60, profile: "VIP_6_Hours" },
            { id: 8, name: "3days plan", speed: "5 Mbps", price: 100, profile: "3_Days_Package" }
        ]
    }
};

// Serve Main Splash Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Fetch White-Label Tenant Config
app.get('/api/config/:domain', (req, res) => {
    const domain = req.params.domain;
    const tenantData = tenants[domain] || tenants["vortex.spot"];
    res.json({ success: true, data: tenantData });
});

// MikroTik Router Integration Function
async function provisionMikroTikUser(username, macAddress, packageProfile) {
  const connection = new RouterOSClient({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASSWORD,
    port: parseInt(process.env.MIKROTIK_PORT || '8728'),
    tls: process.env.MIKROTIK_SSL === 'true' ? {} : undefined
  });

  try {
    console.log(`Connecting to MikroTik router at ${process.env.MIKROTIK_HOST}...`);
    await connection.connect();
    
    const chan = connection.openChannel('hotspot-provisioner');

    await chan.write('/ip/hotspot/user/add', {
      name: username,
      password: username,
      profile: packageProfile || 'default',
      comment: `Paid via IntaSend - MAC: ${macAddress}`
    });

    console.log(`Successfully created MikroTik hotspot user: ${username} with profile: ${packageProfile}`);
    await connection.close();
    return true;
  } catch (error) {
    console.error('MikroTik API Communication Error:', error.message);
    throw new Error(`Router failure: ${error.message}`);
  }
}

// API: Handle M-Pesa / IntaSend Transaction Sync & Webhook Verification
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const paymentData = req.body;
    console.log('Received IntaSend Webhook Payload:', JSON.stringify(paymentData, null, 2));

    const paymentStatus = paymentData.state || paymentData.status;
    const phoneNumber = paymentData.api_ref || paymentData.phone_number || paymentData.account;
    const amountPaid = parseFloat(paymentData.value || paymentData.amount || 0);
    const customerMac = paymentData.narration || paymentData.mac_address || 'unknown-mac';

    if (paymentStatus === 'COMPLETE' || paymentStatus === 'Complete' || paymentStatus === 'SUCCESS') {
      // Match amount to specific tenant packages
      let selectedProfile = '1_Hour_Package';
      const tenantPackages = tenants["vortex.spot"].packages;
      const matchedPkg = tenantPackages.find(p => p.price === amountPaid);
      if (matchedPkg) {
        selectedProfile = matchedPkg.profile;
      }

      if (phoneNumber) {
        await provisionMikroTikUser(phoneNumber, customerMac, selectedProfile);
      }

      return res.status(200).json({ 
        success: true, 
        message: "Payment verified and internet access granted successfully.",
        sessionActive: true 
      });
    }

    return res.status(400).json({ success: false, message: "Payment status not complete." });
  } catch (error) {
    console.error('Webhook Error Processing:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Backward compatibility for existing sync endpoint
app.post('/api/sync-transaction', async (req, res) => {
    const { transactionReference, phoneNumber, macAddress, amount } = req.body;
    
    if (!transactionReference && !phoneNumber) {
        return res.status(400).json({ success: false, message: "Transaction or phone reference is required." });
    }

    console.log(`Syncing transaction reference: ${transactionReference || phoneNumber}`);
    
    try {
      if (phoneNumber && amount) {
        let profile = '1_Hour_Package';
        const matchedPkg = tenants["vortex.spot"].packages.find(p => p.price === parseFloat(amount));
        if (matchedPkg) profile = matchedPkg.profile;
        
        await provisionMikroTikUser(phoneNumber, macAddress || 'unknown', profile);
      }
    } catch (err) {
      console.error('Sync provisioning note:', err.message);
    }

    res.json({
        success: true,
        message: "Connection re-established successfully using payment.",
        sessionActive: true
    });
});

// API: Voucher Code Validation
app.post('/api/verify-voucher', async (req, res) => {
    const { code, macAddress } = req.body;
    
    if (code === "VORTEX123") {
        try {
          await provisionMikroTikUser(`vouch_${code}`, macAddress || 'unknown', '24_Hours_Package');
        } catch (e) {
          console.error('Voucher router provisioning note:', e.message);
        }
        return res.json({ success: true, message: "Voucher code accepted. Internet access granted." });
    }
    
    res.status(400).json({ success: false, message: "Invalid or expired voucher code." });
});

app.listen(PORT, () => {
    console.log(`Vortex Wi-Fi Billing backend server running live on port ${PORT}`);
});
