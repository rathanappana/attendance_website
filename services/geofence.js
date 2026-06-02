const settings = require('../settings');

// Haversine formula — returns distance in meters between two lat/lng points
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinVenue(lat, lng) {
  const { latitude, longitude, radiusMeters } = settings.geofencing;
  const distance = haversineDistance(lat, lng, latitude, longitude);
  return distance <= radiusMeters;
}

module.exports = { isWithinVenue, haversineDistance };
