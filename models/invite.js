// =====================================================
// models/invite.js — Invite code operations
// =====================================================

const crypto = require('crypto');

class InviteModel {
  constructor(db) {
    this.db = db;
  }

  generateCode(type = 'owner') {
    const prefix = {
      owner: 'OWN',
      attendant: 'ATT',
      customer: 'CUS'
    }[type] || 'INV';
    
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${random}`;
  }

  async create(createdBy, type = 'owner', options = {}) {
    const code = options.code || this.generateCode(type);
    const maxUses = options.max_uses || 1;
    const expiresAt = options.expires_at || null;
    const notes = options.notes || null;

    const [result] = await this.db.query(
      `INSERT INTO ss_invite_codes 
       (code, type, created_by, max_uses, expires_at, notes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [code, type, createdBy, maxUses, expiresAt, notes]
    );

    return { id: result.insertId, code };
  }

  async findByCode(code) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_invite_codes WHERE code = ? LIMIT 1',
      [code]
    );
    return rows[0] || null;
  }

  async validate(code, type = 'owner') {
    const invite = await this.findByCode(code);
    if (!invite) return { valid: false, error: 'Invalid invite code' };
    if (!invite.is_active) return { valid: false, error: 'Code is inactive' };
    if (invite.type !== type) return { valid: false, error: `Code is for ${invite.type}s, not ${type}s` };
    if (invite.times_used >= invite.max_uses) return { valid: false, error: 'Code has been fully used' };
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { valid: false, error: 'Code has expired' };
    }
    return { valid: true, invite };
  }

  async use(code, usedById) {
    await this.db.query(
      `UPDATE ss_invite_codes 
       SET times_used = times_used + 1, used_by = ?
       WHERE code = ?`,
      [usedById, code]
    );
  }

  async listByOwner(ownerId) {
    const [rows] = await this.db.query(
      `SELECT ic.*, 
        (SELECT COUNT(*) FROM ss_owners WHERE invite_code_used = ic.code) AS owners_created
       FROM ss_invite_codes ic
       WHERE ic.created_by = ?
       ORDER BY ic.created_at DESC`,
      [ownerId]
    );
    return rows;
  }

  async listAll(limit = 100) {
    const [rows] = await this.db.query(
      `SELECT ic.*, o.company_name AS created_by_company
       FROM ss_invite_codes ic
       LEFT JOIN ss_owners o ON ic.created_by = o.id
       ORDER BY ic.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows;
  }

  async toggleActive(id, ownerId) {
    const [result] = await this.db.query(
      'UPDATE ss_invite_codes SET is_active = 1 - is_active WHERE id = ? AND created_by = ?',
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async delete(id, ownerId) {
    const [result] = await this.db.query(
      'DELETE FROM ss_invite_codes WHERE id = ? AND created_by = ?',
      [id, ownerId]
    );
    return { changed: result.affectedRows };
  }

  async getStats(ownerId) {
    const [rows] = await this.db.query(
      `SELECT 
        COUNT(*) AS total_codes,
        SUM(is_active = 1) AS active_codes,
        SUM(times_used) AS total_uses,
        SUM(times_used < max_uses AND is_active = 1) AS available_codes
       FROM ss_invite_codes
       WHERE created_by = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }
}

module.exports = InviteModel;