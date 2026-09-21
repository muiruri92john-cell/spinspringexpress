// =====================================================
// models/order.js — Order DB operations
// =====================================================

class OrderModel {
  constructor(db) {
    this.db = db;
  }

  generateOrderNumber() {
    return 'SS-' + Date.now().toString(36).toUpperCase();
  }

  async create(data) {
    const orderNumber = this.generateOrderNumber();
    const [result] = await this.db.query(
      `INSERT INTO ss_orders
       (order_number, owner_id, user_id, customer_id, device_id, location_id,
        service_type, cycle_type, weight_kg, price,
        payment_status, order_status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        data.owner_id,
        data.owner_id,                       // user_id mirrors owner_id (legacy NOT NULL column)
        data.customer_id || null,
        data.device_id || null,
        data.location_id || null,
        data.service_type || 'wash',
        data.cycle_type || 'normal',
        data.weight_kg || null,
        data.price || 0,
        data.payment_status || 'pending',
        data.order_status || 'pending',
        data.notes || null
      ]
    );
    return { id: result.insertId, order_number: orderNumber };
  }

  async findById(id, ownerId = null) {
    const params = [id];
    let sql = `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone,
                      d.device_name, l.location_name
               FROM ss_orders o
               LEFT JOIN ss_customers c ON o.customer_id = c.id
               LEFT JOIN ss_devices d ON o.device_id = d.device_id
               LEFT JOIN ss_locations l ON o.location_id = l.id
               WHERE o.id = ?`;
    if (ownerId) {
      sql += ' AND o.owner_id = ?';
      params.push(ownerId);
    }
    const [rows] = await this.db.query(sql + ' LIMIT 1', params);
    return rows[0] || null;
  }

  async listByOwner(ownerId, limit = 200) {
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

  async listByCustomer(customerId, limit = 100) {
    const [rows] = await this.db.query(
      `SELECT o.*, d.device_name, l.location_name
       FROM ss_orders o
       LEFT JOIN ss_devices d ON o.device_id = d.device_id
       LEFT JOIN ss_locations l ON o.location_id = l.id
       WHERE o.customer_id = ?
       ORDER BY o.created_at DESC LIMIT ?`,
      [customerId, limit]
    );
    return rows;
  }

  async updateStatus(id, ownerId, status, notes = null) {
    const allowed = ['pending','queued','in_progress','completed','cancelled'];
    if (!allowed.includes(status)) return { changed: 0 };

    const extra = status === 'completed' ? ', end_time = NOW()'
                : status === 'in_progress' ? ', start_time = NOW()'
                : '';

    const [result] = await this.db.query(
      `UPDATE ss_orders
       SET order_status = ?${extra}${notes ? ', notes = ?' : ''}
       WHERE id = ? AND owner_id = ?`,
      notes ? [status, notes, id, ownerId] : [status, id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async updatePayment(id, ownerId, status) {
    const allowed = ['pending','paid','refunded'];
    if (!allowed.includes(status)) return { changed: 0 };

    const [result] = await this.db.query(
      'UPDATE ss_orders SET payment_status = ? WHERE id = ? AND owner_id = ?',
      [status, id, ownerId]
    );
    return { changed: result.changedRows };
  }
}

module.exports = OrderModel;
