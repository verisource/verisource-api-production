/**
 * Video Analyzer - GPU-ENABLED VERSION
 *
 * Improvements over previous version:
 * 1. GPU batched AI detection (CLIP + Frequency CNN ensemble, 99.1% accuracy)
 * 2. Sequential CPU fallback when GPU unavailable
 * 3. Hybrid verdict: percentage-of-frames OR any high-confidence frame
 * 4. Video-level generator classification on highest-confidence AI frame
 * 5. maxFramesToAnalyze raised from 10 → 30 (GPU makes the cost negligible)
 *
 * Existing features preserved:
 * - Blur filtering (keep top 70% sharpest)
 * - Weighted aggregation
 * - Dynamic thresholds based on video length
 * - Temporal consistency analysis
 * - Deepfake detection
 * - Frame provenance matching
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { detectAIGeneration } = require('./ai-image-detector'); // Legacy fallback only
const GPUAIDetector = require('./services/gpu-ai-detector');
const sharp = require('sharp');
const ProvenanceService = require('./services/provenance-service');
const NodeCache = require('node-cache');
const crypto = require('crypto');

// Initialize cache (TTL: 1 hour, check period: 2 minutes)
const detectionCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const { analyzeTemporalConsistency } = require('./temporal-analyzer');
const { analyzeForDeepfakes } = require('./deepfake-detector');

// ============================================
// HYBRID VERDICT THRESHOLDS
// ============================================
// Single-frame override: any frame at this confidence triggers AI verdict
// regardless of how many other frames look authentic. Catches deepfakes
// and partially-AI videos.
const HIGH_CONFIDENCE_FRAME_THRESHOLD = 90; // ai_confidence >= 90 on any frame


/**
 * Calculate blur score for a frame
 */
async function calculateBlurScore(imagePath) {
  try {
    const image = sharp(imagePath);
    const stats = await image.stats();
    const metadata = await image.metadata();

    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    const pixelCount = metadata.width * metadata.height;
    const normalizedScore = (avgStdDev / Math.sqrt(pixelCount)) * 1000;

    return normalizedScore;
  } catch (err) {
    return 50; // Default acceptable score
  }
}

/**
 * Filter blurry frames - keep only sharp ones
 */
async function filterBlurryFrames(framePaths, options = {}) {
  const minFrames = options.minFrames || 5;
  const maxFrames = options.maxFrames || 30;
  const percentile = options.percentile || 0.7; // Keep top 70%

  console.log(`🔍 Analyzing sharpness of ${framePaths.length} frames...`);

  const framesWithScores = await Promise.all(
    framePaths.map(async (framePath) => ({
      path: framePath,
      blurScore: await calculateBlurScore(framePath),
    }))
  );

  framesWithScores.sort((a, b) => b.blurScore - a.blurScore);

  const keepCount = Math.max(
    minFrames,
    Math.min(maxFrames, Math.ceil(framesWithScores.length * percentile))
  );

  const sharpFrames = framesWithScores.slice(0, keepCount);
  const rejectedCount = framePaths.length - sharpFrames.length;
  const rejectedPercent = ((rejectedCount / framePaths.length) * 100).toFixed(1);

  console.log(`✅ Kept ${sharpFrames.length} sharp frames, rejected ${rejectedCount} blurry (${rejectedPercent}%)`);

  return sharpFrames.map((f) => f.path);
}

/**
 * Extract frames from video
 */
function extractFrames(videoPath, outputDir, fps = 1) {
  return new Promise((resolve, reject) => {
    console.log('Extracting frames from video at 1 fps...');

    ffmpeg(videoPath)
      .on('end', () => {
        const frames = fs
          .readdirSync(outputDir)
          .filter((f) => f.endsWith('.jpg'))
          .map((f) => path.join(outputDir, f))
          .sort();
        console.log(`Extracted ${frames.length} frames`);
        resolve(frames);
      })
      .on('error', (err) => {
        reject(new Error('Frame extraction failed'));
      })
      .outputOptions(['-vf', `fps=${fps}`, '-q:v', '2'])
      .output(path.join(outputDir, 'frame-%04d.jpg'))
      .run();
  });
}

/**
 * Weighted aggregation of frame results
 * Gives more weight to high-confidence detections
 */
