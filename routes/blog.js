// routes/blog.js — Blog posts: public read + owner CRUD
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 200);
}

// Owner auth guard — matches your session pattern (req.session.spinUser)
function requireOwner(req, res, next) {
  const user = req.session && req.session.spinUser;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Please login first' });
  }
  // Adjust this if your session stores role differently.
  // Common shapes: user.role === 'owner', user.user_type === 'owner', user.is_owner === true
  const role = user.role || user.user_type || (user.is_owner ? 'owner' : null);
  if (role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Owner access required' });
  }
  req.owner = user;
  next();
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Very small HTML sanitiser for stored post content.
// If you'd rather store raw HTML and trust authors, skip this —
// but if any non-owner can post, keep it.
function sanitizeHtml(html) {
  if (!html) return '';
  return String(html)
    // strip <script>, <iframe>, <object>, <embed>, <style>, event handlers, javascript: URLs
    .replace(/<\s*(script|iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|style|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────

// GET /api/public/posts?owner_id=1&limit=3&offset=0&category=Tips
router.get('/api/public/posts', async (req, res) => {
  try {
    const ownerId = parseInt(req.query.owner_id, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const offset = parseInt(req.query.offset, 10) || 0;
    const category = req.query.category || null;

    let sql = `
      SELECT id, slug, title, excerpt, featured_image, category,
             author_name, published_at, created_at
      FROM blog_posts
      WHERE owner_id = ?
        AND status = 'published'
        AND (published_at IS NULL OR published_at <= NOW())
    `;
    const params = [ownerId];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [posts] = await db.query(sql, params);

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM blog_posts
       WHERE owner_id = ? AND status = 'published'`,
      [ownerId]
    );
    const total = countRows[0] ? countRows[0].total : 0;

    res.json({ success: true, posts, total });
  } catch (err) {
    console.error('[blog] public list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// GET /api/public/posts/:slug?owner_id=1
router.get('/api/public/posts/:slug', async (req, res) => {
  try {
    const ownerId = parseInt(req.query.owner_id, 10) || 1;
    const [rows] = await db.query(
      `SELECT * FROM blog_posts
       WHERE owner_id = ? AND slug = ? AND status = 'published'
       LIMIT 1`,
      [ownerId, req.params.slug]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('[blog] public get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// ─────────────────────────────────────────────────────────────
// OWNER ROUTES (protected)
// ─────────────────────────────────────────────────────────────

// GET /api/owner/posts — list all (drafts + published)
router.get('/api/owner/posts', requireOwner, async (req, res) => {
  try {
    const ownerId = req.owner.id;
    const [posts] = await db.query(
      `SELECT id, slug, title, category, status,
              published_at, created_at, updated_at
       FROM blog_posts
       WHERE owner_id = ?
       ORDER BY created_at DESC`,
      [ownerId]
    );
    res.json({ success: true, posts });
  } catch (err) {
    console.error('[blog] owner list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// GET /api/owner/posts/:id — fetch one for editing
router.get('/api/owner/posts/:id', requireOwner, async (req, res) => {
  try {
    const ownerId = req.owner.id;
    const [rows] = await db.query(
      'SELECT * FROM blog_posts WHERE id = ? AND owner_id = ? LIMIT 1',
      [req.params.id, ownerId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('[blog] owner get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// POST /api/owner/posts — create
router.post('/api/owner/posts', requireOwner, async (req, res) => {
  try {
    const ownerId = req.owner.id;
    const {
      title, content, excerpt, featured_image, category,
      status, author_name, meta_title, meta_description
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required'
      });
    }

    // Generate unique slug
    let slug = slugify(title) || ('post-' + Date.now());
    const [existing] = await db.query(
      'SELECT id FROM blog_posts WHERE slug = ? LIMIT 1',
      [slug]
    );
    if (existing.length) slug = `${slug}-${Date.now().toString(36).slice(-5)}`;

    const finalStatus = status === 'published' ? 'published' : 'draft';
    const publishedAt = finalStatus === 'published' ? new Date() : null;

    const [result] = await db.query(
      `INSERT INTO blog_posts
         (owner_id, slug, title, excerpt, content, featured_image,
          category, status, author_name, meta_title, meta_description, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId,
        slug,
        title,
        excerpt || null,
        sanitizeHtml(content),
        featured_image || null,
        category || null,
        finalStatus,
        author_name || null,
        meta_title || null,
        meta_description || null,
        publishedAt
      ]
    );

    const insertId = result.insertId;
    const [rows] = await db.query('SELECT * FROM blog_posts WHERE id = ?', [insertId]);
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('[blog] create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

// PUT /api/owner/posts/:id — update
router.put('/api/owner/posts/:id', requireOwner, async (req, res) => {
  try {
    const ownerId = req.owner.id;
    const postId = req.params.id;

    const [existing] = await db.query(
      'SELECT * FROM blog_posts WHERE id = ? AND owner_id = ? LIMIT 1',
      [postId, ownerId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const {
      title, content, excerpt, featured_image, category,
      status, author_name, meta_title, meta_description
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required'
      });
    }

    const finalStatus = status === 'published' ? 'published' : 'draft';
    // Preserve original published_at if already published
    let publishedAt = existing[0].published_at;
    if (finalStatus === 'published' && !publishedAt) publishedAt = new Date();
    if (finalStatus === 'draft') publishedAt = null;

    await db.query(
      `UPDATE blog_posts SET
         title = ?, content = ?, excerpt = ?, featured_image = ?,
         category = ?, status = ?, author_name = ?,
         meta_title = ?, meta_description = ?, published_at = ?
       WHERE id = ? AND owner_id = ?`,
      [
        title,
        sanitizeHtml(content),
        excerpt || null,
        featured_image || null,
        category || null,
        finalStatus,
        author_name || null,
        meta_title || null,
        meta_description || null,
        publishedAt,
        postId,
        ownerId
      ]
    );

    const [rows] = await db.query('SELECT * FROM blog_posts WHERE id = ?', [postId]);
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    console.error('[blog] update error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// DELETE /api/owner/posts/:id
router.delete('/api/owner/posts/:id', requireOwner, async (req, res) => {
  try {
    const ownerId = req.owner.id;
    await db.query(
      'DELETE FROM blog_posts WHERE id = ? AND owner_id = ?',
      [req.params.id, ownerId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[blog] delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// ─────────────────────────────────────────────────────────────
// HTML PAGE ROUTES
// ─────────────────────────────────────────────────────────────

// GET /blog — listing page
router.get('/blog', (req, res) => {
  res.render('blog/index', {
    title: 'Blog - SpinSpring Express',
    user: req.session ? req.session.spinUser || null : null
  });
});

// GET /blog/:slug — single post
router.get('/blog/:slug', async (req, res) => {
  try {
    const ownerId = parseInt(req.query.owner_id, 10) || 1;
    const [rows] = await db.query(
      `SELECT * FROM blog_posts
       WHERE owner_id = ? AND slug = ? AND status = 'published'
       LIMIT 1`,
      [ownerId, req.params.slug]
    );
    if (!rows.length) {
      return res.status(404).render('spinspring/error', {
        title: 'Post Not Found',
        status: 404,
        message: 'That blog post does not exist or is not published.',
        detail: null,
        requestId: req.requestId,
        user: req.session ? req.session.spinUser || null : null
      });
    }
    res.render('blog/post', {
      title: (rows[0].meta_title || rows[0].title) + ' - SpinSpring Express',
      metaDescription: rows[0].meta_description || rows[0].excerpt || '',
      post: rows[0],
      user: req.session ? req.session.spinUser || null : null
    });
  } catch (err) {
    console.error('[blog] render post error:', err.message);
    res.status(500).render('spinspring/error', {
      title: 'Error',
      status: 500,
      message: 'Could not load that post.',
      detail: null,
      requestId: req.requestId,
      user: req.session ? req.session.spinUser || null : null
    });
  }
});

module.exports = router;
