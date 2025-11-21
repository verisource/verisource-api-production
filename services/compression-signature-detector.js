/**
 * Manufacturer Compression Signature Detection
 * Detects phone/camera-specific JPEG encoding patterns
 * Each manufacturer has unique quantization tables and compression algorithms
 */

const { execSync } = require('child_process');
const fs = require('fs').promises;

/**
 * Analyze JPEG compression signature
 * @param {string} imagePath - Path to JPEG image
 * @param {Object} exifData - EXIF metadata
 * @returns {Object} Signature analysis result
 */
async function analyzeCompressionSignature(imagePath, exifData) {
  const result = {
    manufacturer_detected: null,
    confidence: 0,
    indicators: [],
    quantization_signature: null,
    chroma_subsampling: null,
    matches_expected: false,
    ai_likelihood: 0,
    exif_present: false
  };

  try {
    // Extract JPEG technical details
    const jpegDetails = await extractJPEGDetails(imagePath);
    
    if (!jpegDetails.success) {
      result.indicators.push('Could not analyze JPEG structure');
      return result;
    }

    result.quantization_signature = jpegDetails.quantization;
    result.chroma_subsampling = jpegDetails.chromaSubsampling;

    // Determine expected manufacturer from EXIF
    const expectedManufacturer = exifData?.Make?.toLowerCase();

    if (expectedManufacturer) {
      result.exif_present = true;
      // Check if compression matches known manufacturer patterns
      const signatureMatch = matchManufacturerSignature(
        expectedManufacturer,
        jpegDetails,
        exifData
      );

      result.manufacturer_detected = signatureMatch.manufacturer;
      result.confidence = signatureMatch.confidence;
      result.indicators.push(...signatureMatch.indicators);
      result.matches_expected = signatureMatch.matches;

      // If EXIF says Apple but compression doesn't match = suspicious
      if (!signatureMatch.matches && expectedManufacturer) {
        result.indicators.push(`EXIF claims ${expectedManufacturer} but compression signature doesn't match`);
        result.ai_likelihood += 35;
      }
    } else {
      // No EXIF manufacturer - check if compression matches any known pattern
      const genericMatch = detectKnownSignature(jpegDetails);
      
      if (genericMatch.detected) {
        result.manufacturer_detected = genericMatch.manufacturer;
        result.confidence = genericMatch.confidence;
        result.indicators.push(...genericMatch.indicators);
        result.matches_expected = true;  // Generic signature counts as a match
        result.indicators.push('No EXIF manufacturer but compression signature detected');
      } else {
        result.indicators.push('Generic/library compression (no manufacturer signature)');
        result.ai_likelihood += 40; // AI generators use generic encoders
      }
    }

    // Check for AI generator patterns
    const aiPatterns = detectAICompressionPatterns(jpegDetails);
    if (aiPatterns.detected) {
      result.ai_likelihood = Math.max(result.ai_likelihood, aiPatterns.confidence);
      result.indicators.push(...aiPatterns.indicators);
    }

  } catch (err) {
    console.error('Compression signature analysis error:', err.message);
    result.indicators.push('Analysis failed');
  }

  return result;
}

/**
 * Extract detailed JPEG technical information
 */
