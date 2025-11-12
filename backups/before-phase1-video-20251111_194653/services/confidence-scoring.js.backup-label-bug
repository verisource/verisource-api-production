/**
 * Confidence Scoring System
 * Last updated: 2025-11-10T04:48:17.759003
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
      this.scoreTemporalTrust(verification)
    ];
    
    const totalScore = factors.reduce((sum, f) => sum + f.score, 0);
    const maxScore = factors.reduce((sum, f) => sum + f.max, 0);
    const percentage = Math.round((totalScore / maxScore) * 100);
    
    // Check for modifications using pHash similarity
    const isModified = this.detectModification(verification);
    
    const level = this.getLevel(percentage, isModified, verification.ai_detection, verification.kind, verification.video_analysis, verification.audio_ai_detection);
    
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
  static getLevel(percentage, isModified, aiDetection, mediaType, mediaAnalysis, audioAIDetection) {
    // AI detection override for images
    if (mediaType === 'image' && aiDetection?.likely_ai_generated) {
      return {
        name: 'LOW',
        label: 'AI-GENERATED IMAGE',
        color: '#9333EA',
        icon: 'cpu',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9333EA" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>',
        message: `AI generation detected (${aiDetection.ai_confidence}% confidence)`
      };
    }
    
    // Video-specific labeling
    if (mediaType === 'video' && mediaAnalysis?.analysis) {
      const aiPct = mediaAnalysis.analysis.aiPercentage || 0;
      const hasFaces = mediaAnalysis.frames?.some(f => 
        f.aiDetection?.indicators?.some(i => i.toLowerCase().includes('face'))
      );
      
      if (hasFaces && aiPct > 30) {
        return {
          name: 'LOW',
          label: 'DEEPFAKE INDICATORS DETECTED',
          color: '#DC3545',
          icon: 'alert-octagon',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
          message: `AI-manipulated faces present (${aiPct}% AI content)`
        };
      }
      
      if (aiPct >= 70) {
        return {
          name: 'LOW',
          label: 'PRIMARILY AI-GENERATED VIDEO',
          color: '#DC3545',
          icon: 'film',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
          message: `${aiPct}% of frames appear synthetic`
        };
      }
      
      if (aiPct >= 30) {
        return {
          name: 'MEDIUM',
          label: 'SIGNIFICANT MIX OF VIDEO AND AI CONTENT',
          color: '#F97316',
          icon: 'layers',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
          message: `${aiPct}% AI-generated, ${100-aiPct}% camera-captured`
        };
      }
      
      if (aiPct >= 5) {
        return {
          name: 'MEDIUM',
          label: 'AI-GENERATED CONTENT DETECTED',
          color: '#F59E0B',
          icon: 'alert-triangle',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          message: `${aiPct}% AI content mixed with camera footage`
        };
      }
      
      return {
        name: 'HIGH',
        label: 'VERIFIED VIDEO',
        color: '#10B981',
        icon: 'shield',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10B981"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
        message: 'Minimal to no AI content detected'
      };
    }
    
    // Audio-specific labeling
    if (mediaType === 'audio' && audioAIDetection) {
      const aiConfidence = audioAIDetection.ai_confidence || 0;
      const likelyAI = audioAIDetection.likely_ai_generated || false;
      
      console.log(`🎵 Audio AI Detection: confidence=${aiConfidence}, likelyAI=${likelyAI}`);
      
      // For now, treat high AI confidence (70+) as fully AI-generated
      // Medium confidence (50-70) as synthetic voice
      // Low confidence (<50) as natural
      
      if (aiConfidence >= 70) {
        return {
          name: 'LOW',
          label: 'FULLY AI-GENERATED AUDIO',
          color: '#DC3545',
          icon: 'volume-x',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
          message: `Synthetic audio detected (${aiConfidence}% confidence)`
        };
      }
      
      if (likelyAI && aiConfidence >= 50) {
        return {
          name: 'LOW',
          label: 'SYNTHETIC VOICE DETECTED',
          color: '#DC3545',
          icon: 'mic-off',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>',
          message: `Possible AI-generated voice (${aiConfidence}% confidence)`
        };
      }
      
      // Future: Add background AI detection
      // if (backgroundIsAI) { ... }
      
      return {
        name: 'HIGH',
        label: 'VERIFIED AUDIO RECORDING',
        color: '#10B981',
        icon: 'mic',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
        message: 'Natural audio recording detected'
      };
    }
    
    // Image-specific labeling
    if (mediaType === 'image') {
      if (percentage >= 75) {
        return {
          name: 'HIGH',
          label: 'VERIFIED PHOTOGRAPH',
          color: '#10B981',
          icon: 'shield',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10B981"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
          message: 'Strong indicators of camera-captured image'
        };
      }
      
      if (percentage >= 50) {
        if (isModified.detected) {
          return {
            name: 'MEDIUM',
            label: 'MODIFIED VERSION DETECTED',
            color: '#F59E0B',
            icon: 'edit',
            iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
            message: `Authentic photograph with alterations (${isModified.details.similarity}% similarity)`
          };
        }
        
        return {
          name: 'MEDIUM',
          label: 'LIKELY CAMERA-CAPTURED',
          color: '#F59E0B',
          icon: 'alert-triangle',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          message: 'Image appears authentic but has minor concerns'
        };
      }
      
      if (percentage >= 25) {
        return {
          name: 'LOW',
          label: 'MANIPULATION DETECTED',
          color: '#F97316',
          icon: 'alert-circle',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
          message: 'Evidence of significant alterations or synthetic content'
        };
      }
      
      return {
        name: 'VERY_LOW',
        label: 'HEAVILY MANIPULATED',
        color: '#DC3545',
        icon: 'x-circle',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        message: 'Extensive manipulation or fabrication detected'
      };
    }
    
    // Fallback for unknown media types
    if (percentage >= 75) {
      return {
        name: 'HIGH',
        label: 'HIGH INTEGRITY',
        color: '#10B981',
        icon: 'shield',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10B981"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
        message: 'Content shows strong integrity indicators'
      };
    }
    
    if (percentage >= 50) {
      return {
        name: 'MEDIUM',
        label: 'MEDIUM INTEGRITY',
        color: '#F59E0B',
        icon: 'alert-triangle',
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        message: 'Content has some concerns'
      };
    }
    
    return {
      name: 'LOW',
      label: 'LOW INTEGRITY',
      color: '#DC3545',
      icon: 'x-circle',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC3545" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      message: 'Content shows significant integrity issues'
    };
  }
  
  /**
   * Score metadata quality (max 30 points)
   */
  static scoreMetadataQuality(data) {
    let score = 0;
    const details = [];
    
    if (data.kind === 'image') {
      score += 15;
      details.push('✅ Valid image file');
    } else if (data.kind === 'video') {
      score += 15;
      details.push('✅ Valid video file');
    } else if (data.kind === 'audio') {
      score += 15;
      details.push('✅ Valid audio file');
    }
    
    if (data.canonical?.fingerprint || data.fingerprint) {
      score += 10;
      details.push('✅ Cryptographic fingerprint generated');
    }
    
    if (data.size_bytes > 1000) {
      score += 5;
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
      // Not found = GOOD (original content)
      score += 20;
      details.push('✅ Not found in external databases (likely original)');
    }
    
    // Check Google Vision web detection
    if (data.google_vision?.results?.web_detection) {
      const webDetection = data.google_vision.results.web_detection;
      const fullMatches = webDetection.full_matching_images?.length || 0;
      const partialMatches = webDetection.partial_matching_images?.length || 0;
      
      if (fullMatches === 0 && partialMatches === 0) {
        score += 10;
        details.push('✅ No online matches found (original content)');
      } else if (fullMatches > 0) {
        score += 3;
        details.push(`⚠️ ${fullMatches} exact online match(es) found`);
      } else if (partialMatches > 0) {
        score += 7;
        details.push(`⚠️ ${partialMatches} similar online match(es) found`);
      }
      
      // Bonus: Rich web entity data
      if (webDetection.web_entities?.length > 5) {
        score += 2;
        details.push('✅ Rich web analysis available');
      }
    } else if (data.google_vision?.enabled && !data.google_vision?.found) {
      score += 10;
      details.push('✅ Google Vision found no matches (original)');
    }
    
    return {
      name: 'External Verification',
      score: Math.min(score, 30),
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
    
    // Use Google Vision labels (rich content analysis)
    if (data.google_vision?.results?.labels?.length > 5) {
      score += 3;
      details.push(`✅ Detailed content analysis (${data.google_vision.results.labels.length} labels)`);
    }
    
    // Face detection
    if (data.google_vision?.results?.faces?.count > 0) {
      score += 2;
      details.push(`✅ ${data.google_vision.results.faces.count} face(s) detected`);
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
}

module.exports = ConfidenceScoring;
