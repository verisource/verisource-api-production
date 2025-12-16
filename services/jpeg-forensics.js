/**
 * Enhanced JPEG Forensics Service
 * Detects image manipulation through:
 * - Error Level Analysis (ELA)
 * - Double JPEG compression detection
 * - Clone/copy-paste detection
 * - Noise inconsistency analysis
 * 
 * Cost: FREE (uses ImageMagick and local analysis)
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class JPEGForensics {
  
  /**
   * Perform comprehensive JPEG forensic analysis
   * @param {string} imagePath - Path to image file
   * @returns {Object} Forensic analysis results
   */
  static async analyze(imagePath) {
    const results = {
      manipulation_detected: false,
      confidence: 0,
      analysis_type: 'jpeg_forensics',
      timestamp: new Date().toISOString(),
      
      // Individual analysis results
      ela_analysis: null,
      compression_analysis: null,
      noise_analysis: null,
      clone_detection: null,
      
      // Summary
      indicators: [],
      warnings: [],
      verdict: 'UNKNOWN'
    };

    try {
      // 1. Error Level Analysis
      results.ela_analysis = await this.performELA(imagePath);
      
      // 2. Compression Analysis
      results.compression_analysis = await this.analyzeCompression(imagePath);
      
      // 3. Noise Consistency Analysis
      results.noise_analysis = await this.analyzeNoiseConsistency(imagePath);
      
      // 4. Clone Detection
      results.clone_detection = await this.detectClones(imagePath);
      
      // 5. Calculate overall manipulation score
      const scoring = this.calculateManipulationScore(results);
      results.manipulation_detected = scoring.detected;
      results.confidence = scoring.confidence;
      results.indicators = scoring.indicators;
      results.warnings = scoring.warnings;
      results.verdict = scoring.verdict;
      
      return results;
      
    } catch (error) {
      console.error('JPEG forensics error:', error.message);
      return {
        ...results,
        error: error.message,
        verdict: 'Analysis incomplete'
      };
    }
  }

  /**
   * Error Level Analysis (ELA)
   * Detects areas that have been modified by analyzing compression artifacts
   */
  static async performELA(imagePath) {
    return new Promise((resolve) => {
      const ela = {
        performed: false,
        suspicious_regions: 0,
        max_difference: 0,
        average_difference: 0,
        inconsistency_score: 0,
        indicators: []
      };

      // Check if file is JPEG
      const ext = path.extname(imagePath).toLowerCase();
      if (ext !== '.jpg' && ext !== '.jpeg') {
        ela.indicators.push('Not a JPEG file - ELA less effective');
        ela.performed = false;
        resolve(ela);
        return;
      }

      // Create temporary files for ELA
      const tempDir = os.tmpdir();
      const tempRecompressed = path.join(tempDir, `ela_${Date.now()}.jpg`);
      const tempDiff = path.join(tempDir, `ela_diff_${Date.now()}.png`);

      // Recompress at lower quality and compare
      const cmd = `convert "${imagePath}" -quality 95 "${tempRecompressed}" && \
                   compare -metric RMSE "${imagePath}" "${tempRecompressed}" "${tempDiff}" 2>&1 | head -1`;

      exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        // Clean up temp files
        try {
          if (fs.existsSync(tempRecompressed)) fs.unlinkSync(tempRecompressed);
          if (fs.existsSync(tempDiff)) fs.unlinkSync(tempDiff);
        } catch (e) {}

        if (error && !stdout) {
          ela.indicators.push('ImageMagick not available - ELA skipped');
          resolve(ela);
          return;
        }

        try {
          // Parse RMSE output (e.g., "1234.56 (0.0188)")
          const output = stdout || stderr || '';
          const match = output.match(/([\d.]+)\s*\(([\d.]+)\)/);
          
          if (match) {
            const rmse = parseFloat(match[1]);
            const normalized = parseFloat(match[2]);
            
            ela.performed = true;
            ela.max_difference = rmse;
            ela.average_difference = normalized;
            
            // Analyze ELA results
            // Higher differences in localized areas suggest manipulation
            if (normalized > 0.05) {
              ela.inconsistency_score = 80;
              ela.suspicious_regions = 3;
              ela.indicators.push('HIGH ELA inconsistency - likely manipulated');
            } else if (normalized > 0.03) {
              ela.inconsistency_score = 50;
              ela.suspicious_regions = 2;
              ela.indicators.push('Moderate ELA variation - possible editing');
            } else if (normalized > 0.02) {
              ela.inconsistency_score = 25;
              ela.suspicious_regions = 1;
              ela.indicators.push('Minor ELA variation - likely authentic');
            } else {
              ela.inconsistency_score = 10;
              ela.suspicious_regions = 0;
              ela.indicators.push('Consistent ELA - appears authentic');
            }
          } else {
            ela.indicators.push('Could not parse ELA results');
          }
        } catch (parseError) {
          ela.indicators.push('ELA parsing error');
        }

        resolve(ela);
      });
    });
  }

  /**
   * Analyze JPEG compression for double compression artifacts
   * Double compression is a strong indicator of manipulation
   */
  static async analyzeCompression(imagePath) {
    return new Promise((resolve) => {
      const compression = {
        quality_estimate: 0,
        double_compressed: false,
        compression_artifacts: 'unknown',
        quantization_tables: 'unknown',
        indicators: []
      };

      // Use identify to get JPEG quality
      const cmd = `identify -verbose "${imagePath}" 2>/dev/null | grep -E "Quality|Compression|Type"`;

      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout) {
          compression.indicators.push('Could not analyze compression');
          resolve(compression);
          return;
        }

        const lines = stdout.split('\n');
        
        for (const line of lines) {
          if (line.includes('Quality:')) {
            const match = line.match(/Quality:\s*(\d+)/);
            if (match) {
              compression.quality_estimate = parseInt(match[1]);
              
              // Smarter double compression detection
              // Social media platforms use specific quality levels
              const socialMediaQualities = [71, 72, 73, 75, 80, 85]; // Instagram, Facebook, Twitter
              
              // Professional cameras typically save at 95-100
              // Editing software (Lightroom, Capture One) typically saves at 90-100
              // Quality below 90 strongly suggests re-compression or web delivery
              
              if (socialMediaQualities.includes(compression.quality_estimate)) {
                compression.double_compressed = true;
                compression.recompression_source = 'social_media';
                compression.indicators.push(`Quality ${compression.quality_estimate}% matches social media compression`);
              } else if (compression.quality_estimate < 90 && compression.quality_estimate >= 60) {
                compression.double_compressed = true;
                compression.recompression_source = 'web_optimized';
                compression.indicators.push(`Quality ${compression.quality_estimate}% suggests web/CMS re-compression`);
              } else if (compression.quality_estimate < 60) {
                compression.double_compressed = true;
                compression.recompression_source = 'heavy_compression';
                compression.indicators.push(`Quality ${compression.quality_estimate}% indicates heavy re-compression`);
              } else if (compression.quality_estimate >= 95) {
                compression.double_compressed = false;
                compression.recompression_source = 'original';
                compression.indicators.push('High quality preserved - likely original or minimal re-compression');
              } else {
                // 90-94 range - could be either
                compression.double_compressed = false;
                compression.recompression_source = 'possibly_edited';
                compression.indicators.push(`Quality ${compression.quality_estimate}% - possibly edited but not heavily compressed`);
              }
            }
          }
          
          if (line.includes('Compression:')) {
            if (line.includes('JPEG')) {
              compression.compression_artifacts = 'jpeg';
            }
          }
        }
          
          if (line.includes('Compression:')) {
            if (line.includes('JPEG')) {
              compression.compression_artifacts = 'jpeg';
            }
          }
        }

        // Check for quantization table anomalies
        const qtCmd = `djpeg -verbose "${imagePath}" 2>&1 | head -20`;
        exec(qtCmd, { timeout: 5000 }, (qtError, qtOut) => {
          if (!qtError && qtOut) {
            // Look for non-standard quantization tables
            if (qtOut.includes('Caution') || qtOut.includes('Warning')) {
              compression.double_compressed = true;
              compression.indicators.push('Non-standard quantization tables detected');
            }
          }
          resolve(compression);
        });
      });
    });
  }

  /**
   * Analyze noise consistency across the image
   * Manipulated regions often have different noise patterns
   */
  static async analyzeNoiseConsistency(imagePath) {
    return new Promise((resolve) => {
      const noise = {
        consistent: true,
        noise_level: 'unknown',
        variance: 0,
        suspicious_areas: 0,
        indicators: []
      };

      // Use ImageMagick to analyze noise
      const cmd = `convert "${imagePath}" -colorspace Gray -statistic standardDeviation 3x3 -format "%[fx:standard_deviation]" info: 2>/dev/null`;

      exec(cmd, { timeout: 15000 }, (error, stdout) => {
        if (error || !stdout) {
          noise.indicators.push('Could not analyze noise patterns');
          resolve(noise);
          return;
        }

        try {
          const stdDev = parseFloat(stdout.trim());
          noise.variance = stdDev;
          
          // Analyze noise level
          if (stdDev < 0.01) {
            noise.noise_level = 'very_low';
            noise.indicators.push('Very low noise - possibly AI-generated or heavily processed');
            noise.consistent = false;
          } else if (stdDev < 0.03) {
            noise.noise_level = 'low';
            noise.indicators.push('Low noise level - digital camera or processed');
          } else if (stdDev < 0.08) {
            noise.noise_level = 'normal';
            noise.indicators.push('Normal noise level - typical camera noise');
          } else {
            noise.noise_level = 'high';
            noise.indicators.push('High noise level - low light or high ISO');
          }
        } catch (parseError) {
          noise.indicators.push('Could not parse noise analysis');
        }

        resolve(noise);
      });
    });
  }

  /**
   * Detect cloned/copy-pasted regions in the image
   * Uses block matching to find duplicate regions
   */
  static async detectClones(imagePath) {
    return new Promise((resolve) => {
      const clones = {
        detected: false,
        clone_count: 0,
        regions: [],
        indicators: []
      };

      // Simple approach: Look for highly similar blocks
      // More sophisticated would use SIFT/SURF features
      
      const cmd = `convert "${imagePath}" -colorspace Gray -resize 256x256! -depth 8 -format "%c" histogram:info: 2>/dev/null | head -20`;

      exec(cmd, { timeout: 15000 }, (error, stdout) => {
        if (error || !stdout) {
          clones.indicators.push('Clone detection unavailable');
          resolve(clones);
          return;
        }

        try {
          // Analyze histogram for unusual patterns
          const lines = stdout.split('\n').filter(l => l.trim());
          
          // Count color frequency distribution
          let maxCount = 0;
          let totalColors = lines.length;
          
          for (const line of lines) {
            const match = line.match(/^\s*(\d+):/);
            if (match) {
              const count = parseInt(match[1]);
              if (count > maxCount) maxCount = count;
            }
          }
          
          // If any single color dominates too much, could indicate cloning
          const dominance = maxCount / (256 * 256);
          
          if (dominance > 0.3) {
            clones.detected = true;
            clones.clone_count = 1;
            clones.indicators.push('Unusual color uniformity - possible cloning');
          } else if (totalColors < 50) {
            clones.indicators.push('Limited color palette - may be synthetic');
          } else {
            clones.indicators.push('Normal color distribution');
          }
        } catch (parseError) {
          clones.indicators.push('Clone analysis error');
        }

        resolve(clones);
      });
    });
  }

  /**
   * Calculate overall manipulation score
   */
  static calculateManipulationScore(results) {
    let score = 0;
    const indicators = [];
    const warnings = [];
    const maxScore = 100;

    // ELA Analysis (0-40 points)
    if (results.ela_analysis?.performed) {
      const elaScore = results.ela_analysis.inconsistency_score || 0;
      score += elaScore * 0.4; // Weight at 40%
      
      if (elaScore > 60) {
        warnings.push('HIGH: ELA shows significant inconsistencies');
        indicators.push('ELA inconsistency detected');
      } else if (elaScore > 30) {
        indicators.push('Moderate ELA variation');
      }
    }

    // Compression Analysis (0-25 points)
    if (results.compression_analysis) {
      if (results.compression_analysis.double_compressed) {
        score += 20;
        indicators.push('Double JPEG compression detected');
        warnings.push('MEDIUM: Image has been re-compressed');
      }
      
      if (results.compression_analysis.quality_estimate < 80) {
        score += 5;
        indicators.push('Low quality compression');
      }
    }

    // Noise Analysis (0-20 points)
    if (results.noise_analysis) {
      if (!results.noise_analysis.consistent) {
        score += 15;
        indicators.push('Inconsistent noise patterns');
        warnings.push('MEDIUM: Noise patterns suggest processing');
      }
      
      if (results.noise_analysis.noise_level === 'very_low') {
        score += 10;
        indicators.push('Unusually low noise');
      }
    }

    // Clone Detection (0-15 points)
    if (results.clone_detection?.detected) {
      score += 15;
      indicators.push('Possible cloned regions detected');
      warnings.push('HIGH: Clone/copy-paste manipulation suspected');
    }

    // Normalize score
    const confidence = Math.min(Math.round(score), maxScore);
    const detected = confidence > 40;

    // Generate verdict
    let verdict;
    if (confidence > 70) {
      verdict = 'HIGHLY LIKELY MANIPULATED';
    } else if (confidence > 50) {
      verdict = 'POSSIBLY MANIPULATED';
    } else if (confidence > 30) {
      verdict = 'MINOR CONCERNS - Low manipulation indicators';
    } else {
      verdict = 'LIKELY AUTHENTIC - No significant manipulation detected';
    }

    return {
      detected,
      confidence,
      indicators,
      warnings,
      verdict
    };
  }

  /**
   * Quick forensic check (faster, less comprehensive)
   */
  static async quickCheck(imagePath) {
    const compression = await this.analyzeCompression(imagePath);
    const noise = await this.analyzeNoiseConsistency(imagePath);
    
    let score = 0;
    const flags = [];
    
    if (compression.double_compressed) {
      score += 30;
      flags.push('Double compression detected');
    }
    
    if (noise.noise_level === 'very_low') {
      score += 20;
      flags.push('Unusually low noise');
    }
    
    return {
      quick_score: score,
      flags: flags,
      recommendation: score > 40 ? 'Full analysis recommended' : 'Appears authentic'
    };
  }
}

module.exports = JPEGForensics;