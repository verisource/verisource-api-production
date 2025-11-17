/**
 * Enhanced AI Image Detector with JPEG Forensics Integration
 * Combines multiple detection methods for higher accuracy
 * 
 * Detection Methods:
 * 1. Statistical Analysis (existing)
 * 2. Metadata Analysis (existing)
 * 3. JPEG Forensics (NEW - ELA, compression, noise, clones)
 * 4. Portrait Mode Detection - DISABLED (using external EXIF-based detection)
 * 
 * Target: 92-95% accuracy (up from 85%)
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const JPEGForensics = require('./jpeg-forensics');

class EnhancedAIDetector {
  
  /**
   * Comprehensive AI detection with forensics
   * @param {string} imagePath - Path to image file
   * @param {Object} options - Detection options
   * @returns {Object} Detection results with confidence scoring
   */
  static async detect(imagePath, options = {}) {
    const startTime = Date.now();
    
    const results = {
      likely_ai_generated: false,
      ai_confidence: 0,
      manipulation_detected: false,
      manipulation_confidence: 0,
      
      // Combined verdict
      overall_verdict: 'UNKNOWN',
      overall_confidence: 0,
      
      // Individual analyses
      statistical_analysis: null,
      metadata_analysis: null,
      jpeg_forensics: null,
      
      // Summary
      indicators: [],
      warnings: [],
      recommendations: [],
      
      // Performance
      analysis_time_ms: 0,
      timestamp: new Date().toISOString()
    };

    try {
      // Run all analyses in parallel for speed
      const [
        statsResult,
        metaResult,
        forensicsResult
      ] = await Promise.all([
        this.runStatisticalAnalysis(imagePath),
        this.runMetadataAnalysis(imagePath),
        JPEGForensics.analyze(imagePath)
      ]);

      results.statistical_analysis = statsResult;
      results.metadata_analysis = metaResult;
      results.jpeg_forensics = forensicsResult;

      // Calculate ensemble score
      const scoring = this.calculateEnsembleScore(results);
      
      results.likely_ai_generated = scoring.ai_generated;
      results.ai_confidence = scoring.ai_confidence;
      results.manipulation_detected = scoring.manipulation_detected;
      results.manipulation_confidence = scoring.manipulation_confidence;
      results.overall_verdict = scoring.verdict;
      results.overall_confidence = scoring.overall_confidence;
      results.indicators = scoring.indicators;
      results.warnings = scoring.warnings;
      results.recommendations = scoring.recommendations;

      results.analysis_time_ms = Date.now() - startTime;
      
      return results;

    } catch (error) {
      console.error('Enhanced detection error:', error.message);
      results.error = error.message;
      results.analysis_time_ms = Date.now() - startTime;
      return results;
    }
  }

  /**
   * Statistical analysis for AI-generated patterns
   */
  static async runStatisticalAnalysis(imagePath) {
    return new Promise((resolve) => {
      const stats = {
        suspicion_score: 0,
        indicators: [],
        performed: true
      };

      // Analyze color distribution and patterns
      const cmd = `convert "${imagePath}" -colorspace HSL -separate -format "%[fx:mean] %[fx:standard_deviation]\\n" info: 2>/dev/null`;

      exec(cmd, { timeout: 15000 }, (error, stdout) => {
        if (error || !stdout) {
          stats.performed = false;
          stats.indicators.push('Statistical analysis unavailable');
          resolve(stats);
          return;
        }

        try {
          const lines = stdout.trim().split('\n');
          const values = lines.map(l => l.split(' ').map(parseFloat));
          
          // Check for AI-typical patterns
          let score = 0;
          
          // Very uniform saturation (AI tends to have consistent saturation)
          if (values[1] && values[1][1] < 0.15) {
            score += 20;
            stats.indicators.push('Unusually uniform saturation');
          }
          
          // Very low variance in luminance (AI images often too smooth)
          if (values[2] && values[2][1] < 0.1) {
            score += 15;
            stats.indicators.push('Low luminance variance - possibly synthetic');
          }
          
          // Perfect color balance (natural photos rarely perfect)
          const hue = values[0] ? values[0][0] : 0.5;
          if (Math.abs(hue - 0.5) < 0.05) {
            score += 10;
            stats.indicators.push('Suspiciously balanced color distribution');
          }
          
          stats.suspicion_score = Math.min(score, 100);
          
        } catch (parseError) {
          stats.indicators.push('Statistical parsing error');
        }
        
        resolve(stats);
      });
    });
  }

  /**
   * Metadata analysis for AI generation signatures
   */
  static async runMetadataAnalysis(imagePath) {
    return new Promise((resolve) => {
      const meta = {
        has_exif: false,
        has_camera_info: false,
        has_ai_signatures: false,
        suspicion_score: 0,
        indicators: [],
        details: {}
      };

      const cmd = `identify -verbose "${imagePath}" 2>/dev/null | head -100`;

      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout) {
          meta.indicators.push('Metadata analysis unavailable');
          resolve(meta);
          return;
        }

        const output = stdout.toLowerCase();
        
        // Check for EXIF data
        if (output.includes('exif:')) {
          meta.has_exif = true;
          meta.details.exif_present = true;
        } else {
          meta.suspicion_score += 15;
          meta.indicators.push('No EXIF data - common in AI images');
        }
        
        // Check for camera info
        if (output.includes('make:') || output.includes('model:') || output.includes('camera')) {
          meta.has_camera_info = true;
          meta.details.camera_info = true;
        } else {
          meta.suspicion_score += 20;
          meta.indicators.push('No camera information');
        }
        
        // Check for known AI signatures
        const aiSignatures = [
          'stable diffusion',
          'midjourney',
          'dall-e',
          'dalle',
          'openai',
          'automatic1111',
          'comfyui',
          'invokeai',
          'dream by wombo',
          'ai generated',
          'created with ai'
        ];
        
        for (const sig of aiSignatures) {
          if (output.includes(sig)) {
            meta.has_ai_signatures = true;
            meta.suspicion_score += 60;
            meta.indicators.push(`AI signature found: ${sig}`);
            break;
          }
        }
        
        // Check software field
        if (output.includes('software:')) {
          const softwareMatch = output.match(/software:\s*([^\n]+)/);
          if (softwareMatch) {
            const software = softwareMatch[1].trim();
            meta.details.software = software;
            
            // Known AI tools
            if (software.includes('automatic') || software.includes('diffusion') || software.includes('midjourney')) {
              meta.has_ai_signatures = true;
              meta.suspicion_score += 50;
              meta.indicators.push(`AI generation software: ${software}`);
            }
          }
        }
        
        // Perfect dimensions (AI often generates standard sizes)
        const dimMatch = stdout.match(/(\d+)x(\d+)/);
        if (dimMatch) {
          const width = parseInt(dimMatch[1]);
          const height = parseInt(dimMatch[2]);
          meta.details.dimensions = { width, height };
          
          // Common AI dimensions
          const aiDimensions = [
            [512, 512], [768, 768], [1024, 1024],
            [512, 768], [768, 512],
            [1024, 768], [768, 1024],
            [1920, 1080], [1080, 1920]
          ];
          
          for (const [w, h] of aiDimensions) {
            if (width === w && height === h) {
              meta.suspicion_score += 10;
              meta.indicators.push(`Common AI generation dimensions: ${width}x${height}`);
              break;
            }
          }
        }
        
        meta.suspicion_score = Math.min(meta.suspicion_score, 100);
        resolve(meta);
      });
    });
  }

  /**
   * Calculate ensemble score from all analyses
   * NOTE: Portrait mode adjustment disabled - using external EXIF-based detection
   */
  static calculateEnsembleScore(results) {
    let aiScore = 0;
    let manipulationScore = 0;
    const indicators = [];
    const warnings = [];
    const recommendations = [];
    
    // Weight factors (adjusted since portrait mode is external)
    const weights = {
      statistical: 0.30,   // Increased from 0.25
      metadata: 0.35,      // Increased from 0.30
      forensics: 0.35      // Same
    };

    // Statistical Analysis (30% weight)
    if (results.statistical_analysis?.performed) {
      const statScore = results.statistical_analysis.suspicion_score || 0;
      aiScore += statScore * weights.statistical;
      indicators.push(...(results.statistical_analysis.indicators || []));
      
      if (statScore > 50) {
        warnings.push('Statistical patterns suggest AI generation');
      }
    }

    // Metadata Analysis (35% weight)
    if (results.metadata_analysis) {
      const metaScore = results.metadata_analysis.suspicion_score || 0;
      aiScore += metaScore * weights.metadata;
      indicators.push(...(results.metadata_analysis.indicators || []));
      
      if (results.metadata_analysis.has_ai_signatures) {
        aiScore += 30; // Strong indicator
        warnings.push('AI generation signatures found in metadata');
      }
      
      if (!results.metadata_analysis.has_exif && !results.metadata_analysis.has_camera_info) {
        warnings.push('Missing camera metadata - common in AI-generated images');
      }
    }

    // JPEG Forensics (35% weight for manipulation detection)
    if (results.jpeg_forensics) {
      const forensicScore = results.jpeg_forensics.confidence || 0;
      manipulationScore = forensicScore;
      
      // Add forensic indicators
      indicators.push(...(results.jpeg_forensics.indicators || []));
      warnings.push(...(results.jpeg_forensics.warnings || []));
      
      // If manipulation detected, it could indicate either:
      // 1. Human manipulation (Photoshop, etc.)
      // 2. AI generation with post-processing
      if (results.jpeg_forensics.manipulation_detected) {
        aiScore += 15; // Slight boost to AI score
        recommendations.push('Image shows signs of manipulation - verify source');
      }
    }

    // NOTE: Portrait Mode Adjustment DISABLED
    // External EXIF-based PortraitModeDetection will adjust scores after this returns

    // Normalize scores
    aiScore = Math.max(0, Math.min(100, Math.round(aiScore)));
    manipulationScore = Math.max(0, Math.min(100, Math.round(manipulationScore)));

    // Determine verdicts
    const aiGenerated = aiScore >= 60;
    const manipulated = manipulationScore >= 50;

    // Calculate overall confidence
    const overallConfidence = Math.round((aiScore + manipulationScore) / 2);

    // Generate verdict
    let verdict;
    if (aiGenerated && manipulated) {
      verdict = 'AI-GENERATED AND MANIPULATED';
      warnings.push('HIGH RISK: Content shows both AI generation and manipulation');
    } else if (aiGenerated) {
      verdict = 'LIKELY AI-GENERATED';
      warnings.push('Content appears to be AI-generated');
    } else if (manipulated) {
      verdict = 'LIKELY MANIPULATED';
      warnings.push('Content shows signs of manipulation');
    } else if (aiScore > 40 || manipulationScore > 30) {
      verdict = 'SUSPICIOUS - Further analysis recommended';
      recommendations.push('Some concerning indicators - manual review advised');
    } else {
      verdict = 'LIKELY AUTHENTIC';
      recommendations.push('No significant AI generation or manipulation detected');
    }

    // Add general recommendations
    if (aiScore > 30 && aiScore < 60) {
      recommendations.push('Consider additional verification methods');
    }
    
    if (!results.metadata_analysis?.has_camera_info) {
      recommendations.push('Request original file with full metadata for verification');
    }

    return {
      ai_generated: aiGenerated,
      ai_confidence: aiScore,
      manipulation_detected: manipulated,
      manipulation_confidence: manipulationScore,
      overall_confidence: overallConfidence,
      verdict: verdict,
      indicators: [...new Set(indicators)], // Remove duplicates
      warnings: [...new Set(warnings)],
      recommendations: [...new Set(recommendations)]
    };
  }

  /**
   * Quick check (faster, less comprehensive)
   */
  static async quickCheck(imagePath) {
    const [metaResult, forensicQuick] = await Promise.all([
      this.runMetadataAnalysis(imagePath),
      JPEGForensics.quickCheck(imagePath)
    ]);

    let score = 0;
    const flags = [];

    if (metaResult.has_ai_signatures) {
      score += 60;
      flags.push('AI signatures in metadata');
    }

    if (!metaResult.has_exif) {
      score += 20;
      flags.push('No EXIF data');
    }

    score += forensicQuick.quick_score * 0.3;
    flags.push(...forensicQuick.flags);

    return {
      quick_score: Math.min(score, 100),
      flags: flags,
      recommendation: score > 50 ? 'Full analysis strongly recommended' : 'Appears authentic'
    };
  }
}

module.exports = EnhancedAIDetector;