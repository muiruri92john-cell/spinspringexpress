// services/pricingService.js — Distance + fee calculation

/**
 * Haversine formula — straight-line distance between two GPS points (km)
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Default pricing config (per owner — can be stored in a settings table later)
 */
const DEFAULT_CONFIG = {
  base_fee: 100,       // KES — starting price
  per_km_rate: 50,     // KES per km
  min_fee: 200,        // KES — minimum total
  max_radius_km: 15,   // auto-assign search radius
};

/**
 * Calculate pickup/delivery fee
 * @returns {Object} { distance, fee, currency, breakdown }
 */
function calculateFee(fromLat, fromLng, toLat, toLng, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!fromLat || !fromLng || !toLat || !toLng) {
    return { distance: null, fee: cfg.min_fee, currency: 'KES', error: 'missing coords' };
  }

  const distance = haversineKm(Number(fromLat), Number(fromLng), Number(toLat), Number(toLng));
  const distanceFee = distance * cfg.per_km_rate;
  const rawFee = cfg.base_fee + distanceFee;
  const fee = Math.max(cfg.min_fee, Math.round(rawFee));

  return {
    distance,
    fee,
    currency: 'KES',
    breakdown: {
      base: cfg.base_fee,
      distance_km: distance,
      rate_per_km: cfg.per_km_rate,
      distance_fee: Math.round(distanceFee),
      minimum: cfg.min_fee,
      final: fee,
    },
  };
}

module.exports = {
  haversineKm,
  calculateFee,
  DEFAULT_CONFIG,
};