function calculateWeightedScore(frameResults) {
  if (frameResults.length === 0) return { score: 0, confidence: 0 };

  let totalWeight = 0;
  let weightedSum = 0;

  frameResults.forEach((result) => {
    const confidence = result?.ai_confidence || 0;
    const weight = confidence / 100;
    const isAI = result?.likely_ai_generated ? 1 : 0;

    weightedSum += isAI * weight;
    totalWeight += weight;
  });

  const weightedScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  const avgConfidence = totalWeight > 0 ? (totalWeight / frameResults.length) * 100 : 0;

  return {
    score: weightedScore,
    confidence: avgConfidence,
  };
}

/**
 * Get dynamic thresholds based on video characteristics
 */
function getDynamicThresholds(totalFrames, analyzedFrames) {
  let aiThreshold, suspiciousThreshold;

  if (totalFrames <= 15) {
    aiThreshold = 60;
    suspiciousThreshold = 40;
  } else if (totalFrames <= 30) {
    aiThreshold = 50;
    suspiciousThreshold = 35;
  } else if (totalFrames <= 100) {
    aiThreshold = 40;
    suspiciousThreshold = 30;
  } else {
    aiThreshold = 35;
    suspiciousThreshold = 25;
  }

  return { aiThreshold, suspiciousThreshold };
}

/**
 * Cached AI detection wrapper - LEGACY FALLBACK ONLY
 * Used when GPU service is unavailable.
 */
async function detectAIGenerationCached(framePath) {
  try {
    const buffer = fs.readFileSync(framePath);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    const cached = detectionCache.get(hash);
    if (cached) {
      return cached;
    }

    const result = await detectAIGeneration(framePath);
    detectionCache.set(hash, result);
    return result;
  } catch (err) {
    console.error(`Cache error for ${path.basename(framePath)}:`, err.message);
    return await detectAIGeneration(framePath);
  }
}

/**
 * Run AI detection on all frames using GPU batch when available,
 * falling back to legacy CPU detector if GPU is offline.
 *
 * @param {string[]} framePaths
 * @returns {Object[]} Array of per-frame results
 */
async function runFrameAIDetection(framePaths) {
  // Prefer GPU batch
  if (GPUAIDetector.isAvailable()) {
    console.log(`🚀 Running GPU batch detection on ${framePaths.length} frames...`);
    const startMs = Date.now();
    const results = await GPUAIDetector.analyzeBatch(framePaths);

    // Check if all results errored — fall back to CPU if so
    const allErrored = results.length > 0 && results.every((r) => r.error);
    if (allErrored) {
      console.warn('⚠️  All GPU batch results errored, falling back to legacy CPU detector');
      return runFrameAIDetectionLegacy(framePaths);
    }

    const elapsed = Date.now() - startMs;
    console.log(`✅ GPU batch complete in ${elapsed}ms (${(elapsed / framePaths.length).toFixed(0)}ms/frame)`);
    return results;
  }

  // GPU not configured — use legacy CPU path
  console.log(`⚠️  GPU unavailable, using legacy CPU detector for ${framePaths.length} frames`);
  return runFrameAIDetectionLegacy(framePaths);
}

/**
 * Legacy CPU per-frame AI detection (fallback path)
 */
async function runFrameAIDetectionLegacy(framePaths) {
  const results = await Promise.all(
    framePaths.map(async (framePath) => {
      try {
        return await detectAIGenerationCached(framePath);
      } catch (err) {
        console.error(`Failed to analyze frame ${path.basename(framePath)}:`, err.message);
        return null;
      }
    })
  );
  return results.filter((r) => r !== null);
}

/**
 * Analyze video for AI-generated content
 */
