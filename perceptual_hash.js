// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * Perceptual Hash (pHash) Implementation
 * 
 * Computes DCT-based perceptual hashes for images.
 * These hashes are resilient to:
 * - Minor edits
 * - Compression artifacts
 * - Scaling/resizing
 * - Color adjustments
 * 
 * Based on the pHash algorithm by Christoph Zauner.
 */

const sharp = require('sharp');
const crypto = require('crypto');

/**
 * Compute DCT-based perceptual hash
 * 
 * Algorithm:
 * 1. Resize to 32x32 grayscale
 * 2. Apply Discrete Cosine Transform (DCT)
 * 3. Extract low-frequency 8x8 DCT coefficients
 * 4. Compute median of coefficients
 * 5. Create 64-bit hash (each bit = above/below median)
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @param {Object} options - Hash options
 * @returns {Promise<string>} Perceptual hash (phash:hexstring format)
 */
async function computePerceptualHash(input, options = {}) {
  const defaults = {
    size: 32,        // Resize to 32x32 before DCT
    hashSize: 8,     // Extract 8x8 DCT coefficients = 64-bit hash
    format: 'hex'    // Output format: 'hex', 'binary', 'decimal'
  };

  const config = { ...defaults, ...options };

  try {
    // Step 1: Convert to grayscale and resize
    const resized = await sharp(input)
      .resize(config.size, config.size, {
        fit: 'fill',
        kernel: 'lanczos3'
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8Array(resized.data);
    const width = resized.info.width;
    const height = resized.info.height;

    // Step 2: Apply DCT (Discrete Cosine Transform)
    const dctCoeffs = applyDCT2D(pixels, width, height);

    // Step 3: Extract low-frequency 8x8 block (top-left corner)
    const lowFreq = extractLowFrequency(dctCoeffs, config.hashSize);

    // Step 4: Compute median (excluding DC component at [0,0])
    const median = computeMedian(lowFreq.slice(1)); // Skip DC coefficient

    // Step 5: Create binary hash (1 if > median, 0 otherwise)
    const hashBits = lowFreq.map(coeff => coeff > median ? 1 : 0);

    // Convert to hex string
    const hashHex = bitsToHex(hashBits);

    return `phash:${hashHex}`;

  } catch (error) {
    throw new Error(`Perceptual hash computation failed: ${error.message}`);
  }
}

/**
 * Apply 2D Discrete Cosine Transform
 * Simplified DCT implementation for perceptual hashing
 * 
 * @param {Uint8Array} pixels - Grayscale pixel values
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float64Array} DCT coefficients
 */
function applyDCT2D(pixels, width, height) {
  const dct = new Float64Array(width * height);
  
  for (let u = 0; u < height; u++) {
    for (let v = 0; v < width; v++) {
      let sum = 0;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixel = pixels[y * width + x];
          const cosX = Math.cos(((2 * x + 1) * v * Math.PI) / (2 * width));
          const cosY = Math.cos(((2 * y + 1) * u * Math.PI) / (2 * height));
          sum += pixel * cosX * cosY;
        }
      }
      
      // Apply normalization coefficients
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      
      dct[u * width + v] = (cu * cv / 4) * sum;
    }
  }
  
  return dct;
}

/**
 * Extract low-frequency DCT coefficients
 * 
 * @param {Float64Array} dct - Full DCT coefficients
 * @param {number} size - Size of block to extract (8x8 = 64 coefficients)
 * @returns {Array<number>} Low-frequency coefficients
 */
function extractLowFrequency(dct, size) {
  const lowFreq = [];
  const width = Math.sqrt(dct.length);
  
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      lowFreq.push(dct[i * width + j]);
    }
  }
  
  return lowFreq;
}

/**
 * Compute median of an array
 * 
 * @param {Array<number>} values - Array of numbers
 * @returns {number} Median value
 */
function computeMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

/**
 * Convert bit array to hexadecimal string
 * 
 * @param {Array<number>} bits - Array of 0s and 1s
 * @returns {string} Hex string
 */
