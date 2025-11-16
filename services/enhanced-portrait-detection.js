/**
 * Enhanced Portrait Mode Detection Service
 * Prevents false positives from computational photography
 * Detects iPhone, Samsung, Google Pixel portrait modes
 */

class EnhancedPortraitModeDetection {
  
  /**
   * Main detection function - comprehensive portrait mode analysis
   * @param {Object} exifData - EXIF metadata from image
   * @param {Buffer} imageBuffer - Raw image data for analysis
   * @returns {Object} Detection results with confidence
   */
  static detectPortraitMode(exifData, imageBuffer = null) {
    const indicators = [];
    const warnings = [];
    let confidenceScore = 0;
    let maxPossibleScore = 0;

    // ========== EXIF-BASED DETECTION ==========
    
    // 1. Check for depth/portrait-specific EXIF tags
    const depthIndicators = this.checkDepthIndicators(exifData);
    indicators.push(...depthIndicators.indicators);
    confidenceScore += depthIndicators.score;
    maxPossibleScore += depthIndicators.maxScore;

    // 2. Check camera model known for portrait mode
    const cameraCheck = this.checkPortraitCapableCamera(exifData);
    indicators.push(...cameraCheck.indicators);
    confidenceScore += cameraCheck.score;
    maxPossibleScore += cameraCheck.maxScore;

    // 3. Check for computational photography markers
    const computationalCheck = this.checkComputationalMarkers(exifData);
    indicators.push(...computationalCheck.indicators);
    confidenceScore += computationalCheck.score;
    maxPossibleScore += computationalCheck.maxScore;

    // 4. Check lens and aperture characteristics
    const lensCheck = this.checkLensCharacteristics(exifData);
    indicators.push(...lensCheck.indicators);
    confidenceScore += lensCheck.score;
    maxPossibleScore += lensCheck.maxScore;

    // 5. Check for HDR/Smart HDR indicators
    const hdrCheck = this.checkHDRIndicators(exifData);
    indicators.push(...hdrCheck.indicators);
    confidenceScore += hdrCheck.score;
    maxPossibleScore += hdrCheck.maxScore;

    // Calculate final confidence
    const confidence = maxPossibleScore > 0 
      ? Math.round((confidenceScore / maxPossibleScore) * 100)
      : 0;

    const isPortraitMode = confidence >= 60; // 60% threshold
    const isComputationalPhotography = confidence >= 40; // Broader category

    return {
      isPortraitMode: isPortraitMode,
      isComputationalPhotography: isComputationalPhotography,
      confidence: confidence,
      confidenceScore: confidenceScore,
      maxPossibleScore: maxPossibleScore,
      indicators: indicators,
      warnings: warnings,
      
      // Detailed breakdown
      analysis: {
        depth_data_present: depthIndicators.score > 0,
        portrait_capable_camera: cameraCheck.score > 0,
        computational_markers: computationalCheck.score > 0,
        synthetic_bokeh_likely: this.isSyntheticBokehLikely(exifData),
        hdr_processing: hdrCheck.score > 0
      },
      
      // Recommendation for AI detection adjustment
      ai_adjustment: this.calculateAIAdjustment(confidence, indicators)
    };
  }

