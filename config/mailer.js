// config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool: true,               // reuse connections
  maxConnections: 3,
  maxMessages: 100,
  connectionTimeout: 10000, // 10s
  greetingTimeout: 10000,
  socketTimeout: 20000,
  tls: {
    // cPanel often uses a shared cert; don't hard-fail on hostname mismatch
    rejectUnauthorized: false,
  },
});

// Verify on startup (non-fatal)
transporter.verify()
  .then(() => console.log('✅ SMTP ready:', process.env.SMTP_HOST))
  .catch((err) => console.error('❌ SMTP verify failed:', err.message));

module.exports = transporter;