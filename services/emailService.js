// services/emailService.js
const transporter = require('../config/mailer');
const { renderTemplate } = require('./emailTemplates');
const db = require('../config/db'); // adjust to your existing DB pool

/**
 * Core send function — logs to ss_email_log
 */
async function sendEmail({ to, subject, template, data = {}, replyTo }) {
  let logId = null;
  try {
    // 1. Insert queued log
    const [logResult] = await db.execute(
      `INSERT INTO ss_email_log (to_email, subject, template, status)
       VALUES (?, ?, ?, 'queued')`,
      [to, subject, template || null]
    );
    logId = logResult.insertId;

    // 2. Render HTML
    const html = await renderTemplate(template, data);

    // 3. Send
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
      replyTo: replyTo || process.env.SMTP_REPLY_TO,
    });

    // 4. Mark sent
    await db.execute(
      `UPDATE ss_email_log
         SET status='sent', sent_at=NOW(), message_id=?
       WHERE id=?`,
      [info.messageId, logId]
    );

    console.log(`📧 Sent [${template}] → ${to} (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`📧 Failed [${template}] → ${to}:`, err.message);
    if (logId) {
      await db.execute(
        `UPDATE ss_email_log SET status='failed', error=? WHERE id=?`,
        [err.message.slice(0, 1000), logId]
      ).catch(() => {});
    }
    return { ok: false, error: err.message };
  }
}

/* ── Convenience wrappers ─────────────────────────────── */

const sendWelcomeOwner = (owner) =>
  sendEmail({
    to: owner.email,
    subject: `Welcome to ${process.env.APP_NAME}, ${owner.contact_name}!`,
    template: 'welcome-owner',
    data: { owner },
  });

const sendWelcomeAttendant = (attendant, owner) =>
  sendEmail({
    to: attendant.email,
    subject: `You've been added to ${owner.company_name}`,
    template: 'welcome-attendant',
    data: { attendant, owner },
  });

const sendWelcomeCustomer = (customer, owner, plainPassword) =>
  sendEmail({
    to: customer.email,
    subject: `Welcome to ${owner.company_name}`,
    template: 'welcome-customer',
    data: { customer, owner, plainPassword },
  });

const sendPasswordReset = (user, resetUrl) =>
  sendEmail({
    to: user.email,
    subject: 'Reset your SpinSpring Express password',
    template: 'password-reset',
    data: { user, resetUrl },
  });

const sendOrderPlaced = (order, customer, owner) =>
  sendEmail({
    to: customer.email,
    subject: `Order ${order.order_number} received`,
    template: 'order-placed',
    data: { order, customer, owner },
  });

const sendOrderReady = (order, customer, owner) =>
  sendEmail({
    to: customer.email,
    subject: `Order ${order.order_number} is ready for pickup 🎉`,
    template: 'order-ready',
    data: { order, customer, owner },
  });

const sendOrderCompleted = (order, customer, owner) =>
  sendEmail({
    to: customer.email,
    subject: `Receipt for order ${order.order_number}`,
    template: 'order-completed',
    data: { order, customer, owner },
  });

const sendNewOrderToOwner = (order, customer, owner) =>
  sendEmail({
    to: owner.email,
    subject: `New order ${order.order_number} from ${customer.full_name}`,
    template: 'new-order-owner',
    data: { order, customer, owner },
  });
  


  const sendCustomerPasswordReset = (customer, owner, newPassword) =>
  sendEmail({
    to: customer.email,
    subject: `Your new password for ${owner.company_name}`,
    template: 'customer-password-reset',
    data: { customer, owner, newPassword },
  });


module.exports = {
  sendEmail,
  sendWelcomeOwner,
  sendWelcomeAttendant,
  sendWelcomeCustomer,
  sendPasswordReset,
  sendOrderPlaced,
  sendOrderReady,
  sendOrderCompleted,
  sendNewOrderToOwner,
};