// =====================================================
// routes/owner.js — Owner routes (auth + dashboard)
// =====================================================

const express = require('express');
const router = express.Router();
const OwnerModel = require('../models/owner');
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

  const { id } = await model.create({
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
// OWNER DASHBOARD
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
// OWNER SETTINGS
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
// API — Live stats
// ═══════════════════════════════════════════════════

router.get('/api/owner/stats', isOwner, ah(async (req, res) => {
  const model = new OwnerModel(req.db);
  const stats = await model.getDashboardStats(req.session.spinUser.id);
  res.json({ success: true, stats, timestamp: new Date().toISOString() });
}));

module.exports = router;