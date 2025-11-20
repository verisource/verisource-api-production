/**
 * AI-generated image detection - ADVANCED FORENSICS
 * Includes: Local patch entropy, channel correlation, hue-saturation anomalies,
 * texture repetition, optical lens profiles, chromatic aberration
 */

const sharp = require('sharp');
const { createCanvas } = require('canvas');

async function detectAIGeneration(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = await sharp(imagePath).stats();
    
    let suspicionScore = 0;
    const indicators = [];
    
    // ============================================
    // EXISTING BASIC CHECKS (Keep all current logic)
    // ============================================
    
    // Check 1: Suspicious dimensions
    const commonAISizes = [
      [512, 512], [1024, 1024], [768, 768],
      [512, 768], [768, 512], [640, 640]
    ];
    if (commonAISizes.some(([w, h]) => 
        Math.abs(metadata.width - w) < 10 && Math.abs(metadata.height - h) < 10)) {
      suspicionScore += 25;
      indicators.push('Common AI generation dimensions');
    }
    
    // Check 2: EXIF
    const hasExif = metadata.exif && Object.keys(metadata.exif).length >= 5;
    if (!hasExif) {
      suspicionScore += 4; // Reduced from 8 - many authentic photos lack EXIF
      indicators.push('Missing camera metadata');
    }
    
    // Check 3: Color distribution
    const channels = stats.channels;
    const avgStdDev = channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
    if (avgStdDev < 15) {
      suspicionScore += 20;
      indicators.push(`Very low color variance (${Math.round(avgStdDev)})`);
    } else if (avgStdDev < 25 || avgStdDev > 80) {
      suspicionScore += 12;
      indicators.push('Unusual color distribution');
    }
    
    // Check 4: AI software signatures
    const exifString = JSON.stringify(metadata.exif || {}).toLowerCase();
    const aiSoftware = ['stable diffusion', 'midjourney', 'dall-e', 'dalle', 'openai', 
                        'pytorch', 'tensorflow', 'diffusion', 'gan', 'faceswap', 'deepfake'];
    if (aiSoftware.some(sw => exifString.includes(sw))) {
      suspicionScore = 100;
      indicators.push('AI generation software detected in metadata');
    }
    
    // Check 5: File format
    if (metadata.format === 'png' && !hasExif) {
      suspicionScore += 4;
      indicators.push('PNG without metadata');
      
      // PNG + AI dimensions is a VERY strong indicator of DALL-E/Midjourney
      const isAIDimension = commonAISizes.some(([w, h]) => 
        Math.abs(metadata.width - w) < 10 && Math.abs(metadata.height - h) < 10);
      
      if (isAIDimension) {
        suspicionScore += 50; // Very heavy penalty for PNG + AI dimensions
        indicators.push('PNG with AI-typical dimensions - strong DALL-E indicator');
      }
    }
    
    // Check 6: JPEG quality
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      try {
        const buffer = await sharp(imagePath).jpeg({ quality: 100 }).toBuffer();
        const originalSize = (await sharp(imagePath).toBuffer()).length;
        const ratio = originalSize / buffer.length;
        
        if (ratio > 0.95) {
          suspicionScore += 20;
          indicators.push('Unusually high JPEG quality');
        } else if (ratio < 0.15) {  // More lenient
          suspicionScore += 10;
          indicators.push('Suspiciously low compression');
        }
        
        if (!hasExif && ratio > 0.85) {
          suspicionScore += 15;
          indicators.push('High quality without camera data');
        }
      } catch (err) {
        // Skip
      }
    }
    
    // Check 7: Noise analysis
    const noiseStats = await analyzeNoise(imagePath);
    if (noiseStats.valid) {
      if (noiseStats.avgVariance < 15) {
        suspicionScore += 25;
        indicators.push(`Unnaturally low noise (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance < 30) {
        suspicionScore += 15;
        indicators.push(`Low noise pattern (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance >= 100 && noiseStats.avgVariance <= 600 && metadata.format !== 'png') {
        suspicionScore -= 10; // Skip for PNG
        indicators.push(`Natural camera noise (${Math.round(noiseStats.avgVariance)}) - authentic`);
      }
    }
    
    // Check 8: Edge detection
    const frequencyStats = await analyzeEdges(imagePath);
    if (frequencyStats.valid) {
      if (frequencyStats.avgEdgeIntensity < 10) {
        suspicionScore += 20;
        indicators.push(`Unnaturally smooth (${Math.round(frequencyStats.avgEdgeIntensity)})`);
      } else if (frequencyStats.avgEdgeIntensity < 20) {
        suspicionScore += 10;
        indicators.push(`Low edge detail (${Math.round(frequencyStats.avgEdgeIntensity)})`);
      }
      
      if (frequencyStats.avgEdgeIntensity > 60) {
        suspicionScore += 12;
        indicators.push('Excessive edge enhancement');
      }
      
      if (frequencyStats.strongEdgeRatio < 0.02 && frequencyStats.avgEdgeIntensity < 20) {
        suspicionScore += 15;
        indicators.push('Lack of texture detail');
      } else if (frequencyStats.strongEdgeRatio > 0.05 && metadata.format !== 'png') {
        suspicionScore -= 8; // Skip for PNG
        indicators.push('Good texture detail - authentic');
      }
    }
    
    // Check 9: Color space
    const colorStats = await analyzeColorSpace(imagePath);
    if (colorStats.valid) {
      if (colorStats.extremeRatio > 0.50) {
        suspicionScore += 10; // Raised threshold from 0.35 to 0.50
        indicators.push(`Unusual color distribution (${Math.round(colorStats.extremeRatio * 100)}%)`);
      }
      if (colorStats.saturationRatio > 0.95) {
        suspicionScore += 8; // Raised threshold from 0.90 to 0.95
        indicators.push(`Excessive saturation (${Math.round(colorStats.saturationRatio * 100)}%)`);
      }
      if (colorStats.extremeRatio < 0.01 && colorStats.saturationRatio < 0.05) {
        suspicionScore += 15;
        indicators.push('Unnaturally uniform colors');
      }
    }
    
    // ============================================
    // NEW ADVANCED FORENSIC CHECKS
    // ============================================
    
    // Check 10: LOCAL PATCH ENTROPY
    const patchEntropy = await analyzeLocalPatchEntropy(imagePath);
    if (patchEntropy.valid) {
      if (patchEntropy.avgEntropy < 3.5) {
        suspicionScore += 18; // Lowered threshold from 4.5 to 3.5
        indicators.push(`Low local entropy (${patchEntropy.avgEntropy.toFixed(2)}) - AI characteristic`);
      }
      if (patchEntropy.entropyVariance < 0.3) {
        suspicionScore += 15;
        indicators.push('Uniform entropy distribution - AI pattern');
      }
      if (patchEntropy.avgEntropy >= 6.0 && patchEntropy.entropyVariance >= 0.8 && metadata.format !== 'png') {
        suspicionScore -= 12; // Skip for PNG
        indicators.push('High natural entropy variation - authentic');
      }
    }
    
    // Check 11: CHANNEL CORRELATION COEFFICIENT
    const channelCorrelation = await analyzeChannelCorrelation(imagePath);
    if (channelCorrelation.valid) {
      if (channelCorrelation.avgCorrelation > 0.98) {
        suspicionScore += 20; // Raised threshold from 0.95 to 0.98
        indicators.push(`Excessive channel correlation (${channelCorrelation.avgCorrelation.toFixed(3)}) - AI artifact`);
      }
      if (channelCorrelation.rgCorrelation > 0.99 && channelCorrelation.gbCorrelation > 0.99) {
        suspicionScore += 15; // Raised threshold from 0.98 to 0.99
        indicators.push('Unnaturally correlated color channels');
      }
      if (channelCorrelation.avgCorrelation >= 0.70 && channelCorrelation.avgCorrelation <= 0.90 && metadata.format !== 'png') {
        suspicionScore -= 8; // Skip for PNG
        indicators.push('Natural channel correlation - authentic');
      }
    }
    
    // Check 12: HUE-TO-SATURATION DISTRIBUTION ANOMALIES
    const hueSaturation = await analyzeHueSaturationDistribution(imagePath);
    if (hueSaturation.valid) {
      if (hueSaturation.clusteringScore > 0.90) {
        suspicionScore += 18; // Raised threshold from 0.75 to 0.90
        indicators.push(`Unnatural hue-saturation clustering (${(hueSaturation.clusteringScore * 100).toFixed(0)}%)`);
      }
      if (hueSaturation.saturationPeaks > 3) {
        suspicionScore += 12;
        indicators.push(`${hueSaturation.saturationPeaks} distinct saturation peaks - AI characteristic`);
      }
      if (hueSaturation.hueVariety < 20) {
        suspicionScore += 10;
        indicators.push('Limited hue variety - AI generation pattern');
      }
    }
    
    // Check 13: TEXTURE REPETITION / TILING
    const textureRepetition = await analyzeTextureRepetition(imagePath);
    if (textureRepetition.valid) {
      if (textureRepetition.repetitionScore > 0.70) {
        suspicionScore += 22;
        indicators.push(`High texture repetition (${(textureRepetition.repetitionScore * 100).toFixed(0)}%) - AI tiling`);
      }
      if (textureRepetition.periodicPatterns > 2) {
        suspicionScore += 15;
        indicators.push(`${textureRepetition.periodicPatterns} periodic patterns detected - AI artifact`);
      }
    }
    
    // Check 14: OPTICAL LENS PROFILE
    const lensProfile = await analyzeOpticalLensProfile(imagePath);
    if (lensProfile.valid) {
      if (!lensProfile.hasNaturalVignetting && metadata.width * metadata.height > 500000) {
        suspicionScore += 12;
        indicators.push('Missing natural lens vignetting - not from camera');
      }
      if (!lensProfile.hasNaturalDistortion) {
        suspicionScore += 10;
        indicators.push('Perfect geometry - inconsistent with optical capture');
      }
      if (lensProfile.hasNaturalVignetting && lensProfile.hasNaturalDistortion && metadata.format !== 'png') {
        suspicionScore -= 10; // Skip for PNG
        indicators.push('Natural lens characteristics - authentic');
      }
    }
    
    // Check 15: CHROMATIC ABERRATION
    const chromaticAberration = await analyzeChromaticAberration(imagePath);
    if (chromaticAberration.valid) {
      if (chromaticAberration.aberrationScore < 0.01) {
        suspicionScore += 15;
        indicators.push('No chromatic aberration - not from optical lens');
      }
      if (chromaticAberration.edgeAberration < 0.005) {
        suspicionScore += 12;
        indicators.push('Perfect edge alignment - AI characteristic');
      }
      if (chromaticAberration.aberrationScore >= 0.02 && chromaticAberration.aberrationScore <= 0.10 && metadata.format !== 'png') {
        suspicionScore -= 10; // Skip for PNG
        indicators.push('Natural chromatic aberration - authentic');
      }
    }
    
    // Final adjustment
    if (indicators.length >= 8 && suspicionScore >= 60 && suspicionScore < 70) {
      suspicionScore += 10;
      indicators.push('Multiple advanced forensic indicators');
    }
    
    
    // Bonus adjustment for high-resolution photos with authentic indicators
    if (metadata.width * metadata.height > 10000000 && suspicionScore >= 60 && metadata.format !== 'png') { // Skip bonus for PNGs
      const authenticIndicators = indicators.filter(i => 
        i.includes('authentic') || i.includes('Natural') || i.includes('Good')
      ).length;
      
      if (authenticIndicators >= 2) {
        suspicionScore -= 15;
        indicators.push('High-res photo with authentic characteristics - adjusted');
      }
    }
    
    // Bonus adjustment for high-resolution photos with authentic indicators
    if (metadata.width * metadata.height > 10000000 && suspicionScore >= 60) {
      const authenticIndicators = indicators.filter(i => 
        i.includes('authentic') || i.includes('Natural') || i.includes('Good')
      ).length;
      
      if (authenticIndicators >= 2) {
        suspicionScore -= 15;
        indicators.push('High-res photo with authentic characteristics - adjusted');
      }
    }
    
    suspicionScore = Math.max(0, Math.min(100, suspicionScore));
    
    return {
      likely_ai_generated: suspicionScore >= 60,
      ai_confidence: suspicionScore,
      indicators: indicators,
      forensic_analysis: {
        patch_entropy: patchEntropy.valid ? patchEntropy.avgEntropy : null,
        channel_correlation: channelCorrelation.valid ? channelCorrelation.avgCorrelation : null,
        hue_saturation_clustering: hueSaturation.valid ? hueSaturation.clusteringScore : null,
        texture_repetition: textureRepetition.valid ? textureRepetition.repetitionScore : null,
        optical_profile_match: lensProfile.valid ? lensProfile.hasNaturalVignetting : null,
        chromatic_aberration: chromaticAberration.valid ? chromaticAberration.aberrationScore : null
      },
      metadata_check: {
        has_camera_exif: hasExif,
        dimensions: `${metadata.width}x${metadata.height}`,
        format: metadata.format
      }
    };
    
  } catch (error) {
    console.error('AI detection error:', error.message);
    return {
      likely_ai_generated: false,
      ai_confidence: 0,
      error: error.message,
      indicators: []
    };
  }
}

