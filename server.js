require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const app = express();

// Database pool (shared)
const db = require('./config/database');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'spinspring_2026',
  resave: false,
  saveUninitialized: false
}));
app.use(flash());

app.use((req, res, next) => {
  req.db = db;
  res.locals.success_msg = req.flash('success_msg') || [];
  res.locals.error_msg = req.flash('error_msg') || [];
  res.locals.user = req.session.spinUser || null;
  next();
});

// Health check (for hosting / debugging)
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: e.message });
  }
});

// SpinSpring routes.
// Mount on BOTH '/' and '/spinspg' so every existing view link works
// locally (/) and in production under sub-path (/spinspg).
const spinRoutes = require('./routes/spinspring');
app.use('/', spinRoutes);
app.use('/spinspg', spinRoutes);

// 404
app.use((req, res) => {
  res.status(404).send('<h1>404 - Not Found</h1><a href="/">Home</a>');
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
  res.status(500).send('<h1>500 - Server Error</h1><p>' + (err.message || '') + '</p><a href="/">Home</a>');
});

const PORT = process.env.PORT || 3000;
// cPanel Passenger: export app, do NOT call listen (Passenger owns the socket).
// Plain VPS / local: app.listen when file is run directly.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('SpinSpring running on port ' + PORT);
  });
}

module.exports = app;
