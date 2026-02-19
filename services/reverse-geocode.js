/**
 * Reverse Geocode Service
 * Converts GPS coordinates to city/state/country for non-PII storage.
 */
const GOOGLE_GEOCODE_KEY = process.env.GOOGLE_GEOCODE_KEY || process.env.GOOGLE_API_KEY;
let warnedMissingKey = false;

// Simple in-memory cache (good enough for your scale)
const cache = new Map(); // key -> { value, expiresAt }
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CACHE_MAX_SIZE = 50000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_SIZE) cache.clear();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function isFiniteNumber(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function roundCoord(n, decimals = 3) {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function extractPlace(results) {
  let city = null, state = null, country = null;

  const cityTypes = new Set([
    'locality',
    'postal_town',
    'sublocality_level_1',
    'sublocality',
    'administrative_area_level_2',
  ]);

  for (const r of results || []) {
    for (const comp of r.address_components || []) {
      const types = comp.types || [];
      if (!city && types.some(t => cityTypes.has(t))) city = comp.long_name;
      if (!state && types.includes('administrative_area_level_1')) state = comp.short_name;
      if (!country && types.includes('country')) country = comp.long_name;
    }
    if (city && state && country) break;
  }

  if (city && state && country === 'United States') return `${city}, ${state}`;
  if (city && country) return `${city}, ${country}`;
  if (state && country) return `${state}, ${country}`;
  if (country) return country;
  return null;
}

async function reverseGeocode(lat, lon) {
  if (!GOOGLE_GEOCODE_KEY) {
    if (!warnedMissingKey) {
      console.warn('⚠️ GOOGLE_GEOCODE_KEY/GOOGLE_API_KEY not set — reverse geocoding disabled');
      warnedMissingKey = true;
    }
    return null;
  }

  const la = isFiniteNumber(lat);
  const lo = isFiniteNumber(lon);
  if (la == null || lo == null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;

  const rLat = roundCoord(la, 3);
  const rLon = roundCoord(lo, 3);
  const cacheKey = `${rLat},${rLon}`;

  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${encodeURIComponent(`${rLat},${rLon}`)}` +
      `&key=${encodeURIComponent(GOOGLE_GEOCODE_KEY)}` +
      `&language=en`;

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const data = await response.json();

    if (data.status === 'OVER_QUERY_LIMIT') return null;
    if (data.status !== 'OK' || !data.results?.length) return null;

    const place = extractPlace(data.results);
    cacheSet(cacheKey, place);
    return place;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('⚠️ Reverse geocode failed:', err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { reverseGeocode };