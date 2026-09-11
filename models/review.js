// =====================================================
// models/review.js — Reviews data layer
// =====================================================

const crypto = require('crypto');

class ReviewModel {
  constructor(db) {
    this.db = db;
  }

  // ─── GENERATE CODE ──────────────────────────────
  generateCode(prefix = 'RV') {
    return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  // ─── CREATE REQUEST ─────────────────────────────
  async createRequest(data) {
    const code = this.generateCode('RVR');
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);

    const [result] = await this.db.query(
      `INSERT INTO ss_review_requests
       (review_code, order_id, customer_name, customer_phone, customer_email, channel, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        data.order_id,
        data.customer_name || null,
        data.customer_phone || null,
        data.customer_email || null,
        data.channel || 'whatsapp',
        expires
      ]
    );
    return { id: result.insertId, code };
  }

  async findRequestByCode(code) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_review_requests WHERE review_code = ? LIMIT 1',
      [code]
    );
    return rows[0] || null;
  }

  async markRequestSent(code) {
    await this.db.query(
      "UPDATE ss_review_requests SET status='sent', sent_at=NOW() WHERE review_code = ? AND status='pending'",
      [code]
    );
  }

  async markRequestClicked(code) {
    await this.db.query(
      "UPDATE ss_review_requests SET status='clicked', clicked_at=NOW() WHERE review_code = ? AND status IN ('pending','sent')",
      [code]
    );
  }

  async markRequestCompleted(code) {
    await this.db.query(
      "UPDATE ss_review_requests SET status='completed', completed_at=NOW() WHERE review_code = ?",
      [code]
    );
  }

  // ─── CREATE REVIEW ──────────────────────────────
  async create(data) {
    const code = this.generateCode('RV');

    const [result] = await this.db.query(
      `INSERT INTO ss_reviews
       (review_code, owner_id, location_id, device_id, order_id, customer_id,
        customer_name, customer_email, customer_phone,
        rating, title, comment, service_type, photo_url,
        is_verified, status, ip_address, user_agent, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        data.owner_id,
        data.location_id || null,
        data.device_id || null,
        data.order_id || null,
        data.customer_id || null,
        data.customer_name,
        data.customer_email || null,
        data.customer_phone || null,
        data.rating,
        data.title || null,
        data.comment || null,
        data.service_type || null,
        data.photo_url || null,
        data.is_verified ? 1 : 0,
        data.status || 'pending',
        data.ip_address || null,
        data.user_agent || null,
        data.source || 'web'
      ]
    );

    return { id: result.insertId, code };
  }

