/**
 * Platform Signature Detection Service
 * Detects if an image was shared through social media platforms
 * based on compression signatures, dimensions, and metadata patterns.
 */

const PLATFORM_SIGNATURES = {
  instagram: {
    maxWidths: [1080, 1440, 1920],
    jpegQuality: [70, 85],
    exifStripped: true,
    aspectRatios: [1, 1.91, 0.8],
    aspectTolerance: 0.05
  },
  whatsapp: {
    maxWidths: [1280, 1600],
    jpegQuality: [55, 70],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0
  },
  twitter: {
    maxWidths: [1200, 2048, 4096],
    jpegQuality: [75, 90],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0
  },
  facebook: {
    maxWidths: [960, 1200, 2048],
    jpegQuality: [70, 85],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0
  },
  tiktok: {
    maxWidths: [1080],
    jpegQuality: [60, 80],
    exifStripped: true,
    aspectRatios: [0.5625],
    aspectTolerance: 0.03
  }
};

const WIDTH_TOLERANCE = 0.05;

function isWithinTolerance(value, target, tolerance) {
  return Math.abs(value - target) / target <= tolerance;
}

function matchWidth(width, platformWidths) {
  for (const targetWidth of platformWidths) {
    if (isWithinTolerance(width, targetWidth, WIDTH_TOLERANCE)) {
      return { matched: true, targetWidth };
    }
  }
  return { matched: false, targetWidth: null };
}

function matchQuality(quality, qualityRange) {
  if (!quality || !qualityRange) return { matched: false };
  const [min, max] = qualityRange;
  return { matched: quality >= min && quality <= max };
}

function matchAspectRatio(width, height, platformRatios, tolerance) {
  if (!platformRatios) return { matched: false, ratio: null, matchedRatio: null };
  
  const actualRatio = width / height;
  for (const targetRatio of platformRatios) {
    if (isWithinTolerance(actualRatio, targetRatio, tolerance)) {
      return { matched: true, ratio: actualRatio, matchedRatio: targetRatio };
    }
  }
  return { matched: false, ratio: actualRatio, matchedRatio: null };
}

function scorePlatformMatch(platform, config, metadata) {
  const { width, height, jpegQuality, hasExif } = metadata;
  let score = 0;
  const indicators = [];
  
  // EXIF check - required (30 points)
  if (config.exifStripped && !hasExif) {
    score += 30;
    indicators.push('No EXIF data');
  } else if (config.exifStripped && hasExif) {
    return { score: 0, indicators: ['Has EXIF (unexpected for social media)'] };
  }
  
  // Width matching (35 points)
  if (config.maxWidths && width) {
    const widthMatch = matchWidth(width, config.maxWidths);
    if (widthMatch.matched) {
      score += 35;
      indicators.push(`${width}px width (matches ${widthMatch.targetWidth}px)`);
    }
  }
  
  // JPEG quality matching (20 points)
  if (config.jpegQuality && jpegQuality) {
    const qualityMatch = matchQuality(jpegQuality, config.jpegQuality);
    if (qualityMatch.matched) {
      score += 20;
      indicators.push(`JPEG quality ${jpegQuality}`);
    }
  }
  
  // Aspect ratio matching (15 points)
  if (config.aspectRatios && width && height) {
    const aspectMatch = matchAspectRatio(width, height, config.aspectRatios, config.aspectTolerance);
    if (aspectMatch.matched) {
      score += 15;
      indicators.push(`Aspect ratio ${aspectMatch.ratio.toFixed(2)}`);
    }
  }
  
  return { score, indicators };
}

async function detectPlatform(filePath, metadata) {
  const { hasExif } = metadata;
  
  if (hasExif) {
    return {
      detected: false,
      platform: null,
      confidence: 0,
      indicators: ['Image has EXIF data - not from social media']
    };
  }
  
  const platformScores = [];
  for (const [platform, config] of Object.entries(PLATFORM_SIGNATURES)) {
    const result = scorePlatformMatch(platform, config, metadata);
    if (result.score > 0) {
      platformScores.push({ platform, score: result.score, indicators: result.indicators });
    }
  }
  
  platformScores.sort((a, b) => b.score - a.score);
  
  if (platformScores.length === 0 || platformScores[0].score < 50) {
    return {
      detected: false,
      platform: null,
      confidence: platformScores.length > 0 ? platformScores[0].score : 0,
      indicators: ['No strong platform signature detected']
    };
  }
  
  const bestMatch = platformScores[0];
  return {
    detected: true,
    platform: bestMatch.platform,
    confidence: bestMatch.score,
    indicators: bestMatch.indicators
  };
}

function getPlatformDisplayName(platform) {
  const names = {
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    twitter: 'Twitter/X',
    facebook: 'Facebook',
    tiktok: 'TikTok'
  };
  return names[platform] || platform;
}

module.exports = {
  detectPlatform,
  getPlatformDisplayName,
  PLATFORM_SIGNATURES
};