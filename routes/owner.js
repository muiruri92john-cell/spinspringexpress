// =====================================================
// routes/owner.js — Owner auth + dashboard + management
// =====================================================

const express = require('express');
const router = express.Router();

const OwnerModel = require('../models/owner');
const AttendantModel = require('../models/attendant');
const CustomerModel = require('../models/customer');
const bcrypt = require('bcryptjs');
const { isOwner } = require('../middleware/auth');

const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ═══════════════════════════════════════════════════
// AUTH — REGISTER
// ═══════════════════════════════════════════════════

router.get('/register', (req, res) => {
  if (req.session.spinUser) return res.redirect('/owner');
  res.render('spinspring/owner-register', {
    title: 'Register Company - SpinSpring Express',
    user: null
  });
});

router.post('/register', ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const { company_name, contact_name, email, password, password2, phone, address, city } = req.body;

  if (!company_name || !contact_name || !email || !password) {
    req.flash('error_msg', 'All required fields must be filled');
    return res.redirect('/register');
  }
  if (password !== password2) {
    req.flash('error_msg', 'Passwords do not match');
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error_msg', 'Password must be at least 6 characters');
    return res.redirect('/register');
  }

  const existing = await model.findByEmail(email);
  if (existing) {
    req.flash('error_msg', 'Email already registered');
    return res.redirect('/register');
  }

  await model.create({
    company_name, contact_name, email, phone, password, address, city
  });

  req.flash('success_msg', '✅ Company registered! Please login.');
  res.redirect('/login');
}));

// ═══════════════════════════════════════════════════
// AUTH — LOGIN
// ═══════════════════════════════════════════════════

router.get('/login', (req, res) => {
  if (req.session.spinUser) {
    const role = req.session.spinUser.role;
    if (role === 'owner') return res.redirect('/owner');
    if (role === 'attendant') return res.redirect('/attendant');
    if (role === 'customer') return res.redirect('/customer');
  }
  res.render('spinspring/owner-login', {
    title: 'Owner Login - SpinSpring Express',
    user: null
  });
});

router.post('/login', ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error_msg', 'Email and password required');
    return res.redirect('/login');
  }

  const owner = await model.verifyPassword(email, password);
  if (!owner) {
    req.flash('error_msg', 'Invalid credentials');
    return res.redirect('/login');
  }

  if (!owner.is_active) {
    req.flash('error_msg', 'Account disabled. Contact support.');
    return res.redirect('/login');
  }

  req.session.spinUser = {
    id: owner.id,
    role: 'owner',
    email: owner.email,
    name: owner.contact_name,
    company: owner.company_name
  };

  req.flash('success_msg', `Welcome back, ${owner.contact_name}!`);
  res.redirect('/owner');
}));

// ═══════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════

router.get('/logout', (req, res) => {
  delete req.session.spinUser;
  req.flash('success_msg', 'Logged out successfully');
  res.redirect('/');
});

// ═══════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════

router.get('/owner', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const ownerId = req.session.spinUser.id;

  const owner = await model.findById(ownerId);
  if (!owner) {
    delete req.session.spinUser;
    req.flash('error_msg', 'Session invalid. Please login again.');
    return res.redirect('/login');
  }

  const [stats, devices, attendants, customers, recentOrders] = await Promise.all([
    model.getDashboardStats(ownerId),
    model.listDevices(ownerId),
    model.listAttendants(ownerId),
    model.listCustomers(ownerId, 10),
    model.listRecentOrders(ownerId, 10)
  ]);

  res.render('spinspring/owner-dashboard', {
    title: `${owner.company_name} - Owner Dashboard`,
    user: req.session.spinUser,
    owner,
    stats,
    devices,
    attendants,
    customers,
    recentOrders
  });
}));

// ═══════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════

router.get('/owner/settings', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const owner = await model.findById(req.session.spinUser.id);
  res.render('spinspring/owner-settings', {
    title: 'Settings - SpinSpring Express',
    user: req.session.spinUser,
    owner
  });
}));

router.post('/owner/settings', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  await model.update(req.session.spinUser.id, {
    company_name: req.body.company_name,
    contact_name: req.body.contact_name,
    phone: req.body.phone,
    address: req.body.address,
    city: req.body.city
  });
  req.flash('success_msg', 'Settings saved');
  res.redirect('/owner/settings');
}));

router.post('/owner/settings/password', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const { current_password, new_password, confirm_password } = req.body;
  const ownerId = req.session.spinUser.id;

  if (new_password !== confirm_password) {
    req.flash('error_msg', 'New passwords do not match');
    return res.redirect('/owner/settings');
  }
  if (new_password.length < 6) {
    req.flash('error_msg', 'Password must be at least 6 characters');
    return res.redirect('/owner/settings');
  }

  const owner = await model.findById(ownerId);
  const valid = await bcrypt.compare(current_password, owner.password);
  if (!valid) {
    req.flash('error_msg', 'Current password is incorrect');
    return res.redirect('/owner/settings');
  }

  await model.changePassword(ownerId, new_password);
  req.flash('success_msg', 'Password changed successfully');
  res.redirect('/owner/settings');
}));

