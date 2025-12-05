// VeriSource - Confidence Scoring System v3.1
// Updated: Raised base score, AI veto power, platform-aware scoring

function calculateConfidenceScore(verificationData) {
  const {
    camera_verification,
    ai_detection,
    reverse_search,
    blockchain,
    blockchain_verification,
    polygon_verification,
    metadata,
    platform_detection,
    screenshot_detection,
    kind,
    mediaType = kind || 'image'
  } = verificationData;

  // Base scoring - START HIGHER (was 50, now 65)
  // Philosophy: Assume authentic until proven otherwise
  let score = 65;
  let messages = [];
  let warnings = [];

  // ========================================
  // PLATFORM DETECTION (Social Media)
  // ========================================
  // If image came from social media, missing EXIF is EXPECTED
  const isFromSocialMedia = platform_detection?.detected && platform_detection?.confidence >= 60;
  if (isFromSocialMedia) {
    messages.push(`Shared via ${platform_detection.platform} (${platform_detection.confidence}%)`);
    // Don't penalize for missing camera/EXIF - it's expected
  }

  // ========================================
  // SCREENSHOT DETECTION
  // ========================================
  if (screenshot_detection?.is_screenshot) {
    score -= 10;
    warnings.push(`Screenshot detected (${screenshot_detection.confidence}% confidence)`);
    messages.push('Screenshot - original source unknown');
  }

  // ========================================
  // CAMERA VERIFICATION (HIGH WEIGHT)
  // ========================================
  if (camera_verification?.camera_found && camera_verification?.confidence !== undefined) {
    const cameraBonus = Math.round((camera_verification.confidence / 100) * 25);
    score += cameraBonus;
    messages.push(`Camera verified: ${camera_verification.details?.model || 'Unknown'} (${camera_verification.confidence}% confidence)`);
    
    if (camera_verification.confidence < 50) {
      warnings.push('Camera date/release validation issues detected');
    }
  } else if (camera_verification?.camera_found) {
    score += 25;
    messages.push(`Camera verified: ${camera_verification.details?.model || 'Unknown'}`);
  } else if (camera_verification?.warnings?.length > 0) {
    score -= 5;
    warnings.push('Camera warnings detected');
  }
  // NOTE: No penalty for missing camera data - most social media images lack it

  // ========================================
  // EXIF METADATA BONUS (not penalty)
  // ========================================
  if (metadata?.has_exif) {
    score += 5;
    messages.push('EXIF metadata present');
  }
  // NOTE: No penalty for missing EXIF - most shared images lack it

  // ========================================
  // AI DETECTION (RAISED THRESHOLDS)
  // ========================================
  const aiConfidence = ai_detection?.ai_confidence || 0;
  let aiVetoApplied = false;
  let preVetoScore = null;

  // Check for AI software in EXIF metadata (hard veto)
  const aiSoftwareInExif = checkForAISoftwareInExif(metadata);
  if (aiSoftwareInExif) {
    warnings.push(`AI software detected in metadata: ${aiSoftwareInExif}`);
    // Will apply hard veto at the end
  }

  // RAISED THRESHOLDS to reduce false positives
  if (aiConfidence >= 70) {
    // Very high AI confidence (70%+)
    return buildResponse({
      score: Math.max(score - 40, 10),
      level: 'untrusted',
      label: 'AI-GENERATED IMAGE',
      color: '#9333EA',
      icon: 'cpu',
      message: `AI generation detected (${aiConfidence}% confidence)`,
      messages,
      warnings,
      aiVetoApplied: true,
      preVetoScore: score
    });
  } else if (aiConfidence >= 55) {
    // High AI confidence (55-69%)
    return buildResponse({
      score: Math.max(score - 30, 20),
      level: 'suspicious',
      label: 'LIKELY AI-GENERATED IMAGE',
      color: '#9333EA',
      icon: 'cpu',
      message: `Likely AI-generated (${aiConfidence}% confidence)`,
      messages,
      warnings,
      aiVetoApplied: true,
      preVetoScore: score
    });
  } else if (aiConfidence >= 40) {
    // Medium AI confidence (40-54%) - EDITED, not pure AI
    score -= 15;
    return buildResponse({
      score: Math.min(Math.max(score, 35), 70),
      level: 'uncertain',
      label: 'EDITED IMAGE',
      color: '#F59E0B',
      icon: 'edit',
      message: `Photograph with AI enhancements or heavy editing (${aiConfidence}% AI indicators)`,
      messages,
      warnings
    });
  } else if (aiConfidence >= 25) {
    // Low-medium AI confidence (25-39%)
    score -= 10;
    messages.push(`Some AI indicators detected (${aiConfidence}%)`);
  } else if (aiConfidence >= 15) {
    // Low AI confidence (15-24%)
    score -= 5;
    messages.push(`Minor AI indicators (${aiConfidence}%)`);
  } else {
    // Very low AI confidence (<15%)
    score += 10;
    messages.push('No significant AI patterns detected');
  }

  // ========================================
  // REVERSE IMAGE SEARCH
  // ========================================
  const reverseSearch = reverse_search || verificationData.reverse_image_search;
  if (reverseSearch?.tineye?.total_results > 0 || reverseSearch?.found_online) {
    const matchCount = reverseSearch.tineye?.total_results || reverseSearch.matches?.length || 0;
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
  const bc = blockchain || blockchain_verification;
  const poly = polygon_verification;
  
  if (bc?.status === 'confirmed' || bc?.verified) {
    score += 15;
    messages.push('Bitcoin blockchain timestamp verified');
  } else if (bc?.status === 'pending' || bc?.success) {
    score += 8;
    messages.push('Blockchain verification pending');
  }
  
  if (poly?.success && poly?.status !== 'previously_timestamped') {
    score += 10;
    messages.push('Polygon blockchain verified');
  } else if (poly?.status === 'previously_timestamped') {
    score += 12;
    messages.push('Previously verified on Polygon');
  }

  // ========================================
  // VIDEO-SPECIFIC SCORING
  // ========================================
  if (mediaType === "video" && verificationData.video_analysis?.analysis) {
    const analysis = verificationData.video_analysis.analysis;
    const aiPct = analysis.aiPercentage || 0;
    const verdict = analysis.verdict;
    const deepfake = analysis.deepfakeDetection;
    
    // Deepfake detected - HARD VETO
    if (deepfake?.detected) {
      return buildResponse({
        score: Math.max(20, 100 - deepfake.confidence),
        level: 'untrusted',
        label: 'DEEPFAKE VIDEO DETECTED',
        color: '#DC2626',
        icon: 'alert-triangle',
        message: `Deepfake detected with ${deepfake.confidence}% confidence`,
        messages,
        warnings: [...warnings, 'Deepfake manipulation detected'],
        aiVetoApplied: true,
        preVetoScore: score
      });
    }

    // High AI percentage in video frames
    if (verdict === "LIKELY_AI_GENERATED" || aiPct >= 80) {
      return buildResponse({
        score: Math.max(20, 100 - aiPct),
        level: 'untrusted',
        label: 'AI-GENERATED VIDEO',
        color: '#DC2626',
        icon: 'alert-triangle',
        message: `${aiPct}% of frames show AI-generation patterns`,
        messages,
        warnings,
        aiVetoApplied: true,
        preVetoScore: score
      });
    }
    
    // Suspicious video
    if (verdict === "SUSPICIOUS" || aiPct >= 40) {
      return buildResponse({
        score: Math.max(35, 100 - aiPct),
        level: 'suspicious',
        label: 'AI-ENHANCED VIDEO',
        color: '#F59E0B',
        icon: 'alert-circle',
        message: `${aiPct}% of frames show suspicious patterns`,
        messages,
        warnings
      });
    }
    
    // Authentic video
    if (verdict === "AUTHENTIC" || aiPct < 20) {
      return buildResponse({
        score: Math.min(85, 100 - aiPct),
        level: 'trusted',
        label: 'VERIFIED VIDEO',
        color: '#10B981',
        icon: 'check-circle',
        message: 'Video appears authentic',
        messages,
        warnings
      });
    }
  }

  // ========================================
  // AI VETO POWER (Critical safety check)
  // ========================================
  // Even if other factors boost the score, AI detection can cap it
  score = Math.min(Math.max(score, 0), 100);
  preVetoScore = score;

  // Hard veto for AI software in EXIF
  if (aiSoftwareInExif) {
    if (score > 25) {
      aiVetoApplied = true;
      score = 25;
      warnings.push('🚨 AI software in metadata - score capped');
    }
  }
  // Soft veto based on AI confidence
  else if (aiConfidence >= 20 && aiConfidence < 40) {
    // AI confidence 20-39%: cap at 55 (UNCERTAIN)
    if (score > 55) {
      aiVetoApplied = true;
      score = 55;
      warnings.push(`AI indicators (${aiConfidence}%) limit maximum score`);
    }
  }

  // ========================================
  // FINAL CLASSIFICATION
  // ========================================
  if (score >= 75) {
    return buildResponse({
      score,
      level: 'trusted',
      label: 'VERIFIED IMAGE',
      color: '#10B981',
      icon: 'check-circle',
      message: messages.join(', '),
      messages,
      warnings,
      aiVetoApplied,
      preVetoScore: aiVetoApplied ? preVetoScore : null
    });
  } else if (score >= 60) {
    return buildResponse({
      score,
      level: 'acceptable',
      label: 'LIKELY REAL IMAGE',
      color: '#3B82F6',
      icon: 'camera',
      message: messages.join(', '),
      messages,
      warnings,
      aiVetoApplied,
      preVetoScore: aiVetoApplied ? preVetoScore : null
    });
  } else if (score >= 40) {
    return buildResponse({
      score,
      level: 'uncertain',
      label: 'EDITED IMAGE',
      color: '#F59E0B',
      icon: 'edit',
      message: messages.join(', '),
      messages,
      warnings,
      aiVetoApplied,
      preVetoScore: aiVetoApplied ? preVetoScore : null
    });
  } else {
    return buildResponse({
      score,
      level: 'suspicious',
      label: 'UNCERTAIN IMAGE',
      color: '#6B7280',
      icon: 'help-circle',
      message: messages.join(', '),
      messages,
      warnings,
      aiVetoApplied,
      preVetoScore: aiVetoApplied ? preVetoScore : null
    });
  }
}

/**
 * Check for AI generation software in EXIF metadata
 */
function checkForAISoftwareInExif(metadata) {
  if (!metadata?.exif) return null;
  
  const exifString = JSON.stringify(metadata.exif).toLowerCase();
  const aiSoftware = [
    'dall-e', 'dalle', 'midjourney', 'stable diffusion', 'stablediffusion',
    'novelai', 'runway', 'pika', 'sora', 'firefly', 'adobe firefly',
    'leonardo.ai', 'ideogram', 'flux', 'comfyui', 'automatic1111'
  ];
  
  for (const software of aiSoftware) {
    if (exifString.includes(software)) {
      return software;
    }
  }
  return null;
}

/**
 * Build standardized response object
 */
function buildResponse({ score, level, label, color, icon, message, messages, warnings, aiVetoApplied, preVetoScore }) {
  const iconSvgMap = {
    'check-circle': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'camera': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    'edit': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    'cpu': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>`,
    'alert-triangle': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    'alert-circle': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    'help-circle': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  return {
    // Core fields (used by frontend)
    name: level.toUpperCase(),
    label,
    percentage: Math.round(score),
    level: level.toUpperCase(),
    color,
    icon,
    iconSvg: iconSvgMap[icon] || iconSvgMap['help-circle'],
    message,
    
    // Extended fields (for report)
    warnings: warnings?.length > 0 ? warnings : undefined,
    factors: messages,
    
    // AI veto tracking
    ai_veto_applied: aiVetoApplied || false,
    pre_veto_score: preVetoScore || null
  };
}

// CRITICAL: Proper export
module.exports = { calculateConfidenceScore };
/**
 * Check for editing/enhancement software in EXIF
 * Returns software name if found, null otherwise
 */
function checkForEditingSoftwareInExif(metadata) {
  if (!metadata?.exif) return null;
  
  const exifString = JSON.stringify(metadata.exif).toLowerCase();
  
  // Professional editing software
  const editingSoftware = [
    // Adobe products
    { pattern: 'photoshop', name: 'Adobe Photoshop' },
    { pattern: 'lightroom', name: 'Adobe Lightroom' },
    { pattern: 'camera raw', name: 'Adobe Camera Raw' },
    { pattern: 'premiere', name: 'Adobe Premiere' },
    
    // AI Enhancement tools
    { pattern: 'topaz', name: 'Topaz Labs' },
    { pattern: 'gigapixel', name: 'Topaz Gigapixel AI' },
    { pattern: 'denoise', name: 'Topaz DeNoise AI' },
    { pattern: 'sharpen ai', name: 'Topaz Sharpen AI' },
    { pattern: 'luminar', name: 'Luminar AI/Neo' },
    { pattern: 'remini', name: 'Remini' },
    
    // Professional RAW processors
    { pattern: 'capture one', name: 'Capture One' },
    { pattern: 'dxo', name: 'DxO PhotoLab' },
    { pattern: 'darktable', name: 'Darktable' },
    { pattern: 'rawtherapee', name: 'RawTherapee' },
    { pattern: 'affinity photo', name: 'Affinity Photo' },
    { pattern: 'on1', name: 'ON1 Photo RAW' },
    
    // Mobile/consumer apps
    { pattern: 'snapseed', name: 'Snapseed' },
    { pattern: 'vsco', name: 'VSCO' },
    { pattern: 'facetune', name: 'FaceTune' },
    { pattern: 'faceapp', name: 'FaceApp' },
    { pattern: 'picsart', name: 'PicsArt' },
    { pattern: 'pixlr', name: 'Pixlr' },
    { pattern: 'canva', name: 'Canva' },
    { pattern: 'polish', name: 'Photo Polish' },
    
    // Manufacturer software
    { pattern: 'canon dpp', name: 'Canon Digital Photo Professional' },
    { pattern: 'digital photo professional', name: 'Canon DPP' },
    { pattern: 'nikon nx', name: 'Nikon NX Studio' },
    { pattern: 'sony imaging', name: 'Sony Imaging Edge' },
    { pattern: 'fujifilm', name: 'Fujifilm X RAW Studio' },
    
    // Open source
    { pattern: 'gimp', name: 'GIMP' },
    { pattern: 'krita', name: 'Krita' },
    { pattern: 'photopea', name: 'Photopea' },
    
    // AI upscaling indicators
    { pattern: 'upscale', name: 'AI Upscaler' },
    { pattern: 'enhanced', name: 'AI Enhanced' },
    { pattern: 'super resolution', name: 'Super Resolution' }
  ];
  
  for (const software of editingSoftware) {
    if (exifString.includes(software.pattern)) {
      return software.name;
    }
  }
  return null;
}

/**
 * Determine if image is AI-generated vs AI-enhanced
 * Returns: { verdict: 'AI-GENERATED IMAGE' | 'AI-ENHANCED IMAGE' | 'VERIFIED IMAGE', software: string | null, confidence: number }
 */
function categorizeAIContent(metadata, aiConfidence, cameraVerification) {
  const result = {
    verdict: 'VERIFIED IMAGE',
    category: null,
    software: null,
    explanation: null
  };
  
  // Check for AI generator software first (highest priority)
  const aiGenerator = checkForAISoftwareInExif(metadata);
  if (aiGenerator) {
    result.verdict = 'AI-GENERATED IMAGE';
    result.category = 'synthetic';
    result.software = aiGenerator;
    result.explanation = `Generated by ${aiGenerator}`;
    return result;
  }
  
  // Check for editing software
  const editingSoftware = checkForEditingSoftwareInExif(metadata);
  
  // If high AI confidence but has real camera + editing software = AI-enhanced
  if (aiConfidence >= 40) {
    const hasRealCamera = cameraVerification?.camera_found && cameraVerification?.is_valid;
    
    if (hasRealCamera && editingSoftware) {
      result.verdict = 'AI-ENHANCED IMAGE';
      result.category = 'enhanced';
      result.software = editingSoftware;
      result.explanation = `Real photo edited with ${editingSoftware}`;
      return result;
    }
    
    // Has editing software but no camera info - likely enhanced but uncertain
    if (editingSoftware && aiConfidence < 70) {
      result.verdict = 'AI-ENHANCED IMAGE';
      result.category = 'enhanced';
      result.software = editingSoftware;
      result.explanation = `Appears edited with ${editingSoftware}`;
      return result;
    }
    
    // High AI confidence, no camera, no editing software = likely generated
    if (aiConfidence >= 70 && !hasRealCamera) {
      result.verdict = 'AI-GENERATED IMAGE';
      result.category = 'synthetic';
      result.explanation = 'High AI indicators, no camera origin detected';
      return result;
    }
  }
  
  // Low AI confidence with editing software - just edited
  if (editingSoftware) {
    result.verdict = 'AI-ENHANCED IMAGE';
    result.category = 'edited';
    result.software = editingSoftware;
    result.explanation = `Edited with ${editingSoftware}`;
    return result;
  }
  
  return result;
}

module.exports.checkForEditingSoftwareInExif = checkForEditingSoftwareInExif;
module.exports.categorizeAIContent = categorizeAIContent;
