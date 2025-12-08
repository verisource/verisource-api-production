const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'verifications.db');
const db = new Database(dbPath);

// Store a fingerprint (called after every verification)
function storeFingerprint({ sha256, phash, verificationId, sourceType = 'submission', sourceUrl = null, customerId = null, claimContext = null }) {
  
  // Check if this exact sha256 exists
  const existing = db.prepare('SELECT id, occurrence_count FROM fingerprints WHERE sha256 = ?').get(sha256);
  
  if (existing) {
    // Update occurrence count and last_seen
    db.prepare(`
      UPDATE fingerprints 
      SET occurrence_count = occurrence_count + 1,
          last_seen = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(existing.id);
    
    return { id: existing.id, isNew: false, occurrences: existing.occurrence_count + 1 };
  }
  
  // Insert new fingerprint
  const result = db.prepare(`
    INSERT INTO fingerprints (sha256, phash, verification_id, source_type, source_url, customer_id, claim_context)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sha256, phash, verificationId, sourceType, sourceUrl, customerId, claimContext);
  
  return { id: result.lastInsertRowid, isNew: true, occurrences: 1 };
}

// Store labels from Google Vision
function storeLabels(fingerprintId, labels, source = 'google_vision') {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_labels (fingerprint_id, label, confidence, source)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insert.run(fingerprintId, item.label, item.confidence, source);
    }
  });
  
  insertMany(labels);
  return labels.length;
}

// Check local index before calling external APIs
function checkLocalIndex(sha256, phash = null) {
  const result = {
    exactMatch: null,
    similarMatches: [],
    labelMatches: []
  };
  
  // Check exact SHA256 match
  const exact = db.prepare(`
    SELECT f.*, GROUP_CONCAT(cl.label) as labels
    FROM fingerprints f
    LEFT JOIN content_labels cl ON f.id = cl.fingerprint_id
    WHERE f.sha256 = ?
    GROUP BY f.id
  `).get(sha256);
  
  if (exact) {
    result.exactMatch = {
      ...exact,
      labels: exact.labels ? exact.labels.split(',') : []
    };
  }
  
  // Check pHash similarity (if provided)
  if (phash && !exact) {
    // For now, exact pHash match only
    // TODO: Add hamming distance calculation for near-duplicates
    const similar = db.prepare(`
      SELECT f.*, GROUP_CONCAT(cl.label) as labels
      FROM fingerprints f
      LEFT JOIN content_labels cl ON f.id = cl.fingerprint_id
      WHERE f.phash = ? AND f.sha256 != ?
      GROUP BY f.id
      LIMIT 10
    `).all(phash, sha256);
    
    result.similarMatches = similar.map(s => ({
      ...s,
      labels: s.labels ? s.labels.split(',') : []
    }));
  }
  
  return result;
}

// Find content by label
function findByLabel(label, minConfidence = 0.7, limit = 50) {
  return db.prepare(`
    SELECT f.*, cl.label, cl.confidence
    FROM fingerprints f
    JOIN content_labels cl ON f.id = cl.fingerprint_id
    WHERE cl.label LIKE ? AND cl.confidence >= ?
    ORDER BY cl.confidence DESC
    LIMIT ?
  `).all(`%${label}%`, minConfidence, limit);
}

// Get labels for a fingerprint
function getLabels(fingerprintId) {
  return db.prepare(`
    SELECT label, confidence, source 
    FROM content_labels 
    WHERE fingerprint_id = ?
    ORDER BY confidence DESC
  `).all(fingerprintId);
}

// Find related content (same labels as given fingerprint)
function findRelatedContent(fingerprintId, limit = 20) {
  return db.prepare(`
    SELECT DISTINCT f.*, cl2.label as matching_label, cl2.confidence
    FROM fingerprints f
    JOIN content_labels cl2 ON f.id = cl2.fingerprint_id
    WHERE cl2.label IN (
      SELECT label FROM content_labels WHERE fingerprint_id = ?
    )
    AND f.id != ?
    ORDER BY cl2.confidence DESC
    LIMIT ?
  `).all(fingerprintId, fingerprintId, limit);
}

// Cache external search results
function cacheSearchResult({ fingerprintId, service, queryHash, totalMatches, matchUrls, rawResponse, expiresIn = 86400 }) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  
  return db.prepare(`
    INSERT INTO external_search_cache 
    (fingerprint_id, service, query_hash, total_matches, match_urls, raw_response, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(fingerprintId, service, queryHash, totalMatches, JSON.stringify(matchUrls), JSON.stringify(rawResponse), expiresAt);
}

// Check cache before calling external API
function checkCache(queryHash, service) {
  return db.prepare(`
    SELECT * FROM external_search_cache 
    WHERE query_hash = ? AND service = ? AND expires_at > datetime('now')
    ORDER BY queried_at DESC
    LIMIT 1
  `).get(queryHash, service);
}

// Stats for monitoring
function getIndexStats() {
  return {
    totalFingerprints: db.prepare('SELECT COUNT(*) as count FROM fingerprints').get().count,
    totalLabels: db.prepare('SELECT COUNT(*) as count FROM content_labels').get().count,
    uniqueLabels: db.prepare('SELECT COUNT(DISTINCT label) as count FROM content_labels').get().count,
    cachedSearches: db.prepare('SELECT COUNT(*) as count FROM external_search_cache').get().count,
    topLabels: db.prepare(`
      SELECT label, COUNT(*) as count 
      FROM content_labels 
      GROUP BY label 
      ORDER BY count DESC 
      LIMIT 10
    `).all()
  };
}

module.exports = {
  storeFingerprint,
  storeLabels,
  checkLocalIndex,
  findByLabel,
  getLabels,
  findRelatedContent,
  cacheSearchResult,
  checkCache,
  getIndexStats
};