  /**
   * Check for depth-related EXIF indicators
   */
  static checkDepthIndicators(exifData) {
    const indicators = [];
    let score = 0;
    const maxScore = 40; // High weight - strong indicator

    if (!exifData) return { indicators, score, maxScore };

    // Apple depth data
    if (exifData.DepthData || exifData.depthData) {
      indicators.push('Apple Depth Data present');
      score += 15;
    }

    // Depth quality indicators
    if (exifData.DepthQuality || exifData.depthQuality) {
      indicators.push(`Depth Quality: ${exifData.DepthQuality || exifData.depthQuality}`);
      score += 10;
    }

    // Semantic style (Portrait, etc.)
    if (exifData.SemanticStyle) {
      indicators.push(`Semantic Style: ${exifData.SemanticStyle}`);
      if (exifData.SemanticStyle.toLowerCase().includes('portrait')) {
        score += 15;
      } else {
        score += 5;
      }
    }

    // Apple Depth Type
    if (exifData['42036'] || exifData.LensModel?.includes('depth')) {
      indicators.push('Depth capture lens detected');
      score += 10;
    }

    // MediaGroupUUID (indicates multi-frame capture)
    if (exifData.MediaGroupUUID) {
      indicators.push('Multi-frame capture detected');
      score += 8;
    }

    // Burst/HDR frame indicators
    if (exifData.BurstUUID || exifData.ContentIdentifier) {
      indicators.push('Burst/computational frame set');
      score += 5;
    }

    // Apple ProRAW / ProRes indicators
    if (exifData.AppleProRAWCapture === 1) {
      indicators.push('Apple ProRAW capture');
      score += 5;
    }

    // Google Camera depth
    if (exifData.GDepth || exifData.XMPToolkit?.includes('depth')) {
      indicators.push('Google Depth metadata present');
      score += 15;
    }

    // Samsung depth
    if (exifData.SamsungDepthMap || exifData.DualCamDualShotExtraInfo) {
      indicators.push('Samsung depth/dual camera data');
      score += 15;
    }

    return { indicators, score: Math.min(score, maxScore), maxScore };
  }

  /**
   * Check if camera is known for portrait mode capabilities
   */
  static checkPortraitCapableCamera(exifData) {
    const indicators = [];
    let score = 0;
    const maxScore = 25;

    if (!exifData) return { indicators, score, maxScore };

    const make = (exifData.Make || '').toLowerCase();
    const model = (exifData.Model || '').toLowerCase();
    const software = (exifData.Software || '').toLowerCase();
    const lensModel = (exifData.LensModel || '').toLowerCase();

    // iPhone with portrait mode (iPhone 7 Plus and later)
    const portraitCapableIphones = [
      'iphone 7 plus', 'iphone 8 plus', 
      'iphone x', 'iphone xs', 'iphone xs max', 'iphone xr',
      'iphone 11', 'iphone 11 pro', 'iphone 11 pro max',
      'iphone 12', 'iphone 12 mini', 'iphone 12 pro', 'iphone 12 pro max',
      'iphone 13', 'iphone 13 mini', 'iphone 13 pro', 'iphone 13 pro max',
      'iphone 14', 'iphone 14 plus', 'iphone 14 pro', 'iphone 14 pro max',
      'iphone 15', 'iphone 15 plus', 'iphone 15 pro', 'iphone 15 pro max',
      'iphone se' // 2nd gen and later
    ];

    if (make.includes('apple')) {
      for (const phone of portraitCapableIphones) {
        if (model.includes(phone.replace('iphone ', ''))) {
          indicators.push(`Portrait-capable iPhone: ${model}`);
          score += 15;
          break;
        }
      }

      // Check for dual/triple camera system
      if (lensModel.includes('back dual') || lensModel.includes('back triple')) {
        indicators.push('Multi-lens camera system');
        score += 10;
      }

      // iOS version check
      if (software.includes('ios') || software.match(/\d+\.\d+/)) {
        indicators.push(`iOS device: ${software}`);
        score += 5;
      }
    }

    // Google Pixel (all have portrait mode)
    if (make.includes('google') && model.includes('pixel')) {
      indicators.push(`Google Pixel with computational photography: ${model}`);
      score += 20;
    }

    // Samsung Galaxy with portrait mode
    const portraitCapableSamsung = [
      'galaxy s8', 'galaxy s9', 'galaxy s10', 'galaxy s20', 'galaxy s21', 'galaxy s22', 'galaxy s23', 'galaxy s24',
      'galaxy note', 'galaxy z fold', 'galaxy z flip'
    ];

    if (make.includes('samsung')) {
      for (const phone of portraitCapableSamsung) {
        if (model.toLowerCase().includes(phone.replace('galaxy ', ''))) {
          indicators.push(`Portrait-capable Samsung: ${model}`);
          score += 15;
          break;
        }
      }
    }

    // Huawei with portrait mode
    if (make.includes('huawei') && (model.includes('p30') || model.includes('p40') || model.includes('mate'))) {
      indicators.push(`Portrait-capable Huawei: ${model}`);
      score += 15;
    }

    return { indicators, score: Math.min(score, maxScore), maxScore };
  }

