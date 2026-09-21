// routes/push.js — Push notification API
const express = require('express');
const router = express.Router();

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// GET /api/push/public-key — safe to expose
router.get('/api/push/public-key', (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
    enabled: !!process.env.VAPID_PUBLIC_KEY,
  });
});

// POST /api/push/subscribe — requires auth
router.post('/api/push/subscribe', ah(async (req, res) => {
  const user = req.session.spinUser;
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ ok: false, error: 'Invalid subscription' });
  }

  const userType = user.role;
  const userId = user.id;

  try {
    await req.db.execute(
      `INSERT INTO ss_push_subscriptions
       (user_type, user_id, endpoint, p256dh, auth, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         user_type = VALUES(user_type),
         user_id = VALUES(user_id),
         p256dh = VALUES(p256dh),
         auth = VALUES(auth),
         user_agent = VALUES(user_agent),
         is_active = 1,
         last_used_at = NOW()`,
      [userType, userId, endpoint, keys.p256dh, keys.auth, (req.headers['user-agent'] || '').slice(0, 500)]
    );

    console.log(`📲 Subscribed ${userType}#${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Subscribe failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}));

// POST /api/push/unsubscribe
router.post('/api/push/unsubscribe', ah(async (req, res) => {
  const user = req.session.spinUser;
  if (!user) return res.status(401).json({ ok: false });

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ ok: false, error: 'Missing endpoint' });

  await req.db.execute(
    'UPDATE ss_push_subscriptions SET is_active = 0 WHERE endpoint = ? AND user_type = ? AND user_id = ?',
    [endpoint, user.role, user.id]
  );

  res.json({ ok: true });
}));

// POST /api/push/test — send test to current user
router.post('/api/push/test', ah(async (req, res) => {
  const user = req.session.spinUser;
  if (!user) return res.status(401).json({ ok: false });

  const { sendToUser } = require('../services/pushService');
  const result = await sendToUser(user.role, user.id, {
    title: '✅ Push works!',
    body: 'You will now receive order notifications.',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'test',
    data: { url: '/' },
  }, req.db);

  res.json(result);
}));

module.exports = router;
