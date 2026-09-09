const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARE & CORS CONFIGURATION
// ==========================================
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

app.use(cors({
    origin: ALLOWED_ORIGIN,
    credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// ==========================================
// 2. DATABASE CONNECTION POOL SETUP
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:yourpassword@localhost:5432/vortex_db'
});

// Super Admin Hardcoded Credentials
const SUPER_ADMIN_EMAIL = 'fidelsteven2@gmail.com';
const SUPER_ADMIN_PASSWORD_HASH = bcrypt.hashSync('Steven_19.20.06', 10);

// ==========================================
// 3. INTASEND LIVE PAYMENT CONFIGURATION
// ==========================================
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || 'ISSecretKey_live_5f7c1644-ba7b-4136-8101-c900f0db330a';
const INTASEND_PUBLIC_KEY = process.env.INTASEND_PUBLIC_KEY || 'ISPubKey_live_c7bed1dd-7649-4119-a12b-8ce23bf5e2de';
const INTASEND_BASE_URL = 'https://api.intasend.com/api/v1';

// ==========================================
// 4. AUTOMATED DATABASE SCHEMA INITIALIZATION
// ==========================================
const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20) NOT NULL,
                business_name VARCHAR(100),
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS direct_messages (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                message TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                invoice_id VARCHAR(100),
                api_ref VARCHAR(100),
                phone_number VARCHAR(20),
                amount DECIMAL(10,2),
                state VARCHAR(50) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('PostgreSQL database tables initialized successfully.');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
};

initializeDatabase();

// ==========================================
// 5. AUTHENTICATION & ROLE-BASED LOGIN ROUTE
// ==========================================
app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body;

    try {
        if (identifier === SUPER_ADMIN_EMAIL) {
            const isMatch = bcrypt.compareSync(password, SUPER_ADMIN_PASSWORD_HASH);
            if (isMatch) {
                return res.status(200).json({ 
                    success: true, 
                    role: 'SUPER_ADMIN', 
                    redirect: '/super-admin-dashboard.html' 
                });
            } else {
                return res.status(401).json({ success: false, message: 'Invalid Super Admin password.' });
            }
        }

        const query = 'SELECT * FROM tenants WHERE username = $1 OR email = $1';
        const result = await pool.query(query, [identifier]);

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Account not found. Please register first.' });
        }

        const tenant = result.rows[0];
        const match = await bcrypt.compare(password, tenant.password_hash);

        if (!match) {
            return res.status(401).json({ success: false, message: 'Invalid password.' });
        }

        res.status(200).json({ 
            success: true, 
            role: 'TENANT', 
            tenant: tenant.username, 
            redirect: '/tenant-dashboard.html' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error during authentication.' });
    }
});

