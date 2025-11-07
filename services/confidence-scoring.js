/**
 * Confidence Scoring System
 * Calculates confidence scores based on multiple factors including pHash similarity
 */

class ConfidenceScoring {
  
  /**
   * Calculate overall confidence score
   * @param {Object} verification - Verification result data
   * @returns {Object} Confidence score with breakdown
   */
  static calculate(verification) {
    const factors = [
      this.scoreMetadataQuality(verification),
      this.scoreExternalVerification(verification),
      this.scoreForensicAnalysis(verification),
      this.scoreTemporalTrust(verification),
      this.scoreAIAuthenticity(verification),
    ];
    
    const totalScore = factors.reduce((sum, f) => sum + f.score, 0);
    const maxScore = factors.reduce((sum, f) => sum + f.max, 0);
    const percentage = Math.round((totalScore / maxScore) * 100);
    
    // Check for modifications using pHash similarity
    const isModified = this.detectModification(verification);
    
    const level = this.getLevel(percentage, isModified);
    
    return {
      score: totalScore,
      max_score: maxScore,
      percentage,
      level: level.name,
      label: level.label,
      color: level.color,
      icon: level.icon,
      iconSvg: level.iconSvg,
      message: level.message,
      is_modified: isModified.detected,
      modification_details: isModified.details,
      factors: factors.map(f => ({
        name: f.name,
        score: f.score,
        max: f.max,
        percentage: Math.round((f.score / f.max) * 100),
        details: f.details
      })),
      warnings: this.generateWarnings(factors, percentage, isModified),
      recommendations: this.generateRecommendations(factors, percentage, isModified)
    };
  }
  
  /**
   * Detect if content has been modified using pHash similarity
   * @param {Object} verification - Verification data
   * @returns {Object} Modification detection result
   */
  static detectModification(verification) {
    const similar = verification.similar_images;
    
    if (!similar?.found || !similar.matches || similar.matches.length === 0) {
      return {
        detected: false,
        details: null
      };
    }
    
    // Get the best match
    const bestMatch = similar.matches[0];
    const similarity = bestMatch.similarity || 0;
    
    // If 100% similar, it's identical (not modified)
    if (similarity === 100) {
      return {
        detected: false,
        details: {
          type: 'identical',
          similarity: 100,
          interpretation: bestMatch.interpretation
        }
      };
    }
    
    // If 85-99% similar, it's likely a modified version
    if (similarity >= 85 && similarity < 100) {
      return {
        detected: true,
        details: {
          type: 'modified_version',
          similarity: similarity,
          hamming_distance: bestMatch.hamming_distance,
          interpretation: bestMatch.interpretation,
          original_filename: bestMatch.filename,
          modifications: this.inferModifications(similarity, bestMatch)
        }
      };
    }
    
    // If 70-84% similar, possibly heavily modified
    if (similarity >= 70 && similarity < 85) {
      return {
        detected: true,
        details: {
          type: 'heavily_modified',
          similarity: similarity,
          hamming_distance: bestMatch.hamming_distance,
          interpretation: 'Substantially different',
          original_filename: bestMatch.filename
        }
      };
    }
    
    return {
      detected: false,
      details: null
    };
  }
  
  /**
   * Infer what modifications were likely made based on similarity score
   */
  static inferModifications(similarity, match) {
    const mods = [];
    
    if (similarity >= 95) {
      mods.push('Minor edits (compression, slight crop, or format change)');
    } else if (similarity >= 90) {
      mods.push('Moderate edits (cropping, resizing, or color adjustments)');
    } else if (similarity >= 85) {
      mods.push('Significant edits (substantial cropping, filters, or overlays)');
    }
    
    return mods;
  }
  
