// =====================================================
// models/customer.js — Customer DB operations
// Aligned with actual schema (total_cycles, preferred_location_id)
// =====================================================

class CustomerModel {
  constructor(db) {
    this.db = db;
  }

  generateUniqueId() {
    const ts = Date.now().toString(36).toUpperCase().slice(-4);
    const rand = Math.random().toString(36).toUpperCase().slice(-4);
    return `CUST-${ts}-${rand}`;
  }

  async listByOwner(ownerId, limit = 200) {
    const [rows] = await this.db.query(
      `SELECT c.*, l.location_name,
        (SELECT COUNT(*) FROM ss_orders WHERE customer_id = c.id) AS order_count
       FROM ss_customers c
       LEFT JOIN ss_locations l ON c.preferred_location_id = l.id
       WHERE c.owner_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [ownerId, limit]
    );
    return rows;
  }

  async findById(id, ownerId) {
    const [rows] = await this.db.query(
      'SELECT * FROM ss_customers WHERE id = ? AND owner_id = ? LIMIT 1',
      [id, ownerId]
    );
    return rows[0] || null;
  }

  async findByEmail(email) {
    const [rows] = await this.db.query(
      'SELECT id, owner_id, full_name FROM ss_customers WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  }

  async create(ownerId, data, passwordHash = null) {
    const customerId = this.generateUniqueId();
    const [result] = await this.db.query(
      `INSERT INTO ss_customers 
       (owner_id, customer_unique_id, full_name, email, phone, password, 
        address, preferred_location_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        ownerId,
        customerId,
        data.full_name,
        data.email,
        data.phone || null,
        passwordHash,
        data.address || null,
        data.location_id || data.preferred_location_id || null
      ]
    );
    return { id: result.insertId, customer_unique_id: customerId };
  }

  async update(id, ownerId, data) {
    const allowed = ['full_name', 'phone', 'address', 'preferred_location_id', 'is_active'];
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
      `UPDATE ss_customers SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?`,
      values
    );
    return { changed: result.changedRows };
  }

  async toggleActive(id, ownerId) {
    const [result] = await this.db.query(
      'UPDATE ss_customers SET is_active = 1 - is_active WHERE id = ? AND owner_id = ?',
      [id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async getStats(ownerId) {
    const [rows] = await this.db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(is_active = 1) AS active,
        SUM(is_active = 0) AS inactive,
        COALESCE(SUM(total_cycles), 0) AS total_orders,
        COALESCE(SUM(total_spent), 0) AS total_spent
       FROM ss_customers WHERE owner_id = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }

  async verifyPassword(email, password) {
    const bcrypt = require('bcryptjs');
    const [rows] = await this.db.query(
      `SELECT c.*, o.company_name AS owner_company
       FROM ss_customers c
       LEFT JOIN ss_owners o ON c.owner_id = o.id
       WHERE c.email = ? AND c.is_active = 1
       LIMIT 1`,
      [email]
    );
    if (!rows.length) return null;
    const customer = rows[0];
    if (!customer.password) return null;
    const match = await bcrypt.compare(password, customer.password);
    if (!match) return null;
    return customer;
  }

  async getOrders(customerId, limit = 50) {
    const [rows] = await this.db.query(
      `SELECT o.*, d.device_name, l.location_name
       FROM ss_orders o
       LEFT JOIN ss_devices d ON o.device_id = d.device_id
       LEFT JOIN ss_locations l ON o.location_id = l.id
       WHERE o.customer_id = ?
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [customerId, limit]
    );
    return rows;
  }

  async getActiveOrders(customerId) {
    const [rows] = await this.db.query(
      `SELECT o.*, d.device_name
       FROM ss_orders o
       LEFT JOIN ss_devices d ON o.device_id = d.device_id
       WHERE o.customer_id = ?
         AND o.order_status IN ('pending','queued','in_progress')
       ORDER BY o.created_at DESC`,
      [customerId]
    );
    return rows;
  }

  async getOrderStats(customerId) {
    const [rows] = await this.db.query(
      `SELECT 
        COUNT(*) AS total_orders,
        SUM(order_status = 'completed') AS completed,
        SUM(order_status IN ('pending','queued','in_progress')) AS active,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN price ELSE 0 END), 0) AS total_spent
       FROM ss_orders
       WHERE customer_id = ?`,
      [customerId]
    );
    return rows[0] || {};
  }
}

module.exports = CustomerModel;