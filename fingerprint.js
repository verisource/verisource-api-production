// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * Image Fingerprint Bundle Creator
 * 
 * Integrates canonicalization and perceptual hashing to create
 * complete fingerprint bundles for content origin credentials.
 */

const crypto = require('crypto');
const { 
  canonicalizeForSHA256, 
  normalizeForPerceptualHash,
  createDualVersionFingerprint,
  verifyAgainstFingerprint,
  CANON_VERSION_CURRENT,
  CANON_VERSION_V1,
  CANON_VERSION_V2,
  getPipelineSpec
} = require('./canonicalization');
const { computePerceptualHash, computeAverageHash, computeDifferenceHash } = require('./perceptual_hash');

/**
 * Create complete fingerprint bundle for an image
 * 
 * Structure follows best practice:
 * - sha256_canonical: hash of current version (v2)
 * - algorithm: hashing algorithm used
 * - perceptualHash: resilient hash for similarity
 * - canonicalization: full pipeline specification
 * - ext.alt_hashes: legacy version hashes (transition mode)
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @param {Object} options - Fingerprint options
 * @returns {Promise<Object>} Fingerprint bundle
 */
async function createImageFingerprint(input, options = {}) {
  const defaults = {
    includeSHA256: true,
    includePerceptualHash: true,
    includeAverageHash: false,
    includeDifferenceHash: false,
    transitionMode: false,  // Emit both v1 and v2 hashes
    algorithm: 'sha256+phash'
  };

  const config = { ...defaults, ...options };

  try {
    const bundle = {
      algorithm: config.algorithm
    };

    // SHA-256 of canonical image
    if (config.includeSHA256) {
      if (config.transitionMode) {
        // Transition mode: emit both V1 and V2 hashes
        const dualHash = await createDualVersionFingerprint(input);
        
        // Primary hash (V2)
        bundle.sha256_canonical = dualHash['img:v2'];
        
        // Pipeline specification for V2
        bundle.canonicalization = getPipelineSpec(CANON_VERSION_V2);
        
        // Legacy hash in extensions
        bundle.ext = {
          alt_hashes: {
            'img:v1': dualHash['img:v1']
          }
        };
      } else {
        // Normal mode: emit current version only
        const canonical = await canonicalizeForSHA256(input);
        const hash = crypto.createHash('sha256');
        hash.update(canonical);
        bundle.sha256_canonical = hash.digest('hex');
        
        // Pipeline specification for V2
        bundle.canonicalization = getPipelineSpec(CANON_VERSION_V2);
      }
    }

    // Perceptual hash (resilient matching)
    if (config.includePerceptualHash) {
      const normalized = await normalizeForPerceptualHash(input);
      bundle.perceptualHash = await computePerceptualHash(normalized);
    }

    // Optional: Average hash (faster, less accurate)
    if (config.includeAverageHash) {
      bundle.averageHash = await computeAverageHash(input);
    }

    // Optional: Difference hash (fast gradient detection)
    if (config.includeDifferenceHash) {
      bundle.differenceHash = await computeDifferenceHash(input);
    }

    return bundle;

  } catch (error) {
    throw new Error(`Image fingerprint creation failed: ${error.message}`);
  }
}

/**
 * Create fingerprint bundle for video (segment-based)
 * Extracts key frames and computes hashes
 * 
 * @param {string} videoPath - Path to video file
 * @param {Object} options - Options
 * @returns {Promise<Object>} Fingerprint bundle with segment hashes
 */
async function createVideoFingerprint(videoPath, options = {}) {
  // Note: This is a placeholder. Full implementation would require ffmpeg
  // For now, we'll show the structure
  
  const defaults = {
    segmentDuration: 10,  // Seconds per segment
    maxSegments: 100      // Max segments to prevent bloat
  };

  const config = { ...defaults, ...options };

  // This would use ffmpeg to:
  // 1. Extract key frames at regular intervals
  // 2. Compute perceptual hash for each frame
  // 3. Create rolling segment hashes
  
  throw new Error('Video fingerprinting requires ffmpeg integration (see documentation)');
}

