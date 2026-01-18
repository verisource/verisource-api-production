/**
 * AI Image Hash Lookup Module
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const TABLE = 'ai_image_hashes';

function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const b1 = parseInt(hash1[i], 16);
    const b2 = parseInt(hash2[i], 16);
    let xor = b1 ^ b2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

async function lookupBySHA256(sha256) {
  const result = await pool.query(
    `SELECT source, source_id, source_url, generator_model, generator_type, prompt, width, height, crawled_at FROM ${TABLE} WHERE sha256 = $1 LIMIT 1`,
    [sha256]
  );
  if (result.rows.length > 0) {
    return { matched: true, matchType: 'exact', confidence: 1.0, ...result.rows[0] };
  }
  return null;
}

async function lookupByPHash(phash, threshold = 10, limit = 5) {
  if (!phash) return null;
  const exactResult = await pool.query(
    `SELECT source, source_id, source_url, phash, generator_model, generator_type, prompt, width, height, crawled_at FROM ${TABLE} WHERE phash = $1 LIMIT 1`,
    [phash]
  );
  if (exactResult.rows.length > 0) {
    return { matched: true, matchType: 'exact_phash', distance: 0, confidence: 1.0, matches: exactResult.rows };
  }
  const prefix = phash.substring(0, 4);
  const candidates = await pool.query(
    `SELECT source, source_id, source_url, phash, generator_model, generator_type, prompt, width, height, crawled_at FROM ${TABLE} WHERE phash LIKE $1 LIMIT 1000`,
    [`${prefix}%`]
  );
  const matches = candidates.rows
    .map(row => ({ ...row, distance: hammingDistance(phash, row.phash) }))
    .filter(row => row.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
  if (matches.length > 0) {
    const bestMatch = matches[0];
    const confidence = 1 - (bestMatch.distance / (phash.length * 4));
    return { matched: true, matchType: 'fuzzy_phash', distance: bestMatch.distance, confidence: Math.max(0.5, confidence), matches };
  }
  return null;
}

async function lookupByDHash(dhash) {
  if (!dhash) return null;
  const result = await pool.query(
    `SELECT source, source_id, source_url, dhash, generator_model, generator_type, crawled_at FROM ${TABLE} WHERE dhash = $1 LIMIT 1`,
    [dhash]
  );
  if (result.rows.length > 0) {
    return { matched: true, matchType: 'exact_dhash', confidence: 1.0, ...result.rows[0] };
  }
  return null;
}

async function lookupImage({ sha256, phash, dhash }) {
  if (sha256) {
    const match = await lookupBySHA256(sha256);
    if (match) return match;
  }
  if (phash) {
    const match = await lookupByPHash(phash, 0);
    if (match) return match;
  }
  if (dhash) {
    const match = await lookupByDHash(dhash);
    if (match) return match;
  }
  if (phash) {
    const fuzzyMatch = await lookupByPHash(phash, 10);
    if (fuzzyMatch) return fuzzyMatch;
  }
  return null;
}

async function getDatabaseStats() {
  const result = await pool.query(
    `SELECT COUNT(*) as total_images, COUNT(DISTINCT generator_model) as unique_models, COUNT(DISTINCT source) as sources FROM ${TABLE}`
  );
  return result.rows[0];
}

module.exports = { lookupBySHA256, lookupByPHash, lookupByDHash, lookupImage, getDatabaseStats, hammingDistance };