/**
 * Fingerprint Cache Service (PostgreSQL)
 * 
 * Replaces SQLite fingerprint-index.js with PostgreSQL storage.
 * Uses SHA256 fingerprint directly as the key (no separate ID).
 */

const db = require('../db-minimal');

// ============================================
// External Search Cache
// ============================================

/**
 * Cache external search results (TinEye, Bing, Google)
 */
async function cacheExternalSearch(fingerprint, service, results) {
  if (!db.isAvailable() || !results) return null;
  
  try {
    let totalMatches = 0;
    let matchUrls = [];
    
    if (service === 'tineye' && results.top_matches) {
      totalMatches = results.total_results || 0;
      matchUrls = results.top_matches.slice(0, 50).map(m => ({
        url: m.url,
        domain: m.domain,
        crawl_date: m.crawl_date
      }));
    } else if (service === 'google' && results.image_results) {
      totalMatches = results.total_results || 0;
      matchUrls = results.image_results.slice(0, 50).map(r => ({
        url: r.link,
        domain: r.domain,
        title: r.title
      }));
    } else if (service === 'bing' && results.similar_images) {
      totalMatches = results.total_results || 0;
      matchUrls = results.similar_images.slice(0, 50).map(r => ({
        url: r.url,
        domain: r.domain,
        title: r.title
      }));
    }
    
    // Upsert into PostgreSQL
    await db.query(`
      INSERT INTO external_search_cache (fingerprint, service, total_matches, match_urls, raw_response, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
      ON CONFLICT (fingerprint, service) 
      DO UPDATE SET 
        total_matches = EXCLUDED.total_matches,
        match_urls = EXCLUDED.match_urls,
        raw_response = EXCLUDED.raw_response,
        queried_at = NOW(),
        expires_at = NOW() + INTERVAL '7 days'
    `, [fingerprint, service, totalMatches, JSON.stringify(matchUrls), JSON.stringify(results)]);
    
    // Also store individual matches for domain analysis
    await storeExternalMatches(fingerprint, service, matchUrls);
    
    return { cached: true, total_matches: totalMatches };
  } catch (err) {
    console.error('cacheExternalSearch error:', err.message);
    return null;
  }
}

/**
 * Get cached external search results by fingerprint
 */
async function getCachedExternalSearch(fingerprint) {
  if (!db.isAvailable()) return null;
  
  try {
    const result = await db.query(`
      SELECT service, total_matches, match_urls, queried_at
      FROM external_search_cache
      WHERE fingerprint = $1 AND expires_at > NOW()
    `, [fingerprint]);
    
    if (result.rows.length === 0) return null;
    
    const cached = {};
    for (const row of result.rows) {
      cached[row.service] = {
        cached: true,
        from_cache: true,
        total_matches: row.total_matches,
        match_urls: row.match_urls || [],
        queried_at: row.queried_at
      };
    }
    
    return cached;
  } catch (err) {
    console.error('getCachedExternalSearch error:', err.message);
    return null;
  }
}

/**
 * Store individual external matches for domain analysis
 */
async function storeExternalMatches(fingerprint, service, matches) {
  if (!db.isAvailable() || !matches || matches.length === 0) return;
  
  const domainTypes = {
    news_wire: ['reuters.com', 'apnews.com', 'afp.com', 'gettyimages.com'],
    news_major: ['bbc.com', 'cnn.com', 'nytimes.com', 'theguardian.com', 'washingtonpost.com'],
    stock_photo: ['shutterstock.com', 'istockphoto.com', 'stock.adobe.com', 'depositphotos.com', 'alamy.com'],
    social: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'reddit.com', 'pinterest.com'],
    fact_check: ['snopes.com', 'politifact.com', 'factcheck.org', 'fullfact.org'],
    ai_generated: ['midjourney.com', 'openai.com', 'stability.ai']
  };
  
  const getDomainType = (domain) => {
    if (!domain) return 'other';
    for (const [type, domains] of Object.entries(domainTypes)) {
      if (domains.some(d => domain.includes(d))) return type;
    }
    return 'other';
  };
  
  try {
    for (const match of matches) {
      if (!match.url) continue;
      const domainType = getDomainType(match.domain);
      
      await db.query(`
        INSERT INTO external_matches (fingerprint, service, match_url, match_domain, match_title, match_date, domain_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (fingerprint, service, match_url) DO NOTHING
      `, [fingerprint, service, match.url, match.domain || null, match.title || null, match.crawl_date || null, domainType]);
    }
  } catch (err) {
    console.error('storeExternalMatches error:', err.message);
  }
}

/**
 * Analyze external sources for a fingerprint
 */
