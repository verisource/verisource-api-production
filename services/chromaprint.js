/**
 * Chromaprint Audio Fingerprinting Service
 * Generates perceptual audio fingerprints for duplicate/similar audio detection
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class ChromaprintService {
  
  /**
   * Generate Chromaprint fingerprint for an audio file
   * @param {string} audioPath - Path to audio file
   * @returns {Promise<Object>} Fingerprint data
   */
  static async generateFingerprint(audioPath) {
    try {
      // Run fpcalc to get fingerprint
      const { stdout } = await execAsync(`fpcalc -json "${audioPath}"`);
      const result = JSON.parse(stdout);
      
      if (!result.fingerprint) {
        throw new Error('Failed to generate audio fingerprint');
      }
      
      return {
        success: true,
        duration: result.duration,
        fingerprint: result.fingerprint,
        raw_fingerprint: result.fingerprint
      };
      
    } catch (error) {
      console.error('[Chromaprint] Error generating fingerprint:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Calculate Hamming distance between two fingerprints
   * @param {string} fp1 - First fingerprint (base64)
   * @param {string} fp2 - Second fingerprint (base64)
   * @returns {number} Hamming distance (0 = identical)
   */
  static calculateDistance(fp1, fp2) {
    try {
      // For now, simple string comparison
      // In production, decode base64 and calculate bit differences
      if (fp1 === fp2) return 0;
      
      // Rough estimate based on string similarity
      let differences = 0;
      const maxLen = Math.max(fp1.length, fp2.length);
      
      for (let i = 0; i < maxLen; i++) {
        if (fp1[i] !== fp2[i]) differences++;
      }
      
      return differences;
      
    } catch (error) {
      console.error('[Chromaprint] Error calculating distance:', error);
      return -1;
    }
  }
  
  /**
   * Calculate similarity percentage between two fingerprints
   * @param {string} fp1 - First fingerprint
   * @param {string} fp2 - Second fingerprint
   * @returns {number} Similarity percentage (0-100)
   */
  static calculateSimilarity(fp1, fp2) {
    const distance = this.calculateDistance(fp1, fp2);
    if (distance === -1) return 0;
    if (distance === 0) return 100;
    
    const maxLen = Math.max(fp1.length, fp2.length);
    const similarity = ((maxLen - distance) / maxLen) * 100;
    
    return Math.round(similarity);
  }
  
  /**
   * Search for similar audio in database
   * @param {string} fingerprint - Audio fingerprint to search
   * @param {Object} db - Database connection
   * @param {number} threshold - Similarity threshold (default 85)
   * @returns {Promise<Array>} Array of similar audio matches
   */
  static async searchSimilarAudio(fingerprint, db, threshold = 85) {
    try {
      if (!db) {
        console.warn('[Chromaprint] Database not available for similar audio search');
        return [];
      }
      
      // Query database for audio fingerprints
      const query = `
        SELECT 
          id as verification_id,
          filename,
          verified_at,
          file_size,
          audio_fingerprint
        FROM verifications
        WHERE audio_fingerprint IS NOT NULL
        ORDER BY verified_at DESC
        LIMIT 100
      `;
      
      const results = await db.query(query);
      const matches = [];
      
      // Calculate similarity for each result
      for (const row of results.rows) {
        const similarity = this.calculateSimilarity(fingerprint, row.audio_fingerprint);
        
        if (similarity >= threshold) {
          matches.push({
            verification_id: row.verification_id,
            filename: row.filename,
            verified_at: row.verified_at,
            file_size: row.file_size,
            similarity: similarity,
            interpretation: this.interpretSimilarity(similarity)
          });
        }
      }
      
      // Sort by similarity descending
      matches.sort((a, b) => b.similarity - a.similarity);
      
      return matches;
      
    } catch (error) {
      console.error('[Chromaprint] Error searching similar audio:', error.message);
      return [];
    }
  }
  
  /**
   * Interpret similarity score
   * @param {number} similarity - Similarity percentage
   * @returns {string} Human-readable interpretation
   */
  static interpretSimilarity(similarity) {
    if (similarity === 100) return 'Identical';
    if (similarity >= 95) return 'Nearly Identical';
    if (similarity >= 90) return 'Very Similar';
    if (similarity >= 85) return 'Similar';
    if (similarity >= 70) return 'Somewhat Similar';
    return 'Different';
  }
}

module.exports = ChromaprintService;
