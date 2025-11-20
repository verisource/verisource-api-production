/**
 * HEIC/HEVC Format Detection Service
 * Detects Apple's proprietary image/video formats
 * Strong indicator of iPhone/iPad origin
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Check if file was originally HEIC/HEIF format
 * @param {string} filePath - Path to image file
 * @param {Object} exifData - Parsed EXIF metadata
 * @returns {Object} Detection result
 */
async function detectHEIC(filePath, exifData) {
  const result = {
    wasHEIC: false,
    confidence: 0,
    indicators: [],
    format_conversion: null
  };

  try {
    // Check EXIF for original format hints
    if (exifData) {
      // Apple devices often store original format in metadata
      if (exifData.OriginalFormat?.toLowerCase().includes('heic') ||
          exifData.OriginalFormat?.toLowerCase().includes('heif')) {
        result.wasHEIC = true;
        result.confidence = 95;
        result.indicators.push('EXIF indicates original HEIC format');
        result.format_conversion = 'HEIC → JPEG';
      }

      // Check for HEVC video format indicators
      if (exifData.CompressorID?.includes('hvc1') || 
          exifData.CompressorID?.includes('hev1')) {
        result.wasHEIC = true;
        result.confidence = 90;
        result.indicators.push('HEVC compression detected');
        result.format_conversion = 'HEVC → current format';
      }

      // Apple-specific software tags
      if (exifData.Software?.includes('iOS') || 
          exifData.Software?.includes('macOS')) {
        if (exifData.Make?.toLowerCase().includes('apple')) {
          // Recent iPhones default to HEIC
          const model = exifData.Model || '';
          const year = parseInt(exifData.DateTimeOriginal?.substring(0, 4)) || 0;
          
          // iPhone 7 and later (2016+) support HEIC
          if (year >= 2017) {
            result.indicators.push('Recent iPhone (likely captured in HEIC)');
            result.confidence = Math.max(result.confidence, 70);
            result.wasHEIC = true;
          }
        }
      }
    }

    // Check file header for HEIC magic bytes (if still in original format)
    const buffer = await fs.readFile(filePath);
    const header = buffer.slice(0, 12);
    
    // HEIC/HEIF magic bytes: "ftyp" at offset 4
    if (header.length >= 12) {
      const ftypPosition = header.indexOf(Buffer.from('ftyp'));
      if (ftypPosition >= 4 && ftypPosition <= 8) {
        const brand = buffer.slice(ftypPosition + 4, ftypPosition + 8).toString('ascii');
        
        if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || 
            brand === 'hevx' || brand === 'mif1') {
          result.wasHEIC = true;
          result.confidence = 100;
          result.indicators.push('File header confirms HEIC/HEIF format');
          result.format_conversion = 'None (original HEIC)';
        }
      }
    }

    // Check for HEIC color profile (often retained after conversion)
    if (exifData.ColorSpace === 'Display P3' || 
        exifData.ProfileDescription?.includes('Display P3')) {
      result.indicators.push('Display P3 color space (common in HEIC)');
      result.confidence = Math.max(result.confidence, 60);
    }

  } catch (err) {
    console.error('HEIC detection error:', err.message);
  }

  return result;
}

/**
 * Adjust AI confidence based on HEIC detection
 * HEIC format is strong signal of iPhone authenticity
 */
function adjustForHEIC(aiDetection, heicDetection) {
  if (!heicDetection.wasHEIC || !aiDetection) {
    return aiDetection;
  }

  // Strong HEIC signal = reduce AI confidence significantly
  const confidenceReduction = Math.round(40 * (heicDetection.confidence / 100));
  const originalConfidence = aiDetection.ai_confidence || 0;
  const adjustedConfidence = Math.max(originalConfidence - confidenceReduction, 0);

  return {
    ...aiDetection,
    ai_confidence: adjustedConfidence,
    original_ai_confidence: aiDetection.original_ai_confidence || originalConfidence,
    heic_detected: true,
    heic_confidence: heicDetection.confidence,
    heic_indicators: heicDetection.indicators,
    adjusted_for_heic: true,
    warnings: [
      ...(aiDetection.warnings || []),
      `HEIC format detected (${heicDetection.confidence}% confidence). ${heicDetection.format_conversion || 'Apple device origin'}. AI confidence adjusted from ${originalConfidence}% to ${adjustedConfidence}%.`
    ]
  };
}

module.exports = {
  detectHEIC,
  adjustForHEIC
};
