// =====================================================
// routes/customer.js — Customer routes
// =====================================================

const express = require('express');
const router = express.Router();
const CustomerModel = require('../models/customer');
const OrderModel = require('../models/order');

// 🔔 Email service
const {
  sendOrderPlaced,
  sendNewOrderToOwner,
  sendNewOrderToAttendant,
} = require('../services/emailService');

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
// CUSTOMER — PLACE ORDER  (with email notifications)
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

    const { id: orderId, order_number } = await model.create({
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

    // 🔔 Order emails (non-blocking — errors logged, never break the request)
    try {
      const [custRows] = await req.db.query(
        'SELECT id, full_name, email, phone FROM ss_customers WHERE id = ? LIMIT 1',
        [customerId]
      );
      const [ownerRows] = await req.db.query(
        'SELECT id, company_name, contact_name, email FROM ss_owners WHERE id = ? LIMIT 1',
        [ownerId]
      );

      const customerObj = custRows[0] ? {
        id: custRows[0].id,
        full_name: custRows[0].full_name,
        email: custRows[0].email,
        phone: custRows[0].phone,
      } : null;

      const ownerObj = ownerRows[0] ? {
        company_name: ownerRows[0].company_name,
        contact_name: ownerRows[0].contact_name,
        email: ownerRows[0].email,
      } : null;

      const orderObj = {
        id: orderId,
        order_number,
        price: parseFloat(price) || 0,
        order_status: 'pending',
        created_at: new Date(),
        service_type: service_type || 'wash',
        weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      };

      // 1. Customer confirmation
      if (customerObj && customerObj.email) {
        sendOrderPlaced(orderObj, customerObj, ownerObj, req.db)
          .catch(e => console.error('order-placed email failed:', e.message));
      }

      // 2. Owner alert
      if (ownerObj && ownerObj.email) {
        sendNewOrderToOwner(orderObj, customerObj || { full_name: 'Walk-in' }, ownerObj, req.db)
          .catch(e => console.error('new-order-owner email failed:', e.message));
      }

      // 3. Notify ALL active attendants (customer placed it — no specific attendant)
      const [attendants] = await req.db.query(
        `SELECT full_name, email FROM ss_attendants
         WHERE owner_id = ? AND is_active = 1 AND email IS NOT NULL`,
        [ownerId]
      );

      for (const att of attendants) {
        sendNewOrderToAttendant(
          orderObj,
          customerObj || { full_name: 'Walk-in' },
          ownerObj || { company_name: 'SpinSpring Express', contact_name: 'Owner' },
          { email: att.email, full_name: att.full_name },
          req.db
        ).catch(e => console.error(`new-order-attendant email failed (${att.email}):`, e.message));
      }
    } catch (emailErr) {
      console.error('Customer order email lookup failed:', emailErr.message);
    }

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
