// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * Image Canonicalization Module
 * 
 * Normalizes images before hashing to ensure consistent fingerprints.
 * Uses sharp for image processing. EXIF Orientation is applied via sharp.rotate().
 * 
 * Canonicalization steps:
 * 1. Strip all metadata (EXIF, IPTC, XMP)
 * 2. Convert to standard color space (sRGB)
 * 3. Normalize orientation
 * 4. Remove ICC profiles
 * 5. Standardize format (optional)
 */

const sharp = require('sharp');
const crypto = require('crypto');
let exifr;
try { exifr = require('exifr'); } catch { /* optional, only used for getImageMetadata() */ }

// ============================================
// Version Specifications
// ============================================

// Canonicalization version constants
const CANON_VERSION_V1 = 'img:v1';
const CANON_VERSION_V2 = 'img:v2';
const CANON_VERSION_CURRENT = CANON_VERSION_V2;

/**
 * Verisource Canonicalization
 * 
 * "Verisource records the canonicalization recipe used for each asset 
 * (e.g., img:v1, img:v2), so we can improve quality without breaking 
 * old proofs. Verifiers accept both during and after transitions."
 * 
 * Version History:
 * 
 * img:v1 — exif-orient|srgb|png(cl0,palette0,prog0)
 *   Legacy canonicalization; no resize ceiling; no alpha flatten.
 * 
 * img:v2 — exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)
 *   Improved stability; resize ceiling to 2048; alpha composited to white; deterministic PNG.
 */

// Pipeline specification strings
const PIPELINE_V1 = 'exif-orient|srgb|png(cl0,palette0,prog0)';
const PIPELINE_V2 = 'exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)';

/**
 * Canonicalize an image for consistent hashing
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @param {Object} options - Canonicalization options
 * @returns {Promise<Buffer>} Canonicalized image buffer
 */
/**
 * Current V2 canonicalization
 * Pipeline: exif-orient | srgb | max2048 | flatten-white | png(cl9,palette0,prog0)
 * 
 * Steps:
 *   1. Apply EXIF orientation via rotate()
 *   2. Convert to sRGB color space
 *   3. Bound longest edge to 2048px (no enlargement)
 *   4. Composite alpha on white background if present
 *   5. Encode as PNG with compressionLevel 9, no palette, non-progressive
 * 
 * Purpose: Improved stability across devices & encoders
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @param {Object} options - Canonicalization options
 * @returns {Promise<Buffer>} Canonical image buffer (V2 format)
 */
