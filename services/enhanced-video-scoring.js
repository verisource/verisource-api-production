/**
 * Enhanced Video AI Scoring
 * Combines encoder, audio, bitrate, GOP, and motion analysis
 */
function applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis, gopAnalysis, motionAnalysis) {
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
  
  // === CHECK FOR FACE-BASED AI SIGNALS ===
  var deepfakeDetected = result.analysis?.deepfakeDetection?.detected || false;
  var deepfakeScore = result.analysis?.deepfakeDetection?.confidence || 0;
  var aiFacePercent = result.analysis?.deepfakeDetection?.aiFacePercentage || 0;
  var facesAnalyzed = result.analysis?.deepfakeDetection?.facesAnalyzed || 0;
  
  var hasAIFaceSignal = (deepfakeDetected && deepfakeScore >= 50) || 
                        (aiFacePercent >= 20 && facesAnalyzed >= 10);
  var faceFloor = 0;
  
  if (deepfakeDetected && deepfakeScore >= 50) {
    faceFloor = 60;
    adjustments.push('Deepfake floor: 60%');
  } else if (aiFacePercent >= 20 && facesAnalyzed >= 10) {
    faceFloor = 45;
    adjustments.push('AI faces floor: 45% (' + aiFacePercent + '% AI faces)');
  }
  
  // === MOTION ANALYSIS (NEW) ===
  var hasMotionAISignal = false;
  if (motionAnalysis && motionAnalysis.success) {
    result.motion_analysis = {
      avgFrameDiff: motionAnalysis.opticalFlow.avgFrameDiff,
      flickerRatio: motionAnalysis.correlation.flickerRatio,
      aiScore: motionAnalysis.aiScore,
      authenticScore: motionAnalysis.authenticScore,
      verdict: motionAnalysis.verdict
    };
    
    if (motionAnalysis.verdict === 'LIKELY_AI') {
      totalBoost += 18;
      adjustments.push('Motion: LIKELY_AI (+18%)');
      hasMotionAISignal = true;
    } else if (motionAnalysis.verdict === 'POSSIBLY_AI') {
      totalBoost += 10;
      adjustments.push('Motion: POSSIBLY_AI (+10%)');
      hasMotionAISignal = true;
    } else if (motionAnalysis.verdict === 'LIKELY_AUTHENTIC' && !hasAIFaceSignal) {
      totalReduction += 12;
      adjustments.push('Motion: LIKELY_AUTHENTIC (-12%)');
    } else if (motionAnalysis.verdict === 'POSSIBLY_AUTHENTIC' && !hasAIFaceSignal) {
      totalReduction += 6;
      adjustments.push('Motion: POSSIBLY_AUTHENTIC (-6%)');
    }
    
    // Strong motion AI signal creates floor
    if (motionAnalysis.aiScore >= 35 && motionAnalysis.authenticScore <= 5) {
      if (faceFloor < 40) {
        faceFloor = 40;
        adjustments.push('Motion floor: 40%');
      }
    }
  }
  
  // === ENCODER SCORING ===
  if (encoderAnalysis) {
    result.encoder_analysis = Object.assign({}, encoderAnalysis);
    
    if (encoderAnalysis.isLikelyAI && encoderAnalysis.aiScore >= 40) {
      var encoderBoost = encoderAnalysis.aiScore >= 70 ? 35 : (encoderAnalysis.aiScore >= 50 ? 25 : 18);
      totalBoost += encoderBoost;
      adjustments.push('Suspicious encoder (+' + encoderBoost + '%)');
    } else if (encoderAnalysis.authenticScore >= 30 && !hasAIFaceSignal && !hasMotionAISignal) {
      var reduction = Math.round(encoderAnalysis.authenticScore * 0.5);
      totalReduction += reduction;
      adjustments.push('Authentic encoder (-' + reduction + '%)');
    }
  }
  
  // === AUDIO SCORING ===
  if (audioAnalysis) {
    result.audio_analysis = {
      hasAudio: audioAnalysis.hasAudio,
      aiScore: audioAnalysis.aiScore,
      authenticScore: audioAnalysis.authenticScore,
      verdict: audioAnalysis.verdict
    };
    
    if (!audioAnalysis.hasAudio) {
      totalBoost += 20;
      adjustments.push('No audio (+20%)');
    } else if (audioAnalysis.aiScore >= 40) {
      var audioBoost = Math.round(audioAnalysis.aiScore * 0.35);
      totalBoost += audioBoost;
      adjustments.push('Suspicious audio (+' + audioBoost + '%)');
    } else if (audioAnalysis.authenticScore >= 30 && !hasAIFaceSignal && !hasMotionAISignal) {
      var audioReduction = Math.round(audioAnalysis.authenticScore * 0.35);
      totalReduction += audioReduction;
      adjustments.push('Authentic audio (-' + audioReduction + '%)');
    }
  }
  
  // === BITRATE SCORING ===
  if (bitrateAnalysis && bitrateAnalysis.success) {
    result.bitrate_analysis = {
      cv: bitrateAnalysis.stats.cv,
      verdict: bitrateAnalysis.verdict,
      aiScore: bitrateAnalysis.aiScore,
      authenticScore: bitrateAnalysis.authenticScore
    };
    
    if (bitrateAnalysis.aiScore >= 40) {
      var bitrateBoost = Math.round(bitrateAnalysis.aiScore * 0.25);
      totalBoost += bitrateBoost;
      adjustments.push('Suspicious bitrate (+' + bitrateBoost + '%)');
    } else if (bitrateAnalysis.authenticScore >= 20 && !hasAIFaceSignal && !hasMotionAISignal) {
      var bitrateReduction = Math.round(bitrateAnalysis.authenticScore * 0.25);
      totalReduction += bitrateReduction;
      adjustments.push('Natural bitrate (-' + bitrateReduction + '%)');
    }
  }
  
  // === GOP SCORING ===
  if (gopAnalysis && gopAnalysis.success) {
    result.gop_analysis = {
      iFramePercentage: gopAnalysis.details.percentages ? gopAnalysis.details.percentages.iFrame : null,
      bFramePercentage: gopAnalysis.details.percentages ? gopAnalysis.details.percentages.bFrame : null,
      gopLength: gopAnalysis.details.gopStats ? gopAnalysis.details.gopStats.commonLength : null,
      verdict: gopAnalysis.verdict,
      aiScore: gopAnalysis.aiScore,
      authenticScore: gopAnalysis.authenticScore,
      deviceMatch: gopAnalysis.deviceMatch || null
    };
    
    if (gopAnalysis.aiScore >= 40) {
      var gopBoost = Math.round(gopAnalysis.aiScore * 0.30);
      totalBoost += gopBoost;
      adjustments.push('Suspicious GOP (+' + gopBoost + '%)');
    } else if (gopAnalysis.authenticScore >= 25 && !hasAIFaceSignal && !hasMotionAISignal) {
      var gopReduction = Math.round(gopAnalysis.authenticScore * 0.25);
      totalReduction += gopReduction;
      adjustments.push('Authentic GOP (-' + gopReduction + '%)');
    }
    
    if (gopAnalysis.details.percentages && gopAnalysis.details.percentages.iFrame >= 95) {
      totalBoost += 15;
      adjustments.push('All I-frames (+15%)');
    }
  }
  
  // === COMBINED SIGNALS ===
  var encoderSuspicious = encoderAnalysis && encoderAnalysis.isLikelyAI;
  var audioSuspicious = audioAnalysis && (!audioAnalysis.hasAudio || audioAnalysis.aiScore >= 30);
  
  if (encoderSuspicious && audioSuspicious) {
    totalBoost += 15;
    adjustments.push('Encoder+audio suspicious (+15%)');
  }
  
  // Motion + other AI signals
  if (hasMotionAISignal && (encoderSuspicious || audioSuspicious)) {
    totalBoost += 10;
    adjustments.push('Motion+encoding suspicious (+10%)');
  }
  
  // === AUTHENTICITY BONUSES (only if no AI signals) ===
  if (!hasAIFaceSignal && !hasMotionAISignal) {
    var encoderAuthentic = encoderAnalysis && encoderAnalysis.authenticScore >= 30;
    var audioAuthentic = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
    var bitrateAuthentic = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.authenticScore >= 20;
    var gopAuthentic = gopAnalysis && gopAnalysis.success && gopAnalysis.authenticScore >= 25;
    var motionAuthentic = motionAnalysis && motionAnalysis.success && motionAnalysis.verdict === 'LIKELY_AUTHENTIC';
    
    var authenticCount = [encoderAuthentic, audioAuthentic, bitrateAuthentic, gopAuthentic, motionAuthentic].filter(Boolean).length;
    if (authenticCount >= 3) {
      totalReduction += 15;
      adjustments.push('Multiple authentic (' + authenticCount + '/5) (-15%)');
    }
    
    if (gopAnalysis && gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
      if (encoderAuthentic || audioAuthentic) {
        totalReduction += 10;
        adjustments.push('Device GOP match (-10%)');
      }
      
      if (gopAnalysis.deviceMatch.confidence >= 90) {
        var hasAuthAudio = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
        var hasGoodGOP = gopAnalysis.authenticScore >= 50;
        if (hasAuthAudio && hasGoodGOP) {
          var currentScore = aiConfidence + totalBoost - totalReduction;
          if (currentScore > 50) {
            var rescueAmount = Math.min(currentScore - 30, 35);
            totalReduction += rescueAmount;
            adjustments.push('Device rescue (-' + rescueAmount + '%)');
          }
        }
      }
    }
  }
  
  // === NO-AUDIO FLOOR ===
  if (encoderSuspicious && audioAnalysis && !audioAnalysis.hasAudio) {
    var currentScore = aiConfidence + totalBoost - totalReduction;
    if (currentScore < 50) {
      var floorBoost = 50 - currentScore;
      totalBoost += floorBoost;
      adjustments.push('No-audio floor (+' + floorBoost + '%)');
    }
  }
  
  // === APPLY FINAL SCORE ===
  aiConfidence = aiConfidence + totalBoost - totalReduction;
  
  // Apply face/motion floor
  if (faceFloor > 0 && aiConfidence < faceFloor) {
    adjustments.push('Floor applied: ' + Math.round(aiConfidence) + '% → ' + faceFloor + '%');
    aiConfidence = faceFloor;
  }
  
  aiConfidence = Math.max(0, Math.min(100, Math.round(aiConfidence)));
  
  result.ai_confidence = aiConfidence;
  result.ai_confidence_original = originalConfidence;
  result.ai_adjustments = adjustments;
  
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
