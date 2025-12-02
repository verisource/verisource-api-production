/**
 * Video Authenticity Rescue
 * Reduces AI false positives for videos with authentic device signatures
 */

/**
 * Extract device signature from video metadata
 */
function extractVideoDeviceSignature(metadata) {
  const signature = {
    isAuthentic: false,
    confidence: 0,
    device: null,
    platform: null,
    indicators: []
  };

  if (!metadata) return signature;

  const tags = metadata.format_tags || metadata.tags || metadata;

  // Check for Android signature
  if (tags['com.android.version'] || tags['com.android.capture.fps']) {
    signature.isAuthentic = true;
    signature.platform = 'android';
    signature.device = `Android ${tags['com.android.version'] || 'device'}`;
    signature.confidence += 40;
    signature.indicators.push(`Android device detected (v${tags['com.android.version'] || 'unknown'})`);
    
    if (tags['com.android.capture.fps']) {
      signature.confidence += 10;
      signature.indicators.push(`Native capture FPS: ${tags['com.android.capture.fps']}`);
    }
  }

  // Check for iPhone/Apple signature
  if (tags['com.apple.quicktime.make'] || tags['com.apple.quicktime.model'] ||
      (tags['major_brand'] && tags['major_brand'].includes('qt')) ||
      tags['encoder']?.includes('Apple')) {
    signature.isAuthentic = true;
    signature.platform = 'ios';
    signature.device = tags['com.apple.quicktime.model'] || 'iPhone';
    signature.confidence += 40;
    signature.indicators.push(`Apple device detected: ${signature.device}`);
  }

  // Check for creation time (real videos have this)
  if (tags['creation_time']) {
    signature.confidence += 15;
    signature.indicators.push(`Creation timestamp: ${tags['creation_time']}`);
  }

  // Check handler names (real device videos have specific handlers)
  if (tags['handler_name'] === 'VideoHandle' || tags['handler_name'] === 'SoundHandle') {
    signature.confidence += 10;
    signature.indicators.push('Native video/audio handlers detected');
  }

  // Check for HEVC/H.265 (common in modern phones)
  if (metadata.codec_name === 'hevc' || metadata.codec_name === 'h265') {
    signature.confidence += 10;
    signature.indicators.push('HEVC codec (typical of modern smartphones)');
  }

  // Cap confidence at 95
  signature.confidence = Math.min(95, signature.confidence);
  signature.isAuthentic = signature.confidence >= 40;

  return signature;
}

/**
 * Apply video authenticity rescue to analysis results
 */
function applyVideoAuthenticityRescue(videoAnalysis, metadata) {
  if (!videoAnalysis || !videoAnalysis.analysis) {
    return videoAnalysis;
  }

  const signature = extractVideoDeviceSignature(metadata);
  
  if (!signature.isAuthentic) {
    return videoAnalysis;
  }

  const analysis = videoAnalysis.analysis;
  const originalVerdict = analysis.verdict;
  const originalAiPercentage = analysis.aiPercentage;

  // Calculate rescue reduction based on device confidence
  let reductionFactor = 0;
  if (signature.confidence >= 70) {
    reductionFactor = 0.6; // Reduce AI percentage by 60%
  } else if (signature.confidence >= 50) {
    reductionFactor = 0.45; // Reduce by 45%
  } else if (signature.confidence >= 40) {
    reductionFactor = 0.3; // Reduce by 30%
  }

  // Apply reduction to AI metrics
  const rescuedAiPercentage = Math.max(0, analysis.aiPercentage * (1 - reductionFactor));
  const rescuedAiFrames = Math.round(analysis.aiFrames * (1 - reductionFactor));

  // Determine new verdict
  let newVerdict = originalVerdict;
  if (rescuedAiPercentage < 30) {
    newVerdict = 'AUTHENTIC';
  } else if (rescuedAiPercentage < 50) {
    newVerdict = 'LIKELY_AUTHENTIC';
  } else if (rescuedAiPercentage < 70) {
    newVerdict = 'UNCERTAIN';
  }

  // Apply rescue
  analysis.pre_rescue_verdict = originalVerdict;
  analysis.pre_rescue_aiPercentage = originalAiPercentage;
  analysis.aiPercentage = Math.round(rescuedAiPercentage);
  analysis.aiFrames = rescuedAiFrames;
  analysis.verdict = newVerdict;
  
  analysis.video_rescue_applied = true;
  analysis.device_signature = signature;
  analysis.rescue_reduction = `${Math.round(reductionFactor * 100)}%`;

  console.log(`📱 Video rescue applied: ${signature.device} (${signature.confidence}% confidence)`);
  console.log(`   AI: ${originalAiPercentage}% → ${analysis.aiPercentage}%`);
  console.log(`   Verdict: ${originalVerdict} → ${newVerdict}`);

  return videoAnalysis;
}

module.exports = {
  extractVideoDeviceSignature,
  applyVideoAuthenticityRescue
};