// ============================================
// HELPER FUNCTIONS (Existing)
// ============================================

async function analyzeNoise(imagePath) {
  try {
    const grayImage = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data } = grayImage;
    const pixels = new Uint8Array(data);
    let totalVariance = 0;
    const sampleSize = Math.min(10000, pixels.length - 100);
    for (let i = 0; i < sampleSize; i += 100) {
      const window = pixels.slice(i, i + 100);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
      totalVariance += variance;
    }
    return { avgVariance: totalVariance / (sampleSize / 100), valid: true };
  } catch (err) {
    return { avgVariance: 0, valid: false };
  }
}

async function analyzeEdges(imagePath) {
  try {
    const edges = await sharp(imagePath).greyscale().convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
    }).raw().toBuffer({ resolveWithObject: true });
    const { data } = edges;
    const pixels = new Uint8Array(data);
    let edgeSum = 0, strongEdges = 0;
    for (let i = 0; i < pixels.length; i++) {
      edgeSum += pixels[i];
      if (pixels[i] > 100) strongEdges++;
    }
    return {
      avgEdgeIntensity: edgeSum / pixels.length,
      strongEdgeRatio: strongEdges / pixels.length,
      valid: true
    };
  } catch (err) {
    return { avgEdgeIntensity: 0, strongEdgeRatio: 0, valid: false };
  }
}

