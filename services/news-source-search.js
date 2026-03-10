/**
 * VeriSource News Source Search Service
 * 
 * Searches the news_images crawler database for matching images.
 * Returns verified news source attribution when images match.
 * 
 * This enables:
 * - "This image matches a Reuters photo from Jan 15, 2026"
 * - Propagation chain tracking across news outlets
 * - Original publication date verification
 */

const db = require('../db-minimal');

// Hamming distance threshold for perceptual hash matching
// Lower = stricter matching, Higher = more fuzzy
const PHASH_HAMMING_THRESHOLD = 15; // bits different (out of 256)
const DHASH_HAMMING_THRESHOLD = 8;  // bits different (out of 64)

/**
 * Search the news crawler database for matching images
 * @param {Object} options - Search options
 * @param {string} options.phash - Perceptual hash of uploaded image
 * @param {string} options.dhash - Difference hash of uploaded image  
 * @param {string} options.md5 - MD5 hash of uploaded image
 * @returns {Object} Search results with news source attribution
 */
async function searchNewsDatabase({ phash, dhash, md5 }) {
  const results = {
    found: false,
    match_type: null,
    matches: [],
    earliest_publication: null,
    sources: [],
    propagation_chain: [],
    total_news_matches: 0
  };

  if (!phash && !dhash && !md5) {
    return results;
  }

  try {
    // 1. Exact MD5 match (identical image, byte-for-byte)
    if (md5) {
      const exactMatch = await db.query(`
        SELECT 
          source, 
          source_name, 
          article_url, 
          article_title, 
          image_url, 
          published_at, 
          crawled_at
        FROM news_images_v1
        WHERE md5 = $1
        ORDER BY published_at ASC NULLS LAST
        LIMIT 20
      `, [md5]);

      if (exactMatch.rows.length > 0) {
        results.found = true;
        results.match_type = 'exact';
        results.matches = exactMatch.rows;
        results.earliest_publication = exactMatch.rows[0].published_at;
        results.sources = [...new Set(exactMatch.rows.map(r => r.source_name))];
        results.total_news_matches = exactMatch.rows.length;
        results.propagation_chain = buildPropagationChain(exactMatch.rows);
        
        console.log(`📰 Exact MD5 match found: ${exactMatch.rows.length} news sources`);
        return results;
      }
    }

    // 2. Perceptual hash match (resized/compressed/cropped versions)
    if (phash && phash.length >= 32) {
      const phashMatch = await searchByPerceptualHash(phash, PHASH_HAMMING_THRESHOLD);
      
      if (phashMatch.length > 0) {
        results.found = true;
        results.match_type = 'perceptual';
        results.matches = phashMatch;
        results.earliest_publication = phashMatch[0].published_at;
        results.sources = [...new Set(phashMatch.map(r => r.source_name))];
        results.total_news_matches = phashMatch.length;
        results.propagation_chain = buildPropagationChain(phashMatch);
        
        console.log(`📰 Perceptual hash match found: ${phashMatch.length} news sources (distance: ${phashMatch[0].hamming_distance})`);
        return results;
      }
    }

    // 3. dHash match as fallback (faster, less accurate)
    if (dhash && dhash.length >= 16) {
      const dhashMatch = await searchByDHash(dhash, DHASH_HAMMING_THRESHOLD);
      
      if (dhashMatch.length > 0) {
        results.found = true;
        results.match_type = 'dhash';
        results.matches = dhashMatch;
        results.earliest_publication = dhashMatch[0].published_at;
        results.sources = [...new Set(dhashMatch.map(r => r.source_name))];
        results.total_news_matches = dhashMatch.length;
        results.propagation_chain = buildPropagationChain(dhashMatch);
        
        console.log(`📰 dHash match found: ${dhashMatch.length} news sources`);
        return results;
      }
    }

    return results;

  } catch (error) {
    console.error('📰 News database search error:', error.message);
    results.error = error.message;
    return results;
  }
}

/**
 * Search by perceptual hash using Hamming distance
 * Uses bit_count for PostgreSQL hamming distance calculation
 */
async function searchByPerceptualHash(phash, threshold) {
  try {
    // Convert hex pHash to bit string for comparison
    // PostgreSQL doesn't have native hamming distance, so we use a workaround
    
    // First, try exact match (fastest)
    const exactResult = await db.query(`
      SELECT 
        source, source_name, article_url, article_title,
        image_url, published_at, crawled_at, phash,
        0 as hamming_distance
      FROM news_images_v1
      WHERE phash = $1
      ORDER BY published_at ASC NULLS LAST
      LIMIT 20
    `, [phash]);
    
    if (exactResult.rows.length > 0) {
      return exactResult.rows;
    }
    
    // For fuzzy matching, we need to compare hashes
    // This is more expensive but necessary for crop/resize detection
    // Limit to recent images (last 30 days) for performance
    const fuzzyResult = await db.query(`
      SELECT 
        source, source_name, article_url, article_title,
        image_url, published_at, crawled_at, phash
      FROM news_images_v1
      WHERE phash IS NOT NULL
        AND LENGTH(phash) = LENGTH($1)
        AND crawled_at > NOW() - INTERVAL '30 days'
      ORDER BY published_at ASC NULLS LAST
      LIMIT 5000
    `, [phash]);
    
    // Calculate hamming distance in JavaScript
    const matches = fuzzyResult.rows
      .map(row => ({
        ...row,
        hamming_distance: calculateHammingDistance(phash, row.phash)
      }))
      .filter(row => row.hamming_distance <= threshold)
      .sort((a, b) => a.hamming_distance - b.hamming_distance)
      .slice(0, 20);
    
    return matches;
    
  } catch (error) {
    console.error('pHash search error:', error.message);
    return [];
  }
}

