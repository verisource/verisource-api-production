/**
 * Sensor Noise Analysis Service
 * Advanced noise fingerprinting to detect camera sensor characteristics
 * Approximates PRNU (Photo Response Non-Uniformity) analysis
 */

const sharp = require('sharp');
const { execSync } = require('child_process');

/**
 * Analyze sensor noise patterns in image
 * @param {string} imagePath - Path to image file
 * @returns {Object} Noise analysis results
 */
async function analyzeSensorNoise(imagePath) {
  const result = {
    has_sensor_noise: false,
    confidence: 0,
    noise_characteristics: {},
    indicators: [],
    ai_likelihood: 0
  };

  try {
    // 1. Extract noise residual using wavelet decomposition
    const noiseResidual = await extractNoiseResidual(imagePath);
    
    // 2. Analyze noise statistics
    const noiseStats = await analyzeNoiseStatistics(noiseResidual);
    
    // 3. Check for sensor-specific patterns
    const sensorPatterns = detectSensorPatterns(noiseStats);
    
    // 4. Detect AI-generated noise anomalies
    const aiAnomalies = detectAINoiseAnomalies(noiseStats);

    result.noise_characteristics = {
      mean_noise: noiseStats.mean,
      std_deviation: noiseStats.stdDev,
      variance: noiseStats.variance,
      kurtosis: noiseStats.kurtosis,
      skewness: noiseStats.skewness,
      spatial_correlation: noiseStats.spatialCorrelation
    };

    // Evaluate authenticity
    if (sensorPatterns.detected) {
      result.has_sensor_noise = true;
      result.confidence = sensorPatterns.confidence;
      result.indicators.push(...sensorPatterns.indicators);
    }

    if (aiAnomalies.detected) {
      result.ai_likelihood = aiAnomalies.confidence;
      result.indicators.push(...aiAnomalies.indicators);
    }

    // Camera sensors have specific noise characteristics
    if (noiseStats.variance > 0.5 && noiseStats.variance < 15) {
      result.indicators.push('Noise variance in typical camera range');
      result.confidence += 15;
    }

    // Gaussian noise distribution (cameras) vs uniform (AI)
    if (Math.abs(noiseStats.kurtosis - 3) < 1) {
      result.indicators.push('Gaussian noise distribution (camera-like)');
      result.confidence += 20;
      result.has_sensor_noise = true;
    } else if (noiseStats.kurtosis < 1) {
      result.indicators.push('Uniform noise distribution (AI-like)');
      result.ai_likelihood += 25;
    }

    // Spatial correlation analysis
    if (noiseStats.spatialCorrelation > 0.3) {
      result.indicators.push('High spatial correlation (sensor pattern noise)');
      result.confidence += 25;
      result.has_sensor_noise = true;
    } else if (noiseStats.spatialCorrelation < 0.05) {
      result.indicators.push('No spatial correlation (synthetic)');
      result.ai_likelihood += 20;
    }

    // Cap confidence at 100%
    result.confidence = Math.min(result.confidence, 100);

  } catch (err) {
    console.error('Sensor noise analysis error:', err.message);
    result.indicators.push('Could not complete noise analysis');
  }

  return result;
}

/**
 * Extract noise residual using high-pass filtering
 * Approximates wavelet-based noise extraction
 */
async function extractNoiseResidual(imagePath) {
  try {
    // Use sharp to extract high-frequency components (noise)
    const { data, info } = await sharp(imagePath)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const noiseResidual = new Float32Array(data.length);

    // Apply 3x3 high-pass filter to extract noise
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Laplacian filter kernel (detects edges and noise)
        const center = data[idx] * 4;
        const neighbors = data[idx - 1] + data[idx + 1] + 
                         data[idx - width] + data[idx + width];
        
        noiseResidual[idx] = Math.abs(center - neighbors);
      }
    }

    return noiseResidual;
  } catch (err) {
    throw new Error(`Noise extraction failed: ${err.message}`);
  }
}

/**
 * Calculate comprehensive noise statistics
 */
