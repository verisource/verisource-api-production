/**
 * Enhanced Video AI Scoring
 * Combines encoder fingerprinting, audio analysis, and bitrate analysis for better AI detection
 */
function applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis) {
  if (!videoAnalysis) return videoAnalysis;
  
  var result = Object.assign({}, videoAnalysis);
  var totalBoost = 0;
  var totalReduction = 0;
  var adjustments = [];
  
  var aiConfidence = result.ai_confidence;
  if ((aiConfidence === null || aiConfidence === undefined || aiConfidence === 0) && result.analysis) {
    aiConfidence = result.analysis.aiPercentage || 0;
  }
  var originalConfidence = aiConfidence;
  
  // Encoder scoring
  if (encoderAnalysis) {
    result.encoder_analysis = Object.assign({}, encoderAnalysis);
    
    if (encoderAnalysis.isLikelyAI && encoderAnalysis.aiScore >= 40) {
      var encoderBoost = encoderAnalysis.aiScore >= 70 ? 35 : (encoderAnalysis.aiScore >= 50 ? 25 : 18);
      totalBoost += encoderBoost;
      adjustments.push('Suspicious encoder (+' + encoderBoost + '%)');
      result.encoder_analysis.adjustment = '+' + encoderBoost + '% AI confidence';
    } else if (encoderAnalysis.authenticScore >= 30) {
      var reduction = Math.round(encoderAnalysis.authenticScore * 0.5);
      totalReduction += reduction;
      adjustments.push('Authentic encoder (-' + reduction + '%)');
      result.encoder_analysis.adjustment = '-' + reduction + '% AI confidence';
    }
  }
  
  // Audio scoring
  if (audioAnalysis) {
    result.audio_analysis = {
      hasAudio: audioAnalysis.hasAudio,
      aiScore: audioAnalysis.aiScore,
      authenticScore: audioAnalysis.authenticScore,
      verdict: audioAnalysis.verdict,
      indicators: audioAnalysis.indicators,
      suspiciousPatterns: audioAnalysis.suspiciousPatterns
    };
    
    if (!audioAnalysis.hasAudio) {
      totalBoost += 20;
      adjustments.push('No audio track (+20%)');
      result.audio_analysis.adjustment = '+20% AI confidence (no audio)';
    } else if (audioAnalysis.aiScore >= 40) {
      var audioBoost = Math.round(audioAnalysis.aiScore * 0.35);
      totalBoost += audioBoost;
      adjustments.push('Suspicious audio (+' + audioBoost + '%)');
      result.audio_analysis.adjustment = '+' + audioBoost + '% AI confidence';
    } else if (audioAnalysis.authenticScore >= 30) {
      var audioReduction = Math.round(audioAnalysis.authenticScore * 0.35);
      totalReduction += audioReduction;
      adjustments.push('Authentic audio (-' + audioReduction + '%)');
      result.audio_analysis.adjustment = '-' + audioReduction + '% AI confidence';
    }
  }
  
  // Bitrate scoring
  if (bitrateAnalysis && bitrateAnalysis.success) {
    result.bitrate_analysis = {
      cv: bitrateAnalysis.stats.cv,
      similarityRatio: bitrateAnalysis.stats.similarityRatio,
      avgFrameChange: bitrateAnalysis.stats.avgFrameChange,
      verdict: bitrateAnalysis.verdict,
      aiScore: bitrateAnalysis.aiScore,
      authenticScore: bitrateAnalysis.authenticScore,
      indicators: bitrateAnalysis.indicators
    };
    
    if (bitrateAnalysis.aiScore >= 40) {
      var bitrateBoost = Math.round(bitrateAnalysis.aiScore * 0.25);
      totalBoost += bitrateBoost;
      adjustments.push('Suspicious bitrate pattern (+' + bitrateBoost + '%)');
      result.bitrate_analysis.adjustment = '+' + bitrateBoost + '% AI confidence';
    } else if (bitrateAnalysis.authenticScore >= 25) {
      var bitrateReduction = Math.round(bitrateAnalysis.authenticScore * 0.2);
      totalReduction += bitrateReduction;
      adjustments.push('Natural bitrate variation (-' + bitrateReduction + '%)');
      result.bitrate_analysis.adjustment = '-' + bitrateReduction + '% AI confidence';
    }
  }
  
  // Combined signal bonus
  var encoderSuspicious = encoderAnalysis && encoderAnalysis.isLikelyAI;
  var audioSuspicious = audioAnalysis && (!audioAnalysis.hasAudio || audioAnalysis.aiScore >= 30);
  var bitrateSuspicious = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.aiScore >= 30;
  
  if (encoderSuspicious && audioSuspicious) {
    totalBoost += 15;
    adjustments.push('Combined encoder+audio suspicious (+15%)');
  }
  
  // Triple suspicious signal bonus
  if (encoderSuspicious && audioSuspicious && bitrateSuspicious) {
    totalBoost += 10;
    adjustments.push('Triple signal suspicious (+10%)');
  }
  
  // Minimum floor for clear AI signals
  if (encoderSuspicious && audioAnalysis && !audioAnalysis.hasAudio) {
    var minFloor = 50;
    var currentScore = aiConfidence + totalBoost - totalReduction;
    if (currentScore < minFloor) {
      var floorBoost = minFloor - currentScore;
      totalBoost += floorBoost;
      adjustments.push('No-audio + suspicious encoder floor (+' + floorBoost + '%)');
    }
  }
  
  // Apply final score
  aiConfidence = aiConfidence + totalBoost - totalReduction;
  aiConfidence = Math.max(0, Math.min(100, aiConfidence));
  
  result.ai_confidence = aiConfidence;
  result.ai_confidence_original = originalConfidence;
  result.ai_adjustments = adjustments;
  
  // Update verdict
  if (aiConfidence >= 70) {
    result.verdict = 'LIKELY_AI_GENERATED';
  } else if (aiConfidence >= 50) {
    result.verdict = 'POSSIBLY_AI';
  } else if (aiConfidence >= 30) {
    result.verdict = 'UNCERTAIN';
  } else {
    result.verdict = 'LIKELY_AUTHENTIC';
  }
  
  return result;
}

module.exports = { applyEnhancedVideoScoring };
