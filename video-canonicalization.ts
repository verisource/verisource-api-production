// Copyright (c) 2025 [Your Name]
// SPDX-License-Identifier: MIT

/**
 * Video Canonicalization for Content Origin Credentials
 * 
 * Version: vid:v1:srgb|max720|fps15.000|resize-lanczos3|rgb8
 * 
 * Pipeline:
 * 1. Demux & decode (visual only) - drop audio
 * 2. Normalize geometry - max 720px, keep aspect, Lanczos3
 * 3. Normalize temporal - resample to 15.000 fps
 * 4. Keyframe baseline - treat every frame as canonical
 * 5. Packaging - work in memory (or PNG sequence for tests)
 */

import sharp from 'sharp';
import { createHash } from 'crypto';
import * as ffmpeg from 'fluent-ffmpeg';
import { blake3 } from 'blake3';

// ============================================
// Version Specification
// ============================================

export const VIDEO_VERSION_V1 = 'vid:v1';
export const VIDEO_PIPELINE_V1 = 'deint=yadif|bt709|full|rgb24|max720|fps15.000|resize=lanczos3';

/**
 * vid:v1 — deint=yadif|bt709|full|rgb24|max720|fps15.000|resize=lanczos3
 * 
 * Complete pin of pixel pipeline:
 * 1. Deinterlace: yadif=mode=send_frame:parity=auto:deint=all
 * 2. Color matrix/range: force BT.709, full range
 * 3. Gamma/transfer: sRGB/BT.1886 equivalent
 * 4. Chroma→RGB: at decode time
 * 5. Pixel format: rgb24 (8-bit)
 * 6. Geometry: longest side max 720px, keep aspect ratio, no crop/pad
 * 7. Resize: Lanczos3
 * 8. Temporal: exact 15.000 fps (VFR→CFR, nearest timestamp)
 * 
 * HDR/wide-gamut: BT.709 target; accurate HDR tone-map deferred to vid:v2
 * Frame timing: duplicate or drop to nearest 15.000 grid, vsync=0
 * 
 * Version string reflects EXACT pixel pipeline for reproducibility.
 */
export function getVideoPipelineSpec(): string {
  return `${VIDEO_VERSION_V1}:${VIDEO_PIPELINE_V1}`;
}

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Geometry
  MAX_SIDE: 720,
  
  // Temporal
  TARGET_FPS: 15.0,  // Exact 15.000 fps
  
  // Windowing
  SEGMENT_LENGTH: 1.0,  // 1.0 second per segment
  FRAMES_PER_SEGMENT: 15,  // 15 frames at 15 fps
  STRIDE: 1.0,  // Non-overlapping (same as segment length)
  
  // Perceptual Hash
  PHASH_SIZE: 32,  // 32x32 for perceptual hash
  PHASH_DCT_SIZE: 8,  // 8x8 DCT = 64-bit hash
  
  // Segment Hash (full 128 bits for collision safety in v1)
  SEGMENT_HASH_LENGTH: 32,  // 32 hex chars (128 bits)
  
  // Security/Safety Limits
  MAX_DURATION_SECONDS: 300,  // 5 minutes
  MAX_FILE_SIZE_MB: 250,  // 250 MB
  PROCESSING_TIMEOUT_MS: 600000,  // 10 minutes
  
  // Matching Thresholds
  THRESHOLDS: {
    // Frame pHash Hamming distance
    FRAME_MATCH: 8,  // ≤ 8 bits = match
    FRAME_WEAK: 16,  // 9-16 bits = weak match
    
    // Segment fallback (per-frame matching)
    SEGMENT_FRAME_MAJORITY: 10,  // ≥ 10/15 frames matched
    
    // Coverage verdicts
    PROVEN_STRONG: 1.0,      // 100% segments OR ≥98% + no mismatched runs
    PROVEN_STRONG_MIN: 0.98, // Minimum for PROVEN_STRONG with no mismatches
    PROVEN_DERIVED: 0.8,     // ≥80% coverage
    INCONCLUSIVE: 0.3        // 30-79% coverage
  }
};

// ============================================
// Types
// ============================================