  /**
   * Get confidence level based on percentage and modification status
   * @param {number} percentage - Score percentage (0-100)
   * @param {Object} isModified - Modification detection result
   * @returns {Object} Level details
   */
  static getLevel(percentage, isModified) {
    // HIGH: 75-100% - Original or identical match
    if (percentage >= 75) {
      return {
        name: 'HIGH',
        label: 'VERIFIED AUTHENTIC',
        color: '#10B981',
        icon: 'shield',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10B981"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 17.93c-3.95-.9-7-4.24-7-8.43V6.3l7-3.11v16.74zm2-16.74l7 3.11v4.2c0 4.19-3.05 7.53-7 8.43V2.19z"/></svg>',
        message: 'Content verified as authentic with high confidence'
      };
    } 
    
    // MEDIUM: 50-74% - Modified version detected OR likely authentic
    if (percentage >= 50) {
      if (isModified.detected) {
        return {
          name: 'MEDIUM',
          label: 'AUTHENTIC BUT MODIFIED',
          color: '#F59E0B',
          icon: 'edit',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
          message: `Authentic content that has been modified (${isModified.details.similarity}% match to original)`
        };
      } else {
        return {
          name: 'MEDIUM',
          label: 'LIKELY AUTHENTIC',
          color: '#F59E0B',
          icon: 'alert-triangle',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          message: 'Content appears authentic but has minor concerns'
        };
      }
    }
    
    // LOW: 25-49% - Questionable
    if (percentage >= 25) {
      return {
        name: 'LOW',
        label: 'QUESTIONABLE',
        color: '#F97316',
        icon: 'alert-circle',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        message: 'Multiple red flags detected - verify carefully'
      };
    }
    
    // VERY LOW: 0-24% - Likely manipulated
    return {
      name: 'VERY_LOW',
      label: 'LIKELY MANIPULATED',
      color: '#DC3545',
      icon: 'x-circle',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      message: 'Strong indicators of manipulation or inauthenticity'
    };
  }
  
  /**
   * Score metadata quality (max 30 points)
   */
  static scoreMetadataQuality(data) {
    let score = 0;
    const details = [];
    
    if (data.kind === 'image') {
      score += 10;
      details.push('✅ Valid image file');
    }
    
    if (data.canonical?.fingerprint) {
      score += 10;
      details.push('✅ Cryptographic fingerprint generated');
    }
    
    if (data.size_bytes > 1000) {
      score += 10;
      details.push('✅ Reasonable file size');
    }
    
    return {
      name: 'Metadata Quality',
      score,
      max: 30,
      details
    };
  }
  
  /**
   * Score external verification (max 30 points)
   */
  static scoreExternalVerification(data) {
    let score = 0;
    const details = [];
    
    if (data.external_search?.found) {
      const vt = data.external_search.results;
      
      if (vt.malware_detections?.malicious === 0) {
        score += 10;
        details.push('✅ No malware detected');
      }
      
      if (vt.times_submitted > 10) {
        details.push('⚠️ Found online - may be reupload');
        score += 5;
      } else if (vt.times_submitted > 0) {
        details.push('⚠️ Previously seen online');
        score += 10;
      } else {
        score += 15;
        details.push('✅ Not previously indexed');
      }
      
      if (vt.reputation >= 0) {
        score += 5;
        details.push('✅ Positive reputation');
      }
    } else {
      score += 15;
      details.push('✅ Not found in external databases');
    }
    
    return {
      name: 'External Verification',
      score,
      max: 30,
      details
    };
  }
  
  /**
   * Score forensic analysis (max 25 points)
   */
  static scoreForensicAnalysis(data) {
    let score = 10;
    const details = ['✅ No obvious manipulation detected'];
    
    if (data.ai_detection) {
      if (data.ai_detection.likely_ai_generated) {
        score -= 5;
        details.push(`⚠️ Possible AI generation (${data.ai_detection.ai_confidence}% confidence)`);
      } else {
        score += 5;
        details.push('✅ Low likelihood of AI generation');
      }
    }
    
    if (data.google_vision?.results?.safe_search?.is_safe) {
      score += 5;
      details.push('✅ Safe content verified');
    }
    
    if (data.similar_images?.found && data.similar_images.count > 0) {
      score += 5;
      const interpretation = data.similar_images.matches[0]?.interpretation || 'Similar';
      details.push(`✅ ${data.similar_images.count} similar version(s) found (${interpretation})`);
    }
    
    return {
      name: 'Forensic Analysis',
      score: Math.min(score, 25),
      max: 25,
      details
    };
  }
  
