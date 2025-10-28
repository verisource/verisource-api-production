// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * Verisource Canonicalization Implementation
 * 
 * "Verisource records the canonicalization recipe used for each asset 
 * (e.g., img:v1, img:v2), so we can improve quality without breaking 
 * old proofs. Verifiers accept both during and after transitions."
 */

import sharp from 'sharp';
import { createHash } from 'crypto';

// ============================================
// Version Specifications
// ============================================

/**
 * img:v1 — exif-orient|srgb|png(cl0,palette0,prog0)
 * Legacy canonicalization; no resize ceiling; no alpha flatten.
 */
export async function canonV1(inputBytes: Buffer): Promise<Buffer> {
  return await sharp(inputBytes)
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
 * img:v2 — exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)
 * Improved stability; resize ceiling to 2048; alpha composited to white; deterministic PNG.
 */
export async function canonV2(inputBytes: Buffer): Promise<Buffer> {
  const img = sharp(inputBytes).rotate();  // exif-orient
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const L = Math.max(w, h);
  const MAX = 2048;
  
  let p = img;
  
  // max2048
  if (L > MAX) {
    const s = MAX / L;
    p = p.resize({
      width: Math.round(w * s),
      height: Math.round(h * s),
      fit: 'inside',
      withoutEnlargement: true
    });
  }
  
  // flatten-white
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
// Utilities
// ============================================

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Compute perceptual hash (placeholder - integrate your pHash implementation)
 */
async function pHashHex(bytes: Buffer): Promise<string> {
  // TODO: Replace with your actual perceptual hash implementation
  return 'phash:' + sha256(bytes).substring(0, 16);
}

// ============================================
// Credential Creation
// ============================================

export interface FingerprintBundle {
  sha256_canonical: string;
  algorithm: string;
  perceptualHash: string;
  canonicalization: string;
}

export interface CredentialExt {
  alt_hashes: {
    'img:v1': string;
  };
  [key: string]: any;
}

export interface Credential {
  fingerprintBundle: FingerprintBundle;
  ext: CredentialExt;
  [key: string]: any;
}

/**
 * Create credential with versioned canonicalization
 * 
 * @param inputBytes - Original image buffer
 * @param ext - Additional extension fields (optional)
 * @returns Credential object with fingerprint bundle
 */
export async function createCredential(
  inputBytes: Buffer,
  ext?: Record<string, any>
): Promise<Credential> {
  const v1Bytes = await canonV1(inputBytes);
  const v2Bytes = await canonV2(inputBytes);
  
  const credential: Credential = {
    // ...your fields...
    fingerprintBundle: {
      sha256_canonical: sha256(v2Bytes),
      algorithm: 'sha256+phash',
      perceptualHash: await pHashHex(v2Bytes),
      canonicalization: 'img:v2:exif-orient|srgb|max2048|flatten-white|png(cl9,palette0,prog0)'
    },
    ext: {
      ...(ext || {}),
      alt_hashes: { 'img:v1': sha256(v1Bytes) }
    }
  };
  
  return credential;
}

// ============================================
// Hash Extraction
// ============================================

interface PickedHashes {
  v2: string | null;
  v1: string | null;
  phash: string | null;
}

/**
 * Fast path logic: extract hashes from credential
 * 
 * 1. Read fingerprintBundle.canonicalization
 * 2. If it starts with img:v2, compare against v2 hash
 * 3. If candidate presents only a legacy v1 hash, look in ext.alt_hashes["img:v1"]
 * 4. If exact fails, fall back to pHash thresholds
 */
export function pickHashes(cred: Credential): PickedHashes {
  const fb = cred.fingerprintBundle || {} as FingerprintBundle;
  const v2 = (fb.canonicalization || '').startsWith('img:v2') 
    ? fb.sha256_canonical 
    : null;
  const v1 = cred.ext?.alt_hashes?.['img:v1'] || null;
  return { v2, v1, phash: fb.perceptualHash };
}

// ============================================
// Verification
// ============================================

export enum VerificationResult {
  PROVEN_EXACT = 'PROVEN_EXACT',
  PROVEN_DERIVED = 'PROVEN_DERIVED',
  INCONCLUSIVE = 'INCONCLUSIVE',
  NOT_PROVEN = 'NOT_PROVEN'
}

interface VerificationOutcome {
  result: VerificationResult;
  matchedVersion: 'img:v1' | 'img:v2' | null;
  details: {
    v2Match?: boolean;
    v1Match?: boolean;
    phashSimilarity?: number;
    hammingDistance?: number;
  };
}

/**
 * Compare candidate image against credential
 * 
 * @param candidateBytes - Candidate image buffer
 * @param credential - Credential to verify against
 * @param phashThreshold - Hamming distance threshold for pHash (default: 10)
 * @returns Verification outcome
 */
export async function compareCandidate(
  candidateBytes: Buffer,
  credential: Credential,
  phashThreshold: number = 10
): Promise<VerificationOutcome> {
  const hashes = pickHashes(credential);
  const outcome: VerificationOutcome = {
    result: VerificationResult.NOT_PROVEN,
    matchedVersion: null,
    details: {}
  };
  
  // Try V2 exact match first
  if (hashes.v2) {
    const candidateV2 = await canonV2(candidateBytes);
    const candidateV2Hash = sha256(candidateV2);
    outcome.details.v2Match = candidateV2Hash === hashes.v2;
    
    if (outcome.details.v2Match) {
      outcome.result = VerificationResult.PROVEN_EXACT;
      outcome.matchedVersion = 'img:v2';
      return outcome;
    }
  }
  
  // Try V1 exact match (legacy)
  if (hashes.v1) {
    const candidateV1 = await canonV1(candidateBytes);
    const candidateV1Hash = sha256(candidateV1);
    outcome.details.v1Match = candidateV1Hash === hashes.v1;
    
    if (outcome.details.v1Match) {
      outcome.result = VerificationResult.PROVEN_EXACT;
      outcome.matchedVersion = 'img:v1';
      return outcome;
    }
  }
  
  // Fall back to pHash thresholds
  if (hashes.phash) {
    const candidateV2 = await canonV2(candidateBytes);
    const candidatePHash = await pHashHex(candidateV2);
    
    // Calculate Hamming distance (TODO: implement actual Hamming distance)
    const hammingDistance = calculateHammingDistance(candidatePHash, hashes.phash);
    outcome.details.hammingDistance = hammingDistance;
    outcome.details.phashSimilarity = ((64 - hammingDistance) / 64) * 100;
    
    if (hammingDistance <= phashThreshold) {
      outcome.result = VerificationResult.PROVEN_DERIVED;
      outcome.matchedVersion = 'img:v2';
    } else if (hammingDistance <= phashThreshold * 1.5) {
      outcome.result = VerificationResult.INCONCLUSIVE;
    } else {
      outcome.result = VerificationResult.NOT_PROVEN;
    }
  }
  
  return outcome;
}

/**
 * Calculate Hamming distance between two perceptual hashes
 * TODO: Replace with your actual implementation
 */
function calculateHammingDistance(hash1: string, hash2: string): number {
  // Placeholder implementation
  const h1 = hash1.replace('phash:', '');
  const h2 = hash2.replace('phash:', '');
  
  let distance = 0;
  for (let i = 0; i < Math.min(h1.length, h2.length); i++) {
    const nibble1 = parseInt(h1[i], 16);
    const nibble2 = parseInt(h2[i], 16);
    const xor = nibble1 ^ nibble2;
    distance += countSetBits(xor);
  }
  return distance;
}

function countSetBits(n: number): number {
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

// ============================================
// CI Guardrails
// ============================================

/**
 * CI Guardrail: Determinism test
 * 
 * Canonicalize the same input twice → bytes must match; hash must match.
 */
export async function testDeterminism(
  inputBytes: Buffer,
  version: 'v1' | 'v2'
): Promise<{ passed: boolean; error?: string }> {
  try {
    const canonFn = version === 'v1' ? canonV1 : canonV2;
    
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
      error: `${version} determinism test failed: ${error}` 
    };
  }
}

/**
 * CI Guardrail: Golden parity test (for v1 only)
 * 
 * Hash on goldens/ equals stored known-good hashes.
 */
export async function testGoldenParity(
  goldenBytes: Buffer,
  expectedV1Hash: string
): Promise<{ passed: boolean; error?: string }> {
  try {
    const v1Bytes = await canonV1(goldenBytes);
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
      error: `v1 golden parity test failed: ${error}`
    };
  }
}