/**
 * Verify image against fingerprint bundle
 * Supports both V1 (legacy) and V2 (current) canonicalization
 * 
 * Handles multiple fingerprint structures:
 * - New: { sha256_canonical, canonicalization, ext.alt_hashes }
 * - Transition: { sha256_canonical, sha256_canonical_v1 }
 * - Legacy: { sha256_canonical } (assumes v1)
 * 
 * @param {Buffer|string} input - Image to verify
 * @param {Object} bundle - Fingerprint bundle to check against
 * @returns {Promise<Object>} Verification result
 */
async function verifyImageFingerprint(input, bundle) {
  const results = {
    exactMatch: false,
    perceptualMatch: false,
    confidence: 0,
    matchedVersion: null,
    details: {}
  };

  try {
    // Check exact match via SHA-256 (supports multiple structures)
    if (bundle.sha256_canonical) {
      const fingerprintObj = {
        'img:v2': bundle.sha256_canonical
      };
      
      // Check for alt_hashes in ext (new structure)
      if (bundle.ext && bundle.ext.alt_hashes && bundle.ext.alt_hashes['img:v1']) {
        fingerprintObj['img:v1'] = bundle.ext.alt_hashes['img:v1'];
      }
      // Check for legacy transition structure
      else if (bundle.sha256_canonical_v1) {
        fingerprintObj['img:v1'] = bundle.sha256_canonical_v1;
      }
      // If no v2 indicator and no alt hashes, assume it's a v1 hash
      else if (!bundle.canonicalization && !bundle.canonVersion) {
        // Legacy credential - the sha256_canonical is actually v1
        fingerprintObj['img:v1'] = bundle.sha256_canonical;
        delete fingerprintObj['img:v2'];
      }
      
      const verification = await verifyAgainstFingerprint(input, fingerprintObj);
      results.exactMatch = verification.verified;
      results.matchedVersion = verification.matchedVersion;
      results.details.sha256Verification = verification;
    }

    // Check perceptual match
    if (bundle.perceptualHash) {
      const { areSimilar } = require('./perceptual_hash');
      const normalized = await normalizeForPerceptualHash(input);
      const computedPHash = await computePerceptualHash(normalized);
      
      const similarity = areSimilar(computedPHash, bundle.perceptualHash);
      results.perceptualMatch = similarity.similar;
      results.details.perceptualSimilarity = similarity;
      results.details.computedPHash = computedPHash;
    }

    // Calculate overall confidence
    if (results.exactMatch) {
      results.confidence = 100;
    } else if (results.perceptualMatch) {
      // Extract similarity percentage
      const simMatch = results.details.perceptualSimilarity.similarity.match(/(\d+\.\d+)/);
      results.confidence = simMatch ? parseFloat(simMatch[1]) : 0;
    }

    results.verified = results.exactMatch || results.perceptualMatch;

  } catch (error) {
    results.error = error.message;
  }

  return results;
}

/**
 * Compare two images for similarity
 * 
 * @param {Buffer|string} image1 - First image
 * @param {Buffer|string} image2 - Second image
 * @returns {Promise<Object>} Comparison result
 */
async function compareImages(image1, image2) {
  try {
    // Create fingerprints for both
    const [fp1, fp2] = await Promise.all([
      createImageFingerprint(image1),
      createImageFingerprint(image2)
    ]);

    // Compare SHA-256 (exact match)
    const exactMatch = fp1.sha256_canonical === fp2.sha256_canonical;

    // Compare perceptual hashes (similar)
    const { areSimilar } = require('./perceptual_hash');
    const similarity = areSimilar(fp1.perceptualHash, fp2.perceptualHash);

    return {
      exactMatch,
      perceptualMatch: similarity.similar,
      similarity: similarity.similarity,
      hammingDistance: similarity.distance,
      fingerprints: { image1: fp1, image2: fp2 }
    };

  } catch (error) {
    throw new Error(`Image comparison failed: ${error.message}`);
  }
}

module.exports = {
  createImageFingerprint,
  createVideoFingerprint,
  verifyImageFingerprint,
  compareImages
};
