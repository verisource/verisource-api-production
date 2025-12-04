/**
 * Encoder Fingerprinting
 * Detects AI-generated videos by analyzing encoder signatures
 */

// Known AI tool encoder signatures
const AI_ENCODER_PATTERNS = [
  { pattern: /Lavf\d+\.\d+\.\d+/i, name: 'FFmpeg (Lavf)', score: 25, note: 'Generic FFmpeg - common in AI tools' },
  { pattern: /libx264/i, name: 'libx264', score: 15, note: 'Generic H.264 encoder' },
  { pattern: /libx265/i, name: 'libx265', score: 15, note: 'Generic H.265 encoder' },
  { pattern: /HandBrake/i, name: 'HandBrake', score: 10, note: 'Re-encoding tool' },
  { pattern: /RunwayML/i, name: 'Runway', score: 80, note: 'Known AI video generator' },
  { pattern: /Pika/i, name: 'Pika Labs', score: 80, note: 'Known AI video generator' },
  { pattern: /Kling/i, name: 'Kling AI', score: 80, note: 'Known AI video generator' },
  { pattern: /Sora/i, name: 'OpenAI Sora', score: 85, note: 'Known AI video generator' },
  { pattern: /Luma/i, name: 'Luma AI', score: 80, note: 'Known AI video generator' },
  { pattern: /Synthesia/i, name: 'Synthesia', score: 75, note: 'AI avatar generator' },
  { pattern: /HeyGen/i, name: 'HeyGen', score: 75, note: 'AI avatar generator' },
  { pattern: /D-ID/i, name: 'D-ID', score: 75, note: 'AI avatar generator' },
];

// Authentic device encoder signatures
const AUTHENTIC_ENCODER_PATTERNS = [
  { pattern: /Apple/i, name: 'Apple', score: -30, note: 'iPhone/iPad/Mac' },
  { pattern: /Samsung/i, name: 'Samsung', score: -25, note: 'Samsung device' },
  { pattern: /MediaTek/i, name: 'MediaTek', score: -25, note: 'Android chipset' },
  { pattern: /Qualcomm/i, name: 'Qualcomm', score: -25, note: 'Snapdragon encoder' },
  { pattern: /Exynos/i, name: 'Exynos', score: -25, note: 'Samsung chipset' },
  { pattern: /OMX\./i, name: 'OMX Hardware', score: -20, note: 'Hardware encoder (real device)' },
  { pattern: /com\.android/i, name: 'Android', score: -30, note: 'Android device' },
  { pattern: /quicktime/i, name: 'QuickTime', score: -20, note: 'Apple ecosystem' },
];

// Suspicious container brands (often from AI tools)
const SUSPICIOUS_BRANDS = [
  { brand: 'isom', score: 10, note: 'Generic ISO container' },
  { brand: 'iso2', score: 10, note: 'Generic ISO container' },
  { brand: 'avc1', score: 5, note: 'Generic AVC' },
  { brand: 'mp41', score: 5, note: 'Generic MP4' },
  { brand: 'mp42', score: 0, note: 'Standard MP4 (neutral)' },
];

// Authentic container brands
const AUTHENTIC_BRANDS = [
  { brand: 'qt', score: -15, note: 'QuickTime (Apple)' },
  { brand: 'MSNV', score: -15, note: 'Sony device' },
  { brand: '3gp', score: -10, note: 'Mobile device recording' },
  { brand: 'heic', score: -15, note: 'Apple HEIC' },
  { brand: 'mif1', score: -15, note: 'HEIF (Apple/modern phones)' },
];

/**
 * Analyze encoder signatures from video metadata
 * @param {Object} metadata - FFprobe metadata
 * @returns {Object} Analysis result with AI likelihood score
 */