  /**
   * Score temporal trust (max 15 points)
   */
  static scoreTemporalTrust(data) {
    let score = 0;
    const details = [];
    
    if (data.verification_history?.internal?.is_first_verification) {
      score += 0;
      details.push('⚠️ First verification - no history');
    } else {
      score += 10;
      details.push('✅ Previously verified content');
    }
    
    if (data.external_search?.results?.first_seen) {
      const firstSeen = new Date(data.external_search.results.first_seen);
      const age = Date.now() - firstSeen.getTime();
      const daysOld = age / (1000 * 60 * 60 * 24);
      
      if (daysOld > 365) {
        score += 5;
        details.push('✅ Content exists for over a year');
      } else if (daysOld > 30) {
        score += 3;
        details.push('✅ Content exists for over a month');
      }
    }
    
    return {
      name: 'Temporal Trust',
      score,
      max: 15,
      details
    };
  }
  
  /**
   * Generate warnings based on factors
   */
  static generateWarnings(factors, percentage, isModified) {
    const warnings = [];
    
    factors.forEach(factor => {
      const pct = (factor.score / factor.max) * 100;
      if (pct < 50) {
        warnings.push(`Low ${factor.name.toLowerCase()}`);
      }
    });
    
    if (isModified.detected) {
      warnings.push(`Content has been modified (${isModified.details.similarity}% similarity to original)`);
    }
    
    if (percentage < 50) {
      warnings.push('Overall confidence below acceptable threshold');
    }
    
    return warnings;
  }
  
  /**
   * Generate recommendations
   */
  static generateRecommendations(factors, percentage, isModified) {
    const recommendations = [];
    
    if (percentage < 75 && !isModified.detected) {
      recommendations.push('Consider obtaining additional verification from original source');
    }
    
    if (isModified.detected) {
      recommendations.push('Verify the source of modifications and original content provenance');
      if (isModified.details.modifications) {
        recommendations.push(`Detected modifications: ${isModified.details.modifications.join(', ')}`);
      }
    }
    
    const externalFactor = factors.find(f => f.name === 'External Verification');
    if (externalFactor && (externalFactor.score / externalFactor.max) < 0.5) {
      recommendations.push('Verify chain of custody for this content');
    }
    
    return recommendations;
  }

  /**
   * Score AI authenticity (max 30 points)
   * Heavily penalizes AI-generated content
   */
  static scoreAIAuthenticity(data) {
    let score = 0;
    const details = [];
    const max = 30;
    
    if (!data.ai_detection) {
      score = 15;
      details.push('⚠️ AI detection not available');
      return { name: 'AI Authenticity', score, max, details };
    }
    
    const ai = data.ai_detection;
    
    if (ai.likely_ai_generated) {
      score = 0;
      details.push(`❌ AI-generated content detected (${ai.ai_confidence}% confidence)`);
      
      if (ai.indicators && ai.indicators.length > 0) {
        ai.indicators.forEach(indicator => {
          details.push(`  - ${indicator}`);
        });
      }
    } else {
      score = 30;
      details.push('✅ Content appears authentic');
      details.push(`  - AI suspicion score: ${ai.ai_confidence}%`);
      
      if (ai.metadata_check?.has_camera_exif) {
        details.push('  - Camera metadata present');
      }
    }
    
    return { name: 'AI Authenticity', score, max, details };
  }
}


module.exports = ConfidenceScoring;
