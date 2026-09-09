// Persistent session store backed by the existing MySQL database.
// Replaces express-session's default MemoryStore (leaks memory, single-process only).
// Table `sessions` is auto-created on first connect (needs CREATE privilege;
// otherwise import config/schema.sql which also defines it).
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
require('dotenv').config();

const storeOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'buxbtreu_spinspringuser',
  password: process.env.DB_PASSWORD || 'spinspring@2026',
  database: process.env.DB_NAME || 'buxbtreu_spinspringwebappdb',
  charset: 'utf8mb4',
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  },
  // 24h session lifetime, prune expired rows every 15 min
  expiration: 24 * 60 * 60 * 1000,
  checkExpirationInterval: 15 * 60 * 1000
};

const sessionStore = new MySQLStore(storeOptions);

// Never let a session-store DB blip crash the app; log it instead.
sessionStore.on('error', (err) => {
  console.error('Session store error:', err.message);
});

// express-mysql-session opens its own pool; close it on shutdown.
function closeSessionStore() {
  try {
    if (typeof sessionStore.close === 'function') sessionStore.close();
  } catch (e) { console.error('Error closing session store:', e.message); }
}

module.exports = { sessionStore, closeSessionStore };
