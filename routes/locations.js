const express = require('express');
const router = express.Router();
const LocationModel = require('../models/location');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isOwner(req, res, next) {
  if (req.session.spinUser?.role === 'owner') return next();
  req.flash('error_msg', 'Owner access required');
  res.redirect('/login');
}

// ─── LIST ────────────────────────────────────────────
router.get('/owner/locations', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  const ownerId = req.session.spinUser.id;

  const locations = await model.listByOwner(ownerId);
  const stats = await model.statsByOwner(ownerId);

  // Merge stats into locations
  const statsMap = Object.fromEntries(stats.map(s => [s.id, s]));
  locations.forEach(l => {
    l.stats = statsMap[l.id] || {
      device_count: 0, today_revenue: 0, total_revenue: 0, total_cycles: 0
    };
  });

  res.render('spinspring/locations-list', {
    title: 'Locations - SpinSpring Express',
    user: req.session.spinUser,
    locations,
  });
}));

// ─── NEW FORM ────────────────────────────────────────
router.get('/owner/locations/new', isOwner, (req, res) => {
  res.render('spinspring/location-form', {
    title: 'New Location - SpinSpring Express',
    user: req.session.spinUser,
    location: null,
    isEdit: false,
  });
});

// ─── CREATE ──────────────────────────────────────────
router.post('/owner/locations', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  const ownerId = req.session.spinUser.id;

  if (!req.body.location_name || !req.body.address_line1) {
    req.flash('error_msg', 'Location name and address are required');
    return res.redirect('/owner/locations/new');
  }

  try {
    const { id, code } = await model.create(ownerId, req.body);

    // If set as primary, unset all others
    if (req.body.is_primary === 'on') {
      await model.setPrimary(id, ownerId);
    }

    req.flash('success_msg', `Location "${req.body.location_name}" created (${code})`);
    res.redirect('/owner/locations');
  } catch (e) {
    console.error('Location create error:', e);
    req.flash('error_msg', 'Failed to create location: ' + e.message);
    res.redirect('/owner/locations/new');
  }
}));

// ─── EDIT FORM ───────────────────────────────────────
router.get('/owner/locations/:id/edit', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  const location = await model.findById(req.params.id);

  if (!location || location.owner_id !== req.session.spinUser.id) {
    req.flash('error_msg', 'Location not found');
    return res.redirect('/owner/locations');
  }

  res.render('spinspring/location-form', {
    title: 'Edit Location - SpinSpring Express',
    user: req.session.spinUser,
    location,
    isEdit: true,
  });
}));

// ─── UPDATE ──────────────────────────────────────────
router.post('/owner/locations/:id', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  const ownerId = req.session.spinUser.id;

  const location = await model.findById(req.params.id);
  if (!location || location.owner_id !== ownerId) {
    req.flash('error_msg', 'Location not found');
    return res.redirect('/owner/locations');
  }

  const data = { ...req.body };
  if (data.is_primary === 'on') {
    await model.setPrimary(req.params.id, ownerId);
    delete data.is_primary;
  }

  await model.update(req.params.id, ownerId, data);
  req.flash('success_msg', 'Location updated');
  res.redirect('/owner/locations');
}));

// ─── SET PRIMARY ─────────────────────────────────────
router.post('/owner/locations/:id/primary', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  await model.setPrimary(req.params.id, req.session.spinUser.id);
  req.flash('success_msg', 'Primary location updated');
  res.redirect('/owner/locations');
}));

// ─── DELETE (soft) ───────────────────────────────────
router.post('/owner/locations/:id/delete', isOwner, ah(async (req, res) => {
  const model = new LocationModel(req.db);
  await model.softDelete(req.params.id, req.session.spinUser.id);
  req.flash('success_msg', 'Location deactivated');
  res.redirect('/owner/locations');
}));

// ─── API: JSON list for dropdowns ────────────────────
router.get('/api/locations', ah(async (req, res) => {
  if (!req.session.spinUser) {
    return res.status(401).json({ success: false, error: 'Not logged in' });
  }

  const model = new LocationModel(req.db);
  const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
  const locations = await model.listActive(ownerId);

  res.json({ success: true, locations });
}));

// ─── API: Nearest location ───────────────────────────
router.get('/api/locations/nearest', ah(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lng || req.query.lon);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({
      success: false,
      error: 'lat and lng query params required'
    });
  }

  // Public search — use owner_id from query (or default)
  const ownerId = parseInt(req.query.owner_id, 10) || 1;

  const model = new LocationModel(req.db);
  const locations = await model.findNearest(ownerId, lat, lon, { limit: 10 });

  // Enrich with open/closed status
  const geo = require('../utils/geo');
  locations.forEach(l => {
    l.is_open_now = geo.isOpenNow(l);
  });

  res.json({ success: true, locations });
}));

module.exports = router;