  /**
   * Check for computational photography processing markers
   */
  static checkComputationalMarkers(exifData) {
    const indicators = [];
    let score = 0;
    const maxScore = 20;

    if (!exifData) return { indicators, score, maxScore };

    const software = (exifData.Software || '').toLowerCase();
    const processingInfo = exifData.ImageProcessingInfo || '';

    // Apple computational markers
    if (exifData.PhotosAppFeatureFlags) {
      indicators.push('Apple Photos computational flags present');
      score += 10;
    }

    // Scene type indicating portrait
    if (exifData.SceneType === 1 || exifData.SceneCaptureType === 2) {
      indicators.push('Scene type: Portrait capture');
      score += 15;
    }

    // Custom rendered (computational processing)
    if (exifData.CustomRendered === 1 || exifData.CustomRendered === 2) {
      indicators.push('Custom rendering applied (computational)');
      score += 10;
    }

    // Processing software indicators
    if (software.includes('camera') && (
      software.includes('apple') || 
      software.includes('google') || 
      software.includes('samsung')
    )) {
      indicators.push(`Native camera app processing: ${software}`);
      score += 8;
    }

    // Contrast/brightness processing
    if (exifData.Contrast === 2 || exifData.Saturation === 2) {
      indicators.push('Enhanced contrast/saturation (computational)');
      score += 5;
    }

    // Face detection indicators
    if (exifData.FacesDetected && exifData.FacesDetected > 0) {
      indicators.push(`Face detection active: ${exifData.FacesDetected} faces`);
      score += 8;
    }

    // Subject distance (portrait typically close)
    if (exifData.SubjectDistance && exifData.SubjectDistance < 3) {
      indicators.push(`Close subject distance: ${exifData.SubjectDistance}m (portrait typical)`);
      score += 5;
    }

    return { indicators, score: Math.min(score, maxScore), maxScore };
  }

  /**
   * Check lens characteristics typical of portrait mode
   */
  static checkLensCharacteristics(exifData) {
    const indicators = [];
    let score = 0;
    const maxScore = 15;

    if (!exifData) return { indicators, score, maxScore };

    // Focal length typical for portraits (50-85mm equivalent)
    const focalLength = exifData.FocalLength || exifData.FocalLengthIn35mmFilm;
    if (focalLength) {
      const fl = parseFloat(focalLength);
      
      // iPhone portrait mode typically uses 56mm or 77mm equivalent
      if (fl >= 50 && fl <= 85) {
        indicators.push(`Portrait-typical focal length: ${fl}mm`);
        score += 10;
      }
      
      // iPhone telephoto lens
      if (fl === 56 || fl === 57 || fl === 77) {
        indicators.push(`iPhone portrait lens: ${fl}mm`);
        score += 15;
      }
    }

    // Aperture - portrait mode often simulates wide aperture
    const aperture = exifData.FNumber || exifData.ApertureValue;
    if (aperture) {
      const ap = parseFloat(aperture);
      
      // Smartphone apertures are typically f/1.5-2.8
      if (ap >= 1.0 && ap <= 3.0) {
        indicators.push(`Wide aperture smartphone lens: f/${ap}`);
        score += 5;
      }
    }

    // Depth of field computation indicator
    if (exifData.DepthOfField || exifData.DOFNear || exifData.DOFFar) {
      indicators.push('Depth of field computation data present');
      score += 10;
    }

    return { indicators, score: Math.min(score, maxScore), maxScore };
  }

  /**
   * Check for HDR/computational stacking indicators
   */
  static checkHDRIndicators(exifData) {
    const indicators = [];
    let score = 0;
    const maxScore = 15;

    if (!exifData) return { indicators, score, maxScore };

    // HDR enabled
    if (exifData.HDRImageType || exifData.HighDynamicRange) {
      indicators.push('HDR capture enabled');
      score += 10;
    }

    // Apple Smart HDR
    if (exifData.SmartHDR || exifData.DeepFusionEnabled) {
      indicators.push('Apple Smart HDR / Deep Fusion');
      score += 12;
    }

    // Google HDR+
    if (exifData.HDRPlusUsed || exifData.SpecialTypeID === 6) {
      indicators.push('Google HDR+ processing');
      score += 12;
    }

    // Night mode (also computational)
    if (exifData.NightMode || exifData.NightmodeEnabled) {
      indicators.push('Night mode (computational stacking)');
      score += 10;
    }

    // Exposure bracketing
    if (exifData.AEBBracketValue || exifData.BracketMode) {
      indicators.push('Exposure bracketing detected');
      score += 8;
    }

    return { indicators, score: Math.min(score, maxScore), maxScore };
  }

