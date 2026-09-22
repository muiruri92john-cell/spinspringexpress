// routes/riders.js — Rider routes
const express = require('express');
const router = express.Router();
const RiderModel = require('../models/rider');
const DeliveryRequestModel = require('../models/deliveryRequest');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isRider(req, res, next) {
  const role = req.session.spinUser?.role;
  if (role === 'rider') return next();
  req.flash('error_msg', 'Rider access required');
  return res.redirect('/rider-login');
}

// ─────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────

router.get('/rider-login', (req, res) => {
  if (req.session.spinUser?.role === 'rider') return res.redirect('/rider');
  res.render('spinspring/rider-login', {
    title: 'Rider Login - SpinSpring Express',
    user: null,
  });
});

router.post('/rider-login', ah(async (req, res) => {
  const model = new RiderModel(req.db);
  const { phone, pin_code } = req.body;

  if (!phone || !pin_code) {
    req.flash('error_msg', 'Phone and PIN required');
    return res.redirect('/rider-login');
  }

  const rider = await model.verifyPin(phone, pin_code);
  if (!rider) {
    req.flash('error_msg', 'Invalid phone or PIN');
    return res.redirect('/rider-login');
  }

  req.session.spinUser = {
    id: rider.id,
    role: 'rider',
    phone: rider.phone,
    name: rider.full_name,
    ownerId: rider.owner_id,
    ownerCompany: rider.owner_company,
  };

  req.flash('success_msg', `Welcome, ${rider.full_name}!`);
  res.redirect('/rider');
}));

// ─────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────

router.get('/rider', isRider, ah(async (req, res) => {
  const riderId = req.session.spinUser.id;
  const ownerId = req.session.spinUser.ownerId;

  const riderModel = new RiderModel(req.db);
  const drModel = new DeliveryRequestModel(req.db);

  const rider = await riderModel.findById(riderId);
  const pending = await drModel.listPendingForRider(riderId, ownerId);
  const active = await drModel.listActiveForRider(riderId);

  res.render('spinspring/rider-dashboard', {
    title: 'Rider - SpinSpring Express',
    user: req.session.spinUser,
    rider,
    pending,
    active,
  });
}));

// ─────────────────────────────────────────────────────
// AVAILABILITY TOGGLE
// ─────────────────────────────────────────────────────

router.post('/rider/availability', isRider, ah(async (req, res) => {
  const model = new RiderModel(req.db);
  const { available } = req.body;
  await model.setAvailability(req.session.spinUser.id, available === '1' || available === true);
  res.json({ ok: true, available: !!available });
}));

// ─────────────────────────────────────────────────────
// LOCATION UPDATE (called by rider app every 30s)
// ─────────────────────────────────────────────────────

router.post('/rider/location', isRider, ah(async (req, res) => {
  const model = new RiderModel(req.db);
  const { lat, lng, accuracy } = req.body;

  if (!lat || !lng) return res.status(400).json({ ok: false, error: 'lat/lng required' });

  await model.updateLocation(req.session.spinUser.id, lat, lng, accuracy);
  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────
// REQUEST ACTIONS
// ─────────────────────────────────────────────────────

router.post('/rider/requests/:id/accept', isRider, ah(async (req, res) => {
  const model = new DeliveryRequestModel(req.db);
  const result = await model.accept(parseInt(req.params.id, 10), req.session.spinUser.id);

  if (result.changed) {
    req.flash('success_msg', 'Request accepted');
  } else {
    req.flash('error_msg', 'Could not accept — may have been reassigned');
  }
  res.redirect('/rider');
}));

router.post('/rider/requests/:id/decline', isRider, ah(async (req, res) => {
  const model = new DeliveryRequestModel(req.db);
  const { reason } = req.body;
  await model.decline(parseInt(req.params.id, 10), req.session.spinUser.id, reason || null);

  // Auto-reassign to next candidate
  try {
    const { reassign } = require('../services/deliveryService');
    await reassign(req.db, parseInt(req.params.id, 10));
  } catch (e) { console.error('reassign failed:', e.message); }

  req.flash('success_msg', 'Request declined');
  res.redirect('/rider');
}));

router.post('/rider/requests/:id/picked-up', isRider, ah(async (req, res) => {
  const model = new DeliveryRequestModel(req.db);
  await model.markPickedUp(parseInt(req.params.id, 10), req.session.spinUser.id);
  req.flash('success_msg', 'Marked as picked up');
  res.redirect('/rider');
}));

router.post('/rider/requests/:id/in-transit', isRider, ah(async (req, res) => {
  const model = new DeliveryRequestModel(req.db);
  await model.markInTransit(parseInt(req.params.id, 10), req.session.spinUser.id);
  req.flash('success_msg', 'Marked in transit');
  res.redirect('/rider');
}));

router.post('/rider/requests/:id/delivered', isRider, ah(async (req, res) => {
  const model = new DeliveryRequestModel(req.db);
  const riderModel = new RiderModel(req.db);
  const { final_fee } = req.body;

  const result = await model.markDelivered(
    parseInt(req.params.id, 10),
    req.session.spinUser.id,
    final_fee ? parseFloat(final_fee) : null
  );

  if (result.changed) {
    // Record earnings on rider profile
    const reqRow = await model.findById(parseInt(req.params.id, 10));
    await riderModel.recordDelivery(
      req.session.spinUser.id,
      reqRow.final_fee || reqRow.negotiated_fee || reqRow.quoted_fee || 0
    );
  }

  req.flash('success_msg', 'Delivery completed');
  res.redirect('/rider');
}));

// ─────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────

router.get('/rider-logout', (req, res) => {
  delete req.session.spinUser;
  req.flash('success_msg', 'Logged out');
  res.redirect('/rider-login');
});

module.exports = router;
