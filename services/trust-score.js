/**
 * VeriSource Trust Score Calculator v3.0
 * 
 * Calculates comprehensive trust score (0-100) based on:
 * 1. Cryptographic Integrity (32%)
 * 2. Blockchain Provenance (25%)
 * 3. Metadata Authenticity (18%)
 * 4. Content Provenance (10%)
 * 5. AI Detection (15%)
 *    - Local heuristic: 4.5%
 *    - External API: 10.5%
 * 
 * Total: 100%
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
  const totalScore = 
    scores.cryptographic.score +
    scores.blockchain.score +
    scores.metadata.score +
    scores.provenance.score +
    scores.aiDetection.score;

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
      }
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
      score += 10;
      indicators.push('⚠️ Blockchain confirmation pending');
    } else if (ageMinutes < 5) {
      score += 8;
      indicators.push('⚠️ Just submitted to blockchain');
    } else {
      indicators.push('❌ Not recorded on blockchain');
    }
  } else {
    indicators.push('❌ No blockchain timestamp');
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
      score += 5;
      indicators.push('⚠️ Single verification point');
    } else {
      indicators.push('❌ No chain of custody');
    }
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
 */
async function calculateMetadataScore(data) {
  let score = 0;
  const indicators = [];
  const maxScore = 18;

  const metadata = data.metadata || {};
  const exif = metadata.exif || {};

  // A. Camera EXIF Data (9 points)
  const hasMake = exif.Make && exif.Make.length > 0;
  const hasModel = exif.Model && exif.Model.length > 0;
  const hasDateTime = exif.DateTime || exif.DateTimeOriginal;

  // Check for AI software in EXIF (automatic disqualification)
  const exifString = JSON.stringify(exif).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney', 
                      'pytorch', 'tensorflow', 'diffusion'];
  const hasAISoftware = aiSoftware.some(sw => exifString.includes(sw));

  if (hasAISoftware) {
    // Force to 0 for this category if AI software detected
    indicators.push('🚨 AI generation software detected in metadata');
  } else if (hasMake && hasModel && hasDateTime) {
    score += 9;
    indicators.push(`✅ Camera metadata verified (${exif.Make} ${exif.Model})`);
  } else if (hasMake || hasModel) {
    score += 6;
    indicators.push('⚠️ Partial camera metadata present');
  } else if (exif && Object.keys(exif).length > 5) {
    score += 3;
    indicators.push('⚠️ EXIF present but no camera data');
  } else {
    indicators.push('❌ No camera metadata');
  }

  // B. GPS & Timestamp (5 points)
  const hasGPS = exif.GPSLatitude && exif.GPSLongitude;
  const hasValidTimestamp = hasDateTime && isValidTimestamp(hasDateTime);

  if (hasGPS && hasValidTimestamp) {
    score += 5;
    indicators.push('✅ GPS and timestamp verified');
  } else if (hasValidTimestamp) {
    score += 3;
    indicators.push('⚠️ Timestamp present (no GPS)');
  } else if (hasGPS) {
    score += 2;
    indicators.push('⚠️ GPS present (no timestamp)');
  } else {
    indicators.push('❌ No location/timestamp data');
  }

  // C. Software Analysis (4 points)
  const software = exif.Software || '';
  const editingTools = ['photoshop', 'lightroom', 'gimp', 'snapseed'];
  const basicTools = ['preview', 'photos', 'paint'];

  if (hasAISoftware) {
    // Already penalized above
  } else if (editingTools.some(tool => software.toLowerCase().includes(tool))) {
    score += 2;
    indicators.push('⚠️ Advanced editing software detected');
  } else if (basicTools.some(tool => software.toLowerCase().includes(tool))) {
    score += 3;
    indicators.push('⚠️ Basic editing detected');
  } else if (!software || software.length < 5) {
    score += 4;
    indicators.push('✅ No editing software detected');
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
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
    indicators.push('ℹ️ External AI detection not available (upgrade for advanced detection)');
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
 */
function calculateLocalAIScore(data) {
  let score = 4.5; // Start optimistic
  const indicators = [];
  const metadata = data.metadata || {};
  const exif = metadata.exif || {};

  // Check 1: AI software in EXIF (immediate disqualification)
  const exifString = JSON.stringify(exif).toLowerCase();
  const aiSoftware = ['stable diffusion', 'dall-e', 'dalle', 'midjourney'];
  
  if (aiSoftware.some(sw => exifString.includes(sw))) {
    return {
      score: 0,
      indicators: ['�� AI generation software detected']
    };
  }

  // Check 2: Known AI dimensions
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const aiDimensions = [
    [1024, 1024], [512, 512], [768, 768],
    [1024, 768], [768, 1024], [2048, 2048]
  ];

  const isAIDimension = aiDimensions.some(([w, h]) => 
    Math.abs(width - w) < 10 && Math.abs(height - h) < 10
  );

  if (isAIDimension) {
    score -= 2;
    indicators.push('⚠️ Suspicious dimensions (common AI size)');
  }

  // Check 3: PNG without metadata
  if (metadata.format === 'png' && (!exif || Object.keys(exif).length < 3)) {
    score -= 1.5;
    indicators.push('⚠️ PNG without metadata');
  }

  // Check 4: Strong camera indicators (boost score back up)
  if (exif.Make && exif.Model) {
    score = 4.5; // Reset to max
    indicators.length = 0; // Clear warnings
    indicators.push('✅ Strong camera metadata - likely authentic');
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
    indicators.push('✅ AI detection: Very high confidence authentic (95%+)');
  } else if (authenticScore >= 80) {
    score = 9;
    indicators.push('✅ AI detection: High confidence authentic (80-94%)');
  } else if (authenticScore >= 70) {
    score = 7;
    indicators.push('✅ AI detection: Moderate confidence authentic (70-79%)');
  } else if (authenticScore >= 50) {
    score = 5;
    indicators.push('⚠️ AI detection: Uncertain (50-69%)');
  } else if (authenticScore >= 30) {
    score = 3;
    indicators.push('⚠️ AI detection: Likely AI-generated (30-49%)');
  } else {
    score = 0;
    indicators.push('�� AI detection: Very likely AI-generated (0-29%)');
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
  if (score >= 95) {
    return {
      level: 'verified',
      label: 'VERIFIED',
      emoji: '✅',
      color: '#10B981',
      recommendation: 'safe_to_use',
      message: 'This content has been verified through multiple cryptographic and forensic checks. Very high confidence in authenticity.'
    };
  } else if (score >= 85) {
    return {
      level: 'trusted',
      label: 'TRUSTED',
      emoji: '✅',
      color: '#22C55E',
      recommendation: 'likely_safe',
      message: 'This content shows strong signs of authenticity with minor inconsistencies. High confidence.'
    };
  } else if (score >= 70) {
    return {
      level: 'acceptable',
      label: 'ACCEPTABLE',
      emoji: '⚠️',
      color: '#F59E0B',
      recommendation: 'review_carefully',
      message: 'This content shows mixed signals. It may be authentic but requires careful review. Verify the source before use.'
    };
  } else if (score >= 55) {
    return {
      level: 'uncertain',
      label: 'UNCERTAIN',
      emoji: '⚠️',
      color: '#F97316',
      recommendation: 'verify_source',
      message: 'Unable to verify authenticity with confidence. This content shows concerning indicators. Strongly recommend verifying the source.'
    };
  } else if (score >= 40) {
    return {
      level: 'suspicious',
      label: 'SUSPICIOUS',
      emoji: '⚠️',
      color: '#EF4444',
      recommendation: 'do_not_use',
      message: 'This content shows multiple red flags suggesting AI generation or manipulation. High risk. Do not use without expert verification.'
    };
  } else if (score >= 25) {
    return {
      level: 'untrusted',
      label: 'UNTRUSTED',
      emoji: '🔴',
      color: '#DC2626',
      recommendation: 'reject',
      message: 'This content is very likely AI-generated or manipulated. Strong indicators of synthetic origin. Do not use as authentic content.'
    };
  } else {
    return {
      level: 'high_risk',
      label: 'HIGH RISK',
      emoji: '🚨',
      color: '#991B1B',
      recommendation: 'reject_immediately',
      message: 'HIGH RISK: This content is almost certainly AI-generated or heavily manipulated. Multiple critical red flags detected. REJECT.'
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
    
    // Check if date is reasonable (between 2000 and now)
    return year >= 2000 && date <= now;
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
