const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const app = express();

const mysql = require('mysql2/promise');
const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'buxbtreu_spinspringuser',
  password: process.env.DB_PASSWORD || 'spinspring@2026',
  database: process.env.DB_NAME || 'buxbtreu_spinspringwebappdb',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'spinspring_secure_session_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000, httpOnly: true }
}));
app.use(flash());

app.use((req, res, next) => {
  req.db = db;
  res.locals.success_msg = req.flash('success_msg') || [];
  res.locals.error_msg = req.flash('error_msg') || [];
  res.locals.user = req.session.spinUser || null;
  res.locals.year = new Date().getFullYear();
  next();
});

// Routes
app.use('/', require('./routes/spinspring'));

// 404
app.use((req, res) => {
  res.status(404).render('spinspring/404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).send('<h1>500 - Server Error</h1><a href="/">Home</a>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SpinSpring Express running on port ${PORT}`);
});