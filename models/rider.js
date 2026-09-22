// models/rider.js — Rider DB operations
const bcrypt = require('bcryptjs');

class RiderModel {
  constructor(db) {
    this.db = db;
  }

  // ─── Create ───────────────────────────────────────
  async create(ownerId, data) {
    const hash = await bcrypt.hash(String(data.pin_code), 10);
    const [result] = await this.db.query(
      `INSERT INTO ss_riders
       (owner_id, full_name, email, phone, pin_code, vehicle_type, vehicle_plate, photo_url, is_active, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        ownerId,
        data.full_name,
        data.email || null,
        data.phone,
        hash,
        data.vehicle_type || 'bike',
        data.vehicle_plate || null,
        data.photo_url || null,
      ]
    );
    return { id: result.insertId };
  }

  // ─── Find ─────────────────────────────────────────
  async findById(id, ownerId = null) {
    const params = [id];
    let sql = 'SELECT * FROM ss_riders WHERE id = ?';
    if (ownerId) {
      sql += ' AND owner_id = ?';
      params.push(ownerId);
    }
    const [rows] = await this.db.query(sql + ' LIMIT 1', params);
    return rows[0] || null;
  }

  async findByPhone(phone) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_riders WHERE phone = ? AND is_active = 1 LIMIT 1',
      [phone]
    );
    return rows[0] || null;
  }

  async findByEmail(email) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_riders WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  }

  // ─── Auth ─────────────────────────────────────────
  async verifyPin(phone, pin) {
    const [rows] = await this.db.query(
      `SELECT r.*, o.company_name AS owner_company
       FROM ss_riders r
       LEFT JOIN ss_owners o ON o.id = r.owner_id
       WHERE r.phone = ? AND r.is_active = 1
       LIMIT 1`,
      [phone]
    );
    if (!rows.length) return null;
    const rider = rows[0];
    const ok = await bcrypt.compare(String(pin), rider.pin_code);
    return ok ? rider : null;
  }

  // ─── List ─────────────────────────────────────────
  async listByOwner(ownerId) {
    const [rows] = await this.db.query(
      `SELECT id, full_name, email, phone, vehicle_type, vehicle_plate, photo_url,
              is_active, is_available, current_lat, current_lng, last_seen_at,
              total_deliveries, total_earnings, rating, created_at
       FROM ss_riders
       WHERE owner_id = ?
       ORDER BY is_available DESC, full_name ASC`,
      [ownerId]
    );
    return rows;
  }

  async listAvailable(ownerId) {
    const [rows] = await this.db.query(
      `SELECT * FROM ss_riders
       WHERE owner_id = ? AND is_active = 1 AND is_available = 1
         AND last_seen_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
      [ownerId]
    );
    return rows;
  }

  // ─── Update ───────────────────────────────────────
  async updateLocation(riderId, lat, lng, accuracy = null) {
    await this.db.query(
      `UPDATE ss_riders
       SET current_lat = ?, current_lng = ?, last_seen_at = NOW()
       WHERE id = ?`,
      [lat, lng, riderId]
    );
    // Log history (best-effort)
    try {
      await this.db.query(
        `INSERT INTO ss_rider_locations_history (rider_id, lat, lng, accuracy_m)
         VALUES (?, ?, ?, ?)`,
        [riderId, lat, lng, accuracy]
      );
    } catch (e) { /* ignore */ }
  }

  async setAvailability(riderId, available) {
    await this.db.query(
      'UPDATE ss_riders SET is_available = ? WHERE id = ?',
      [available ? 1 : 0, riderId]
    );
  }

  async update(ownerId, riderId, data) {
    const allowed = ['full_name', 'email', 'phone', 'vehicle_type', 'vehicle_plate', 'photo_url'];
    const updates = [];
    const values = [];
    for (const k of allowed) {
      if (data[k] !== undefined) {
        updates.push(`${k} = ?`);
        values.push(data[k]);
      }
    }
    if (!updates.length) return { changed: 0 };
    values.push(riderId, ownerId);
    const [result] = await this.db.query(
      `UPDATE ss_riders SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?`,
      values
    );
    return { changed: result.changedRows };
  }

  async changePin(riderId, newPin) {
    const hash = await bcrypt.hash(String(newPin), 10);
    await this.db.query('UPDATE ss_riders SET pin_code = ? WHERE id = ?', [hash, riderId]);
  }

  async toggleActive(riderId, ownerId) {
    await this.db.query(
      'UPDATE ss_riders SET is_active = 1 - is_active WHERE id = ? AND owner_id = ?',
      [riderId, ownerId]
    );
  }

  async delete(riderId, ownerId) {
    await this.db.query(
      'DELETE FROM ss_riders WHERE id = ? AND owner_id = ?',
      [riderId, ownerId]
    );
  }

  // ─── Stats ────────────────────────────────────────
  async getStats(ownerId) {
    const [rows] = await this.db.query(
      `SELECT
         COUNT(*) AS total_riders,
         SUM(is_active = 1) AS active_riders,
         SUM(is_active = 1 AND is_available = 1) AS available_now,
         SUM(total_deliveries) AS total_deliveries,
         COALESCE(SUM(total_earnings), 0) AS total_earnings
       FROM ss_riders WHERE owner_id = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }

  // ─── Record delivery completion ───────────────────
  async recordDelivery(riderId, earnings) {
    await this.db.query(
      `UPDATE ss_riders
       SET total_deliveries = total_deliveries + 1,
           total_earnings = total_earnings + ?
       WHERE id = ?`,
      [earnings || 0, riderId]
    );
  }
}

module.exports = RiderModel;