/**
 * Search by difference hash
 */
async function searchByDHash(dhash, threshold) {
  try {
    // Exact match first
    const exactResult = await db.query(`
      SELECT 
        source, source_name, article_url, article_title,
        image_url, published_at, crawled_at, dhash,
        0 as hamming_distance
      FROM news_images_v1
      WHERE dhash = $1
      ORDER BY published_at ASC NULLS LAST
      LIMIT 20
    `, [dhash]);
    
    if (exactResult.rows.length > 0) {
      return exactResult.rows;
    }
    
    // Fuzzy match for dHash (smaller hash, faster comparison)
    const fuzzyResult = await db.query(`
      SELECT 
        source, source_name, article_url, article_title,
        image_url, published_at, crawled_at, dhash
      FROM news_images_v1
      WHERE dhash IS NOT NULL
        AND LENGTH(dhash) = LENGTH($1)
        AND crawled_at > NOW() - INTERVAL '30 days'
      LIMIT 5000
    `, [dhash]);
    
    const matches = fuzzyResult.rows
      .map(row => ({
        ...row,
        hamming_distance: calculateHammingDistance(dhash, row.dhash)
      }))
      .filter(row => row.hamming_distance <= threshold)
      .sort((a, b) => a.hamming_distance - b.hamming_distance)
      .slice(0, 20);
    
    return matches;
    
  } catch (error) {
    console.error('dHash search error:', error.message);
    return [];
  }
}

/**
 * Calculate Hamming distance between two hex hash strings
 */
function calculateHammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Infinity;
  }
  
  let distance = 0;
  
  for (let i = 0; i < hash1.length; i++) {
    const byte1 = parseInt(hash1[i], 16);
    const byte2 = parseInt(hash2[i], 16);
    
    if (isNaN(byte1) || isNaN(byte2)) continue;
    
    // XOR and count bits
    let xor = byte1 ^ byte2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  
  return distance;
}

/**
 * Build a propagation chain showing when image appeared at each source
 */
function buildPropagationChain(matches) {
  if (!matches || matches.length === 0) return [];
  
  // Sort by publication date
  const sorted = [...matches]
    .filter(m => m.published_at)
    .sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  
  // Group by source (keep earliest per source)
  const bySource = new Map();
  for (const match of sorted) {
    if (!bySource.has(match.source)) {
      bySource.set(match.source, match);
    }
  }
  
  // Build chain
  return Array.from(bySource.values()).map(m => ({
    source: m.source_name,
    source_slug: m.source,
    date: m.published_at,
    article_title: m.article_title,
    article_url: m.article_url
  }));
}

/**
 * Format news source results for API response
 */
function formatNewsSourceResponse(results) {
  if (!results.found) {
    return {
      found: false,
      message: 'Image not found in news database'
    };
  }
  
  const primary = results.matches[0];
  
  return {
    found: true,
    match_type: results.match_type,
    verified_attribution: {
      source: primary.source_name,
      source_slug: primary.source,
      article_title: primary.article_title,
      article_url: primary.article_url,
      image_url: primary.image_url,
      published_at: primary.published_at,
      match_confidence: results.match_type === 'exact' ? 100 : 
                        results.match_type === 'perceptual' ? 95 - (primary.hamming_distance || 0) :
                        85
    },
    propagation_chain: results.propagation_chain,
    total_news_matches: results.total_news_matches,
    sources_found: results.sources,
    earliest_publication: results.earliest_publication
  };
}

/**
 * Get news database statistics
 */
async function getNewsStats() {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_images,
        COUNT(DISTINCT source) as total_sources,
        COUNT(phash) as with_phash,
        MIN(published_at) as oldest_image,
        MAX(published_at) as newest_image,
        MAX(crawled_at) as last_crawl
      FROM news_images_v1
    `);
    
    const bySource = await db.query(`
      SELECT source_name, COUNT(*) as count
      FROM news_images_v1
      GROUP BY source_name
      ORDER BY count DESC
      LIMIT 20
    `);
    
    return {
      ...stats.rows[0],
      top_sources: bySource.rows
    };
  } catch (error) {
    console.error('News stats error:', error.message);
    return { error: error.message };
  }
}

module.exports = {
  searchNewsDatabase,
  formatNewsSourceResponse,
  getNewsStats,
  calculateHammingDistance
};