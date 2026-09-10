// =====================================================
// Geolocation utilities for SpinSpring Express
// =====================================================

/**
 * Haversine distance between two coordinates (in km)
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Sort locations by distance from a given point
 */
function sortByDistance(locations, userLat, userLon) {
  return locations
    .map((loc) => ({
      ...loc,
      distance_km: haversineDistance(
        userLat, userLon,
        parseFloat(loc.latitude), parseFloat(loc.longitude)
      ),
    }))
    .sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * Check if a location is currently open (based on local time)
 */
function isOpenNow(location, now = new Date()) {
  if (!location.opening_time || !location.closing_time) return true;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = days[now.getDay()];
  const openDays = (location.open_days || '').split(',').map(s => s.trim());

  if (!openDays.includes(today)) return false;

  const [openH, openM] = location.opening_time.split(':').map(Number);
  const [closeH, closeM] = location.closing_time.split(':').map(Number);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
}

module.exports = {
  haversineDistance,
  sortByDistance,
  isOpenNow,
};