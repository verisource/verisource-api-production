const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.GPS_ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const DEFAULT_RETENTION_DAYS = (() => {
  const n = parseInt(process.env.GPS_RETENTION_DAYS || '365', 10);
  return Number.isFinite(n) && n > 0 ? n : 365;
})();

let warnedMissingKey = false;

function getKey() {
  if (!ENCRYPTION_KEY) {
    if (!warnedMissingKey) {
      console.warn('⚠️ GPS_ENCRYPTION_KEY not set — GPS storage disabled');
      warnedMissingKey = true;
    }
    return null;
  }

  // Must be 64 hex chars => 32 bytes
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (ENCRYPTION_KEY.length !== 64 || key.length !== 32) {
    if (!warnedMissingKey) {
      console.warn('⚠️ GPS_ENCRYPTION_KEY invalid (expected 64 hex chars / 32 bytes) — GPS storage disabled');
      warnedMissingKey = true;
    }
    return null;
  }

  return key;
}

function encrypt(value) {
  const key = getKey();
  if (!key) return null;

  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const text = String(num);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(buffer) {
  const key = getKey();
  if (!key || !buffer) return null;

  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const minLen = IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (buf.length < minLen) return null;

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');

    const num = Number(decrypted);
    return Number.isFinite(num) ? num : null;
  } catch (err) {
    console.error('⚠️ GPS decryption failed:', err.message);
    return null;
  }
}

function getExpiryDate(retentionDays = DEFAULT_RETENTION_DAYS) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString(); // or return `date` if you store TIMESTAMPTZ
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Number.isNaN(d.getTime()) ? true : d < new Date();
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const a = [lat1, lon1, lat2, lon2].map(Number);
  if (a.some(v => !Number.isFinite(v))) return null;

  const [la1, lo1, la2, lo2] = a;
  const R = 6371000;

  const dLat = (la2 - la1) * Math.PI / 180;
  const dLon = (lo2 - lo1) * Math.PI / 180;

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);

  const h =
    s1 * s1 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * s2 * s2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return '—';

  if (m < 1000) return `${Math.round(m)} meters`;

  const km = m / 1000;
  const miles = km * 0.621371;

  if (miles < 1) return `${km.toFixed(1)} km (${miles.toFixed(1)} mi)`;
  if (miles < 100) return `${miles.toFixed(1)} miles`;
  return `${Math.round(miles).toLocaleString()} miles`;
}

module.exports = {
  encrypt,
  decrypt,
  getExpiryDate,
  isExpired,
  distanceMeters,
  formatDistance,
  DEFAULT_RETENTION_DAYS
};