async function analyzeNoiseStatistics(noiseResidual) {
  const n = noiseResidual.length;
  
  // Mean
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += noiseResidual[i];
  }
  const mean = sum / n;

  // Variance and standard deviation
  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    varianceSum += Math.pow(noiseResidual[i] - mean, 2);
  }
  const variance = varianceSum / n;
  const stdDev = Math.sqrt(variance);

  // Skewness and Kurtosis
  let skewnessSum = 0;
  let kurtosisSum = 0;
  for (let i = 0; i < n; i++) {
    const normalized = (noiseResidual[i] - mean) / stdDev;
    skewnessSum += Math.pow(normalized, 3);
    kurtosisSum += Math.pow(normalized, 4);
  }
  const skewness = skewnessSum / n;
  const kurtosis = kurtosisSum / n;

  // Spatial correlation (simplified)
  let correlationSum = 0;
  let count = 0;
  for (let i = 1; i < n; i++) {
    if (noiseResidual[i] !== 0 && noiseResidual[i-1] !== 0) {
      correlationSum += noiseResidual[i] * noiseResidual[i-1];
      count++;
    }
  }
  const spatialCorrelation = count > 0 ? correlationSum / count / variance : 0;

  return {
    mean,
    stdDev,
    variance,
    skewness,
    kurtosis,
    spatialCorrelation
  };
}

/**
 * Detect sensor-specific noise patterns
 */
function detectSensorPatterns(noiseStats) {
  const result = {
    detected: false,
    confidence: 0,
    indicators: []
  };

  // Real camera sensors have:
  // 1. Fixed pattern noise (spatial correlation)
  // 2. Gaussian distribution (kurtosis ~3)
  // 3. Moderate variance (not too clean, not too noisy)

  let score = 0;

  // Check for fixed pattern noise
  if (noiseStats.spatialCorrelation > 0.2) {
    result.indicators.push('Fixed pattern noise detected (sensor characteristic)');
    score += 30;
  }

  // Check for Gaussian distribution
  if (Math.abs(noiseStats.kurtosis - 3) < 0.5) {
    result.indicators.push('Strong Gaussian distribution (camera sensor)');
    score += 35;
  } else if (Math.abs(noiseStats.kurtosis - 3) < 1.5) {
    result.indicators.push('Near-Gaussian distribution');
    score += 20;
  }

  // Check variance range
  if (noiseStats.variance >= 1 && noiseStats.variance <= 12) {
    result.indicators.push('Noise variance typical of camera sensors');
    score += 20;
  }

  // Positive skewness is common in real sensors
  if (noiseStats.skewness > 0 && noiseStats.skewness < 2) {
    result.indicators.push('Positive skewness (sensor photoelectrons)');
    score += 15;
  }

  result.confidence = Math.min(score, 100);
  result.detected = score >= 40;

  return result;
}

/**
 * Detect AI-generated noise anomalies
 */
function detectAINoiseAnomalies(noiseStats) {
  const result = {
    detected: false,
    confidence: 0,
    indicators: []
  };

  let score = 0;

  // AI generators often have:
  // 1. Too uniform noise (low variance)
  // 2. No spatial correlation (pure random)
  // 3. Non-Gaussian distribution

  // Too clean (variance too low)
  if (noiseStats.variance < 0.5) {
    result.indicators.push('Extremely low noise (suspiciously clean)');
    score += 35;
  }

  // No spatial correlation
  if (noiseStats.spatialCorrelation < 0.05) {
    result.indicators.push('No fixed pattern noise (synthetic)');
    score += 30;
  }

  // Non-Gaussian distribution
  if (Math.abs(noiseStats.kurtosis - 3) > 2) {
    result.indicators.push('Non-Gaussian noise distribution');
    score += 25;
  }

  // Unusual skewness
  if (Math.abs(noiseStats.skewness) > 3) {
    result.indicators.push('Abnormal noise skewness');
    score += 10;
  }

  result.confidence = Math.min(score, 100);
  result.detected = score >= 40;

  return result;
}

/**
 * Adjust AI confidence based on sensor noise analysis
 * ENHANCED: Much stronger adjustment when sensor noise clearly indicates real camera
 */
