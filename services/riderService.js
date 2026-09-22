// services/riderService.js — Higher-level rider operations

const RiderModel = require('../models/rider');
const DeliveryRequestModel = require('../models/deliveryRequest');
const { haversineKm, calculateFee, DEFAULT_CONFIG } = require('./pricingService');
const pushSvc = require('./pushService');

/**
 * Create a pickup request and auto-assign the closest rider.
 * @returns {Object} { request_id, auto_assigned, rider_id, quoted_fee, distance_km }
 */
async function createPickupRequest(db, { ownerId, customerId, from, to, weight_kg, notes }) {
  const drModel = new DeliveryRequestModel(db);

  // 1. Calculate distance + fee (straight-line)
  let distance = null;
  let quoted = null;

  if (from.lat && from.lng && to.lat && to.lng) {
    const calc = calculateFee(from.lat, from.lng, to.lat, to.lng);
    distance = calc.distance;
    quoted = calc.fee;
  }

  // 2. Create the request
  const { id: requestId } = await drModel.create({
    owner_id: ownerId,
    customer_id: customerId,
    request_type: 'pickup',
    from_location_id: from.location_id || null,
    from_address: from.address || null,
    from_lat: from.lat || null,
    from_lng: from.lng || null,
    to_location_id: to.location_id || null,
    to_address: to.address || null,
    to_lat: to.lat || null,
    to_lng: to.lng || null,
    distance_km: distance,
    quoted_fee: quoted,
    weight_kg: weight_kg || null,
    notes: notes || null,
  });

  // 3. Auto-assign (only if we have a pickup point)
  let assignResult = { assigned: false };
  if (from.lat && from.lng) {
    const { autoAssign } = require('./deliveryService');
    assignResult = await autoAssign(db, requestId);
  }

  // 4. Notify customer (fire and forget)
  try {
    if (customerId) {
      // Look up customer email for email notification
      const [cust] = await db.query(
        'SELECT id, full_name, email FROM ss_customers WHERE id = ? LIMIT 1',
        [customerId]
      );
      if (cust.length && cust[0].email) {
        const { sendEmail } = require('./emailService');
        sendEmail({
          to: cust[0].email,
          subject: `Pickup request received — ${assignResult.assigned ? 'rider assigned' : 'finding rider'}`,
          template: 'pickup-requested',
          data: {
            customer: cust[0],
            request: { id: requestId, distance_km: distance, quoted_fee: quoted },
            rider_assigned: assignResult.assigned,
          },
          db,
        }).catch(e => console.error('pickup email failed:', e.message));
      }
    }
  } catch (e) {
    console.error('customer notify failed:', e.message);
  }

  return {
    request_id: requestId,
    distance_km: distance,
    quoted_fee: quoted,
    auto_assigned: assignResult.assigned,
    rider_id: assignResult.rider_id || null,
    reason: assignResult.reason || null,
  };
}

/**
 * Create a delivery request (return trip) after order is completed.
 */
async function createDeliveryRequest(db, { ownerId, customerId, orderId, from, to, fee }) {
  const drModel = new DeliveryRequestModel(db);

  let distance = null;
  if (from.lat && from.lng && to.lat && to.lng) {
    distance = haversineKm(from.lat, from.lng, to.lat, to.lng);
  }

  const { id: requestId } = await drModel.create({
    owner_id: ownerId,
    customer_id: customerId,
    order_id: orderId,
    request_type: 'delivery',
    from_location_id: from.location_id || null,
    from_address: from.address || null,
    from_lat: from.lat || null,
    from_lng: from.lng || null,
    to_location_id: to.location_id || null,
    to_address: to.address || null,
    to_lat: to.lat || null,
    to_lng: to.lng || null,
    distance_km: distance,
    quoted_fee: fee || null,
  });

  // Auto-assign
  let assignResult = { assigned: false };
  if (from.lat && from.lng) {
    const { autoAssign } = require('./deliveryService');
    assignResult = await autoAssign(db, requestId);
  }

  return {
    request_id: requestId,
    distance_km: distance,
    quoted_fee: fee,
    auto_assigned: assignResult.assigned,
    rider_id: assignResult.rider_id || null,
  };
}

module.exports = {
  createPickupRequest,
  createDeliveryRequest,
};
