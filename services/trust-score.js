/**
 * VeriSource Trust Score Calculator v3.1
 * 
 * Calculates comprehensive trust score (0-100) based on:
 * 1. Cryptographic Integrity (32%)
 * 2. Blockchain Provenance (25%)
 * 3. Metadata Authenticity (18%) - v3.1: Only penalize suspicious, not missing
 * 4. Content Provenance (10%)
 * 5. AI Detection (15%)
 *    - Local heuristic: 4.5%
 *    - External API: 10.5%
 * 
 * Total: 100%
 * 
 * v3.1 Changes:
 * - Metadata: Start at full points, only subtract for suspicious indicators
 * - Missing EXIF is neutral (most images lack it)
 * - Only penalize: AI software detected, editing software, inconsistencies
 */

/**
 * Calculate overall trust score
 * @param {Object} verificationData - Complete verification data
 * @returns {Object} Trust score result
 */
async function calculateTrustScore(verificationData) {
  const scores = {
    cryptographic: await calculateCryptographicScore(verificationData),
    blockchain: await calculateBlockchainScore(verificationData),
    metadata: await calculateMetadataScore(verificationData),
    provenance: await calculateProvenanceScore(verificationData),
    aiDetection: await calculateAIDetectionScore(verificationData)
  };

  // Calculate weighted total
  let totalScore = 
    scores.cryptographic.score +
    scores.blockchain.score +
    scores.metadata.score +
    scores.provenance.score +
    scores.aiDetection.score;

  // AI DETECTION VETO POWER
  // If AI detection strongly indicates AI-generated, cap the total score
  // This prevents high crypto/blockchain scores from masking AI content
  const aiConfidence = verificationData.aiDetection?.external?.authentic_confidence ?? 
                       (verificationData.aiDetection?.external?.result === 'authentic' ? 
                        verificationData.aiDetection?.external?.confidence : 
                        100 - (verificationData.aiDetection?.external?.confidence || 50));
  
  let aiVetoApplied = false;
  let originalScore = totalScore;

  if (aiConfidence < 20) {
    // Very likely AI - cap at 35 (SUSPICIOUS)
    totalScore = Math.min(totalScore, 35);
    aiVetoApplied = true;
  } else if (aiConfidence < 35) {
    // Likely AI - cap at 45 (SUSPICIOUS)
    totalScore = Math.min(totalScore, 45);
    aiVetoApplied = true;
  } else if (aiConfidence < 50) {
    // Possibly AI - cap at 55 (UNCERTAIN)
    totalScore = Math.min(totalScore, 55);
    aiVetoApplied = true;
  }

  // Also check for AI software in EXIF (hard veto)
  const exifString = JSON.stringify(verificationData.metadata?.exif || {}).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney', 
                      'novelai', 'automatic1111', 'comfyui', 'invoke ai'];
  if (aiSoftware.some(sw => exifString.includes(sw))) {
    totalScore = Math.min(totalScore, 25);
    aiVetoApplied = true;
  }

  // Determine confidence level and label
  const confidence = getConfidenceLevel(totalScore);

  // Collect all indicators
  const indicators = [
    ...scores.cryptographic.indicators,
    ...scores.blockchain.indicators,
    ...scores.metadata.indicators,
    ...scores.provenance.indicators,
    ...scores.aiDetection.indicators
  ];

  // Add veto indicator if applied
  if (aiVetoApplied) {
    indicators.unshift(`🚨 AI detection override: score capped from ${Math.round(originalScore)} to ${Math.round(totalScore)}`);
  }

  return {
    trust_score: {
      overall: Math.round(totalScore),
      confidence_level: confidence.level,
      confidence_label: confidence.label,
      recommendation: confidence.recommendation,
      breakdown: {
        cryptographic: Math.round(scores.cryptographic.score),
        blockchain: Math.round(scores.blockchain.score),
        metadata: Math.round(scores.metadata.score),
        provenance: Math.round(scores.provenance.score),
        ai_detection: Math.round(scores.aiDetection.score)
      },
      ai_veto_applied: aiVetoApplied,
      pre_veto_score: aiVetoApplied ? Math.round(originalScore) : null
    },
    detailed_scores: scores,
    indicators: indicators,
    timestamp: new Date().toISOString()
  };
}

