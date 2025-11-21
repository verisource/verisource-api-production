// VeriSource - Confidence Scoring System (Recalibrated v2)
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

  // ========================================
  // CAMERA VERIFICATION (HIGH WEIGHT)
  // ========================================
  if (camera_verification?.camera_found) {
    score += 25;
    messages.push(`Camera verified: ${camera_verification.details.model}`);
  } else if (camera_verification?.details?.warnings?.length > 0) {
    score -= 5;
    messages.push('Camera warnings detected');
  }

  // ========================================
  // EXIF METADATA BONUS
  // ========================================
  if (metadata?.has_exif) {
    score += 5;
    messages.push('EXIF metadata present');
  }

  // ========================================
  // AI DETECTION (RAISED THRESHOLDS)
  // ========================================
  const aiConfidence = ai_detection?.ai_confidence || 0;

  // RAISED THRESHOLDS - More conservative
  if (aiConfidence >= 65) {
    // Very high AI confidence (65%+)
    return {
      name: 'LOW',
      label: 'AI-GENERATED IMAGE',
      percentage: Math.max(score - 40, 10),
      level: 'LOW',
      color: '#9333EA',
      icon: 'cpu',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9333EA" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
      message: `AI generation detected (${aiConfidence}% confidence)`
    };
  } else if (aiConfidence >= 50) {
    // High-medium AI confidence (50-64%) - EDITED, not pure AI
    score -= 15;
    return {
      name: 'MEDIUM',
      label: 'EDITED PHOTOGRAPH',
      percentage: Math.min(Math.max(score, 35), 70),
      level: 'MEDIUM',
      color: '#F59E0B',
      icon: 'edit',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      message: `Photograph with AI enhancements or heavy editing (${aiConfidence}% AI indicators)`
    };
  } else if (aiConfidence >= 35) {
    // Medium AI confidence (35-49%)
    score -= 10;
    messages.push(`Some AI indicators detected (${aiConfidence}%)`);
  } else if (aiConfidence >= 20) {
    // Low-medium AI confidence (20-34%)
    score -= 5;
    messages.push(`Minor AI indicators (${aiConfidence}%)`);
  } else {
    // Very low AI confidence (<20%)
    score += 10;
    messages.push('No significant AI patterns detected');
  }

  // ========================================
  // REVERSE IMAGE SEARCH
  // ========================================
  if (reverse_search?.found_online) {
    const matchCount = reverse_search.matches?.length || 0;
    if (matchCount > 10) {
      score += 15;
      messages.push(`Widely published (${matchCount} sources)`);
    } else if (matchCount > 3) {
      score += 10;
      messages.push(`Found on ${matchCount} sites`);
    } else {
      score += 5;
      messages.push('Limited online presence');
    }
  }

  // ========================================
  // BLOCKCHAIN VERIFICATION
  // ========================================
  if (blockchain?.verified) {
    score += 20;
    messages.push('Blockchain timestamp verified');
  } else if (blockchain?.status === 'pending') {
    score += 5;
    messages.push('Blockchain verification pending');
  }

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
        message: `Video contains ${aiPct}% AI-manipulated frames with face alterations`
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
      message: messages.join(', ')
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
      message: messages.join(', ')
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
      message: messages.join(', ')
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
      message: messages.join(', ')
    };
  }
}

module.exports = { calculateConfidenceScore };
