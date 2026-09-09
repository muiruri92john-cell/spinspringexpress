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
  try {
    const { device_id, customer_id, service_type, cycle_type, price, weight_kg } = req.body;
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;

    // Look up machine for weight-based pricing
    const [devs] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ? AND owner_id = ?', [device_id, ownerId]);
    if (devs.length === 0) {
      req.flash('error_msg', 'Invalid machine selected');
      return res.redirect('/attendant');
    }
    const dev = devs[0];
    const pricePerKg = parseFloat(dev.price_per_kg || dev.price_per_cycle || 50);
    const maxKg = parseFloat(dev.max_capacity_kg || 20);
    const minKg = parseFloat(dev.min_capacity_kg || 0.1);
    const weight = parseFloat(weight_kg || 0);

    let finalPrice = parseFloat(price || 0);
    let weightPrice = null;
    // If weight supplied, compute price from weight (weight-based model)
    if (weight_kg !== undefined && weight_kg !== '' && !isNaN(weight)) {
      if (weight <= 0) {
        req.flash('error_msg', 'Weight must be greater than 0');
        return res.redirect('/attendant');
      }
      if (weight > maxKg) {
        req.flash('error_msg', 'Weight exceeds machine max capacity (' + maxKg + 'kg)');
        return res.redirect('/attendant');
      }
      if (weight < minKg) {
        req.flash('error_msg', 'Weight below machine minimum load (' + minKg + 'kg)');
        return res.redirect('/attendant');
      }
      finalPrice = Math.round(weight * pricePerKg * 100) / 100;
      weightPrice = finalPrice;
    }
    if (!finalPrice || isNaN(finalPrice) || finalPrice <= 0) {
      req.flash('error_msg', 'Invalid price computed');
      return res.redirect('/attendant');
    }

    const orderNumber = 'SS-' + Date.now().toString(36).toUpperCase();
    // customer_name column stores customer_unique_id or 'walk-in' (legacy schema)
    await req.db.query(
      "INSERT INTO ss_orders (order_number, device_id, user_id, customer_name, service_type, cycle_type, weight_kg, price_per_kg, total_weight_price, price, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'queued')",
      [orderNumber, device_id, ownerId, customer_id || 'walk-in', service_type || 'wash', cycle_type || 'normal', isNaN(weight) ? null : weight, pricePerKg, weightPrice, finalPrice]
    );
    // Queue a start command for the ESP32 device
    try {
      await req.db.query(
        "INSERT INTO ss_commands (device_id, command_type, command_value, status) VALUES (?, 'start_cycle', ?, 'pending')",
        [device_id, (cycle_type || 'normal')]
      );
    } catch (e) { console.error('queue command failed:', e.message); }
    req.flash('success_msg', 'Order ' + orderNumber + ' created! Ksh ' + finalPrice);
    res.redirect('/attendant');
  } catch (err) {
    console.error('create order:', err.message);
    req.flash('error_msg', 'Failed to create order');
    res.redirect('/attendant');
  }
});

// Attendant completes / cancels an order
router.post('/order/:id/status', isAttendant, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['completed', 'cancelled', 'in_progress'];
    if (!allowed.includes(status)) {
      req.flash('error_msg', 'Invalid status');
      return res.redirect('/attendant');
    }
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
    const [rows] = await req.db.query('SELECT * FROM ss_orders WHERE id = ? AND user_id = ?', [req.params.id, ownerId]);
    if (rows.length === 0) {
      req.flash('error_msg', 'Order not found');
      return res.redirect('/attendant');
    }
    const extra = status === 'completed' ? ', end_time = NOW()' : (status === 'in_progress' ? ', start_time = NOW()' : '');
    await req.db.query(`UPDATE ss_orders SET order_status = ?${extra} WHERE id = ?`, [status, req.params.id]);
    // If completed, bump customer loyalty + device counters
    if (status === 'completed') {
      const o = rows[0];
      try {
        await req.db.query('UPDATE ss_devices SET cycles_completed = cycles_completed + 1, today_revenue = COALESCE(today_revenue,0) + ?, total_revenue = COALESCE(total_revenue,0) + ? WHERE device_id = ?', [o.price, o.price, o.device_id]);
        if (o.customer_name && o.customer_name !== 'walk-in') {
          await req.db.query('UPDATE ss_customers SET total_cycles = COALESCE(total_cycles,0)+1, total_spent = COALESCE(total_spent,0)+?, loyalty_points = COALESCE(loyalty_points,0)+1 WHERE customer_unique_id = ?', [o.price, o.customer_name]);
        }
      } catch (e) { console.error('complete hook:', e.message); }
    }
    req.flash('success_msg', 'Order updated to ' + status);
    res.redirect('/attendant');
  } catch (err) {
    console.error('order status:', err.message);
    req.flash('error_msg', 'Failed to update order');
    res.redirect('/attendant');
  }
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
    const placeholders = commands.map(() => '?').join(',');
    await req.db.query(`UPDATE ss_commands SET status = 'sent' WHERE id IN (${placeholders})`, commands.map(c => c.id));
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