export interface FrameInfo {
  index: number;
  timestamp: number;
  buffer: Buffer;
}

// ============================================
// Frame Extraction
// ============================================

/**
 * Extract frames from video using ffmpeg with pinned pixel pipeline
 * 
 * Complete pipeline:
 * 1. Deinterlace: yadif (send_frame mode, auto parity, all frames)
 * 2. Scale: Lanczos3, longest side max 720px, keep aspect
 * 3. Colorspace: BT.709, full range
 * 4. FPS: exact 15.000 (VFR→CFR, nearest timestamp)
 * 5. Format: rgb24 (8-bit RGB)
 * 
 * Security limits enforced:
 * - Max duration: 5 minutes
 * - Max file size: 250 MB
 * - Processing timeout: 10 minutes
 * 
 * @param videoPath - Path to video file
 * @param options - Extraction options
 * @returns Promise<FrameInfo[]> - Array of frame buffers with metadata
 */
export async function extractFrames(
  videoPath: string,
  options: {
    maxSide?: number;
    targetFps?: number;
    outputDir?: string;
    enforceSecurityLimits?: boolean;
  } = {}
): Promise<FrameInfo[]> {
  const maxSide = options.maxSide || CONFIG.MAX_SIDE;
  const targetFps = options.targetFps || CONFIG.TARGET_FPS;
  const enforceSecurityLimits = options.enforceSecurityLimits !== false;
  
  // Security check: file size
  if (enforceSecurityLimits) {
    const stats = await fs.promises.stat(videoPath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > CONFIG.MAX_FILE_SIZE_MB) {
      throw new Error(
        `File too large: ${sizeMB.toFixed(1)}MB > ${CONFIG.MAX_FILE_SIZE_MB}MB limit`
      );
    }
  }
  
  return new Promise((resolve, reject) => {
    const frames: FrameInfo[] = [];
    const startTime = Date.now();
    
    // FFmpeg command with pinned pixel pipeline
    // 
    // ffmpeg -hide_banner -nostdin -y -i INPUT \
    //   -map 0:v:0 -an \
    //   -vf "yadif=mode=send_frame:parity=auto:deint=all,\
    //        scale='if(gt(iw,ih),min(iw,720),-1)':'if(gt(ih,iw),min(ih,720),-1)':flags=lanczos,\
    //        colorspace=all=bt709:iall=bt709:fast=1,\
    //        fps=15,format=rgb24" \
    //   -vsync 0 -f image2pipe -vcodec rawvideo -pix_fmt rgb24 -
    
    const videoFilters = [
      // 1. Deinterlace (cheap, handles interlaced sources)
      'yadif=mode=send_frame:parity=auto:deint=all',
      
      // 2. Scale (Lanczos3, longest side max 720px, keep aspect, no pad/crop)
      `scale='if(gt(iw,ih),min(iw,${maxSide}),-1)':'if(gt(ih,iw),min(ih,${maxSide}),-1)':flags=lanczos`,
      
      // 3. Colorspace (force BT.709, full range)
      'colorspace=all=bt709:iall=bt709:fast=1',
      
      // 4. FPS (exact 15.000, VFR→CFR nearest timestamp)
      `fps=${targetFps}`,
      
      // 5. Format (rgb24 = 8-bit RGB)
      'format=rgb24'
    ];
    
    const command = ffmpeg(videoPath)
      .inputOptions(['-hide_banner', '-nostdin'])
      .outputOptions([
        '-map', '0:v:0',  // First video stream only
        '-an',            // Drop audio
        '-vf', videoFilters.join(','),
        '-vsync', '0',    // Don't invent extra frames
        '-f', 'image2pipe',
        '-vcodec', 'rawvideo',
        '-pix_fmt', 'rgb24'
      ]);
    
    // Security: enforce timeout
    if (enforceSecurityLimits) {
      setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error(
          `Processing timeout exceeded ${CONFIG.PROCESSING_TIMEOUT_MS / 1000}s`
        ));
      }, CONFIG.PROCESSING_TIMEOUT_MS);
    }
    
    if (options.outputDir) {
      // For testing: save as PNG sequence
      command
        .output(`${options.outputDir}/%06d.png`)
        .outputOptions(['-compression_level', '0'])  // Deterministic
        .on('end', () => resolve(frames))
        .on('error', reject)
        .run();
    } else {
      // In-memory processing (read raw RGB frames from stdout)
      command
        .pipe()
        .on('data', (chunk: Buffer) => {
          // Security: enforce duration limit
          const frameIndex = frames.length;
          const timestamp = frameIndex / targetFps;
          
          if (enforceSecurityLimits && timestamp > CONFIG.MAX_DURATION_SECONDS) {
            command.kill('SIGKILL');
            reject(new Error(
              `Video duration exceeds ${CONFIG.MAX_DURATION_SECONDS}s limit`
            ));
            return;
          }
          
          frames.push({
            index: frameIndex,
            timestamp,
            buffer: chunk
          });
        })
        .on('end', () => resolve(frames))
        .on('error', reject);
    }
  });
}

