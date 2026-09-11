// =====================================================
// utils/reviewHelper.js — Send review requests + star render
// =====================================================

/**
 * Build the review URL from a code
 */
function buildReviewUrl(code, baseUrl = 'https://spinspringexpress.co.ke') {
  return `${baseUrl}/review/${code}`;
}

/**
 * Build WhatsApp message for review request
 */
function buildWhatsAppMessage({ customerName, businessName, reviewUrl, orderNumber }) {
  const name = customerName || 'there';
  const biz = businessName || 'SpinSpring Express';
  const order = orderNumber ? ` for order ${orderNumber}` : '';

  return encodeURIComponent(
    `Hi ${name}! 👋\n\n` +
    `Thank you for choosing ${biz}${order}.\n\n` +
    `We'd love to hear your feedback — it takes 30 seconds:\n` +
    `${reviewUrl}\n\n` +
    `Your review helps us improve and helps others find us. 🙏`
  );
}

/**
 * Build SMS message (shorter)
 */
function buildSmsMessage({ customerName, businessName, reviewUrl }) {
  const name = customerName ? ` ${customerName}` : '';
  const biz = businessName || 'SpinSpring';

  return `${biz}: Hi${name}, thanks for your visit! Rate us in 30s: ${reviewUrl} Reply STOP to opt out.`;
}

/**
 * Render star display (HTML)
 */
function renderStars(rating, size = 'md') {
  const r = Math.round(parseFloat(rating) || 0);
  const sizes = { sm: '0.9rem', md: '1.1rem', lg: '1.5rem' };
  const sizeStyle = `font-size:${sizes[size] || sizes.md};`;

  let html = `<span class="ss-stars" style="${sizeStyle}color:#f59e0b;letter-spacing:2px;">`;
  for (let i = 1; i <= 5; i++) {
    if (i <= r) {
      html += '<i class="fas fa-star"></i>';
    } else {
      html += '<i class="far fa-star" style="color:#cbd5e1;"></i>';
    }
  }
  html += '</span>';
  return html;
}

/**
 * Humanize time ago
 */
function timeAgo(date) {
  if (!date) return 'just now';
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + ' minutes ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' hours ago';
  if (sec < 604800) return Math.floor(sec / 86400) + ' days ago';
  if (sec < 2592000) return Math.floor(sec / 604800) + ' weeks ago';
  if (sec < 31536000) return Math.floor(sec / 2592000) + ' months ago';
  return Math.floor(sec / 31536000) + ' years ago';
}

/**
 * Anonymize name for public display (John M. — J*** M.)
 */
function anonymizeName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(/\s+/);
  return parts.map((p, i) =>
    i === parts.length - 1 ? p.charAt(0) + '***' : p
  ).join(' ').replace(/^(.)(.*)\s/, (m, a, b) => a + '*** ');
}

/**
 * Display name — First name + last initial
 */
function displayName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.';
}

module.exports = {
  buildReviewUrl,
  buildWhatsAppMessage,
  buildSmsMessage,
  renderStars,
  timeAgo,
  anonymizeName,
  displayName
};