  /**
   * Determine if synthetic bokeh is likely
   */
  static isSyntheticBokehLikely(exifData) {
    if (!exifData) return false;

    // Key indicators of synthetic bokeh
    const hasDepthData = !!(exifData.DepthData || exifData.GDepth || exifData.SamsungDepthMap);
    const hasPortraitStyle = exifData.SemanticStyle?.toLowerCase().includes('portrait');
    const hasMultiLens = exifData.LensModel?.includes('dual') || exifData.LensModel?.includes('triple');
    const hasSmallSensor = this.isSmartphoneCamera(exifData);
    
    // Smartphone with depth data = almost certainly synthetic bokeh
    if (hasSmallSensor && hasDepthData) return true;
    if (hasPortraitStyle) return true;
    if (hasMultiLens && hasDepthData) return true;

    return false;
  }

  /**
   * Check if camera is a smartphone (small sensor)
   */
  static isSmartphoneCamera(exifData) {
    if (!exifData) return false;

    const make = (exifData.Make || '').toLowerCase();
    const model = (exifData.Model || '').toLowerCase();

    const smartphoneMakers = ['apple', 'samsung', 'google', 'huawei', 'xiaomi', 'oppo', 'vivo', 'oneplus'];
    
    for (const maker of smartphoneMakers) {
      if (make.includes(maker)) return true;
    }

    // Check for typical smartphone model names
    if (model.includes('iphone') || model.includes('pixel') || model.includes('galaxy')) {
      return true;
    }

    return false;
  }

  /**
   * Calculate how much to adjust AI detection confidence
   */
  static calculateAIAdjustment(portraitConfidence, indicators) {
    if (portraitConfidence < 40) {
      return {
        shouldAdjust: false,
        adjustmentFactor: 1.0,
        confidenceReduction: 0,
        reason: 'No significant computational photography detected'
      };
    }

    let adjustmentFactor = 1.0;
    let confidenceReduction = 0;

    // Strong portrait mode detection = large reduction in AI confidence
    if (portraitConfidence >= 80) {
      adjustmentFactor = 0.3; // Reduce AI confidence by 70%
      confidenceReduction = 50;
    } else if (portraitConfidence >= 60) {
      adjustmentFactor = 0.5; // Reduce AI confidence by 50%
      confidenceReduction = 35;
    } else if (portraitConfidence >= 40) {
      adjustmentFactor = 0.7; // Reduce AI confidence by 30%
      confidenceReduction = 20;
    }

    return {
      shouldAdjust: true,
      adjustmentFactor: adjustmentFactor,
      confidenceReduction: confidenceReduction,
      reason: `Computational photography detected (${portraitConfidence}% confidence)`,
      indicators: indicators.slice(0, 5) // Top 5 reasons
    };
  }

