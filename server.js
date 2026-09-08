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

// IntaSend Live Configuration Constants & API Keys
const INTASEND_PUBLIC_KEY = process.env.INTASEND_PUBLIC_KEY || 'ISPubKey_live_c7bed1dd-7649-4119-a12b-8ce23bf5e2de';
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || 'ISSecretKey_live_0302f716-566b-4e06-9c21-d87dad6070d1';
const INTASEND_BASE_URL = 'https://payment.intasend.com/api/v1/';

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

// IntaSend STK Push Handler function to send prompt directly to clients' phones
async function initiateIntaSendSTKPush(phoneNumber, amount, narrative, tenant) {
    try {
        const response = await axios.post(`${INTASEND_BASE_URL}payment/mpesa-stk-push/`, {
            public_key: INTASEND_PUBLIC_KEY,
            amount: amount,
            phone_number: phoneNumber,
            narrative: narrative || tenant.businessName
        }, {
            headers: {
                Authorization: `Bearer ${INTASEND_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('IntaSend STK Push Error:', error.response?.data || error.message);
        throw new Error('Failed to initiate M-Pesa STK push via IntaSend.');
    }
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
  // Controller logic placeholder...
});
