/**
 * Confidence Scoring System
 * Note: Must use module.exports for the class itself
 */

class ConfidenceScoring {
  // ... (keeping all existing methods)
  
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
