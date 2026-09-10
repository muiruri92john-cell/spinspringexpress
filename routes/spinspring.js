const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Async wrapper
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

['get', 'post', 'put', 'patch', 'delete', 'all'].forEach((m) => {
  const orig = router[m].bind(router);
  router[m] = (path, ...handlers) => orig(
    path,
    ...handlers.map((h) => (
      typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? ah(h) : h
    ))
  );
});

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
router.get('/', (req, res, next) => {
  try {
    res.render('spinspring/landing', {
      title: 'SpinSpring Express - Smart Laundry Automation',
      user: req.session.spinUser || null
    });
  } catch (e) { next(e); }
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

// ============ QUOTE CALCULATOR ============

// Serve pricing data (for AJAX)
router.get('/api/pricing', async (req, res) => {
  try {
    const [services] = await req.db.query('SELECT * FROM ss_pricing WHERE is_active = 1 ORDER BY id');
    const [addons] = await req.db.query('SELECT * FROM ss_addons WHERE is_active = 1 ORDER BY id');
    res.json({ success: true, services, addons });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Calculate quote (server-side authoritative pricing)
router.post('/api/quote/calculate', async (req, res) => {
  try {
    const { items = [], addons = [], express = false, pickup = 'none' } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided' });
    }

    // Load pricing from DB
    const [services] = await req.db.query('SELECT * FROM ss_pricing WHERE is_active = 1');
    const [addonRows] = await req.db.query('SELECT * FROM ss_addons WHERE is_active = 1');

    const priceMap = {};
    services.forEach(s => { priceMap[s.service_key] = s; });

    const addonMap = {};
    addonRows.forEach(a => { addonMap[a.addon_key] = a; });

    let subtotal = 0;
    let totalWeight = 0;
    const breakdown = [];

    // Calculate each item
    items.forEach((item, idx) => {
      const service = priceMap[item.service_key];
      if (!service) {
        breakdown.push({ item: item.service_key, error: 'Unknown service', line_total: 0 });
        return;
      }

      let qty = parseFloat(item.quantity) || 0;
      if (qty <= 0) {
        breakdown.push({ item: service.service_name, error: 'Invalid quantity', line_total: 0 });
        return;
      }

      // Sanity check
      if (service.unit === 'kg' && qty > 100) qty = 100;
      if (service.unit === 'piece' && qty > 500) qty = 500;
      if (service.unit === 'sqft' && qty > 10000) qty = 10000;

      const lineTotal = Math.round(qty * parseFloat(service.price) * 100) / 100;
      subtotal += lineTotal;
      if (service.unit === 'kg') totalWeight += qty;

      breakdown.push({
        item: service.service_name,
        quantity: qty,
        unit: service.unit,
        rate: parseFloat(service.price),
        line_total: lineTotal
      });
    });

    // Apply minimum order per kg-based service
    const minCharge = 1000;
    const kgItems = breakdown.filter(b => b.unit === 'kg');
    if (kgItems.length > 0 && subtotal < minCharge) {
      breakdown.push({
        item: 'Minimum order adjustment',
        note: 'Applies to wash services',
        line_total: minCharge - subtotal
      });
      subtotal = minCharge;
    }

    // Apply addons
    let addonTotal = 0;
    addons.forEach(key => {
      const addon = addonMap[key];
      if (!addon) return;
      let addonCost = 0;
      if (addon.type === 'per_kg') {
        addonCost = parseFloat(addon.price) * totalWeight;
      } else {
        addonCost = parseFloat(addon.price);
      }
      addonCost = Math.round(addonCost * 100) / 100;
      addonTotal += addonCost;
      breakdown.push({
        item: addon.addon_name,
        note: addon.type === 'per_kg' ? `Ksh ${addon.price}/kg × ${totalWeight}kg` : 'Fixed price',
        line_total: addonCost
      });
    });

    // Express service
    let expressCost = 0;
    if (express) {
      expressCost = 1000;
      breakdown.push({
        item: '⚡ Express Service (3 hours)',
        line_total: expressCost
      });
    }

    // Pickup fee
    let pickupCost = 0;
    if (pickup === 'nairobi') {
      pickupCost = 500;
      breakdown.push({ item: 'Pickup & Delivery (Nairobi)', line_total: pickupCost });
    } else if (pickup === 'westlands') {
      pickupCost = 0;
      breakdown.push({ item: 'Pickup (Westlands) - FREE', line_total: 0 });
    }

    const total = Math.round((subtotal + addonTotal + expressCost + pickupCost) * 100) / 100;

    res.json({
      success: true,
      subtotal: Math.round(subtotal * 100) / 100,
      addons_total: Math.round(addonTotal * 100) / 100,
      express_cost: expressCost,
      pickup_cost: pickupCost,
      total,
      total_weight: Math.round(totalWeight * 100) / 100,
      item_count: items.length,
      breakdown,
      currency: 'KES',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save quote (visible to owner in admin panel)
router.post('/api/quote/save', async (req, res) => {
  try {
    const { items, addons, express, pickup, total, customer_name, customer_phone, customer_email } = req.body;

    // Ensure table exists
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS ss_quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quote_ref VARCHAR(30) UNIQUE,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        customer_email VARCHAR(100),
        items JSON,
        addons JSON,
        express TINYINT DEFAULT 0,
        pickup VARCHAR(30),
        subtotal DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2),
        status ENUM('new','contacted','converted','expired') DEFAULT 'new',
        notes TEXT,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    const quoteRef = 'QT-' + Date.now().toString(36).toUpperCase();
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';

    await req.db.query(
      `INSERT INTO ss_quotes 
       (quote_ref, customer_name, customer_phone, customer_email, items, addons, express, pickup, total, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteRef,
        customer_name || null,
        customer_phone || null,
        customer_email || null,
        JSON.stringify(items),
        JSON.stringify(addons),
        express ? 1 : 0,
        pickup || 'none',
        total,
        ip.substring(0, 45),
        ua.substring(0, 500)
      ]
    );

    res.json({ success: true, quote_ref: quoteRef });
  } catch (err) {
    console.error('Save quote error:', err);
    res.json({ success: false, error: err.message });
  }
});

// ============ OWNER: VIEW ALL QUOTES ============
router.get('/owner/quotes', isOwner, async (req, res) => {
  try {
    const ownerId = req.session.spinUser.id;
    const { status } = req.query;

    let query = 'SELECT * FROM ss_quotes';
    const params = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 200';

    // Create table if missing
    try {
      await req.db.query(`CREATE TABLE IF NOT EXISTS ss_quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quote_ref VARCHAR(30) UNIQUE,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        customer_email VARCHAR(100),
        items JSON,
        addons JSON,
        express TINYINT DEFAULT 0,
        pickup VARCHAR(30),
        total DECIMAL(10,2),
        status ENUM('new','contacted','converted','expired') DEFAULT 'new',
        notes TEXT,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`);
    } catch (e) { /* ignore */ }

    const [quotes] = await req.db.query(query, params);

    // Parse items and addons JSON
    quotes.forEach(q => {
      try { q.items = JSON.parse(q.items || '[]'); } catch (e) { q.items = []; }
      try { q.addons = JSON.parse(q.addons || '[]'); } catch (e) { q.addons = []; }
    });

    // Stats
    const [stats] = await req.db.query(
      `SELECT 
        COUNT(*) as total_quotes,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted_count,
        COALESCE(SUM(CASE WHEN status = 'converted' THEN total ELSE 0 END), 0) as converted_value
       FROM ss_quotes`
    );

    res.render('spinspring/quotes', {
      title: 'Quotes - SpinSpring Express',
      user: req.session.spinUser,
      quotes,
      stats: stats[0] || {},
      currentStatus: status || ''
    });
  } catch (err) {
    console.error('Owner quotes error:', err);
    res.render('spinspring/quotes', {
      title: 'Quotes',
      user: req.session.spinUser,
      quotes: [],
      stats: {},
      currentStatus: ''
    });
  }
});

// ============ MACHINE CONTROL PARAMETERS ============

// Get machine parameters (with auto-create)
router.get('/api/machine/:deviceId/params', isAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    // Verify ownership
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
    const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ? AND owner_id = ?', [deviceId, ownerId]);
    if (devices.length === 0) return res.status(403).json({ error: 'Access denied' });

    let [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    if (params.length === 0) {
      // Auto-create default params
      await req.db.query('INSERT INTO ss_machine_params (device_id) VALUES (?)', [deviceId]);
      [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    }

    res.json({ success: true, params: params[0] || {} });
  } catch (err) {
    console.error('Params fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update machine parameters (queued for sync)
router.post('/api/machine/:deviceId/params', isAuth, isOwner, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const ownerId = req.session.spinUser.id;

    // Verify ownership
    const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ? AND owner_id = ?', [deviceId, ownerId]);
    if (devices.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Validate payload
    const allowed = [
      'pulses_per_credit', 'accumulate_payments', 'max_credit_minutes',
      'min_credit_to_start', 'pulse_width_ms', 'pulse_gap_ms',
      'start_pulse_duration_ms', 'run_time_per_credit_min', 'cooldown_period_sec'
    ];

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined && req.body[key] !== '') {
        let val = req.body[key];
        if (key === 'accumulate_payments') val = val ? 1 : 0;
        else val = parseInt(val, 10);
        if (isNaN(val)) continue;

        // Range validation
        if (key === 'pulses_per_credit' && (val < 1 || val > 10)) continue;
        if (key === 'max_credit_minutes' && (val < 1 || val > 1440)) continue;
        if (key === 'pulse_width_ms' && (val < 20 || val > 500)) continue;
        if (key === 'pulse_gap_ms' && (val < 20 || val > 500)) continue;
        if (key === 'start_pulse_duration_ms' && (val < 100 || val > 2000)) continue;
        if (key === 'run_time_per_credit_min' && (val < 1 || val > 60)) continue;
        if (key === 'cooldown_period_sec' && (val < 5 || val > 600)) continue;
        if (key === 'min_credit_to_start' && (val < 1 || val > 100)) continue;

        updates[key] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid parameters' });
    }

    // Ensure params row exists
    let [existing] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    if (existing.length === 0) {
      await req.db.query('INSERT INTO ss_machine_params (device_id) VALUES (?)', [deviceId]);
      [existing] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    }
    const oldParams = existing[0];

    // Update params immediately
    const setClauses = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      setClauses.push(`${k} = ?`);
      values.push(v);
    }
    values.push(deviceId);
    await req.db.query(`UPDATE ss_machine_params SET ${setClauses.join(', ')} WHERE device_id = ?`, values);

    // Queue each change for ESP32 to pick up on next sync
    for (const [k, v] of Object.entries(updates)) {
      await req.db.query(
        `INSERT INTO ss_param_queue (device_id, param_name, old_value, new_value, status, created_by) 
         VALUES (?, ?, ?, ?, 'pending', ?)`,
        [deviceId, k, String(oldParams[k] || ''), String(v), ownerId]
      );
    }

    res.json({ success: true, updated: Object.keys(updates), queued: Object.keys(updates).length });
  } catch (err) {
    console.error('Params update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get pending param changes for device (for dashboard display)
router.get('/api/machine/:deviceId/pending', isAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const [pending] = await req.db.query(
      "SELECT param_name, new_value, created_at FROM ss_param_queue WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC",
      [deviceId]
    );
    res.json({ success: true, pending });
  } catch (err) {
    res.json({ success: false, error: err.message, pending: [] });
  }
});

// ============ HEARTBEAT CHECK API ============

// Get device heartbeat status (dashboard polling)
router.get('/api/machine/:deviceId/heartbeat', isAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const [rows] = await req.db.query(
      `SELECT 
        d.device_id, d.device_name, d.status, d.last_sync,
        TIMESTAMPDIFF(SECOND, d.last_sync, NOW()) as seconds_since_sync,
        hb.battery_voltage, hb.signal_strength, hb.uptime_seconds,
        hb.current_credit, hb.current_state, hb.firmware_version, hb.error_code,
        mp.current_credit_minutes, mp.is_locked_out, mp.lockout_until
       FROM ss_devices d
       LEFT JOIN (
         SELECT device_id, battery_voltage, signal_strength, uptime_seconds,
                current_credit, current_state, firmware_version, error_code
         FROM ss_heartbeats h1
         WHERE created_at = (SELECT MAX(created_at) FROM ss_heartbeats h2 WHERE h2.device_id = h1.device_id)
       ) hb ON d.device_id = hb.device_id
       LEFT JOIN ss_machine_params mp ON d.device_id = mp.device_id
       WHERE d.device_id = ?`,
      [deviceId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Device not found' });

    const d = rows[0];
    const secondsSinceSync = d.seconds_since_sync || 999999;
    const online = secondsSinceSync < 60;

    let health = 'unknown';
    if (online) {
      if (d.error_code) health = 'error';
      else if (d.battery_voltage && d.battery_voltage < 10.5) health = 'low_battery';
      else if (d.signal_strength && d.signal_strength < 10) health = 'weak_signal';
      else health = 'healthy';
    } else if (secondsSinceSync < 300) {
      health = 'unstable';
    } else {
      health = 'offline';
    }

    res.json({
      success: true,
      online,
      health,
      seconds_since_sync: secondsSinceSync,
      last_sync: d.last_sync,
      battery_voltage: d.battery_voltage,
      signal_strength: d.signal_strength,
      uptime_seconds: d.uptime_seconds,
      current_credit: d.current_credit_minutes || 0,
      current_state: d.current_state || d.status,
      firmware_version: d.firmware_version,
      error_code: d.error_code,
      is_locked_out: d.is_locked_out === 1,
      lockout_until: d.lockout_until
    });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ PULSE / CREDIT DISPATCH ============

// Send credits to machine (queued for next sync)
router.post('/api/machine/:deviceId/dispense', isAuth, isAttendant, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { credits = 1, reason = 'manual', order_number = null } = req.body;

    const creditsInt = parseInt(credits, 10);
    if (isNaN(creditsInt) || creditsInt < 1 || creditsInt > 99) {
      return res.status(400).json({ success: false, error: 'Credits must be 1-99' });
    }

    // Get current params
    let [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    if (params.length === 0) {
      await req.db.query('INSERT INTO ss_machine_params (device_id) VALUES (?)', [deviceId]);
      [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
    }
    const p = params[0];

    // Check lockout
    if (p.is_locked_out && p.lockout_until && new Date(p.lockout_until) > new Date()) {
      return res.status(429).json({ success: false, error: 'Device locked out until ' + p.lockout_until });
    }

    // Check max credit cap
    const newTotal = (p.current_credit_minutes || 0) + (creditsInt * p.run_time_per_credit_min);
    if (newTotal > p.max_credit_minutes) {
      return res.status(400).json({
        success: false,
        error: `Would exceed max credit (${p.max_credit_minutes} min). Current: ${p.current_credit_minutes} min`
      });
    }

    // Queue credit-add command for ESP32
    const commandValue = JSON.stringify({
      credits: creditsInt,
      pulses_per_credit: p.pulses_per_credit,
      pulse_width_ms: p.pulse_width_ms,
      pulse_gap_ms: p.pulse_gap_ms,
      start_pulse_duration_ms: p.start_pulse_duration_ms,
      run_time_per_credit_min: p.run_time_per_credit_min,
      accumulate: p.accumulate_payments === 1
    });

    await req.db.query(
      "INSERT INTO ss_commands (device_id, command_type, command_value, status) VALUES (?, 'dispense_credits', ?, 'pending')",
      [deviceId, commandValue]
    );

    // Log for audit
    await req.db.query(
      `INSERT INTO ss_pulse_log (device_id, pulses_sent, pulse_width_ms, pulse_gap_ms, credits_granted, reason, order_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, creditsInt * p.pulses_per_credit, p.pulse_width_ms, p.pulse_gap_ms, creditsInt, reason, order_number]
    );

    // Update running credit total (will be corrected on next heartbeat)
    await req.db.query(
      'UPDATE ss_machine_params SET current_credit_minutes = current_credit_minutes + ?, total_pulses_sent = total_pulses_sent + ?, last_pulse_at = NOW() WHERE device_id = ?',
      [creditsInt * p.run_time_per_credit_min, creditsInt * p.pulses_per_credit, deviceId]
    );

    res.json({
      success: true,
      queued: {
        credits: creditsInt,
        pulses: creditsInt * p.pulses_per_credit,
        minutes_added: creditsInt * p.run_time_per_credit_min,
        new_total_minutes: newTotal
      }
    });
  } catch (err) {
    console.error('Dispense error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get pulse log
router.get('/api/machine/:deviceId/pulse-log', isAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const [log] = await req.db.query(
      'SELECT * FROM ss_pulse_log WHERE device_id = ? ORDER BY created_at DESC LIMIT 50',
      [deviceId]
    );
    res.json({ success: true, log });
  } catch (err) {
    res.json({ success: false, error: err.message, log: [] });
  }
});
// Update quote status / notes
router.post('/owner/quotes/:id/update', isOwner, async (req, res) => {
  try {
    const { status, notes } = req.body;
    await req.db.query(
      'UPDATE ss_quotes SET status = ?, notes = ? WHERE id = ?',
      [status, notes || null, req.params.id]
    );
    req.flash('success_msg', 'Quote updated');
  } catch (e) {
    req.flash('error_msg', 'Update failed');
  }
  res.redirect('/owner/quotes');
});

// Delete quote
router.post('/owner/quotes/:id/delete', isOwner, async (req, res) => {
  try {
    await req.db.query('DELETE FROM ss_quotes WHERE id = ?', [req.params.id]);
    req.flash('success_msg', 'Quote deleted');
  } catch (e) {
    req.flash('error_msg', 'Delete failed');
  }
  res.redirect('/owner/quotes');
});

// API: get quotes as JSON (for live refresh)
router.get('/api/owner/quotes', isOwner, async (req, res) => {
  try {
    const [quotes] = await req.db.query('SELECT * FROM ss_quotes ORDER BY created_at DESC LIMIT 100');
    quotes.forEach(q => {
      try { q.items = JSON.parse(q.items || '[]'); } catch (e) { q.items = []; }
      try { q.addons = JSON.parse(q.addons || '[]'); } catch (e) { q.addons = []; }
    });
    res.json({ success: true, quotes, count: quotes.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ============ OWNER DASHBOARD ============
router.get('/owner', isOwner, async (req, res) => {
  try {
    const userId = req.session.spinUser.id;
    const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE owner_id = ? ORDER BY created_at DESC', [userId]);
    const [attendants] = await req.db.query('SELECT * FROM ss_attendants WHERE owner_id = ? ORDER BY created_at DESC', [userId]);
    const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE owner_id = ? ORDER BY created_at DESC', [userId]);
    const [stats] = await req.db.query(
      'SELECT COALESCE(SUM(today_revenue),0) as today_rev, COALESCE(SUM(total_revenue),0) as total_rev, COALESCE(SUM(today_cycles),0) as today_cyc, COALESCE(SUM(cycles_completed),0) as total_cyc FROM ss_devices WHERE owner_id = ?',
      [userId]
    );
    const [orders] = await req.db.query('SELECT * FROM ss_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [userId]);
    const [receipts] = await req.db.query(
      'SELECT r.* FROM ss_receipts r JOIN ss_devices d ON r.device_id = d.device_id WHERE d.owner_id = ? ORDER BY r.created_at DESC LIMIT 10',
      [userId]
    );

    res.render('spinspring/owner-dashboard', {
      title: 'Owner Panel - SpinSpring Express',
      user: req.session.spinUser,
      devices, attendants, customers, orders, receipts,
      stats: stats[0] || {}
    });
  } catch (err) {
    console.error('Owner dashboard error:', err);
    err.status = 500;
    throw err;
  }
});

// Register Device
router.get('/register-device', isOwner, (req, res) => {
  res.render('spinspring/register-device', { title: 'Register Machine' });
});

router.post('/register-device', isOwner, async (req, res) => {
  try {
    const { device_name, device_type, location, price_per_cycle, price_per_kg, max_capacity_kg } = req.body;
    const deviceId = 'SPIN-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const apiKey = 'SS-' + crypto.randomBytes(16).toString('hex');

    await req.db.query(
      "INSERT INTO ss_devices (device_id, device_name, device_type, api_key, owner_id, location_area, price_per_cycle, price_per_kg, max_capacity_kg, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline')",
      [deviceId, device_name, device_type, apiKey, req.session.spinUser.id, location, price_per_cycle || 300, price_per_kg || 50, max_capacity_kg || 20]
    );

    // AUTO-REDIRECT to dashboard (not device-credentials page)
    req.flash('success_msg', '✅ Machine "' + device_name + '" registered! ID: ' + deviceId);
    res.redirect('/owner');
  } catch (err) {
    console.error('Register device error:', err);
    req.flash('error_msg', 'Registration failed: ' + err.message);
    res.redirect('/register-device');
  }
});

// Create Attendant
router.post('/owner/attendants', isOwner, async (req, res) => {
  try {
    const { full_name, email, phone, pin_code } = req.body;
    const [existing] = await req.db.query('SELECT id FROM ss_attendants WHERE email = ?', [email]);
    if (existing.length > 0) {
      req.flash('error_msg', 'Email already exists');
      return res.redirect('/owner');
    }
    await req.db.query('INSERT INTO ss_attendants (owner_id, full_name, email, phone, pin_code) VALUES (?, ?, ?, ?, ?)',
      [req.session.spinUser.id, full_name, email, phone, pin_code]);
    req.flash('success_msg', '✅ Attendant "' + full_name + '" created!');
    res.redirect('/owner');
  } catch (e) {
    req.flash('error_msg', 'Failed to create attendant');
    res.redirect('/owner');
  }
});

// Create Customer
router.post('/owner/customers', isOwner, async (req, res) => {
  try {
    const { full_name, phone, email } = req.body;
    const customerId = 'CUST-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + Math.random().toString(36).toUpperCase().slice(-4);
    await req.db.query('INSERT INTO ss_customers (owner_id, customer_unique_id, full_name, phone, email) VALUES (?, ?, ?, ?, ?)',
      [req.session.spinUser.id, customerId, full_name, phone, email || null]);
    req.flash('success_msg', '✅ Customer "' + full_name + '" created! ID: ' + customerId);
    res.redirect('/owner');
  } catch (e) {
    req.flash('error_msg', 'Failed to create customer');
    res.redirect('/owner');
  }
});

// ============ ATTENDANT ============
router.get('/attendant-login', (req, res) => {
  res.render('spinspring/attendant-login', { title: 'Attendant Login' });
});

router.post('/attendant-login', async (req, res) => {
  try {
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
  } catch (err) {
    req.flash('error_msg', 'Login failed');
    res.redirect('/attendant-login');
  }
});

router.get('/attendant', isAttendant, ah(async (req, res) => {
  const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
  const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);
  const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE owner_id = ? AND is_active = 1 ORDER BY full_name', [ownerId]);
  const [activeOrders] = await req.db.query("SELECT * FROM ss_orders WHERE user_id = ? AND order_status IN ('queued','in_progress') ORDER BY created_at DESC", [ownerId]);
  res.render('spinspring/attendant-dashboard', {
    title: 'Attendant Panel', user: req.session.spinUser,
    devices, customers, activeOrders
  });
}));

// Create Order
router.post('/attendant/orders', isAttendant, async (req, res) => {
  try {
    const { device_id, customer_id, service_type, cycle_type, price, weight_kg } = req.body;
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;

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
    if (weight_kg !== undefined && weight_kg !== '' && !isNaN(weight)) {
      if (weight <= 0) { req.flash('error_msg', 'Weight must be > 0'); return res.redirect('/attendant'); }
      if (weight > maxKg) { req.flash('error_msg', 'Weight exceeds max (' + maxKg + 'kg)'); return res.redirect('/attendant'); }
      finalPrice = Math.round(weight * pricePerKg * 100) / 100;
      weightPrice = finalPrice;
    }
    if (!finalPrice || isNaN(finalPrice) || finalPrice <= 0) {
      req.flash('error_msg', 'Invalid price');
      return res.redirect('/attendant');
    }

    const orderNumber = 'SS-' + Date.now().toString(36).toUpperCase();
    await req.db.query(
      "INSERT INTO ss_orders (order_number, device_id, user_id, customer_name, service_type, cycle_type, weight_kg, price_per_kg, total_weight_price, price, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'queued')",
      [orderNumber, device_id, ownerId, customer_id || 'walk-in', service_type || 'wash', cycle_type || 'normal', isNaN(weight) ? null : weight, pricePerKg, weightPrice, finalPrice]
    );
    try {
      await req.db.query(
        "INSERT INTO ss_commands (device_id, command_type, command_value, status) VALUES (?, 'start_cycle', ?, 'pending')",
        [device_id, (cycle_type || 'normal')]
      );
    } catch (e) { console.error('queue command failed:', e.message); }

    req.flash('success_msg', '✅ Order ' + orderNumber + ' created! Ksh ' + finalPrice);
    res.redirect('/attendant');
  } catch (err) {
    console.error('create order:', err.message);
    req.flash('error_msg', 'Failed to create order');
    res.redirect('/attendant');
  }
});

// Order status update
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
    req.flash('error_msg', 'Failed to update');
    res.redirect('/attendant');
  }
});

// ============ CUSTOMER ============
router.get('/customer-login', (req, res) => {
  res.render('spinspring/customer-login', { title: 'Customer Login' });
});

router.post('/customer-login', async (req, res) => {
  try {
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
  } catch (err) {
    req.flash('error_msg', 'Login failed');
    res.redirect('/customer-login');
  }
});

router.get('/customer', isCustomer, ah(async (req, res) => {
  const customerId = req.session.spinUser.customerId;
  const [customerData] = await req.db.query('SELECT * FROM ss_customers WHERE customer_unique_id = ?', [customerId]);
  const [orders] = await req.db.query('SELECT * FROM ss_orders WHERE customer_name = ? ORDER BY created_at DESC LIMIT 20', [customerId]);
  const [activeOrders] = await req.db.query("SELECT * FROM ss_orders WHERE customer_name = ? AND order_status IN ('queued','in_progress')", [customerId]);
  const [receipts] = await req.db.query('SELECT * FROM ss_receipts WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20', [customerId]);
  res.render('spinspring/customer-dashboard', {
    title: 'My Account', user: req.session.spinUser,
    customer: customerData[0] || {}, orders, activeOrders, receipts
  });
}));

// ============ LOGOUT ============
router.get('/logout', (req, res) => {
  delete req.session.spinUser;
  res.redirect('/');
});

// ============ RECEIPT GENERATION ============
router.post('/attendant/generate-receipt', isAttendant, async (req, res) => {
  try {
    const {
      device_id, customer_id, billing_type, weight_kg, rate_per_kg,
      cycle_price, quantity, discount, payment_method
    } = req.body;

    const receiptNumber = 'RCPT-' + Date.now().toString(36).toUpperCase();
    const orderNumber = 'SS-' + Date.now().toString(36).toUpperCase();

    let subtotal = 0;
    if (billing_type === 'per_weight') {
      subtotal = parseFloat(weight_kg || 0) * parseFloat(rate_per_kg || 0);
    } else {
      subtotal = parseFloat(cycle_price || 0) * parseInt(quantity || 1);
    }

    const discountAmount = parseFloat(discount) || 0;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    let customerName = 'Walk-in';
    let customerPhone = '';
    if (customer_id && customer_id !== 'walk-in') {
      const [customers] = await req.db.query('SELECT * FROM ss_customers WHERE customer_unique_id = ?', [customer_id]);
      if (customers.length > 0) {
        customerName = customers[0].full_name;
        customerPhone = customers[0].phone || '';
      }
    }

    // Save receipt
    await req.db.query(
      `INSERT INTO ss_receipts (receipt_number, order_number, device_id, customer_id, customer_name, customer_phone, billing_type, weight_kg, rate_per_kg, cycle_price, quantity, subtotal, discount, total_amount, payment_method, payment_status, attendant_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`,
      [receiptNumber, orderNumber, device_id, customer_id, customerName, customerPhone, billing_type, weight_kg, rate_per_kg, cycle_price, quantity, subtotal, discountAmount, totalAmount, payment_method, req.session.spinUser.name]
    );

    // Create order (without customer_phone - not in schema)
    await req.db.query(
      "INSERT INTO ss_orders (order_number, device_id, user_id, customer_name, service_type, cycle_type, price, payment_status, order_status) VALUES (?, ?, ?, ?, 'wash', 'normal', ?, 'paid', 'queued')",
      [orderNumber, device_id, req.session.spinUser.ownerId || req.session.spinUser.id, customer_id, totalAmount]
    );

    // Update customer stats
    if (customer_id && customer_id !== 'walk-in') {
      await req.db.query(
        'UPDATE ss_customers SET total_cycles = total_cycles + 1, total_spent = total_spent + ?, loyalty_points = loyalty_points + FLOOR(?/100) WHERE customer_unique_id = ?',
        [totalAmount, totalAmount, customer_id]
      );
    }

    // Update device revenue
    await req.db.query(
      'UPDATE ss_devices SET today_revenue = today_revenue + ?, total_revenue = total_revenue + ? WHERE device_id = ?',
      [totalAmount, totalAmount, device_id]
    );

    req.session.lastReceipt = {
      receipt_number: receiptNumber,
      order_number: orderNumber,
      customer_name: customerName,
      customer_phone: customerPhone,
      billing_type,
      weight_kg,
      rate_per_kg,
      cycle_price,
      quantity,
      subtotal,
      discount: discountAmount,
      total: totalAmount,
      payment_method,
      attendant: req.session.spinUser.name,
      date: new Date()
    };

    res.redirect('/receipt');
  } catch (err) {
    console.error('Receipt error:', err);
    req.flash('error_msg', 'Failed to generate receipt: ' + err.message);
    res.redirect('/attendant');
  }
});

// Display receipt
router.get('/receipt', isAuth, (req, res) => {
  const receipt = req.session.lastReceipt;
  if (!receipt) return res.redirect('/attendant');
  delete req.session.lastReceipt;
  res.render('spinspring/receipt', {
    title: 'Receipt - SpinSpring Express',
    receipt
  });
});

// Owner: All receipts
router.get('/owner/receipts', isOwner, async (req, res) => {
  try {
    const ownerId = req.session.spinUser.id;
    const [receipts] = await req.db.query(
      'SELECT r.*, d.device_name FROM ss_receipts r LEFT JOIN ss_devices d ON r.device_id = d.device_id WHERE d.owner_id = ? ORDER BY r.created_at DESC LIMIT 100',
      [ownerId]
    );
    res.render('spinspring/receipts-list', {
      title: 'Receipts - SpinSpring Express',
      receipts
    });
  } catch (e) {
    res.render('spinspring/receipts-list', { title: 'Receipts', receipts: [] });
  }
});

// ============ LIVE DATA API (AJAX) ============
router.get('/api/live-data', isAuth, async (req, res) => {
  try {
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
    const [devices] = await req.db.query(
      'SELECT device_id, device_name, status, current_cycle, cycle_progress, price_per_cycle, today_revenue, cycles_completed FROM ss_devices WHERE owner_id = ?',
      [ownerId]
    );
    const [activeOrders] = await req.db.query(
      "SELECT order_number, customer_name, service_type, order_status, price FROM ss_orders WHERE user_id = ? AND order_status IN ('queued','in_progress') ORDER BY created_at DESC",
      [ownerId]
    );
    const [stats] = await req.db.query(
      'SELECT COALESCE(SUM(today_revenue),0) as today_rev, COALESCE(SUM(total_revenue),0) as total_rev, COALESCE(SUM(cycles_completed),0) as total_cyc FROM ss_devices WHERE owner_id = ?',
      [ownerId]
    );
    res.json({
      success: true,
      devices: devices || [],
      activeOrders: activeOrders || [],
      stats: stats[0] || {},
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ============ ESP32 SYNC (Enhanced with params & heartbeat) ============
router.post('/api/sync', ah(async (req, res) => {
  const deviceId = req.headers['x-device-id'];
  const apiKey = req.headers['x-api-key'];
  if (!deviceId || !apiKey) return res.status(401).json({ error: 'Missing credentials' });

  const [devices] = await req.db.query('SELECT * FROM ss_devices WHERE device_id = ? AND api_key = ?', [deviceId, apiKey]);
  if (devices.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const data = req.body;

  // ---- 1. Update device status ----
  await req.db.query(
    `UPDATE ss_devices SET status = ?, current_cycle = ?, cycle_progress = ?, cycles_completed = ?, 
      today_revenue = ?, total_revenue = ?, last_sync = NOW() WHERE device_id = ?`,
    [
      data.status || 'idle',
      data.current_cycle || null,
      data.cycle_progress || 0,
      data.cycles_completed || 0,
      data.today_revenue || 0,
      data.total_revenue || 0,
      deviceId
    ]
  );

  // ---- 2. Log heartbeat ----
  try {
    await req.db.query(
      `INSERT INTO ss_heartbeats (device_id, battery_voltage, signal_strength, uptime_seconds, 
        free_memory, current_credit, current_state, firmware_version, error_code, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceId,
        data.battery_voltage || 0,
        data.signal_strength || 0,
        data.uptime_seconds || 0,
        data.free_memory || 0,
        data.current_credit || 0,
        data.status || 'idle',
        data.firmware_version || null,
        data.error_code || null,
        req.ip || null
      ]
    );

    // Prune old heartbeats (keep last 100 per device)
    await req.db.query(
      `DELETE FROM ss_heartbeats WHERE device_id = ? AND id NOT IN (
        SELECT id FROM (SELECT id FROM ss_heartbeats WHERE device_id = ? ORDER BY created_at DESC LIMIT 100) as t
      )`,
      [deviceId, deviceId]
    );
  } catch (e) { console.error('heartbeat log failed:', e.message); }

  // ---- 3. Update running credit from device report ----
  if (typeof data.current_credit === 'number') {
    try {
      await req.db.query(
        'UPDATE ss_machine_params SET current_credit_minutes = ?, firmware_version = ? WHERE device_id = ?',
        [data.current_credit, data.firmware_version || null, deviceId]
      );
    } catch (e) { console.error('credit sync failed:', e.message); }
  }

  // ---- 4. Get pending commands ----
  const [commands] = await req.db.query(
    "SELECT id, command_type, command_value FROM ss_commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10",
    [deviceId]
  );

  // ---- 5. Get pending param changes ----
  const [paramChanges] = await req.db.query(
    "SELECT id, param_name, new_value FROM ss_param_queue WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 20",
    [deviceId]
  );

  // ---- 6. Get current params to send to device ----
  let [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
  if (params.length === 0) {
    await req.db.query('INSERT INTO ss_machine_params (device_id) VALUES (?)', [deviceId]);
    [params] = await req.db.query('SELECT * FROM ss_machine_params WHERE device_id = ?', [deviceId]);
  }
  const p = params[0];

  // ---- 7. Mark commands as sent ----
  if (commands.length > 0) {
    const placeholders = commands.map(() => '?').join(',');
    await req.db.query(`UPDATE ss_commands SET status = 'sent' WHERE id IN (${placeholders})`, commands.map(c => c.id));
  }

  // ---- 8. Mark param changes as sent ----
  if (paramChanges.length > 0) {
    const placeholders = paramChanges.map(() => '?').join(',');
    await req.db.query(`UPDATE ss_param_queue SET status = 'sent', sent_at = NOW() WHERE id IN (${placeholders})`, paramChanges.map(c => c.id));
  }

  // ---- 9. Build response for ESP32 ----
  res.json({
    status: 'success',
    server_time: new Date().toISOString(),
    commands: commands.map(c => {
      let parsedVal = c.command_value;
      try { parsedVal = JSON.parse(c.command_value); } catch (e) {}
      return { id: c.id, type: c.command_type, value: parsedVal };
    }),
    param_changes: paramChanges.map(p => ({ id: p.id, name: p.param_name, value: p.new_value })),
    config: {
      pulses_per_credit: p.pulses_per_credit,
      accumulate_payments: p.accumulate_payments === 1,
      max_credit_minutes: p.max_credit_minutes,
      min_credit_to_start: p.min_credit_to_start,
      pulse_width_ms: p.pulse_width_ms,
      pulse_gap_ms: p.pulse_gap_ms,
      start_pulse_duration_ms: p.start_pulse_duration_ms,
      run_time_per_credit_min: p.run_time_per_credit_min,
      cooldown_period_sec: p.cooldown_period_sec
    }
  });
}));

// ---- Command acknowledgement endpoint ----
router.post('/api/sync/ack', ah(async (req, res) => {
  const deviceId = req.headers['x-device-id'];
  const apiKey = req.headers['x-api-key'];
  if (!deviceId || !apiKey) return res.status(401).json({ error: 'Missing credentials' });

  const [devices] = await req.db.query('SELECT id FROM ss_devices WHERE device_id = ? AND api_key = ?', [deviceId, apiKey]);
  if (devices.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const { command_ids = [], param_ids = [], success = true, error: errMsg = null } = req.body;

  if (Array.isArray(command_ids) && command_ids.length > 0) {
    const ph = command_ids.map(() => '?').join(',');
    await req.db.query(
      `UPDATE ss_commands SET status = ? WHERE id IN (${ph})`,
      [success ? 'executed' : 'failed', ...command_ids]
    );
  }

  if (Array.isArray(param_ids) && param_ids.length > 0) {
    const ph = param_ids.map(() => '?').join(',');
    if (success) {
      await req.db.query(
        `UPDATE ss_param_queue SET status = 'applied', applied_at = NOW() WHERE id IN (${ph})`,
        param_ids
      );
    } else {
      await req.db.query(
        `UPDATE ss_param_queue SET status = 'failed', retry_count = retry_count + 1, last_error = ? WHERE id IN (${ph})`,
        [errMsg, ...param_ids]
      );
    }
  }

  res.json({ success: true });
}));

router.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({
    time: now.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour12: false }),
    date: now.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })
  });
});
router.get('/receipts', isAttendant, async (req, res) => {
  try {
    const ownerId = req.session.spinUser.ownerId || req.session.spinUser.id;
    const [receipts] = await req.db.query(
      'SELECT r.*, d.device_name FROM ss_receipts r ' +
      'LEFT JOIN ss_devices d ON r.device_id = d.device_id ' +
      'WHERE d.owner_id = ? ORDER BY r.created_at DESC LIMIT 100',
      [ownerId]
    );
    res.render('spinspring/receipts-list', {
      title: 'Receipts',
      user: req.session.spinUser,
      receipts
    });
  } catch (e) {
    res.render('spinspring/receipts-list', {
      title: 'Receipts',
      user: req.session.spinUser,
      receipts: []
    });
  }
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
  req.flash('success_msg', 'Defaults saved');
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
  } catch (e) { }
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

if (require.main === module) {
  console.log('spinspring router stack size:', router.stack.length);
  router.stack.forEach((l) => {
    if (l.route) console.log(' ', Object.keys(l.route.methods).join(',').toUpperCase(), l.route.path);
  });
}

module.exports = router;