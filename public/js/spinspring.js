/* ============================================================
   SPINSPRING EXPRESS — Front-End Helpers
   Version: 2.0
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const SS = {
    ownerId: 5,                          // default owner for public API
    whatsapp: '254793972143',            // business WhatsApp
    apiBase: '',                         // same-origin
    debug: false,                        // set true to log

    // Local storage keys
    keys: {
      notificationPrefs: 'ss_notification_prefs',
      lastLocation: 'ss_last_location',
      lastQuote: 'ss_last_quote'
    }
  };

  // ============================================================
  // LOGGING
  // ============================================================
  function log(...args) {
    if (SS.debug) console.log('[SpinSpring]', ...args);
  }

  function warn(...args) {
    console.warn('[SpinSpring]', ...args);
  }

  // ============================================================
  // DOM HELPERS
  // ============================================================
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c instanceof Node) node.appendChild(c);
    });
    return node;
  }

  // ============================================================
  // API HELPERS
  // ============================================================
  async function api(path, options = {}) {
    const opts = {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    };
    if (opts.body && typeof opts.body === 'object') {
      opts.body = JSON.stringify(opts.body);
    }
    try {
      const res = await fetch(SS.apiBase + path, opts);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; }
      catch { data = { raw: text }; }
      if (!res.ok) {
        warn('API error', res.status, path, data);
        return { success: false, error: data.error || `HTTP ${res.status}` };
      }
      return data;
    } catch (err) {
      warn('API network error', path, err);
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================
  function ensureToastContainer() {
    let c = $('#ssToastContainer');
    if (!c) {
      c = el('div', { id: 'ssToastContainer', style: {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 10001,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'none'
      }});
      document.body.appendChild(c);
    }
    return c;
  }

  function toast(message, type = 'info', duration = 3000) {
    const container = ensureToastContainer();
    const colors = {
      success: { bg: '#10b981', icon: 'check-circle' },
      error:   { bg: '#ef4444', icon: 'exclamation-circle' },
      warning: { bg: '#f59e0b', icon: 'exclamation-triangle' },
      info:    { bg: '#0284c7', icon: 'info-circle' }
    };
    const c = colors[type] || colors.info;

    const t = el('div', {
      style: {
        background: 'white',
        borderLeft: `4px solid ${c.bg}`,
        boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
        borderRadius: '12px',
        padding: '14px 20px',
        minWidth: '260px',
        maxWidth: '360px',
        fontSize: '0.9rem',
        fontWeight: '600',
        color: '#0c4a6e',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        pointerEvents: 'auto',
        opacity: 0,
        transform: 'translateX(20px)',
        transition: 'all 0.3s'
      },
      html: `<i class="fas fa-${c.icon}" style="color:${c.bg};font-size:1.1rem;"></i><span>${escapeHtml(message)}</span>`
    });

    container.appendChild(t);

    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // ============================================================
  // CONFIRM DIALOG
  // ============================================================
  function confirmDialog(message, options = {}) {
    return new Promise((resolve) => {
      const overlay = el('div', {
        style: {
          position: 'fixed', inset: 0,
          background: 'rgba(12,74,110,0.6)',
          zIndex: 10002,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          opacity: 0,
          transition: 'opacity 0.2s'
        }
      });

      const box = el('div', {
        style: {
          background: 'white',
          borderRadius: '20px',
          padding: '28px',
          maxWidth: '420px',
          width: '100%',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          transform: 'scale(0.95)',
          transition: 'transform 0.2s'
        }
      });

      box.appendChild(el('h5', {
        text: options.title || 'Are you sure?',
        style: { color: '#0c4a6e', fontWeight: '800', marginTop: 0, marginBottom: '12px' }
      }));

      box.appendChild(el('p', {
        text: message,
        style: { color: '#64748b', marginBottom: '24px', fontSize: '0.95rem' }
      }));

      const actions = el('div', {
        style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' }
      });

      const cancelBtn = el('button', {
        className: 'ss-btn ss-btn-light',
        text: options.cancelText || 'Cancel',
        type: 'button'
      });

      const okBtn = el('button', {
        className: `ss-btn ${options.danger ? 'ss-btn-danger' : ''}`,
        text: options.okText || 'Confirm',
        type: 'button'
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        box.style.transform = 'scale(1)';
      });

      function close(result) {
        overlay.style.opacity = '0';
        box.style.transform = 'scale(0.95)';
        setTimeout(() => overlay.remove(), 200);
        resolve(result);
      }

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', esc); }
      });
    });
  }

  // ============================================================
  // FORMATTERS
  // ============================================================
  function formatCurrency(n, currency = 'KES') {
    const num = parseFloat(n) || 0;
    return currency + ' ' + num.toLocaleString('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatNumber(n) {
    return (parseFloat(n) || 0).toLocaleString('en-KE');
  }

  function formatDate(d, opts = {}) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-KE', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...opts
    });
  }

  function timeAgo(date) {
    if (!date) return 'never';
    const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (sec < 5)     return 'just now';
    if (sec < 60)    return sec + 's ago';
    if (sec < 3600)  return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }

  function initials(name) {
    if (!name) return '?';
    return String(name).trim().split(/\s+/).slice(0, 2)
      .map(w => w[0]).join('').toUpperCase();
  }

  // ============================================================
  // GEOLOCATION
  // ============================================================
  function getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('Geolocation not supported'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          try {
            localStorage.setItem(SS.keys.lastLocation, JSON.stringify({
              ...coords,
              at: Date.now()
            }));
          } catch {}
          resolve(coords);
        },
        (err) => reject(err),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
          ...options
        }
      );
    });
  }

  function getLastKnownLocation() {
    try {
      const raw = localStorage.getItem(SS.keys.lastLocation);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Expire after 1 hour
      if (Date.now() - (data.at || 0) > 3600 * 1000) return null;
      return data;
    } catch { return null; }
  }

  // ============================================================
  // NOTIFICATION PREFERENCES
  // ============================================================
  function getNotificationSettings() {
    try {
      const raw = localStorage.getItem(SS.keys.notificationPrefs);
      return raw ? JSON.parse(raw) : {
        email: true,
        sms: false,
        whatsapp: true,
        cycleDone: true,
        promotions: false
      };
    } catch {
      return { email: true, sms: false, whatsapp: true, cycleDone: true, promotions: false };
    }
  }

  /**
   * Save notification preferences to localStorage.
   * Preserves compatibility with the original inline function.
   */
  function saveNotificationSettings(prefs) {
    const current = getNotificationSettings();
    const updated = { ...current, ...(prefs || {}) };
    try {
      localStorage.setItem(SS.keys.notificationPrefs, JSON.stringify(updated));
      toast('Notification preferences saved on this device', 'success');
      log('Notification settings saved', updated);
      return { success: true, settings: updated };
    } catch (e) {
      warn('Could not save notification settings', e);
      toast('Could not save preferences', 'error');
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // CONFIRM HELPER
  // ============================================================
  function confirmAction(message, options = {}) {
    return confirmDialog(message, options);
  }

  // ============================================================
  // COPY TO CLIPBOARD
  // ============================================================
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Copied to clipboard', 'success', 2000);
      return true;
    } catch (err) {
      warn('Copy failed', err);
      toast('Copy failed', 'error');
      return false;
    }
  }

  // ============================================================
  // WHATSAPP SHARE
  // ============================================================
  function openWhatsApp(message, phone) {
    const target = phone || SS.whatsapp;
    const url = 'https://wa.me/' + target.replace(/\D/g, '') +
                '?text=' + encodeURIComponent(message || '');
    window.open(url, '_blank');
  }

  // ============================================================
  // DEBOUNCE / THROTTLE
  // ============================================================
  function debounce(fn, wait = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function throttle(fn, wait = 300) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  // ============================================================
  // LIVE REFRESH (poll a URL and update the DOM)
  // ============================================================
  function startPolling(url, callback, intervalMs = 30000) {
    let stopped = false;

    async function tick() {
      if (stopped) return;
      try {
        const data = await api(url);
        if (typeof callback === 'function') callback(data);
      } catch (err) {
        warn('Poll error', url, err);
      }
      if (!stopped) setTimeout(tick, intervalMs);
    }

    tick();
    return () => { stopped = true; };
  }

  // ============================================================
  // DEVICE HEALTH BADGE
  // ============================================================
  function renderHealthBadge(el, data) {
    if (!el) return;
    const healthMap = {
      healthy:   { class: 'badge bg-success', text: 'Online' },
      unstable:  { class: 'badge bg-warning text-dark', text: 'Stale' },
      offline:   { class: 'badge bg-danger', text: 'Offline' },
      low_battery: { class: 'badge bg-warning text-dark', text: 'Low Battery' },
      weak_signal: { class: 'badge bg-warning text-dark', text: 'Weak Signal' },
      error:     { class: 'badge bg-danger', text: 'Error' },
      unknown:   { class: 'badge bg-secondary', text: 'Unknown' }
    };
    const h = healthMap[data?.health] || healthMap.unknown;
    el.className = h.class;
    el.textContent = h.text;
  }

  // ============================================================
  // AUTO-INIT ON DOM READY
  // ============================================================
  function initAutoBindings() {
    // Auto-confirm on forms with data-confirm
    $$('form[data-confirm]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        if (form.dataset.ssConfirmed === '1') return;
        e.preventDefault();
        const msg = form.dataset.confirm || 'Are you sure?';
        const ok = await confirmDialog(msg, {
          okText: form.dataset.confirmOk || 'Confirm',
          cancelText: 'Cancel',
          danger: form.dataset.confirmDanger === 'true'
        });
        if (ok) {
          form.dataset.ssConfirmed = '1';
          form.submit();
        }
      });
    });

    // Auto-copy on [data-copy]
    $$('[data-copy]').forEach(node => {
      node.style.cursor = 'pointer';
      node.addEventListener('click', () => {
        copyToClipboard(node.dataset.copy || node.textContent);
      });
    });

    // Auto WhatsApp on [data-wa]
    $$('[data-wa]').forEach(node => {
      node.addEventListener('click', (e) => {
        e.preventDefault();
        openWhatsApp(node.dataset.wa, node.dataset.waPhone);
      });
    });

    log('Auto-bindings initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoBindings);
  } else {
    initAutoBindings();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window.SpinSpring = {
    // Config
    config: SS,

    // DOM
    $, $$, el,

    // API
    api,

    // UI
    toast,
    confirm: confirmDialog,
    confirmAction,
    renderHealthBadge,

    // Format
    formatCurrency,
    formatNumber,
    formatDate,
    timeAgo,
    initials,
    escapeHtml,

    // Geo
    getCurrentPosition,
    getLastKnownLocation,

    // Notifications
    getNotificationSettings,
    saveNotificationSettings,

    // Utilities
    copyToClipboard,
    openWhatsApp,
    debounce,
    throttle,
    startPolling,

    // Logging
    log,
    warn
  };

  // ============================================================
  // BACKWARD-COMPATIBLE GLOBAL FUNCTIONS
  // ============================================================

  // Keep the original global for inline onclick handlers
  window.saveNotificationSettings = function () {
    // No args: read checkboxes on the page
    const prefs = {};
    $$('[data-notif-pref]').forEach(cb => {
      prefs[cb.dataset.notifPref] = cb.checked;
    });
    return saveNotificationSettings(Object.keys(prefs).length ? prefs : undefined);
  };

  log('SpinSpring helpers loaded');

})();