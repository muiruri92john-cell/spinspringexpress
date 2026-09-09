const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const app = express();

// Database
const mysql = require('mysql2/promise');
const db = mysql.createPool({
  host: '127.0.0.1',
  user: 'buxbtreu_spinspringuser',
  password: 'spinspring@2026',
  database: 'buxbtreu_spinspringwebappdb',
  port: 3306
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'spinspring_2026', resave: false, saveUninitialized: false }));
app.use(flash());

app.use((req, res, next) => {
  req.db = db;
  res.locals.success_msg = req.flash('success_msg') || [];
  res.locals.error_msg = req.flash('error_msg') || [];
  res.locals.user = req.session.spinUser || null;
  next();
});

// Use SpinSpring routes
app.use('/', require('./routes/spinspring'));

// 404
app.use((req, res) => {
  res.status(404).send('<h1>404 - Not Found</h1><a href="/">Home</a>');
});

// Error
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).send('<h1>500 - Server Error</h1><p>' + err.message + '</p>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('SpinSpring running on port ' + PORT);
});