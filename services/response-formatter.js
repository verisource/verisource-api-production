/**
 * API Response Formatter
 * Formats verification results into clean API responses
 */

/**
 * Format verification response
 * @param {Object} verificationData - Complete verification data
 * @param {Object} trustScoreResult - Trust score calculation result
 * @returns {Object} Formatted API response
 */
function formatVerificationResponse(verificationData, trustScoreResult) {
  const response = {
    verification_id: verificationData.verificationId || generateVerificationId(),
    timestamp: new Date().toISOString(),
    
    // Trust Score (main result)
    trust_score: {
      overall: trustScoreResult.trust_score.overall,
      confidence_level: trustScoreResult.trust_score.confidence_level,
      confidence_label: trustScoreResult.trust_score.confidence_label,
      recommendation: trustScoreResult.trust_score.recommendation,
      message: getConfidenceMessage(trustScoreResult.trust_score),
      breakdown: trustScoreResult.trust_score.breakdown
    },

    // Verification Details
    verification: {
      hash: formatHashResult(verificationData),
      blockchain: formatBlockchainResult(verificationData),
      metadata: formatMetadataResult(verificationData),
      provenance: formatProvenanceResult(verificationData),
      ai_detection: formatAIDetectionResult(verificationData)
    },

    // Indicators
    indicators: trustScoreResult.indicators,

    // Links
    links: {
      verification_certificate: `https://verisource.io/verify/${verificationData.verificationId}`,
      blockchain_proof: verificationData.blockchain?.txUrl || null,
      detailed_report: `https://verisource.io/verify/${verificationData.verificationId}/report`
    }
  };

  // Add alerts if any
  if (trustScoreResult.trust_score.overall < 55) {
    response.alerts = generateAlerts(verificationData, trustScoreResult);
  }

  return response;
}

/**
 * Format hash result
 */
function formatHashResult(data) {
  return {
    sha256: data.hash,
    verified: !!data.hash,
    duplicates_found: data.duplicates?.found || 0,
    status: data.hash ? 'verified' : 'failed'
  };
}

/**
 * Format blockchain result
 */
function formatBlockchainResult(data) {
  if (!data.blockchain) {
    return {
      status: 'not_recorded',
      network: null,
      timestamp: null
    };
  }

  return {
    status: data.blockchain.confirmations >= 12 ? 'confirmed' : 'pending',
    network: data.blockchain.network || 'polygon',
    timestamp: data.blockchain.timestamp,
    confirmations: data.blockchain.confirmations || 0,
    tx_hash: data.blockchain.txHash || null,
    tx_url: data.blockchain.txUrl || null,
    block: data.blockchain.block || null
  };
}

/**
 * Format metadata result
 */
function formatMetadataResult(data) {
  const metadata = data.metadata || {};
  const exif = metadata.exif || {};

  return {
    format: metadata.format,
    dimensions: metadata.width && metadata.height ? 
      `${metadata.width}x${metadata.height}` : null,
    camera: {
      make: exif.Make || null,
      model: exif.Model || null,
      has_camera_data: !!(exif.Make || exif.Model)
    },
    location: {
      gps: exif.GPSLatitude && exif.GPSLongitude ?
        `${exif.GPSLatitude},${exif.GPSLongitude}` : null,
      has_gps: !!(exif.GPSLatitude && exif.GPSLongitude)
    },
    timestamp: {
      datetime: exif.DateTime || exif.DateTimeOriginal || null,
      has_timestamp: !!(exif.DateTime || exif.DateTimeOriginal)
    },
    software: exif.Software || null
  };
}

/**
 * Format provenance result
 */
function formatProvenanceResult(data) {
  const reverseSearch = data.reverseSearch || {};
  
  return {
    reverse_search: {
      tineye_matches: reverseSearch.tineye?.matches?.length || 0,
      google_matches: reverseSearch.google?.matches?.length || 0,
      total_matches: 
        (reverseSearch.tineye?.matches?.length || 0) +
        (reverseSearch.google?.matches?.length || 0)
    },
    first_seen: data.blockchain?.timestamp || new Date().toISOString(),
    earlier_versions: data.priorInstances?.earliestFound ? true : false,
    status: !data.priorInstances?.earliestFound ? 'appears_original' : 'found_elsewhere'
  };
}

/**
 * Format AI detection result
 */
function formatAIDetectionResult(data) {
  const ai = data.aiDetection || {};
  
  const result = {
    local: {
      confidence: ai.local?.confidence || null,
      result: ai.local?.result || null,
      certainty: ai.local?.certainty || null
    }
  };

  if (ai.external) {
    result.external = {
      provider: ai.external.provider || 'hive_ai',
      confidence: ai.external.authentic_confidence || ai.external.confidence,
      result: ai.external.result,
      status: ai.external.status
    };
    result.combined = ai.combined || null;
  } else {
    result.note = 'External AI detection not available - upgrade for 95%+ accuracy';
  }

  return result;
}

/**
 * Get confidence message
 */
function getConfidenceMessage(trustScore) {
  const messages = {
    'verified': 'This content has been verified through multiple cryptographic and forensic checks. Very high confidence in authenticity.',
    'trusted': 'This content shows strong signs of authenticity with minor inconsistencies. High confidence.',
    'acceptable': 'This content shows mixed signals. It may be authentic but requires careful review. Verify the source before use.',
    'uncertain': 'Unable to verify authenticity with confidence. This content shows concerning indicators. Strongly recommend verifying the source.',
    'suspicious': 'This content shows multiple red flags suggesting AI generation or manipulation. High risk. Do not use without expert verification.',
    'untrusted': 'This content is very likely AI-generated or manipulated. Strong indicators of synthetic origin. Do not use as authentic content.',
    'high_risk': 'HIGH RISK: This content is almost certainly AI-generated or heavily manipulated. Multiple critical red flags detected. REJECT.'
  };

  return messages[trustScore.confidence_level] || 'Unable to determine authenticity.';
}

/**
 * Generate alerts
 */
function generateAlerts(data, trustScore) {
  const alerts = [];

  if (trustScore.trust_score.overall < 25) {
    alerts.push({
      severity: 'critical',
      type: 'high_risk',
      message: 'This content is almost certainly AI-generated or manipulated.'
    });
  }

  if (trustScore.trust_score.overall < 55) {
    alerts.push({
      severity: 'warning',
      type: 'low_trust',
      message: 'Low trust score - verify source before use.'
    });
  }

  // Check for AI software in metadata
  const exifString = JSON.stringify(data.metadata?.exif || {}).toLowerCase();
  if (exifString.includes('dall-e') || exifString.includes('midjourney') || 
      exifString.includes('stable diffusion')) {
    alerts.push({
      severity: 'critical',
      type: 'ai_software_detected',
      message: 'AI generation software detected in metadata.'
    });
  }

  // Check for manipulation indicators
  if (data.aiDetection?.external?.result === 'manipulated') {
    alerts.push({
      severity: 'critical',
      type: 'manipulation_detected',
      message: 'Content manipulation detected by AI analysis.'
    });
  }

  return alerts;
}

/**
 * Generate verification ID
 */
function generateVerificationId() {
  return 'ver_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Format short response (for list views)
 */
function formatShortResponse(verificationData, trustScoreResult) {
  return {
    verification_id: verificationData.verificationId,
    trust_score: trustScoreResult.trust_score.overall,
    confidence_label: trustScoreResult.trust_score.confidence_label,
    hash: verificationData.hash?.substring(0, 16) + '...',
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  formatVerificationResponse,
  formatShortResponse
};