async function analyzeExternalSources(fingerprint) {
  if (!db.isAvailable()) return null;
  
  try {
    const result = await db.query(`
      SELECT domain_type, COUNT(*) as count, 
             array_agg(DISTINCT match_domain) as domains
      FROM external_matches
      WHERE fingerprint = $1
      GROUP BY domain_type
    `, [fingerprint]);
    
    const analysis = {
      total_external_matches: 0,
      appeared_on_news_wire: false,
      appeared_on_stock_sites: false,
      appeared_on_fact_check_sites: false,
      appeared_on_social: false,
      news_sources: [],
      stock_sources: [],
      fact_check_sources: [],
      credibility_indicator: 'unknown'
    };
    
    for (const row of result.rows) {
      analysis.total_external_matches += parseInt(row.count);
      
      if (row.domain_type === 'news_wire' || row.domain_type === 'news_major') {
        analysis.appeared_on_news_wire = true;
        analysis.news_sources = row.domains;
      } else if (row.domain_type === 'stock_photo') {
        analysis.appeared_on_stock_sites = true;
        analysis.stock_sources = row.domains;
      } else if (row.domain_type === 'fact_check') {
        analysis.appeared_on_fact_check_sites = true;
        analysis.fact_check_sources = row.domains;
      } else if (row.domain_type === 'social') {
        analysis.appeared_on_social = true;
      }
    }
    
    // Set credibility indicator
    if (analysis.appeared_on_fact_check_sites) {
      analysis.credibility_indicator = 'fact_checked';
    } else if (analysis.appeared_on_news_wire) {
      analysis.credibility_indicator = 'news_verified';
    } else if (analysis.appeared_on_stock_sites) {
      analysis.credibility_indicator = 'stock_photo';
    } else if (analysis.total_external_matches > 0) {
      analysis.credibility_indicator = 'found_online';
    }
    
    return analysis;
  } catch (err) {
    console.error('analyzeExternalSources error:', err.message);
    return null;
  }
}

// ============================================
// Content Labels (Google Vision)
// ============================================

/**
 * Store labels from Google Vision
 */
async function storeLabels(fingerprint, labels, source = 'google_vision') {
  if (!db.isAvailable() || !labels || labels.length === 0) return 0;
  
  try {
    let stored = 0;
    for (const item of labels) {
      const label = item.description || item.label || item;
      const confidence = item.score || item.confidence || 0.5;
      
      await db.query(`
        INSERT INTO content_labels (fingerprint, label, confidence, source)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (fingerprint, label, source) DO NOTHING
      `, [fingerprint, label, confidence, source]);
      stored++;
    }
    return stored;
  } catch (err) {
    console.error('storeLabels error:', err.message);
    return 0;
  }
}

/**
 * Get labels for a fingerprint
 */
async function getLabels(fingerprint) {
  if (!db.isAvailable()) return [];
  
  try {
    const result = await db.query(`
      SELECT label, confidence, source
      FROM content_labels
      WHERE fingerprint = $1
      ORDER BY confidence DESC
    `, [fingerprint]);
    
    return result.rows;
  } catch (err) {
    console.error('getLabels error:', err.message);
    return [];
  }
}

/**
 * Find fingerprints by label
 */
async function findByLabel(label, minConfidence = 0.7, limit = 50) {
  if (!db.isAvailable()) return [];
  
  try {
    const result = await db.query(`
      SELECT DISTINCT fingerprint, label, confidence
      FROM content_labels
      WHERE label ILIKE $1 AND confidence >= $2
      ORDER BY confidence DESC
      LIMIT $3
    `, [`%${label}%`, minConfidence, limit]);
    
    return result.rows;
  } catch (err) {
    console.error('findByLabel error:', err.message);
    return [];
  }
}

// ============================================
// Cross-Reference Analysis
// ============================================

/**
 * Analyze cross-references for fraud detection (privacy-safe)
 */
async function analyzeCrossReference(fingerprint, currentAccountId = null) {
  if (!db.isAvailable()) return null;
  
  try {
    // Get verification stats
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as times_verified,
        COUNT(DISTINCT account_id) as unique_accounts,
        MIN(upload_date) as first_seen,
        MAX(upload_date) as last_seen
      FROM verifications
      WHERE fingerprint = $1
    `, [fingerprint]);
    
    const stats = statsResult.rows[0];
    const timesVerified = parseInt(stats.times_verified);
    const uniqueAccounts = parseInt(stats.unique_accounts);
    
    const result = {
      times_verified: timesVerified,
      unique_submitters: uniqueAccounts,
      first_seen: stats.first_seen,
      last_seen: stats.last_seen,
      risk_level: 'low',
      flags: []
    };
    
    // Flag if multiple users submitted same content
    if (uniqueAccounts > 1) {
      result.flags.push({
        type: 'MULTI_USER',
        message: `Submitted by ${uniqueAccounts} different users`,
        severity: 'warning'
      });
      result.risk_level = 'medium';
    }
    
    // Flag high submission count
    if (timesVerified > 10) {
      result.flags.push({
        type: 'HIGH_VOLUME',
        message: `Verified ${timesVerified} times`,
        severity: 'info'
      });
    }
    
    return result;
  } catch (err) {
    console.error('analyzeCrossReference error:', err.message);
    return null;
  }
}

// ============================================
// Stats
// ============================================

async function getStats() {
  if (!db.isAvailable()) return null;
  
  try {
    const [verifications, labels, cache] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM verifications'),
      db.query('SELECT COUNT(*) as count, COUNT(DISTINCT label) as unique_labels FROM content_labels'),
      db.query('SELECT COUNT(*) as count FROM external_search_cache')
    ]);
    
    return {
      total_verifications: parseInt(verifications.rows[0].count),
      total_labels: parseInt(labels.rows[0].count),
      unique_labels: parseInt(labels.rows[0].unique_labels),
      cached_searches: parseInt(cache.rows[0].count)
    };
  } catch (err) {
    console.error('getStats error:', err.message);
    return null;
  }
}

module.exports = {
  // External search cache
  cacheExternalSearch,
  getCachedExternalSearch,
  storeExternalMatches,
  analyzeExternalSources,
  
  // Content labels
  storeLabels,
  getLabels,
  findByLabel,
  
  // Cross-reference
  analyzeCrossReference,
  
  // Stats
  getStats
};