  /**
   * Apply portrait mode adjustment to AI detection results
   * WITH SAFEGUARDS to prevent over-correction
   */
  static adjustAIDetectionResults(aiDetection, portraitDetection) {
    if (!aiDetection || !portraitDetection) return aiDetection;

    const adjustment = portraitDetection.ai_adjustment;
    
    if (!adjustment.shouldAdjust) return aiDetection;

    const originalConfidence = aiDetection.ai_confidence || aiDetection.confidence || 0;
    
    // SAFEGUARD 1: Minimum confidence floor - never go below 25%
    const MIN_CONFIDENCE_FLOOR = 25;
    
    // SAFEGUARD 2: Reduce adjustment if other red flags present
    let effectiveAdjustmentFactor = adjustment.adjustmentFactor;
    const safeguardWarnings = [];
    
    // Check for generator signatures (strong AI indicator)
    if (aiDetection.generator_signature_found || aiDetection.generator_detected) {
      effectiveAdjustmentFactor = Math.max(effectiveAdjustmentFactor, 0.7);
      safeguardWarnings.push('Generator signature detected - adjustment reduced');
    }
    
    // Check for manipulation indicators
    if (aiDetection.manipulation_detected || aiDetection.forensics_suspicious) {
      effectiveAdjustmentFactor = Math.max(effectiveAdjustmentFactor, 0.75);
      safeguardWarnings.push('Manipulation indicators present - adjustment reduced');
    }
    
    // Check for very high original confidence (strong AI signal)
    if (originalConfidence > 90) {
      effectiveAdjustmentFactor = Math.max(effectiveAdjustmentFactor, 0.5);
      safeguardWarnings.push('Very high AI confidence - maintaining skepticism');
    }
    
    // Calculate adjusted confidence with floor
    const rawAdjustedConfidence = Math.round(originalConfidence * effectiveAdjustmentFactor);
    const adjustedConfidence = Math.max(rawAdjustedConfidence, MIN_CONFIDENCE_FLOOR);
    
    // SAFEGUARD 3: Flag if adjustment was capped
    const wasFloorApplied = rawAdjustedConfidence < MIN_CONFIDENCE_FLOOR;
    if (wasFloorApplied) {
      safeguardWarnings.push(`Minimum confidence floor (${MIN_CONFIDENCE_FLOOR}%) applied`);
    }

    // Create adjusted result
    const adjustedResult = {
      ...aiDetection,
      
      // ALWAYS show both scores for transparency
      ai_confidence_raw: originalConfidence,
      original_ai_confidence: originalConfidence,
      ai_confidence: adjustedConfidence,
      confidence: adjustedConfidence,
      
      // Update verdict based on new confidence
      likely_ai_generated: adjustedConfidence > 70,
      
      // Add computational photography context
      computational_photography_detected: true,
      portrait_mode_adjustment: {
        applied: true,
        portrait_confidence: portraitDetection.confidence,
        original_adjustment_factor: adjustment.adjustmentFactor,
        effective_adjustment_factor: effectiveAdjustmentFactor,
        confidence_reduction: originalConfidence - adjustedConfidence,
        reason: adjustment.reason,
        indicators: portraitDetection.indicators.slice(0, 5),
        safeguards_applied: safeguardWarnings,
        minimum_floor_applied: wasFloorApplied
      },

      // Update reasoning
      adjusted_verdict: this.getAdjustedVerdict(adjustedConfidence, portraitDetection),
      
      // Important caveats for users
      adjustment_caveats: [
        'Adjustment based on EXIF metadata which can be manipulated',
        'Raw AI score preserved for reference - review both scores',
        'Consider other verification factors (forensics, reverse search, etc.)',
        'High raw score + portrait adjustment = review carefully'
      ],
      
      // Warnings about computational photography
      warnings: [
        ...(aiDetection.warnings || []),
        {
          type: 'COMPUTATIONAL_PHOTOGRAPHY',
          severity: originalConfidence > 70 ? 'MEDIUM' : 'LOW',
          message: `Portrait/computational mode detected (${portraitDetection.confidence}% confidence). AI detection confidence adjusted from ${originalConfidence}% to ${adjustedConfidence}%.`,
          indicators: portraitDetection.indicators.slice(0, 3),
          recommendation: originalConfidence > 70 
            ? 'High raw AI score - review both raw and adjusted scores carefully'
            : 'Adjustment appears appropriate for computational photography'
        }
      ]
    };

    return adjustedResult;
  }

  /**
   * Get adjusted verdict text
   */
  static getAdjustedVerdict(adjustedConfidence, portraitDetection) {
    if (adjustedConfidence < 30) {
      return `LIKELY AUTHENTIC - Computational photography effects from ${portraitDetection.isPortraitMode ? 'portrait mode' : 'smartphone processing'}`;
    } else if (adjustedConfidence < 50) {
      return `POSSIBLY AUTHENTIC - Some AI-like artifacts may be from smartphone computational photography`;
    } else if (adjustedConfidence < 70) {
      return `UNCERTAIN - AI indicators present despite portrait mode adjustment`;
    } else {
      return `LIKELY AI-GENERATED - Strong AI indicators even after portrait mode adjustment`;
    }
  }
}

module.exports = EnhancedPortraitModeDetection;