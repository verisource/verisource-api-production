/**
 * Screenshot Detection Service
 * Detects if an image is a screenshot based on dimensions, format, and characteristics
 * 
 * Noise Level Scale: 0-1 (0 = no noise/perfect pixels, 1 = very noisy)
 * Threshold: >= 50 confidence = screenshot detected
 */

// Configurable weights for tuning
const SCREENSHOT_WEIGHTS = {
  dimensionExactMatch: 45,
  dimensionNearMatch: 35,
  aspectRatioMatch: 15,
  pngFormat: 20,
  noExifWithDisplayProfile: 25,
  noExifOnly: 5,  // Reduced - social media strips EXIF too
  lowNoiseStrong: 15,
  lowNoiseWeak: 8,
  filenameHint: 20,
  screenshotThreshold: 50,
};

// Tolerances
const DIMENSION_TOLERANCE = 8; // pixels
const ASPECT_TOLERANCE = 0.02;

// Known device screen resolutions
const KNOWN_SCREENS = [
  // iPhones
  { w: 1179, h: 2556, device: 'iPhone 14 Pro' },
  { w: 1170, h: 2532, device: 'iPhone 13/14' },
  { w: 1284, h: 2778, device: 'iPhone 13/14 Pro Max' },
  { w: 1290, h: 2796, device: 'iPhone 14 Pro Max' },
  { w: 1125, h: 2436, device: 'iPhone X/XS/11 Pro' },
  { w: 1242, h: 2688, device: 'iPhone XS Max/11 Pro Max' },
  { w: 828, h: 1792, device: 'iPhone XR/11' },
  { w: 750, h: 1334, device: 'iPhone 6/7/8/SE' },
  { w: 1080, h: 1920, device: 'iPhone 6+/7+/8+' },
  
  // Android common
  { w: 1080, h: 2340, device: 'Samsung Galaxy S21/S22/S23' },
  { w: 1440, h: 3088, device: 'Samsung Galaxy S21 Ultra' },
  { w: 1440, h: 3200, device: 'Samsung Galaxy S22/S23 Ultra' },
  { w: 1080, h: 2400, device: 'Google Pixel 6/7' },
  { w: 1440, h: 3120, device: 'Google Pixel 6 Pro' },
  
  // iPads
  { w: 2048, h: 2732, device: 'iPad Pro 12.9"' },
  { w: 1668, h: 2388, device: 'iPad Pro 11"' },
  { w: 1620, h: 2160, device: 'iPad 10th gen' },
  { w: 2048, h: 1536, device: 'iPad Air/Mini' },
  
  // Desktop monitors
  { w: 1920, h: 1080, device: '1080p Display' },
  { w: 2560, h: 1440, device: '1440p Display' },
  { w: 3840, h: 2160, device: '4K Display' },
  { w: 1366, h: 768, device: 'Common Laptop' },
  { w: 1536, h: 864, device: 'Common Laptop HD' },
  
  // MacBooks
  { w: 2880, h: 1800, device: 'MacBook Pro 15"' },
  { w: 3024, h: 1964, device: 'MacBook Pro 14"' },
  { w: 3456, h: 2234, device: 'MacBook Pro 16"' },
  { w: 2560, h: 1600, device: 'MacBook Air M1/M2' },
  { w: 2304, h: 1440, device: 'MacBook 12"' },
];

// Common aspect ratios for screenshots
const COMMON_ASPECT_RATIOS = [
  // Mobile
  { ratio: 9/19.5, name: 'Modern smartphone (19.5:9)' },
  { ratio: 9/20, name: 'Tall smartphone (20:9)' },
  { ratio: 9/21, name: 'Ultra-tall smartphone (21:9)' },
  // Desktop
  { ratio: 16/9, name: 'Widescreen display (16:9)' },
  { ratio: 16/10, name: 'Widescreen display (16:10)' },
  { ratio: 4/3, name: 'Standard display (4:3)' },
];

/**
 * Check if two values are roughly equal within tolerance
 */
