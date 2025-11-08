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
    
    // Check 2: No EXIF camera data
    if (!metadata.exif || Object.keys(metadata.exif).length < 5) {
      suspicionScore += 30;
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
    
    // Check 7: Noise pattern analysis
    // Real cameras have consistent sensor noise, AI images lack this
    const noiseStats = await (async () => {
      try {
        // Extract luminance channel for noise analysis
        const grayImage = await sharp(imagePath)
          .greyscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
        
        const { data, info } = grayImage;
        const pixels = new Uint8Array(data);
        
        // Calculate local variance (noise indicator)
        let totalVariance = 0;
        const sampleSize = Math.min(10000, pixels.length - 100);
        
        for (let i = 0; i < sampleSize; i += 100) {
          const window = pixels.slice(i, i + 100);
          const mean = window.reduce((a, b) => a + b, 0) / window.length;
          const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
          totalVariance += variance;
        }
        
        const avgVariance = totalVariance / (sampleSize / 100);
        return { avgVariance, valid: true };
      } catch (err) {
        return { avgVariance: 0, valid: false };
      }
    })();
    
    if (noiseStats.valid) {
      // Real photos typically have variance between 100-500
      // AI images often have very low variance (<50) or very high (>800)
      if (noiseStats.avgVariance < 50) {
        suspicionScore += 25;
        indicators.push(`Unnaturally low noise (${Math.round(noiseStats.avgVariance)} - typical AI smoothness)`);
      } else if (noiseStats.avgVariance > 800) {
        suspicionScore += 15;
        indicators.push(`Excessive noise variation (${Math.round(noiseStats.avgVariance)} - may indicate artificial noise)`);
      } else if (noiseStats.avgVariance >= 100 && noiseStats.avgVariance <= 500) {
        // This is good - natural camera noise range
        // Don't add suspicion, this actually reduces AI likelihood
        if (suspicionScore > 20) {
          suspicionScore -= 10; // Bonus for natural noise
          indicators.push(`Natural camera noise detected (${Math.round(noiseStats.avgVariance)})`);
      }
    }
    
    // Check 8: Frequency domain analysis (simplified)
    // AI images often lack high-frequency detail (texture)
    const frequencyStats = await (async () => {
      try {
        // Get edge detection to approximate high-frequency content
        const edges = await sharp(imagePath)
          .greyscale()
          .convolve({
            width: 3,
            height: 3,
            kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] // Laplacian edge detection
          })
          .raw()
          .toBuffer({ resolveWithObject: true });
        
        const { data } = edges;
        const pixels = new Uint8Array(data);
        
        // Calculate edge intensity (high frequency measure)
        let edgeSum = 0;
        let strongEdges = 0;
        
        for (let i = 0; i < pixels.length; i++) {
          edgeSum += pixels[i];
          if (pixels[i] > 100) strongEdges++;
        }
        
        const avgEdgeIntensity = edgeSum / pixels.length;
        const strongEdgeRatio = strongEdges / pixels.length;
        
        return { avgEdgeIntensity, strongEdgeRatio, valid: true };
      } catch (err) {
        return { avgEdgeIntensity: 0, strongEdgeRatio: 0, valid: false };
      }
    })();
    
    if (frequencyStats.valid) {
      // AI images often have unnaturally low edge intensity (too smooth)
      // Real photos typically have avgEdgeIntensity > 20
      if (frequencyStats.avgEdgeIntensity < 15) {
        suspicionScore += 20;
        indicators.push(`Unnaturally smooth (low edge detail: ${Math.round(frequencyStats.avgEdgeIntensity)} - typical AI artifact)`);
      }
      
      // Very high edge intensity can also indicate artificial sharpening
      if (frequencyStats.avgEdgeIntensity > 60) {
        suspicionScore += 10;
        indicators.push(`Excessive edge enhancement (${Math.round(frequencyStats.avgEdgeIntensity)} - may indicate post-processing)`);
      }
      
      // Check strong edge ratio
      if (frequencyStats.strongEdgeRatio < 0.05 && frequencyStats.avgEdgeIntensity < 20) {
        suspicionScore += 15;
        indicators.push('Lack of texture detail (GAN/diffusion artifact)');
      }
        }
      }
      }
    }
    }
    
    return {
      likely_ai_generated: suspicionScore >= 50,
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
