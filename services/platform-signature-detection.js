/**
 * Platform Signature Detection Service
 * Detects if an image was shared through social media platforms
 * based on compression signatures, dimensions, metadata patterns,
 * and filename conventions.
 */

const PLATFORM_SIGNATURES = {
  instagram: {
    maxWidths: [1080, 1440, 1920],
    jpegQuality: [70, 85],
    exifStripped: true,
    aspectRatios: [1, 1.91, 0.8],
    aspectTolerance: 0.05,
    filenamePatterns: [
      /^\d{11,}_\d{15,}_\d{19,}_n\.jpg$/i,           // Instagram CDN format
      /^\d+_\d+_\d+_\d+\.jpg$/i,                      // Alternative numeric format
      /^[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+_n\.(jpg|jpeg)$/i  // Generic Instagram pattern
    ]
  },
  whatsapp: {
    maxWidths: [1280, 1600],
    jpegQuality: [55, 70],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0,
    filenamePatterns: [
      /^IMG-\d{8}-WA\d{4}\.(jpg|jpeg)$/i,            // IMG-20230615-WA0042.jpg
      /^WhatsApp Image \d{4}-\d{2}-\d{2}/i,          // WhatsApp Image 2023-06-15
      /^PTT-\d{8}-WA\d{4}/i                          // Voice note thumbnails
    ]
  },
  twitter: {
    maxWidths: [1200, 2048, 4096],
    jpegQuality: [75, 90],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0,
    filenamePatterns: [
      /^[A-Za-z0-9_-]{15}\.(jpg|jpeg|png)$/i,        // Twitter media ID format
      /^(E|F)[A-Za-z0-9_-]{13}\.(jpg|jpeg|png)$/i,   // Newer Twitter format
      /^media_[A-Za-z0-9_-]+\.(jpg|jpeg)$/i          // Downloaded media format
    ]
  },
  facebook: {
    maxWidths: [960, 1200, 2048],
    jpegQuality: [70, 85],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0,
    filenamePatterns: [
      /^FB_IMG_\d{13,}\.(jpg|jpeg)$/i,               // FB_IMG_1234567890123.jpg
      /^\d+_\d+_\d+_(o|n)\.(jpg|jpeg)$/i,            // Facebook CDN format
      /^received_\d+\.(jpg|jpeg)$/i                  // Messenger received files
    ]
  },
  tiktok: {
    maxWidths: [1080],
    jpegQuality: [60, 80],
    exifStripped: true,
    aspectRatios: [0.5625],  // 9:16 portrait
    aspectTolerance: 0.03,
    filenamePatterns: [
      /^tiktok_\d+\.(jpg|jpeg|png)$/i,               // TikTok download
      /^snaptik[_-]?\d*\.(jpg|jpeg|png)$/i           // Third-party TikTok downloaders
    ]
  },
  telegram: {
    maxWidths: [1280, 2560],
    jpegQuality: [75, 90],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0,
    filenamePatterns: [
      /^photo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(jpg|jpeg)$/i,  // photo_2023-06-15_12-30-45.jpg
      /^image_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(jpg|jpeg)$/i   // Alternative format
    ]
  },
  discord: {
    maxWidths: [4000],
    jpegQuality: [80, 95],
    exifStripped: true,
    aspectRatios: null,
    aspectTolerance: 0,
    filenamePatterns: [
      /^\d{17,19}_\d+\.(jpg|jpeg|png)$/i,            // Discord snowflake ID format
      /^unknown\.(png|jpg|jpeg)$/i,                   // Discord unnamed files
      /^image\d*\.(png|jpg|jpeg)$/i                   // Generic Discord download
    ]
  },
  snapchat: {
    maxWidths: [1080],
    jpegQuality: [60, 80],
    exifStripped: true,
    aspectRatios: [0.5625],  // 9:16 portrait
    aspectTolerance: 0.03,
    filenamePatterns: [
      /^Snapchat-\d+\.(jpg|jpeg)$/i,                 // Snapchat-1234567890.jpg
      /^snap-\d+-\d+\.(jpg|jpeg)$/i                  // Alternative format
    ]
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

/**
 * Match filename against platform-specific patterns
 * @param {string} filename - The filename to check
 * @param {RegExp[]} patterns - Array of regex patterns for the platform
 * @returns {Object} - Match result with matched flag and pattern
 */
function matchFilename(filename, patterns) {
  if (!filename || !patterns || patterns.length === 0) {
    return { matched: false, pattern: null };
  }
  
  // Extract just the filename if a full path was provided
  const basename = filename.split(/[/\\]/).pop();
  
  for (const pattern of patterns) {
    if (pattern.test(basename)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false, pattern: null };
}

/**
 * Score how well image metadata matches a platform's signature
 * Scoring breakdown (total 100 points):
 * - EXIF stripped: 25 points (required for social media)
 * - Width match: 30 points
 * - Filename match: 25 points
 * - JPEG quality: 10 points
 * - Aspect ratio: 10 points
 */
function scorePlatformMatch(platform, config, metadata) {
  const { width, height, jpegQuality, hasExif, filename } = metadata;
  let score = 0;
  const indicators = [];
  
  // EXIF check - required (25 points)
  if (config.exifStripped && !hasExif) {
    score += 25;
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
  
  // Filename pattern matching (15 points)
  if (config.filenamePatterns && filename) {
    const filenameMatch = matchFilename(filename, config.filenamePatterns);
    if (filenameMatch.matched) {
      score += 15;
      indicators.push(`Filename pattern match`);
    }
  }
  
  // JPEG quality matching (10 points)
  if (config.jpegQuality && jpegQuality) {
    const qualityMatch = matchQuality(jpegQuality, config.jpegQuality);
    if (qualityMatch.matched) {
      score += 10;
      indicators.push(`JPEG quality ${jpegQuality}`);
    }
  }
  
  // Aspect ratio matching (10 points)
  if (config.aspectRatios && width && height) {
    const aspectMatch = matchAspectRatio(width, height, config.aspectRatios, config.aspectTolerance);
    if (aspectMatch.matched) {
      score += 10;
      indicators.push(`Aspect ratio ${aspectMatch.ratio.toFixed(2)}`);
    }
  }
  
  return { score, indicators };
}

/**
 * Detect which social media platform an image was shared through
 * @param {string} filePath - Path to the image file
 * @param {Object} metadata - Image metadata object
 * @param {number} metadata.width - Image width
 * @param {number} metadata.height - Image height  
 * @param {number} metadata.jpegQuality - Estimated JPEG quality
 * @param {boolean} metadata.hasExif - Whether image has EXIF data
 * @param {string} [metadata.filename] - Original filename (optional but improves detection)
 * @param {Object} [metadata.exifData] - EXIF data object
 * @param {Buffer} [metadata.iptcData] - IPTC data buffer
 * @returns {Object} Detection result
 */
async function detectPlatform(filePath, metadata) {
  // Check for Facebook metadata signature (definitive)
  if ((metadata.iptcData && Buffer.from(metadata.iptcData).toString().includes("FBMD")) || 
      metadata.exifData?.["Special Instructions"]?.includes("FBMD")) {
    return {
      detected: true,
      platform: "facebook",
      confidence: 95,
      indicators: ["Facebook metadata signature (FBMD) detected"]
    };
  }

  // Try to extract filename from filePath if not provided
  const filename = metadata.filename || (filePath ? filePath.split(/[/\\]/).pop() : null);
  const metadataWithFilename = { ...metadata, filename };

  const { hasExif } = metadata;
  
  // Images with EXIF are unlikely to be from social media
  if (hasExif) {
    return {
      detected: false,
      platform: null,
      confidence: 0,
      indicators: ['Image has EXIF data - not from social media']
    };
  }
  
  // Score each platform
  const platformScores = [];
  for (const [platform, config] of Object.entries(PLATFORM_SIGNATURES)) {
    const result = scorePlatformMatch(platform, config, metadataWithFilename);
    if (result.score > 0) {
      platformScores.push({ platform, score: result.score, indicators: result.indicators });
    }
  }
  
  // Sort by score descending
  platformScores.sort((a, b) => b.score - a.score);
  
  // Require minimum confidence threshold
  if (platformScores.length === 0 || platformScores[0].score < 50) {
    return {
      detected: false,
      platform: null,
      confidence: platformScores.length > 0 ? platformScores[0].score : 0,
      indicators: platformScores.length > 0 
        ? [`Weak match: ${platformScores[0].platform} (${platformScores[0].score}%)`]
        : ['No platform signature detected'],
      candidates: platformScores.slice(0, 3).map(p => ({
        platform: p.platform,
        score: p.score
      }))
    };
  }
  
  const bestMatch = platformScores[0];
  
  // Check if there's ambiguity between top matches
  const secondMatch = platformScores[1];
  const isAmbiguous = secondMatch && (bestMatch.score - secondMatch.score) < 10;
  
  return {
    detected: true,
    platform: bestMatch.platform,
    confidence: bestMatch.score,
    indicators: bestMatch.indicators,
    ambiguous: isAmbiguous,
    candidates: isAmbiguous ? platformScores.slice(0, 3).map(p => ({
      platform: p.platform,
      score: p.score
    })) : undefined
  };
}

/**
 * Get display-friendly platform name
 * @param {string} platform - Platform identifier
 * @returns {string} Display name
 */
function getPlatformDisplayName(platform) {
  const names = {
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    twitter: 'Twitter/X',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    telegram: 'Telegram',
    discord: 'Discord',
    snapchat: 'Snapchat'
  };
  return names[platform] || platform;
}

/**
 * Quick check if filename matches any known platform pattern
 * Useful for fast pre-filtering before full analysis
 * @param {string} filename - Filename to check
 * @returns {Object} Quick match result
 */
function quickFilenameCheck(filename) {
  if (!filename) return { matched: false, platform: null };
  
  for (const [platform, config] of Object.entries(PLATFORM_SIGNATURES)) {
    if (config.filenamePatterns) {
      const match = matchFilename(filename, config.filenamePatterns);
      if (match.matched) {
        return { matched: true, platform, pattern: match.pattern };
      }
    }
  }
  return { matched: false, platform: null };
}

module.exports = {
  detectPlatform,
  getPlatformDisplayName,
  quickFilenameCheck,
  matchFilename,
  PLATFORM_SIGNATURES
};