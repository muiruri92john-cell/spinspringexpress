// =====================================================
// routes/public-locations.js — Public "find nearest" page
// =====================================================

const express = require('express');
const router = express.Router();
const LocationModel = require('../models/location');
const geo = require('../utils/geo');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── PUBLIC PAGE ─────────────────────────────────────
router.get('/find-location', (req, res) => {
  res.render('spinspring/find-location', {
    title: 'Find Nearest Branch - SpinSpring Express',
    user: req.session.spinUser || null,
  });
});

// ─── PUBLIC: LIST ALL ACTIVE LOCATIONS ───────────────
router.get('/api/public/locations', ah(async (req, res) => {
  const ownerId = parseInt(req.query.owner_id, 10) || 5;
  const model = new LocationModel(req.db);
  const locations = await model.listActive(ownerId);

  locations.forEach(l => {
    l.is_open_now = geo.isOpenNow(l);
  });

  res.json({ success: true, locations });
}));

// ─── PUBLIC: NEAREST BY COORDINATES ──────────────────
router.get('/api/public/locations/nearest', ah(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lng || req.query.lon);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({
      success: false,
      error: 'lat and lng query params required',
    });
  }

  const ownerId = parseInt(req.query.owner_id, 10) || 5;
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);

  const model = new LocationModel(req.db);
  const locations = await model.findNearest(ownerId, lat, lon, { limit });

  locations.forEach(l => {
    l.is_open_now = geo.isOpenNow(l);
  });

  res.json({ success: true, count: locations.length, locations });
}));

module.exports = router;