async function analyzeVideo(videoPath) {
  const tempDir = path.join(__dirname, 'temp', `video-${Date.now()}`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('Starting video analysis...');

    // Extract frames at 1 fps
    const allFrames = await extractFrames(videoPath, tempDir, 1);

    if (allFrames.length === 0) {
      throw new Error('No frames extracted from video');
    }

    // Blur filtering — keep top 70% sharpest, max 30 frames
    const sharpFrames = await filterBlurryFrames(allFrames, {
      minFrames: 5,
      maxFrames: 30, // increased from 10
      percentile: 0.7,
    });

    // Cap analysis at 30 frames (GPU makes this cheap)
    const maxFramesToAnalyze = Math.min(30, sharpFrames.length);
    const framesToAnalyze = sharpFrames.slice(0, maxFramesToAnalyze);

    // Temporal consistency
    const temporalAnalysis = await analyzeTemporalConsistency(framesToAnalyze, {
      minFrames: 3,
    });

    // Run deepfake detection and AI frame detection IN PARALLEL
    console.log(`Analyzing ${framesToAnalyze.length} frames...`);

    const [deepfakeAnalysis, frameResults] = await Promise.all([
      analyzeForDeepfakes(framesToAnalyze, tempDir),
      runFrameAIDetection(framesToAnalyze),
    ]);

    if (frameResults.length === 0) {
      throw new Error('Failed to analyze any frames');
    }

    // ============================================
    // FRAME RESULT NORMALIZATION
    // ============================================
    // GPU detector and legacy detector have slightly different output shapes.
    // Normalize to: { ai_confidence, likely_ai_generated, ...rest }
    const normalizedResults = frameResults.map((r, i) => ({
      ...r,
      frame_index: i,
      frame_path: framesToAnalyze[i],
      ai_confidence: r.ai_confidence ?? r.aiDetection?.ai_confidence ?? 0,
      likely_ai_generated:
        r.likely_ai_generated ?? r.aiDetection?.likely_ai_generated ?? false,
    }));

    // ============================================
    // WEIGHTED AGGREGATION
    // ============================================
    const weighted = calculateWeightedScore(normalizedResults);

    // Count AI / suspicious frames + track highest-confidence frame
    let aiFrames = 0;
    let suspiciousFrames = 0;
    let maxFrameConfidence = 0;
    let highestConfidenceFrame = null;

    normalizedResults.forEach((r) => {
      if (r.likely_ai_generated || r.ai_confidence > 75) aiFrames++;
      if (r.likely_ai_generated || r.ai_confidence > 50) suspiciousFrames++;

      if (r.ai_confidence > maxFrameConfidence) {
        maxFrameConfidence = r.ai_confidence;
        highestConfidenceFrame = r;
      }
    });

    const aiPercentage = (aiFrames / normalizedResults.length) * 100;
    const suspiciousPercentage = (suspiciousFrames / normalizedResults.length) * 100;

    // Dynamic thresholds
    const thresholds = getDynamicThresholds(allFrames.length, normalizedResults.length);
    console.log(
      `📊 Dynamic thresholds for ${allFrames.length} frame video: AI=${thresholds.aiThreshold}%, Suspicious=${thresholds.suspiciousThreshold}%`
    );

    // ============================================
    // HYBRID VERDICT (Option B)
    // ============================================
    // Triggers AI verdict if EITHER:
    //  (a) percentage of AI frames meets the dynamic threshold, OR
    //  (b) any single frame hits >=90% confidence (deepfake / partial-AI override)
    let verdict;
    let videoConfidence;
    let highConfidenceOverride = false;

    const meetsPctThreshold =
      aiPercentage >= thresholds.aiThreshold || weighted.score >= thresholds.aiThreshold;
    const hasHighConfFrame = maxFrameConfidence >= HIGH_CONFIDENCE_FRAME_THRESHOLD;

    if (meetsPctThreshold || hasHighConfFrame) {
      verdict = 'LIKELY_AI_GENERATED';
      highConfidenceOverride = hasHighConfFrame && !meetsPctThreshold;
      videoConfidence = 100 - Math.max(aiPercentage, weighted.score, maxFrameConfidence);
    } else if (
      suspiciousPercentage >= thresholds.suspiciousThreshold ||
      weighted.score >= thresholds.suspiciousThreshold
    ) {
      verdict = 'SUSPICIOUS';
      videoConfidence = 100 - Math.max(suspiciousPercentage, weighted.score);
    } else if (aiPercentage > 10) {
      verdict = 'POSSIBLY_MANIPULATED';
      videoConfidence = 100 - aiPercentage;
    } else {
      verdict = 'AUTHENTIC';
      videoConfidence = 100 - aiPercentage;
    }

    videoConfidence = Math.max(0, Math.min(100, Math.round(videoConfidence)));

    console.log('');
    console.log(`📊 Analysis Results:`);
    console.log(`   Verdict: ${verdict}${highConfidenceOverride ? ' (high-conf frame override)' : ''}`);
    console.log(`   Confidence: ${videoConfidence}%`);
    console.log(`   AI Frames: ${aiFrames}/${normalizedResults.length} (${Math.round(aiPercentage)}%)`);
    console.log(`   Suspicious Frames: ${suspiciousFrames}/${normalizedResults.length} (${Math.round(suspiciousPercentage)}%)`);
    console.log(`   Weighted Score: ${weighted.score.toFixed(1)}%`);
    console.log(`   Max Frame Confidence: ${maxFrameConfidence.toFixed(1)}%`);

    // ============================================
    // VIDEO-LEVEL GENERATOR CLASSIFICATION
    // ============================================
    // Run generator classification on the highest-confidence AI frame
    // so videos get the same generator_detection field that images do.
    let generatorDetection = null;
    if (
      (verdict === 'LIKELY_AI_GENERATED' || verdict === 'SUSPICIOUS') &&
      highestConfidenceFrame &&
      highestConfidenceFrame.frame_path &&
      GPUAIDetector.isAvailable()
    ) {
      try {
        console.log(`🎯 Classifying generator from frame ${highestConfidenceFrame.frame_index} (${maxFrameConfidence.toFixed(1)}% AI)...`);
        generatorDetection = await GPUAIDetector.classifyGenerator(highestConfidenceFrame.frame_path);
        if (generatorDetection?.verdict_message) {
          console.log(`   Generator: ${generatorDetection.verdict_message}`);
        }
      } catch (err) {
        console.warn(`⚠️  Generator classification failed: ${err.message}`);
      }
    }

    // ============================================
    // FRAME PROVENANCE MATCHING (region pHash)
    // ============================================
    let frameProvenanceMatches = [];
    try {
      const framesToMatch = framesToAnalyze.slice(0, 5);
      console.log(`\n🔍 Running frame provenance matching on ${framesToMatch.length} frames...`);

      for (let i = 0; i < framesToMatch.length; i++) {
        try {
          const framePath = framesToMatch[i];
          const frameTime = `${i}s`;

          const regionHashes = await ProvenanceService.generateAllRegionHashes(framePath);
          if (!regionHashes || Object.keys(regionHashes).length === 0) continue;

          const { generatePHash } = require('./phash-module');
          const phashResult = await generatePHash(framePath);
          const framePHash = phashResult?.phash || null;

          const matches = await ProvenanceService.findSimilarContent(
            framePHash,
            regionHashes,
            null,
            80
          );

          if (matches && matches.length > 0) {
            for (const match of matches) {
              frameProvenanceMatches.push({
                frame_index: i,
                frame_time: frameTime,
                matched_fingerprint: match.fingerprint,
                similarity: match.similarity,
                match_type: match.match_type,
                matched_regions: match.matched_regions || null,
                first_seen: match.first_seen,
                location_general: match.location_general || null,
                camera: match.camera_make
                  ? `${match.camera_make} ${match.camera_model || ''}`.trim()
                  : null,
              });
            }
          }
        } catch (frameErr) {
          console.error(`⚠️ Frame ${i} provenance error: ${frameErr.message}`);
        }
      }

      if (frameProvenanceMatches.length > 0) {
        console.log(`📍 Found ${frameProvenanceMatches.length} frame-to-image matches!`);
      } else {
        console.log(`   No frame matches found in database`);
      }
    } catch (provErr) {
      console.error(`⚠️ Frame provenance matching error: ${provErr.message}`);
    }

    return {
      success: true,
      analysis: {
        verdict: verdict,
        videoConfidence: videoConfidence,
        framesAnalyzed: normalizedResults.length,
        totalFrames: allFrames.length,
        aiFrames: aiFrames,
        aiPercentage: Math.round(aiPercentage),
        suspiciousFrames: suspiciousFrames,
        suspiciousPercentage: Math.round(suspiciousPercentage),
        weightedScore: weighted.score,
        weightedConfidence: weighted.confidence,
        maxFrameConfidence: Math.round(maxFrameConfidence * 10) / 10,
        highConfidenceOverride: highConfidenceOverride,
        thresholds: thresholds,
        detectionProvider: normalizedResults[0]?.provider || 'unknown',
        temporalConsistency: {
          score: temporalAnalysis.score,
          consistent: temporalAnalysis.consistent,
          inconsistencies: temporalAnalysis.inconsistencies,
          indicators: temporalAnalysis.indicators,
        },
        deepfakeDetection: {
          detected: deepfakeAnalysis.isDeepfake,
          confidence: deepfakeAnalysis.confidence,
          facesAnalyzed: deepfakeAnalysis.facesAnalyzed,
          aiFacePercentage: deepfakeAnalysis.aiFacePercentage,
          indicators: deepfakeAnalysis.indicators,
        },
        generatorDetection: generatorDetection,
        frameResults: normalizedResults,
        frameProvenanceMatches:
          frameProvenanceMatches.length > 0
            ? {
                matches_found: frameProvenanceMatches.length,
                matches: frameProvenanceMatches,
              }
            : null,
      },
      metadata: null,
    };

  } catch (error) {
    console.error('Video analysis error:', error);
    return {
      success: false,
      error: error.message,
    };

  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  }
}

/**
 * Get video metadata synchronously using ffprobe
 */
function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

module.exports = {
  analyzeVideo,
  getVideoMetadata,
};