/**
 * Enhanced Video AI Scoring
 * Combines encoder fingerprinting, audio analysis, bitrate analysis, and GOP structure for better AI detection
 */
function applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis, gopAnalysis) {
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
    } else if (bitrateAnalysis.authenticScore >= 20) {
      // Lowered threshold from 25 to 20
      var bitrateReduction = Math.round(bitrateAnalysis.authenticScore * 0.25);
      totalReduction += bitrateReduction;
      adjustments.push('Natural bitrate variation (-' + bitrateReduction + '%)');
      result.bitrate_analysis.adjustment = '-' + bitrateReduction + '% AI confidence';
    }
  }
  
  // GOP structure scoring
  if (gopAnalysis && gopAnalysis.success) {
    result.gop_analysis = {
      iFramePercentage: gopAnalysis.details.percentages ? gopAnalysis.details.percentages.iFrame : null,
      bFramePercentage: gopAnalysis.details.percentages ? gopAnalysis.details.percentages.bFrame : null,
      gopLength: gopAnalysis.details.gopStats ? gopAnalysis.details.gopStats.commonLength : null,
      gopConsistency: gopAnalysis.details.gopStats ? Math.round(gopAnalysis.details.gopStats.consistency) : null,
      verdict: gopAnalysis.verdict,
      aiScore: gopAnalysis.aiScore,
      authenticScore: gopAnalysis.authenticScore,
      indicators: gopAnalysis.indicators,
      deviceMatch: gopAnalysis.deviceMatch || null
    };
    
    if (gopAnalysis.aiScore >= 40) {
      var gopBoost = Math.round(gopAnalysis.aiScore * 0.30);
      totalBoost += gopBoost;
      adjustments.push('Suspicious GOP structure (+' + gopBoost + '%)');
      result.gop_analysis.adjustment = '+' + gopBoost + '% AI confidence';
    } else if (gopAnalysis.authenticScore >= 25) {
      var gopReduction = Math.round(gopAnalysis.authenticScore * 0.25);
      totalReduction += gopReduction;
      adjustments.push('Authentic GOP pattern (-' + gopReduction + '%)');
      result.gop_analysis.adjustment = '-' + gopReduction + '% AI confidence';
    }
    
    // Special case: All I-frames is a very strong AI indicator
    if (gopAnalysis.details.percentages && gopAnalysis.details.percentages.iFrame >= 95) {
      totalBoost += 15;
      adjustments.push('All I-frames structure (+15%)');
    }
    
    // Special case: No B-frames combined with other signals
    if (gopAnalysis.details.frameCounts && gopAnalysis.details.frameCounts.B === 0) {
      if (audioAnalysis && !audioAnalysis.hasAudio) {
        totalBoost += 10;
        adjustments.push('No B-frames + no audio (+10%)');
      }
    }
  }
  
  // Combined signal bonus for AI indicators
  var encoderSuspicious = encoderAnalysis && encoderAnalysis.isLikelyAI;
  var audioSuspicious = audioAnalysis && (!audioAnalysis.hasAudio || audioAnalysis.aiScore >= 30);
  var bitrateSuspicious = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.aiScore >= 30;
  var gopSuspicious = gopAnalysis && gopAnalysis.success && gopAnalysis.aiScore >= 30;
  
  if (encoderSuspicious && audioSuspicious) {
    totalBoost += 15;
    adjustments.push('Combined encoder+audio suspicious (+15%)');
  }
  
  // Triple suspicious signal bonus
  if (encoderSuspicious && audioSuspicious && bitrateSuspicious) {
    totalBoost += 10;
    adjustments.push('Triple signal suspicious (+10%)');
  }
  
  // Quadruple suspicious signal bonus
  var suspiciousCount = [encoderSuspicious, audioSuspicious, bitrateSuspicious, gopSuspicious].filter(Boolean).length;
  if (suspiciousCount >= 4) {
    totalBoost += 15;
    adjustments.push('All signals suspicious (+15%)');
  } else if (suspiciousCount === 3 && gopSuspicious) {
    totalBoost += 8;
    adjustments.push('GOP + 2 signals suspicious (+8%)');
  }
  
  // Authenticity signals
  var encoderAuthentic = encoderAnalysis && encoderAnalysis.authenticScore >= 30;
  var audioAuthentic = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
  var bitrateAuthentic = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.authenticScore >= 20;
  var gopAuthentic = gopAnalysis && gopAnalysis.success && gopAnalysis.authenticScore >= 25;
  
  var authenticCount = [encoderAuthentic, audioAuthentic, bitrateAuthentic, gopAuthentic].filter(Boolean).length;
  if (authenticCount >= 3) {
    totalReduction += 15;
    adjustments.push('Multiple authentic signals (-15%)');
  }
  
  // Device GOP match bonus
  if (gopAnalysis && gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
    if (encoderAuthentic || audioAuthentic) {
      totalReduction += 10;
      adjustments.push('Device GOP + authentic signals (-10%)');
    }
  }
  
  // ============================================================
  // HIGH-CONFIDENCE DEVICE RESCUE (NEW)
  // When GOP strongly matches a device AND audio is present/authentic,
  // this is very strong evidence of a real recording
  // ============================================================
  if (gopAnalysis && gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
    var deviceConfidence = gopAnalysis.deviceMatch.confidence || 0;
    var hasAuthenticAudio = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
    var hasGoodGOP = gopAnalysis.authenticScore >= 50;
    
    // Very high confidence device match (90%+) with authentic audio
    if (deviceConfidence >= 90 && hasAuthenticAudio && hasGoodGOP) {
      // Calculate current score
      var currentScore = aiConfidence + totalBoost - totalReduction;
      
      // If still showing as AI despite strong device indicators, apply major rescue
      if (currentScore > 50) {
        var rescueAmount = Math.min(currentScore - 30, 35); // Bring down to at most 30%
        totalReduction += rescueAmount;
        adjustments.push('High-confidence device rescue (-' + rescueAmount + '%)');
      }
    }
    
    // Perfect device match (100%) with multiple authentic signals
    if (deviceConfidence >= 100 && hasAuthenticAudio && authenticCount >= 2) {
      var currentScoreAfter = aiConfidence + totalBoost - totalReduction;
      if (currentScoreAfter > 40) {
        var extraRescue = Math.min(currentScoreAfter - 25, 20);
        totalReduction += extraRescue;
        adjustments.push('Perfect device match rescue (-' + extraRescue + '%)');
      }
    }
  }
  // ============================================================
  
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
  
  // Higher floor for all-I-frame + no audio + suspicious encoder
  if (gopAnalysis && gopAnalysis.details && gopAnalysis.details.percentages && gopAnalysis.details.percentages.iFrame >= 95) {
    if (audioAnalysis && !audioAnalysis.hasAudio && encoderSuspicious) {
      var highFloor = 70;
      var currentWithBoosts = aiConfidence + totalBoost - totalReduction;
      if (currentWithBoosts < highFloor) {
        var highFloorBoost = highFloor - currentWithBoosts;
        totalBoost += highFloorBoost;
        adjustments.push('All-I-frame + no-audio floor (+' + highFloorBoost + '%)');
      }
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