// ============================================
// Perceptual Hash (per-frame)
// ============================================

/**
 * Compute DCT-based perceptual hash for a single frame
 * 
 * @param frameBuffer - Raw RGB frame buffer
 * @param width - Frame width
 * @param height - Frame height
 * @returns Promise<string> - Perceptual hash (phash:16hex)
 */
export async function computeFramePHash(
  frameBuffer: Buffer,
  width: number,
  height: number
): Promise<string> {
  try {
    // Convert to 32x32 grayscale
    const resized = await sharp(frameBuffer, {
      raw: {
        width,
        height,
        channels: 3
      }
    })
      .resize(CONFIG.PHASH_SIZE, CONFIG.PHASH_SIZE, {
        fit: 'fill',
        kernel: 'lanczos3'
      })
      .grayscale()
      .raw()
      .toBuffer();
    
    // Apply DCT and extract hash
    const dctCoeffs = applyDCT2D(
      new Uint8Array(resized),
      CONFIG.PHASH_SIZE,
      CONFIG.PHASH_SIZE
    );
    
    const lowFreq = extractLowFrequency(dctCoeffs, CONFIG.PHASH_DCT_SIZE);
    const median = computeMedian(lowFreq.slice(1)); // Skip DC coefficient
    
    const hashBits = lowFreq.map(coeff => coeff > median ? 1 : 0);
    const hashHex = bitsToHex(hashBits);
    
    return `phash:${hashHex}`;
    
  } catch (error) {
    throw new Error(`Frame pHash computation failed: ${error}`);
  }
}

/**
 * Apply 2D Discrete Cosine Transform
 */
function applyDCT2D(pixels: Uint8Array, width: number, height: number): Float64Array {
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
      
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      
      dct[u * width + v] = (cu * cv / 4) * sum;
    }
  }
  
  return dct;
}