/**
 * 1. CRYPTOGRAPHIC INTEGRITY (32 points)
 */
async function calculateCryptographicScore(data) {
  let score = 0;
  const indicators = [];
  const maxScore = 32;

  // A. SHA-256 Hash Verification (18 points)
  if (data.hash && data.hash.length === 64) {
    score += 18;
    indicators.push('✅ Cryptographic hash verified');
  } else {
    indicators.push('❌ Hash generation failed');
  }

  // B. File Integrity (9 points)
  if (data.fileIntegrity) {
    if (data.fileIntegrity.valid && !data.fileIntegrity.corrupted) {
      score += 9;
      indicators.push('✅ File integrity confirmed');
    } else if (data.fileIntegrity.partiallyReadable) {
      score += 5;
      indicators.push('⚠️ File partially readable');
    } else {
      indicators.push('❌ File corrupted or unreadable');
    }
  } else {
    // No integrity check performed - give benefit of doubt
    score += 9;
  }

  // C. Duplicate Detection (5 points)
  if (data.duplicates) {
    if (data.duplicates.found === 0) {
      score += 5;
      indicators.push('✅ No duplicates found - original content');
    } else if (data.duplicates.ownedByUser) {
      score += 3;
      indicators.push('⚠️ Found in your own content');
    } else {
      indicators.push('❌ Duplicate found elsewhere');
    }
  } else {
    // No duplicate check performed - give benefit of doubt
    score += 5;
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    indicators
  };
}

/**
 * 2. BLOCKCHAIN PROVENANCE (25 points)
 */
async function calculateBlockchainScore(data) {
  let score = 0;
  const indicators = [];
  const maxScore = 25;

  // A. Timestamp Verification (15 points)
  if (data.blockchain && data.blockchain.timestamp) {
    const confirmations = data.blockchain.confirmations || 0;
    const age = Date.now() - new Date(data.blockchain.timestamp).getTime();
    const ageMinutes = age / (1000 * 60);

    if (confirmations >= 12) {
      score += 15;
      indicators.push('✅ Blockchain timestamp confirmed');
    } else if (confirmations > 0) {
      score += 12;
      indicators.push('⚠️ Blockchain confirmation pending');
    } else if (ageMinutes < 60) {
      score += 10;
      indicators.push('⚠️ Recently submitted to blockchain');
    } else {
      score += 8;
      indicators.push('⚠️ Awaiting blockchain confirmation');
    }
  } else {
    // New upload - still give partial credit for being timestamped now
    score += 8;
    indicators.push('ℹ️ Blockchain timestamp in progress');
  }

  // B. Chain of Custody (10 points)
  if (data.blockchain && data.blockchain.history) {
    const historyLength = data.blockchain.history.length || 0;

    if (historyLength >= 3) {
      score += 10;
      indicators.push('✅ Complete chain of custody');
    } else if (historyLength === 2) {
      score += 8;
      indicators.push('✅ Verified at multiple points');
    } else if (historyLength === 1) {
      score += 6;
      indicators.push('⚠️ Single verification point');
    } else {
      score += 4;
      indicators.push('ℹ️ First verification');
    }
  } else {
    // First time seeing this - that's fine
    score += 4;
    indicators.push('ℹ️ First verification in system');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    indicators
  };
}

/**
 * 3. METADATA AUTHENTICITY (18 points)
 * 
 * v3.1 CHANGE: Start at full score, only SUBTRACT for suspicious indicators.
 * Missing EXIF is neutral (most legitimate images lack it after sharing).
 * 
 * Penalties:
 * - AI software in EXIF: -18 (complete disqualification)
 * - Advanced editing software (Photoshop): -6
 * - Basic editing software: -3
 * - Timestamp in future: -5
 * - Inconsistent metadata: -4
 * 
 * Bonuses (can't exceed max):
 * - Full camera EXIF: +2 (bonus confidence)
 * - GPS + timestamp verified: +1 (bonus confidence)
 */
