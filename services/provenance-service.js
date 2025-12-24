/**
 * Provenance Service v2
 * Tracks content lineage, derivatives, and timeline
 * Now with multi-region pHash for crop-resistant matching
 */

const db = require('../db-minimal');
const sharp = require('sharp');

class ProvenanceService {
  
  // ============================================================================
  // MULTI-REGION PHASH GENERATION
  // ============================================================================
  
  /**
   * Region definitions for multi-region pHash (18 regions)
   * Each region is a function that takes (width, height) and returns crop bounds
   * Designed to catch common crop patterns: social media, aspect ratio changes, etc.
   */
  getRegionDefinitions() {
    return {
      // Full image
      full: null,
      
      // Center crops at different sizes
      center50: (w, h) => ({ left: w * 0.25, top: h * 0.25, width: w * 0.5, height: h * 0.5 }),
      center60: (w, h) => ({ left: w * 0.20, top: h * 0.20, width: w * 0.6, height: h * 0.6 }),
      center70: (w, h) => ({ left: w * 0.15, top: h * 0.15, width: w * 0.7, height: h * 0.7 }),
      center80: (w, h) => ({ left: w * 0.10, top: h * 0.10, width: w * 0.8, height: h * 0.8 }),
      
      // Quadrants
      topLeft: (w, h) => ({ left: 0, top: 0, width: w * 0.5, height: h * 0.5 }),
      topRight: (w, h) => ({ left: w * 0.5, top: 0, width: w * 0.5, height: h * 0.5 }),
      bottomLeft: (w, h) => ({ left: 0, top: h * 0.5, width: w * 0.5, height: h * 0.5 }),
      bottomRight: (w, h) => ({ left: w * 0.5, top: h * 0.5, width: w * 0.5, height: h * 0.5 }),
      
      // Halves
      topHalf: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.5 }),
      bottomHalf: (w, h) => ({ left: 0, top: h * 0.5, width: w, height: h * 0.5 }),
      leftHalf: (w, h) => ({ left: 0, top: 0, width: w * 0.5, height: h }),
      rightHalf: (w, h) => ({ left: w * 0.5, top: 0, width: w * 0.5, height: h }),
      
