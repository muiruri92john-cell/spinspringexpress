# ============================================================
# SpinSpring Express — DEPLOY CHECKLIST (spinspringexpress.co.ke)
# Domain: spinspringexpress.co.ke | cPanel user: buxbtreu
# App folder: /home/buxbtreu/spinspringexpress
# Node.js: Passenger (CloudLinux) via "Setup Node.js App"
# ============================================================

DIAGNOSIS of "/health 404 + landing 403":
  /health 404  => request NEVER reached Node. Cause is ALWAYS one of:
    (a) Node app STOPPED / failed to start (missing module, SESSION_SECRET
        missing in production, DB require crash, wrong startup file), OR
    (b) Application URL in "Setup Node.js App" does not cover /health
        (e.g. app registered at /spinspg only, or wrong domain), OR
    (c) public_html/.htaccess rewrites/proxies /health away (restored safe file).
  landing 403  => request WAS answered by Apache static handler, NOT Node.
    Means Passenger is NOT owning '/' for this domain: app stopped or mapped
    to a sub-URI only, so Apache tries to list public_html and 403s.

  FIX ORDER (do not skip): 1) confirm app RUNNING, 2) confirm URL mapping,
  3) safe .htaccess, 4) retest probes /health + /debug-root, 5) then pages.

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

5) VERIFY (in order — STOP at first failure, fix, then continue):
   a) https://spinspringexpress.co.ke/ping       (dependency-free probe)
      https://spinspringexpress.co.ke/health     (same)
      https://spinspringexpress.co.ke/healthz    (same)
      -> {"status":"ok","app":"spinspringexpress",...}
      STILL 404? Node never got the request: app STOPPED/crashed or
      Application URL mapping wrong. Check app logs, START/RESTART, confirm
      startup file = app.js and URL = https://spinspringexpress.co.ke/.
   b) https://spinspringexpress.co.ke/debug-root
      -> {"status":"ok","message":"Node owns this domain root",...}
      If (a) works but this 404s, re-upload server.js (probes live there).
   c) https://spinspringexpress.co.ke/health/db
      -> {"status":"ok","db":"connected","sessionStore":"connected",...}
      If "disconnected: ..." fix DB env vars / import schema, Restart.
   d) https://spinspringexpress.co.ke/            (landing — was 403)
      403 GONE only when Passenger owns '/': app RUNNING + URL = domain root.
      If still 403: app not running for this domain, OR Apache is serving
      public_html instead (check: /health answers but / 403s = mapping issue).
   e) https://spinspringexpress.co.ke/register    (create owner)
   f) https://spinspringexpress.co.ke/login       (owner login -> /owner)
   g) /register-device -> device-credentials page -> /device/:id
   h) Logout, /attendant-login, /customer-login flows.
   i) Any failure shows the styled error page with Ref: XXXXXX + flash banner;
      match Ref in: cPanel >> Setup Node.js App >> logs (stderr), /health/db,
      and table ss_error_logs.

6) TROUBLESHOOTING:
   - "/ping still 404 after uploading app.js" — you did NOT restart correctly.
     CloudLinux caches the old entry file. Do EXACTLY: Setup Node.js App >>
     STOP, wait 10s, START (not just Restart). Then re-upload check: open
     File Manager /home/buxbtreu/spinspringexpress/app.js — first line must be
     "// cPanel Passenger (CloudLinux) entry point." If it still shows the old
     3-line file, your upload went to the wrong folder.
     Also confirm: Application root EXACTLY /home/buxbtreu/spinspringexpress,
     startup file EXACTLY app.js, URL covers / (domain root).
     Proof the NEW file is live: logs must contain "[spinspring] boot:".
     No boot line = old code still running or app stopped.
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
