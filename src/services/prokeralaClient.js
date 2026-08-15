const { createResilientClient } = require('../utils/resilientClient');
const { prokeralaQueue } = require('../queue/apiQueues');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const BASE_URL = process.env.PROKERALA_BASE_URL || 'https://api.prokerala.com';
const { request } = createResilientClient({ name: 'prokerala', baseTimeoutMs: 8000 });

const CHART_CACHE_TTL = 60 * 60 * 6; // 6h — a fixed birth datetime's chart never changes
let cachedToken = null; // { token, expiresAt } — process-local; fine since it's short-lived and cheap to refetch per replica

/** OAuth2 client-credentials token exchange, with its own retry/circuit-breaker coverage. */
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const response = await request({
    method: 'post',
    url: `${BASE_URL}/token`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PROKERALA_CLIENT_ID,
      client_secret: process.env.PROKERALA_CLIENT_SECRET,
    }).toString(),
  });

  const { access_token, expires_in } = response.data;
  cachedToken = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/**
 * Every real call goes through: shared cache check → concurrency queue →
 * resilient client (retry + circuit breaker). If the circuit is open or all
 * retries are exhausted, this throws — callers (routes) are responsible for
 * turning that into a graceful user-facing fallback, never a raw 500.
 */
async function prokeralaGet(path, params) {
  const cacheKey = `prokerala:${path}:${JSON.stringify(params)}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    logger.debug({ path }, 'Prokerala cache hit');
    return cached;
  }

  const data = await prokeralaQueue.add(async () => {
    const token = await getAccessToken();
    const response = await request({
      method: 'get',
      url: `${BASE_URL}${path}`,
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return response.data;
  });

  await cache.set(cacheKey, data, CHART_CACHE_TTL);
  return data;
}

function buildLocationParams({ isoDatetime, latitude, longitude }) {
  return {
    datetime: isoDatetime,
    coordinates: `${latitude},${longitude}`,
    ayanamsa: 1, // Lahiri — standard for Vedic/Jyotish charts
  };
}

const ProkeralaClient = {
  async getKundli(profile) {
    return prokeralaGet('/v2/astrology/kundli', { ...buildLocationParams(profile), la: 'en' });
  },
  async getDashaPeriods(profile) {
    return prokeralaGet('/v2/astrology/dasha-periods', { ...buildLocationParams(profile), la: 'en' });
  },
  async getKundliDetails(profile) {
    return prokeralaGet('/v2/astrology/kundli/advanced', { ...buildLocationParams(profile), la: 'en' });
  },
  async getPanchang({ isoDatetime, latitude, longitude }) {
    return prokeralaGet('/v2/astrology/panchang', {
      datetime: isoDatetime,
      coordinates: `${latitude},${longitude}`,
      la: 'en',
    });
  },
  async getMatching(profileA, profileB) {
    return prokeralaGet('/v2/astrology/kundli-matching', {
      girl_dob: profileA.isoDatetime,
      girl_coordinates: `${profileA.latitude},${profileA.longitude}`,
      boy_dob: profileB.isoDatetime,
      boy_coordinates: `${profileB.latitude},${profileB.longitude}`,
      la: 'en',
    });
  },
  async getCurrentTransits(profile) {
    // Deliberately short TTL override — transits change through the day,
    // unlike the birth chart itself. Cache this one for 15 minutes only.
    const cacheKey = `prokerala:transits:${profile.latitude},${profile.longitude}:${new Date().toISOString().slice(0, 13)}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const data = await prokeralaQueue.add(async () => {
      const token = await getAccessToken();
      const response = await request({
        method: 'get',
        url: `${BASE_URL}/v2/astrology/planet-position`,
        headers: { Authorization: `Bearer ${token}` },
        params: { datetime: new Date().toISOString(), coordinates: `${profile.latitude},${profile.longitude}`, ayanamsa: 1, la: 'en' },
      });
      return response.data;
    });

    await cache.set(cacheKey, data, 60 * 15);
    return data;
  },
};

module.exports = ProkeralaClient;
