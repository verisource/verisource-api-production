/**
 * AI-generated image detection - FINAL CALIBRATION
 * Conservative threshold with balanced scoring
 */

const sharp = require('sharp');

async function detectAIGeneration(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = await sharp(imagePath).stats();
    
    let suspicionScore = 0;
    const indicators = [];
    
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
      suspicionScore += 8;
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
      suspicionScore += 12;
      indicators.push('PNG without metadata');
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
        } else if (ratio < 0.3) {
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
    const noiseStats = await (async () => {
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
    })();
    
    if (noiseStats.valid) {
      if (noiseStats.avgVariance < 15) {
        suspicionScore += 25;
        indicators.push(`Unnaturally low noise (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance < 30) {
        suspicionScore += 15;
        indicators.push(`Low noise pattern (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance >= 100 && noiseStats.avgVariance <= 600) {
        suspicionScore -= 10;
        indicators.push(`Natural camera noise (${Math.round(noiseStats.avgVariance)}) - authentic`);
      }
    }
    
    // Check 8: Edge detection
    const frequencyStats = await (async () => {
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
    })();
    
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
      } else if (frequencyStats.strongEdgeRatio > 0.05) {
        suspicionScore -= 8;
        indicators.push('Good texture detail - authentic');
      }
    }
    
    // Check 9: Color space
    const colorStats = await (async () => {
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
    })();
    
    if (colorStats.valid) {
      if (colorStats.extremeRatio > 0.35) {
        suspicionScore += 10;
        indicators.push(`Unusual color distribution (${Math.round(colorStats.extremeRatio * 100)}%)`);
      }
      if (colorStats.saturationRatio > 0.90) {
        suspicionScore += 8;
        indicators.push(`Excessive saturation (${Math.round(colorStats.saturationRatio * 100)}%)`);
      }
      if (colorStats.extremeRatio < 0.01 && colorStats.saturationRatio < 0.05) {
        suspicionScore += 15;
        indicators.push('Unnaturally uniform colors');
      }
    }
    
    // Final adjustment
    if (indicators.length >= 5 && suspicionScore >= 55 && suspicionScore < 60) {
      suspicionScore += 10;
      indicators.push('Multiple strong AI indicators');
    }
    
    suspicionScore = Math.max(0, suspicionScore);
    
    return {
      likely_ai_generated: suspicionScore >= 60,  // RAISED THRESHOLD
      ai_confidence: Math.min(suspicionScore, 100),
      indicators: indicators,
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

module.exports = { detectAIGeneration };
