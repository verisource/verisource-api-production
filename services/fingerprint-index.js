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
// Cross-reference analysis for verification response
function analyzeCrossReference(sha256, phash, labels = [], customerId = null) {
  const result = {
    exact_match: null,
    similar_content_found: false,
    index_status: {
      fingerprint_id: null,
      is_new: true,
      total_in_index: 0
    },
    related_by_label: {
      total: 0,
      high_confidence_matches: [],
      flags: []
    },
    related_by_phash: {
      total: 0,
      near_duplicates: []
    },
    fraud_indicators: {
      risk_level: 'low',
      flags: [],
      recommendation: 'No cross-reference concerns detected'
    }
  };

  try {
    // Get total index size
    result.index_status.total_in_index = db.prepare('SELECT COUNT(*) as count FROM fingerprints').get().count;

    // Check exact match
    const exactMatch = db.prepare(`
      SELECT f.*, GROUP_CONCAT(DISTINCT cl.label) as labels
      FROM fingerprints f
      LEFT JOIN content_labels cl ON f.id = cl.fingerprint_id
      WHERE f.sha256 = ?
      GROUP BY f.id
    `).get(sha256);

    if (exactMatch) {
      result.exact_match = {
        fingerprint_id: exactMatch.id,
        first_seen: exactMatch.first_seen,
        source_type: exactMatch.source_type,
        source_url: exactMatch.source_url,
        customer_id: exactMatch.customer_id,
        occurrence_count: exactMatch.occurrence_count,
        labels: exactMatch.labels ? exactMatch.labels.split(',') : []
      };
      result.index_status.fingerprint_id = exactMatch.id;
      result.index_status.is_new = false;
      result.similar_content_found = true;

      // Flag if seen multiple times
      if (exactMatch.occurrence_count > 1) {
        result.fraud_indicators.flags.push(
          `DUPLICATE: Image submitted ${exactMatch.occurrence_count} times (first seen: ${exactMatch.first_seen})`
        );
      }

      // Flag if different customer
      if (customerId && exactMatch.customer_id && exactMatch.customer_id !== customerId) {
        result.fraud_indicators.flags.push(
          `CROSS_CUSTOMER: Same image previously submitted by different customer (${exactMatch.customer_id})`
        );
        result.fraud_indicators.risk_level = 'critical';
      } else if (customerId && exactMatch.occurrence_count >= 2) {
        // Customer submitting something that's been seen multiple times
        result.fraud_indicators.flags.push(
          `SUSPICIOUS_REUSE: Content submitted ${exactMatch.occurrence_count} times previously (first seen: ${exactMatch.first_seen})`
        );
        if (result.fraud_indicators.risk_level === 'low') {
          result.fraud_indicators.risk_level = 'medium';
        }
      }

      // Flag if from stock photo seed
      if (exactMatch.source_type === 'seed' || exactMatch.source_type === 'stock') {
        result.fraud_indicators.flags.push(
          `STOCK_PHOTO: Image matches known stock photo${exactMatch.source_url ? ' (' + exactMatch.source_url + ')' : ''}`
        );
        result.fraud_indicators.risk_level = 'high';
      }
    }

    // Check pHash near-duplicates
    if (phash) {
      const similarByPhash = db.prepare(`
        SELECT f.*, GROUP_CONCAT(DISTINCT cl.label) as labels
        FROM fingerprints f
        LEFT JOIN content_labels cl ON f.id = cl.fingerprint_id
        WHERE f.phash = ? AND f.sha256 != ?
        GROUP BY f.id
        LIMIT 10
      `).all(phash, sha256);

      if (similarByPhash.length > 0) {
        result.related_by_phash.total = similarByPhash.length;
        result.related_by_phash.near_duplicates = similarByPhash.map(s => ({
          fingerprint_id: s.id,
          sha256: s.sha256,
          first_seen: s.first_seen,
          customer_id: s.customer_id,
          source_type: s.source_type,
          labels: s.labels ? s.labels.split(',') : []
        }));
        result.similar_content_found = true;

        result.fraud_indicators.flags.push(
          `NEAR_DUPLICATE: ${similarByPhash.length} visually identical image(s) found in index`
        );
        if (result.fraud_indicators.risk_level === 'low') {
          result.fraud_indicators.risk_level = 'high';
        }
      }
    }

    // Check related by labels
    if (labels && labels.length > 0) {
      const labelNames = labels.map(l => l.description || l.label || l).filter(Boolean);
      
      if (labelNames.length > 0) {
        // Find other fingerprints with same labels
        const placeholders = labelNames.map(() => '?').join(',');
        const relatedByLabel = db.prepare(`
          SELECT cl.label, COUNT(DISTINCT cl.fingerprint_id) as count,
                 MIN(f.first_seen) as earliest,
                 MAX(f.first_seen) as latest
          FROM content_labels cl
          JOIN fingerprints f ON cl.fingerprint_id = f.id
          WHERE cl.label IN (${placeholders})
          AND f.sha256 != ?
          GROUP BY cl.label
          ORDER BY count DESC
          LIMIT 10
        `).all(...labelNames, sha256);

        if (relatedByLabel.length > 0) {
          result.related_by_label.total = relatedByLabel.reduce((sum, r) => sum + r.count, 0);
          result.related_by_label.high_confidence_matches = relatedByLabel.map(r => ({
            label: r.label,
            previous_submissions: r.count,
            first_seen: r.earliest,
            last_seen: r.latest
          }));
          result.similar_content_found = true;
        }

        // Check for suspicious patterns (same customer, many similar claims)
        if (customerId) {
          const sameCustomerSimilar = db.prepare(`
            SELECT COUNT(DISTINCT f.id) as count
            FROM fingerprints f
            JOIN content_labels cl ON f.id = cl.fingerprint_id
            WHERE cl.label IN (${placeholders})
            AND f.customer_id = ?
            AND f.sha256 != ?
          `).get(...labelNames, customerId, sha256);

          if (sameCustomerSimilar && sameCustomerSimilar.count >= 5) {
            result.related_by_label.flags.push(
              `PATTERN: Same customer has ${sameCustomerSimilar.count} similar submissions`
            );
            result.fraud_indicators.flags.push(
              `CLAIM_VELOCITY: Customer has ${sameCustomerSimilar.count} similar content submissions`
            );
            if (result.fraud_indicators.risk_level === 'low') {
              result.fraud_indicators.risk_level = 'medium';
            }
          }
        }
      }
    }

    // Set final recommendation based on risk level
    if (result.fraud_indicators.risk_level === 'critical') {
      result.fraud_indicators.recommendation = 'Flag for immediate investigation - high fraud probability';
    } else if (result.fraud_indicators.risk_level === 'high') {
      result.fraud_indicators.recommendation = 'Review required - potential fraud indicators detected';
    } else if (result.fraud_indicators.risk_level === 'medium') {
      result.fraud_indicators.recommendation = 'Monitor - unusual patterns detected';
    }

  } catch (err) {
    console.error('Cross-reference analysis error:', err.message);
    result.fraud_indicators.flags.push(`ANALYSIS_ERROR: ${err.message}`);
  }

  return result;
}

