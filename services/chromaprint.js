/**
 * Chromaprint Audio Fingerprinting Service
 * Enhanced with audio conversion for Railway deployment
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

class ChromaprintService {
  
  /**
   * Find fpcalc binary location
   */
  static async findFpcalc() {
    const possiblePaths = [
      'fpcalc',
      '/usr/local/bin/fpcalc',
      '/usr/bin/fpcalc',
      './bin/fpcalc',
      process.cwd() + '/bin/fpcalc'
    ];
    
    for (const path of possiblePaths) {
      try {
        await execAsync(`${path} -version`);
        return path;
      } catch (e) {
        // Try next
      }
    }
    
    throw new Error('fpcalc not found');
  }
  
  /**
   * Generate Chromaprint fingerprint for an audio file
   */
  static async generateFingerprint(audioPath) {
    let convertedPath = null;
    
    try {
      const fpcalc = await this.findFpcalc();
      
      // Convert audio to WAV format for better compatibility
      convertedPath = audioPath + '.chromaprint.wav';
      
      try {
        // Convert to 16kHz mono WAV
        const convCmd = `ffmpeg -i "${audioPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${convertedPath}" -y 2>&1`;
        console.log('[Chromaprint] Running conversion:', convCmd);
        const convResult = await execAsync(convCmd);
        console.log('[Chromaprint] FFmpeg output:', convResult.stdout || convResult.stderr);
        
        // Check if file was created and has content
        const stats = fs.statSync(convertedPath);
        console.log('[Chromaprint] Converted file size:', stats.size, 'bytes');
        
        if (stats.size === 0) {
          throw new Error('Converted file is empty');
        }
        
        console.log('[Chromaprint] Audio converted successfully');
      } catch (convError) {
        console.error('[Chromaprint] Conversion failed:', convError.message);
        console.error('[Chromaprint] Full error:', convError.stdout || convError.stderr || convError);
        // Try original file
        convertedPath = null;
      }
      
      const inputFile = convertedPath && fs.existsSync(convertedPath) ? convertedPath : audioPath;
      
      console.log('[Chromaprint] Processing:', inputFile);
      
      // Try the original file first (often works better than conversion)
      let stdout, result;
      try {
        console.log('[Chromaprint] Trying original file first...');
        const origResult = await execAsync(`${fpcalc} -json "${audioPath}"`);
        stdout = origResult.stdout;
        console.log('[Chromaprint] Original file worked!');
      } catch (origError) {
        console.log('[Chromaprint] Original failed, trying converted WAV...');
        const wavResult = await execAsync(`${fpcalc} -json "${inputFile}"`);
        stdout = wavResult.stdout;
      }
      
      result = JSON.parse(stdout);
      
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
      console.error('[Chromaprint] Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // Clean up converted file
      if (convertedPath && fs.existsSync(convertedPath)) {
        try {
          fs.unlinkSync(convertedPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
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
        SELECT id as verification_id, filename, verified_at, file_size, audio_fingerprint
        FROM verifications
        WHERE audio_fingerprint IS NOT NULL
        ORDER BY verified_at DESC
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
