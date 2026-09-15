// =====================================================
// routes/customer.js — Customer routes
// =====================================================

const express = require('express');
const router = express.Router();
const CustomerModel = require('../models/customer');
const OrderModel = require('../models/order');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isCustomer(req, res, next) {
  if (req.session.spinUser?.role === 'customer') return next();
  req.flash('error_msg', 'Customer access required');
  return res.redirect('/customer-login');
}

// ═══════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════

router.get('/customer-login', (req, res) => {
  if (req.session.spinUser?.role === 'customer') return res.redirect('/customer');
  res.render('spinspring/customer-login', {
    title: 'Customer Login - SpinSpring Express',
    user: null
  });
});

router.post('/customer-login', ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error_msg', 'Email and password required');
    return res.redirect('/customer-login');
  }

  const customer = await model.verifyPassword(email, password);
  if (!customer) {
    req.flash('error_msg', 'Invalid credentials');
    return res.redirect('/customer-login');
  }

  req.session.spinUser = {
    id: customer.id,
    role: 'customer',
    email: customer.email,
    name: customer.full_name,
    customerId: customer.customer_unique_id,
    ownerId: customer.owner_id,
    ownerCompany: customer.owner_company
  };

  req.flash('success_msg', `Welcome, ${customer.full_name}!`);
  res.redirect('/customer');
}));

// ═══════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════

router.get('/customer', isCustomer, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const orderModel = new OrderModel(req.db);
  const customerId = req.session.spinUser.id;
  const ownerId = req.session.spinUser.ownerId;

  const customer = await model.findById(customerId, ownerId);
  const stats = await model.getStats(customerId);
  const orders = await model.getOrders(customerId, 20);
  const activeOrders = await model.getActiveOrders(customerId);

  // Available devices at owner's branches
  const [devices] = await req.db.query(
    'SELECT device_id, device_name, location_id FROM ss_devices WHERE owner_id = ? ORDER BY device_name',
    [ownerId]
  );

  // Locations for display
  const [locations] = await req.db.query(
    'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1',
    [ownerId]
  );

  res.render('spinspring/customer-dashboard', {
    title: 'My Dashboard - SpinSpring Express',
    user: req.session.spinUser,
    customer: customer || {},
    stats,
    orders,
    activeOrders,
    devices,
    locations
  });
}));

// ═══════════════════════════════════════════════════
// CUSTOMER — PLACE ORDER
// ═══════════════════════════════════════════════════

router.post('/customer/orders', isCustomer, ah(async (req, res) => {
  const model = new OrderModel(req.db);
  const customerId = req.session.spinUser.id;
  const ownerId = req.session.spinUser.ownerId;
  const { device_id, service_type, cycle_type, weight_kg, price, notes } = req.body;

  try {
    let location_id = null;
    if (device_id) {
      const [devices] = await req.db.query(
        'SELECT location_id FROM ss_devices WHERE device_id = ? AND owner_id = ?',
        [device_id, ownerId]
      );
      if (devices.length) location_id = devices[0].location_id;
    }

    const { order_number } = await model.create({
      owner_id: ownerId,
      customer_id: customerId,
      device_id: device_id || null,
      location_id,
      service_type: service_type || 'wash',
      cycle_type: cycle_type || 'normal',
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      price: parseFloat(price) || 0,
      payment_status: 'pending',
      order_status: 'pending',
      notes: notes || null
    });

    req.flash('success_msg', `✅ Order ${order_number} placed! We'll be in touch.`);
    res.redirect('/customer');
  } catch (e) {
    console.error(e);
    req.flash('error_msg', 'Failed to place order: ' + e.message);
    res.redirect('/customer');
  }
}));

// ═══════════════════════════════════════════════════
// CUSTOMER — CANCEL ORDER
// ═══════════════════════════════════════════════════

router.post('/customer/orders/:id/cancel', isCustomer, ah(async (req, res) => {
  const customerId = req.session.spinUser.id;

  const [rows] = await req.db.query(
    'SELECT id, order_status FROM ss_orders WHERE id = ? AND customer_id = ?',
    [req.params.id, customerId]
  );

  if (!rows.length) {
    req.flash('error_msg', 'Order not found');
    return res.redirect('/customer');
  }

  if (!['pending', 'queued'].includes(rows[0].order_status)) {
    req.flash('error_msg', 'Cannot cancel — order already in progress');
    return res.redirect('/customer');
  }

  await req.db.query(
    "UPDATE ss_orders SET order_status = 'cancelled' WHERE id = ? AND customer_id = ?",
    [req.params.id, customerId]
  );

  req.flash('success_msg', 'Order cancelled');
  res.redirect('/customer');
}));

// ═══════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════

router.get('/customer-logout', (req, res) => {
  delete req.session.spinUser;
  req.flash('success_msg', 'Logged out');
  res.redirect('/customer-login');
});

module.exports = router;