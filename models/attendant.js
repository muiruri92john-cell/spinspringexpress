// =====================================================
// models/attendant.js — Attendant DB operations
// =====================================================

class AttendantModel {
  constructor(db) {
    this.db = db;
  }

  async listByOwner(ownerId) {
    const [rows] = await this.db.query(
      `SELECT a.*, l.location_name
       FROM ss_attendants a
       LEFT JOIN ss_locations l ON a.location_id = l.id
       WHERE a.owner_id = ?
       ORDER BY a.created_at DESC`,
      [ownerId]
    );
    return rows;
  }

  async findById(id, ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_attendants WHERE id = ? AND owner_id = ? LIMIT 1',
      [id, ownerId]
    );
    return rows[0] || null;
  }

  async findByEmailAnyOwner(email) {
    const [rows] = await this.db.query(
      'SELECT id, owner_id FROM ss_attendants WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  }

  async create(ownerId, data) {
    const [result] = await this.db.query(
      `INSERT INTO ss_attendants 
       (owner_id, full_name, email, phone, pin_code, location_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        ownerId,
        data.full_name,
        data.email,
        data.phone || null,
        data.pin_code,
        data.location_id || null
      ]
    );
    return { id: result.insertId };
  }

  async update(id, ownerId, data) {
    const allowed = ['full_name', 'phone', 'pin_code', 'location_id', 'is_active'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    if (updates.length === 0) return { changed: 0 };
    values.push(id, ownerId);
    const [result] = await this.db.query(
      `UPDATE ss_attendants SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?`,
      values
    );
    return { changed: result.changedRows };
  }

  async toggleActive(id, ownerId) {
    const [result] = await this.db.query(
      'UPDATE ss_attendants SET is_active = 1 - is_active WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async delete(id, ownerId) {
    const [result] = await this.db.query(
      'DELETE FROM ss_attendants WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return { changed: result.affectedRows };
  }

  async getStats(ownerId) {
    const [rows] = await this.db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(is_active = 1) AS active,
        SUM(is_active = 0) AS inactive
       FROM ss_attendants WHERE owner_id = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }
}

module.exports = AttendantModel;