async function canonicalizeImage(input, options = {}) {
  const MAX_SIDE = options.maxSide || 2048;
  const background = options.background || { r: 255, g: 255, b: 255 };
  
  try {
    // exif-orient
    let img = sharp(input, { failOn: 'warning' }).rotate();
    
    // max2048 (bound longest edge)
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const L = Math.max(w, h);
    
    if (L > MAX_SIDE) {
      const s = MAX_SIDE / L;
      img = img.resize({
        width: Math.round(w * s),
        height: Math.round(h * s),
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // flatten-white (if alpha present)
    if (meta.hasAlpha) {
      img = img.flatten({ background });
    }
    
    // srgb | png(cl9,palette0,prog0)
    const buf = await img
      .toColorspace('srgb')
      .png({
        compressionLevel: 9,
        palette: false,
        progressive: false
      })
      .toBuffer();
      
    return buf;
  } catch (err) {
    throw new Error(`Image canonicalization failed: ${err.message}`);
  }
}

/**
 * Get pipeline specification string for a version
 * 
 * @param {string} version - Canonicalization version (img:v1 or img:v2)
 * @returns {string} Pipeline specification
 */
function getPipelineSpec(version) {
  switch (version) {
    case CANON_VERSION_V1:
      return `${version}:${PIPELINE_V1}`;
    case CANON_VERSION_V2:
      return `${version}:${PIPELINE_V2}`;
    default:
      throw new Error(`Unknown canonicalization version: ${version}`);
  }
}

/**
 * Legacy V1 canonicalization (for backward compatibility)
 * Pipeline: exif-orient | srgb | png(cl0,palette0,prog0)
 * 
 * Steps:
 *   1. Apply EXIF orientation via rotate()
 *   2. Convert to sRGB color space
 *   3. Encode as PNG with compressionLevel 0, no palette, non-progressive
 * 
 * Notes: No resize ceiling, no alpha flattening
 * Purpose: Legacy behavior (matches earlier pipeline & hashes)
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<Buffer>} Canonical image buffer (V1 format)
 */
async function canonicalizeImageV1(input) {
  try {
    const buf = await sharp(input, { failOn: 'warning' })
      .rotate()                    // exif-orient
      .toColorspace('srgb')        // srgb
      .png({                       // png(cl0,palette0,prog0)
        compressionLevel: 0,
        palette: false,
        progressive: false
      })
      .toBuffer();
    return buf;
  } catch (err) {
    throw new Error(`Image canonicalization V1 failed: ${err.message}`);
  }
}

/**
 * Canonicalize for SHA-256 hashing
 * Most aggressive normalization for exact matching
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<Buffer>} Canonicalized image buffer
 */
async function canonicalizeForSHA256(input) {
  // Wrapper to make intent explicit; uses the same deterministic pipeline.
  return canonicalizeImage(input, { maxSide: 2048 });
}

/**
 * Canonicalize with specific version
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @param {string} version - Canonicalization version (img:v1 or img:v2)
 * @returns {Promise<Buffer>} Canonical image buffer
 */
async function canonicalizeWithVersion(input, version) {
  switch (version) {
    case CANON_VERSION_V1:
      return canonicalizeImageV1(input);
    case CANON_VERSION_V2:
      return canonicalizeImage(input, { maxSide: 2048 });
    default:
      throw new Error(`Unknown canonicalization version: ${version}`);
  }
}

/**
 * Create fingerprint with both V1 and V2 hashes (transition support)
 * 
 * During ecosystem transition, emit both digests so verifiers can match either.
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<Object>} Fingerprint with both versions
 */
async function createDualVersionFingerprint(input) {
  const [v1Canonical, v2Canonical] = await Promise.all([
    canonicalizeImageV1(input),
    canonicalizeImage(input, { maxSide: 2048 })
  ]);
  
  return {
    'img:v1': sha256(v1Canonical),
    'img:v2': sha256(v2Canonical),
    currentVersion: CANON_VERSION_CURRENT
  };
}

/**
 * Verify image against versioned hash
 * 
 * @param {Buffer|string} input - Image to verify
 * @param {string} expectedHash - Expected hash value
 * @param {string} version - Canonicalization version used (img:v1 or img:v2)
 * @returns {Promise<boolean>} True if hash matches
 */
async function verifyVersionedHash(input, expectedHash, version) {
  const canonical = await canonicalizeWithVersion(input, version);
  const actualHash = sha256(canonical);
  return actualHash === expectedHash;
}

/**
 * Verify image against fingerprint (supports both versions)
 * 
 * @param {Buffer|string} input - Image to verify
 * @param {Object} fingerprint - Fingerprint object with versioned hashes
 * @returns {Promise<Object>} Verification result
 */
async function verifyAgainstFingerprint(input, fingerprint) {
  const results = {
    verified: false,
    matchedVersion: null,
    v1Match: false,
    v2Match: false
  };
  
  // Try V2 first (current version)
  if (fingerprint['img:v2']) {
    results.v2Match = await verifyVersionedHash(input, fingerprint['img:v2'], CANON_VERSION_V2);
    if (results.v2Match) {
      results.verified = true;
      results.matchedVersion = CANON_VERSION_V2;
      return results;
    }
  }
  
  // Fall back to V1 (legacy)
  if (fingerprint['img:v1']) {
    results.v1Match = await verifyVersionedHash(input, fingerprint['img:v1'], CANON_VERSION_V1);
    if (results.v1Match) {
      results.verified = true;
      results.matchedVersion = CANON_VERSION_V1;
      return results;
    }
  }
  
  return results;
}

/**
 * Normalize for perceptual hashing
 * Less aggressive - preserves visual content
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<Buffer>} Normalized image buffer
 */
async function normalizeForPerceptualHash(input) {
  // Use the SAME canonical form for pHash input to avoid drift.
  return canonicalizeForSHA256(input);
}

/**
 * Get image metadata before canonicalization
 * Useful for logging what was removed
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<Object>} Image metadata
 */
async function getImageMetadata(input) {
  try {
    const [sharpMeta, exifData] = await Promise.all([
      sharp(input).metadata(),
      exifr ? exifr.parse(input).catch(() => ({})) : Promise.resolve({})
    ]);

    return {
      format: sharpMeta.format,
      width: sharpMeta.width,
      height: sharpMeta.height,
      space: sharpMeta.space,
      channels: sharpMeta.channels,
      depth: sharpMeta.depth,
      hasProfile: !!sharpMeta.icc,
      hasAlpha: sharpMeta.hasAlpha,
      orientation: sharpMeta.orientation,
      exif: exifData,
      exifKeys: Object.keys(exifData || {})
    };
  } catch (error) {
    throw new Error(`Failed to read image metadata: ${error.message}`);
  }
}

/**
 * Verify canonicalization by comparing before/after
 * 
 * @param {Buffer|string} original - Original image
 * @param {Buffer} canonical - Canonicalized image
 * @returns {Promise<Object>} Comparison results
 */
async function verifyCanonical(original, canonical) {
  const [origMeta, canonMeta] = await Promise.all([
    getImageMetadata(original),
    sharp(canonical).metadata()
  ]);

  return {
    metadataRemoved: {
      exifKeys: origMeta.exifKeys.length,
      hadProfile: origMeta.hasProfile,
      hadOrientation: origMeta.orientation !== 1
    },
    canonicalProperties: {
      format: canonMeta.format,
      space: canonMeta.space,
      hasProfile: !!canonMeta.icc,
      // sharp PNG encoder does not embed EXIF/ICC unless withMetadata() is used
      hasMetadata: Boolean(canonMeta.exif || canonMeta.icc)
    },
    isFullyCanonical: 
      !canonMeta.icc &&
      !canonMeta.exif &&
      canonMeta.space === 'srgb'
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Fast path logic: extract hashes from credential
 * 
 * 1. Read fingerprintBundle.canonicalization
 * 2. If it starts with img:v2, compare against v2 hash
 * 3. If candidate presents only a legacy v1 hash, look in ext.alt_hashes["img:v1"]
 * 4. If exact fails, fall back to pHash thresholds
 */
function pickHashes(cred) {
  const fb = cred.fingerprintBundle || {};
  const v2 = (fb.canonicalization || '').startsWith('img:v2') ? fb.sha256_canonical : null;
  const v1 = cred.ext?.alt_hashes?.['img:v1'] || null;
  return { v2, v1, phash: fb.perceptualHash };
}

async function selfTestDeterminism(input) {
  const a = await canonicalizeForSHA256(input);
  const b = await canonicalizeForSHA256(input);
  return {
    identicalBytes: a.equals(b),
    hashA: sha256(a),
    hashB: sha256(b)
  };
}

// ============================================
// CI Guardrails
// ============================================

/**
 * CI Guardrail: Determinism test
 * 
 * Canonicalize the same input twice → bytes must match; hash must match.
 */
async function testDeterminism(inputBytes, version) {
  try {
    const canonFn = version === 'v1' ? canonicalizeImageV1 : canonicalizeImage;
    
    const bytes1 = await canonFn(inputBytes);
    const bytes2 = await canonFn(inputBytes);
    
    const hash1 = sha256(bytes1);
    const hash2 = sha256(bytes2);
    
    const bytesMatch = bytes1.equals(bytes2);
    const hashesMatch = hash1 === hash2;
    
    if (!bytesMatch) {
      return { 
        passed: false, 
        error: `${version} bytes differ on repeated canonicalization` 
      };
    }
    
    if (!hashesMatch) {
      return { 
        passed: false, 
        error: `${version} hashes differ on repeated canonicalization` 
      };
    }
    
    return { passed: true };
  } catch (error) {
    return { 
      passed: false, 
      error: `${version} determinism test failed: ${error.message}` 
    };
  }
}

/**
 * CI Guardrail: Golden parity test (for v1 only)
 * 
 * Hash on goldens/ equals stored known-good hashes.
 */
async function testGoldenParity(goldenBytes, expectedV1Hash) {
  try {
    const v1Bytes = await canonicalizeImageV1(goldenBytes);
    const actualHash = sha256(v1Bytes);
    
    if (actualHash !== expectedV1Hash) {
      return {
        passed: false,
        error: `v1 golden hash mismatch: expected ${expectedV1Hash}, got ${actualHash}`
      };
    }
    
    return { passed: true };
  } catch (error) {
    return {
      passed: false,
      error: `v1 golden parity test failed: ${error.message}`
    };
  }
}

/**
 * CI Guardrail: Drift alert
 * 
 * Fail CI if a lib upgrade changes v2 hashes on goldens/
 */
async function testNoDrift(goldenBytes, expectedV2Hash) {
  try {
    const v2Bytes = await canonicalizeImage(goldenBytes, { maxSide: 2048 });
    const actualHash = sha256(v2Bytes);
    
    if (actualHash !== expectedV2Hash) {
      return {
        passed: false,
        actualHash,
        error: `DRIFT DETECTED: v2 hash changed from ${expectedV2Hash} to ${actualHash}. ` +
               `This may indicate a library upgrade changed canonicalization behavior. ` +
               `If intentional, update golden hashes and bump to img:v3.`
      };
    }
    
    return { passed: true, actualHash };
  } catch (error) {
    return {
      passed: false,
      error: `v2 drift test failed: ${error.message}`
    };
  }
}

/**
 * Run all CI guardrails
 * 
 * @param {Buffer} testImageBytes - Test image buffer
 * @param {Array} goldens - Array of {bytes, v1Hash, v2Hash}
 * @returns {Promise<Object>} Results object with passed flag and details
 */
async function runCIGuardrails(testImageBytes, goldens) {
  const results = [];
  let allPassed = true;
  
  // Test determinism for both versions
  const v1Determinism = await testDeterminism(testImageBytes, 'v1');
  results.push({ test: 'v1_determinism', ...v1Determinism });
  if (!v1Determinism.passed) allPassed = false;
  
  const v2Determinism = await testDeterminism(testImageBytes, 'v2');
  results.push({ test: 'v2_determinism', ...v2Determinism });
  if (!v2Determinism.passed) allPassed = false;
  
  // Test golden parity and drift for each golden
  for (let i = 0; i < goldens.length; i++) {
    const golden = goldens[i];
    
    const v1Parity = await testGoldenParity(golden.bytes, golden.v1Hash);
    results.push({ test: `golden_${i}_v1_parity`, ...v1Parity });
    if (!v1Parity.passed) allPassed = false;
    
    const v2Drift = await testNoDrift(golden.bytes, golden.v2Hash);
    results.push({ test: `golden_${i}_v2_drift`, ...v2Drift });
    if (!v2Drift.passed) allPassed = false;
  }
  
  return { passed: allPassed, results };
}

module.exports = {
  // Core canonicalization
  canonicalizeImage,
  canonicalizeForSHA256,
  normalizeForPerceptualHash,
  
  // Versioned canonicalization
  canonicalizeImageV1,
  canonicalizeWithVersion,
  createDualVersionFingerprint,
  verifyVersionedHash,
  verifyAgainstFingerprint,
  
  // Version constants
  CANON_VERSION_V1,
  CANON_VERSION_V2,
  CANON_VERSION_CURRENT,
  
  // Pipeline specifications
  PIPELINE_V1,
  PIPELINE_V2,
  getPipelineSpec,
  
  // Fast path
  pickHashes,
  
  // CI Guardrails
  testDeterminism,
  testGoldenParity,
  testNoDrift,
  runCIGuardrails,
  
  // Utilities
  getImageMetadata,
  verifyCanonical,
  sha256,
  selfTestDeterminism
};
