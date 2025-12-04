/**
 * Enhanced Video AI Scoring
 * Combines all 9 signals: encoder, audio, audio content, bitrate, GOP, motion, watermarks, resolution
 */
function applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis, gopAnalysis, motionAnalysis, watermarkAnalysis, audioContentAnalysis, resolutionAnalysis) {
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
  
  // === RESOLUTION ANALYSIS (HIGH PRIORITY - catches Sora) ===
  var hasResolutionAISignal = false;
  if (resolutionAnalysis && resolutionAnalysis.success) {
    result.resolution_analysis = resolutionAnalysis;
    
    if (resolutionAnalysis.aiToolMatch && resolutionAnalysis.aiToolMatch.matched) {
      // Exact AI tool resolution match - very strong signal
      var resBoost = resolutionAnalysis.aiToolMatch.confidence;
      totalBoost += resBoost;
      adjustments.push('Resolution: ' + resolutionAnalysis.aiToolMatch.tool + ' (+' + resBoost + '%)');
      hasResolutionAISignal = true;
    } else if (resolutionAnalysis.verdict === 'LIKELY_AI') {
      totalBoost += 25;
      adjustments.push('Unusual resolution (+25%)');
      hasResolutionAISignal = true;
    } else if (resolutionAnalysis.verdict === 'POSSIBLY_AI') {
      totalBoost += 12;
      adjustments.push('Non-standard resolution (+12%)');
    } else if (resolutionAnalysis.verdict === 'LIKELY_AUTHENTIC') {
      totalReduction += 8;
      adjustments.push('Standard resolution (-8%)');
    }
  }
  
  // === WATERMARK DETECTION (HIGHEST PRIORITY) ===
  if (watermarkAnalysis && watermarkAnalysis.watermarkDetected) {
    result.watermark_analysis = watermarkAnalysis;
    totalBoost += watermarkAnalysis.confidence;
    adjustments.push('Watermark: ' + watermarkAnalysis.tool + ' (+' + watermarkAnalysis.confidence + '%)');
    
    if (watermarkAnalysis.confidence >= 90) {
      result.ai_confidence = Math.max(90, aiConfidence);
      result.verdict = 'LIKELY_AI_GENERATED';
      result.ai_adjustments = adjustments;
      result.ai_confidence_original = originalConfidence;
      return result;
    }
  }
  
  // === CHECK FOR AUTHENTIC DEVICE (Android/Apple) ===
  var hasAuthenticDevice = false;
  var authenticDeviceInfo = null;
  
  // Check for Android device tags in metadata
  if (encoderAnalysis && encoderAnalysis.metadata) {
    var tags = encoderAnalysis.metadata.format?.tags || {};
    if (tags["com.android.version"] || tags["com.android.capture.fps"]) {
      hasAuthenticDevice = true;
      authenticDeviceInfo = { type: "Android", version: tags["com.android.version"] || "unknown" };
      adjustments.push("Android device detected");
    }
  }
  
  // Check GOP for Apple device match
  if (gopAnalysis && gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
    hasAuthenticDevice = true;
    authenticDeviceInfo = authenticDeviceInfo || { type: gopAnalysis.deviceMatch.device };
    if (!adjustments.includes("Android device detected")) {
      adjustments.push("Apple device detected");
    }
  }
  
  // === CHECK FOR FACE-BASED AI SIGNALS ===
  var deepfakeDetected = result.analysis?.deepfakeDetection?.detected || false;
  var deepfakeScore = result.analysis?.deepfakeDetection?.confidence || 0;
  var aiFacePercent = result.analysis?.deepfakeDetection?.aiFacePercentage || 0;
  var facesAnalyzed = result.analysis?.deepfakeDetection?.facesAnalyzed || 0;
  
  var hasAIFaceSignal = false;
  var faceFloor = 0;
  
  if (hasAuthenticDevice) {
    // Authentic device - only trigger deepfake for very high confidence
    if (deepfakeDetected && deepfakeScore >= 85 && aiFacePercent >= 70) {
      hasAIFaceSignal = true;
      faceFloor = 50;
      adjustments.push("Deepfake on authentic device: floor 50%");
    } else if (deepfakeDetected) {
      adjustments.push("Deepfake signal reduced (authentic " + authenticDeviceInfo.type + " device)");
    }
  } else {
    // No authentic device - normal deepfake detection
    hasAIFaceSignal = (deepfakeDetected && deepfakeScore >= 50) || (aiFacePercent >= 20 && facesAnalyzed >= 10);
    
    if (deepfakeDetected && deepfakeScore >= 50) {
      faceFloor = 60;
      adjustments.push("Deepfake floor: 60%");
    } else if (aiFacePercent >= 20 && facesAnalyzed >= 10) {
      faceFloor = 45;
      adjustments.push("AI faces floor: 45% (" + aiFacePercent + "% AI faces)");
    }
  }
  // === MOTION ANALYSIS ===
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
    } else if (motionAnalysis.verdict === 'LIKELY_AUTHENTIC' && !hasAIFaceSignal && !hasResolutionAISignal) {
      totalReduction += 12;
      adjustments.push('Motion: LIKELY_AUTHENTIC (-12%)');
    } else if (motionAnalysis.verdict === 'POSSIBLY_AUTHENTIC' && !hasAIFaceSignal && !hasResolutionAISignal) {
      totalReduction += 6;
      adjustments.push('Motion: POSSIBLY_AUTHENTIC (-6%)');
    }
    
    if (motionAnalysis.aiScore >= 35 && motionAnalysis.authenticScore <= 5) {
      if (faceFloor < 40) {
        faceFloor = 40;
        adjustments.push('Motion floor: 40%');
      }
    }
  }
  
  // === AUDIO CONTENT ANALYSIS ===
  var hasAudioAISignal = false;
  if (audioContentAnalysis && audioContentAnalysis.success) {
    result.audio_content_analysis = {
      verdict: audioContentAnalysis.verdict,
      aiScore: audioContentAnalysis.aiScore,
      authenticScore: audioContentAnalysis.authenticScore,
      indicators: audioContentAnalysis.indicators
    };
    
    if (audioContentAnalysis.verdict === 'LIKELY_AI_AUDIO') {
      totalBoost += 15;
      adjustments.push('Audio content: LIKELY_AI (+15%)');
      hasAudioAISignal = true;
    } else if (audioContentAnalysis.verdict === 'POSSIBLY_AI_AUDIO') {
      totalBoost += 8;
      adjustments.push('Audio content: suspicious (+8%)');
      hasAudioAISignal = true;
    } else if (audioContentAnalysis.verdict === 'LIKELY_AUTHENTIC_AUDIO' && !hasAIFaceSignal && !hasMotionAISignal && !hasResolutionAISignal) {
      totalReduction += 8;
      adjustments.push('Audio content: authentic (-8%)');
    }
  }
  
  // Block reductions if we have strong AI signals
  var hasStrongAISignal = hasAIFaceSignal || hasMotionAISignal || hasResolutionAISignal || hasAudioAISignal;
  
  // === ENCODER SCORING ===
  if (encoderAnalysis) {
    result.encoder_analysis = Object.assign({}, encoderAnalysis);
    
    if (encoderAnalysis.isLikelyAI && encoderAnalysis.aiScore >= 40) {
      var encoderBoost = encoderAnalysis.aiScore >= 70 ? 35 : (encoderAnalysis.aiScore >= 50 ? 25 : 18);
      totalBoost += encoderBoost;
      adjustments.push('Suspicious encoder (+' + encoderBoost + '%)');
    } else if (encoderAnalysis.authenticScore >= 30 && !hasStrongAISignal) {
      var reduction = Math.round(encoderAnalysis.authenticScore * 0.5);
      totalReduction += reduction;
      adjustments.push('Authentic encoder (-' + reduction + '%)');
    }
  }
  
  // === AUDIO PRESENCE SCORING ===
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
    } else if (audioAnalysis.authenticScore >= 30 && !hasStrongAISignal) {
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
    } else if (bitrateAnalysis.authenticScore >= 20 && !hasStrongAISignal) {
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
    } else if (gopAnalysis.authenticScore >= 25 && !hasStrongAISignal) {
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
  var audioMissing = audioAnalysis && !audioAnalysis.hasAudio;
  
  if (encoderSuspicious && audioMissing) {
    totalBoost += 15;
    adjustments.push('Encoder+no audio (+15%)');
  }
  
  if (hasMotionAISignal && (encoderSuspicious || audioMissing)) {
    totalBoost += 10;
    adjustments.push('Motion+encoding suspicious (+10%)');
  }
  
  if (hasAudioAISignal && hasMotionAISignal) {
    totalBoost += 8;
    adjustments.push('Audio+motion suspicious (+8%)');
  }
  
  if (hasResolutionAISignal && (hasMotionAISignal || hasAudioAISignal || encoderSuspicious)) {
    totalBoost += 10;
    adjustments.push('Resolution+other AI signals (+10%)');
  }
  
  // === AUTHENTICITY BONUSES (only if no strong AI signals) ===
  if (!hasStrongAISignal) {
    var encoderAuthentic = encoderAnalysis && encoderAnalysis.authenticScore >= 30;
    var audioAuthentic = audioAnalysis && audioAnalysis.hasAudio && audioAnalysis.authenticScore >= 25;
    var bitrateAuthentic = bitrateAnalysis && bitrateAnalysis.success && bitrateAnalysis.authenticScore >= 20;
    var gopAuthentic = gopAnalysis && gopAnalysis.success && gopAnalysis.authenticScore >= 25;
    var motionAuthentic = motionAnalysis && motionAnalysis.success && motionAnalysis.verdict === 'LIKELY_AUTHENTIC';
    var audioContentAuthentic = audioContentAnalysis && audioContentAnalysis.verdict === 'LIKELY_AUTHENTIC_AUDIO';
    var resolutionAuthentic = resolutionAnalysis && resolutionAnalysis.verdict === 'LIKELY_AUTHENTIC';
    
    var authenticCount = [encoderAuthentic, audioAuthentic, bitrateAuthentic, gopAuthentic, motionAuthentic, audioContentAuthentic, resolutionAuthentic].filter(Boolean).length;
    if (authenticCount >= 5) {
      totalReduction += 20;
      adjustments.push('Multiple authentic (' + authenticCount + '/7) (-20%)');
    } else if (authenticCount >= 4) {
      totalReduction += 15;
      adjustments.push('Multiple authentic (' + authenticCount + '/7) (-15%)');
    } else if (authenticCount >= 3) {
      totalReduction += 10;
      adjustments.push('Multiple authentic (' + authenticCount + '/7) (-10%)');
    }
    
    if (gopAnalysis && gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
      if (encoderAuthentic || audioAuthentic) {
        totalReduction += 10;
        adjustments.push('Device GOP match (-10%)');
      }
    }
  }
  
  // === NO-AUDIO FLOOR ===
  if (encoderSuspicious && audioMissing) {
    var currentScore = aiConfidence + totalBoost - totalReduction;
    if (currentScore < 50) {
      var floorBoost = 50 - currentScore;
      totalBoost += floorBoost;
      adjustments.push('No-audio floor (+' + floorBoost + '%)');
    }
  }
  
  // === RESOLUTION FLOOR (for exact AI tool matches) ===
  if (resolutionAnalysis && resolutionAnalysis.aiToolMatch && resolutionAnalysis.aiToolMatch.matched) {
    if (faceFloor < 50) {
      faceFloor = 50;
      adjustments.push('Resolution floor: 50%');
    }
  }
  
  // === APPLY FINAL SCORE ===
  aiConfidence = aiConfidence + totalBoost - totalReduction;
  
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
