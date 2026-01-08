/**
 * Fingerprint Database Service
 * 
 * Queries the media_hashes table (populated by crawlers) to find
 * prior appearances of images across Bluesky, Reddit, Wikimedia Commons, etc.
 * 
 * Integrates with provenance timeline to show complete image history.
 */

const { Pool } = require('pg');

// Use existing database connection or create new one
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class FingerprintDatabaseService {
  
  /**
   * Calculate Hamming distance between two hex hashes
   * @param {string} hash1 - First hex hash
   * @param {string} hash2 - Second hex hash
   * @returns {number} Hamming distance (number of differing bits)
   */
  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return Infinity;
    }
    
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

  /**
   * Search for exact SHA256 match
   * @param {string} sha256 - SHA256 hash to search
   * @returns {Array} Matching records
   */
  async findExactMatch(sha256) {
    const query = `
      SELECT 
        id, phash, sha256, source, source_id, source_url,
        author_handle, author_did, post_created_at, ingested_at
      FROM media_hashes
      WHERE sha256 = $1
      ORDER BY post_created_at ASC
      LIMIT 10
    `;
    
    try {
      const result = await pool.query(query, [sha256]);
      return result.rows;
    } catch (err) {
      console.error('Fingerprint exact match error:', err.message);
      return [];
    }
  }

  /**
   * Search for perceptual hash matches within threshold
   * Uses database-side bit comparison for efficiency
   * @param {string} phash - Perceptual hash to search
   * @param {number} threshold - Maximum Hamming distance (default 5)
   * @param {number} limit - Maximum results to return
   * @returns {Array} Matching records with distance
   */
  async findPerceptualMatches(phash, threshold = 5, limit = 20) {
    // For large databases, we do initial filtering in DB then refine in JS
    // This query gets candidates that might match (using prefix similarity)
    const query = `
      SELECT 
        id, phash, sha256, source, source_id, source_url,
        author_handle, author_did, post_created_at, ingested_at
      FROM media_hashes
      WHERE phash IS NOT NULL
      ORDER BY post_created_at ASC
      LIMIT 10000
    `;
    
    try {
      const result = await pool.query(query);
      
      // Calculate Hamming distance for each and filter
      const matches = result.rows
        .map(row => ({
          ...row,
          distance: this.hammingDistance(phash, row.phash)
        }))
        .filter(row => row.distance <= threshold)
        .sort((a, b) => {
          // Sort by distance first, then by date (oldest first)
          if (a.distance !== b.distance) return a.distance - b.distance;
          return new Date(a.post_created_at) - new Date(b.post_created_at);
        })
        .slice(0, limit);
      
      return matches;
    } catch (err) {
      console.error('Fingerprint perceptual match error:', err.message);
      return [];
    }
  }

  /**
   * Search for matches using both exact and perceptual matching
   * @param {string} sha256 - SHA256 hash
   * @param {string} phash - Perceptual hash
   * @param {number} threshold - pHash threshold
   * @returns {Object} Combined results
   */
  async findMatches(sha256, phash, threshold = 5) {
    const [exactMatches, perceptualMatches] = await Promise.all([
      sha256 ? this.findExactMatch(sha256) : [],
      phash ? this.findPerceptualMatches(phash, threshold) : []
    ]);

    // Deduplicate (prefer exact matches)
    const seenIds = new Set(exactMatches.map(m => m.id));
    const uniquePerceptual = perceptualMatches.filter(m => !seenIds.has(m.id));

    // Combine and sort by date
    const allMatches = [...exactMatches, ...uniquePerceptual]
      .sort((a, b) => new Date(a.post_created_at) - new Date(b.post_created_at));

    // Get earliest match
    const earliest = allMatches.length > 0 ? allMatches[0] : null;

    // Group by source
    const bySource = {};
    for (const match of allMatches) {
      if (!bySource[match.source]) {
        bySource[match.source] = [];
      }
      bySource[match.source].push(match);
    }

    return {
      total_matches: allMatches.length,
      exact_matches: exactMatches.length,
      perceptual_matches: uniquePerceptual.length,
      earliest: earliest,
      matches: allMatches,
      by_source: bySource
    };
  }

  /**
   * Format matches for provenance timeline
   * @param {Object} matchResults - Results from findMatches
   * @returns {Array} Timeline events
   */
  formatForTimeline(matchResults) {
    if (!matchResults || matchResults.total_matches === 0) {
      return [];
    }

    const events = [];
    const sourceIcons = {
      bluesky: '🦋',
      reddit: '🤖',
      wikimedia: '📚',
      mastodon: '🐘',
      default: '🌐'
    };

    const sourceLabels = {
      bluesky: 'Bluesky',
      reddit: 'Reddit',
      wikimedia: 'Wikimedia Commons',
      mastodon: 'Mastodon',
      default: 'Social Media'
    };

    for (const match of matchResults.matches) {
      const isEarliest = match.id === matchResults.earliest?.id;
      const icon = sourceIcons[match.source] || sourceIcons.default;
      const label = sourceLabels[match.source] || sourceLabels.default;

      let details = '';
      if (match.author_handle) {
        if (match.source === 'reddit') {
          details = `u/${match.author_handle}`;
        } else if (match.source === 'bluesky') {
          details = `@${match.author_handle}`;
        } else if (match.source === 'wikimedia') {
          details = match.author_handle; // Author name
          if (match.author_did) { // License stored in author_did for wikimedia
            details += ` • ${match.author_did}`;
          }
        } else {
          details = match.author_handle;
        }
      }

      if (match.distance !== undefined && match.distance > 0) {
        details += details ? ` • ${100 - match.distance * 2}% similar` : `${100 - match.distance * 2}% similar`;
      }

      events.push({
        type: 'FINGERPRINT_MATCH',
        timestamp: match.post_created_at,
        icon: icon,
        label: isEarliest ? `First Seen: ${label}` : `Found on ${label}`,
        source: label,
        source_platform: match.source,
        details: details || null,
        url: match.source_url,
        is_earliest: isEarliest,
        match_type: match.distance === 0 || match.distance === undefined ? 'exact' : 'perceptual',
        relevance: match.distance !== undefined ? 1 - (match.distance / 64) : 1
      });
    }

    return events;
  }

  /**
   * Get summary statistics for fingerprint matches
   * @param {Object} matchResults - Results from findMatches
   * @returns {Object} Summary stats
   */
  getSummary(matchResults) {
    if (!matchResults || matchResults.total_matches === 0) {
      return {
        found: false,
        message: 'No prior appearances found in VeriSource database'
      };
    }

    const earliest = matchResults.earliest;
    const sourceCounts = {};
    for (const source in matchResults.by_source) {
      sourceCounts[source] = matchResults.by_source[source].length;
    }

    // Calculate age
    const earliestDate = new Date(earliest.post_created_at);
    const now = new Date();
    const daysDiff = Math.floor((now - earliestDate) / (1000 * 60 * 60 * 24));
    
    let ageLabel;
    if (daysDiff === 0) {
      ageLabel = 'today';
    } else if (daysDiff === 1) {
      ageLabel = 'yesterday';
    } else if (daysDiff < 30) {
      ageLabel = `${daysDiff} days ago`;
    } else if (daysDiff < 365) {
      ageLabel = `${Math.floor(daysDiff / 30)} months ago`;
    } else {
      ageLabel = `${Math.floor(daysDiff / 365)} years ago`;
    }

    const sourceLabels = {
      bluesky: 'Bluesky',
      reddit: 'Reddit',
      wikimedia: 'Wikimedia Commons',
      mastodon: 'Mastodon'
    };

    return {
      found: true,
      total_appearances: matchResults.total_matches,
      earliest_date: earliest.post_created_at,
      earliest_source: sourceLabels[earliest.source] || earliest.source,
      earliest_url: earliest.source_url,
      age_label: ageLabel,
      source_counts: sourceCounts,
      message: `First appeared on ${sourceLabels[earliest.source] || earliest.source} ${ageLabel}`
    };
  }

  /**
   * Full search with timeline events and summary
   * Main entry point for verification integration
   * @param {string} sha256 - SHA256 hash
   * @param {string} phash - Perceptual hash
   * @returns {Object} Complete search results
   */
  async search(sha256, phash) {
    const matches = await this.findMatches(sha256, phash);
    const timelineEvents = this.formatForTimeline(matches);
    const summary = this.getSummary(matches);

    return {
      ...matches,
      timeline_events: timelineEvents,
      summary: summary
    };
  }

  /**
   * Get database statistics
   * @returns {Object} Stats about the fingerprint database
   */
  async getStats() {
    const query = `
      SELECT 
        source,
        COUNT(*) as count,
        MIN(post_created_at) as earliest,
        MAX(post_created_at) as latest
      FROM media_hashes
      GROUP BY source
      ORDER BY count DESC
    `;

    try {
      const result = await pool.query(query);
      
      const totalQuery = await pool.query('SELECT COUNT(*) as total FROM media_hashes');
      const total = parseInt(totalQuery.rows[0].total);

      return {
        total_fingerprints: total,
        by_source: result.rows.map(row => ({
          source: row.source,
          count: parseInt(row.count),
          earliest: row.earliest,
          latest: row.latest
        }))
      };
    } catch (err) {
      console.error('Fingerprint stats error:', err.message);
      return { total_fingerprints: 0, by_source: [] };
    }
  }
}

module.exports = new FingerprintDatabaseService();