function bitsToHex(bits) {
  let hex = '';
  
  // Process 4 bits at a time to make hex digits
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = 
      (bits[i] << 3) | 
      (bits[i + 1] << 2) | 
      (bits[i + 2] << 1) | 
      bits[i + 3];
    hex += nibble.toString(16);
  }
  
  return hex;
}

/**
 * Compute Hamming distance between two perceptual hashes
 * Lower distance = more similar images
 * 
 * @param {string} hash1 - First hash (phash:hex format)
 * @param {string} hash2 - Second hash (phash:hex format)
 * @returns {number} Hamming distance (0-64)
 */
function hammingDistance(hash1, hash2) {
  // Strip "phash:" prefix
  const hex1 = hash1.replace('phash:', '');
  const hex2 = hash2.replace('phash:', '');
  
  if (hex1.length !== hex2.length) {
    throw new Error('Hashes must be the same length');
  }
  
  let distance = 0;
  
  for (let i = 0; i < hex1.length; i++) {
    const nibble1 = parseInt(hex1[i], 16);
    const nibble2 = parseInt(hex2[i], 16);
    const xor = nibble1 ^ nibble2;
    
    // Count set bits in XOR result
    distance += countSetBits(xor);
  }
  
  return distance;
}

/**
 * Count number of set bits in a number
 * 
 * @param {number} n - Number to count
 * @returns {number} Number of 1 bits
 */
function countSetBits(n) {
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

/**
 * Check if two images are similar based on perceptual hash
 * 
 * @param {string} hash1 - First hash
 * @param {string} hash2 - Second hash
 * @param {number} threshold - Max Hamming distance for similarity (default: 10)
 * @returns {Object} Similarity result
 */
function areSimilar(hash1, hash2, threshold = 10) {
  const distance = hammingDistance(hash1, hash2);
  const maxDistance = 64; // 64-bit hash
  const similarity = ((maxDistance - distance) / maxDistance) * 100;
  
  return {
    similar: distance <= threshold,
    distance: distance,
    similarity: similarity.toFixed(2) + '%',
    threshold: threshold
  };
}

/**
 * Compute average hash (simpler, faster alternative to pHash)
 * Less accurate but much faster
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<string>} Average hash
 */
async function computeAverageHash(input) {
  try {
    const resized = await sharp(input)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const pixels = new Uint8Array(resized);
    
    // Compute average pixel value
    const sum = pixels.reduce((acc, val) => acc + val, 0);
    const avg = sum / pixels.length;
    
    // Create hash: 1 if pixel > average, 0 otherwise
    const bits = Array.from(pixels).map(p => p > avg ? 1 : 0);
    const hex = bitsToHex(bits);
    
    return `ahash:${hex}`;

  } catch (error) {
    throw new Error(`Average hash computation failed: ${error.message}`);
  }
}

/**
 * Compute difference hash (another fast alternative)
 * Compares adjacent pixels
 * 
 * @param {Buffer|string} input - Image buffer or file path
 * @returns {Promise<string>} Difference hash
 */
async function computeDifferenceHash(input) {
  try {
    const resized = await sharp(input)
      .resize(9, 8, { fit: 'fill' }) // 9x8 for 8x8 comparisons
      .grayscale()
      .raw()
      .toBuffer();

    const pixels = new Uint8Array(resized);
    const bits = [];
    
    // Compare each pixel with its right neighbor
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const current = pixels[y * 9 + x];
        const next = pixels[y * 9 + x + 1];
        bits.push(current < next ? 1 : 0);
      }
    }
    
    const hex = bitsToHex(bits);
    return `dhash:${hex}`;

  } catch (error) {
    throw new Error(`Difference hash computation failed: ${error.message}`);
  }
}

module.exports = {
  computePerceptualHash,
  computeAverageHash,
  computeDifferenceHash,
  hammingDistance,
  areSimilar
};
