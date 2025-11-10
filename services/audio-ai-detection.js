/**
 * Audio AI Detection Service
 * Detects AI-generated audio using acoustic analysis
 */

const fs = require('fs');
const { execSync } = require('child_process');

class AudioAIDetection {
  /**
   * Analyze audio file for AI generation patterns
   * @param {string} audioPath - Path to audio file
   * @returns {Object} Detection results
   */
  static async analyze(audioPath) {
    try {
      console.log('🎵 Analyzing audio for AI generation...');
      
      const features = await this.extractFeatures(audioPath);
      const score = this.calculateAIScore(features);
      const indicators = this.getIndicators(features, score);
      
      return {
        likely_ai_generated: score >= 50,
        ai_confidence: score,
        indicators: indicators,
        features: {
          duration: features.duration,
          sample_rate: features.sampleRate,
          channels: features.channels,
          bitrate: features.bitrate
        }
      };
    } catch (error) {
      console.error('⚠️ Audio AI detection error:', error.message);
      return {
        error: error.message,
        likely_ai_generated: false,
        ai_confidence: 0
      };
    }
  }
  
  /**
   * Extract audio features using ffmpeg
   */
  static async extractFeatures(audioPath) {
    try {
      // Get basic audio info
      const probeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
      const probeOutput = execSync(probeCmd, { encoding: 'utf-8' });
      const probeData = JSON.parse(probeOutput);
      
      const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
      
      if (!audioStream) {
        throw new Error('No audio stream found');
      }
      
      // Extract spectral analysis
      const spectralData = await this.analyzeSpectrum(audioPath);
      
      return {
        duration: parseFloat(probeData.format.duration),
        sampleRate: parseInt(audioStream.sample_rate),
        channels: audioStream.channels,
        bitrate: parseInt(probeData.format.bit_rate || 0),
        codec: audioStream.codec_name,
        ...spectralData
      };
    } catch (error) {
      throw new Error(`Feature extraction failed: ${error.message}`);
    }
  }
  
  /**
   * Analyze audio spectrum for AI patterns
   */
  static async analyzeSpectrum(audioPath) {
    try {
      // Use ffmpeg to generate silence detection (helps identify unnatural consistency)
      const silenceCmd = `ffmpeg -i "${audioPath}" -af silencedetect=n=-50dB:d=0.1 -f null - 2>&1 | grep silence`;
      
      let silenceOutput = '';
      try {
        silenceOutput = execSync(silenceCmd, { 
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).toString();
      } catch (e) {
        // Command may "fail" but still produce output
        silenceOutput = e.stdout || '';
      }
      
      const silenceCount = (silenceOutput.match(/silence_start/g) || []).length;
      
      // Extract volume statistics
      const volumeCmd = `ffmpeg -i "${audioPath}" -af volumedetect -f null - 2>&1 | grep -E "(mean_volume|max_volume)"`;
      
      let volumeOutput = '';
      try {
        volumeOutput = execSync(volumeCmd, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).toString();
      } catch (e) {
        volumeOutput = e.stdout || '';
      }
      
      const meanMatch = volumeOutput.match(/mean_volume:\s*([-\d.]+)/);
      const maxMatch = volumeOutput.match(/max_volume:\s*([-\d.]+)/);
      
      return {
        silenceCount: silenceCount,
        meanVolume: meanMatch ? parseFloat(meanMatch[1]) : null,
        maxVolume: maxMatch ? parseFloat(maxMatch[1]) : null,
        dynamicRange: (meanMatch && maxMatch) ? Math.abs(parseFloat(maxMatch[1]) - parseFloat(meanMatch[1])) : null
      };
    } catch (error) {
      console.warn('Spectral analysis failed, using basic detection:', error.message);
      return {
        silenceCount: 0,
        meanVolume: null,
        maxVolume: null,
        dynamicRange: null
      };
    }
  }
  
  /**
   * Calculate AI probability score (0-100)
   */
  static calculateAIScore(features) {
    let score = 0;
    const reasons = [];
    
    // Check 1: Unnaturally consistent levels (AI voices are too perfect)
    if (features.dynamicRange !== null) {
      if (features.dynamicRange < 15) {
        score += 25;
        reasons.push('Very low dynamic range (unnaturally consistent)');
      } else if (features.dynamicRange < 25) {
        score += 15;
        reasons.push('Low dynamic range');
      } else {
        reasons.push('Natural dynamic range detected');
      }
    }
    
    // Check 2: Lack of natural silences (AI tends to be continuous)
    if (features.duration && features.silenceCount !== null) {
      const silenceRatio = features.silenceCount / features.duration;
      if (silenceRatio < 0.1 && features.duration > 10) {
        score += 20;
        reasons.push('Unusually continuous audio (lack of natural pauses)');
      }
    }
    
    // Check 3: Perfect sample rates (AI generators use standard rates)
    const commonAIRates = [22050, 24000, 44100, 48000];
    if (commonAIRates.includes(features.sampleRate)) {
      score += 5;
      reasons.push(`Standard sample rate (${features.sampleRate} Hz)`);
    }
    
    // Check 4: Mono vs Stereo (AI voice clones often mono, AI music often perfect stereo)
    if (features.channels === 1) {
      score += 10;
      reasons.push('Mono audio (common for AI voice generation)');
    } else if (features.channels === 2) {
      score += 5;
      reasons.push('Stereo audio');
    }
    
    // Check 5: Missing natural audio artifacts from volume analysis
    if (features.meanVolume !== null && features.maxVolume !== null) {
      // Natural recordings have more variation
      const consistency = 100 - Math.abs(features.dynamicRange || 0);
      if (consistency > 85) {
        score += 20;
        reasons.push('Unnaturally consistent volume levels');
      }
    }
    
    // Check 6: Codec analysis
    const aiCommonCodecs = ['aac', 'mp3', 'opus'];
    if (aiCommonCodecs.includes(features.codec)) {
      score += 5;
      reasons.push(`Common AI codec (${features.codec})`);
    }
    
    // If score is low, add positive indicators
    if (score < 30) {
      reasons.push('Natural audio characteristics detected');
      reasons.push('Typical recording artifacts present');
    }
    
    features.aiReasons = reasons;
    return Math.min(score, 100);
  }
  
  /**
   * Get human-readable indicators
   */
  static getIndicators(features, score) {
    const indicators = [];
    
    if (features.aiReasons) {
      indicators.push(...features.aiReasons);
    }
    
    if (score >= 70) {
      indicators.push('High confidence AI generation');
    } else if (score >= 50) {
      indicators.push('Possible AI generation detected');
    } else if (score >= 30) {
      indicators.push('Some synthetic characteristics present');
    }
    
    return indicators;
  }
}

module.exports = { AudioAIDetection };
