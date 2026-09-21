// services/pushService.js — Web Push via VAPID
const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@spinspringexpress.co.ke',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('✅ Web Push VAPID configured');
} else {
  console.warn('⚠️  VAPID keys missing — push notifications disabled');
}

async function sendToSubscription(sub, payload, db) {
  try {
    const data = JSON.stringify(payload);
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      data,
      { TTL: 60 * 60 * 24 }
    );
    if (db && sub.id) {
      await db.execute(
        'UPDATE ss_push_subscriptions SET last_used_at = NOW() WHERE id = ?',
        [sub.id]
      ).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      if (db && sub.id) {
        await db.execute(
          'UPDATE ss_push_subscriptions SET is_active = 0 WHERE id = ?',
          [sub.id]
        ).catch(() => {});
      }
      return { ok: false, expired: true, error: err.message };
    }
    console.error('📲 Push failed:', err.statusCode, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendToUser(userType, userId, payload, db) {
  if (!db) return { ok: false, error: 'db required' };

  const [subs] = await db.execute(
    `SELECT id, endpoint, p256dh, auth
     FROM ss_push_subscriptions
     WHERE user_type = ? AND user_id = ? AND is_active = 1`,
    [userType, userId]
  );

  if (subs.length === 0) return { ok: true, sent: 0, expired: 0 };

  let sent = 0, expired = 0, failed = 0;
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload, db);
    if (result.ok) sent++;
    else if (result.expired) expired++;
    else failed++;
  }

  console.log(`📲 Push to ${userType}#${userId}: ${sent} sent, ${expired} expired, ${failed} failed`);
  return { ok: true, sent, expired, failed, total: subs.length };
}

const notifyCustomer = (customerId, payload, db) =>
  sendToUser('customer', customerId, payload, db);

const notifyOwner = (ownerId, payload, db) =>
  sendToUser('owner', ownerId, payload, db);

const notifyAttendant = (attendantId, payload, db) =>
  sendToUser('attendant', attendantId, payload, db);

async function notifyAllAttendants(ownerId, payload, db) {
  if (!db) return { ok: false, error: 'db required' };
  const [attendants] = await db.execute(
    'SELECT id FROM ss_attendants WHERE owner_id = ? AND is_active = 1',
    [ownerId]
  );
  for (const att of attendants) {
    await notifyAttendant(att.id, payload, db);
  }
  return { ok: true, notified: attendants.length };
}

module.exports = {
  sendToSubscription,
  sendToUser,
  notifyCustomer,
  notifyOwner,
  notifyAttendant,
  notifyAllAttendants,
};