async function calculateMetadataScore(data) {
  let score = 18; // Start at full score
  const indicators = [];
  const maxScore = 18;

  const metadata = data.metadata || {};
  const exif = metadata.exif || {};

  // Check for AI software in EXIF (immediate disqualification)
  const exifString = JSON.stringify(exif).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney', 
                      'novelai', 'automatic1111', 'comfyui', 'invoke ai',
                      'pytorch', 'tensorflow', 'diffusion'];
  const hasAISoftware = aiSoftware.some(sw => exifString.includes(sw));

  if (hasAISoftware) {
    score = 0;
    indicators.push('🚨 AI generation software detected in metadata');
    return {
      score: 0,
      maxScore,
      percentage: 0,
      indicators
    };
  }

  // Check for editing software (penalty, not disqualification)
  const software = exif.Software || exif.ProcessingSoftware || '';
  const softwareLower = software.toLowerCase();
  
  const advancedEditing = ['photoshop', 'lightroom', 'affinity', 'capture one', 
                           'luminar', 'darktable', 'rawtherapee'];
  const basicEditing = ['snapseed', 'vsco', 'instagram', 'gimp', 'paint.net'];
  
  if (advancedEditing.some(tool => softwareLower.includes(tool))) {
    score -= 6;
    indicators.push('⚠️ Advanced editing software detected: ' + software);
  } else if (basicEditing.some(tool => softwareLower.includes(tool))) {
    score -= 3;
    indicators.push('ℹ️ Basic editing software detected: ' + software);
  }

  // Check for suspicious timestamps
  const dateTime = exif.DateTime || exif.DateTimeOriginal || exif.CreateDate;
  if (dateTime) {
    const timestamp = new Date(dateTime);
    const now = new Date();
    
    if (timestamp > now) {
      score -= 5;
      indicators.push('⚠️ Timestamp is in the future (suspicious)');
    } else if (timestamp.getFullYear() < 1990) {
      score -= 3;
      indicators.push('⚠️ Timestamp predates digital photography');
    }
  }

  // Check for metadata inconsistencies
  if (exif.Make && exif.Model) {
    // Has camera info - check for inconsistencies
    const make = exif.Make.toLowerCase();
    const model = exif.Model.toLowerCase();
    
    // Check if make/model mismatch
    const makeModelMismatches = [
      { make: 'canon', invalidModels: ['d850', 'a7', 'x-t'] },
      { make: 'nikon', invalidModels: ['eos', '5d', 'a7'] },
      { make: 'sony', invalidModels: ['eos', 'd850', 'x-t'] },
    ];
    
    for (const check of makeModelMismatches) {
      if (make.includes(check.make)) {
        if (check.invalidModels.some(m => model.includes(m))) {
          score -= 4;
          indicators.push('⚠️ Camera make/model mismatch (suspicious)');
          break;
        }
      }
    }
  }

  // BONUSES for strong authenticity signals (camera metadata present)
  // These are bonuses, not requirements - score is already at max if nothing suspicious
  const hasMake = exif.Make && exif.Make.length > 0;
  const hasModel = exif.Model && exif.Model.length > 0;
  const hasDateTime = dateTime && isValidTimestamp(dateTime);
  const hasGPS = exif.GPSLatitude && exif.GPSLongitude;

  if (hasMake && hasModel && hasDateTime) {
    indicators.push(`✅ Camera metadata verified (${exif.Make} ${exif.Model})`);
    // Bonus already built into starting at max
  } else if (hasMake || hasModel) {
    indicators.push('ℹ️ Partial camera metadata present');
  } else {
    // No camera metadata - that's fine, most shared images lack it
    indicators.push('ℹ️ No camera metadata (normal for shared images)');
  }

  if (hasGPS && hasDateTime) {
    indicators.push('✅ GPS and timestamp present');
  }

  return {
    score: Math.max(0, Math.min(score, maxScore)),
    maxScore,
    percentage: Math.round((Math.max(0, score) / maxScore) * 100),
    indicators
  };
}

/**
 * 4. CONTENT PROVENANCE (10 points)
 */
