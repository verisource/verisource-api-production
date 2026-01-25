/**
 * Privacy-Safe Search Service
 * 
 * Wraps internal fingerprint matching with privacy safeguards.
 * Never exposes other users' identifiable information.
 */

const fingerprintIndex = require('./fingerprint-index');
const FingerprintDBService = require('./fingerprint-db-service');
const db = require('../db-minimal');

/**
 * Privacy-safe internal search
 * Returns match information without exposing other users' data
 * 
 * @param {string} sha256 - File hash
 * @param {string} phash - Perceptual hash
 * @param {string} currentAccountId - Current user's account ID
 * @param {Array} labels - Google Vision labels (optional)
 * @returns {Object} Privacy-filtered search results
 */
async function searchInternal(sha256, phash, currentAccountId = null, labels = []) {
  const result = {
    // Summary flags
    found_in_database: false,
    is_first_submission: true,
    
    // Exact matches (privacy-safe)
    exact_match: null,
    
    // Similar content (privacy-safe)
    similar_content: {
      found: false,
      count: 0,
      matches: []
    },
    
    // Your own prior submissions (full details OK)
    your_prior_submissions: [],
    
    // Crawled sources (Bluesky, Reddit, etc. - public data)
    crawled_sources: null,
    
    // Fraud indicators (anonymized)
    fraud_indicators: {
      risk_level: 'low',
      flags: [],
      recommendation: null
    },
    
    // Stats
    index_stats: {
      total_indexed: 0,
      is_new_to_index: true
    }
  };

  try {
    // 1. Check local fingerprint index (SQLite)
    const localCheck = fingerprintIndex.checkLocalIndex(sha256, phash);
    
    if (localCheck.exactMatch) {
      result.found_in_database = true;
      result.is_first_submission = false;
      result.index_stats.is_new_to_index = false;
      
      const match = localCheck.exactMatch;
      const isOwn = currentAccountId && match.customer_id === currentAccountId;
      
      result.exact_match = {
        first_verified: match.first_seen,
        times_verified: match.occurrence_count || 1,
        source_type: match.source_type,
        is_yours: isOwn,
        labels: match.labels || [],
        // Only include identifiable details if it's their own
        ...(isOwn && {
          fingerprint_id: match.id,
          source_url: match.source_url
        })
      };
      
      // Fraud flags (anonymized)
      if (match.occurrence_count > 1) {
        result.fraud_indicators.flags.push({
          type: 'DUPLICATE',
          message: `This content has been verified ${match.occurrence_count} times`,
          first_seen: match.first_seen,
          severity: 'info'
        });
      }
      
      // Cross-customer flag (don't expose WHO)
      if (currentAccountId && match.customer_id && match.customer_id !== currentAccountId) {
        result.fraud_indicators.flags.push({
          type: 'CROSS_USER',
          message: 'This content was previously submitted by a different user',
          first_seen: match.first_seen,
          severity: 'warning'
        });
        result.fraud_indicators.risk_level = 'medium';
      }
      
      // Stock photo flag
      if (match.source_type === 'seed' || match.source_type === 'stock') {
        result.fraud_indicators.flags.push({
          type: 'STOCK_PHOTO',
          message: 'This image matches a known stock photo',
          severity: 'high'
        });
        result.fraud_indicators.risk_level = 'high';
      }
    }
    
    // 2. Check pHash similar content
    if (localCheck.similarMatches && localCheck.similarMatches.length > 0) {
      result.similar_content.found = true;
      result.similar_content.count = localCheck.similarMatches.length;
      
      result.similar_content.matches = localCheck.similarMatches.map(match => {
        const isOwn = currentAccountId && match.customer_id === currentAccountId;
        return {
          first_verified: match.first_seen,
          source_type: match.source_type,
          is_yours: isOwn,
          similarity_type: 'perceptual',
          // Only show details if it's theirs
          ...(isOwn && {
            fingerprint_id: match.id
          })
        };
      });
      
      // Check if any similar content is from different users
      const otherUserMatches = localCheck.similarMatches.filter(
        m => currentAccountId && m.customer_id && m.customer_id !== currentAccountId
      );
      
      if (otherUserMatches.length > 0) {
        result.fraud_indicators.flags.push({
          type: 'SIMILAR_CONTENT_OTHER_USER',
          message: `${otherUserMatches.length} visually similar image(s) found from other users`,
          severity: 'warning'
        });
        if (result.fraud_indicators.risk_level === 'low') {
          result.fraud_indicators.risk_level = 'medium';
        }
      }
    }
    
    // 3. Get user's own prior submissions (full details OK)
    if (currentAccountId && db.isAvailable()) {
      try {
        const priorQuery = await db.query(`
          SELECT id, fingerprint, original_filename, file_size, upload_date,
                 polygon_tx_hash, polygon_block_number,
                 base_tx_hash, base_block_number
          FROM verifications
          WHERE fingerprint = $1 AND account_id = $2
          ORDER BY upload_date DESC
          LIMIT 10
        `, [sha256, currentAccountId]);
        
        if (priorQuery.rows.length > 0) {
          result.your_prior_submissions = priorQuery.rows.map(row => ({
            verification_id: row.id,
            filename: row.original_filename,
            file_size: row.file_size,
            date: row.upload_date,
            blockchain: {
              polygon: row.polygon_tx_hash ? {
                tx_hash: row.polygon_tx_hash,
                block: row.polygon_block_number
              } : null,
              base: row.base_tx_hash ? {
                tx_hash: row.base_tx_hash,
                block: row.base_block_number
              } : null
            }
          }));
        }
      } catch (err) {
        console.error('Prior submissions query error:', err.message);
      }
    }
    
    // 4. Check crawled sources (public data - OK to show)
    try {
      const crawledResults = await FingerprintDBService.search(sha256, phash);
      if (crawledResults && crawledResults.total_matches > 0) {
        result.found_in_database = true;
        result.crawled_sources = {
          total_matches: crawledResults.total_matches,
          platforms_found: Object.keys(crawledResults.by_source || {}).length,
          summary: crawledResults.summary,
          timeline_events: crawledResults.timeline_events,
          earliest: crawledResults.earliest ? {
            platform: crawledResults.earliest.source,
            date: crawledResults.earliest.post_created_at,
            url: crawledResults.earliest.source_url,
            author: crawledResults.earliest.author_handle // Public social media handle
          } : null
        };
      }
    } catch (err) {
      console.error('Crawled sources search error:', err.message);
    }
    
    // 5. Get index stats
    try {
      const stats = fingerprintIndex.getIndexStats();
      result.index_stats.total_indexed = stats.totalFingerprints || 0;
    } catch (err) {
      // Non-critical
    }
    
    // 6. Set recommendation based on risk level
    if (result.fraud_indicators.risk_level === 'high') {
      result.fraud_indicators.recommendation = 'Review recommended - potential stock photo or manipulated content';
    } else if (result.fraud_indicators.risk_level === 'medium') {
      result.fraud_indicators.recommendation = 'Content has been seen before - verify authenticity';
    } else if (result.found_in_database && !result.is_first_submission) {
      result.fraud_indicators.recommendation = 'Previously verified content';
    }
    
  } catch (err) {
    console.error('Privacy-safe search error:', err.message);
    result.fraud_indicators.flags.push({
      type: 'SEARCH_ERROR',
      message: 'Internal search encountered an error',
      severity: 'info'
    });
  }
  
  return result;
}

