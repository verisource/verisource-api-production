/**
 * Video Frame Analysis Adjustments
 * Fixes false positives from applying image-based AI detection to video frames
 */

function adjustFrameAnalysisForVideo(videoAnalysis) {
  if (!videoAnalysis || !videoAnalysis.success) return videoAnalysis;
  
  const result = Object.assign({}, videoAnalysis);
  const adjustments = [];
  
  let frameAI = result.analysis?.aiPercentage || 0;
  const originalFrameAI = frameAI;
  
  // Check for deepfake/AI face signals
  const deepfake = result.analysis?.deepfakeDetection;
  const isDeepfake = deepfake?.detected || false;
  const deepfakeScore = deepfake?.confidence || 0;
  const aiFacePercent = deepfake?.aiFacePercentage || 0;
  const facesAnalyzed = deepfake?.facesAnalyzed || 0;
  
  // Trigger on: deepfake detected OR significant AI faces
  const hasAIFaceSignal = (isDeepfake && deepfakeScore >= 50) || 
                          (aiFacePercent >= 20 && facesAnalyzed >= 10);
  
  if (hasAIFaceSignal) {
    let boost = 0;
    let floor = 50;
    
    if (isDeepfake && deepfakeScore >= 50) {
      boost = Math.min(30, deepfakeScore * 0.4);
      floor = 60;
      adjustments.push(`Deepfake: floor ${floor}% + ${Math.round(boost)}% boost`);
    } else if (aiFacePercent >= 20) {
      boost = Math.min(20, aiFacePercent * 0.5);
      floor = 45;
      adjustments.push(`AI faces (${aiFacePercent}%): floor ${floor}% + ${Math.round(boost)}% boost`);
    }
    
    frameAI = Math.max(floor, frameAI) + boost;
    frameAI = Math.round(Math.min(100, frameAI));
    
    result.ai_confidence = frameAI;
    result.ai_confidence_pre_adjustment = originalFrameAI;
    result.frame_analysis_adjustments = adjustments;
    if (result.analysis) {
      result.analysis.aiPercentageOriginal = originalFrameAI;
      result.analysis.aiPercentage = frameAI;
    }
    console.log(`🎬 Frame adjustments (faces): ${originalFrameAI}% → ${frameAI}%`);
    adjustments.forEach(a => console.log(`   ${a}`));
    return result;
  }
  
  // Check for unanimous AI detection
  const aiFrameCount = result.analysis?.aiFrames || 0;
  const totalFrames = result.analysis?.framesAnalyzed || 1;
  const allFramesAI = aiFrameCount === totalFrames && totalFrames >= 5;
  
  if (allFramesAI && frameAI >= 80) {
    const UNANIMOUS_CAP = 80;
    if (frameAI > UNANIMOUS_CAP) {
      adjustments.push(`Unanimous AI cap: ${frameAI}% → ${UNANIMOUS_CAP}%`);
      frameAI = UNANIMOUS_CAP;
    }
    
    const frameResults = result.analysis?.frameResults || [];
    if (frameResults.length > 0) {
      const avgConf = frameResults.reduce((s, f) => s + (f.aiDetection?.ai_confidence || 0), 0) / frameResults.length;
      if (avgConf < 40) {
        const reduction = Math.min(20, frameAI * 0.25);
        frameAI = Math.max(40, frameAI - reduction);
        adjustments.push(`Low-confidence unanimous: -${Math.round(reduction)}%`);
      }
    }
    
    frameAI = Math.round(frameAI);
    result.ai_confidence = frameAI;
    result.ai_confidence_pre_adjustment = originalFrameAI;
    result.frame_analysis_adjustments = adjustments;
    if (result.analysis) {
      result.analysis.aiPercentageOriginal = originalFrameAI;
      result.analysis.aiPercentage = frameAI;
    }
    console.log(`🎬 Frame adjustments (unanimous): ${originalFrameAI}% → ${frameAI}%`);
    adjustments.forEach(a => console.log(`   ${a}`));
    return result;
  }
  
  // === STANDARD ADJUSTMENTS ===
  
  const FRAME_CAP = 70;
  if (frameAI > FRAME_CAP) {
    adjustments.push(`Frame capped: ${frameAI}% → ${FRAME_CAP}%`);
    frameAI = FRAME_CAP;
  }
  
  const temporal = result.analysis?.temporalConsistency;
  if (temporal) {
    const consistency = temporal.score || 0;
    const inconsistencies = temporal.inconsistencies || 0;
    
    if (consistency >= 75 && inconsistencies === 0) {
      const reduction = Math.min(20, frameAI * 0.28);
      frameAI = Math.max(0, frameAI - reduction);
      adjustments.push(`Temporal bonus: -${Math.round(reduction)}% (${Math.round(consistency)}%)`);
    } else if (consistency >= 70 && inconsistencies <= 1) {
      const reduction = Math.min(12, frameAI * 0.18);
      frameAI = Math.max(0, frameAI - reduction);
      adjustments.push(`Good temporal: -${Math.round(reduction)}%`);
    }
    
    if (consistency < 50 || inconsistencies >= 3) {
      const boost = Math.min(15, (100 - consistency) * 0.2);
      frameAI = Math.min(100, frameAI + boost);
      adjustments.push(`Temporal issues: +${Math.round(boost)}%`);
    }
  }
  
  if (!isDeepfake && deepfakeScore < 30 && facesAnalyzed >= 5 && aiFacePercent < 10) {
    const reduction = Math.min(12, frameAI * 0.15);
    frameAI = Math.max(0, frameAI - reduction);
    adjustments.push(`Faces authentic: -${Math.round(reduction)}%`);
  }
  
  const weighted = result.analysis?.weightedScore || 0;
  if (weighted < frameAI - 30 && !allFramesAI) {
    const blended = (frameAI * 0.4) + (weighted * 0.6);
    if (blended < frameAI) {
      adjustments.push(`Weighted blend: ${Math.round(frameAI)}% → ${Math.round(blended)}%`);
      frameAI = blended;
    }
  }
  
  const frameResults = result.analysis?.frameResults || [];
  if (frameResults.length > 0 && result.analysis?.aiPercentage >= 50) {
    const avgConf = frameResults.reduce((s, f) => s + (f.aiDetection?.ai_confidence || 0), 0) / frameResults.length;
    if (avgConf < 50) {
      const reduction = Math.min(15, frameAI * 0.2);
      frameAI = Math.max(0, frameAI - reduction);
      adjustments.push(`Low-confidence flags: -${Math.round(reduction)}%`);
    }
  }
  
  frameAI = Math.round(Math.max(0, Math.min(100, frameAI)));
  
  result.ai_confidence = frameAI;
  result.ai_confidence_pre_adjustment = originalFrameAI;
  result.frame_analysis_adjustments = adjustments;
  
  if (result.analysis) {
    result.analysis.aiPercentageOriginal = originalFrameAI;
    result.analysis.aiPercentage = frameAI;
  }
  
  if (adjustments.length > 0) {
    console.log(`🎬 Frame adjustments: ${originalFrameAI}% → ${frameAI}%`);
    adjustments.forEach(a => console.log(`   ${a}`));
  }
  
  return result;
}

module.exports = { adjustFrameAnalysisForVideo };