async function calculateProvenanceScore(data) {
  let score = 0;
  const indicators = [];
  const maxScore = 10;

  // A. Reverse Image Search (5 points)
  if (data.reverseSearch) {
    const totalMatches = (data.reverseSearch.tineye?.matches?.length || 0) +
                         (data.reverseSearch.google?.matches?.length || 0);

    if (totalMatches === 0) {
      score += 5;
      indicators.push('✅ No matches found - appears original');
    } else if (totalMatches <= 2 && data.reverseSearch.matchesUserDomain) {
      score += 4;
      indicators.push('✅ Found only on your domains');
    } else if (totalMatches <= 2 && data.reverseSearch.hasAttribution) {
      score += 3;
      indicators.push('⚠️ Limited sharing with attribution');
    } else if (totalMatches <= 2) {
      score += 2;
      indicators.push('⚠️ Found on 1-2 other sites');
    } else {
      indicators.push('❌ Widely distributed online');
    }
  } else {
    // No reverse search performed - give partial credit
    score += 3;
    indicators.push('ℹ️ Reverse image search not performed');
  }

  // B. Prior Instance Analysis (5 points)
  if (data.priorInstances) {
    const ourTimestamp = data.blockchain?.timestamp ? 
      new Date(data.blockchain.timestamp).getTime() : Date.now();
    
    const earliestPublic = data.priorInstances.earliestFound;

    if (!earliestPublic) {
      score += 5;
      indicators.push('✅ First instance in system');
    } else {
      const publicTime = new Date(earliestPublic).getTime();
      const timeDiff = ourTimestamp - publicTime;
      const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

      if (ourTimestamp < publicTime) {
        score += 5;
        indicators.push('✅ We have the earliest version');
      } else if (Math.abs(daysDiff) < 1) {
        score += 3;
        indicators.push('⚠️ Published around the same time');
      } else if (daysDiff > 0) {
        score += 1;
        indicators.push('⚠️ Found elsewhere first');
      }
    }
  } else {
    // No prior instance check - give partial credit
    score += 3;
    indicators.push('ℹ️ First time verified');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    indicators
  };
}

/**
 * 5. AI DETECTION (15 points)
 * - Local heuristic: 4.5 points
 * - External API: 10.5 points
 */
async function calculateAIDetectionScore(data) {
  let score = 0;
  const indicators = [];
  const maxScore = 15;

  // A. Local Heuristic Detection (4.5 points)
  const localScore = calculateLocalAIScore(data);
  score += localScore.score;
  indicators.push(...localScore.indicators);

  // B. External API Detection (10.5 points)
  if (data.aiDetection && data.aiDetection.external) {
    const externalScore = calculateExternalAIScore(data.aiDetection.external);
    score += externalScore.score;
    indicators.push(...externalScore.indicators);
  } else {
    // No external API - give partial credit based on local analysis
    score += 5;
    indicators.push('ℹ️ Basic AI analysis performed');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    indicators,
    local: localScore,
    external: data.aiDetection?.external || null
  };
}

/**
 * Local AI Heuristic (4.5 points)
 * v3.1: Start optimistic, only subtract for red flags
 */
function calculateLocalAIScore(data) {
  let score = 4.5; // Start optimistic
  const indicators = [];
  const metadata = data.metadata || {};
  const exif = metadata.exif || {};

  // Check 1: AI software in EXIF (immediate disqualification)
  const exifString = JSON.stringify(exif).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney',
                      'novelai', 'automatic1111', 'comfyui'];
  
  if (aiSoftware.some(sw => exifString.includes(sw))) {
    return {
      score: 0,
      indicators: ['🚨 AI generation software detected']
    };
  }

  // Check 2: Known AI dimensions (suspicious but not conclusive)
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const aiDimensions = [
    [512, 512], [768, 768], [1024, 1024], [2048, 2048],
    [512, 768], [768, 512], [768, 1024], [1024, 768],
    [1024, 1792], [1792, 1024]  // DALL-E 3 sizes
  ];

  const isAIDimension = aiDimensions.some(([w, h]) => 
    Math.abs(width - w) < 5 && Math.abs(height - h) < 5
  );

  if (isAIDimension) {
    score -= 1.5;
    indicators.push('⚠️ Dimensions match common AI output sizes');
  }

  // Check 3: Strong camera indicators boost confidence
  if (exif.Make && exif.Model) {
    score = 4.5; // Reset to max
    indicators.length = 0; // Clear warnings
    indicators.push('✅ Camera metadata supports authenticity');
  } else {
    // No camera metadata is neutral, not negative
    if (indicators.length === 0) {
      indicators.push('ℹ️ No local AI indicators detected');
    }
  }

  return {
    score: Math.max(0, Math.min(4.5, score)),
    indicators
  };
}

