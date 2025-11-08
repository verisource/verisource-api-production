/**
 * Simple AI-generated image detection
 * Uses multiple heuristics to detect AI-generated content
 */

const sharp = require('sharp');
const { createHash } = require('crypto');

async function detectAIGeneration(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    const stats = await sharp(imagePath).stats();
    
    let suspicionScore = 0;
    const indicators = [];
    
    // Check 1: Suspicious dimensions (AI generators often use specific sizes)
    const commonAISizes = [
      [512, 512], [1024, 1024], [768, 768],
      [512, 768], [768, 512], [640, 640]
    ];
    if (commonAISizes.some(([w, h]) => 
        Math.abs(metadata.width - w) < 10 && Math.abs(metadata.height - h) < 10)) {
      suspicionScore += 20;
      indicators.push('Common AI generation dimensions');
    }
    
    // // Check 2: No EXIF camera data (but reduce weight - could be professional CGI)
    if (!metadata.exif || Object.keys(metadata.exif).length < 5) {
      suspicionScore += 5;  // Further reduced for images (Wikipedia strips EXIF)
      indicators.push('Missing camera metadata');
    }
    
    // Check 3: Perfect color distribution (AI images often too perfect)
    const channels = stats.channels;
    const avgStdDev = channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
    if (avgStdDev < 20 || avgStdDev > 80) {
      suspicionScore += 15;
      indicators.push('Unusual color distribution');
    }
    
    // Check 4: Check for common AI software signatures
    const exifString = JSON.stringify(metadata.exif || {}).toLowerCase();
    const aiSoftware = ['stable diffusion', 'midjourney', 'dall-e', 'dalle', 'openai', 
                        'pytorch', 'tensorflow', 'diffusion', 'gan'];
    if (aiSoftware.some(sw => exifString.includes(sw))) {
      suspicionScore = 100;
      indicators.push('AI generation software detected in metadata');
    }
    
    // Check 5: File format analysis
    if (metadata.format === 'png' && !metadata.exif) {
      suspicionScore += 10;
      indicators.push('PNG without metadata (common for AI)');
    
    // Check 6: JPEG quality analysis
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      // AI images often have suspiciously high or uniform quality
      // Sharp provides quality info for JPEG images
      const buffer = await sharp(imagePath).jpeg({ quality: 100 }).toBuffer();
      const originalSize = (await sharp(imagePath).toBuffer()).length;
      
      // Calculate compression ratio
      const ratio = originalSize / buffer.length;
      
      // AI images typically have unusual compression ratios
      if (ratio > 0.95) {
        suspicionScore += 20;
        indicators.push('Unusually high JPEG quality (typical of AI generation)');
      } else if (ratio < 0.3) {
        suspicionScore += 10;
        indicators.push('Suspiciously low compression (may indicate re-encoding)');
      }
      
      // Check if quality is too perfect (less variation than real photos)
      if (!metadata.exif && ratio > 0.85) {
        suspicionScore += 15;
        indicators.push('Perfect quality without camera data (AI signature)');
      }
    }
    }
    
    
    // Check 7: Noise pattern analysis
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
      if (noiseStats.avgVariance < 20) {
        suspicionScore += 15;
        indicators.push(`Unnaturally low noise (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance > 800) {
        // High noise is MORE authentic for real photos - skip this check for now
        // suspicionScore += 15;
        indicators.push(`Excessive noise (${Math.round(noiseStats.avgVariance)})`);
      } else if (noiseStats.avgVariance >= 100 && noiseStats.avgVariance <= 500 && suspicionScore > 20) {
        suspicionScore -= 10;
        indicators.push(`Natural camera noise (${Math.round(noiseStats.avgVariance)})`);
      }
    }
    
    // Check 8: Frequency domain analysis
    const frequencyStats = await (async () => {
      try {
        const edges = await sharp(imagePath).greyscale().convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] }).raw().toBuffer({ resolveWithObject: true });
        const { data } = edges;
        const pixels = new Uint8Array(data);
        let edgeSum = 0, strongEdges = 0;
        for (let i = 0; i < pixels.length; i++) {
          edgeSum += pixels[i];
          if (pixels[i] > 100) strongEdges++;
        }
        return { avgEdgeIntensity: edgeSum / pixels.length, strongEdgeRatio: strongEdges / pixels.length, valid: true };
      } catch (err) {
        return { avgEdgeIntensity: 0, strongEdgeRatio: 0, valid: false };
      }
    })();
    if (frequencyStats.valid) {
      if (frequencyStats.avgEdgeIntensity < 15) {
        suspicionScore += 10;  // Reduced from 20
        indicators.push(`Unnaturally smooth (${Math.round(frequencyStats.avgEdgeIntensity)})`);
      }
      if (frequencyStats.avgEdgeIntensity > 60) {
        suspicionScore += 10;
        indicators.push(`Excessive edge enhancement (${Math.round(frequencyStats.avgEdgeIntensity)})`);
      }
      if (frequencyStats.strongEdgeRatio < 0.02 && frequencyStats.avgEdgeIntensity < 20) {
        suspicionScore += 10;
        indicators.push('Lack of texture detail');
      }
    }
    
    // Check 9: Color space anomalies
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
        return { extremeRatio: extremeColors / sampleSize, saturationRatio: unnaturalSaturation / sampleSize, valid: true };
      } catch (err) {
        return { extremeRatio: 0, saturationRatio: 0, valid: false };
      }
    })();
    if (colorStats.valid) {
      if (colorStats.extremeRatio > 0.25) {  // Even higher threshold - natural photos can have varied colors
        suspicionScore += 8;  // Reduced penalty
        indicators.push(`Unusual color distribution (${Math.round(colorStats.extremeRatio * 100)}%)`);
      }
      if (colorStats.saturationRatio > 0.85) {
        suspicionScore += 5;
        indicators.push(`Excessive saturation (${Math.round(colorStats.saturationRatio * 100)}%)`);
      }
      if (colorStats.extremeRatio < 0.01 && colorStats.saturationRatio < 0.05) {
        suspicionScore += 10;
        indicators.push('Unnaturally uniform colors');
      }
    }
    return {
      likely_ai_generated: suspicionScore >= 90,
      ai_confidence: Math.min(suspicionScore, 100),
      indicators: indicators,
      metadata_check: {
        has_camera_exif: metadata.exif && Object.keys(metadata.exif).length >= 5,
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