async function analyzeColorSpace(imagePath) {
  try {
    const labImage = await sharp(imagePath).toColourspace('lab').raw().toBuffer({ resolveWithObject: true });
    const { data, info } = labImage;
    const pixels = new Uint8Array(data);
    const channels = info.channels;
    let extremeColors = 0, unnaturalSaturation = 0;
    const sampleSize = Math.min(5000, pixels.length / channels);
    
    for (let i = 0; i < sampleSize * channels; i += channels) {
      const L = pixels[i];
      const A = pixels[i + 1] - 128;
      const B = pixels[i + 2] - 128;
      const saturation = Math.sqrt(A * A + B * B);
      if (saturation > 100) unnaturalSaturation++;
      if (Math.abs(A) > 100 || Math.abs(B) > 100) extremeColors++;
    }
    return {
      extremeRatio: extremeColors / sampleSize,
      saturationRatio: unnaturalSaturation / sampleSize,
      valid: true
    };
  } catch (err) {
    return { extremeRatio: 0, saturationRatio: 0, valid: false };
  }
}

// ============================================
// NEW ADVANCED FORENSIC FUNCTIONS
// ============================================

/**
 * LOCAL PATCH ENTROPY
 * Analyzes entropy distribution across image patches
 * AI images often have uniform low entropy
 */
