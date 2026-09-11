// =====================================================
// routes/reviews.js — Reviews & Ratings
// =====================================================

const express = require('express');
const router = express.Router();
const ReviewModel = require('../models/review');
const helper = require('../utils/reviewHelper');
const crypto = require('crypto');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Auth guards ──────────────────────────────────
function isAuth(req, res, next) {
  if (req.session.spinUser) return next();
  req.flash('error_msg', 'Please login first');
  res.redirect('/login');
}

function isOwner(req, res, next) {
  if (req.session.spinUser?.role === 'owner') return next();
  req.flash('error_msg', 'Owner access required');
  res.redirect('/login');
}

// ═══════════════════════════════════════════════════
// CUSTOMER — WRITE REVIEW (public, via code)
// ═══════════════════════════════════════════════════

router.get('/review/:code', ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const { code } = req.params;

  const request = await model.findRequestByCode(code);

  // If it's a request code → show review form
  if (request) {
    if (request.status === 'completed') {
      return res.render('spinspring/review-thanks', {
        title: 'Already Reviewed',
        message: 'You already submitted a review for this order. Thank you!',
        alreadyDone: true
      });
    }

    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      return res.render('spinspring/review-thanks', {
        title: 'Link Expired',
        message: 'This review link has expired. Please contact us directly.',
        alreadyDone: true
      });
    }

    // Look up order for context
    let order = null;
    if (request.order_id) {
      const [orders] = await req.db.query(
        `SELECT o.*, d.device_name, d.owner_id, d.location_id
         FROM ss_orders o
         LEFT JOIN ss_devices d ON o.device_id = d.device_id
         WHERE o.id = ? LIMIT 1`,
        [request.order_id]
      );
      if (orders.length) order = orders[0];
    }

    await model.markRequestClicked(code);

    return res.render('spinspring/review-form', {
      title: 'Leave a Review - SpinSpring Express',
      request,
      order,
      code
    });
  }

  // Otherwise try as a review code → show public review
  const review = await model.findByCode(code);
  if (review) {
    return res.redirect('/reviews');
  }

  return res.status(404).render('spinspring/error', {
    title: 'Not Found',
    message: 'Review link not found or expired'
  });
}));

// ─── Submit review ────────────────────────────────
router.post('/review/:code', ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const { code } = req.params;

  const request = await model.findRequestByCode(code);
  if (!request) {
    return res.status(404).json({ success: false, error: 'Invalid review code' });
  }
  if (request.status === 'completed') {
    return res.status(400).json({ success: false, error: 'Already reviewed' });
  }

  const { rating, title, comment, customer_name } = req.body;

  const ratingInt = parseInt(rating, 10);
  if (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
  }

  // Look up order + owner
  let order = null;
  let owner_id = null;
  let location_id = null;
  let device_id = null;

  if (request.order_id) {
    const [orders] = await req.db.query(
      `SELECT o.*, d.owner_id, d.location_id, d.device_id
       FROM ss_orders o
       LEFT JOIN ss_devices d ON o.device_id = d.device_id
       WHERE o.id = ? LIMIT 1`,
      [request.order_id]
    );
    if (orders.length) {
      order = orders[0];
      owner_id = order.owner_id;
      location_id = order.location_id;
      device_id = order.device_id;
    }
  }

  if (!owner_id) {
    return res.status(400).json({ success: false, error: 'Order not found' });
  }

  // Sanitize
  const cleanTitle = (title || '').trim().slice(0, 200);
  const cleanComment = (comment || '').trim().slice(0, 2000);
  const cleanName = (customer_name || request.customer_name || 'Anonymous').trim().slice(0, 100);

  // Create review
  const { id, code: reviewCode } = await model.create({
    owner_id,
    location_id,
    device_id,
    order_id: request.order_id,
    customer_name: cleanName,
    customer_email: request.customer_email,
    customer_phone: request.customer_phone,
    rating: ratingInt,
    title: cleanTitle || null,
    comment: cleanComment || null,
    service_type: order?.service_type || null,
    is_verified: 1,
    status: 'pending',
    ip_address: req.ip,
    user_agent: (req.headers['user-agent'] || '').slice(0, 500),
    source: request.channel === 'sms' ? 'sms' : (request.channel === 'whatsapp' ? 'whatsapp' : 'web')
  });

  await model.markRequestCompleted(code);

  res.json({
    success: true,
    review_code: reviewCode,
    message: 'Thank you for your review!'
  });
}));

// ─── Direct review (no request code) ──────────────
router.get('/reviews/new', (req, res) => {
  res.render('spinspring/review-form', {
    title: 'Leave a Review - SpinSpring Express',
    request: null,
    order: null,
    code: null
  });
});

// ═══════════════════════════════════════════════════
// PUBLIC REVIEWS PAGE
// ═══════════════════════════════════════════════════

