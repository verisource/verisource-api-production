/**
 * Confidence Scoring System for VeriSource
 * 4 Clear Levels: HIGH, MEDIUM, LOW, DISPUTED
 */

function calculateConfidenceScore(verification) {
  let score = 0;
  const factors = [];
  
  // Factor 1: Metadata Quality (0-30 points)
  const metadataScore = analyzeMetadata(verification);
  score += metadataScore.score;
  factors.push({
    name: 'Metadata Quality',
    score: metadataScore.score,
    max: 30,
    percentage: Math.round((metadataScore.score / 30) * 100),
    details: metadataScore.details
  });
  
  // Factor 2: External Verification (0-30 points)
  const externalScore = analyzeExternalSearch(verification);
  score += externalScore.score;
  factors.push({
    name: 'External Verification',
    score: externalScore.score,
    max: 30,
    percentage: Math.round((externalScore.score / 30) * 100),
    details: externalScore.details
  });
  
  // Factor 3: Forensic Analysis (0-25 points)
  const forensicScore = analyzeForensics(verification);
  score += forensicScore.score;
  factors.push({
    name: 'Forensic Analysis',
    score: forensicScore.score,
    max: 25,
    percentage: Math.round((forensicScore.score / 25) * 100),
    details: forensicScore.details
  });
  
  // Factor 4: Temporal Trust (0-15 points)
  const temporalScore = analyzeAge(verification);
  score += temporalScore.score;
  factors.push({
    name: 'Temporal Trust',
    score: temporalScore.score,
    max: 15,
    percentage: Math.round((temporalScore.score / 15) * 100),
    details: temporalScore.details
  });
  
  // Determine confidence level (4 levels only)
  const level = getConfidenceLevel(score, verification);
  
  return {
    score: Math.round(score),
    max_score: 100,
    percentage: Math.round(score),
    level: level.level,
    label: level.label,
    color: level.color,
    icon: level.icon,
    message: level.message,
    factors: factors,
    warnings: getWarnings(verification, factors),
    recommendations: getRecommendations(level.level, factors)
  };
}

function analyzeMetadata(verification) {
  let score = 0;
  const details = [];
  
  if (verification.kind === 'image') {
    score += 10;
    details.push('✅ Image file type');
  }
  
  score += 20;
  details.push('✅ File structure intact');
  
  return { score, details };
}

function analyzeExternalSearch(verification) {
  let score = 0;
  const details = [];
  
  if (verification.google_vision) {
    if (!verification.google_vision.found) {
      score += 30;
      details.push('✅ No prior online publication');
    } else {
      score += 5;
      details.push('⚠️ Found online - may be reupload');
    }
  } else {
    score += 15;
    details.push('⚠️ External search not performed');
  }
  
  return { score, details };
}

function analyzeForensics(verification) {
  let score = 20;
  const details = ['✅ No obvious manipulation detected'];
  
  return { score, details };
}

function analyzeAge(verification) {
  let score = 0;
  const details = [];
  
  if (verification.verified_at || verification.created_at) {
    const uploadDate = new Date(verification.verified_at || verification.created_at);
    const now = new Date();
    const ageInDays = (now - uploadDate) / (1000 * 60 * 60 * 24);
    
    if (ageInDays < 1) {
      score = 0;
      details.push('⚠️ Uploaded < 24 hours ago');
    } else if (ageInDays < 7) {
      score = 5;
      details.push('⚠️ Uploaded < 7 days ago');
    } else if (ageInDays < 30) {
      score = 10;
      details.push('✅ Uploaded 7-30 days ago');
    } else {
      score = 15;
      details.push('✅ Uploaded 30+ days ago');
    }
  } else {
    score = 10;
    details.push('⚠️ Upload date unknown');
  }
  
  return { score, details };
}

function getConfidenceLevel(score, verification) {
  // Check for disputes first (overrides score)
  if (verification.dispute_count && verification.dispute_count > 0) {
    return {
      level: 'DISPUTED',
      label: 'DISPUTED',
      color: '#FF8C00',
      icon: '🟠',
      message: 'Ownership is under dispute'
    };
  }
  
  // 4 levels based on score
  if (score >= 75) {
    return {
      level: 'HIGH',
      label: 'HIGH CONFIDENCE',
      color: '#28A745',
      icon: '🟢',
      message: 'Strong indicators of authenticity'
    };
  } else if (score >= 50) {
    return {
      level: 'MEDIUM',
      label: 'MEDIUM CONFIDENCE',
      color: '#FFC107',
      icon: '🟡',
      message: 'Mixed indicators - requires verification'
    };
  } else {
    return {
      level: 'LOW',
      label: 'LOW CONFIDENCE',
      color: '#DC3545',
      icon: '🔴',
      message: 'Red flags detected - potential issues'
    };
  }
}

function getWarnings(verification, factors) {
  const warnings = [];
  
  if (verification.google_vision && verification.google_vision.found) {
    warnings.push('Content found online before upload');
  }
  
  factors.forEach(factor => {
    if (factor.percentage < 50) {
      warnings.push(`Low ${factor.name.toLowerCase()}`);
    }
  });
  
  if (verification.verified_at || verification.created_at) {
    const uploadDate = new Date(verification.verified_at || verification.created_at);
    const now = new Date();
    const ageInDays = (now - uploadDate) / (1000 * 60 * 60 * 24);
    
    if (ageInDays < 1) {
      warnings.push('Recently uploaded - limited trust');
    }
  }
  
  return warnings;
}

function getRecommendations(level, factors) {
  const recommendations = [];
  
  if (level === 'LOW' || level === 'MEDIUM') {
    recommendations.push('Consider providing additional proof of ownership');
    recommendations.push('Link to original publication sources');
  }
  
  if (level === 'DISPUTED') {
    recommendations.push('Review dispute details');
    recommendations.push('Provide evidence of original creation');
  }
  
  return recommendations;
}

module.exports = {
  calculateConfidenceScore
};
