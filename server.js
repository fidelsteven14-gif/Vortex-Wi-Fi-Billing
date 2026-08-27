const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// Multi-tenant configuration database mock
const tenants = {
    "vortex.spot": {
        businessName: "HOTSPOT VORTEX",
        customerCare: "0113660340",
        packages: [
            { id: 1, name: "LITE 1hrs", speed: "5 Mbps", price: 10 },
            { id: 2, name: "surf 2hrs", speed: "3 Mbps", price: 15 },
            { id: 3, name: "KIFARU 4hrs", speed: "3 Mbps", price: 20 },
            { id: 4, name: "KIFARU 6hrs", speed: "3 Mbps", price: 25 },
            { id: 5, name: "NDOVU 12hrs", speed: "10 Mbps", price: 35, popular: true },
            { id: 6, name: "JINICE 24hrs", speed: "10 Mbps", price: 50 },
            { id: 7, name: "6 hrs VIP plan", speed: "Unlimited", price: 60 },
            { id: 8, name: "3days plan", speed: "5 Mbps", price: 100 }
        ]
    }
};

// API: Fetch White-Label Tenant Config
app.get('/api/config/:domain', (req, res) => {
    const domain = req.params.domain;
    const tenantData = tenants[domain] || tenants["vortex.spot"];
    res.json({ success: true, data: tenantData });
});

// API: Handle M-Pesa Transaction Sync Verification
app.post('/api/sync-transaction', (req, res) => {
    const { transactionReference } = req.body;
    
    if (!transactionReference) {
        return res.status(400).json({ success: false, message: "Transaction reference is required." });
    }

    // Insert your Daraja API or database validation logic here
    console.log(`Verifying M-Pesa transaction reference: ${transactionReference}`);
    
    res.json({
        success: true,
        message: "Connection re-established successfully using KSH payment.",
        sessionActive: true
    });
});

// API: Voucher Code Validation
app.post('/api/verify-voucher', (req, res) => {
    const { code } = req.body;
    
    if (code === "VORTEX123") {
        return res.json({ success: true, message: "Voucher code accepted. Internet access granted." });
    }
    
    res.status(400).json({ success: false, message: "Invalid or expired voucher code." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Vortex Wi-Fi Billing backend server running on port ${PORT}`);
});
