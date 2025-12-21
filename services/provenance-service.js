/**
 * Provenance Service
 * Tracks content lineage, derivatives, and timeline
 */

const db = require('../db-minimal');

class ProvenanceService {
  
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
   * Find similar content by pHash
   */
  async findSimilarContent(phash, excludeFingerprint = null, threshold = 85) {
    if (!phash) return [];
    
    try {
      let query = `
        SELECT DISTINCT ON (fingerprint) 
          fingerprint, phash, upload_date, media_kind, original_filename
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
        const similarity = this.similarityScore(phash, row.phash);
        if (similarity >= threshold) {
          similar.push({
            fingerprint: row.fingerprint,
            similarity,
            first_seen: row.upload_date,
            media_kind: row.media_kind,
            filename: row.original_filename
          });
        }
      }
      
      similar.sort((a, b) => b.similarity - a.similarity);
      return similar;
    } catch (err) {
      console.error('Error finding similar content:', err.message);
      return [];
    }
  }

  /**
   * Determine relationship type based on similarity
   */
  getRelationshipType(similarity, isScreenshot = false) {
    if (similarity === 100) return 'exact_match';
    if (isScreenshot) return 'screenshot';
    if (similarity >= 95) return 'recompressed';
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
      console.error('Error recording relationship:', err.message);
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
      console.error('Error getting timeline:', err.message);
      return { found: false, error: err.message };
    }
  }

  /**
   * Check for relationships during verification
   */
  async checkAndRecordProvenance(fingerprint, phash, isScreenshot = false) {
    try {
      const similar = await this.findSimilarContent(phash, fingerprint, 85);
      
      if (similar.length === 0) {
        return {
          is_original: true,
          similar_content: [],
          relationships_recorded: 0
        };
      }
      
      let recorded = 0;
      for (const match of similar.slice(0, 5)) {
        const relType = this.getRelationshipType(match.similarity, isScreenshot);
        const success = await this.recordRelationship(
          match.fingerprint,
          fingerprint,
          relType,
          match.similarity
        );
        if (success) recorded++;
      }
      
      return {
        is_original: false,
        similar_content: similar.slice(0, 5),
        relationships_recorded: recorded,
        most_similar: similar[0]
      };
      
    } catch (err) {
      console.error('Error checking provenance:', err.message);
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
      
      return {
        total_relationships: parseInt(relationshipsCount.rows[0].count),
        total_derivatives: parseInt(derivativesCount.rows[0].count),
        unique_originals_with_derivatives: parseInt(uniqueParents.rows[0].count)
      };
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = new ProvenanceService();