router.get('/reviews', ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = parseInt(req.query.owner_id, 10) || 5;
  const locationId = req.query.location_id ? parseInt(req.query.location_id, 10) : null;

  const reviews = await model.listPublic(ownerId, {
    locationId,
    limit: 50,
    featuredOnly: false,
    minRating: null
  });

  const stats = await model.statsByOwner(ownerId);

  res.render('spinspring/reviews-public', {
    title: 'Customer Reviews - SpinSpring Express',
    user: req.session.spinUser || null,
    reviews,
    stats,
    helper,
    ownerId,
    locationId
  });
}));

// ═══════════════════════════════════════════════════
// OWNER DASHBOARD
// ═══════════════════════════════════════════════════

router.get('/owner/reviews', isOwner, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = req.session.spinUser.id;

  const filters = {
    status: req.query.status || 'all',
    rating: req.query.rating || 'all',
    location_id: req.query.location_id || null,
    search: req.query.search || null
  };

  const reviews = await model.listByOwner(ownerId, filters);
  const stats = await model.statsByOwner(ownerId);
  const byLocation = await model.statsByLocation(ownerId);

  // Locations for filter dropdown
  const [locations] = await req.db.query(
    'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name',
    [ownerId]
  );

  res.render('spinspring/reviews-owner', {
    title: 'Reviews - SpinSpring Express',
    user: req.session.spinUser,
    reviews,
    stats,
    byLocation,
    locations,
    filters,
    helper
  });
}));

// ─── Approve / reject / hide ──────────────────────
router.post('/owner/reviews/:id/status', isOwner, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const { status, notes } = req.body;
  const ownerId = req.session.spinUser.id;

  await model.updateStatus(
    parseInt(req.params.id, 10),
    ownerId,
    status,
    notes || null,
    ownerId
  );

  // If AJAX, return JSON
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true, status });
  }

  req.flash('success_msg', `Review ${status}`);
  res.redirect('/owner/reviews');
}));

// ─── Toggle featured ──────────────────────────────
router.post('/owner/reviews/:id/feature', isOwner, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = req.session.spinUser.id;

  await model.toggleFeatured(parseInt(req.params.id, 10), ownerId);

  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }

  req.flash('success_msg', 'Featured status updated');
  res.redirect('/owner/reviews');
}));

// ─── Reply to review ──────────────────────────────
router.post('/owner/reviews/:id/reply', isOwner, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = req.session.spinUser.id;
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ success: false, error: 'Reply cannot be empty' });
  }

  await model.reply(
    parseInt(req.params.id, 10),
    ownerId,
    reply.trim().slice(0, 2000),
    ownerId
  );

  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ success: true });
  }

  req.flash('success_msg', 'Reply posted');
  res.redirect('/owner/reviews');
}));

// ─── Delete reply ─────────────────────────────────
router.post('/owner/reviews/:id/reply/delete', isOwner, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = req.session.spinUser.id;

  await model.deleteReply(parseInt(req.params.id, 10), ownerId);

  req.flash('success_msg', 'Reply removed');
  res.redirect('/owner/reviews');
}));

// ═══════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════

// Get public reviews for landing page
router.get('/api/reviews', ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const ownerId = parseInt(req.query.owner_id, 10) || 5;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const reviews = await model.listPublic(ownerId, {
    limit,
    featuredOnly: req.query.featured === '1'
  });

  const stats = await model.statsByOwner(ownerId);

  res.json({
    success: true,
    reviews,
    stats: {
      avg_rating: parseFloat(stats.avg_rating) || 0,
      total: stats.total || 0,
      five_star: stats.five_star || 0,
      four_star: stats.four_star || 0,
      three_star: stats.three_star || 0,
      two_star: stats.two_star || 0,
      one_star: stats.one_star || 0
    }
  });
}));

// Mark helpful
router.post('/api/reviews/:id/helpful', ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  await model.markHelpful(parseInt(req.params.id, 10));
  res.json({ success: true });
}));

// ═══════════════════════════════════════════════════
// HOOK: Called when order completes → queue review request
// (import this from your order-complete handler)
// ═══════════════════════════════════════════════════

router.post('/api/orders/:id/request-review', isAuth, ah(async (req, res) => {
  const model = new ReviewModel(req.db);
  const orderId = parseInt(req.params.id, 10);

  const [orders] = await req.db.query(
    'SELECT * FROM ss_orders WHERE id = ? LIMIT 1',
    [orderId]
  );
  if (!orders.length) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  const order = orders[0];

  const { code } = await model.createRequest({
    order_id: orderId,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone || null,
    customer_email: order.customer_email || null,
    channel: 'whatsapp'
  });

  const reviewUrl = helper.buildReviewUrl(code);
  const waMessage = helper.buildWhatsAppMessage({
    customerName: order.customer_name,
    businessName: 'SpinSpring Express',
    reviewUrl,
    orderNumber: order.order_number
  });

  // Queue for sending (or send immediately if you have SMS/WA set up)
  await model.markRequestSent(code);

  res.json({
    success: true,
    review_code: code,
    review_url: reviewUrl,
    whatsapp_url: `https://wa.me/${(order.customer_phone || '').replace(/\D/g, '')}?text=${waMessage}`
  });
}));

module.exports = router;