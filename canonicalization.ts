// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * TypeScript Reference Implementation
 * 
 * Clean, production-ready canonicalization functions
 * matching the pipeline specifications.
 */

import sharp from 'sharp';
import crypto from 'crypto';

// ============================================
// Pipeline Specifications
// ============================================

/**
 * img:v1 (Legacy)
 * Pipeline: exif-orient | srgb | png(cl0,palette0,prog0)
 * 
 * Steps:
 *   1. Apply EXIF orientation via rotate()
 *   2. Convert to sRGB color space
 *   3. Encode as PNG with compressionLevel 0, no palette, non-progressive
 * 
 * Notes: No resize ceiling, no alpha flattening
 * Purpose: Legacy behavior (matches earlier pipeline & hashes)
 */
export async function canonV1(buf: Buffer): Promise<Buffer> {
  return await sharp(buf)
    .rotate()                    // exif-orient
    .toColorspace('srgb')        // srgb
    .png({                       // png(cl0,palette0,prog0)
      compressionLevel: 0,
      palette: false,
      progressive: false
    })
    .toBuffer();
}

/**
 * img:v2 (Current)
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
 */
export async function canonV2(buf: Buffer): Promise<Buffer> {
  const img = sharp(buf).rotate();  // exif-orient
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const L = Math.max(w, h);
  const MAX = 2048;
  
  let p = img;
  
  // max2048: bound longest edge
  if (L > MAX) {
    const s = MAX / L;
    p = p.resize({
      width: Math.round(w * s),
      height: Math.round(h * s),
      fit: 'inside',
      withoutEnlargement: true
    });
  }
  
  // flatten-white: composite alpha on white if present
  if (meta.hasAlpha) {
    p = p.flatten({ background: { r: 255, g: 255, b: 255 } });
  }
  
  // srgb | png(cl9,palette0,prog0)
  return await p
    .toColorspace('srgb')
    .png({
      compressionLevel: 9,
      palette: false,
      progressive: false
    })
    .toBuffer();
}

// ============================================
// Versioning
// ============================================

export const CANON_VERSION_V1 = 'img:v1';
export const CANON_VERSION_V2 = 'img:v2';
export const CANON_VERSION_CURRENT = CANON_VERSION_V2;

export const PIPELINE_V1 = 'exif-orient|srgb|png(cl0,palette0,prog0)';
export const PIPELINE_V2 = 'exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)';

export type CanonVersion = typeof CANON_VERSION_V1 | typeof CANON_VERSION_V2;

/**
 * Get pipeline specification string for a version
 */