function extractLowFrequency(dct: Float64Array, size: number): number[] {
  const lowFreq: number[] = [];
  const width = Math.sqrt(dct.length);
  
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      lowFreq.push(dct[i * width + j]);
    }
  }
  
  return lowFreq;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bitsToHex(bits: number[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

// ============================================
// Segment Hashing
// ============================================

/**
 * Compute segment hash from per-frame pHashes
 * 
 * Windowing:
 * - Segment length: 1.0s (15 frames at 15 fps)
 * - Stride: 1.0s (non-overlapping)
 * 
 * Hashing:
 * - Concatenate 15 per-frame pHashes
 * - Compute BLAKE3 hash
 * - Use full 32 hex (128 bits) for collision safety in v1
 * 
 * @param framePHashes - Array of 15 per-frame pHashes
 * @param segmentIndex - Segment index (for labeling)
 * @returns string - Segment hash (seg_<index>:<32hex>)
 */
export function computeSegmentHash(
  framePHashes: string[],
  segmentIndex: number
): string {
  if (framePHashes.length !== CONFIG.FRAMES_PER_SEGMENT) {
    throw new Error(
      `Expected ${CONFIG.FRAMES_PER_SEGMENT} frames, got ${framePHashes.length}`
    );
  }
  
  // Concatenate the 15 per-frame pHashes
  const concatenated = framePHashes.join('');
  
  // Compute BLAKE3 hash
  const hash = blake3(Buffer.from(concatenated, 'utf8'));
  const hexHash = hash.toString('hex');
  
  // Take first 32 hex chars (128 bits) for collision safety
  const segmentHash = hexHash.substring(0, CONFIG.SEGMENT_HASH_LENGTH);
  
  return `seg_${segmentIndex}:${segmentHash}`;
}

/**
 * Process video into segment hashes
 * 
 * For each second s:
 *   frames = get15FramesAt15fps(s)
 *   hashes = frames.map(pHash32x32)
 *   segHash = blake3(concat(hashes)) // hex16
 *   emit seg_${s}:${segHash.substr(0,16)}
 * 
 * @param videoPath - Path to video file
 * @returns Promise<string[]> - Array of segment hashes
 */
export async function processVideoSegments(videoPath: string): Promise<string[]> {
  // Extract frames at 15 fps
  const frames = await extractFrames(videoPath);
  
  if (frames.length === 0) {
    throw new Error('No frames extracted from video');
  }
  
  // Get frame dimensions (assume consistent)
  const firstFrame = frames[0];
  const metadata = await sharp(firstFrame.buffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  
  // Compute pHash for each frame
  const framePHashes: string[] = [];
  for (const frame of frames) {
    const pHash = await computeFramePHash(frame.buffer, width, height);
    framePHashes.push(pHash);
  }
  
  // Segment into 1-second windows (15 frames each)
  const segmentHashes: string[] = [];
  const totalSegments = Math.floor(framePHashes.length / CONFIG.FRAMES_PER_SEGMENT);
  
  for (let i = 0; i < totalSegments; i++) {
    const start = i * CONFIG.FRAMES_PER_SEGMENT;
    const end = start + CONFIG.FRAMES_PER_SEGMENT;
    const segmentFrames = framePHashes.slice(start, end);
    
    const segHash = computeSegmentHash(segmentFrames, i);
    segmentHashes.push(segHash);
  }
  
  return segmentHashes;
}

// ============================================
// Credential Creation
// ============================================

export interface VideoFingerprintBundle {
  algorithm: string;
  segmentHashes: string[];
  canonicalization: string;
  sha256_canonical?: string;  // Optional if you persist deterministic sequence
}

/**
 * Create video fingerprint bundle
 * 
 * @param videoPath - Path to video file
 * @param options - Options
 * @returns Promise<VideoFingerprintBundle>
 */
export async function createVideoFingerprint(
  videoPath: string,
  options: {
    includeCanonicalSHA256?: boolean;
  } = {}
): Promise<VideoFingerprintBundle> {
  const segmentHashes = await processVideoSegments(videoPath);
  
  const bundle: VideoFingerprintBundle = {
    algorithm: 'sha256+segphash',
    segmentHashes,
    canonicalization: getVideoPipelineSpec()
  };
  
  // Optional: compute SHA-256 of deterministic sequence
  if (options.includeCanonicalSHA256) {
    // Would require persisting frames as deterministic PNG sequence
    // and computing SHA-256 of the concatenated sequence
    // bundle.sha256_canonical = await computeCanonicalSHA256(videoPath);
  }
  
  return bundle;
}

// ============================================
// Verification
// ============================================

export enum VideoVerificationResult {
  PROVEN_STRONG = 'PROVEN_STRONG',
  PROVEN_DERIVED = 'PROVEN_DERIVED',
  INCONCLUSIVE = 'INCONCLUSIVE',
  NOT_PROVEN = 'NOT_PROVEN'
}

export interface MismatchInfo {
  segmentIndex: number;
  expectedHash: string;
  actualHash: string;
  frameMatches?: number;  // If fallback matching performed
}

export interface VideoVerificationOutcome {
  verdict: VideoVerificationResult;
  coverage: number;  // Percentage (0-100)
  segmentsMatched: number;
  segmentsTotal: number;
  canonicalization: string;
  
  // Evidence payload (explainability)
  matchedRanges: Array<[number, number]>;  // Contiguous matched segment ranges
  firstMismatches: MismatchInfo[];  // First N mismatches for review
  
  notes: string[];  // Processing notes (VFR→CFR, de-interlaced, etc.)
  warnings: string[];  // Quality warnings
  
  details: {
    segmentMatches: boolean[];
    frameMatches?: number[];  // Per-segment frame match counts (if fallback used)
    hasMismatchedRuns?: boolean;  // True if there are runs of mismatches
  };
}

/**
 * Verify candidate video against fingerprint bundle
 * 
 * Verifier logic (visual only, vid:v1):
 * 1. Check fingerprintBundle.canonicalization starts with vid:v1:...
 * 2. Canonicalize candidate to vid:v1
 * 3. Recompute segmentHashes
 * 4. Coverage = matchedSegments / totalSegments
 * 5. Verdict:
 *    - PROVEN_STRONG: 100% segments OR ≥98% + no mismatched runs
 *    - PROVEN_DERIVED: ≥80% coverage
 *    - INCONCLUSIVE: 30-79% coverage
 *    - NOT_PROVEN: <30% coverage
 * 
 * Evidence payload for explainability:
 * - segmentsMatched, segmentsTotal
 * - matchedRanges[] (contiguous matched segments)
 * - firstMismatches[] (up to 5 for review)
 * 
 * @param candidateVideoPath - Path to candidate video
 * @param bundle - Fingerprint bundle from credential
 * @param options - Verification options
 * @returns Promise<VideoVerificationOutcome>
 */
export async function verifyVideoFingerprint(
  candidateVideoPath: string,
  bundle: VideoFingerprintBundle,
  options: {
    enableFrameMatching?: boolean;  // Fallback to per-frame matching
    maxMismatchesToReport?: number;  // Max mismatches in evidence (default: 5)
  } = {}
): Promise<VideoVerificationOutcome> {
  const maxMismatchesToReport = options.maxMismatchesToReport ?? 5;
  
  // 1. Check canonicalization version
  if (!bundle.canonicalization.startsWith('vid:v1:')) {
    throw new Error(`Unsupported canonicalization version: ${bundle.canonicalization}`);
  }
  
  // 2. Canonicalize candidate to vid:v1
  const candidateSegmentHashes = await processVideoSegments(candidateVideoPath);
  
  // 3. Compute coverage and evidence
  const totalSegments = bundle.segmentHashes.length;
  const segmentMatches: boolean[] = [];
  const mismatches: MismatchInfo[] = [];
  let matchedSegments = 0;
  
  for (let i = 0; i < totalSegments; i++) {
    const expected = bundle.segmentHashes[i];
    const actual = candidateSegmentHashes[i] || `seg_${i}:missing`;
    const match = actual === expected;
    
    segmentMatches.push(match);
    
    if (match) {
      matchedSegments++;
    } else if (mismatches.length < maxMismatchesToReport) {
      mismatches.push({
        segmentIndex: i,
        expectedHash: expected,
        actualHash: actual
      });
    }
  }
  
  const coverage = (matchedSegments / totalSegments) * 100;
  
  // Detect mismatched runs (for PROVEN_STRONG threshold)
  const hasMismatchedRuns = detectMismatchedRuns(segmentMatches);
  
  // Compute matched ranges
  const matchedRanges = computeMatchedRanges(segmentMatches);
  
  // 4. Determine verdict
  let verdict: VideoVerificationResult;
  
  if (matchedSegments === totalSegments) {
    // 100% match
    verdict = VideoVerificationResult.PROVEN_STRONG;
  } else if (
    coverage >= CONFIG.THRESHOLDS.PROVEN_STRONG_MIN * 100 &&
    !hasMismatchedRuns
  ) {
    // ≥98% with no mismatched runs
    verdict = VideoVerificationResult.PROVEN_STRONG;
  } else if (coverage >= CONFIG.THRESHOLDS.PROVEN_DERIVED * 100) {
    // ≥80% coverage
    verdict = VideoVerificationResult.PROVEN_DERIVED;
  } else if (coverage >= CONFIG.THRESHOLDS.INCONCLUSIVE * 100) {
    // 30-79% coverage
    verdict = VideoVerificationResult.INCONCLUSIVE;
  } else {
    // <30% coverage
    verdict = VideoVerificationResult.NOT_PROVEN;
  }
  
  // Optional: Per-frame matching for unmatched segments
  const frameMatches: number[] = [];
  if (options.enableFrameMatching && mismatches.length > 0) {
    // TODO: Implement per-frame Hamming distance matching
    // For each unmatched segment, compute frame-level matches
    // If ≥10/15 frames match (≥66%), upgrade verdict
  }
  
  // Processing notes
  const notes: string[] = [];
  notes.push('VFR→CFR resample');  // Always applies
  notes.push('De-interlaced');     // Always applies (yadif)
  
  const warnings: string[] = [];
  if (coverage < 100 && coverage >= 80) {
    warnings.push(`${(100 - coverage).toFixed(1)}% of segments differ`);
  }
  
  return {
    verdict,
    coverage,
    segmentsMatched: matchedSegments,
    segmentsTotal: totalSegments,
    canonicalization: bundle.canonicalization,
    matchedRanges,
    firstMismatches: mismatches,
    notes,
    warnings,
    details: {
      segmentMatches,
      frameMatches: frameMatches.length > 0 ? frameMatches : undefined,
      hasMismatchedRuns
    }
  };
}

/**
 * Detect if there are runs of mismatched segments
 * (for PROVEN_STRONG threshold refinement)
 */
function detectMismatchedRuns(matches: boolean[]): boolean {
  let consecutiveMismatches = 0;
  const MISMATCH_RUN_THRESHOLD = 3;  // ≥3 consecutive mismatches
  
  for (const match of matches) {
    if (!match) {
      consecutiveMismatches++;
      if (consecutiveMismatches >= MISMATCH_RUN_THRESHOLD) {
        return true;
      }
    } else {
      consecutiveMismatches = 0;
    }
  }
  
  return false;
}

/**
 * Compute contiguous matched segment ranges
 */
function computeMatchedRanges(matches: boolean[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  
  for (let i = 0; i < matches.length; i++) {
    if (matches[i]) {
      if (start === -1) {
        start = i;
      }
    } else {
      if (start !== -1) {
        ranges.push([start, i - 1]);
        start = -1;
      }
    }
  }
  
  // Close final range if needed
  if (start !== -1) {
    ranges.push([start, matches.length - 1]);
  }
  
  return ranges;
}

/**
 * Compute Hamming distance between two pHashes
 */
export function hammingDistance(hash1: string, hash2: string): number {
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
// Frame pHash Matching Thresholds
// ============================================

/**
 * Frame pHash Hamming thresholds (guide):
 * - ≤ 8 bits: match
 * - 9-16: weak
 * - >16: no match
 */
export function evaluateFrameMatch(distance: number): 'match' | 'weak' | 'no-match' {
  if (distance <= 8) return 'match';
  if (distance <= 16) return 'weak';
  return 'no-match';
}

// ============================================
// Example Usage
// ============================================

/*
import { 
  createVideoFingerprint, 
  verifyVideoFingerprint,
  VideoVerificationResult 
} from './video-canonicalization';

// Create fingerprint
const bundle = await createVideoFingerprint('./video.mp4');
console.log(bundle);
// {
//   algorithm: 'sha256+segphash',
//   segmentHashes: [
//     'seg_0:4da78cd8a3dc3018',
//     'seg_1:a3dc30181ada65ef',
//     ...
//   ],
//   canonicalization: 'vid:v1:srgb|max720|fps15.000|resize-lanczos3|rgb8'
// }

// Verify candidate
const result = await verifyVideoFingerprint('./candidate.mp4', bundle);
console.log(result.result);  // PROVEN_STRONG | PROVEN_DERIVED | INCONCLUSIVE | NOT_PROVEN
console.log(`Coverage: ${result.coverage}%`);
console.log(`Matched: ${result.matchedSegments}/${result.totalSegments} segments`);

// Use in credential
const credential = {
  mediaType: 'video/mp4',
  fingerprintBundle: bundle,
  // ... other fields
};
*/
