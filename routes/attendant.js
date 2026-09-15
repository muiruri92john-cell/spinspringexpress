// =====================================================
// routes/attendant.js — Attendant routes
// =====================================================

const express = require('express');
const router = express.Router();
const AttendantModel = require('../models/attendant');
const CustomerModel = require('../models/customer');
const OrderModel = require('../models/order');
const bcrypt = require('bcryptjs');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isAttendant(req, res, next) {
  const role = req.session.spinUser?.role;
  if (role === 'attendant' || role === 'owner') return next();
  req.flash('error_msg', 'Attendant access required');
  return res.redirect('/attendant-login');
}

// ═══════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════

router.get('/attendant-login', (req, res) => {
  if (req.session.spinUser?.role === 'attendant') return res.redirect('/attendant');
  res.render('spinspring/attendant-login', {
    title: 'Attendant Login - SpinSpring Express',
    user: null
  });
});

router.post('/attendant-login', ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  const { email, pin_code } = req.body;

  if (!email || !pin_code) {
    req.flash('error_msg', 'Email and PIN required');
    return res.redirect('/attendant-login');
  }

  const attendant = await model.verifyPin(email, pin_code);
  if (!attendant) {
    req.flash('error_msg', 'Invalid email or PIN');
    return res.redirect('/attendant-login');
  }

  req.session.spinUser = {
    id: attendant.id,
    role: 'attendant',
    email: attendant.email,
    name: attendant.full_name,
    ownerId: attendant.owner_id,
    ownerCompany: attendant.owner_company,
    locationId: attendant.location_id
  };

  req.flash('success_msg', `Welcome back, ${attendant.full_name}!`);
  res.redirect('/attendant');
}));

// ═══════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════

router.get('/attendant', isAttendant, ah(async (req, res) => {
  const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
  const customerModel = new CustomerModel(req.db);
  const orderModel = new OrderModel(req.db);

  const [devices] = await req.db.query(
    'SELECT * FROM ss_devices WHERE owner_id = ? ORDER BY device_name',
    [ownerId]
  );
  const [customers] = await req.db.query(
    'SELECT id, customer_unique_id, full_name, phone, email FROM ss_customers WHERE owner_id = ? AND is_active = 1 ORDER BY full_name',
    [ownerId]
  );
  const [activeOrders] = await req.db.query(
    `SELECT o.*, c.full_name AS customer_name, d.device_name
     FROM ss_orders o
     LEFT JOIN ss_customers c ON o.customer_id = c.id
     LEFT JOIN ss_devices d ON o.device_id = d.device_id
     WHERE o.owner_id = ? AND o.order_status IN ('pending','queued','in_progress')
     ORDER BY o.created_at DESC`,
    [ownerId]
  );

  const [stats] = await req.db.query(
    `SELECT 
      COUNT(*) AS total_orders,
      SUM(order_status IN ('pending','queued','in_progress')) AS active_orders,
      SUM(order_status = 'completed') AS completed_orders,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN price ELSE 0 END), 0) AS today_revenue
     FROM ss_orders WHERE owner_id = ? AND DATE(created_at) = CURDATE()`,
    [ownerId]
  );

  res.render('spinspring/attendant-dashboard', {
    title: 'Attendant Dashboard - SpinSpring Express',
    user: req.session.spinUser,
    devices,
    customers,
    activeOrders,
    stats: stats[0] || {}
  });
}));

// ═══════════════════════════════════════════════════
// ATTENDANT — ADD CUSTOMER
// ═══════════════════════════════════════════════════

router.post('/attendant/customers', isAttendant, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const ownerId = req.session.spinUser.ownerId;
  const { full_name, email, phone, address, password } = req.body;

  if (!full_name || !email || !phone) {
    req.flash('error_msg', 'Name, email, and phone are required');
    return res.redirect('/attendant');
  }

  const existing = await model.findByEmail(email);
  if (existing) {
    req.flash('error_msg', 'Email already registered');
    return res.redirect('/attendant');
  }

  try {
    const plainPassword = password && password.length >= 6
      ? password
      : Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(plainPassword, 10);

    const { customer_unique_id } = await model.create(ownerId, {
      full_name, email, phone, address,
      location_id: req.session.spinUser.locationId || null
    }, hash);

    req.flash('success_msg',
      `✅ Customer "${full_name}" created. ID: ${customer_unique_id}` +
      (password ? '' : ` — Password: ${plainPassword}`)
    );
    res.redirect('/attendant');
  } catch (e) {
    console.error(e);
    req.flash('error_msg', 'Failed to create customer: ' + e.message);
    res.redirect('/attendant');
  }
}));

// ═══════════════════════════════════════════════════
// ATTENDANT — CREATE ORDER
// ═══════════════════════════════════════════════════

router.post('/attendant/orders', isAttendant, ah(async (req, res) => {
  const model = new OrderModel(req.db);
  const ownerId = req.session.spinUser.ownerId;
  const { customer_id, device_id, service_type, cycle_type, price, weight_kg } = req.body;

  if (!customer_id) {
    req.flash('error_msg', 'Customer is required');
    return res.redirect('/attendant');
  }

  // Verify customer belongs to this owner
  const [customers] = await req.db.query(
    'SELECT id FROM ss_customers WHERE id = ? AND owner_id = ?',
    [customer_id, ownerId]
  );
  if (!customers.length) {
    req.flash('error_msg', 'Invalid customer');
    return res.redirect('/attendant');
  }

  // Get device location
  let location_id = null;
  if (device_id) {
    const [devices] = await req.db.query(
      'SELECT location_id FROM ss_devices WHERE device_id = ? AND owner_id = ?',
      [device_id, ownerId]
    );
    if (devices.length) location_id = devices[0].location_id;
  }

  try {
    const { order_number } = await model.create({
      owner_id: ownerId,
      customer_id,
      device_id: device_id || null,
      location_id,
      service_type: service_type || 'wash',
      cycle_type: cycle_type || 'normal',
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      price: parseFloat(price) || 0,
      payment_status: 'pending',
      order_status: 'pending'
    });

    req.flash('success_msg', `✅ Order ${order_number} created`);
    res.redirect('/attendant');
  } catch (e) {
    console.error(e);
    req.flash('error_msg', 'Failed to create order: ' + e.message);
    res.redirect('/attendant');
  }
}));

// ═══════════════════════════════════════════════════
// ATTENDANT — UPDATE ORDER STATUS
// ═══════════════════════════════════════════════════

router.post('/attendant/orders/:id/status', isAttendant, ah(async (req, res) => {
  const model = new OrderModel(req.db);
  const ownerId = req.session.spinUser.ownerId;
  const { status } = req.body;

  await model.updateStatus(parseInt(req.params.id, 10), ownerId, status);
  req.flash('success_msg', 'Order status updated');
  res.redirect('/attendant');
}));

router.post('/attendant/orders/:id/payment', isAttendant, ah(async (req, res) => {
  const model = new OrderModel(req.db);
  const ownerId = req.session.spinUser.ownerId;
  const { status } = req.body;

  await model.updatePayment(parseInt(req.params.id, 10), ownerId, status);
  req.flash('success_msg', 'Payment status updated');
  res.redirect('/attendant');
}));

// ═══════════════════════════════════════════════════
// ATTENDANT — LOGOUT
// ═══════════════════════════════════════════════════

router.get('/attendant-logout', (req, res) => {
  delete req.session.spinUser;
  req.flash('success_msg', 'Logged out');
  res.redirect('/attendant-login');
});

module.exports = router;