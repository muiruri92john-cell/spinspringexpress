// services/deliveryService.js — Auto-assign riders + notification dispatch

const { haversineKm, calculateFee, DEFAULT_CONFIG } = require('./pricingService');
const pushSvc = require('./pushService');

/**
 * Find the closest available rider to a pickup point.
 * @returns {Array} List of candidates sorted by distance
 */
async function findCandidates(db, ownerId, fromLat, fromLng, maxRadiusKm = DEFAULT_CONFIG.max_radius_km) {
  const [riders] = await db.query(
    `SELECT id, full_name, phone, current_lat, current_lng, last_seen_at,
            total_deliveries, rating
     FROM ss_riders
     WHERE owner_id = ? AND is_active = 1 AND is_available = 1
       AND last_seen_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       AND current_lat IS NOT NULL AND current_lng IS NOT NULL`,
    [ownerId]
  );

  const candidates = riders
    .map((r) => ({
      ...r,
      distance_km: haversineKm(Number(fromLat), Number(fromLng), Number(r.current_lat), Number(r.current_lng)),
    }))
    .filter((r) => r.distance_km <= maxRadiusKm)
    .sort((a, b) => {
      // Prefer closer, tie-break by rating (higher first)
      if (Math.abs(a.distance_km - b.distance_km) < 0.5) {
        return (b.rating || 5) - (a.rating || 5);
      }
      return a.distance_km - b.distance_km;
    });

  return candidates;
}

/**
 * Auto-assign a delivery request to the closest rider.
 * Tries candidates in order; logs every attempt.
 * @returns {Object} { assigned: true|false, rider_id, candidates }
 */
async function autoAssign(db, requestId) {
  const [requests] = await db.query(
    'SELECT * FROM ss_delivery_requests WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (!requests.length) return { assigned: false, error: 'Request not found' };
  const req = requests[0];

  if (!req.from_lat || !req.from_lng) {
    return { assigned: false, error: 'Request has no pickup coordinates' };
  }

  const candidates = await findCandidates(db, req.owner_id, req.from_lat, req.from_lng);

  // Log all candidates
  for (const c of candidates) {
    try {
      await db.query(
        `INSERT INTO ss_rider_assignments_log
         (delivery_request_id, candidate_rider_id, distance_km, chosen)
         VALUES (?, ?, ?, 0)`,
        [requestId, c.id, c.distance_km]
      );
    } catch (e) { /* ignore */ }
  }

  if (!candidates.length) {
    await db.query(
      "UPDATE ss_delivery_requests SET status = 'pending' WHERE id = ?",
      [requestId]
    );
    return { assigned: false, reason: 'no_candidates' };
  }

  const chosen = candidates[0];

  // Mark chosen in log
  try {
    await db.query(
      `UPDATE ss_rider_assignments_log
       SET chosen = 1
       WHERE delivery_request_id = ? AND candidate_rider_id = ?
       ORDER BY id DESC LIMIT 1`,
      [requestId, chosen.id]
    );
  } catch (e) { /* ignore */ }

  // Assign
  await db.query(
    `UPDATE ss_delivery_requests
     SET rider_id = ?, status = 'assigned', assigned_at = NOW()
     WHERE id = ?`,
    [chosen.id, requestId]
  );

  // ─── Notify rider (push + email) ─────────────────────
  try {
    const { notifyRider } = require('./pushService');
    const [freshReq] = await db.query(
      `SELECT dr.*, c.full_name AS customer_name, c.phone AS customer_phone
       FROM ss_delivery_requests dr
       LEFT JOIN ss_customers c ON c.id = dr.customer_id
       WHERE dr.id = ? LIMIT 1`,
      [requestId]
    );
    const dr = freshReq[0];

    if (notifyRider) {
      await notifyRider(chosen.id, {
        title: `📍 New ${dr.request_type}`,
        body: `${chosen.distance_km.toFixed(1)} km away — ${dr.quoted_fee || '?'} KES`,
        tag: `request-${requestId}`,
        data: { url: '/rider' },
      }, db).catch((e) => console.error('push rider failed:', e.message));
    }
  } catch (e) {
    console.error('notify rider failed:', e.message);
  }

  return { assigned: true, rider_id: chosen.id, distance_km: chosen.distance_km, candidates: candidates.length };
}

/**
 * Reassign a request to the next candidate (after decline or timeout)
 */
async function reassign(db, requestId) {
  // Find last assigned rider
  const [reqs] = await db.query(
    'SELECT rider_id FROM ss_delivery_requests WHERE id = ? LIMIT 1',
    [requestId]
  );
  const lastRiderId = reqs[0]?.rider_id;

  // Log rejection
  if (lastRiderId) {
    try {
      await db.query(
        `UPDATE ss_rider_assignments_log
         SET chosen = 0, rejection_reason = 'declined_or_timeout'
         WHERE delivery_request_id = ? AND candidate_rider_id = ?`,
        [requestId, lastRiderId]
      );
    } catch (e) { /* ignore */ }
  }

  // Clear assignment
  await db.query(
    "UPDATE ss_delivery_requests SET rider_id = NULL, status = 'assigning', assigned_at = NULL WHERE id = ?",
    [requestId]
  );

  // Try next candidate
  return autoAssign(db, requestId);
}

module.exports = {
  findCandidates,
  autoAssign,
  reassign,
};
