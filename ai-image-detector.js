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
