// =====================================================
// models/owner.js — Owner DB operations
// =====================================================

const bcrypt = require('bcryptjs');

class OwnerModel {
  constructor(db) {
    this.db = db;
  }

  async findByEmail(email) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_owners WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  }

  async findById(id) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_owners WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  async create({ company_name, contact_name, email, phone, password, address, city }) {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await this.db.query(
      `INSERT INTO ss_owners (company_name, contact_name, email, phone, password, address, city)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_name, contact_name, email, phone || null, hash, address || null, city || 'Nairobi']
    );
    return { id: result.insertId };
  }

  async verifyPassword(email, password) {
    const owner = await this.findByEmail(email);
    if (!owner) return null;
    const match = await bcrypt.compare(password, owner.password);
    if (!match) return null;
    return owner;
  }

  async update(id, data) {
    const allowed = ['company_name', 'contact_name', 'phone', 'address', 'city', 'logo_url'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    if (updates.length === 0) return { changed: 0 };
    values.push(id);
    const [result] = await this.db.query(
      `UPDATE ss_owners SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    return { changed: result.changedRows };
  }

  async changePassword(id, newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    await this.db.query(
      'UPDATE ss_owners SET password = ? WHERE id = ?',
      [hash, id]
    );
  }

  async getDashboardStats(ownerId) {
    const [devices] = await this.db.query(
      `SELECT 
        COUNT(*) AS total_devices,
        SUM(status = 'online') AS online_devices,
        SUM(status = 'running') AS running_devices,
        COALESCE(SUM(today_revenue), 0) AS today_revenue,
        COALESCE(SUM(total_revenue), 0) AS total_revenue,
        COALESCE(SUM(cycles_completed), 0) AS total_cycles
      FROM ss_devices WHERE owner_id = ?`,
      [ownerId]
    );

    const [orders] = await this.db.query(
      `SELECT 
        COUNT(*) AS total_orders,
        SUM(order_status = 'pending') AS pending,
        SUM(order_status = 'in_progress') AS in_progress,
        SUM(order_status = 'completed') AS completed
      FROM ss_orders WHERE owner_id = ?`,
      [ownerId]
    );

    const [customers] = await this.db.query(
      'SELECT COUNT(*) AS total FROM ss_customers WHERE owner_id = ?',
      [ownerId]
    );

    const [attendants] = await this.db.query(
      'SELECT COUNT(*) AS total FROM ss_attendants WHERE owner_id = ?',
      [ownerId]
    );

    const [reviews] = await this.db.query(
      `SELECT 
        COUNT(*) AS total,
        ROUND(AVG(CASE WHEN status = 'approved' THEN rating END), 2) AS avg_rating,
        SUM(status = 'pending') AS pending
      FROM ss_reviews WHERE owner_id = ?`,
      [ownerId]
    );

    return {
      devices: devices[0] || {},
      orders: orders[0] || {},
      customers: customers[0] || {},
      attendants: attendants[0] || {},
      reviews: reviews[0] || {}
    };
  }

  async listDevices(ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_devices WHERE owner_id = ? ORDER BY created_at DESC',
      [ownerId]
    );
    return rows;
  }

  async listAttendants(ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_attendants WHERE owner_id = ? ORDER BY created_at DESC',
      [ownerId]
    );
    return rows;
  }

  async listCustomers(ownerId, limit = 100) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_customers WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?',
      [ownerId, limit]
    );
    return rows;
  }

  async listRecentOrders(ownerId, limit = 10) {
    const [rows] = await this.db.query(
      `SELECT o.*, c.full_name AS customer_name, d.device_name
       FROM ss_orders o
       LEFT JOIN ss_customers c ON o.customer_id = c.id
       LEFT JOIN ss_devices d ON o.device_id = d.device_id
       WHERE o.owner_id = ?
       ORDER BY o.created_at DESC LIMIT ?`,
      [ownerId, limit]
    );
    return rows;
  }
}

module.exports = OwnerModel;