function adjustForSensorNoise(aiDetection, noiseAnalysis, exifData = null) {
  if (!aiDetection || !noiseAnalysis) {
    return aiDetection;
  }

  const hasMultipleCompressions = aiDetection.indicators?.some(ind => 
    ind.includes('Multiple compressions detected') || 
    ind.includes('double compress')
  );

  const originalConfidence = aiDetection.ai_confidence || 0;
  let adjustedConfidence = originalConfidence;
  let adjustmentReason = null;

  console.log('🔬 DEBUG Sensor Noise Adjustment:');
  console.log('  - has_sensor_noise:', noiseAnalysis.has_sensor_noise);
  console.log('  - confidence:', noiseAnalysis.confidence);
  console.log('  - ai_likelihood:', noiseAnalysis.ai_likelihood);
  console.log('  - originalConfidence:', originalConfidence);

  // Check if EXIF confirms a real camera
  const hasRealCameraExif = exifData && 
    (exifData.Make || exifData.Model) && 
    !isAISoftwareInExif(exifData);
  
  console.log('  - hasRealCameraExif:', hasRealCameraExif);

  // RULE 1: STRONGEST - Sensor noise + EXIF both confirm real camera
  if (noiseAnalysis.has_sensor_noise && 
      noiseAnalysis.confidence >= 80 && 
      noiseAnalysis.ai_likelihood < 10 &&
      hasRealCameraExif &&
      !hasMultipleCompressions) {
    const maxAI = 25;
    if (originalConfidence > maxAI) {
      adjustedConfidence = maxAI;
      adjustmentReason = `STRONG OVERRIDE: Sensor noise (${noiseAnalysis.confidence}%) + camera EXIF confirm real photo → capped at ${maxAI}%`;
      console.log('  ✅ RULE 1 (strongest):', adjustmentReason);
    }
  }
  // RULE 2: High sensor noise, low AI anomalies
  else if (noiseAnalysis.has_sensor_noise && 
           noiseAnalysis.confidence >= 70 && 
           noiseAnalysis.ai_likelihood < 20 &&
           !hasMultipleCompressions) {
    const reduction = Math.round(50 * (noiseAnalysis.confidence / 100));
    adjustedConfidence = Math.max(35, originalConfidence - reduction);
    if (adjustedConfidence > 40 && noiseAnalysis.confidence >= 85) {
      adjustedConfidence = 40;
    }
    adjustmentReason = `Sensor noise (${noiseAnalysis.confidence}%) indicates camera → reduced to ${adjustedConfidence}%`;
    console.log('  ✅ RULE 2 (strong):', adjustmentReason);
  }
  // RULE 3: Moderate sensor noise
  else if (noiseAnalysis.has_sensor_noise && 
           noiseAnalysis.confidence >= 50 &&
           noiseAnalysis.ai_likelihood < 40) {
    const reduction = Math.round(35 * (noiseAnalysis.confidence / 100));
    adjustedConfidence = Math.max(20, originalConfidence - reduction);
    adjustmentReason = `Sensor noise suggests camera → reduced by ${reduction}%`;
    console.log('  ✅ RULE 3 (moderate):', adjustmentReason);
  }
  // RULE 4: AI anomalies - BOOST
  else if (noiseAnalysis.ai_likelihood >= 50 && !noiseAnalysis.has_sensor_noise) {
    const boost = Math.round(25 * (noiseAnalysis.ai_likelihood / 100));
    adjustedConfidence = Math.min(95, originalConfidence + boost);
    adjustmentReason = `AI noise anomalies → boosted by ${boost}%`;
    console.log('  ⚠️ RULE 4 (AI boost):', adjustmentReason);
  }

  if (adjustedConfidence !== originalConfidence) {
    console.log(`   📊 AI confidence: ${originalConfidence}% → ${adjustedConfidence}%`);
    
    return {
      ...aiDetection,
      ai_confidence: adjustedConfidence,
      original_ai_confidence: aiDetection.original_ai_confidence || originalConfidence,
      sensor_noise_analyzed: true,
      sensor_noise_confidence: noiseAnalysis.confidence,
      ai_noise_anomalies: noiseAnalysis.ai_likelihood,
      noise_indicators: noiseAnalysis.indicators,
      adjusted_for_sensor_noise: true,
      warnings: [...(aiDetection.warnings || []), adjustmentReason]
    };
  }

  return { 
    ...aiDetection, 
    sensor_noise_analyzed: true, 
    sensor_noise_confidence: noiseAnalysis.confidence,
    ai_noise_anomalies: noiseAnalysis.ai_likelihood,
    adjusted_for_sensor_noise: false 
  };
}

/**
 * Check if EXIF contains AI software indicators
 */
function isAISoftwareInExif(exifData) {
  if (!exifData) return false;
  const fields = [exifData.Make, exifData.Model, exifData.Software].filter(Boolean).join(' ').toLowerCase();
  const aiIndicators = ['dall-e', 'dalle', 'midjourney', 'stable diffusion', 'flux', 'sora', 'runway'];
  return aiIndicators.some(ai => fields.includes(ai));
}

module.exports = {
  analyzeSensorNoise,
  adjustForSensorNoise
};