// ==========================================
// 6. TENANT REGISTRATION ROUTE
// ==========================================
app.post('/api/register', async (req, res) => {
    const { name, username, email, phone, password } = req.body;

    try {
        if (email === SUPER_ADMIN_EMAIL) {
            return res.status(400).json({ success: false, message: 'This email address is reserved for system administration.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `
            INSERT INTO tenants (name, username, email, phone, business_name, password_hash) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        
        const newTenant = await pool.query(query, [name, username, email, phone, name + ' Hotspot', hashedPassword]);
        
        res.status(201).json({ 
            success: true, 
            tenant: newTenant.rows[0].username, 
            redirect: '/tenant-dashboard.html' 
        });
    } catch (err) {
        console.error(err);
        res.status(400).json({ success: false, message: 'Registration failed. Username, email, or phone may already be in use.' });
    }
});

// ==========================================
// 7. TENANT PROFILE & CONTACT DETAILS UPDATE ROUTE
// ==========================================
app.put('/api/tenant/profile', async (req, res) => {
    const { username, phone, email, business_name } = req.body;

    try {
        const query = `
            UPDATE tenants 
            SET phone = COALESCE(NULLIF($1, ''), phone), 
                email = COALESCE(NULLIF($2, ''), email), 
                business_name = COALESCE(NULLIF($3, ''), business_name) 
            WHERE username = $4 
            RETURNING username, name, email, phone, business_name;
        `;
        
        const result = await pool.query(query, [phone, email, business_name, username]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant account not found.' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Contact details updated successfully.', 
            tenant: result.rows[0] 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error while updating profile.' });
    }
});

// ==========================================
// 8. SUPER ADMIN: FETCH REGISTERED TENANTS LIST
// ==========================================
app.get('/api/admin/tenants', async (req, res) => {
    try {
        const query = 'SELECT id, name, username, email, phone, business_name, created_at FROM tenants ORDER BY created_at DESC';
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to retrieve tenant database records.' });
    }
});

// ==========================================
// 9. SUPER ADMIN: DOWNLOAD TENANTS LIST AS PDF
// ==========================================
app.get('/api/admin/tenants/pdf', async (req, res) => {
    try {
        const query = 'SELECT name, username, email, phone, created_at FROM tenants ORDER BY created_at DESC';
        const result = await pool.query(query);
        const tenants = result.rows;

        const doc = new PDFDocument({ margin: 30, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=vortex_registered_tenants.pdf');

        doc.pipe(res);

        doc.fontSize(18).fillColor('#1a252f').text('VORTEX HOTSPOT BILLING SYSTEM', { align: 'center' });
        doc.fontSize(11).fillColor('#555').text('Super Admin Official Registered Tenants Directory', { align: 'center' });
        doc.moveDown(1.5);

        doc.fontSize(10).fillColor('#000');
        doc.text('No. | Full Name          | Username       | Email Address          | Phone Number  | Date Registered', { bold: true });
        doc.moveTo(30, doc.y + 4).lineTo(565, doc.y + 4).stroke();
        doc.moveDown(0.6);

        tenants.forEach((tenant, index) => {
            const dateStr = new Date(tenant.created_at).toLocaleDateString();
            const rowText = `${index + 1}.  ${tenant.name.padEnd(18)} | ${tenant.username.padEnd(14)} | ${tenant.email.padEnd(22)} | ${tenant.phone.padEnd(13)} | ${dateStr}`;
            doc.fontSize(9).text(rowText, { lineGap: 3 });
        });

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to generate PDF document.');
    }
});

// ==========================================
// 10. CONTACT CENTER INQUIRY ROUTE
// ==========================================
app.post('/api/contact', async (req, res) => {
    const { name, phone, message } = req.body;
    try {
        const query = `INSERT INTO direct_messages (name, phone, message, status) VALUES ($1, $2, $3, 'PENDING')`;
        await pool.query(query, [name, phone, message]);
        res.status(200).json({ success: true, message: 'Inquiry successfully transmitted to admin dashboard.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to record direct inquiry.' });
    }
});

// ==========================================
// 11. INTASEND LIVE PAYMENT & STK PUSH ROUTES
// ==========================================

// Expose public key safely to the frontend
app.get('/api/payment/config', (req, res) => {
    res.status(200).json({
        publishableKey: INTASEND_PUBLIC_KEY,
        environment: 'live'
    });
});

// Initialize M-Pesa STK Push from backend safely via Axios
app.post('/api/payment/initiate', async (req, res) => {
    const { amount, phone_number, email, api_ref } = req.body;

    try {
        const response = await axios.post(
            `${INTASEND_BASE_URL}/payment/mpesa-stk-push/`,
            {
                amount: amount,
                phone_number: phone_number,
                email: email || 'fidelsteven71@gmail.com',
                api_ref: api_ref || 'Vortex-Hotspot-Billing',
                host: req.headers.origin || 'https://vortex-hotspot.github.io'
            },
            {
                headers: {
                    'Authorization': `Bearer ${INTASEND_SECRET_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        // Track pending transaction in database
        const query = `INSERT INTO transactions (invoice_id, api_ref, phone_number, amount, state) VALUES ($1, $2, $3, $4, 'PENDING')`;
        await pool.query(query, [response.data.invoice_id || 'UNKNOWN', api_ref, phone_number, amount]);

        res.status(200).json({
            success: true,
            message: 'Payment prompt successfully sent to customer phone.',
            data: response.data
        });
    } catch (error) {
        console.error('IntaSend STK Push Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate payment transaction with IntaSend.',
            error: error.response?.data || error.message
        });
    }
});

// Secure Webhook Endpoint for IntaSend Notifications
app.post('/api/payment/webhook', async (req, res) => {
    const paymentData = req.body;
    
    try {
        console.log('IntaSend Live Payment Webhook Event Received:', JSON.stringify(paymentData, null, 2));

        if (paymentData.state === 'COMPLETE' || paymentData.status === 'COMPLETE') {
            const invoiceId = paymentData.invoice_id;
            const apiRef = paymentData.api_ref;
            const amountPaid = paymentData.value;

            // Update transaction status in PostgreSQL database
            const updateQuery = `UPDATE transactions SET state = 'COMPLETE' WHERE invoice_id = $1 OR api_ref = $2`;
            await pool.query(updateQuery, [invoiceId, apiRef]);

            console.log(`Payment confirmed and recorded for invoice ${invoiceId}, Ref: ${apiRef}, Amount: ${amountPaid}`);
        }

        res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error during webhook handling' });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Vortex Hotspot Server running on port ${port}`);
});