async function extractJPEGDetails(imagePath) {
  try {
    // Use ImageMagick to get quantization tables
    const quantOutput = execSync(
      `identify -verbose "${imagePath}" | grep -A 100 "Quantization" 2>/dev/null || echo "none"`,
      { encoding: 'utf8', timeout: 10000 }
    );

    // Use exiftool for chroma subsampling
    const chromaOutput = execSync(
      `exiftool -YCbCrSubSampling "${imagePath}" 2>/dev/null || echo "unknown"`,
      { encoding: 'utf8', timeout: 5000 }
    );

    // Extract quality estimate
    const qualityOutput = execSync(
      `identify -format "%Q" "${imagePath}" 2>/dev/null || echo "0"`,
      { encoding: 'utf8', timeout: 5000 }
    );

    const quality = parseInt(qualityOutput.trim()) || 0;
    const chromaSubsampling = chromaOutput.includes('2 2') ? '4:2:0' :
                             chromaOutput.includes('2 1') ? '4:2:2' :
                             chromaOutput.includes('1 1') ? '4:4:4' : 'unknown';

    // Parse quantization table values
    const quantization = parseQuantizationTable(quantOutput);

    // Get DCT coefficient distribution
    const dctPattern = await analyzeDCTPattern(imagePath);

    return {
      success: true,
      quality,
      chromaSubsampling,
      quantization,
      dctPattern
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Parse quantization table from ImageMagick output
 */
function parseQuantizationTable(quantOutput) {
  try {
    // Extract first 8 values from luminance table
    const matches = quantOutput.match(/\d+/g);
    if (matches && matches.length >= 8) {
      return matches.slice(0, 8).map(Number);
    }
  } catch (err) {
    // Ignore
  }
  return null;
}

/**
 * Analyze DCT coefficient patterns
 */
async function analyzeDCTPattern(imagePath) {
  try {
    // Use ImageMagick to analyze DCT distribution
    const output = execSync(
      `convert "${imagePath}" -colorspace YCbCr -separate -delete 1,2 -scale 8x8 -depth 8 txt:- 2>/dev/null | grep -o "([0-9]*," | head -20`,
      { encoding: 'utf8', timeout: 10000 }
    );

    const values = output.match(/\d+/g) || [];
    if (values.length >= 10) {
      const avg = values.reduce((sum, v) => sum + parseInt(v), 0) / values.length;
      return { average: avg, values: values.slice(0, 10).map(Number) };
    }
  } catch (err) {
    // Ignore
  }
  return null;
}

/**
 * Match compression signature against known manufacturer patterns
 */
function matchManufacturerSignature(manufacturer, jpegDetails, exifData) {
  const result = {
    manufacturer: null,
    confidence: 0,
    indicators: [],
    matches: false
  };

  // iPhone/Apple Signatures
  if (manufacturer.includes('apple')) {
    let appleScore = 0;

    // iPhones typically use 4:2:0 chroma subsampling
    if (jpegDetails.chromaSubsampling === '4:2:0') {
      result.indicators.push('4:2:0 chroma subsampling (iPhone standard)');
      appleScore += 20;
    }

    // iPhones use quality 92-95 typically
    if (jpegDetails.quality >= 90 && jpegDetails.quality <= 96) {
      result.indicators.push(`Quality ${jpegDetails.quality} (iPhone range)`);
      appleScore += 25;
    }

    // Apple uses specific quantization patterns
    if (jpegDetails.quantization && jpegDetails.quantization[0] <= 3) {
      result.indicators.push('Low DC coefficient (Apple encoding)');
      appleScore += 30;
    }

    // Check for HEVC encoding artifacts (iPhone-specific)
    if (exifData.CompressorID?.includes('hvc1')) {
      result.indicators.push('HEVC compression (iPhone)');
      appleScore += 25;
    }

    result.manufacturer = 'Apple';
    result.confidence = Math.min(appleScore, 100);
    result.matches = appleScore >= 50;
  }

  // Samsung Signatures
  else if (manufacturer.includes('samsung')) {
    let samsungScore = 0;

    // Samsung often uses 4:2:2 for higher-end models
    if (jpegDetails.chromaSubsampling === '4:2:2') {
      result.indicators.push('4:2:2 chroma subsampling (Samsung high-end)');
      samsungScore += 30;
    } else if (jpegDetails.chromaSubsampling === '4:2:0') {
      result.indicators.push('4:2:0 chroma subsampling (Samsung standard)');
      samsungScore += 15;
    }

    // Samsung typically uses quality 85-95
    if (jpegDetails.quality >= 85 && jpegDetails.quality <= 95) {
      result.indicators.push(`Quality ${jpegDetails.quality} (Samsung range)`);
      samsungScore += 25;
    }

    // Samsung quantization patterns
    if (jpegDetails.quantization && jpegDetails.quantization[0] >= 3 && jpegDetails.quantization[0] <= 5) {
      result.indicators.push('Samsung-typical quantization');
      samsungScore += 30;
    }

    result.manufacturer = 'Samsung';
    result.confidence = Math.min(samsungScore, 100);
    result.matches = samsungScore >= 50;
  }

  // Google Pixel Signatures
  else if (manufacturer.includes('google')) {
    let pixelScore = 0;

    // Pixel uses 4:2:0
    if (jpegDetails.chromaSubsampling === '4:2:0') {
      result.indicators.push('4:2:0 chroma subsampling (Pixel)');
      pixelScore += 20;
    }

    // Pixel quality range
    if (jpegDetails.quality >= 88 && jpegDetails.quality <= 95) {
      result.indicators.push(`Quality ${jpegDetails.quality} (Pixel range)`);
      pixelScore += 25;
    }

    // Pixel-specific DCT patterns
    if (jpegDetails.dctPattern && jpegDetails.dctPattern.average > 100) {
      result.indicators.push('High DCT energy (HDR+ processing)');
      pixelScore += 30;
    }

    result.manufacturer = 'Google Pixel';
    result.confidence = Math.min(pixelScore, 100);
    result.matches = pixelScore >= 50;
  }

  // Generic camera patterns
  else {
    result.indicators.push(`Manufacturer: ${manufacturer} (no specific signature database)`);
    result.confidence = 30;
    result.manufacturer = manufacturer;
    result.matches = true; // Assume match for unknown manufacturers
  }

  return result;
}

/**
 * Detect known manufacturer signatures without EXIF hint
 */
function detectKnownSignature(jpegDetails) {
  const result = {
    detected: false,
    manufacturer: null,
    confidence: 0,
    indicators: []
  };

  // High quality + 4:2:0 = likely smartphone
  if (jpegDetails.quality >= 90 && jpegDetails.chromaSubsampling === '4:2:0') {
    result.detected = true;
    result.manufacturer = 'High-end smartphone (Apple/Samsung likely)';
    result.confidence = 50;
    result.indicators.push('High-quality 4:2:0 encoding (smartphone characteristic)');
  }

  // 4:2:2 = likely professional or high-end Samsung
  if (jpegDetails.chromaSubsampling === '4:2:2') {
    result.detected = true;
    result.manufacturer = 'Professional camera or Samsung high-end';
    result.confidence = 60;
    result.indicators.push('4:2:2 subsampling (professional equipment)');
  }

  return result;
}

/**
 * Detect AI generator compression patterns
 */
function detectAICompressionPatterns(jpegDetails) {
  const result = {
    detected: false,
    confidence: 0,
    indicators: []
  };

  let aiScore = 0;

  // AI generators often use:
  // 1. Generic quality settings (75, 80, 85, 90, 95, 100)
  const genericQualities = [75, 80, 85, 90, 95, 100];
  if (genericQualities.includes(jpegDetails.quality)) {
    result.indicators.push(`Generic quality setting (${jpegDetails.quality}) - common in AI tools`);
    aiScore += 20;
  }

  // 2. Standard 4:4:4 subsampling (no chroma subsampling)
  if (jpegDetails.chromaSubsampling === '4:4:4') {
    result.indicators.push('No chroma subsampling (4:4:4) - AI generator default');
    aiScore += 35;
  }

  // 3. Uniform quantization tables (not manufacturer-specific)
  if (jpegDetails.quantization) {
    const variance = calculateVariance(jpegDetails.quantization);
    if (variance < 5) {
      result.indicators.push('Uniform quantization table (generic encoder)');
      aiScore += 25;
    }
  }

  // 4. Perfect DCT coefficients (too clean)
  if (jpegDetails.dctPattern && jpegDetails.dctPattern.average < 50) {
    result.indicators.push('Unusually clean DCT coefficients');
    aiScore += 20;
  }

  result.confidence = Math.min(aiScore, 100);
  result.detected = aiScore >= 40;

  return result;
}

/**
 * Calculate variance of array
 */
function calculateVariance(arr) {
  const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
  return variance;
}

/**
 * Adjust AI confidence based on compression signature
 */
function adjustForCompressionSignature(aiDetection, compressionAnalysis) {
  if (!aiDetection) {
    return aiDetection;
  }

  const originalConfidence = aiDetection.ai_confidence || 0;
  let adjustment = 0;
  console.log('🔍 DEBUG Compression Adjustment:');
  console.log('  - matches_expected:', compressionAnalysis.matches_expected);
  console.log('  - confidence:', compressionAnalysis.confidence);
  console.log('  - ai_likelihood:', compressionAnalysis.ai_likelihood);
  console.log('  - originalConfidence:', originalConfidence);


  // Manufacturer signature matches = reduce AI confidence
  if (compressionAnalysis.matches_expected && compressionAnalysis.confidence >= 50) {
    // Base adjustment
    adjustment = -Math.round(40 * (compressionAnalysis.confidence / 100));
    
    // PHASE 1: Extra leniency for EXIF-less photos (old/shared photos)
    if (!compressionAnalysis.exif_present) {
      const originalAdj = adjustment;
      adjustment = Math.round(adjustment * 2.0);
      console.log(`  ℹ️ No EXIF detected - applying extra leniency: ${originalAdj} → ${adjustment}`);
    }
  }

  // AI compression patterns = increase AI confidence
  if (compressionAnalysis.ai_likelihood >= 40) {
    adjustment = Math.round(30 * (compressionAnalysis.ai_likelihood / 100));
  }

  const adjustedConfidence = Math.max(0, Math.min(100, originalConfidence + adjustment));

  return {
    ...aiDetection,
    ai_confidence: adjustedConfidence,
    original_ai_confidence: aiDetection.original_ai_confidence || originalConfidence,
    compression_analyzed: true,
    manufacturer_signature: compressionAnalysis.manufacturer_detected,
    signature_confidence: compressionAnalysis.confidence,
    compression_indicators: compressionAnalysis.indicators,
    adjusted_for_compression: true,
    warnings: [
      ...(aiDetection.warnings || []),
      `Compression signature: ${compressionAnalysis.manufacturer_detected || 'Generic'}. AI confidence adjusted from ${originalConfidence}% to ${adjustedConfidence}%.`
    ]
  };
}

module.exports = {
  analyzeCompressionSignature,
  adjustForCompressionSignature
};