/**
 * CI Guardrail: Drift alert
 * 
 * Fail CI if a lib upgrade changes v2 hashes on goldens/
 */
export async function testNoDrift(
  goldenBytes: Buffer,
  expectedV2Hash: string
): Promise<{ passed: boolean; error?: string; actualHash?: string }> {
  try {
    const v2Bytes = await canonV2(goldenBytes);
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
      error: `v2 drift test failed: ${error}`
    };
  }
}

/**
 * Run all CI guardrails
 */
export async function runCIGuardrails(
  testImageBytes: Buffer,
  goldens: Array<{ bytes: Buffer; v1Hash: string; v2Hash: string }>
): Promise<{ passed: boolean; results: any[] }> {
  const results: any[] = [];
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

// ============================================
// Example Usage
// ============================================

/*
import fs from 'fs';

// Example 1: Create credential
const imageBuffer = fs.readFileSync('./photo.jpg');
const credential = await createCredential(imageBuffer);
console.log(credential);

// Example 2: Verify candidate
const candidateBuffer = fs.readFileSync('./candidate.jpg');
const outcome = await compareCandidate(candidateBuffer, credential);
console.log(outcome.result);  // PROVEN_EXACT | PROVEN_DERIVED | INCONCLUSIVE | NOT_PROVEN

// Example 3: CI guardrails
const testImage = fs.readFileSync('./test.jpg');
const goldens = [
  {
    bytes: fs.readFileSync('./goldens/image1.jpg'),
    v1Hash: 'abc123...',
    v2Hash: 'def456...'
  }
];
const ciResults = await runCIGuardrails(testImage, goldens);
if (!ciResults.passed) {
  console.error('CI guardrails failed!');
  console.error(ciResults.results);
  process.exit(1);
}
*/
