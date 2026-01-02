/**
 * Video Audio Fingerprint Service
 * Extracts audio track from video and generates Chromaprint fingerprint
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');
const ChromaprintService = require('./services/chromaprint');

class VideoAudioFingerprint {
  
  /**
   * Extract audio from video and generate Chromaprint fingerprint
   * @param {string} videoPath - Path to video file
   * @param {object} options - Optional settings
   * @returns {object} Fingerprint result
   */
  static async extractAndFingerprint(videoPath, options = {}) {
    const requestId = options.requestId || Date.now();
    const audioTempPath = path.join(os.tmpdir(), `video-audio-${requestId}.wav`);
    
    try {
      console.log('🎵 Extracting audio track from video...');
      
      // Check if video has audio track first
      const hasAudio = await this.checkHasAudio(videoPath);
      if (!hasAudio) {
        console.log('   ℹ️ Video has no audio track');
        return {
          success: true,
          has_audio: false,
          fingerprint: null,
          message: 'Video has no audio track'
        };
      }
      
      // Extract audio track to WAV (Chromaprint works best with uncompressed audio)
      await this.extractAudioTrack(videoPath, audioTempPath);
      
      // Check if extraction produced a valid file
      if (!fs.existsSync(audioTempPath)) {
        throw new Error('Audio extraction failed - no output file');
      }
      
      const audioStats = fs.statSync(audioTempPath);
      if (audioStats.size < 1000) {
        throw new Error('Audio extraction failed - file too small');
      }
      
      console.log(`   ✅ Audio extracted: ${(audioStats.size / 1024).toFixed(1)} KB`);
      
      // Generate Chromaprint fingerprint
      console.log('🎵 Generating Chromaprint fingerprint...');
      const chromaprintResult = await ChromaprintService.generateFingerprint(audioTempPath);
      
      if (!chromaprintResult.success) {
        throw new Error(chromaprintResult.error || 'Chromaprint generation failed');
      }
      
      console.log(`   ✅ Fingerprint generated (${chromaprintResult.duration.toFixed(1)}s audio)`);
      
      return {
        success: true,
        has_audio: true,
        fingerprint: chromaprintResult.fingerprint,
        duration: chromaprintResult.duration,
        extracted_from: 'video_audio_track',
        fingerprint_length: chromaprintResult.fingerprint.length
      };
      
    } catch (error) {
      console.error('   ❌ Video audio fingerprint error:', error.message);
      return {
        success: false,
        has_audio: null,
        fingerprint: null,
        error: error.message
      };
      
    } finally {
      // Cleanup temp file
      try {
        if (fs.existsSync(audioTempPath)) {
          fs.unlinkSync(audioTempPath);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
  
  /**
   * Check if video file has an audio track
   */
  static async checkHasAudio(videoPath) {
    try {
      const cmd = `ffprobe -i "${videoPath}" -show_streams -select_streams a -loglevel error`;
      const { stdout } = await execAsync(cmd);
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Extract audio track from video to WAV file
   */
  static async extractAudioTrack(videoPath, outputPath) {
    const cmd = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}" -y 2>&1`;
    await execAsync(cmd, { timeout: 60000 }); // 60 second timeout
  }
  
  /**
   * Search for matching audio fingerprints in database
   * @param {string} fingerprint - Chromaprint fingerprint to search for
   * @param {object} db - Database connection
   * @param {string} excludeFingerprint - SHA256 to exclude from results (current file)
   * @param {number} threshold - Minimum similarity percentage (default 85)
   */
  static async searchMatches(fingerprint, db, excludeFingerprint = null, threshold = 85) {
    if (!fingerprint || !db) {
      return { found: false, matches: [] };
    }
    
    try {
      // First check for exact matches (fast)
      const exactQuery = `
        SELECT 
          fingerprint,
          original_filename,
          media_kind,
          upload_date,
          audio_fingerprint
        FROM verifications 
        WHERE audio_fingerprint = $1
          ${excludeFingerprint ? 'AND fingerprint != $2' : ''}
        ORDER BY upload_date ASC
        LIMIT 10
      `;
      
      const params = excludeFingerprint 
        ? [fingerprint, excludeFingerprint]
        : [fingerprint];
      
      const exactMatches = await db.query(exactQuery, params);
      
      if (exactMatches.rows.length > 0) {
        return {
          found: true,
          match_type: 'exact',
          count: exactMatches.rows.length,
          matches: exactMatches.rows.map(row => ({
            sha256: row.fingerprint,
            filename: row.original_filename,
            media_type: row.media_kind,
            first_seen: row.upload_date,
            similarity: 100,
            interpretation: 'Identical'
          })),
          warning: 'Exact audio match found - this audio track has been submitted before'
        };
      }
      
      // If no exact match, search for similar (slower)
      const similarMatches = await ChromaprintService.searchSimilarAudio(fingerprint, db, threshold);
      
      // Filter out current file
      const filteredMatches = excludeFingerprint
        ? similarMatches.filter(m => m.fingerprint !== excludeFingerprint)
        : similarMatches;
      
      if (filteredMatches.length > 0) {
        return {
          found: true,
          match_type: 'similar',
          count: filteredMatches.length,
          matches: filteredMatches.slice(0, 10),
          warning: 'Similar audio found - this audio track may have been used before'
        };
      }
      
      return {
        found: false,
        match_type: null,
        count: 0,
        matches: [],
        message: 'Audio is unique - not found in database'
      };
      
    } catch (error) {
      console.error('   ❌ Audio match search error:', error.message);
      return {
        found: false,
        error: error.message
      };
    }
  }
  
  /**
   * Full analysis: extract fingerprint and search for matches
   */
  static async analyzeVideoAudio(videoPath, db, options = {}) {
    const { requestId, excludeFingerprint } = options;
    
    // Step 1: Extract and fingerprint
    const fpResult = await this.extractAndFingerprint(videoPath, { requestId });
    
    if (!fpResult.success || !fpResult.has_audio || !fpResult.fingerprint) {
      return {
        ...fpResult,
        matches: null
      };
    }
    
    // Step 2: Search for matches
    const matchResult = await this.searchMatches(
      fpResult.fingerprint, 
      db, 
      excludeFingerprint,
      options.threshold || 85
    );
    
    return {
      ...fpResult,
      matches: matchResult
    };
  }
}

module.exports = VideoAudioFingerprint;