// =====================================================
// public/js/pwa.js — PWA install prompt + network status
// =====================================================

(function () {
  'use strict';

  // ── Service Worker registration ─────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[PWA] SW registered:', reg.scope);

          // Check for updates every 60 seconds
          setInterval(() => reg.update(), 60 * 1000);

          // New SW available → prompt user
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch((err) => console.warn('[PWA] SW registration failed:', err));
    });
  }

  // ── Install prompt ──────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt available');
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');
    hideInstallBanner();
    deferredPrompt = null;
    // Optional: track with GA
    if (window.gtag) gtag('event', 'pwa_install', { event_category: 'PWA' });
  });

  // ── Install banner ──────────────────────────────────
  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    if (localStorage.getItem('pwa-install-dismissed') === 'true') return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
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
    document.body.appendChild(banner);

    document.getElementById('pwa-install-yes').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] User choice:', outcome);
      deferredPrompt = null;
      hideInstallBanner();
    });

    document.getElementById('pwa-install-no').addEventListener('click', () => {
      localStorage.setItem('pwa-install-dismissed', 'true');
      hideInstallBanner();
    });
  }

  function hideInstallBanner() {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  }

  // ── Update banner ───────────────────────────────────
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

    document.getElementById('pwa-update-yes').addEventListener('click', () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        setTimeout(() => window.location.reload(), 300);
      });
    });

    document.getElementById('pwa-update-no').addEventListener('click', () => {
      banner.remove();
    });
  }

  // ── Network status indicator ────────────────────────
  function showNetworkStatus(online) {
    const existing = document.getElementById('pwa-network-status');
    if (existing) existing.remove();

    if (online) {
      // Flash "Back online" then fade out
      const el = document.createElement('div');
      el.id = 'pwa-network-status';
      el.textContent = '✓ Back online';
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2500);
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

  // Show offline indicator on load if already offline
  if (!navigator.onLine) showNetworkStatus(false);

  // Expose helpers for debugging
  window.SpinSpringPWA = {
    version: 'v1.0.0-phase1',
    getInstallPrompt: () => deferredPrompt,
  };

  console.log('[PWA] Loaded', window.SpinSpringPWA.version);
})();