function roughlyEquals(a, b, tolerance = DIMENSION_TOLERANCE) {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Detect if image is a screenshot
 * @param {Object} imageData - Image metadata
 * @param {number} imageData.width - Image width in pixels
 * @param {number} imageData.height - Image height in pixels
 * @param {string} imageData.format - Image format (png, jpg, etc)
 * @param {Object} imageData.exif - EXIF data (may be null)
 * @param {string} imageData.colorProfile - Color profile if available
 * @param {number} imageData.noiseLevel - Sensor noise level 0-1 (optional)
 * @param {string} imageData.filename - Original filename (optional)
 * @param {string} [mode='balanced'] - Detection mode: 'strict', 'balanced', 'lenient'
 * @returns {Object} Screenshot detection result
 */
function detectScreenshot(imageData, mode = 'balanced') {
  // Safety: handle missing/invalid data
  if (!imageData || typeof imageData !== 'object') {
    return {
      is_screenshot: false,
      confidence: 0,
      detected_device: null,
      indicators: [],
      score_breakdown: {},
      recommendation: null,
      error: 'Invalid or missing image data'
    };
  }

  const { width, height, format, exif, colorProfile, noiseLevel, filename } = imageData;
  
  // Guard against zero/missing dimensions
  if (!width || !height || width <= 0 || height <= 0) {
    return {
      is_screenshot: false,
      confidence: 0,
      detected_device: null,
      indicators: [],
      score_breakdown: {},
      recommendation: null,
      error: 'Invalid image dimensions'
    };
  }

  let screenshotScore = 0;
  const indicators = [];
  const scoreBreakdown = {};
  let detectedDevice = null;
  
  // 1. Check device dimensions (with tolerance)
  let dimensionMatchType = null;
  
  for (const screen of KNOWN_SCREENS) {
    // Exact match (with tolerance)
    const directMatch = roughlyEquals(screen.w, width) && roughlyEquals(screen.h, height);
    const rotatedMatch = roughlyEquals(screen.h, width) && roughlyEquals(screen.w, height);
    
    if (directMatch || rotatedMatch) {
      dimensionMatchType = 'exact';
      detectedDevice = screen.device;
      break;
    }
    
    // Near match (aspect ratio + close area) - for cropped screenshots
    const screenAr = screen.w / screen.h;
    const imgAr = width / height;
    const screenArea = screen.w * screen.h;
    const imgArea = width * height;
    const areaDiff = Math.abs(screenArea - imgArea) / screenArea;
    
    if (Math.abs(screenAr - imgAr) < ASPECT_TOLERANCE && areaDiff < 0.15) {
      if (!dimensionMatchType) {
        dimensionMatchType = 'near';
        detectedDevice = screen.device + ' (likely cropped)';
      }
    }
  }
  
  if (dimensionMatchType === 'exact') {
    screenshotScore += SCREENSHOT_WEIGHTS.dimensionExactMatch;
    scoreBreakdown.dimensionMatch = SCREENSHOT_WEIGHTS.dimensionExactMatch;
    indicators.push(`Dimensions exactly match ${detectedDevice} screen (${width}x${height})`);
  } else if (dimensionMatchType === 'near') {
    screenshotScore += SCREENSHOT_WEIGHTS.dimensionNearMatch;
    scoreBreakdown.dimensionMatch = SCREENSHOT_WEIGHTS.dimensionNearMatch;
    indicators.push(`Dimensions closely match ${detectedDevice} (${width}x${height})`);
  }
  
  // 2. PNG format (screenshots are often PNG)
  if (format && format.toLowerCase() === 'png') {
    screenshotScore += SCREENSHOT_WEIGHTS.pngFormat;
    scoreBreakdown.pngFormat = SCREENSHOT_WEIGHTS.pngFormat;
    indicators.push('PNG format (common for screenshots)');
  }
  
  // 3. EXIF and color profile analysis
  const hasExif = exif && (exif.Make || exif.Model || exif.DateTimeOriginal);
  const cp = colorProfile ? colorProfile.toLowerCase() : '';
  const hasDisplayProfile = cp.includes('srgb') || cp.includes('display p3') || cp.includes('displayp3');
  
  if (!hasExif && hasDisplayProfile) {
    screenshotScore += SCREENSHOT_WEIGHTS.noExifWithDisplayProfile;
    scoreBreakdown.noExifWithDisplayProfile = SCREENSHOT_WEIGHTS.noExifWithDisplayProfile;
    indicators.push('Display color profile without camera metadata');
  } else if (!hasExif) {
    screenshotScore += SCREENSHOT_WEIGHTS.noExifOnly;
    scoreBreakdown.noExifOnly = SCREENSHOT_WEIGHTS.noExifOnly;
    indicators.push('No camera metadata (note: social media also strips EXIF)');
  }
  
  // 4. Noise level analysis (0-1 scale, lower = more likely screenshot)
  if (noiseLevel !== undefined && noiseLevel !== null && typeof noiseLevel === 'number') {
    if (noiseLevel < 0.3) {
      screenshotScore += SCREENSHOT_WEIGHTS.lowNoiseStrong;
      scoreBreakdown.lowNoise = SCREENSHOT_WEIGHTS.lowNoiseStrong;
      indicators.push('Extremely low image noise (typical of screen capture)');
    } else if (noiseLevel < 0.5) {
      screenshotScore += SCREENSHOT_WEIGHTS.lowNoiseWeak;
      scoreBreakdown.lowNoise = SCREENSHOT_WEIGHTS.lowNoiseWeak;
      indicators.push('Low image noise (may indicate screen capture)');
    }
  }
  
  // 5. Aspect ratio check (if no dimension match found)
  if (!dimensionMatchType) {
    const aspectRatio = width / height;
    
    for (const ar of COMMON_ASPECT_RATIOS) {
      // Check both orientations
      if (Math.abs(aspectRatio - ar.ratio) < ASPECT_TOLERANCE || 
          Math.abs(aspectRatio - (1/ar.ratio)) < ASPECT_TOLERANCE) {
        screenshotScore += SCREENSHOT_WEIGHTS.aspectRatioMatch;
        scoreBreakdown.aspectRatioMatch = SCREENSHOT_WEIGHTS.aspectRatioMatch;
        indicators.push(`Aspect ratio matches ${ar.name}`);
        break;
      }
    }
  }
  
  // 6. Filename heuristics
  if (filename && typeof filename === 'string') {
    const name = filename.toLowerCase();
    const screenshotPatterns = [
      'screenshot',
      'screen shot',
      'screen_shot',
      'captura',      // Spanish
      'capture',
      'bildschirmfoto', // German
      'schermafbeelding', // Dutch
      'snimok',       // Russian transliteration
    ];
    
    for (const pattern of screenshotPatterns) {
      if (name.includes(pattern)) {
        screenshotScore += SCREENSHOT_WEIGHTS.filenameHint;
        scoreBreakdown.filenameHint = SCREENSHOT_WEIGHTS.filenameHint;
        indicators.push(`Filename suggests screenshot ("${filename}")`);
        break;
      }
    }
  }
  
  // Adjust threshold based on mode
  let threshold = SCREENSHOT_WEIGHTS.screenshotThreshold;
  if (mode === 'strict') threshold = 60;
  else if (mode === 'lenient') threshold = 40;
  
  // Determine result
  const confidence = Math.min(screenshotScore, 100);
  const isScreenshot = screenshotScore >= threshold;
  
  return {
    is_screenshot: isScreenshot,
    confidence: confidence,
    detected_device: detectedDevice,
    indicators: indicators,
    score_breakdown: scoreBreakdown,
    mode: mode,
    threshold: threshold,
    recommendation: isScreenshot 
      ? 'This appears to be a screenshot. Original content authenticity cannot be verified from a screen capture. Verify at original source.'
      : null
  };
}

/**
 * Get verdict adjustment based on screenshot detection
 * @param {Object} screenshotResult - Result from detectScreenshot
 * @returns {Object} Verdict adjustments with severity level
 */
function getScreenshotVerdictAdjustment(screenshotResult) {
  if (!screenshotResult || !screenshotResult.is_screenshot) {
    return { 
      skip_ai_detection: false, 
      add_warning: null,
      severity: null,
      override_verdict: null,
      reduce_confidence_weight: false
    };
  }
  
  // Determine severity based on confidence
  let severity = 'medium';
  if (screenshotResult.confidence >= 80) {
    severity = 'high';
  } else if (screenshotResult.confidence < 60) {
    severity = 'low';
  }
  
  // Build warning message based on severity
  const device = screenshotResult.detected_device;
  let warningMessage;
  
  if (severity === 'high') {
    warningMessage = `Screenshot detected${device ? ` (${device})` : ''}. AI detection results reflect the screenshot, not the original content. Verify authenticity at original source.`;
  } else if (severity === 'medium') {
    warningMessage = `This appears to be a screenshot${device ? ` from a ${device}` : ''}. AI detection results may not reflect the authenticity of the original content.`;
  } else {
    warningMessage = `This may be a screenshot. Consider verifying at the original source for accurate authenticity assessment.`;
  }
  
  return {
    skip_ai_detection: false, // Still run AI detection on content
    override_verdict: 'SCREENSHOT_DETECTED',
    severity: severity,
    add_warning: warningMessage,
    reduce_confidence_weight: severity !== 'low', // Only reduce weight for medium/high confidence
    confidence_weight_factor: severity === 'high' ? 0.5 : (severity === 'medium' ? 0.7 : 1.0)
  };
}

/**
 * Get human-readable explanation for screenshot detection
 * @param {Object} screenshotResult - Result from detectScreenshot
 * @returns {string} Human-readable explanation
 */
function getScreenshotExplanation(screenshotResult) {
  if (!screenshotResult || !screenshotResult.is_screenshot) {
    return null;
  }
  
  const parts = [
    'This image appears to be a screenshot based on the following indicators:',
    '',
    ...screenshotResult.indicators.map(i => `• ${i}`),
    '',
    'Screenshots capture what is displayed on a screen, not the original media.',
    'For accurate authenticity verification, obtain the original source file whenever possible.'
  ];
  
  return parts.join('\n');
}

module.exports = {
  detectScreenshot,
  getScreenshotVerdictAdjustment,
  getScreenshotExplanation,
  KNOWN_SCREENS,
  COMMON_ASPECT_RATIOS,
  SCREENSHOT_WEIGHTS
};