// ═══════════════════════════════════════════════════
// LOCATIONS MANAGEMENT
// ═══════════════════════════════════════════════════

router.get('/owner/locations', isOwner, ah(async (req, res) => {
  const ownerId = req.session.spinUser.id;
  const [locations] = await req.db.query(
    `SELECT l.*,
      (SELECT COUNT(*) FROM ss_devices WHERE location_id = l.id) AS device_count,
      (SELECT COUNT(*) FROM ss_attendants WHERE location_id = l.id) AS attendant_count
     FROM ss_locations l
     WHERE l.owner_id = ?
     ORDER BY l.is_primary DESC, l.location_name`,
    [ownerId]
  );

  res.render('spinspring/owner-locations', {
    title: 'Locations - SpinSpring Express',
    user: req.session.spinUser,
    locations
  });
}));

router.post('/owner/locations', isOwner, ah(async (req, res) => {
  const ownerId = req.session.spinUser.id;
  const { location_name, address_line1, city, phone, latitude, longitude, is_primary } = req.body;

  if (!location_name || !address_line1) {
    req.flash('error_msg', 'Location name and address required');
    return res.redirect('/owner/locations');
  }

  const code = 'LOC-' + Date.now().toString(36).toUpperCase().slice(-6);

  if (is_primary) {
    await req.db.query('UPDATE ss_locations SET is_primary = 0 WHERE owner_id = ?', [ownerId]);
  }

  await req.db.query(
    `INSERT INTO ss_locations 
     (owner_id, location_code, location_name, address_line1, city, phone, latitude, longitude, is_primary, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      ownerId, code, location_name, address_line1,
      city || 'Nairobi', phone || null,
      latitude || null, longitude || null,
      is_primary ? 1 : 0
    ]
  );

  req.flash('success_msg', `✅ Location "${location_name}" created`);
  res.redirect('/owner/locations');
}));

router.post('/owner/locations/:id/delete', isOwner, ah(async (req, res) => {
  const ownerId = req.session.spinUser.id;
  await req.db.query(
    'DELETE FROM ss_locations WHERE id = ? AND owner_id = ?',
    [req.params.id, ownerId]
  );
  req.flash('success_msg', 'Location deleted');
  res.redirect('/owner/locations');
}));

router.post('/owner/locations/:id/primary', isOwner, ah(async (req, res) => {
  const ownerId = req.session.spinUser.id;
  await req.db.query('UPDATE ss_locations SET is_primary = 0 WHERE owner_id = ?', [ownerId]);
  await req.db.query(
    'UPDATE ss_locations SET is_primary = 1 WHERE id = ? AND owner_id = ?',
    [req.params.id, ownerId]
  );
  req.flash('success_msg', 'Primary location updated');
  res.redirect('/owner/locations');
}));

// ═══════════════════════════════════════════════════
// ATTENDANTS MANAGEMENT
// ═══════════════════════════════════════════════════

router.get('/owner/attendants', isOwner, ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  const ownerId = req.session.spinUser.id;

  const [attendants, stats, [locations]] = await Promise.all([
    model.listByOwner(ownerId),
    model.getStats(ownerId),
    req.db.query(
      'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name',
      [ownerId]
    )
  ]);

  res.render('spinspring/owner-attendants', {
    title: 'Attendants - SpinSpring Express',
    user: req.session.spinUser,
    attendants,
    stats,
    locations
  });
}));

router.post('/owner/attendants', isOwner, ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  const ownerId = req.session.spinUser.id;
  const { full_name, email, phone, pin_code, location_id } = req.body;

  if (!full_name || !email || !pin_code) {
    req.flash('error_msg', 'Name, email, and PIN are required');
    return res.redirect('/owner/attendants');
  }

  const existing = await model.findByEmailAnyOwner(email);
  if (existing) {
    req.flash('error_msg', 'Email already registered');
    return res.redirect('/owner/attendants');
  }

  try {
    await model.create(ownerId, {
      full_name, email, phone, pin_code,
      location_id: location_id || null
    });
    req.flash('success_msg', `✅ Attendant "${full_name}" created`);
    res.redirect('/owner/attendants');
  } catch (e) {
    console.error(e);
    req.flash('error_msg', 'Failed to create attendant: ' + e.message);
    res.redirect('/owner/attendants');
  }
}));

router.post('/owner/attendants/:id/toggle', isOwner, ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  await model.toggleActive(req.params.id, req.session.spinUser.id);
  req.flash('success_msg', 'Attendant status updated');
  res.redirect('/owner/attendants');
}));

router.post('/owner/attendants/:id/delete', isOwner, ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  await model.delete(req.params.id, req.session.spinUser.id);
  req.flash('success_msg', 'Attendant deleted');
  res.redirect('/owner/attendants');
}));

// ═══════════════════════════════════════════════════
// CUSTOMERS MANAGEMENT
// ═══════════════════════════════════════════════════

router.get('/owner/customers', isOwner, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const ownerId = req.session.spinUser.id;

  const [customers, stats, [locations]] = await Promise.all([
    model.listByOwner(ownerId),
    model.getStats(ownerId),
    req.db.query(
      'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name',
      [ownerId]
    )
  ]);

  res.render('spinspring/owner-customers', {
    title: 'Customers - SpinSpring Express',
    user: req.session.spinUser,
    customers,
    stats,
    locations
  });
}));

router.post('/owner/customers', isOwner, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const ownerId = req.session.spinUser.id;
  const { full_name, email, phone, address, location_id, password } = req.body;

  if (!full_name || !email || !phone) {
    req.flash('error_msg', 'Name, email, and phone are required');
    return res.redirect('/owner/customers');
  }

  const existingEmail = await model.findByEmail(email);
  if (existingEmail) {
    req.flash('error_msg', 'Email already registered');
    return res.redirect('/owner/customers');
  }

  try {
    const plainPassword = password && password.length >= 6
      ? password
      : Math.random().toString(36).slice(-8);

    const hash = await bcrypt.hash(plainPassword, 10);
    const { customer_unique_id } = await model.create(ownerId, {
      full_name, email, phone, address,
      location_id: location_id || null
    }, hash);

    req.flash('success_msg',
      `✅ Customer "${full_name}" created. ID: ${customer_unique_id}` +
      (password ? '' : ` — Initial password: ${plainPassword}`)
    );
    res.redirect('/owner/customers');
  } catch (e) {
    console.error(e);
    req.flash('error_msg', 'Failed to create customer: ' + e.message);
    res.redirect('/owner/customers');
  }
}));

router.post('/owner/customers/:id/toggle', isOwner, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  await model.toggleActive(req.params.id, req.session.spinUser.id);
  req.flash('success_msg', 'Customer status updated');
  res.redirect('/owner/customers');
}));

router.post('/owner/customers/:id/reset-password', isOwner, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const ownerId = req.session.spinUser.id;
  const customer = await model.findById(req.params.id, ownerId);

  if (!customer) {
    req.flash('error_msg', 'Customer not found');
    return res.redirect('/owner/customers');
  }

  const newPassword = Math.random().toString(36).slice(-8);
  const hash = await bcrypt.hash(newPassword, 10);
  await req.db.query(
    'UPDATE ss_customers SET password = ? WHERE id = ? AND owner_id = ?',
    [hash, customer.id, ownerId]
  );

  req.flash('success_msg',
    `Password reset for ${customer.full_name}: ${newPassword} (share with them)`
  );
  res.redirect('/owner/customers');
}));

// ═══════════════════════════════════════════════════
// ORDERS VIEW
// ═══════════════════════════════════════════════════

router.get('/owner/orders', isOwner, ah(async (req, res) => {
  const ownerId = req.session.spinUser.id;

  const [orders] = await req.db.query(
    `SELECT o.*, c.full_name AS customer_name, d.device_name
     FROM ss_orders o
     LEFT JOIN ss_customers c ON o.customer_id = c.id
     LEFT JOIN ss_devices d ON o.device_id = d.device_id
     WHERE o.owner_id = ?
     ORDER BY o.created_at DESC LIMIT 200`,
    [ownerId]
  );

  const [stats] = await req.db.query(
    `SELECT 
      COUNT(*) AS total,
      SUM(order_status = 'pending') AS pending,
      SUM(order_status = 'queued') AS queued,
      SUM(order_status = 'in_progress') AS in_progress,
      SUM(order_status = 'completed') AS completed,
      COALESCE(SUM(CASE WHEN payment_status='paid' THEN price ELSE 0 END), 0) AS total_paid
     FROM ss_orders WHERE owner_id = ?`,
    [ownerId]
  );

  res.render('spinspring/owner-orders', {
    title: 'Orders - SpinSpring Express',
    user: req.session.spinUser,
    orders,
    stats: stats[0] || {}
  });
}));

// ═══════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════

router.get('/api/owner/stats', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const stats = await model.getDashboardStats(req.session.spinUser.id);
  res.json({ success: true, stats, timestamp: new Date().toISOString() });
}));

module.exports = router;