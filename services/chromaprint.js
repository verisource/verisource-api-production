/**
 * Chromaprint Audio Fingerprinting Service
 * Uses FFmpeg's built-in chromaprint filter instead of fpcalc
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

class ChromaprintService {
  
  /**
   * Generate Chromaprint fingerprint using FFmpeg
   */
  static async generateFingerprint(audioPath) {
    try {
      console.log('[Chromaprint] Using FFmpeg chromaprint filter');
      
      // Use FFmpeg's chromaprint filter to generate fingerprint
      // Output to a temp file to separate stderr from fingerprint data
      const tempFp = audioPath + '.chromaprint.txt';
      const cmd = `ffmpeg -i "${audioPath}" -f chromaprint -fp_format raw "${tempFp}" -y 2>&1`;
      const { stdout, stderr } = await execAsync(cmd);
      
      // Parse duration from FFmpeg stderr
      const output = stdout + stderr;
      const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      let duration = 0;
      if (durationMatch) {
        const hours = parseInt(durationMatch[1]);
        const minutes = parseInt(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
      
      // Read fingerprint from temp file
      const fingerprint = fs.readFileSync(tempFp, 'base64');
      fs.unlinkSync(tempFp);
      
      if (!fingerprint || fingerprint.length < 10) {
        throw new Error('No fingerprint generated');
      }
      
      console.log('[Chromaprint] SUCCESS! Fingerprint length:', fingerprint.length);
      
      return {
        success: true,
        duration: duration,
        fingerprint: fingerprint,
        raw_fingerprint: fingerprint
      };
      
    } catch (error) {
      console.error('[Chromaprint] Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  static calculateDistance(fp1, fp2) {
    try {
      if (fp1 === fp2) return 0;
      let differences = 0;
      const maxLen = Math.max(fp1.length, fp2.length);
      for (let i = 0; i < maxLen; i++) {
        if (fp1[i] !== fp2[i]) differences++;
      }
      return differences;
    } catch (error) {
      return -1;
    }
  }
  
  static calculateSimilarity(fp1, fp2) {
    const distance = this.calculateDistance(fp1, fp2);
    if (distance === -1) return 0;
    if (distance === 0) return 100;
    const maxLen = Math.max(fp1.length, fp2.length);
    return Math.round(((maxLen - distance) / maxLen) * 100);
  }
  
  static async searchSimilarAudio(fingerprint, db, threshold = 85) {
    try {
      if (!db) return [];
      
      const query = `
        SELECT id as verification_id, original_filename as filename, upload_date as verified_at, file_size, audio_fingerprint
        FROM verifications
        WHERE audio_fingerprint IS NOT NULL
        ORDER BY upload_date DESC
        LIMIT 100
      `;
      
      const results = await db.query(query);
      const matches = [];
      
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
      
      matches.sort((a, b) => b.similarity - a.similarity);
      return matches;
      
    } catch (error) {
      console.error('[Chromaprint] Search error:', error.message);
      return [];
    }
  }
  
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