function analyzeEncoderSignature(metadata) {
  const result = {
    aiScore: 0,
    authenticScore: 0,
    encoderDetected: null,
    brandDetected: null,
    indicators: [],
    isLikelyAI: false,
    confidence: 0
  };

  if (!metadata) return result;

  const tags = metadata.format?.tags || metadata.tags || {};
  const encoder = tags.encoder || tags.ENCODER || '';
  const majorBrand = tags.major_brand || '';
  const compatibleBrands = tags.compatible_brands || '';
  const handler = tags.handler_name || '';

  // Check encoder string
  if (encoder) {
    result.encoderDetected = encoder;
    
    // Check against AI patterns
    for (const pattern of AI_ENCODER_PATTERNS) {
      if (pattern.pattern.test(encoder)) {
        result.aiScore += pattern.score;
        result.indicators.push(`Encoder: ${pattern.name} - ${pattern.note}`);
        break;
      }
    }
    
    // Check against authentic patterns
    for (const pattern of AUTHENTIC_ENCODER_PATTERNS) {
      if (pattern.pattern.test(encoder)) {
        result.authenticScore += Math.abs(pattern.score);
        result.aiScore += pattern.score; // Negative score reduces AI likelihood
        result.indicators.push(`Authentic encoder: ${pattern.name}`);
        break;
      }
    }
  } else {
    // No encoder string - slightly suspicious
    result.aiScore += 5;
    result.indicators.push('No encoder string (slightly suspicious)');
  }

  // Check container brand
  if (majorBrand) {
    result.brandDetected = majorBrand;
    
    // Check suspicious brands
    for (const brand of SUSPICIOUS_BRANDS) {
      if (majorBrand.toLowerCase().includes(brand.brand.toLowerCase())) {
        result.aiScore += brand.score;
        if (brand.score > 0) {
          result.indicators.push(`Container: ${brand.brand} - ${brand.note}`);
        }
        break;
      }
    }
    
    // Check authentic brands
    for (const brand of AUTHENTIC_BRANDS) {
      if (majorBrand.toLowerCase().includes(brand.brand.toLowerCase())) {
        result.authenticScore += Math.abs(brand.score);
        result.aiScore += brand.score;
        result.indicators.push(`Authentic container: ${brand.note}`);
        break;
      }
    }
  }

  // Check for device-specific tags (strong authentic signal)
  if (tags['com.android.version'] || tags['com.android.capture.fps']) {
    result.aiScore -= 30;
    result.authenticScore += 30;
    result.indicators.push('Android device metadata present');
  }
  
  if (tags['com.apple.quicktime.make'] || tags['com.apple.quicktime.model']) {
    result.aiScore -= 30;
    result.authenticScore += 30;
    result.indicators.push('Apple device metadata present');
  }

  // Check for creation time (real videos usually have this)
  if (tags.creation_time) {
    result.aiScore -= 5;
    result.indicators.push('Creation timestamp present');
  } else {
    result.aiScore += 10;
    result.indicators.push('No creation timestamp (suspicious)');
  }

  // Check for suspicious lack of metadata
  const hasMinimalTags = Object.keys(tags).length < 4;
  if (hasMinimalTags) {
    result.aiScore += 15;
    result.indicators.push('Minimal metadata (suspicious)');
  }

  // Calculate final scores
  result.aiScore = Math.max(0, Math.min(100, result.aiScore));
  result.isLikelyAI = result.aiScore >= 40;
  result.confidence = Math.min(95, Math.max(result.aiScore, result.authenticScore));

  result.metadata = metadata;
  return result;
}

/**
 * Get human-readable verdict
 */
function getEncoderVerdict(analysis) {
  if (analysis.aiScore >= 70) {
    return { verdict: 'LIKELY_AI_TOOL', confidence: 'high', message: 'Strong AI tool encoder signature detected' };
  } else if (analysis.aiScore >= 50) {
    return { verdict: 'POSSIBLY_AI', confidence: 'medium', message: 'Suspicious encoder characteristics' };
  } else if (analysis.aiScore >= 30) {
    return { verdict: 'UNCERTAIN', confidence: 'low', message: 'Some suspicious encoder traits' };
  } else if (analysis.authenticScore >= 20) {
    return { verdict: 'LIKELY_AUTHENTIC', confidence: 'medium', message: 'Device encoder signature detected' };
  } else {
    return { verdict: 'UNKNOWN', confidence: 'low', message: 'Unable to determine encoder origin' };
  }
}

module.exports = {
  analyzeEncoderSignature,
  getEncoderVerdict,
  AI_ENCODER_PATTERNS,
  AUTHENTIC_ENCODER_PATTERNS
};


/**
 * Detect Android device from metadata
 */
function detectAndroidDevice(metadata) {
  const format = metadata?.format || {};
  const tags = format.tags || {};
  
  // Check for Android-specific tags
  const androidVersion = tags['com.android.version'];
  const androidFps = tags['com.android.capture.fps'];
  const hasCreationTime = !!tags['creation_time'];
  
  if (androidVersion || androidFps) {
    return {
      detected: true,
      device: 'Android',
      version: androidVersion || 'unknown',
      fps: androidFps || null,
      hasCreationTime,
      confidence: 95
    };
  }
  
  // Check for Samsung-specific
  if (tags['com.samsung.android.capture'] || (tags.encoder && tags.encoder.includes('samsung'))) {
    return {
      detected: true,
      device: 'Samsung Android',
      confidence: 90
    };
  }
  
  return { detected: false };
}

module.exports.detectAndroidDevice = detectAndroidDevice;
