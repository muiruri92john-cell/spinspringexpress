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

const AttendantModel = require('../models/attendant');

router.get('/owner/attendants', isOwner, ah(async (req, res) => {
  const model = new AttendantModel(req.db);
  const ownerId = req.session.spinUser.id;

  const [attendants, stats, locations] = await Promise.all([
    model.listByOwner(ownerId),
    model.getStats(ownerId),
    req.db.query(
      'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name',
      [ownerId]
    ).then(([rows]) => rows)
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

const CustomerModel = require('../models/customer');
const bcrypt = require('bcryptjs');

router.get('/owner/customers', isOwner, ah(async (req, res) => {
  const model = new CustomerModel(req.db);
  const ownerId = req.session.spinUser.id;

  const [customers, stats, locations] = await Promise.all([
    model.listByOwner(ownerId),
    model.getStats(ownerId),
    req.db.query(
      'SELECT id, location_name FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name',
      [ownerId]
    ).then(([rows]) => rows)
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