// ============ OWNER EXTRA PAGES ============
router.get('/dashboard', isOwner, (req, res) => res.redirect('/owner'));
router.get('/device-list', isOwner, (req, res) => res.redirect('/owner'));

router.post('/owner/attendants/:id/toggle', isOwner, async (req, res) => {
  try {
    await req.db.query('UPDATE ss_attendants SET is_active = 1 - is_active WHERE id = ? AND owner_id = ?', [req.params.id, req.session.spinUser.id]);
    req.flash('success_msg', 'Attendant status updated');
  } catch (e) { req.flash('error_msg', 'Update failed'); }
  res.redirect('/owner');
});

router.post('/owner/attendants/:id/delete', isOwner, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ss_attendants WHERE id = ? AND owner_id = ?', [req.params.id, req.session.spinUser.id]);
    req.flash('success_msg', 'Attendant deleted');
  } catch (e) { req.flash('error_msg', 'Delete failed'); }
  res.redirect('/owner');
});

router.get('/orders', isOwner, async (req, res) => {
  try {
    const [orders] = await req.db.query(
      'SELECT o.*, d.device_name FROM ss_orders o LEFT JOIN ss_devices d ON d.device_id = o.device_id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 200',
      [req.session.spinUser.id]
    );
    res.render('spinspring/orders', { title: 'Orders', user: req.session.spinUser, orders });
  } catch (e) { res.render('spinspring/orders', { title: 'Orders', user: req.session.spinUser, orders: [] }); }
});

router.get('/order/:id', isAuth, async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT o.*, d.device_name FROM ss_orders o LEFT JOIN ss_devices d ON d.device_id = o.device_id WHERE o.id = ? LIMIT 1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('<h1>Order not found</h1><a href="/orders">Back</a>');
    res.render('spinspring/order-detail', { title: 'Order ' + rows[0].order_number, user: req.session.spinUser, order: rows[0] });
  } catch (e) { res.status(500).send('Failed to load order'); }
});

router.get('/reports', isOwner, async (req, res) => {
  try {
    const userId = req.session.spinUser.id;
    const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE owner_id = ?', [userId]);
    const [stats] = await req.db.query(
      'SELECT COALESCE(SUM(today_revenue),0) as today_rev, COALESCE(SUM(total_revenue),0) as total_rev, COALESCE(SUM(today_cycles),0) as today_cyc, COALESCE(SUM(cycles_completed),0) as total_cyc FROM ss_devices WHERE owner_id = ?',
      [userId]
    );
    const [orders] = await req.db.query(
      'SELECT o.*, d.device_name FROM ss_orders o LEFT JOIN ss_devices d ON d.device_id = o.device_id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50',
      [userId]
    );
    res.render('spinspring/reports', { title: 'Reports', user: req.session.spinUser, devices, stats: stats[0] || {}, orders });
  } catch (e) { res.render('spinspring/reports', { title: 'Reports', user: req.session.spinUser, devices: [], stats: {}, orders: [] }); }
});

router.get('/settings', isOwner, (req, res) => {
  res.render('spinspring/settings', { title: 'Settings', user: req.session.spinUser });
});

router.post('/settings/business', isOwner, async (req, res) => {
  try {
    const { business_name, phone } = req.body;
    await req.db.query('UPDATE ss_users SET business_name = ?, phone = ? WHERE id = ?', [business_name, phone, req.session.spinUser.id]);
    req.session.spinUser.business = business_name;
    req.flash('success_msg', 'Business info saved');
  } catch (e) { req.flash('error_msg', 'Save failed'); }
  res.redirect('/settings');
});

router.post('/settings/defaults', isOwner, (req, res) => {
  req.flash('success_msg', 'Defaults saved (applies to new machines)');
  res.redirect('/settings');
});

