# ============================================================
# SpinSpring Express — DEPLOY CHECKLIST (spinspringexpress.co.ke)
# Domain: spinspringexpress.co.ke | cPanel user: buxbtreu
# App folder: /home/buxbtreu/spinspringexpress
# Node.js: Passenger (CloudLinux) via "Setup Node.js App"
# ============================================================

1) FILES — upload project to /home/buxbtreu/spinspringexpress (NOT public_html):
   app.js, server.js, package.json, .env, config/, routes/, views/,
   public/, tmp/ (empty, 755). Do NOT upload node_modules (run NPM Install
   in cPanel instead). NEVER put .env / server.js / node_modules in public_html.

2) cPanel >> Setup Node.js App:
   - Node.js version : 18 or 20 (LTS)
   - Application mode: production
   - Application root: /home/buxbtreu/spinspringexpress
   - Application URL : https://spinspringexpress.co.ke/   (domain root; see note below)
   - Application startup file: app.js   (NOT server.js)
   - Environment variables (add ALL of these):
       NODE_ENV=production
       PORT=<the port cPanel assigns — leave app default, Passenger overrides>
       DB_HOST=127.0.0.1
       DB_USER=buxbtreu_spinspringuser
       DB_PASSWORD=spinspring@2026
       DB_NAME=buxbtreu_spinspringwebappdb
       DB_PORT=3306
       SESSION_SECRET=<long random hex, same as .env>
     Generate secret on any machine with node:
       node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   - Run "NPM Install", then START / RESTART the app.

   NOTE on URL: because you serve from the DOMAIN ROOT, keep BOTH mounts in
   server.js (app.use('/', spinRoutes); app.use('/spinspg', spinRoutes);).
   All old /spinspg/... links keep working and /... links work too.
   If instead you set Application URL to spinspringexpress.co.ke/spinspg,
   Passenger strips the prefix — the '/' mount handles the app, '/spinspg'
   mount keeps absolute links in views working.

3) DATABASE (cPanel >> phpMyAdmin, user buxbtreu_spinspringuser):
   - Import config/schema.sql ONCE into buxbtreu_spinspringwebappdb
     (creates ss_users, ss_devices, ss_attendants, ss_customers,
      ss_orders, ss_commands, ss_mpesa_config, sessions, ss_error_logs).
   - Verify: SELECT COUNT(*) FROM sessions;  SHOW TABLES;

4) public_html — ONLY .htaccess + coming-soon/landing static (optional):
   - Safe .htaccess content is in /.htaccess of this project (do NOT add
     ProxyPass / Passenger directives there — they cause 500 on shared hosts
     without mod_proxy/mod_passenger in Apache).
   - Passenger serves the Node app for the domain; Apache .htaccess only
     handles HTTPS redirect + file protection. Keep Node files OUT of public_html.

5) VERIFY (in order):
   a) https://spinspringexpress.co.ke/health
      -> {"status":"ok","db":"connected","sessionStore":"connected",...}
      If db shows "disconnected: ..." the visible error page + logs carry the same
      message — fix env vars, then Restart app.
   b) https://spinspringexpress.co.ke/            (landing)
   c) https://spinspringexpress.co.ke/register    (create owner)
   d) https://spinspringexpress.co.ke/login       (owner login -> /owner)
   e) /register-device -> device-credentials page -> /device/:id
   f) Logout, /attendant-login, /customer-login flows.
   g) Any failure shows the styled error page with Ref: XXXXXX + flash banner;
      match Ref in: cPanel >> Setup Node.js App >> logs (stderr), /health,
      and table ss_error_logs.

6) TROUBLESHOOTING:
   - "Internal Server Error" on every page -> rename public_html/.htaccess to
     .htaccess.bak and reload. Loads now = bad .htaccess (restore ours).
     Still 500 = app failed to start: check Node app logs (missing module?
     SESSION_SECRET missing? DB refused? wrong startup file?).
   - "Cannot GET /spinspg/..." -> Application URL mismatch; both mounts are
     enabled so re-check the URL you registered and Restart.
   - Sessions lost on restart / MemoryStore warning -> SESSION_SECRET unset or
     sessions table missing; check env + import schema.
   - 404 on /css/spinspring.css -> public/ not deployed; views link /css/... and
     /js/spinspring.js — keep public/ intact.
