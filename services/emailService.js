// services/emailService.js
const fs = require('fs');
const transporter = require('../config/mailer');
const { renderTemplate } = require('./emailTemplates');

const LOG_FILE = '/home/buxbtreu/spinspringexpress/email-debug.log';

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
  console.log(msg);
}

/**
 * Core send — accepts optional `db` connection for audit logging.
 * If `db` is not provided, email still sends but is not logged to DB.
 */
async function sendEmail({ to, subject, template, data = {}, replyTo, db }) {
  let logId = null;
  logLine(`▶ attempt [${template}] → ${to}`);

  try {
    if (db) {
      const [logResult] = await db.execute(
        `INSERT INTO ss_email_log (to_email, subject, template, status)
         VALUES (?, ?, ?, 'queued')`,
        [to, subject, template || null]
      );
      logId = logResult.insertId;
      logLine(`  ↳ queued logId=${logId}`);
    }

    logLine(`  ↳ rendering template`);
    const html = await renderTemplate(template, data);
    logLine(`  ↳ template rendered (${html.length} bytes)`);

    logLine(`  ↳ calling SMTP`);
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
      replyTo: replyTo || process.env.SMTP_REPLY_TO,
    });

    if (db && logId) {
      await db.execute(
        `UPDATE ss_email_log SET status='sent', sent_at=NOW(), message_id=? WHERE id=?`,
        [info.messageId, logId]
      );
    }

    logLine(`  ✅ SENT [${template}] → ${to} (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    logLine(`  ❌ FAILED [${template}] → ${to}: ${err.message}`);
    if (db && logId) {
      await db.execute(
        `UPDATE ss_email_log SET status='failed', error=? WHERE id=?`,
        [err.message.slice(0, 1000), logId]
      ).catch(() => {});
    }
    return { ok: false, error: err.message };
  }
}

/* ── Wrappers — db is optional last parameter ─────────── */

const sendWelcomeOwner = (owner, db) =>
  sendEmail({
    to: owner.email,
    subject: `Welcome to ${process.env.APP_NAME || 'SpinSpring Express'}, ${owner.contact_name}!`,
    template: 'welcome-owner',
    data: { owner },
    db,
  });

const sendWelcomeAttendant = (attendant, owner, db) =>
  sendEmail({
    to: attendant.email,
    subject: `You've been added to ${owner.company_name}`,
    template: 'welcome-attendant',
    data: { attendant, owner },
    db,
  });

const sendWelcomeCustomer = (customer, owner, plainPassword, db) =>
  sendEmail({
    to: customer.email,
    subject: `Welcome to ${owner.company_name}`,
    template: 'welcome-customer',
    data: { customer, owner, plainPassword },
    db,
  });

const sendCustomerPasswordReset = (customer, owner, newPassword, db) =>
  sendEmail({
    to: customer.email,
    subject: `Your new password for ${owner.company_name}`,
    template: 'customer-password-reset',
    data: { customer, owner, newPassword },
    db,
  });

const sendPasswordReset = (user, resetUrl, db) =>
  sendEmail({
    to: user.email,
    subject: 'Reset your SpinSpring Express password',
    template: 'password-reset',
    data: { user, resetUrl },
    db,
  });

const sendOrderPlaced = (order, customer, owner, db) =>
  sendEmail({
    to: customer.email,
    subject: `Order ${order.order_number} received`,
    template: 'order-placed',
    data: { order, customer, owner },
    db,
  });

const sendOrderReady = (order, customer, owner, db) =>
  sendEmail({
    to: customer.email,
    subject: `Order ${order.order_number} is ready for pickup`,
    template: 'order-ready',
    data: { order, customer, owner },
    db,
  });

const sendOrderCompleted = (order, customer, owner, db) =>
  sendEmail({
    to: customer.email,
    subject: `Receipt for order ${order.order_number}`,
    template: 'order-completed',
    data: { order, customer, owner },
    db,
  });

const sendNewOrderToOwner = (order, customer, owner, db) =>
  sendEmail({
    to: owner.email,
    subject: `New order ${order.order_number} from ${customer.full_name}`,
    template: 'new-order-owner',
    data: { order, customer, owner },
    db,
  });

const sendNewOrderToAttendant = (order, customer, owner, attendant, db) =>
  sendEmail({
    to: attendant.email,
    subject: `New order ${order.order_number} assigned`,
    template: 'new-order-attendant',
    data: { order, customer, owner, attendant },
    db,
  });

module.exports = {
  sendEmail,
  sendWelcomeOwner,
  sendWelcomeAttendant,
  sendWelcomeCustomer,
  sendCustomerPasswordReset,
  sendPasswordReset,
  sendOrderPlaced,
  sendOrderReady,
  sendOrderCompleted,
  sendNewOrderToOwner,
  sendNewOrderToAttendant,
};