  // ─── READ ────────────────────────────────────────
  async findById(id) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_reviews WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  async findByCode(code) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_reviews WHERE review_code = ? LIMIT 1',
      [code]
    );
    return rows[0] || null;
  }

  // ─── LIST FOR OWNER ──────────────────────────────
  async listByOwner(ownerId, filters = {}) {
    let sql = `
      SELECT r.*, l.location_name, d.device_name
      FROM ss_reviews r
      LEFT JOIN ss_locations l ON r.location_id = l.id
      LEFT JOIN ss_devices d ON r.device_id = d.device_id
      WHERE r.owner_id = ?
    `;
    const params = [ownerId];

    if (filters.status && filters.status !== 'all') {
      sql += ' AND r.status = ?';
      params.push(filters.status);
    }
    if (filters.rating && filters.rating !== 'all') {
      sql += ' AND r.rating = ?';
      params.push(parseInt(filters.rating, 10));
    }
    if (filters.location_id) {
      sql += ' AND r.location_id = ?';
      params.push(parseInt(filters.location_id, 10));
    }
    if (filters.search) {
      sql += ' AND (r.customer_name LIKE ? OR r.comment LIKE ? OR r.title LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY r.created_at DESC LIMIT 500';

    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // ─── LIST PUBLIC ─────────────────────────────────
  async listPublic(ownerId, options = {}) {
    const { locationId, limit = 20, featuredOnly = false, minRating = null } = options;

    let sql = `
      SELECT r.id, r.review_code, r.customer_name, r.rating, r.title, r.comment,
             r.photo_url, r.service_type, r.owner_reply, r.owner_replied_at,
             r.is_verified, r.is_featured, r.helpful_count, r.created_at,
             l.location_name
      FROM ss_reviews r
      LEFT JOIN ss_locations l ON r.location_id = l.id
      WHERE r.owner_id = ? AND r.status = 'approved'
    `;
    const params = [ownerId];

    if (locationId) {
      sql += ' AND (r.location_id = ? OR r.location_id IS NULL)';
      params.push(locationId);
    }
    if (featuredOnly) {
      sql += ' AND r.is_featured = 1';
    }
    if (minRating) {
      sql += ' AND r.rating >= ?';
      params.push(minRating);
    }

    sql += ' ORDER BY r.is_featured DESC, r.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // ─── UPDATE ──────────────────────────────────────
  async updateStatus(id, ownerId, status, notes = null, moderatedBy = null) {
    const allowed = ['approved', 'rejected', 'hidden', 'pending'];
    if (!allowed.includes(status)) return { changed: 0 };

    const [result] = await this.db.query(
      `UPDATE ss_reviews
       SET status = ?, moderation_notes = ?, moderated_by = ?, moderated_at = NOW()
       WHERE id = ? AND owner_id = ?`,
      [status, notes, moderatedBy, id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async toggleFeatured(id, ownerId) {
    const [result] = await this.db.query(
      'UPDATE ss_reviews SET is_featured = 1 - is_featured WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async reply(id, ownerId, replyText, repliedBy) {
    const [result] = await this.db.query(
      `UPDATE ss_reviews
       SET owner_reply = ?, owner_replied_at = NOW(), owner_replied_by = ?
       WHERE id = ? AND owner_id = ?`,
      [replyText, repliedBy, id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async deleteReply(id, ownerId) {
    const [result] = await this.db.query(
      `UPDATE ss_reviews
       SET owner_reply = NULL, owner_replied_at = NULL, owner_replied_by = NULL
       WHERE id = ? AND owner_id = ?`,
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async markHelpful(id) {
    await this.db.query(
      'UPDATE ss_reviews SET helpful_count = helpful_count + 1 WHERE id = ?',
      [id]
    );
  }

  async report(id) {
    await this.db.query(
      'UPDATE ss_reviews SET reported_count = reported_count + 1 WHERE id = ?',
      [id]
    );
  }

  // ─── STATS ───────────────────────────────────────
  async statsByOwner(ownerId) {
    const [rows] = await this.db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'approved') AS approved,
        SUM(status = 'rejected') AS rejected,
        ROUND(AVG(CASE WHEN status = 'approved' THEN rating END), 2) AS avg_rating,
        SUM(rating = 5) AS five_star,
        SUM(rating = 4) AS four_star,
        SUM(rating = 3) AS three_star,
        SUM(rating = 2) AS two_star,
        SUM(rating = 1) AS one_star,
        SUM(is_featured = 1) AS featured,
        SUM(owner_reply IS NOT NULL) AS replied
       FROM ss_reviews
       WHERE owner_id = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }

  async statsByLocation(ownerId) {
    const [rows] = await this.db.query(
      `SELECT
        l.id AS location_id,
        l.location_name,
        COUNT(r.id) AS total,
        ROUND(AVG(r.rating), 2) AS avg_rating,
        SUM(r.rating = 5) AS five_star,
        SUM(r.rating = 4) AS four_star
       FROM ss_locations l
       LEFT JOIN ss_reviews r ON r.location_id = l.id AND r.status = 'approved'
       WHERE l.owner_id = ?
       GROUP BY l.id
       ORDER BY avg_rating DESC`,
      [ownerId]
    );
    return rows;
  }
}

module.exports = ReviewModel;