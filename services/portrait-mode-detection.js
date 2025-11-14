/**
 * Portrait Mode Detection Service
 * Detects when photos use computational photography (portrait/bokeh mode)
 * to prevent false positives in AI detection
 */

/**
 * Detect if image was taken in portrait mode
 * @param {Object} exifData - Parsed EXIF data from image
 * @returns {Object} Detection result with confidence and indicators
 */
function detectPortraitMode(exifData) {
  if (!exifData) {
    return {
      isPortraitMode: false,
      confidence: 0,
      indicators: []
    };
  }

  const indicators = [];
  let confidenceScore = 0;

  // iPhone Portrait Mode Indicators
  if (exifData.Make?.toLowerCase().includes('apple')) {
    // Check for portrait mode in lens model
    if (exifData.LensModel?.toLowerCase().includes('portrait')) {
      indicators.push('iPhone lens model indicates portrait mode');
      confidenceScore += 40;
    }

    // Check software processing
    if (exifData.Software?.toLowerCase().includes('portrait')) {
      indicators.push('Software tag indicates portrait processing');
      confidenceScore += 30;
    }

    // iPhone dual camera indicator (used for portrait mode)
    if (exifData.LensMake?.toLowerCase().includes('apple') && 
        (exifData.FocalLength === 26 || exifData.FocalLength === 52)) {
      indicators.push('Dual camera focal length typical of portrait mode');
      confidenceScore += 20;
    }
  }

  // Google Pixel Portrait Mode
  if (exifData.Make?.toLowerCase().includes('google')) {
    if (exifData.Model?.toLowerCase().includes('pixel')) {
      // Pixel uses HDR+ processing for portrait
      if (exifData.ProcessingSoftware?.includes('HDR')) {
        indicators.push('Google Pixel HDR+ portrait processing detected');
        confidenceScore += 35;
      }
    }
  }

  // Samsung Portrait Mode
  if (exifData.Make?.toLowerCase().includes('samsung')) {
    if (exifData.SceneCaptureType?.toLowerCase().includes('portrait') ||
        exifData.SceneType?.toLowerCase().includes('portrait')) {
      indicators.push('Samsung portrait scene mode detected');
      confidenceScore += 40;
    }
  }

  // Generic portrait mode indicators (works across brands)
  
  // Subject distance range (portrait mode focuses close)
  if (exifData.SubjectDistanceRange === 2 || // Close view
      exifData.SubjectDistanceRange === 'Close view') {
    indicators.push('Close subject distance typical of portrait photography');
    confidenceScore += 15;
  }

  // Scene type
  if (exifData.SceneCaptureType === 2 || // Portrait
      exifData.SceneType === 'Portrait') {
    indicators.push('EXIF scene type set to portrait');
    confidenceScore += 25;
  }

  // Image description often contains hints
  if (exifData.ImageDescription) {
    const desc = exifData.ImageDescription.toLowerCase();
    if (desc.includes('portrait') || desc.includes('bokeh') || desc.includes('depth')) {
      indicators.push('Image description mentions portrait/bokeh/depth');
      confidenceScore += 20;
    }
  }

  // Multiple exposure (computational photography indicator)
  if (exifData.ExposureMode === 'Auto bracket' || 
      exifData.BracketMode) {
    indicators.push('Multi-frame exposure (computational photography)');
    confidenceScore += 15;
  }

  // Wide aperture simulation (f/1.4 to f/2.8 on phones = fake bokeh)
  if (exifData.FNumber && exifData.FNumber < 2.8) {
    const phoneIndicators = exifData.Make?.toLowerCase().includes('apple') ||
                           exifData.Make?.toLowerCase().includes('google') ||
                           exifData.Make?.toLowerCase().includes('samsung');
    if (phoneIndicators) {
      indicators.push('Wide aperture on smartphone (likely simulated bokeh)');
      confidenceScore += 25;
    }
  }

  // Cap confidence at 100
  confidenceScore = Math.min(confidenceScore, 100);

  return {
    isPortraitMode: confidenceScore >= 40, // Threshold: 40% confidence
    confidence: confidenceScore,
    indicators: indicators,
    device: exifData.Make || 'Unknown',
    model: exifData.Model || 'Unknown'
  };
}

/**
 * Adjust AI detection results based on portrait mode detection
 * @param {Object} aiDetection - Original AI detection results
 * @param {Object} portraitDetection - Portrait mode detection results
 * @returns {Object} Adjusted AI detection results
 */
function adjustForPortraitMode(aiDetection, portraitDetection) {
  if (!portraitDetection.isPortraitMode || !aiDetection) {
    return aiDetection;
  }

  // Calculate adjustment factor (stronger adjustment for higher portrait confidence)
  const adjustmentFactor = portraitDetection.confidence / 100;
  const confidenceReduction = Math.round(30 * adjustmentFactor);

  // Reduce AI confidence
  const originalConfidence = aiDetection.ai_confidence || 0;
  const adjustedConfidence = Math.max(originalConfidence - confidenceReduction, 0);

  // Add warning
  const warning = `Portrait mode detected (${portraitDetection.confidence}% confidence). ` +
                  `Computational photography may trigger AI detection. ` +
                  `AI confidence adjusted from ${originalConfidence}% to ${adjustedConfidence}%.`;

  return {
    ...aiDetection,
    ai_confidence: adjustedConfidence,
    original_ai_confidence: originalConfidence,
    portrait_mode_detected: true,
    portrait_mode_confidence: portraitDetection.confidence,
    portrait_mode_indicators: portraitDetection.indicators,
    adjusted_for_portrait: true,
    warnings: [...(aiDetection.warnings || []), warning]
  };
}

module.exports = {
  detectPortraitMode,
  adjustForPortraitMode
};
