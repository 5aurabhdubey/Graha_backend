const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 60 * 60 * 24 * 30 }); // 30 days — place coordinates never change

/**
 * Uses OpenStreetMap's Nominatim (free, no key required) to turn
 * "Jaipur, Rajasthan, India" into coordinates. Swap for Google Geocoding
 * API if you need higher accuracy/rate limits at scale — same interface.
 */
async function geocodePlace(placeText) {
  const cached = cache.get(placeText);
  if (cached) return cached;

  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: placeText, format: 'json', limit: 1 },
    headers: { 'User-Agent': 'Graha-Astrology-App/1.0' }, // Nominatim requires a UA
  });

  if (!response.data || response.data.length === 0) {
    throw new Error(`Could not resolve location: "${placeText}"`);
  }

  const result = {
    latitude: parseFloat(response.data[0].lat),
    longitude: parseFloat(response.data[0].lon),
    displayName: response.data[0].display_name,
  };

  cache.set(placeText, result);
  return result;
}

module.exports = { geocodePlace };