      // Thirds (for social media crops)
      topThird: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.33 }),
      middleThird: (w, h) => ({ left: 0, top: h * 0.33, width: w, height: h * 0.34 }),
      bottomThird: (w, h) => ({ left: 0, top: h * 0.66, width: w, height: h * 0.34 }),
      
      // 2/3 crops (common aspect ratio adjustments)
      top2Thirds: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.66 }),
      bottom2Thirds: (w, h) => ({ left: 0, top: h * 0.34, width: w, height: h * 0.66 })
    };
  }

  /**
   * Generate pHash for a single region of an image
   * @param {Buffer|string} input - Image buffer or file path
   * @param {Function|null} regionFn - Region function or null for full image
   * @returns {string} Hex pHash string
   */
  async generateRegionPHash(input, regionFn = null) {
    try {
      let image = sharp(input);
      
      if (regionFn) {
        const meta = await sharp(input).metadata();
        const bounds = regionFn(meta.width, meta.height);
        image = image.extract({
          left: Math.floor(bounds.left),
          top: Math.floor(bounds.top),
          width: Math.floor(bounds.width),
          height: Math.floor(bounds.height)
        });
      }
      
      // Resize to 32x32 grayscale for pHash
      const { data } = await sharp(await image.toBuffer())
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Calculate average pixel value
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      const avg = sum / data.length;
      
      // Generate binary hash based on above/below average
      let binaryHash = '';
      for (let i = 0; i < data.length; i++) {
        binaryHash += data[i] > avg ? '1' : '0';
      }
      
      // Convert to hex
      let hexHash = '';
      for (let i = 0; i < binaryHash.length; i += 4) {
        hexHash += parseInt(binaryHash.substr(i, 4), 2).toString(16);
      }
      
      return hexHash;
    } catch (err) {
      console.error(`⚠️ Error generating region pHash: ${err.message}`);
      return null;
    }
  }

  /**
   * Generate all 9 region pHashes for an image
   * @param {Buffer|string} input - Image buffer or file path
   * @returns {Object} Object with region names as keys and pHashes as values
   */
  async generateAllRegionHashes(input) {
    const regions = this.getRegionDefinitions();
    const hashes = {};
    
    console.log('🔍 Generating multi-region pHashes (18 regions)...');
    const startTime = Date.now();
    
    for (const [name, regionFn] of Object.entries(regions)) {
      const hash = await this.generateRegionPHash(input, regionFn);
      if (hash) {
        hashes[name] = hash;
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Generated ${Object.keys(hashes).length} region pHashes in ${elapsed}ms`);
    
    return hashes;
  }

  // ============================================================================
  // PHASH COMPARISON
  // ============================================================================
  
  /**
   * Calculate Hamming distance between two hex pHash strings
   */
  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return Infinity;
    }
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const byte1 = parseInt(hash1[i], 16);
      const byte2 = parseInt(hash2[i], 16);
      let xor = byte1 ^ byte2;
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    return distance;
  }

  /**
   * Calculate similarity score (0-100) from pHash comparison
   */
  similarityScore(hash1, hash2) {
    if (!hash1 || !hash2) return 0;
    const distance = this.hammingDistance(hash1, hash2);
    const maxBits = hash1.length * 4;
    const similarity = Math.max(0, 100 - (distance / maxBits * 100));
    return Math.round(similarity);
  }

  /**
   * Compare two sets of region hashes and find best match
   * @param {Object} hashes1 - Region hashes from first image
   * @param {Object} hashes2 - Region hashes from second image
   * @returns {Object} Best match info with similarity, regions matched
   */
 compareRegionHashes(hashes1, hashes2) {
    let bestMatch = {
      similarity: 0,
      region1: null,
      region2: null
    };
    
    // Only compare same regions (full↔full, center50↔center50, etc.)
    // This prevents false positives from generic patterns matching across different regions
    const regions = Object.keys(hashes1).filter(r => hashes2[r]);
    
    for (const region of regions) {
      const sim = this.similarityScore(hashes1[region], hashes2[region]);
      if (sim > bestMatch.similarity) {
        bestMatch = {
          similarity: sim,
          region1: region,
          region2: region
        };
      }
    }
    
    return bestMatch;
  }

  // ============================================================================
  // DATABASE OPERATIONS
  // ============================================================================

  /**
   * Find similar content using multi-region pHash comparison
   * @param {string} phash - Primary pHash (for backward compatibility)
   * @param {Object} regionHashes - All region hashes for the image
   * @param {string} excludeFingerprint - Fingerprint to exclude from results
   * @param {number} threshold - Minimum similarity threshold (default 70 for crops)
   */
  async findSimilarContent(phash, regionHashes = null, excludeFingerprint = null, threshold = 85) {
    if (!phash && !regionHashes) return [];
    
    try {
      // Query for content with region hashes
      let query = `
        SELECT DISTINCT ON (fingerprint) 
          fingerprint, phash, phash_regions, upload_date, media_kind, original_filename
        FROM verifications 
        WHERE phash IS NOT NULL
      `;
      
      if (excludeFingerprint) {
        query += ` AND fingerprint != $1`;
      }
      
      query += ` ORDER BY fingerprint, upload_date ASC LIMIT 1000`;
      
      const result = excludeFingerprint 
        ? await db.query(query, [excludeFingerprint])
        : await db.query(query);
      
      const similar = [];
      
      for (const row of result.rows) {
        let bestSimilarity = 0;
        let matchDetails = { region1: 'full', region2: 'full' };
        
        // First try full pHash comparison (backward compatible)
        if (phash && row.phash) {
          bestSimilarity = this.similarityScore(phash, row.phash);
        }
        
        // If we have region hashes, do multi-region comparison
        if (regionHashes && row.phash_regions) {
          try {
            const storedRegions = typeof row.phash_regions === 'string' 
              ? JSON.parse(row.phash_regions) 
              : row.phash_regions;
            
            const regionMatch = this.compareRegionHashes(regionHashes, storedRegions);
            
            if (regionMatch.similarity > bestSimilarity) {
              bestSimilarity = regionMatch.similarity;
              matchDetails = {
                region1: regionMatch.region1,
                region2: regionMatch.region2
              };
            }
          } catch (e) {
            // Ignore JSON parse errors, fall back to full hash
          }
        }
        
        if (bestSimilarity >= threshold) {
          similar.push({
            fingerprint: row.fingerprint,
            similarity: bestSimilarity,
            first_seen: row.upload_date,
            media_kind: row.media_kind,
            filename: row.original_filename,
            match_type: matchDetails.region1 === 'full' && matchDetails.region2 === 'full' 
              ? 'full_image' 
              : 'region_match',
            matched_regions: matchDetails
          });
        }
      }
      
      // Sort by similarity descending
      similar.sort((a, b) => b.similarity - a.similarity);
      
      return similar;
    } catch (err) {
      console.error('⚠️ Error finding similar content:', err.message);
      return [];
    }
  }

  /**
   * Determine relationship type based on similarity and match details
   */
  getRelationshipType(similarity, isScreenshot = false, matchType = 'full_image') {
    if (similarity === 100) return 'exact_match';
    if (isScreenshot) return 'screenshot';
    if (similarity >= 95) return 'recompressed';
    if (matchType === 'region_match') return 'cropped';
    if (similarity >= 85) return 'derivative';
    return 'similar';
  }

  /**
   * Record a relationship between two pieces of content
   */
  async recordRelationship(parentFingerprint, childFingerprint, relationshipType, similarityScore) {
    try {
      await db.query(`
        INSERT INTO content_relationships 
          (parent_fingerprint, child_fingerprint, relationship_type, similarity_score)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (parent_fingerprint, child_fingerprint) DO UPDATE
        SET relationship_type = $3, similarity_score = $4, detected_at = CURRENT_TIMESTAMP
      `, [parentFingerprint, childFingerprint, relationshipType, similarityScore]);
      
      await db.query(`
        UPDATE verifications 
        SET is_derivative = TRUE, parent_fingerprint = $1
        WHERE fingerprint = $2 AND is_derivative = FALSE
      `, [parentFingerprint, childFingerprint]);
      
      return true;
    } catch (err) {
      console.error('⚠️ Error recording relationship:', err.message);
      return false;
    }
  }

  /**
   * Get provenance timeline for a fingerprint
   */
  async getTimeline(fingerprint) {
    try {
      const timeline = [];
      
      const verificationsResult = await db.query(`
        SELECT * FROM verifications 
        WHERE fingerprint = $1 
        ORDER BY upload_date ASC
      `, [fingerprint]);
      
      const verifications = verificationsResult.rows;
      
      if (verifications.length === 0) {
        return { found: false, timeline: [] };
      }
      
      const first = verifications[0];
      timeline.push({
        timestamp: first.upload_date,
        event_type: 'first_verified',
        details: {
          media_kind: first.media_kind,
          filename: first.original_filename,
          file_size: first.file_size
        }
      });
      
      if (first.polygon_tx_hash) {
        timeline.push({
          timestamp: first.polygon_timestamp || first.upload_date,
          event_type: 'blockchain_confirmed',
          details: {
            network: 'polygon',
            block_number: first.polygon_block_number,
            transaction_hash: first.polygon_tx_hash
          }
        });
      }
      
      if (first.bitcoin_proof_status === 'confirmed') {
        timeline.push({
          timestamp: first.bitcoin_submitted_at,
          event_type: 'blockchain_confirmed',
          details: {
            network: 'bitcoin',
            status: 'confirmed'
          }
        });
      }
      
      for (let i = 1; i < verifications.length; i++) {
        timeline.push({
          timestamp: verifications[i].upload_date,
          event_type: 're_verification',
          details: {
            verification_number: i + 1
          }
        });
      }
      
      const derivativesResult = await db.query(`
        SELECT cr.*, v.upload_date, v.media_kind, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.child_fingerprint
        WHERE cr.parent_fingerprint = $1
        ORDER BY cr.detected_at ASC
      `, [fingerprint]);
      
      for (const deriv of derivativesResult.rows) {
        timeline.push({
          timestamp: deriv.detected_at,
          event_type: 'derivative_detected',
          details: {
            child_fingerprint: deriv.child_fingerprint,
            relationship_type: deriv.relationship_type,
            similarity: deriv.similarity_score,
            filename: deriv.original_filename
          }
        });
      }
      
      const parentResult = await db.query(`
        SELECT cr.*, v.upload_date, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.parent_fingerprint
        WHERE cr.child_fingerprint = $1
      `, [fingerprint]);
      
      let parent = null;
      if (parentResult.rows.length > 0) {
        const p = parentResult.rows[0];
        parent = {
          fingerprint: p.parent_fingerprint,
          relationship_type: p.relationship_type,
          similarity: p.similarity_score,
          first_seen: p.upload_date
        };
      }
      
      timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM verifications WHERE fingerprint = $1',
        [fingerprint]
      );
      
      return {
        found: true,
        fingerprint,
        first_seen: first.upload_date,
        verification_count: parseInt(countResult.rows[0].count),
        is_derivative: !!parent,
        parent,
        derivatives_count: derivativesResult.rows.length,
        timeline
      };
      
    } catch (err) {
      console.error('⚠️ Error getting timeline:', err.message);
      return { found: false, error: err.message };
    }
  }

  /**
   * Check for relationships during verification (with multi-region support)
   * @param {string} fingerprint - SHA256 fingerprint of the file
   * @param {string} phash - Primary pHash
   * @param {Object} regionHashes - All region hashes
   * @param {boolean} isScreenshot - Whether this is detected as a screenshot
   */
  async checkAndRecordProvenance(fingerprint, phash, regionHashes = null, isScreenshot = false) {
    try {
      console.log('🔗 Checking content provenance...');
      
      // Find similar content using multi-region comparison
      const similar = await this.findSimilarContent(phash, regionHashes, fingerprint, 85);
      
      if (similar.length === 0) {
        console.log('   ✅ Original content (no similar content found)');
        return {
          is_original: true,
          similar_content: [],
          relationships_recorded: 0
        };
      }
      
      console.log(`   ⚠️ Found ${similar.length} similar content matches`);
      
      // Record relationships with the most similar content
      let recorded = 0;
      for (const match of similar.slice(0, 5)) {
        const relType = this.getRelationshipType(
          match.similarity, 
          isScreenshot, 
          match.match_type
        );
        const success = await this.recordRelationship(
          match.fingerprint,
          fingerprint,
          relType,
          match.similarity
        );
        if (success) {
          recorded++;
          console.log(`   📎 Linked to ${match.fingerprint.substring(0, 8)}... (${match.similarity}% ${relType})`);
        }
      }
      
      return {
        is_original: false,
        similar_content: similar.slice(0, 5),
        relationships_recorded: recorded,
        most_similar: similar[0]
      };
      
    } catch (err) {
      console.error('⚠️ Error checking provenance:', err.message);
      return { is_original: true, error: err.message };
    }
  }

  /**
   * Get stats about content relationships
   */
  async getStats() {
    try {
      const relationshipsCount = await db.query('SELECT COUNT(*) as count FROM content_relationships');
      const derivativesCount = await db.query('SELECT COUNT(*) as count FROM verifications WHERE is_derivative = TRUE');
      const uniqueParents = await db.query('SELECT COUNT(DISTINCT parent_fingerprint) as count FROM content_relationships');
      const withRegionHashes = await db.query('SELECT COUNT(*) as count FROM verifications WHERE phash_regions IS NOT NULL');
      
      return {
        total_relationships: parseInt(relationshipsCount.rows[0].count),
        total_derivatives: parseInt(derivativesCount.rows[0].count),
        unique_originals_with_derivatives: parseInt(uniqueParents.rows[0].count),
        verifications_with_region_hashes: parseInt(withRegionHashes.rows[0].count)
      };
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = new ProvenanceService();