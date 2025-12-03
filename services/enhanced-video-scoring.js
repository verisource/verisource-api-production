/**
 * Enhanced Video AI Scoring
 * Combines encoder fingerprinting, audio analysis, bitrate analysis, and GOP structure
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
  
  // === CHECK FOR FACE-BASED AI SIGNALS ===
  var deepfakeDetected = result.analysis?.deepfakeDetection?.detected || false;
  var deepfakeScore = result.analysis?.deepfakeDetection?.confidence || 0;
  var aiFacePercent = result.analysis?.deepfakeDetection?.aiFacePercentage || 0;
  var facesAnalyzed = result.analysis?.deepfakeDetection?.facesAnalyzed || 0;
  
  // Block reductions if we have AI face signals
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
  
  // Encoder scoring
  if (encoderAnalysis) {
    result.encoder_analysis = Object.assign({}, encoderAnalysis);
    
    if (encoderAnalysis.isLikelyAI && encoderAnalysis.aiScore >= 40) {
      var encoderBoost = encoderAnalysis.aiScore >= 70 ? 35 : (encoderAnalysis.aiScore >= 50 ? 25 : 18);
      totalBoost += encoderBoost;
      adjustments.push('Suspicious encoder (+' + encoderBoost + '%)');
    } else if (encoderAnalysis.authenticScore >= 30 && !hasAIFaceSignal) {
      var reduction = Math.round(encoderAnalysis.authenticScore * 0.5);
      totalReduction += reduction;
      adjustments.push('Authentic encoder (-' + reduction + '%)');
    }
  }
  
  // Audio scoring
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
    } else if (audioAnalysis.authenticScore >= 30 && !hasAIFaceSignal) {
      var audioReduction = Math.round(audioAnalysis.authenticScore * 0.35);
      totalReduction += audioReduction;
      adjustments.push('Authentic audio (-' + audioReduction + '%)');
    }
  }
  
  // Bitrate scoring
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
    } else if (bitrateAnalysis.authenticScore >= 20 && !hasAIFaceSignal) {
      var bitrateReduction = Math.round(bitrateAnalysis.authenticScore * 0.25);
      totalReduction += bitrateReduction;
      adjustments.push('Natural bitrate (-' + bitrateReduction + '%)');
    }
  }
  
  // GOP structure scoring
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
    } else if (gopAnalysis.authenticScore >= 25 && !hasAIFaceSignal) {
      var gopReduction = Math.round(gopAnalysis.authenticScore * 0.25);
      totalReduction += gopReduction;
      adjustments.push('Authentic GOP (-' + gopReduction + '%)');
    }
    
    if (gopAnalysis.details.percentages && gopAnalysis.details.percentages.iFrame >= 95) {
      totalBoost += 15;
      adjustments.push('All I-frames (+15%)');
    }
  }
  
  // Combined suspicious signals
  var encoderSuspicious = encoderAnalysis && encoderAnalysis.isLikelyAI;
  var audioSuspicious = audioAnalysis && (!audioAnalysis.hasAudio || audioAnalysis.aiScore >= 30);
  
  if (encoderSuspicious && audioSuspicious) {
    totalBoost += 15;
    adjustments.push('Encoder+audio suspicious (+15%)');
  }
  
  // Authenticity bonuses (only if no AI face signal)
  if (!hasAIFaceSignal) {
    var encoderAuthentic = encoderAnalysis && encoderAnalysis.authenticScore >= 30;
    var audioAuthentic = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
    var bitrateAuthentic = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.authenticScore >= 20;
    var gopAuthentic = gopAnalysis && gopAnalysis.success && gopAnalysis.authenticScore >= 25;
    
    var authenticCount = [encoderAuthentic, audioAuthentic, bitrateAuthentic, gopAuthentic].filter(Boolean).length;
    if (authenticCount >= 3) {
      totalReduction += 15;
      adjustments.push('Multiple authentic (-15%)');
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
  
  // No-audio floor
  if (encoderSuspicious && audioAnalysis && !audioAnalysis.hasAudio) {
    var currentScore = aiConfidence + totalBoost - totalReduction;
    if (currentScore < 50) {
      var floorBoost = 50 - currentScore;
      totalBoost += floorBoost;
      adjustments.push('No-audio floor (+' + floorBoost + '%)');
    }
  }
  
  // Apply final score
  aiConfidence = aiConfidence + totalBoost - totalReduction;
  
  // Apply face floor
  if (faceFloor > 0 && aiConfidence < faceFloor) {
    adjustments.push('Face floor: ' + Math.round(aiConfidence) + '% → ' + faceFloor + '%');
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