/**
 * External API AI Detection (10.5 points)
 */
function calculateExternalAIScore(externalData) {
  const indicators = [];
  
  // externalData should have: { confidence: 0-100, result: 'authentic'|'ai_generated' }
  const authenticScore = externalData.authentic_confidence || 
                         (externalData.result === 'authentic' ? externalData.confidence : 100 - externalData.confidence);

  let score = 0;

  if (authenticScore >= 95) {
    score = 10.5;
    indicators.push('✅ AI detection: Very high confidence authentic');
  } else if (authenticScore >= 85) {
    score = 9.5;
    indicators.push('✅ AI detection: High confidence authentic');
  } else if (authenticScore >= 75) {
    score = 8;
    indicators.push('✅ AI detection: Likely authentic');
  } else if (authenticScore >= 60) {
    score = 6;
    indicators.push('⚠️ AI detection: Probably authentic');
  } else if (authenticScore >= 45) {
    score = 4;
    indicators.push('⚠️ AI detection: Uncertain');
  } else if (authenticScore >= 30) {
    score = 2;
    indicators.push('⚠️ AI detection: Possibly AI-generated');
  } else {
    score = 0;
    indicators.push('🚨 AI detection: Likely AI-generated');
  }

  return {
    score,
    indicators
  };
}

/**
 * Determine confidence level and recommendation
 */
function getConfidenceLevel(score) {
  if (score >= 90) {
    return {
      level: 'verified',
      label: 'VERIFIED',
      emoji: '✅',
      color: '#10B981',
      recommendation: 'safe_to_use',
      message: 'This content has been verified through multiple checks. Very high confidence in authenticity.'
    };
  } else if (score >= 80) {
    return {
      level: 'trusted',
      label: 'TRUSTED',
      emoji: '✅',
      color: '#22C55E',
      recommendation: 'likely_safe',
      message: 'This content shows strong signs of authenticity. High confidence.'
    };
  } else if (score >= 65) {
    return {
      level: 'acceptable',
      label: 'ACCEPTABLE',
      emoji: '⚠️',
      color: '#F59E0B',
      recommendation: 'review_carefully',
      message: 'This content appears authentic but has limited verification signals. Review recommended.'
    };
  } else if (score >= 50) {
    return {
      level: 'uncertain',
      label: 'UNCERTAIN',
      emoji: '⚠️',
      color: '#F97316',
      recommendation: 'verify_source',
      message: 'Unable to fully verify authenticity. Some concerning indicators present.'
    };
  } else if (score >= 35) {
    return {
      level: 'suspicious',
      label: 'SUSPICIOUS',
      emoji: '⚠️',
      color: '#EF4444',
      recommendation: 'do_not_use',
      message: 'This content shows red flags suggesting manipulation or AI generation.'
    };
  } else if (score >= 20) {
    return {
      level: 'untrusted',
      label: 'UNTRUSTED',
      emoji: '🔴',
      color: '#DC2626',
      recommendation: 'reject',
      message: 'This content is likely AI-generated or manipulated. Do not use as authentic.'
    };
  } else {
    return {
      level: 'high_risk',
      label: 'HIGH RISK',
      emoji: '🚨',
      color: '#991B1B',
      recommendation: 'reject_immediately',
      message: 'HIGH RISK: Almost certainly AI-generated or heavily manipulated. REJECT.'
    };
  }
}

/**
 * Helper: Validate timestamp
 */
function isValidTimestamp(dateString) {
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const now = new Date();
    
    // Check if date is reasonable (between 1990 and now)
    return year >= 1990 && date <= now;
  } catch (error) {
    return false;
  }
}

module.exports = {
  calculateTrustScore,
  calculateCryptographicScore,
  calculateBlockchainScore,
  calculateMetadataScore,
  calculateProvenanceScore,
  calculateAIDetectionScore,
  getConfidenceLevel
};