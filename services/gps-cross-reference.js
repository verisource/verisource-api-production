/**
 * GPS Cross-Reference Service
 * Finds verifications with GPS data near a given location.
 * Used for cross-claim matching, location pattern detection.
 */

const db = require('../db-minimal');
const gpsEncryption = require('./gps-encryption');

/**
 * Find verifications within a radius of given coordinates.
 * Only searches within the same account (privacy isolation).
 * Only searches non-expired GPS data.
 *
 * @param {number} lat - Latitude to search around
 * @param {number} lon - Longitude to search around
 * @param {string} accountId - Account to search within
 * @param {string} excludeFingerprint - Current upload fingerprint to exclude
 * @param {number} radiusMeters - Search radius (default 100m)
 * @param {string} locationHint - Optional city/state to pre-filter (e.g. "Atlanta, GA")
 * @returns {Array} Nearby verifications with distance
 */
async function findNearby(lat, lon, accountId, excludeFingerprint = null, radiusMeters = 100, locationHint = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !accountId) return [];
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) radiusMeters = 100;

  try {
    const params = [accountId];
    let query = `
      SELECT fingerprint, gps_latitude_enc, gps_longitude_enc,
             location_general, upload_date, original_filename,
             camera_make, camera_model, gps_expires_at
      FROM verifications
      WHERE account_id = $1
        AND gps_latitude_enc IS NOT NULL
        AND gps_longitude_enc IS NOT NULL
        AND (gps_expires_at IS NULL OR gps_expires_at > NOW())
    `;

    if (excludeFingerprint) {
      params.push(excludeFingerprint);
      query += ` AND fingerprint != $${params.length}`;
    }

    // Pre-filter by city/state when available — avoids decrypting
    // every row for large accounts (50K+ verifications)
    if (locationHint) {
      params.push(locationHint);
      query += ` AND location_general = $${params.length}`;
    }

    query += ` ORDER BY upload_date DESC LIMIT 1000`;

    const result = await db.query(query, params);

    const nearby = [];

    for (const row of result.rows) {
      const storedLat = gpsEncryption.decrypt(row.gps_latitude_enc);
      const storedLon = gpsEncryption.decrypt(row.gps_longitude_enc);
      if (!Number.isFinite(storedLat) || !Number.isFinite(storedLon)) continue;

      const distance = gpsEncryption.distanceMeters(lat, lon, storedLat, storedLon);
      if (!Number.isFinite(distance)) continue;

      if (distance <= radiusMeters) {
        nearby.push({
          fingerprint: row.fingerprint,
          distance_raw: distance,
          distance_meters: Math.round(distance),
          distance_formatted: gpsEncryption.formatDistance(distance),
          location_general: row.location_general,
          upload_date: row.upload_date,
          filename: row.original_filename,
          camera: row.camera_make && row.camera_model ? `${row.camera_make} ${row.camera_model}` : null,
        });
      }
    }

    // Sort by true distance
    nearby.sort((a, b) => a.distance_raw - b.distance_raw);

    // Drop distance_raw from output
    return nearby.map(({ distance_raw, ...rest }) => rest);
  } catch (err) {
    console.error('⚠️ GPS cross-reference error:', err.message);
    return [];
  }
}

/**
 * Verify GPS against a claimed location.
 * Returns distance and match assessment.
 */
function verifyAgainstClaimed(actualLat, actualLon, claimedLat, claimedLon) {
  const coords = [actualLat, actualLon, claimedLat, claimedLon].map(Number);
  if (coords.some(v => !Number.isFinite(v))) {
    return {
      distance_meters: null,
      distance_formatted: '—',
      assessment: 'unknown',
      match: false
    };
  }

  const distance = gpsEncryption.distanceMeters(coords[0], coords[1], coords[2], coords[3]);
  if (!Number.isFinite(distance)) {
    return {
      distance_meters: null,
      distance_formatted: '—',
      assessment: 'unknown',
      match: false
    };
  }

  let assessment;
  if (distance < 50) assessment = 'exact_match';
  else if (distance < 200) assessment = 'nearby';
  else if (distance < 1000) assessment = 'same_area';
  else if (distance < 50000) assessment = 'different_location';
  else assessment = 'different_region';

  return {
    distance_meters: Math.round(distance),
    distance_formatted: gpsEncryption.formatDistance(distance),
    assessment,
    match: distance < 200
  };
}

module.exports = { findNearby, verifyAgainstClaimed };