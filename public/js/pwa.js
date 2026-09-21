// =====================================================
// public/js/pwa.js — PWA install + update + network status
// Phase 3: iOS install flow + update UX + offline analytics queue
// =====================================================

(function () {
  'use strict';

  const PWA_VERSION = 'v3.0.0-phase3';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
  const isDebug = new URLSearchParams(location.search).has('debug');

  // ─────────────────────────────────────────────────
  // Service Worker registration
  // ─────────────────────────────────────────────────
  let swRegistration = null;
  let updateAvailable = false;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          swRegistration = reg;
          if (isDebug) console.log('[PWA] SW registered:', reg.scope);

          // Periodic update check (hourly)
          setInterval(() => reg.update(), 60 * 60 * 1000);

          // Detect new SW
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                updateAvailable = true;
                showUpdateBanner();
              }
            });
          });

          // Listen for SW takeover
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (isDebug) console.log('[PWA] New SW took control');
          });
        })
        .catch((err) => {
          if (isDebug) console.warn('[PWA] SW registration failed:', err);
        });
    });
  }

  // ─────────────────────────────────────────────────
  // INSTALL PROMPT — Android/Desktop (Chrome, Edge)
  // ─────────────────────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (isDebug) console.log('[PWA] Install prompt available');

    // Snooze check — don't show if dismissed in last 7 days
    const dismissedUntil = parseInt(localStorage.getItem('pwa-install-dismissed-until') || '0', 10);
    if (Date.now() > dismissedUntil && !isStandalone) {
      showInstallBanner('android');
    }
  });

  window.addEventListener('appinstalled', () => {
    if (isDebug) console.log('[PWA] App installed');
    hideInstallBanner();
    deferredPrompt = null;
    if (window.gtag) gtag('event', 'pwa_install', { event_category: 'PWA' });
  });

  // ─────────────────────────────────────────────────
  // INSTALL PROMPT — iOS (manual instructions)
  // ─────────────────────────────────────────────────
  function maybeShowIOSInstall() {
    if (!isIOS) return;
    if (isStandalone) return;
    if (isDebug) console.log('[PWA] iOS — checking install snooze');

    const dismissedUntil = parseInt(localStorage.getItem('pwa-ios-dismissed-until') || '0', 10);
    if (Date.now() > dismissedUntil) {
      // Delay to not interrupt initial load
      setTimeout(() => showInstallBanner('ios'), 3000);
    }
  }

  function showInstallBanner(platform) {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';

    if (platform === 'ios') {
      banner.innerHTML = `
        <div style="position:fixed;bottom:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:#fff;color:#1f2937;border-radius:14px;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,0.18);z-index:9999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border:1px solid #e5e7eb;">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <img src="/icon-192x192.png" alt="SpinSpring" style="width:48px;height:48px;border-radius:11px;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:4px;">Install SpinSpring</div>
              <div style="font-size:13px;color:#6b7280;line-height:1.5;">
                Tap <strong style="color:#0284c7;">Share</strong>
                <svg style="display:inline;width:14px;height:14px;vertical-align:-2px;fill:#0284c7;margin:0 2px;" viewBox="0 0 24 24"><path d="M12 2l4 4h-3v6h-2V6H8l4-4zm-7 8v10h14V10h-2v8H7v-8H5z"/></svg>
                then <strong style="color:#0284c7;">"Add to Home Screen"</strong>
              </div>
            </div>
            <button id="pwa-install-no" style="background:none;border:none;color:#9ca3af;font-size:22px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">&times;</button>
          </div>
          <button id="pwa-install-yes" style="margin-top:12px;width:100%;background:#0284c7;color:#fff;border:none;padding:11px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;">Got it</button>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="position:fixed;bottom:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:#fff;color:#1f2937;border-radius:12px;padding:16px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.15);z-index:9999;display:flex;align-items:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border:1px solid #e5e7eb;">
          <img src="/icon-192x192.png" alt="SpinSpring" style="width:44px;height:44px;border-radius:10px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;color:#0f172a;">Install SpinSpring</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px;">Add to home screen for faster access</div>
          </div>
          <button id="pwa-install-yes" style="background:#0284c7;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;flex-shrink:0;">Install</button>
          <button id="pwa-install-no" style="background:none;border:none;color:#9ca3af;font-size:20px;cursor:pointer;padding:0 4px;flex-shrink:0;">&times;</button>
        </div>
      `;
    }

    document.body.appendChild(banner);

    document.getElementById('pwa-install-yes').addEventListener('click', async () => {
      if (platform === 'ios') {
        localStorage.setItem('pwa-ios-dismissed-until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
        hideInstallBanner();
        return;
      }
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (isDebug) console.log('[PWA] User choice:', outcome);
      deferredPrompt = null;
      hideInstallBanner();
    });

    document.getElementById('pwa-install-no').addEventListener('click', () => {
      const key = platform === 'ios' ? 'pwa-ios-dismissed-until' : 'pwa-install-dismissed-until';
      localStorage.setItem(key, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
      hideInstallBanner();
    });
  }

  function hideInstallBanner() {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  }

  // Kick off iOS check
  maybeShowIOSInstall();

  // ─────────────────────────────────────────────────
  // UPDATE BANNER
  // ─────────────────────────────────────────────────
  function showUpdateBanner() {
    if (document.getElementById('pwa-update-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
      <div style="position:fixed;top:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:#10b981;color:#fff;border-radius:12px;padding:14px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.15);z-index:9999;display:flex;align-items:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="flex:1;font-size:14px;font-weight:500;">A new version is available</div>
        <button id="pwa-update-yes" style="background:#fff;color:#10b981;border:none;padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">Update</button>
        <button id="pwa-update-no" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px;">&times;</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-update-yes').addEventListener('click', applyUpdate);
    document.getElementById('pwa-update-no').addEventListener('click', () => {
      banner.remove();
      // Snooze update banner for 1 hour
      setTimeout(() => { if (updateAvailable) showUpdateBanner(); }, 60 * 60 * 1000);
    });
  }

  function applyUpdate() {
    if (swRegistration && swRegistration.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    if (window.gtag) gtag('event', 'pwa_update', { event_category: 'PWA' });
    setTimeout(() => window.location.reload(), 300);
  }

  // ─────────────────────────────────────────────────
  // NETWORK STATUS
  // ─────────────────────────────────────────────────
  function showNetworkStatus(online) {
    const existing = document.getElementById('pwa-network-status');
    if (existing) existing.remove();

    if (online) {
      const el = document.createElement('div');
      el.id = 'pwa-network-status';
      el.textContent = '✓ Back online';
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2500);

      // Flush offline analytics queue
      flushAnalyticsQueue();
    } else {
      const el = document.createElement('div');
      el.id = 'pwa-network-status';
      el.textContent = "You're offline";
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:#fff;padding:8px 20px;text-align:center;font-size:13px;font-weight:600;z-index:9999;';
      document.body.appendChild(el);
    }
  }

  window.addEventListener('online', () => showNetworkStatus(true));
  window.addEventListener('offline', () => showNetworkStatus(false));

  if (!navigator.onLine) showNetworkStatus(false);

  // ─────────────────────────────────────────────────
  // FOREGROUND SYNC — check for updates when tab returns
  // ─────────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swRegistration) {
      swRegistration.update().catch(() => {});
    }
  });

  // ─────────────────────────────────────────────────
  // OFFLINE ANALYTICS QUEUE
  // ─────────────────────────────────────────────────
  function queueAnalytics(eventName, params) {
    if (navigator.onLine) {
      if (window.gtag) gtag('event', eventName, params);
      return;
    }
    // Offline — queue
    const queue = JSON.parse(localStorage.getItem('pwa-analytics-queue') || '[]');
    queue.push({ event: eventName, params, ts: Date.now() });
    // Cap queue at 50 events
    if (queue.length > 50) queue.shift();
    localStorage.setItem('pwa-analytics-queue', JSON.stringify(queue));
  }

  function flushAnalyticsQueue() {
    const queue = JSON.parse(localStorage.getItem('pwa-analytics-queue') || '[]');
    if (queue.length === 0) return;
    if (isDebug) console.log(`[PWA] Flushing ${queue.length} queued analytics events`);

    queue.forEach((item) => {
      if (window.gtag) {
        gtag('event', item.event, { ...item.params, offline_queued: true });
      }
    });
    localStorage.removeItem('pwa-analytics-queue');
  }

  // Flush on page load if online
  if (navigator.onLine) flushAnalyticsQueue();

  // ─────────────────────────────────────────────────
  // DEBUG PANEL — ?debug=pwa
  // ─────────────────────────────────────────────────
  if (isDebug) {
    console.log('');
    console.log('════════════════════════════════════════');
    console.log('  SpinSpring PWA Debug Panel');
    console.log('════════════════════════════════════════');
    console.log('  Version:', PWA_VERSION);
    console.log('  iOS:', isIOS);
    console.log('  Standalone:', isStandalone);
    console.log('  Online:', navigator.onLine);
    console.log('  Tip: use window.SpinSpringPWA.*');
    console.log('════════════════════════════════════════');
    console.log('');
  }

  // ─────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────
  window.SpinSpringPWA = {
    version: PWA_VERSION,
    isIOS,
    isStandalone,

    getInstallPrompt: () => deferredPrompt,
    hasUpdate: () => updateAvailable,
    applyUpdate,

    // Track event (queues when offline)
    track: queueAnalytics,

    // Cache management
    clearCache: () => {
      if (!navigator.serviceWorker.controller) return Promise.resolve(false);
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
      if (isDebug) console.log('[PWA] Cache clear requested');
      return Promise.resolve(true);
    },

    async listCaches() {
      if (!('caches' in window)) return [];
      const names = await caches.keys();
      const report = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        report.push({ name, count: keys.length, urls: keys.map((k) => k.url) });
      }
      return report;
    },

    async checkForUpdate() {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        return true;
      }
      return false;
    },

    // Simulate offline for testing (DevTools does this better)
    simulateOffline: (on) => {
      console.warn('[PWA] Use DevTools Network tab → Offline for real simulation');
    },
  };

  console.log('[PWA] Loaded', PWA_VERSION);
})();