async function analyzeLocalPatchEntropy(imagePath) {
  try {
    const image = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const { width, height } = info;
    
    const patchSize = 32;
    const entropies = [];
    
    // Sample patches across the image
    for (let y = 0; y < height - patchSize; y += patchSize) {
      for (let x = 0; x < width - patchSize; x += patchSize) {
        const histogram = new Array(256).fill(0);
        
        // Build histogram for patch
        for (let py = 0; py < patchSize; py++) {
          for (let px = 0; px < patchSize; px++) {
            const idx = (y + py) * width + (x + px);
            if (idx < pixels.length) {
              histogram[pixels[idx]]++;
            }
          }
        }
        
        // Calculate entropy
        let entropy = 0;
        const total = patchSize * patchSize;
        for (let i = 0; i < 256; i++) {
          if (histogram[i] > 0) {
            const p = histogram[i] / total;
            entropy -= p * Math.log2(p);
          }
        }
        
        entropies.push(entropy);
      }
    }
    
    if (entropies.length === 0) return { valid: false };
    
    const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
    const entropyVariance = entropies.reduce((sum, e) => sum + Math.pow(e - avgEntropy, 2), 0) / entropies.length;
    
    return {
      avgEntropy,
      entropyVariance: Math.sqrt(entropyVariance),
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

/**
 * CHANNEL CORRELATION COEFFICIENT
 * Analyzes correlation between RGB channels
 * AI images often have unnaturally high correlation
 */
async function analyzeChannelCorrelation(imagePath) {
  try {
    const image = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const channels = info.channels;
    
    if (channels < 3) return { valid: false };
    
    const sampleSize = Math.min(10000, pixels.length / channels);
    const r = [], g = [], b = [];
    
    // Sample pixels
    for (let i = 0; i < sampleSize * channels; i += channels) {
      r.push(pixels[i]);
      g.push(pixels[i + 1]);
      b.push(pixels[i + 2]);
    }
    
    // Calculate correlation coefficients
    const rgCorr = correlation(r, g);
    const rbCorr = correlation(r, b);
    const gbCorr = correlation(g, b);
    
    return {
      rgCorrelation: rgCorr,
      rbCorrelation: rbCorr,
      gbCorrelation: gbCorr,
      avgCorrelation: (rgCorr + rbCorr + gbCorr) / 3,
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

function correlation(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * HUE-TO-SATURATION DISTRIBUTION ANOMALIES
 * Analyzes hue and saturation distribution patterns
 * AI images often have unnatural clustering
 */
async function analyzeHueSaturationDistribution(imagePath) {
  try {
    const image = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const channels = info.channels;
    
    if (channels < 3) return { valid: false };
    
    const hues = [];
    const saturations = [];
    const sampleSize = Math.min(5000, pixels.length / channels);
    
    for (let i = 0; i < sampleSize * channels; i += channels) {
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      
      // Calculate hue
      let hue = 0;
      if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = hue * 60;
        if (hue < 0) hue += 360;
      }
      
      // Calculate saturation
      const saturation = max === 0 ? 0 : delta / max;
      
      hues.push(hue);
      saturations.push(saturation);
    }
    
    // Analyze clustering
    const hueBuckets = new Array(36).fill(0); // 10-degree buckets
    hues.forEach(h => {
      const bucket = Math.floor(h / 10);
      if (bucket >= 0 && bucket < 36) hueBuckets[bucket]++;
    });
    
    const satBuckets = new Array(10).fill(0); // 0.1 buckets
    saturations.forEach(s => {
      const bucket = Math.floor(s * 10);
      if (bucket >= 0 && bucket < 10) satBuckets[bucket]++;
    });
    
    // Calculate clustering score
    const maxHueBucket = Math.max(...hueBuckets);
    const maxSatBucket = Math.max(...satBuckets);
    const clusteringScore = (maxHueBucket / sampleSize + maxSatBucket / sampleSize) / 2;
    
    // Count saturation peaks
    let saturationPeaks = 0;
    for (let i = 1; i < satBuckets.length - 1; i++) {
      if (satBuckets[i] > satBuckets[i - 1] && satBuckets[i] > satBuckets[i + 1]) {
        if (satBuckets[i] > sampleSize * 0.05) saturationPeaks++;
      }
    }
    
    // Count hue variety
    const hueVariety = hueBuckets.filter(count => count > sampleSize * 0.01).length;
    
    return {
      clusteringScore,
      saturationPeaks,
      hueVariety,
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

/**
 * TEXTURE REPETITION / TILING
 * Detects repetitive patterns common in AI-generated images
 */
async function analyzeTextureRepetition(imagePath) {
  try {
    const image = await sharp(imagePath).resize(256, 256, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const { width, height } = info;
    
    const blockSize = 16;
    const blocks = [];
    
    // Extract blocks
    for (let y = 0; y < height - blockSize; y += blockSize) {
      for (let x = 0; x < width - blockSize; x += blockSize) {
        const block = [];
        for (let by = 0; by < blockSize; by++) {
          for (let bx = 0; bx < blockSize; bx++) {
            block.push(pixels[(y + by) * width + (x + bx)]);
          }
        }
        blocks.push(block);
      }
    }
    
    // Compare blocks for similarity
    let similarPairs = 0;
    let totalComparisons = 0;
    
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < Math.min(i + 20, blocks.length); j++) {
        const similarity = blockSimilarity(blocks[i], blocks[j]);
        if (similarity > 0.90) similarPairs++;
        totalComparisons++;
      }
    }
    
    const repetitionScore = totalComparisons > 0 ? similarPairs / totalComparisons : 0;
    
    // Detect periodic patterns using autocorrelation
    let periodicPatterns = 0;
    for (let offset = blockSize; offset < width / 2; offset += blockSize) {
      let correlation = 0;
      let count = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - offset; x++) {
          correlation += Math.abs(pixels[y * width + x] - pixels[y * width + x + offset]);
          count++;
        }
      }
      const avgCorr = correlation / count;
      if (avgCorr < 15) periodicPatterns++;
    }
    
    return {
      repetitionScore,
      periodicPatterns,
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

function blockSimilarity(block1, block2) {
  let diff = 0;
  for (let i = 0; i < block1.length; i++) {
    diff += Math.abs(block1[i] - block2[i]);
  }
  const avgDiff = diff / block1.length;
  return 1 - (avgDiff / 255);
}

/**
 * OPTICAL LENS PROFILE
 * Checks for natural lens characteristics (vignetting, distortion)
 */
async function analyzeOpticalLensProfile(imagePath) {
  try {
    const image = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const { width, height } = info;
    
    // Check for vignetting (darker corners)
    const centerBrightness = averageBrightness(pixels, width, height, 0.4, 0.6, 0.4, 0.6);
    const cornerBrightness = (
      averageBrightness(pixels, width, height, 0, 0.2, 0, 0.2) +
      averageBrightness(pixels, width, height, 0.8, 1.0, 0, 0.2) +
      averageBrightness(pixels, width, height, 0, 0.2, 0.8, 1.0) +
      averageBrightness(pixels, width, height, 0.8, 1.0, 0.8, 1.0)
    ) / 4;
    
    const vignettingRatio = cornerBrightness / centerBrightness;
    const hasNaturalVignetting = vignettingRatio < 0.90 && vignettingRatio > 0.60;
    
    // Simple distortion check (would be more complex in production)
    const edgeBrightness = (
      averageBrightness(pixels, width, height, 0.45, 0.55, 0, 0.1) +
      averageBrightness(pixels, width, height, 0.45, 0.55, 0.9, 1.0)
    ) / 2;
    
    const hasNaturalDistortion = Math.abs(edgeBrightness - centerBrightness) < centerBrightness * 0.3;
    
    return {
      hasNaturalVignetting,
      hasNaturalDistortion,
      vignettingRatio,
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

function averageBrightness(pixels, width, height, x1, x2, y1, y2) {
  const startX = Math.floor(width * x1);
  const endX = Math.floor(width * x2);
  const startY = Math.floor(height * y1);
  const endY = Math.floor(height * y2);
  
  let sum = 0;
  let count = 0;
  
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      sum += pixels[y * width + x];
      count++;
    }
  }
  
  return count > 0 ? sum / count : 0;
}

/**
 * CHROMATIC ABERRATION
 * Real lenses have color fringing, AI images typically don't
 */
async function analyzeChromaticAberration(imagePath) {
  try {
    const image = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = image;
    const pixels = new Uint8Array(data);
    const { width, height, channels } = info;
    
    if (channels < 3) return { valid: false };
    
    // Analyze edges for color separation
    let totalAberration = 0;
    let edgeCount = 0;
    const edgeThreshold = 50;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * channels;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        
        // Check if this is an edge
        const rightIdx = (y * width + x + 1) * channels;
        const rDiff = Math.abs(r - pixels[rightIdx]);
        const gDiff = Math.abs(g - pixels[rightIdx + 1]);
        const bDiff = Math.abs(b - pixels[rightIdx + 2]);
        
        if (rDiff > edgeThreshold || gDiff > edgeThreshold || bDiff > edgeThreshold) {
          // Measure color separation at edge
          const channelVariance = Math.abs(rDiff - gDiff) + Math.abs(gDiff - bDiff) + Math.abs(rDiff - bDiff);
          totalAberration += channelVariance;
          edgeCount++;
        }
      }
    }
    
    const aberrationScore = edgeCount > 0 ? totalAberration / (edgeCount * 255) : 0;
    
    // Also check corners where aberration is typically stronger
    const cornerAberration = measureCornerAberration(pixels, width, height, channels);
    
    return {
      aberrationScore,
      edgeAberration: cornerAberration,
      valid: true
    };
  } catch (err) {
    return { valid: false };
  }
}

function measureCornerAberration(pixels, width, height, channels) {
  const corners = [
    { x: 10, y: 10 },
    { x: width - 10, y: 10 },
    { x: 10, y: height - 10 },
    { x: width - 10, y: height - 10 }
  ];
  
  let totalAberration = 0;
  
  corners.forEach(corner => {
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const x = corner.x + dx;
        const y = corner.y + dy;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const idx = (y * width + x) * channels;
          const nextIdx = (y * width + x + 1) * channels;
          
          const rDiff = Math.abs(pixels[idx] - pixels[nextIdx]);
          const gDiff = Math.abs(pixels[idx + 1] - pixels[nextIdx + 1]);
          const bDiff = Math.abs(pixels[idx + 2] - pixels[nextIdx + 2]);
          
          totalAberration += Math.abs(rDiff - gDiff) + Math.abs(gDiff - bDiff);
        }
      }
    }
  });
  
  return totalAberration / (corners.length * 121 * 255);
}

module.exports = { detectAIGeneration };
