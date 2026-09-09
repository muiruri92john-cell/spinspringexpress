// cPanel Passenger (CloudLinux) entry point.
// IMPORTANT: Passenger loads this file with require(), NOT as `node app.js`,
// so `require.main === module` is FALSE inside server.js and its
// `app.listen()` block never runs. That left zero listening sockets:
// /ping -> Apache 404, / -> Passenger "Internal Server Error".
// Fix: boot the listener HERE, explicitly.
const app = require('./server.js');

const PORT = process.env.PORT || 3000;

// Startup diagnostics — visible in cPanel >> Setup Node.js App >> logs.
console.log(`[spinspring] boot: node ${process.version}, PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV || 'unset'}`);

// Surface crashes in logs instead of silent Passenger 500s.
process.on('uncaughtException', (err) => {
  console.error('[spinspring] UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[spinspring] UNHANDLED REJECTION:', reason && reason.stack ? reason.stack : reason);
});

// Passenger (CloudLinux) requires the app to listen itself; it injects PORT.
const server = app.listen(PORT, () => {
  console.log(`[spinspring] listening on port ${PORT}`);
});

module.exports = server;

