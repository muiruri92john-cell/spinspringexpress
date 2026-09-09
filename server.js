require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const app = express();

// Behind cPanel/Apache proxy — needed for secure cookies + correct protocol.
app.set('trust proxy', 1);

// ---- LIGHTWEIGHT PROBES FIRST (no session/DB/flash deps) ----
// If THESE 404, traffic never reached Node (Passenger mapping / app stopped).
// If these answer but '/' 403s, Apache served public_html instead of Node.
app.get(['/health', '/healthz', '/ping'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'spinspringexpress',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root debug: proves Node owns '/' and shows mount state (remove later).
app.get('/debug-root', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Node owns this domain root',
    originalUrl: req.originalUrl,
    path: req.path,
    host: req.get('host')
  });
});

// Database pool (shared) — loaded AFTER probes so probes stay dependency-free.
const db = require('./config/database');
const { sessionStore, closeSessionStore } = require('./config/sessionStore');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
    maxAge: 24 * 60 * 60 * 1000, // 24h
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction // requires trust proxy + HTTPS in production
  }
}));
app.use(flash());

app.use((req, res, next) => {
  req.db = db;
  // Short request id for correlating logs with what the user sees
  req.requestId = Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
  res.locals.success_msg = req.flash('success_msg') || [];
  res.locals.error_msg = req.flash('error_msg') || [];
  res.locals.user = req.session.spinUser || null;
  res.locals.requestId = req.requestId;
  next();
});

// Deep health (DB + session store) — use when /health is ok but pages fail.
app.get('/health/db', (req, res, next) => Promise.resolve((async () => {
  const checks = { time: new Date().toISOString(), sessionStore: 'unknown', db: 'unknown' };
  try {
    await db.query('SELECT 1');
    checks.db = 'connected';
  } catch (e) {
    checks.db = 'disconnected: ' + e.message;
  }
  try {
    // express-mysql-session exposes the pool via .pool (v3); fall back gracefully.
    const pool = sessionStore && sessionStore.pool;
    if (pool && typeof pool.query === 'function') {
      await pool.query('SELECT 1');
      checks.sessionStore = 'connected';
    } else {
      checks.sessionStore = 'configured (MemoryStore warning gone)';
    }
  } catch (e) {
    checks.sessionStore = 'error: ' + e.message;
  }
  const ok = checks.db === 'connected';
  res.status(ok ? 200 : 500).json({ status: ok ? 'ok' : 'error', ...checks });
})()).catch(next));

// SpinSpring routes (dual mounts = both URL styles work).
// Domain-root deploy (spinspringexpress.co.ke/): '/' mount serves everything,
// '/spinspg' mount keeps every absolute /spinspg/... link in views working.
const spinRoutes = require('./routes/spinspring');
app.use('/', spinRoutes);
app.use('/spinspg', spinRoutes);

// Direct aliases at app level (belt-and-suspenders): if a proxy strips or
// keeps a prefix unexpectedly, these still answer on the domain root.
// NOTE: /health* and /debug-root are defined at the TOP of this file on purpose.
// The plain /ping self-test MUST be reachable even if an old cached
// routes/spinspring.js throws during require().
app.get('/ping-selftest', (req, res) => {
  res.status(200).json({ status: 'ok', selftest: 'server.js alive without routes' });
});
['/login', '/register', '/owner', '/attendant', '/customer',
 '/attendant-login', '/customer-login', '/orders', '/reports',
 '/settings', '/register-device', '/logout', '/mpesa-settings'
].forEach((p) => {
  app.get('/spinspg' + p, (req, res) => res.redirect(p));
});

// 404 — always visible, never a blank page
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

// Visible error handler — every failure renders something, never hangs/blank
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const ref = req.requestId || 'NOREF';
  // Always log full error server-side with request context
  console.error(`[${ref}] ${req.method} ${req.originalUrl} -> ${status}:`, err.stack || err);

  // Persist for admin review (best effort, never throws)
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

  // DB/session outages get an explicit banner, not a generic 500
  const rootMsg = String((err && err.message) || '');
  const outageHint = /ECONNREFUSED|ENOTFOUND|ER_ACCESS_DENIED|Can't connect|Connection lost|pool is closed|session store/i.test(rootMsg)
    ? ' (Database/session unavailable — check DB_HOST/DB_USER/DB_PASSWORD/DB_NAME and that MySQL is running)'
    : '';

  // API / ESP32 callers get JSON (they cannot render HTML)
  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(status).json({
      error: friendly + outageHint,
      message: (err && err.message) || friendly,
      requestId: ref,
      ...(isProduction ? {} : { stack: err && err.stack })
    });
  }

  // Flash so the message survives a redirect, but ALSO render it now
  // so the user sees it even if the next page swallows flash.
  if (typeof req.flash === 'function') {
    try { req.flash('error_msg', `${friendly}${outageHint} (Ref: ${ref})${isProduction ? '' : ': ' + ((err && err.message) || '')}`); } catch (e) { /* session may be broken */ }
  }
  try {
    return res.status(status).render('spinspring/error', {
      title: friendly,
      status,
      message: `${friendly}${outageHint} (Ref: ${ref})`,
      // In dev show the real message + stack; in production hide internals
      detail: isProduction ? null : ((err && err.message ? err.message + '\n\n' : '') + (err && err.stack ? err.stack : '')),
      requestId: ref,
      user: req.session ? req.session.spinUser || null : null
    });
  } catch (renderErr) {
    // Last resort: error page itself failed — never leave user with blank screen
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

const PORT = process.env.PORT || 3000;
// Local / plain-VPS boot: `node server.js` listens here.
// Under cPanel Passenger, server.js is require()d (require.main !== module),
// so this block is SKIPPED and app.js (the startup file) boots the listener.
// That split is intentional: exactly ONE listen call per process.
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
  // Force exit if pools hang (shared-hosting safety net)
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
