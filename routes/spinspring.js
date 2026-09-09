const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Auth Middleware
function isAuth(req, res, next) {
  if (req.session.spinUser) return next();
  req.flash('error_msg', 'Please login first');
  res.redirect('/login');
}

function isOwner(req, res, next) {
  if (req.session.spinUser && req.session.spinUser.role === 'owner') return next();
  req.flash('error_msg', 'Owner access required');
  res.redirect('/login');
}

function isAttendant(req, res, next) {
  if (req.session.spinUser && (req.session.spinUser.role === 'attendant' || req.session.spinUser.role === 'owner')) return next();
  req.flash('error_msg', 'Attendant access required');
  res.redirect('/attendant-login');
}

function isCustomer(req, res, next) {
  if (req.session.spinUser && req.session.spinUser.role === 'customer') return next();
  req.flash('error_msg', 'Customer access required');
  res.redirect('/customer-login');
}

// ============ LANDING ============
router.get('/', (req, res) => {
  res.render('spinspring/landing', {
    title: 'SpinSpring Express - Smart Laundry Automation',
    user: req.session.spinUser || null
  });
});

// ============ REGISTER ============
router.get('/register', (req, res) => {
  res.render('spinspring/register', { title: 'Register - SpinSpring Express' });
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, password2, full_name, business_name, phone } = req.body;
    const bcrypt = require('bcryptjs');

    if (password !== password2) {
      req.flash('error_msg', 'Passwords do not match');
      return res.redirect('/register');
    }

    const [existing] = await req.db.query('SELECT id FROM ss_users WHERE email = ?', [email]);
    if (existing.length > 0) {
      req.flash('error_msg', 'Email already registered');
      return res.redirect('/register');
    }

    const hash = await bcrypt.hash(password, 10);
    await req.db.query(
      "INSERT INTO ss_users (email, password, full_name, business_name, phone, role) VALUES (?, ?, ?, ?, ?, 'owner')",
      [email, hash, full_name, business_name, phone]
    );

    req.flash('success_msg', 'Account created! Login now.');
    res.redirect('/login');
  } catch (err) {
    req.flash('error_msg', 'Registration failed');
    res.redirect('/register');
  }
});

// ============ OWNER LOGIN ============
router.get('/login', (req, res) => {
  if (req.session.spinUser) return res.redirect('/owner');
  res.render('spinspring/login', { title: 'Owner Login - SpinSpring Express' });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const bcrypt = require('bcryptjs');
    const [users] = await req.db.query('SELECT * FROM ss_users WHERE email = ? AND is_active = 1', [email]);

    if (users.length === 0) {
      req.flash('error_msg', 'Invalid credentials');
      return res.redirect('/login');
    }

    const match = await bcrypt.compare(password, users[0].password);
    if (!match) {
      req.flash('error_msg', 'Invalid credentials');
      return res.redirect('/login');
    }

    req.session.spinUser = {
      id: users[0].id,
      email: users[0].email,
      name: users[0].full_name,
      business: users[0].business_name,
      role: users[0].role || 'owner'
    };

    if (users[0].role === 'owner') res.redirect('/owner');
    else if (users[0].role === 'attendant') res.redirect('/attendant');
    else res.redirect('/customer');
  } catch (err) {
    req.flash('error_msg', 'Login failed');
    res.redirect('/login');
  }
});

// ============ OWNER DASHBOARD ============
router.get('/owner', isOwner, async (req, res) => {
  try {
    const userId = req.session.spinUser.id;
    const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE owner_id = ?', [userId]);
    const [attendants] = await req.db.query('SELECT * FROM ss_attendants WHERE owner_id = ?', [userId]);
    const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE owner_id = ?', [userId]);
    const [stats] = await req.db.query(
      'SELECT COALESCE(SUM(today_revenue),0) as today_rev, COALESCE(SUM(total_revenue),0) as total_rev, COALESCE(SUM(today_cycles),0) as today_cyc, COALESCE(SUM(cycles_completed),0) as total_cyc FROM ss_devices WHERE owner_id = ?',
      [userId]
    );

    res.render('spinspring/owner-dashboard', {
      title: 'Owner Panel - SpinSpring Express',
      user: req.session.spinUser,
      devices, attendants, customers,
      stats: stats[0] || {}
    });
  } catch (err) {
    res.render('spinspring/owner-dashboard', {
      title: 'Owner Panel', user: req.session.spinUser,
      devices: [], attendants: [], customers: [], stats: {}
    });
  }
});