module.exports.analyzeCrossReference = analyzeCrossReference;

// Temporal validation - compare dates for inconsistencies
function analyzeTemporalConsistency(exifDate, firstSeen, claimedDate = null) {
  const result = {
    exif_date: null,
    first_indexed: firstSeen || null,
    age_days: null,
    flags: [],
    risk_level: 'low'
  };

  const now = new Date();
  
  // Parse EXIF date
  if (exifDate) {
    let parsed = null;
    if (typeof exifDate === 'number') {
      parsed = new Date(exifDate * 1000);
    } else if (typeof exifDate === 'string') {
      // Handle EXIF format: "2019:03:15 14:30:00"
      const normalized = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      parsed = new Date(normalized);
    } else if (exifDate instanceof Date) {
      parsed = exifDate;
    }
    
    if (parsed && !isNaN(parsed.getTime())) {
      result.exif_date = parsed.toISOString();
      result.age_days = Math.floor((now - parsed) / (1000 * 60 * 60 * 24));
      
      // Flag old images
      if (result.age_days > 365 * 2) {
        result.flags.push(`OLD_CONTENT: Image EXIF date is ${Math.floor(result.age_days / 365)} years old`);
        result.risk_level = 'medium';
      } else if (result.age_days > 365) {
        result.flags.push(`AGED_CONTENT: Image EXIF date is over 1 year old`);
      }
      
      // Flag future dates (metadata manipulation)
      if (parsed > now) {
        result.flags.push('FUTURE_DATE: EXIF date is in the future - possible metadata manipulation');
        result.risk_level = 'high';
      }
      
      // Flag if EXIF date is before first_indexed (could mean re-upload of old content)
      if (firstSeen) {
        const firstSeenDate = new Date(firstSeen);
        const daysBetween = Math.floor((firstSeenDate - parsed) / (1000 * 60 * 60 * 24));
        if (daysBetween > 30) {
          result.flags.push(`DELAYED_SUBMISSION: Image was created ${daysBetween} days before first submission`);
        }
      }
    }
  } else {
    result.flags.push('NO_EXIF_DATE: No creation date in metadata - cannot verify timeline');
  }
  
  // Compare to claimed date if provided
  if (claimedDate && result.exif_date) {
    const claimed = new Date(claimedDate);
    const exif = new Date(result.exif_date);
    
    if (!isNaN(claimed.getTime())) {
      const daysDiff = Math.floor((claimed - exif) / (1000 * 60 * 60 * 24));
      
      if (daysDiff < -1) {
        // EXIF date is AFTER claimed event (image can't exist before it was taken)
        result.flags.push(`TEMPORAL_IMPOSSIBLE: Image EXIF date (${result.exif_date.split('T')[0]}) is after claimed event`);
        result.risk_level = 'high';
      } else if (daysDiff > 365) {
        // Image is much older than claimed event
        result.flags.push(`PRE_EXISTING: Image is ${Math.floor(daysDiff / 365)} years older than claimed event`);
        result.risk_level = 'high';
      } else if (daysDiff > 30) {
        result.flags.push(`DATE_GAP: Image is ${daysDiff} days older than claimed event`);
        result.risk_level = 'medium';
      }
    }
  }
  
  return result;
}

module.exports.analyzeTemporalConsistency = analyzeTemporalConsistency;
