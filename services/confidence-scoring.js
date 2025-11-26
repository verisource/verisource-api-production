// VeriSource - Confidence Scoring System with Factors Breakdown
function calculateConfidenceScore(verificationData) {
  const {
    camera_verification,
    ai_detection,
    reverse_search,
    blockchain,
    metadata,
    mediaType = 'image'
  } = verificationData;

  // Base scoring
  let score = 50;
  let messages = [];
  let factors = [];

  // ========================================
  // CAMERA VERIFICATION (HIGH WEIGHT)
  // ========================================
  const cameraFactor = { name: 'Camera Verification', score: 0, max: 25, details: [] };
  
  if (camera_verification?.camera_found && camera_verification?.confidence !== undefined) {
    const cameraBonus = Math.round((camera_verification.confidence / 100) * 25);
    score += cameraBonus;
    cameraFactor.score = cameraBonus;
    cameraFactor.details.push(`Model: ${camera_verification.details?.recognized_model || camera_verification.details?.model || 'Unknown'}`);
    cameraFactor.details.push(`Confidence: ${camera_verification.confidence}%`);
    messages.push(`Camera verified: ${camera_verification.details?.model} (${camera_verification.confidence}% confidence)`);
    
    if (camera_verification.confidence < 50) {
      cameraFactor.details.push('⚠️ Date/release validation issues');
      messages.push('Camera date/release validation issues detected');
    }
  } else if (camera_verification?.camera_found) {
    score += 25;
    cameraFactor.score = 25;
    cameraFactor.details.push(`Model: ${camera_verification.details?.model || 'Detected'}`);
    messages.push(`Camera verified: ${camera_verification.details?.model}`);
  } else if (camera_verification?.warnings?.length > 0) {
    score -= 5;
    cameraFactor.score = -5;
    cameraFactor.details.push('Warnings detected');
    messages.push('Camera warnings detected');
  } else {
    cameraFactor.details.push('No camera data found');
  }
  cameraFactor.percentage = Math.max(0, Math.round((cameraFactor.score / cameraFactor.max) * 100));
  factors.push(cameraFactor);

  // ========================================
  // EXIF METADATA BONUS
  // ========================================
  const metadataFactor = { name: 'EXIF Metadata', score: 0, max: 5, details: [] };
  
  if (metadata?.has_exif) {
    score += 5;
    metadataFactor.score = 5;
    metadataFactor.details.push('EXIF data present');
    messages.push('EXIF metadata present');
  } else {
    metadataFactor.details.push('No EXIF metadata');
  }
  metadataFactor.percentage = Math.round((metadataFactor.score / metadataFactor.max) * 100);
  factors.push(metadataFactor);

  // ========================================
  // AI DETECTION (RAISED THRESHOLDS)
  // ========================================
  const aiConfidence = ai_detection?.ai_confidence || 0;
  const aiFactor = { name: 'AI Detection', score: 0, max: 30, details: [] };
  
  aiFactor.details.push(`AI Confidence: ${aiConfidence}%`);
  if (ai_detection?.verdict) {
    aiFactor.details.push(`Verdict: ${ai_detection.verdict}`);
  }
  if (ai_detection?.adjustments?.length > 0) {
    ai_detection.adjustments.forEach(adj => aiFactor.details.push(adj));
  }

  // RAISED THRESHOLDS to reduce false positives
  if (aiConfidence >= 70) {
    aiFactor.score = 0;
    aiFactor.percentage = 0;
    factors.push(aiFactor);
    
    return {
      name: 'LOW',
      label: 'AI-GENERATED IMAGE',
      percentage: Math.max(score - 40, 10),
      level: 'LOW',
      color: '#9333EA',
      icon: 'cpu',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9333EA" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
      message: `AI generation detected (${aiConfidence}% confidence)`,
      factors: factors
    };
  } else if (aiConfidence >= 55) {
    aiFactor.score = 5;
    aiFactor.percentage = Math.round((aiFactor.score / aiFactor.max) * 100);
    factors.push(aiFactor);
    
    return {
      name: 'MEDIUM',
      label: 'LIKELY AI-GENERATED',
      percentage: Math.max(score - 30, 20),
      level: 'MEDIUM',
      color: '#9333EA',
      icon: 'cpu',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9333EA" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
      message: `Likely AI-generated (${aiConfidence}% confidence)`,
      factors: factors
    };
  } else if (aiConfidence >= 40) {
    score -= 15;
    aiFactor.score = 10;
    aiFactor.percentage = Math.round((aiFactor.score / aiFactor.max) * 100);
    factors.push(aiFactor);
    
    return {
      name: 'MEDIUM',
      label: 'EDITED PHOTOGRAPH',
      percentage: Math.min(Math.max(score, 35), 70),
      level: 'MEDIUM',
      color: '#F59E0B',
      icon: 'edit',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      message: `Photograph with AI enhancements or heavy editing (${aiConfidence}% AI indicators)`,
      factors: factors
    };
  } else if (aiConfidence >= 25) {
    score -= 10;
    aiFactor.score = 20;
    messages.push(`Some AI indicators detected (${aiConfidence}%)`);
  } else if (aiConfidence >= 15) {
    score -= 5;
    aiFactor.score = 25;
    messages.push(`Minor AI indicators (${aiConfidence}%)`);
  } else {
    score += 10;
    aiFactor.score = 30;
    messages.push('No significant AI patterns detected');
  }
  aiFactor.percentage = Math.round((aiFactor.score / aiFactor.max) * 100);
  factors.push(aiFactor);

  // ========================================
  // REVERSE IMAGE SEARCH
  // ========================================
  const reverseFactor = { name: 'Reverse Image Search', score: 0, max: 15, details: [] };
  
  if (reverse_search?.found_online) {
    const matchCount = reverse_search.matches?.length || 0;
    reverseFactor.details.push(`Found on ${matchCount} sites`);
    
    if (matchCount > 10) {
      score += 15;
      reverseFactor.score = 15;
      messages.push(`Widely published (${matchCount} sources)`);
    } else if (matchCount > 3) {
      score += 10;
      reverseFactor.score = 10;
      messages.push(`Found on ${matchCount} sites`);
    } else {
      score += 5;
      reverseFactor.score = 5;
      messages.push('Limited online presence');
    }
  } else {
    reverseFactor.details.push('Not found online');
  }
  reverseFactor.percentage = Math.round((reverseFactor.score / reverseFactor.max) * 100);
  factors.push(reverseFactor);

  // ========================================
  // BLOCKCHAIN VERIFICATION
  // ========================================
  const blockchainFactor = { name: 'Blockchain Verification', score: 0, max: 20, details: [] };
  
  if (blockchain?.verified) {
    score += 20;
    blockchainFactor.score = 20;
    blockchainFactor.details.push('Timestamp verified');
    messages.push('Blockchain timestamp verified');
  } else if (blockchain?.status === 'pending') {
    score += 5;
    blockchainFactor.score = 5;
    blockchainFactor.details.push('Verification pending');
    messages.push('Blockchain verification pending');
  } else {
    blockchainFactor.details.push('Not verified');
  }
  blockchainFactor.percentage = Math.round((blockchainFactor.score / blockchainFactor.max) * 100);
  factors.push(blockchainFactor);

  // ========================================
  // VIDEO-SPECIFIC
  // ========================================
  if (mediaType === 'video' && verificationData.mediaAnalysis?.analysis) {
    const aiPct = verificationData.mediaAnalysis.analysis.aiPercentage || 0;
    const hasFaces = verificationData.mediaAnalysis.frames?.some(f => 
      f.aiDetection?.indicators?.some(i => i.toLowerCase().includes('face'))
    );
    
    if (hasFaces && aiPct > 40) {
      return {
        name: 'LOW',
        label: 'DEEPFAKE INDICATORS DETECTED',
        percentage: Math.max(score - 30, 20),
        level: 'LOW',
        color: '#DC2626',
        icon: 'alert-triangle',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        message: `Video contains ${aiPct}% AI-manipulated frames with face alterations`,
        factors: factors
      };
    }
  }

  // ========================================
  // FINAL CLASSIFICATION
  // ========================================
  score = Math.min(Math.max(score, 0), 100);

  if (score >= 75) {
    return {
      name: 'HIGH',
      label: 'VERIFIED AUTHENTIC',
      percentage: score,
      level: 'HIGH',
      color: '#10B981',
      icon: 'check-circle',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      message: messages.join(', '),
      factors: factors
    };
  } else if (score >= 60) {
    return {
      name: 'MEDIUM',
      label: 'LIKELY CAMERA-CAPTURED',
      percentage: score,
      level: 'MEDIUM',
      color: '#3B82F6',
      icon: 'camera',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      message: messages.join(', '),
      factors: factors
    };
  } else if (score >= 40) {
    return {
      name: 'MEDIUM',
      label: 'EDITED PHOTOGRAPH',
      percentage: score,
      level: 'MEDIUM',
      color: '#F59E0B',
      icon: 'edit',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      message: messages.join(', '),
      factors: factors
    };
  } else {
    return {
      name: 'LOW',
      label: 'AUTHENTICITY UNCLEAR',
      percentage: score,
      level: 'LOW',
      color: '#6B7280',
      icon: 'help-circle',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      message: messages.join(', '),
      factors: factors
    };
  }
}

// CRITICAL: Proper export
module.exports = { calculateConfidenceScore };