// Register Device
router.get('/register-device', isOwner, (req, res) => {
  res.render('spinspring/register-device', { title: 'Register Machine' });
});

router.post('/register-device', isOwner, async (req, res) => {
  try {
    const { device_name, device_type, location, price_per_cycle } = req.body;
    const deviceId = 'SPIN-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const apiKey = 'SS-' + crypto.randomBytes(16).toString('hex');

    await req.db.query(
      "INSERT INTO ss_devices (device_id, device_name, device_type, api_key, owner_id, location_area, price_per_cycle, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'offline')",
      [deviceId, device_name, device_type, apiKey, req.session.spinUser.id, location, price_per_cycle || 300]
    );

    req.session.newSpinDevice = { device_id: deviceId, device_name, api_key };
    res.redirect('/device-credentials');
  } catch (err) {
    req.flash('error_msg', 'Registration failed');
    res.redirect('/register-device');
  }
});

router.get('/device-credentials', isOwner, (req, res) => {
  const device = req.session.newSpinDevice;
  if (!device) return res.redirect('/owner');
  delete req.session.newSpinDevice;
  res.render('spinspring/device-credentials', { title: 'Device Credentials', device });
});

// Create Attendant
router.post('/owner/attendants', isOwner, async (req, res) => {
  const { full_name, email, phone, pin_code } = req.body;
  const [existing] = await req.db.query('SELECT id FROM ss_attendants WHERE email = ?', [email]);
  if (existing.length > 0) {
    req.flash('error_msg', 'Email already exists');
    return res.redirect('/owner');
  }
  await req.db.query('INSERT INTO ss_attendants (owner_id, full_name, email, phone, pin_code) VALUES (?, ?, ?, ?, ?)',
    [req.session.spinUser.id, full_name, email, phone, pin_code]);
  req.flash('success_msg', 'Attendant created!');
  res.redirect('/owner');
});

// Create Customer
router.post('/owner/customers', isOwner, async (req, res) => {
  const { full_name, phone, email } = req.body;
  const customerId = 'CUST-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + Math.random().toString(36).toUpperCase().slice(-4);
  await req.db.query('INSERT INTO ss_customers (owner_id, customer_unique_id, full_name, phone, email) VALUES (?, ?, ?, ?, ?)',
    [req.session.spinUser.id, customerId, full_name, phone, email || null]);
  req.flash('success_msg', 'Customer created! ID: ' + customerId);
  res.redirect('/owner');
});

// ============ ATTENDANT ============
router.get('/attendant-login', (req, res) => {
  res.render('spinspring/attendant-login', { title: 'Attendant Login' });
});

router.post('/attendant-login', async (req, res) => {
  const { email, pin_code } = req.body;
  const [attendants] = await req.db.query(
    'SELECT * FROM ss_attendants WHERE email = ? AND pin_code = ? AND is_active = 1',
    [email, pin_code]
  );
  if (attendants.length === 0) {
    req.flash('error_msg', 'Invalid credentials');
    return res.redirect('/attendant-login');
  }
  req.session.spinUser = {
    id: attendants[0].id,
    name: attendants[0].full_name,
    role: 'attendant',
    ownerId: attendants[0].owner_id
  };
  res.redirect('/attendant');
});

