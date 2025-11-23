/**
 * AI Detection Router
 * Smart routing between local heuristics and external API
 * 
 * Strategy:
 * - Always run local heuristics (free, fast)
 * - Only call external API when:
 *   1. User is on paid tier
 *   2. Local result is uncertain
 *   3. Result not already cached
 */

const externalAI = require('./external-ai-detection');

/**
 * Detect AI with smart routing
 * @param {Object} params - Detection parameters
 * @returns {Promise<Object>} Detection results
 */
async function detectWithRouting(params) {
  const {
    filePathOrUrl,
    hash,
    metadata,
    userTier = 'free',
    mediaType = 'image'
  } = params;

  const result = {
    local: null,
    external: null,
    combined: null,
    routing: {
      local_executed: true,
      external_executed: false,
      external_skipped_reason: null
    }
  };

  // Step 1: Always run local heuristics
  result.local = runLocalHeuristics(metadata, mediaType);
  result.routing.local_executed = true;

  // Step 2: Decide if we should call external API
  const shouldCallExternal = decideExternalCall(
    result.local,
    userTier,
    hash
  );

  if (shouldCallExternal.call) {
    // Call external API
    try {
      result.external = await externalAI.detectAI(
        filePathOrUrl,
        hash,
        mediaType
      );
      result.routing.external_executed = true;
    } catch (error) {
      console.error('External AI detection failed:', error);
      result.routing.external_skipped_reason = 'api_error';
      result.routing.external_error = error.message;
    }
  } else {
    result.routing.external_skipped_reason = shouldCallExternal.reason;
  }

  // Step 3: Combine results
  result.combined = combineResults(result.local, result.external);

  return result;
}

/**
 * Run local heuristic detection
 */
function runLocalHeuristics(metadata, mediaType) {
  let confidence = 50; // Start neutral
  const indicators = [];
  
  const exif = metadata?.exif || {};
  const format = metadata?.format || '';
  const width = metadata?.width || 0;
  const height = metadata?.height || 0;

  // Check 1: AI software in EXIF (definitive)
  const exifString = JSON.stringify(exif).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney'];
  
  if (aiSoftware.some(sw => exifString.includes(sw))) {
    return {
      confidence: 0,
      result: 'ai_generated',
      certainty: 'high',
      indicators: ['AI generation software detected in metadata']
    };
  }

  // Check 2: Strong camera metadata (definitive authentic)
  if (exif.Make && exif.Model) {
    confidence = 95;
    indicators.push(`Camera detected: ${exif.Make} ${exif.Model}`);
    return {
      confidence: 95,
      result: 'authentic',
      certainty: 'high',
      indicators
    };
  }

  // Check 3: Known AI dimensions
  const aiDimensions = [
    [1024, 1024], [512, 512], [768, 768],
    [1024, 768], [768, 1024], [2048, 2048]
  ];

  const isAIDimension = aiDimensions.some(([w, h]) => 
    Math.abs(width - w) < 10 && Math.abs(height - h) < 10
  );

  if (isAIDimension && format === 'png' && !exif.Make) {
    confidence = 20;
    indicators.push('AI-typical dimensions + PNG without camera data');
    return {
      confidence: 20,
      result: 'likely_ai',
      certainty: 'medium',
      indicators
    };
  }

  // Check 4: PNG without metadata (suspicious)
  if (format === 'png' && (!exif || Object.keys(exif).length < 3)) {
    confidence = 35;
    indicators.push('PNG without metadata - suspicious');
  }

  // Uncertain - would benefit from external API
  indicators.push('Local detection uncertain - recommend external verification');
  return {
    confidence,
    result: 'uncertain',
    certainty: 'low',
    indicators
  };
}

/**
 * Decide whether to call external API
 */
function decideExternalCall(localResult, userTier, hash) {
  // Rule 1: Free tier never gets external API
  if (userTier === 'free') {
    return {
      call: false,
      reason: 'free_tier'
    };
  }

  // Rule 2: Local is certain - skip external
  if (localResult.certainty === 'high') {
    return {
      call: false,
      reason: 'local_certain'
    };
  }

  // Rule 3: Paid tier + uncertain = call external
  if (userTier === 'paid' || userTier === 'premium') {
    return {
      call: true,
      reason: 'paid_tier_verification'
    };
  }

  // Default: don't call
  return {
    call: false,
    reason: 'default_skip'
  };
}

/**
 * Combine local and external results
 */
function combineResults(local, external) {
  if (!external) {
    // Only local available
    return {
      confidence: local.confidence,
      result: local.result,
      source: 'local_only',
      certainty: local.certainty
    };
  }

  // Both available - external takes precedence
  return {
    confidence: external.authentic_confidence || external.confidence,
    result: external.result,
    source: 'external',
    certainty: 'high',
    local_agreed: Math.abs(local.confidence - external.confidence) < 20
  };
}

module.exports = {
  detectWithRouting,
  runLocalHeuristics
};
