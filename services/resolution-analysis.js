/**
 * Resolution Analysis for AI Video Detection
 * 
 * AI generators output specific non-standard resolutions:
 * - Sora: 352x640 (NOT 360x640 which is standard)
 * - Runway: 1280x768
 * - Pika: 1024x576
 */

// Standard resolutions - these are REAL camera/phone outputs
const STANDARD_RESOLUTIONS = [
  // 16:9 Landscape
  [3840, 2160], [2560, 1440], [1920, 1080], [1280, 720], [854, 480], [640, 360],
  
  // 9:16 Vertical (mobile) - IMPORTANT: phones actually output these
  [2160, 3840], [1440, 2560], [1080, 1920], [720, 1280], [480, 854], [360, 640],
  
  // 4:3
  [1440, 1080], [1024, 768], [800, 600], [640, 480],
  
  // 1:1 Square
  [1080, 1080], [720, 720], [480, 480],
  
  // Cinema
  [2048, 858], [1920, 800], [1920, 816],
];

// Known AI tool resolutions - must be EXACT matches (not standard)
const AI_TOOL_RESOLUTIONS = [
  // Sora specific - notably NOT 360x640 or 480x854 which are standard
  { width: 352, height: 640, tool: 'Sora', confidence: 90 },
  { width: 640, height: 352, tool: 'Sora', confidence: 90 },
  
  // Runway
  { width: 1280, height: 768, tool: 'Runway', confidence: 85 },
  { width: 768, height: 1280, tool: 'Runway', confidence: 85 },
  { width: 1024, height: 576, tool: 'Runway/Pika', confidence: 80 },
  { width: 576, height: 1024, tool: 'Runway/Pika', confidence: 80 },
  
  // Legacy AI (very small)
  { width: 512, height: 512, tool: 'Legacy AI', confidence: 90 },
  { width: 768, height: 768, tool: 'Legacy AI', confidence: 85 },
];

/**
 * Check if resolution is standard (real cameras output these)
 */
function isStandardResolution(width, height) {
  const tolerance = 4; // Small tolerance for encoding variations
  
  for (const [stdW, stdH] of STANDARD_RESOLUTIONS) {
    if (Math.abs(width - stdW) <= tolerance && Math.abs(height - stdH) <= tolerance) {
      return { isStandard: true, matchedResolution: `${stdW}x${stdH}` };
    }
  }
  
  return { isStandard: false };
}

/**
 * Check if resolution matches known AI tool (exact match only)
 */
function matchAIToolResolution(width, height) {
  const tolerance = 2; // Very tight - AI tools output exact sizes
  
  for (const ai of AI_TOOL_RESOLUTIONS) {
    if (Math.abs(width - ai.width) <= tolerance && Math.abs(height - ai.height) <= tolerance) {
      return {
        matched: true,
        tool: ai.tool,
        confidence: ai.confidence
      };
    }
  }
  
  return { matched: false };
}

/**
 * Analyze resolution for AI indicators
 */
function analyzeResolution(videoMeta) {
  const result = {
    success: true,
    width: null,
    height: null,
    aspectRatio: null,
    isStandard: false,
    aiToolMatch: null,
    aiScore: 0,
    authenticScore: 0,
    indicators: [],
    verdict: 'UNKNOWN'
  };
  
  const videoStream = videoMeta?.streams?.find(s => s.codec_type === 'video');
  if (!videoStream) {
    result.success = false;
    result.error = 'No video stream found';
    return result;
  }
  
  const width = videoStream.width;
  const height = videoStream.height;
  const aspectRatio = width / height;
  
  result.width = width;
  result.height = height;
  result.aspectRatio = Math.round(aspectRatio * 100) / 100;
  
  // FIRST: Check for exact AI tool resolution match
  const aiMatch = matchAIToolResolution(width, height);
  if (aiMatch.matched) {
    result.aiToolMatch = aiMatch;
    result.aiScore += aiMatch.confidence;
    result.indicators.push(`AI resolution: ${aiMatch.tool} (${width}x${height})`);
    result.verdict = 'LIKELY_AI';
    return result; // Early return - definitive AI match
  }
  
  // SECOND: Check if it's a standard resolution
  const standardCheck = isStandardResolution(width, height);
  result.isStandard = standardCheck.isStandard;
  
  if (standardCheck.isStandard) {
    result.authenticScore += 20;
    result.indicators.push(`Standard resolution: ${standardCheck.matchedResolution}`);
    result.verdict = 'LIKELY_AUTHENTIC';
    return result;
  }
  
  // THIRD: Non-standard, non-AI resolution - evaluate
  // Check how far from nearest standard
  let minDistance = Infinity;
  for (const [stdW, stdH] of STANDARD_RESOLUTIONS) {
    const dist = Math.sqrt(Math.pow(width - stdW, 2) + Math.pow(height - stdH, 2));
    if (dist < minDistance) minDistance = dist;
  }
  
  if (minDistance > 100) {
    // Very unusual resolution
    result.aiScore += 30;
    result.indicators.push(`Unusual resolution: ${width}x${height}`);
    result.verdict = 'LIKELY_AI';
  } else if (minDistance > 30) {
    // Moderately unusual
    result.aiScore += 15;
    result.indicators.push(`Non-standard resolution: ${width}x${height}`);
    result.verdict = 'POSSIBLY_AI';
  } else {
    // Close to standard, probably just encoding variation
    result.authenticScore += 5;
    result.indicators.push(`Near-standard: ${width}x${height}`);
    result.verdict = 'INCONCLUSIVE';
  }
  
  return result;
}

function getResolutionSummary(result) {
  if (!result.success) return 'unavailable';
  return `${result.width}x${result.height} → ${result.verdict}`;
}

module.exports = {
  analyzeResolution,
  isStandardResolution,
  matchAIToolResolution,
  getResolutionSummary,
  STANDARD_RESOLUTIONS,
  AI_TOOL_RESOLUTIONS
};