/**
 * Determine if external search is needed based on internal results
 * 
 * @param {Object} internalResults - Results from searchInternal
 * @returns {Object} Recommendation on external search
 */
function shouldSearchExternal(internalResults) {
  // Skip external if we have definitive internal results
  if (internalResults.exact_match && internalResults.exact_match.times_verified >= 3) {
    return {
      recommended: false,
      reason: 'Sufficient internal verification history',
      skip_tineye: true,
      skip_google: true
    };
  }
  
  // Skip external if found in crawled sources with high confidence
  if (internalResults.crawled_sources && internalResults.crawled_sources.total_matches >= 5) {
    return {
      recommended: false,
      reason: 'Found in crawled social media sources',
      skip_tineye: true,
      skip_google: false // Still might want Google Vision labels
    };
  }
  
  // Skip TinEye if stock photo already detected
  if (internalResults.fraud_indicators.flags.some(f => f.type === 'STOCK_PHOTO')) {
    return {
      recommended: true,
      reason: 'Stock photo detected - verify source',
      skip_tineye: true, // We already know it's stock
      skip_google: false
    };
  }
  
  // Default: search external
  return {
    recommended: true,
    reason: 'No definitive internal matches',
    skip_tineye: false,
    skip_google: false
  };
}

module.exports = {
  searchInternal,
  shouldSearchExternal
};
