require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const app = express();

// Behind cPanel/Apache proxy — needed for secure cookies + correct protocol.
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE (must run BEFORE route handlers)
// ─────────────────────────────────────────────────────────────

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsers — MUST come before any route that uses req.body
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// LIGHTWEIGHT PROBES (no session/DB/flash needed)
// ─────────────────────────────────────────────────────────────
app.get(['/health', '/healthz', '/ping'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'spinspringexpress',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/debug-root', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Node owns this domain root',
    originalUrl: req.originalUrl,
    path: req.path,
    host: req.get('host')
  });
});

app.get('/ping-selftest', (req, res) => {
  res.status(200).json({ status: 'ok', selftest: 'server.js alive without routes' });
});

// ─────────────────────────────────────────────────────────────
// DATABASE + SESSION STORE
// ─────────────────────────────────────────────────────────────
const db = require('./config/database');
const { sessionStore, closeSessionStore } = require('./config/sessionStore');

// ─────────────────────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Set it in the cPanel Node app env.');
  process.exit(1);
}

app.use(session({
  name: 'spinspring.sid',
  secret: process.env.SESSION_SECRET || 'spinspring_2026_dev_only',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  }
}));

app.use(flash());

// ─────────────────────────────────────────────────────────────
// ATTACH req.db + locals (must run BEFORE routes)
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.db = db;
  req.requestId = Math.random().toString(36).slice(2, 8).toUpperCase()
                + Date.now().toString(36).slice(-4).toUpperCase();
  res.locals.success_msg = req.flash('success_msg') || [];
  res.locals.error_msg = req.flash('error_msg') || [];
  res.locals.user = req.session.spinUser || null;
  res.locals.requestId = req.requestId;
  next();
});

// ─────────────────────────────────────────────────────────────
// ROUTES (NOW they can safely use req.db)
// ─────────────────────────────────────────────────────────────

// Main routes (dual mounts = both URL styles work)
const spinRoutes = require('./routes/spinspring');
app.use('/', spinRoutes);
app.use('/spinspg', spinRoutes);

// Location routes
const locationRoutes = require('./routes/locations');
app.use('/', locationRoutes);

// Public location routes
const publicLocationRoutes = require('./routes/public-locations');
app.use('/', publicLocationRoutes);

// Reviews routes
const reviewRoutes = require('./routes/reviews');
app.use('/', reviewRoutes);

// Public find-nearest page
app.get('/find-location', (req, res) => {
  res.render('spinspring/find-location', {
    title: 'Find Nearest Branch - SpinSpring Express',
    user: req.session.spinUser || null,
  });
});

// ─────────────────────────────────────────────────────────────
// ALIASES (redirect /spinspg/* → /*)
// ─────────────────────────────────────────────────────────────
['/login', '/register', '/owner', '/attendant', '/customer',
 '/attendant-login', '/customer-login', '/orders', '/reports',
 '/settings', '/register-device', '/logout', '/mpesa-settings',
 '/reviews', '/find-location', '/receipts'
].forEach((p) => {
  app.get('/spinspg' + p, (req, res) => res.redirect(p));
});

// ─────────────────────────────────────────────────────────────
// DEEP HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get('/health/db', (req, res, next) => Promise.resolve((async () => {
  const checks = { time: new Date().toISOString(), sessionStore: 'unknown', db: 'unknown' };
  try {
    await db.query('SELECT 1');
    checks.db = 'connected';
  } catch (e) {
    checks.db = 'disconnected: ' + e.message;
  }
  try {
    const pool = sessionStore && sessionStore.pool;
    if (pool && typeof pool.query === 'function') {
      await pool.query('SELECT 1');
      checks.sessionStore = 'connected';
    } else {
      checks.sessionStore = 'configured';
    }
  } catch (e) {
    checks.sessionStore = 'error: ' + e.message;
  }
  const ok = checks.db === 'connected';
  res.status(ok ? 200 : 500).json({ status: ok ? 'ok' : 'error', ...checks });
})()).catch(next));

// ─────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  const msg = 'Page not found: ' + req.originalUrl;
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', message: msg, requestId: req.requestId });
  }
  if (typeof req.flash === 'function') req.flash('error_msg', msg);
  res.status(404).render('spinspring/error', {
    title: 'Page Not Found',
    status: 404,
    message: msg,
    detail: isProduction ? null : ('Method: ' + req.method + '\nURL: ' + req.originalUrl),
    requestId: req.requestId,
    user: req.session ? req.session.spinUser || null : null
  });
});

// ─────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const ref = req.requestId || 'NOREF';

  console.error(`[${ref}] ${req.method} ${req.originalUrl} -> ${status}:`, err.stack || err);

  // Persist error (best effort)
  try {
    db.query(
      'CREATE TABLE IF NOT EXISTS ss_error_logs (id INT AUTO_INCREMENT PRIMARY KEY, ref VARCHAR(20), method VARCHAR(10), url VARCHAR(500), status INT, message TEXT, stack MEDIUMTEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB'
    ).then(() => db.query(
      'INSERT INTO ss_error_logs (ref, method, url, status, message, stack) VALUES (?, ?, ?, ?, ?, ?)',
      [ref, req.method, req.originalUrl, status, String((err && err.message) || err).slice(0, 2000), String((err && err.stack) || err).slice(0, 8000)]
    )).catch((e) => console.error('error-log write failed:', e.message));
  } catch (e) { console.error('error-log setup failed:', e.message); }

  const friendly = status === 404 ? 'Page not found'
    : status === 403 ? 'Access denied'
    : status === 401 ? 'Please login first'
    : 'Something went wrong on our side';

  const rootMsg = String((err && err.message) || '');
  const outageHint = /ECONNREFUSED|ENOTFOUND|ER_ACCESS_DENIED|Can't connect|Connection lost|pool is closed|session store/i.test(rootMsg)
    ? ' (Database/session unavailable — check DB_* env vars and MySQL)'
    : '';

  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(status).json({
      error: friendly + outageHint,
      message: (err && err.message) || friendly,
      requestId: ref,
      ...(isProduction ? {} : { stack: err && err.stack })
    });
  }

  if (typeof req.flash === 'function') {
    try { req.flash('error_msg', `${friendly}${outageHint} (Ref: ${ref})`); } catch (e) {}
  }

  try {
    return res.status(status).render('spinspring/error', {
      title: friendly,
      status,
      message: `${friendly}${outageHint} (Ref: ${ref})`,
      detail: isProduction ? null : ((err && err.message ? err.message + '\n\n' : '') + (err && err.stack ? err.stack : '')),
      requestId: ref,
      user: req.session ? req.session.spinUser || null : null
    });
  } catch (renderErr) {
    console.error(`[${ref}] error-page render failed:`, renderErr.message);
    if (!res.headersSent) {
      res.status(status).send(
        `<h1>${status} - ${friendly}${outageHint}</h1><p>Ref: ${ref}</p>` +
        (isProduction ? '' : `<pre>${String((err && err.message) || err)}</pre>`) +
        `<a href="/">Home</a>`
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────
// LISTEN (only for direct node server.js — Passenger uses app.js)
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
let server = null;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('SpinSpring running on port ' + PORT);
  });
}

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  const closeHttp = server
    ? new Promise((resolve) => server.close(resolve))
    : Promise.resolve();
  closeHttp.finally(() => {
    try { closeSessionStore(); } catch (e) { console.error(e.message); }
    const dbPool = db;
    if (dbPool && typeof dbPool.end === 'function') {
      dbPool.end().catch(() => {}).finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;