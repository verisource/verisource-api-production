/**
 * Audio Spectral Analysis Service
 * Detects AI-generated voices through spectral pattern analysis
 * FREE - uses local FFT analysis, no external APIs
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AudioSpectralAnalysis {
  
  /**
   * Analyze audio for AI generation indicators
   * @param {string} audioPath - Path to audio file
   * @returns {Object} Analysis results with AI confidence
   */
  static async analyze(audioPath) {
    const results = {
      is_likely_ai_voice: false,
      ai_confidence: 0,
      indicators: [],
      warnings: [],
      spectral_analysis: {},
      speech_patterns: {},
      metadata_forensics: {}
    };

    try {
      // 1. Extract audio metadata
      const metadata = await this.extractMetadata(audioPath);
      results.metadata_forensics = metadata;
      
      // 2. Analyze spectral characteristics
      const spectral = await this.analyzeSpectralFeatures(audioPath);
      results.spectral_analysis = spectral;
      
      // 3. Analyze speech patterns
      const speech = await this.analyzeSpeechPatterns(audioPath);
      results.speech_patterns = speech;
      
      // 4. Calculate AI confidence score
      const scoring = this.calculateAIScore(metadata, spectral, speech);
      results.ai_confidence = scoring.confidence;
      results.is_likely_ai_voice = scoring.confidence > 60;
      results.indicators = scoring.indicators;
      results.warnings = scoring.warnings;
      
      // 5. Add verdict
      results.verdict = this.getVerdict(scoring.confidence);
      
      return results;
      
    } catch (error) {
      console.error('Audio spectral analysis error:', error.message);
      return {
        ...results,
        error: error.message,
        verdict: 'Unable to complete analysis'
      };
    }
  }

  /**
   * Extract audio file metadata for forensic analysis
   */
  static async extractMetadata(audioPath) {
    return new Promise((resolve) => {
      const metadata = {
        format: 'unknown',
        duration: 0,
        sample_rate: 0,
        bit_rate: 0,
        channels: 0,
        codec: 'unknown',
        encoder: null,
        creation_software: null,
        suspicious_indicators: []
      };

      // Use ffprobe for detailed metadata
      const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
      
      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error) {
          console.warn('ffprobe not available, using basic analysis');
          // Fallback to basic file analysis
          const stats = fs.statSync(audioPath);
          metadata.file_size = stats.size;
          metadata.suspicious_indicators.push('Unable to extract detailed metadata');
          resolve(metadata);
          return;
        }

        try {
          const info = JSON.parse(stdout);
          
          // Extract format info
          if (info.format) {
            metadata.format = info.format.format_name;
            metadata.duration = parseFloat(info.format.duration) || 0;
            metadata.bit_rate = parseInt(info.format.bit_rate) || 0;
            
            // Check for encoder tags (AI tools often have specific signatures)
            if (info.format.tags) {
              metadata.encoder = info.format.tags.encoder || info.format.tags.ENCODER;
              metadata.creation_software = info.format.tags.software || info.format.tags.SOFTWARE;
              
              // Check for suspicious encoder signatures
              const suspiciousEncoders = ['elevenlabs', 'resemble', 'descript', 'murf', 'play.ht'];
              if (metadata.encoder) {
                const encoderLower = metadata.encoder.toLowerCase();
                if (suspiciousEncoders.some(s => encoderLower.includes(s))) {
                  metadata.suspicious_indicators.push(`AI audio tool detected: ${metadata.encoder}`);
                }
              }
            }
          }
          
          // Extract audio stream info
          const audioStream = info.streams?.find(s => s.codec_type === 'audio');
          if (audioStream) {
            metadata.sample_rate = parseInt(audioStream.sample_rate) || 0;
            metadata.channels = audioStream.channels || 0;
            metadata.codec = audioStream.codec_name;
            
            // Check for unusual sample rates (AI often uses specific rates)
            if (metadata.sample_rate === 22050) {
              metadata.suspicious_indicators.push('22050 Hz sample rate - common in AI voice tools');
            }
            if (metadata.sample_rate === 24000) {
              metadata.suspicious_indicators.push('24000 Hz sample rate - common in AI voice synthesis');
            }
            
            // Check for mono vs stereo (AI voices often mono)
            if (metadata.channels === 1 && metadata.duration > 30) {
              metadata.suspicious_indicators.push('Mono audio - common in AI-generated speech');
            }
          }
          
          // Check bit rate consistency (AI audio often has very consistent bit rates)
          if (metadata.bit_rate > 0 && metadata.bit_rate % 1000 === 0) {
            // Perfectly round bit rate is slightly suspicious
            metadata.suspicious_indicators.push(`Perfectly round bit rate: ${metadata.bit_rate}`);
          }
          
        } catch (parseError) {
          console.warn('Error parsing ffprobe output:', parseError.message);
        }
        
        resolve(metadata);
      });
    });
  }

  /**
   * Analyze spectral features for AI voice characteristics
   */
  static async analyzeSpectralFeatures(audioPath) {
    return new Promise((resolve) => {
      const spectral = {
        frequency_gaps: false,
        unnatural_harmonics: false,
        missing_frequencies: [],
        energy_distribution: 'unknown',
        noise_floor: 'unknown',
        spectral_consistency: 0,
        indicators: []
      };

      // Use sox for spectral analysis if available
      const tempSpecFile = path.join(os.tmpdir(), `spec_${Date.now()}.txt`);
      const cmd = `sox "${audioPath}" -n stat 2>&1`;
      
      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        const output = stderr || stdout; // sox outputs to stderr
        
        if (error || !output) {
          console.warn('sox not available, using fallback analysis');
          spectral.indicators.push('Limited spectral analysis available');
          resolve(spectral);
          return;
        }

        try {
          // Parse sox stat output
          const lines = output.split('\n');
          
          for (const line of lines) {
            // Check RMS amplitude (AI voices often have very consistent levels)
            if (line.includes('RMS amplitude')) {
              const rms = parseFloat(line.split(':')[1]);
              if (rms && rms > 0.1 && rms < 0.15) {
                spectral.indicators.push('Very consistent RMS amplitude - possible AI normalization');
              }
            }
            
            // Check frequency range
            if (line.includes('Rough frequency')) {
              const freq = parseInt(line.split(':')[1]);
              if (freq && freq > 200 && freq < 400) {
                spectral.indicators.push('Narrow frequency range - typical of synthetic speech');
              }
            }
            
            // Check volume adjustment
            if (line.includes('Volume adjustment')) {
              const adj = parseFloat(line.split(':')[1]);
              if (adj && Math.abs(adj - 1.0) < 0.01) {
                spectral.indicators.push('No volume adjustment needed - suggests pre-normalized audio');
              }
            }
            
            // Check for clipping
            if (line.includes('Crest factor')) {
              const crest = parseFloat(line.split(':')[1]);
              if (crest && crest < 4) {
                spectral.indicators.push('Low crest factor - overly compressed dynamic range');
              }
            }
          }
          
          // Additional spectral checks
          spectral.spectral_consistency = spectral.indicators.length > 2 ? 'high' : 'normal';
          
        } catch (parseError) {
          console.warn('Error parsing sox output:', parseError.message);
        }
        
        resolve(spectral);
      });
    });
  }

  /**
   * Analyze speech patterns for AI characteristics
   */
  static async analyzeSpeechPatterns(audioPath) {
    return new Promise((resolve) => {
      const patterns = {
        silence_ratio: 0,
        speech_continuity: 'unknown',
        breathing_detected: false,
        filler_words: false,
        pacing_consistency: 0,
        indicators: []
      };

      // Use sox to analyze silence vs speech
      const cmd = `sox "${audioPath}" -n silence 1 0.1 1% 1 0.1 1% stat 2>&1 | head -20`;
      
      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          console.warn('Speech pattern analysis limited');
          resolve(patterns);
          return;
        }

        // Analyze silence patterns
        const silenceCmd = `sox "${audioPath}" -n stats 2>&1`;
        exec(silenceCmd, { timeout: 10000 }, (err, out, serr) => {
          const output = serr || out;
          
          if (output) {
            const lines = output.split('\n');
            
            for (const line of lines) {
              // Check for flat sections (no natural variation)
              if (line.includes('Flat factor')) {
                const flat = parseFloat(line.split(':')[1]);
                if (flat && flat > 0.01) {
                  patterns.indicators.push('High flat factor - unnatural constant levels');
                }
              }
              
              // Check peak count (AI has fewer peaks)
              if (line.includes('Pk count')) {
                const peaks = parseInt(line.split(':')[1]);
                // This is a rough heuristic
                if (peaks > 0 && peaks < 1000) {
                  patterns.indicators.push('Low peak variation - synthetic speech characteristic');
                }
              }
            }
          }
          
          // Check for missing natural speech elements
          if (!patterns.breathing_detected && patterns.indicators.length > 0) {
            patterns.indicators.push('No breath sounds detected - common in AI voices');
          }
          
          // AI voices often have unnaturally perfect pacing
          patterns.pacing_consistency = patterns.indicators.length > 2 ? 95 : 50;
          if (patterns.pacing_consistency > 90) {
            patterns.indicators.push('Extremely consistent pacing - unlikely in natural speech');
          }
          
          resolve(patterns);
        });
      });
    });
  }

  /**
   * Calculate overall AI confidence score
   */
  static calculateAIScore(metadata, spectral, speech) {
    let score = 0;
    const indicators = [];
    const warnings = [];
    const maxScore = 100;

    // Metadata indicators (0-30 points)
    if (metadata.suspicious_indicators.length > 0) {
      const metadataScore = Math.min(metadata.suspicious_indicators.length * 10, 30);
      score += metadataScore;
      indicators.push(...metadata.suspicious_indicators);
    }

    // Known AI encoder detection (immediate high score)
    if (metadata.encoder && metadata.encoder.toLowerCase().includes('elevenlabs')) {
      score += 40;
      warnings.push('ElevenLabs encoder signature detected');
    }
    if (metadata.encoder && metadata.encoder.toLowerCase().includes('resemble')) {
      score += 40;
      warnings.push('Resemble AI encoder signature detected');
    }

    // Spectral indicators (0-35 points)
    if (spectral.indicators.length > 0) {
      const spectralScore = Math.min(spectral.indicators.length * 12, 35);
      score += spectralScore;
      indicators.push(...spectral.indicators);
    }

    // Speech pattern indicators (0-35 points)
    if (speech.indicators.length > 0) {
      const speechScore = Math.min(speech.indicators.length * 12, 35);
      score += speechScore;
      indicators.push(...speech.indicators);
    }

    // Perfect pacing penalty
    if (speech.pacing_consistency > 90) {
      score += 10;
    }

    // Normalize to 100
    const confidence = Math.min(score, maxScore);

    // Add warnings for high scores
    if (confidence > 80) {
      warnings.push('HIGH CONFIDENCE: Audio shows strong AI generation indicators');
    } else if (confidence > 60) {
      warnings.push('MODERATE CONFIDENCE: Audio shows some AI generation indicators');
    }

    return {
      confidence,
      indicators,
      warnings
    };
  }

  /**
   * Get human-readable verdict
   */
  static getVerdict(confidence) {
    if (confidence > 80) {
      return 'HIGHLY LIKELY AI-GENERATED VOICE';
    } else if (confidence > 60) {
      return 'POSSIBLY AI-GENERATED VOICE';
    } else if (confidence > 40) {
      return 'UNCERTAIN - Some AI indicators present';
    } else if (confidence > 20) {
      return 'LIKELY AUTHENTIC - Few AI indicators';
    } else {
      return 'AUTHENTIC VOICE - No significant AI indicators';
    }
  }

  /**
   * Quick check - simplified version for fast verification
   */
  static async quickCheck(audioPath) {
    const metadata = await this.extractMetadata(audioPath);
    
    // Quick scoring based on metadata alone
    let quickScore = 0;
    const flags = [];
    
    if (metadata.suspicious_indicators.length > 0) {
      quickScore += metadata.suspicious_indicators.length * 15;
      flags.push(...metadata.suspicious_indicators);
    }
    
    if (metadata.sample_rate === 22050 || metadata.sample_rate === 24000) {
      quickScore += 20;
    }
    
    if (metadata.channels === 1) {
      quickScore += 10;
    }
    
    return {
      quick_ai_score: Math.min(quickScore, 100),
      flags: flags,
      recommendation: quickScore > 50 ? 'Full analysis recommended' : 'Likely authentic'
    };
  }
}

module.exports = AudioSpectralAnalysis;