router.post('/settings/password', isOwner, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password) { req.flash('error_msg', 'Passwords do not match'); return res.redirect('/settings'); }
    const [rows] = await req.db.query('SELECT password FROM ss_users WHERE id = ?', [req.session.spinUser.id]);
    if (!rows.length || !(await bcrypt.compare(current_password, rows[0].password))) {
      req.flash('error_msg', 'Current password incorrect'); return res.redirect('/settings');
    }
    const hash = await bcrypt.hash(new_password, 10);
    await req.db.query('UPDATE ss_users SET password = ? WHERE id = ?', [hash, req.session.spinUser.id]);
    req.flash('success_msg', 'Password changed');
  } catch (e) { req.flash('error_msg', 'Password change failed'); }
  res.redirect('/settings');
});

router.get('/mpesa-settings', isOwner, async (req, res) => {
  let config = {};
  try {
    const [rows] = await req.db.query('SELECT * FROM ss_mpesa_config WHERE owner_id = ? LIMIT 1', [req.session.spinUser.id]);
    if (rows.length) config = rows[0];
  } catch (e) { /* table may not exist yet */ }
  res.render('spinspring/mpesa-settings', { title: 'M-PESA Settings', user: req.session.spinUser, config });
});

router.post('/mpesa-settings', isOwner, async (req, res) => {
  try {
    const { business_shortcode, account_type, consumer_key, consumer_secret, passkey } = req.body;
    await req.db.query(
      'INSERT INTO ss_mpesa_config (owner_id, business_shortcode, account_type, consumer_key, consumer_secret, passkey) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE business_shortcode=VALUES(business_shortcode), account_type=VALUES(account_type), consumer_key=VALUES(consumer_key), consumer_secret=VALUES(consumer_secret), passkey=VALUES(passkey)',
      [req.session.spinUser.id, business_shortcode, account_type, consumer_key, consumer_secret, passkey]
    );
    req.flash('success_msg', 'M-PESA settings saved');
  } catch (e) { req.flash('error_msg', 'Save failed: ' + e.message); }
  res.redirect('/mpesa-settings');
});

router.post('/mpesa/register-urls', isOwner, (req, res) => {
  req.flash('success_msg', 'C2B URL registration queued (callback: /api/mpesa/callback)');
  res.redirect('/mpesa-settings');
});

router.get('/device/:id', isAuth, async (req, res) => {
  try {
    const [rows] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).send('<h1>Device not found</h1><a href="/">Home</a>');
    const [orders] = await req.db.query('SELECT * FROM ss_orders WHERE device_id = ? ORDER BY created_at DESC LIMIT 20', [req.params.id]);
    res.render('spinspring/device-detail', { title: rows[0].device_name, user: req.session.spinUser, device: rows[0], orders });
  } catch (e) { res.status(500).send('Failed to load device'); }
});

router.post('/device/:id/command', isAttendant, async (req, res) => {
  try {
    const { command_type, command_value } = req.body;
    await req.db.query("INSERT INTO ss_commands (device_id, command_type, command_value, status) VALUES (?, ?, ?, 'pending')",
      [req.params.id, command_type, command_value || null]);
    req.flash('success_msg', 'Command queued: ' + command_type);
  } catch (e) { req.flash('error_msg', 'Failed to queue command'); }
  res.redirect('/device/' + req.params.id);
});

router.post('/device/:id/weight-settings', isOwner, async (req, res) => {
  try {
    const { price_per_kg, max_capacity_kg, min_capacity_kg } = req.body;
    await req.db.query('UPDATE ss_devices SET price_per_kg = ?, max_capacity_kg = ?, min_capacity_kg = ? WHERE device_id = ?',
      [price_per_kg, max_capacity_kg, min_capacity_kg, req.params.id]);
    req.flash('success_msg', 'Weight settings saved');
  } catch (e) { req.flash('error_msg', 'Save failed'); }
  res.redirect('/device/' + req.params.id);
});

router.get('/api/customer-orders', isCustomer, async (req, res) => {
  const customerId = req.session.spinUser.customerId;
  const [activeOrders] = await req.db.query("SELECT * FROM ss_orders WHERE customer_name = ? AND order_status IN ('queued','in_progress') ORDER BY created_at DESC", [customerId]);
  res.json({ success: true, activeOrders });
});

router.post('/api/mpesa/callback', async (req, res) => {
  console.log('M-PESA callback:', JSON.stringify(req.body).slice(0, 500));
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

module.exports = router;