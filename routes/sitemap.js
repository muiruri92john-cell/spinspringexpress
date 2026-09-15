// =====================================================
// routes/sitemap.js — Generate XML sitemap for search engines
// =====================================================

const express = require('express');
const router = express.Router();
const expressSitemapXml = require('express-sitemap-xml');

const BASE_URL = 'https://spinspringexpress.co.ke';

// List all public URLs for your site
async function getPublicUrls() {
  const urls = [
    '/',
    '/login',
    '/register',
    '/attendant-login',
    '/customer-login',
    '/find-location',
    '/reviews',
    '/reviews/new',
  ];

  // Optionally, add dynamic owner/location pages
  // (uses req.db — but sitemap middleware runs outside request context)
  // So we skip dynamic here and hardcode important ones.

  return urls.map(url => ({
    url,
    changeFreq: 'weekly',
    lastMod: new Date(),
  }));
}

// Serve /sitemap.xml
router.use(expressSitemapXml(getPublicUrls, BASE_URL));

// Also serve /robots.txt for search engines
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /

# Block private areas
Disallow: /owner
Disallow: /attendant
Disallow: /customer
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml
`);
});

module.exports = router;