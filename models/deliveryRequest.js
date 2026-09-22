// models/deliveryRequest.js — Pickup / delivery / bike_send operations

class DeliveryRequestModel {
  constructor(db) {
    this.db = db;
  }

  // ─── Create ───────────────────────────────────────
  async create(data) {
    const [result] = await this.db.query(
      `INSERT INTO ss_delivery_requests
       (owner_id, customer_id, order_id, request_type, status,
        from_location_id, from_address, from_lat, from_lng,
        to_location_id, to_address, to_lat, to_lng,
        distance_km, quoted_fee, weight_kg, notes)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.owner_id,
        data.customer_id || null,
        data.order_id || null,
        data.request_type,
        data.from_location_id || null,
        data.from_address || null,
        data.from_lat || null,
        data.from_lng || null,
        data.to_location_id || null,
        data.to_address || null,
        data.to_lat || null,
        data.to_lng || null,
        data.distance_km || null,
        data.quoted_fee || null,
        data.weight_kg || null,
        data.notes || null,
      ]
    );
    return { id: result.insertId };
  }

  // ─── Find ─────────────────────────────────────────
  async findById(id, ownerId = null) {
    const params = [id];
    let sql = `
      SELECT dr.*,
             c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
             r.full_name AS rider_name, r.phone AS rider_phone, r.vehicle_type AS rider_vehicle,
             o.order_number AS order_number
      FROM ss_delivery_requests dr
      LEFT JOIN ss_customers c ON c.id = dr.customer_id
      LEFT JOIN ss_riders r ON r.id = dr.rider_id
      LEFT JOIN ss_orders o ON o.id = dr.order_id
      WHERE dr.id = ?`;
    if (ownerId) {
      sql += ' AND dr.owner_id = ?';
      params.push(ownerId);
    }
    const [rows] = await this.db.query(sql + ' LIMIT 1', params);
    return rows[0] || null;
  }

  async listByOwner(ownerId, filters = {}) {
    const params = [ownerId];
    let sql = `
      SELECT dr.*,
             c.full_name AS customer_name, c.phone AS customer_phone,
             r.full_name AS rider_name, r.phone AS rider_phone
      FROM ss_delivery_requests dr
      LEFT JOIN ss_customers c ON c.id = dr.customer_id
      LEFT JOIN ss_riders r ON r.id = dr.rider_id
      WHERE dr.owner_id = ?`;
    if (filters.status) {
      sql += ' AND dr.status = ?';
      params.push(filters.status);
    }
    if (filters.rider_id) {
      sql += ' AND dr.rider_id = ?';
      params.push(filters.rider_id);
    }
    sql += ' ORDER BY dr.created_at DESC LIMIT 200';
    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  async listActiveForRider(riderId) {
    const [rows] = await this.db.query(
      `SELECT dr.*,
              c.full_name AS customer_name, c.phone AS customer_phone
       FROM ss_delivery_requests dr
       LEFT JOIN ss_customers c ON c.id = dr.customer_id
       WHERE dr.rider_id = ?
         AND dr.status IN ('accepted','picked_up','in_transit')
       ORDER BY dr.accepted_at DESC`,
      [riderId]
    );
    return rows;
  }

  async listPendingForRider(riderId, ownerId) {
    // Riders see requests where they are assigned but haven't accepted yet
    const [rows] = await this.db.query(
      `SELECT dr.*,
              c.full_name AS customer_name, c.phone AS customer_phone
       FROM ss_delivery_requests dr
       LEFT JOIN ss_customers c ON c.id = dr.customer_id
       WHERE dr.rider_id = ?
         AND dr.status = 'assigned'
         AND dr.owner_id = ?
       ORDER BY dr.assigned_at DESC`,
      [riderId, ownerId]
    );
    return rows;
  }

  async listByCustomer(customerId) {
    const [rows] = await this.db.query(
      `SELECT dr.*, r.full_name AS rider_name, r.phone AS rider_phone
       FROM ss_delivery_requests dr
       LEFT JOIN ss_riders r ON r.id = dr.rider_id
       WHERE dr.customer_id = ?
       ORDER BY dr.created_at DESC LIMIT 50`,
      [customerId]
    );
    return rows;
  }

  // ─── Status updates ───────────────────────────────
  async assignRider(id, riderId) {
    await this.db.query(
      `UPDATE ss_delivery_requests
       SET rider_id = ?, status = 'assigned', assigned_at = NOW()
       WHERE id = ?`,
      [riderId, id]
    );
  }

  async accept(id, riderId) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET status = 'accepted', accepted_at = NOW()
       WHERE id = ? AND rider_id = ? AND status = 'assigned'`,
      [id, riderId]
    );
    return { changed: result.changedRows };
  }

  async decline(id, riderId, reason = null) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET rider_id = NULL, status = 'assigning', assigned_at = NULL,
           notes = COALESCE(CONCAT(notes, '\\nDeclined by rider ', ?), CONCAT('Declined: ', ?))
       WHERE id = ? AND rider_id = ? AND status = 'assigned'`,
      [riderId, reason || 'no reason', id, riderId]
    );
    return { changed: result.changedRows };
  }

  async markPickedUp(id, riderId) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET status = 'picked_up', picked_up_at = NOW()
       WHERE id = ? AND rider_id = ? AND status IN ('accepted')`,
      [id, riderId]
    );
    return { changed: result.changedRows };
  }

  async markInTransit(id, riderId) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET status = 'in_transit'
       WHERE id = ? AND rider_id = ? AND status = 'picked_up'`,
      [id, riderId]
    );
    return { changed: result.changedRows };
  }

  async markDelivered(id, riderId, finalFee = null) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET status = 'delivered', delivered_at = NOW(),
           final_fee = COALESCE(?, negotiated_fee, quoted_fee),
           payment_status = 'paid_to_rider'
       WHERE id = ? AND rider_id = ? AND status IN ('picked_up','in_transit')`,
      [finalFee, id, riderId]
    );
    return { changed: result.changedRows };
  }

  async cancel(id, ownerId, reason = null) {
    const [result] = await this.db.query(
      `UPDATE ss_delivery_requests
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ?
       WHERE id = ? AND owner_id = ? AND status NOT IN ('delivered','cancelled')`,
      [reason, id, ownerId]
    );
    return { changed: result.changedRows };
  }

  async negotiateFee(id, riderId, newFee) {
    await this.db.query(
      `UPDATE ss_delivery_requests
       SET negotiated_fee = ?
       WHERE id = ? AND rider_id = ? AND status IN ('assigned','accepted')`,
      [newFee, id, riderId]
    );
  }

  // ─── Stats ────────────────────────────────────────
  async getStats(ownerId) {
    const [rows] = await this.db.query(
      `SELECT
         COUNT(*) AS total_requests,
         SUM(status IN ('pending','assigning','assigned','accepted','picked_up','in_transit')) AS active_requests,
         SUM(status = 'delivered') AS completed,
         SUM(status = 'cancelled') AS cancelled,
         COALESCE(SUM(CASE WHEN status = 'delivered' THEN final_fee ELSE 0 END), 0) AS total_fees
       FROM ss_delivery_requests WHERE owner_id = ?`,
      [ownerId]
    );
    return rows[0] || {};
  }
}

module.exports = DeliveryRequestModel;