router.get('/attendant', isAttendant, async (req, res) => {
  const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
  const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE owner_id = ?', [ownerId]);
  const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE owner_id = ? AND is_active = 1', [ownerId]);
  const [activeOrders] = await req.db.query("SELECT * FROM ss_orders WHERE user_id = ? AND order_status IN ('queued','in_progress')", [ownerId]);
  res.render('spinspring/attendant-dashboard', {
    title: 'Attendant Panel', user: req.session.spinUser,
    devices, customers, activeOrders
  });
});

router.post('/attendant/orders', isAttendant, async (req, res) => {
  const { device_id, customer_id, service_type, cycle_type, price } = req.body;
  const orderNumber = 'SS-' + Date.now().toString(36).toUpperCase();
  await req.db.query(
    "INSERT INTO ss_orders (order_number, device_id, user_id, customer_name, service_type, cycle_type, price, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'queued')",
    [orderNumber, device_id, req.session.spinUser.ownerId || req.session.spinUser.id, customer_id, service_type, cycle_type, price]
  );
  req.flash('success_msg', 'Order created!');
  res.redirect('/attendant');
});

// ============ CUSTOMER ============
router.get('/customer-login', (req, res) => {
  res.render('spinspring/customer-login', { title: 'Customer Login' });
});

router.post('/customer-login', async (req, res) => {
  const { customer_id } = req.body;
  const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE customer_unique_id = ? AND is_active = 1', [customer_id]);
  if (customers.length === 0) {
    req.flash('error_msg', 'Invalid customer ID');
    return res.redirect('/customer-login');
  }
  req.session.spinUser = {
    id: customers[0].id,
    name: customers[0].full_name,
    customerId: customers[0].customer_unique_id,
    role: 'customer',
    ownerId: customers[0].owner_id
  };
  res.redirect('/customer');
});

router.get('/customer', isCustomer, async (req, res) => {
  const customerId = req.session.spinUser.customerId;
  const [customerData] = await req.db.query('SELECT * FROM ss_customers WHERE customer_unique_id = ?', [customerId]);
  const [orders] = await req.db.query('SELECT * FROM ss_orders WHERE customer_name = ? ORDER BY created_at DESC LIMIT 20', [customerId]);
  const [activeOrders] = await req.db.query("SELECT * FROM ss_orders WHERE customer_name = ? AND order_status IN ('queued','in_progress')", [customerId]);
  res.render('spinspring/customer-dashboard', {
    title: 'My Account', user: req.session.spinUser,
    customer: customerData[0] || {}, orders, activeOrders
  });
});

// ============ LOGOUT ============
router.get('/logout', (req, res) => {
  delete req.session.spinUser;
  res.redirect('/');
});

// ============ API ============
router.post('/api/sync', async (req, res) => {
  const deviceId = req.headers['x-device-id'];
  const apiKey = req.headers['x-api-key'];
  if (!deviceId || !apiKey) return res.status(401).json({ error: 'Missing credentials' });
  const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ? AND api_key = ?', [deviceId, apiKey]);
  if (devices.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
  const data = req.body;
  await req.db.query(
    `UPDATE ss_devices SET status = ?, current_cycle = ?, cycle_progress = ?, cycles_completed = ?, today_revenue = ?, total_revenue = ?, last_sync = NOW() WHERE device_id = ?`,
    [data.status || 'idle', data.current_cycle || null, data.cycle_progress || 0, data.cycles_completed || 0, data.today_revenue || 0, data.total_revenue || 0, deviceId]
  );
  const [commands] = await req.db.query("SELECT * FROM ss_commands WHERE device_id = ? AND status = 'pending' LIMIT 5", [deviceId]);
  if (commands.length > 0) {
    const ids = commands.map(c => c.id);
    await req.db.query("UPDATE ss_commands SET status = 'sent' WHERE id IN (?)", [ids]);
  }
  res.json({ status: 'success', commands: commands.map(c => ({ type: c.command_type, value: c.command_value })) });
});

router.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({
    time: now.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour12: false }),
    date: now.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })
  });
});

module.exports = router;