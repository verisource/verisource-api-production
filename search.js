const db = require('./db-minimal');
const fingerprintIndex = require('./services/fingerprint-index');
const FingerprintCachePG = require('./services/fingerprint-cache-pg');

async function searchByFingerprint(fingerprint) {
  try {
    // Check SQLite fingerprint index first (fast local lookup)
    const localResult = fingerprintIndex.checkLocalIndex(fingerprint);
    if (localResult.exactMatch) {
      console.log('⚡ Cache hit: Found in local fingerprint index');
    }

    // Ensure database is initialized
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for search');
      return {
        found: localResult.exactMatch !== null,
        is_first_verification: localResult.exactMatch === null,
        message: 'Database temporarily unavailable',
        local_index: localResult
      };
    }
    
    const query = `
      SELECT * FROM verifications 
      WHERE fingerprint = $1
      ORDER BY upload_date ASC
    `;
    
    const result = await db.query(query, [fingerprint]);
    
    if (result.rows.length === 0) {
      return {
        found: false,
        is_first_verification: true,
        message: "First time this file has been verified",
        local_index: localResult
      };
    }
    
    const matches = result.rows;
    return {
      found: true,
      is_first_verification: false,
      total_verifications: matches.length,
      first_seen: matches[0].upload_date,
      first_filename: matches[0].original_filename,
      polygon_block_number: matches[0].polygon_block_number,
      polygon_tx_hash: matches[0].polygon_tx_hash,
      polygon_timestamp: matches[0].polygon_timestamp,
      base_block_number: matches[0].base_block_number,
      base_tx_hash: matches[0].base_tx_hash,
      base_timestamp: matches[0].base_timestamp,
      local_index: localResult,
      matches: matches.map(m => ({
        verification_id: m.id,
        date: m.upload_date,
        filename: m.original_filename,
        file_size: m.file_size
      }))
    };
    
  } catch (error) {
    console.error('❌ Search error:', error.message);
    return {
      found: false,
      is_first_verification: true,
      message: 'Search failed: ' + error.message
    };
  }
}

async function saveVerification(data) {
  try {
    // 1. Save to fingerprint index (SQLite - fast local)
    let fingerprintResult = null;
    try {
      fingerprintResult = fingerprintIndex.storeFingerprint({
        sha256: data.fingerprint,
        phash: data.phash || null,
        verificationId: null, // Will update after PG insert
        sourceType: 'submission',
        customerId: data.customer_id || null,
        claimContext: data.claim_context || null
      });
      
      if (fingerprintResult.isNew) {
        console.log('📇 New fingerprint indexed');
      } else {
        console.log(`📇 Fingerprint seen ${fingerprintResult.occurrences} times`);
      }
    } catch (err) {
      console.error('⚠️ Fingerprint index error:', err.message);
    }
// 2. Store Google Vision labels if provided (PostgreSQL)
    if (data.google_vision_labels && data.google_vision_labels.length > 0 && data.fingerprint) {
      try {
        const labelCount = await FingerprintCachePG.storeLabels(
          data.fingerprint,
          data.google_vision_labels.map(l => ({
            label: l.description || l.label || l,
            confidence: l.score || l.confidence || 0.5
          }))
        );
        console.log('🏷️ Cached ' + labelCount + ' labels');
      } catch (err) {
        console.error('⚠️ Label caching error:', err.message);
      }
    }

    // 3. Save to PostgreSQL (main database)
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for save');
      return fingerprintResult ? { fingerprint_id: fingerprintResult.id } : null;
    }
    
     const query = `
      INSERT INTO verifications (
        fingerprint, fingerprint_algorithm, original_filename,
        file_size, file_type, media_kind, ip_address,
        polygon_block_number, polygon_tx_hash, polygon_timestamp,
        base_block_number, base_tx_hash, base_timestamp,
        phash, phash_regions, account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, upload_date
    `;
    
    const values = [
      data.fingerprint,
      data.algorithm || 'sha256',
      data.filename,
      data.file_size,
      data.file_type,
      data.media_kind,
      data.ip_address || null,
      data.polygon_block_number || null,
      data.polygon_tx_hash || null,
      data.polygon_timestamp || null,
      data.base_block_number || null,
      data.base_tx_hash || null,
      data.base_timestamp || null,
      data.phash || null,
      data.phash_regions ? JSON.stringify(data.phash_regions) : null,
      data.account_id || null
    ];
    
    const result = await db.query(query, values);
    console.log('✅ Saved verification:', result.rows[0].id);
    
    return {
      verification_id: result.rows[0].id,
      upload_date: result.rows[0].upload_date,
      fingerprint_id: fingerprintResult?.id || null,
      fingerprint_occurrences: fingerprintResult?.occurrences || 1
    };
    
  } catch (error) {
    console.error('❌ Save error:', error.message);
    return null;
  }
}

async function getStats() {
  try {
    // Get fingerprint index stats
    let indexStats = {};
    try {
      indexStats = fingerprintIndex.getIndexStats();
    } catch (err) {
      console.error('⚠️ Index stats error:', err.message);
    }

    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for stats');
      return {
        message: 'Database being configured',
        total_verifications: 0,
        fingerprint_index: indexStats
      };
    }
    
    const query = `
      SELECT 
        COUNT(*) as total_verifications,
        COUNT(DISTINCT fingerprint) as unique_files,
        COUNT(*) - COUNT(DISTINCT fingerprint) as duplicates,
        MIN(upload_date) as first_verification,
        MAX(upload_date) as last_verification
      FROM verifications
    `;
    
    const result = await db.query(query);
    return {
      ...result.rows[0],
      fingerprint_index: indexStats
    };
    
  } catch (error) {
    console.error('❌ Stats error:', error.message);
    return {
      error: 'Database error',
      message: error.message
    };
  }
}

// New function: Find related content by label
async function findRelatedByLabel(label, minConfidence = 0.7) {
  try {
    return fingerprintIndex.findByLabel(label, minConfidence);
  } catch (error) {
    console.error('❌ Label search error:', error.message);
    return [];
  }
}

module.exports = {
  searchByFingerprint,
  saveVerification,
  getStats,
  findRelatedByLabel
};