export function getPipelineSpec(version: CanonVersion): string {
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
 * Canonicalize with specific version
 */
export async function canonicalizeWithVersion(
  buf: Buffer,
  version: CanonVersion
): Promise<Buffer> {
  switch (version) {
    case CANON_VERSION_V1:
      return canonV1(buf);
    case CANON_VERSION_V2:
      return canonV2(buf);
    default:
      throw new Error(`Unknown canonicalization version: ${version}`);
  }
}

// ============================================
// Utilities
// ============================================

/**
 * Compute SHA-256 hash of buffer
 */
export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Create fingerprint with both V1 and V2 hashes (transition support)
 */
export async function createDualVersionFingerprint(buf: Buffer): Promise<{
  'img:v1': string;
  'img:v2': string;
  currentVersion: CanonVersion;
}> {
  const [v1Canonical, v2Canonical] = await Promise.all([
    canonV1(buf),
    canonV2(buf)
  ]);
  
  return {
    'img:v1': sha256(v1Canonical),
    'img:v2': sha256(v2Canonical),
    currentVersion: CANON_VERSION_CURRENT
  };
}

// ============================================
// Fingerprint Bundle Types
// ============================================

/**
 * Fingerprint bundle structure (normal mode - V2 only)
 */
export interface FingerprintBundle {
  sha256_canonical: string;
  algorithm: string;
  perceptualHash: string;
  canonicalization: string;
}

/**
 * Fingerprint bundle structure (transition mode - both versions)
 */
export interface FingerprintBundleTransition extends FingerprintBundle {
  ext: {
    alt_hashes: {
      'img:v1': string;
    };
  };
}

/**
 * Create complete fingerprint bundle
 */
export async function createFingerprint(
  buf: Buffer,
  options: {
    transitionMode?: boolean;
    perceptualHash?: string;
  } = {}
): Promise<FingerprintBundle | FingerprintBundleTransition> {
  const { transitionMode = false, perceptualHash = 'phash:placeholder' } = options;
  
  if (transitionMode) {
    const dual = await createDualVersionFingerprint(buf);
    
    return {
      sha256_canonical: dual['img:v2'],
      algorithm: 'sha256+phash',
      perceptualHash,
      canonicalization: getPipelineSpec(CANON_VERSION_V2),
      ext: {
        alt_hashes: {
          'img:v1': dual['img:v1']
        }
      }
    };
  } else {
    const canonical = await canonV2(buf);
    
    return {
      sha256_canonical: sha256(canonical),
      algorithm: 'sha256+phash',
      perceptualHash,
      canonicalization: getPipelineSpec(CANON_VERSION_V2)
    };
  }
}

// ============================================
// Verification
// ============================================

/**
 * Verify image against versioned hash
 */
export async function verifyVersionedHash(
  buf: Buffer,
  expectedHash: string,
  version: CanonVersion
): Promise<boolean> {
  const canonical = await canonicalizeWithVersion(buf, version);
  const actualHash = sha256(canonical);
  return actualHash === expectedHash;
}

/**
 * Verify image against fingerprint bundle (supports all structures)
 */
export async function verifyFingerprint(
  buf: Buffer,
  fingerprint: FingerprintBundle | FingerprintBundleTransition | any
): Promise<{
  verified: boolean;
  matchedVersion: CanonVersion | null;
  v1Match: boolean;
  v2Match: boolean;
}> {
  const result = {
    verified: false,
    matchedVersion: null as CanonVersion | null,
    v1Match: false,
    v2Match: false
  };
  
  // Try V2 first (current version)
  if (fingerprint.sha256_canonical) {
    result.v2Match = await verifyVersionedHash(
      buf,
      fingerprint.sha256_canonical,
      CANON_VERSION_V2
    );
    
    if (result.v2Match) {
      result.verified = true;
      result.matchedVersion = CANON_VERSION_V2;
      return result;
    }
  }
  
  // Try V1 (check multiple possible locations)
  let v1Hash: string | undefined;
  
  // New structure: ext.alt_hashes['img:v1']
  if (fingerprint.ext?.alt_hashes?.['img:v1']) {
    v1Hash = fingerprint.ext.alt_hashes['img:v1'];
  }
  // Transition structure: sha256_canonical_v1
  else if (fingerprint.sha256_canonical_v1) {
    v1Hash = fingerprint.sha256_canonical_v1;
  }
  // Legacy structure: assume sha256_canonical is v1 if no version indicator
  else if (!fingerprint.canonicalization && !fingerprint.canonVersion) {
    v1Hash = fingerprint.sha256_canonical;
  }
  
  if (v1Hash) {
    result.v1Match = await verifyVersionedHash(buf, v1Hash, CANON_VERSION_V1);
    
    if (result.v1Match) {
      result.verified = true;
      result.matchedVersion = CANON_VERSION_V1;
    }
  }
  
  return result;
}

// ============================================
// Example Usage
// ============================================

/*
import { canonV2, createFingerprint, verifyFingerprint } from './canonicalization';
import fs from 'fs';

// Example 1: Basic canonicalization
const imageBuffer = fs.readFileSync('./image.jpg');
const canonical = await canonV2(imageBuffer);
const hash = sha256(canonical);
console.log('SHA-256:', hash);

// Example 2: Create fingerprint (normal mode)
const fp = await createFingerprint(imageBuffer);
console.log(fp);
// {
//   sha256_canonical: "a1b2c3...",
//   algorithm: "sha256+phash",
//   perceptualHash: "phash:...",
//   canonicalization: "img:v2:exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)"
// }

// Example 3: Create fingerprint (transition mode)
const fpTransition = await createFingerprint(imageBuffer, { transitionMode: true });
console.log(fpTransition);
// {
//   sha256_canonical: "a1b2c3...",
//   algorithm: "sha256+phash",
//   perceptualHash: "phash:...",
//   canonicalization: "img:v2:exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)",
//   ext: {
//     alt_hashes: {
//       "img:v1": "x7y8z9..."
//     }
//   }
// }

// Example 4: Verify image
const result = await verifyFingerprint(imageBuffer, fp);
console.log('Verified:', result.verified);
console.log('Matched version:', result.matchedVersion);
*/
