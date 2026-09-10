// =====================================================
// Location model — DB access layer
// =====================================================

const geo = require('../utils/geo');

class LocationModel {
  constructor(db) {
    this.db = db;
  }

  // ─── READ ────────────────────────────────────────
  async listByOwner(ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_locations WHERE owner_id = ? ORDER BY is_primary DESC, location_name ASC',
      [ownerId]
    );
    return rows;
  }

  async listActive(ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_locations WHERE owner_id = ? AND is_active = 1 ORDER BY is_primary DESC, location_name ASC',
      [ownerId]
    );
    return rows;
  }

  async findById(id) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_locations WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  async findByCode(code) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_locations WHERE location_code = ? LIMIT 1',
      [code]
    );
    return rows[0] || null;
  }

  // ─── CREATE ──────────────────────────────────────
  async create(ownerId, data) {
    const code = data.location_code ||
      'LOC-' + Date.now().toString(36).toUpperCase().slice(-6);

    const [result] = await this.db.query(
      `INSERT INTO ss_locations 
       (owner_id, location_code, location_name, address_line1, address_line2,
        city, county, postal_code, latitude, longitude, phone, whatsapp, email,
        opening_time, closing_time, open_days, pickup_radius_km,
        pickup_fee_kes, delivery_fee_kes, is_primary, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId, code, data.location_name, data.address_line1,
        data.address_line2 || null, data.city || 'Nairobi',
        data.county || null, data.postal_code || null,
        data.latitude || null, data.longitude || null,
        data.phone || null, data.whatsapp || null, data.email || null,
        data.opening_time || '08:00:00', data.closing_time || '20:00:00',
        data.open_days || 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
        data.pickup_radius_km || 5.00,
        data.pickup_fee_kes || 0.00, data.delivery_fee_kes || 0.00,
        data.is_primary ? 1 : 0, data.notes || null,
      ]
    );
    return { id: result.insertId, code };
  }

  // ─── UPDATE ──────────────────────────────────────
  async update(id, ownerId, data) {
    const allowed = [
      'location_name', 'address_line1', 'address_line2', 'city', 'county',
      'postal_code', 'latitude', 'longitude', 'phone', 'whatsapp', 'email',
      'opening_time', 'closing_time', 'open_days', 'pickup_radius_km',
      'pickup_fee_kes', 'delivery_fee_kes', 'is_active', 'notes',
    ];

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
      `UPDATE ss_locations SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?`,
      values
    );
    return { changed: result.changedRows };
  }

  async setPrimary(id, ownerId) {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'UPDATE ss_locations SET is_primary = 0 WHERE owner_id = ?',
        [ownerId]
      );
      await conn.query(
        'UPDATE ss_locations SET is_primary = 1 WHERE id = ? AND owner_id = ?',
        [id, ownerId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async softDelete(id, ownerId) {
    const [result] = await this.db.query(
      'UPDATE ss_locations SET is_active = 0 WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  // ─── GEOLOCATION ─────────────────────────────────
  async findNearest(ownerId, lat, lon, options = {}) {
    const { limit = 5, onlyActive = true } = options;

    let sql = 'SELECT * FROM ss_locations WHERE owner_id = ?';
    const params = [ownerId];

    if (onlyActive) sql += ' AND is_active = 1';
    if (lat && lon) {
      // Pre-filter to a rough bounding box (about 100km radius)
      // This uses the index efficiently, then we calc precise distance
      sql += ' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      params.push(lat - 1, lat + 1, lon - 1, lon + 1);
    }

    const [rows] = await this.db.query(sql, params);

    if (lat && lon) {
      return geo.sortByDistance(rows, lat, lon).slice(0, limit);
    }
    return rows.slice(0, limit);
  }

  // ─── STATS ───────────────────────────────────────
  async statsByOwner(ownerId) {
    const [rows] = await this.db.query(
      `SELECT 
         l.id, l.location_code, l.location_name, l.city, l.is_active,
         COUNT(DISTINCT d.device_id) AS device_count,
         COALESCE(SUM(d.today_revenue), 0) AS today_revenue,
         COALESCE(SUM(d.total_revenue), 0) AS total_revenue,
         COALESCE(SUM(d.cycles_completed), 0) AS total_cycles
       FROM ss_locations l
       LEFT JOIN ss_devices d ON d.location_id = l.id
       WHERE l.owner_id = ?
       GROUP BY l.id
       ORDER BY l.is_primary DESC, l.location_name ASC`,
      [ownerId]
    );
    return rows;
  }
}

module.exports = LocationModel;