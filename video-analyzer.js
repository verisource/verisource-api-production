/**
 * Video Analyzer - IMPROVED VERSION
 * 
 * Improvements:
 * 1. Blur filtering - only analyze sharp frames
 * 2. Weighted aggregation - smart frame scoring
 * 3. Dynamic thresholds - adjust based on video length
 * 4. Better error handling
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { detectAIGeneration } = require('./ai-image-detector');
const sharp = require('sharp');
const ProvenanceService = require('./services/provenance-service');
const NodeCache = require('node-cache');
const crypto = require('crypto');

// Initialize cache (TTL: 1 hour, check period: 2 minutes)
const detectionCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const { analyzeTemporalConsistency } = require('./temporal-analyzer');
const { analyzeForDeepfakes } = require('./deepfake-detector');


/**
 * Calculate blur score for a frame
 */
async function calculateBlurScore(imagePath) {
  try {
    const image = sharp(imagePath);
    const stats = await image.stats();
    const metadata = await image.metadata();
    
    // Standard deviation indicates sharpness
    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    
    // Normalize by image size
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
  const maxFrames = options.maxFrames || 5;
  const percentile = options.percentile || 0.7; // Keep top 70%
  
  console.log(`🔍 Analyzing sharpness of ${framePaths.length} frames...`);
  
  const framesWithScores = await Promise.all(
  framePaths.map(async (framePath) => ({
    path: framePath,
    blurScore: await calculateBlurScore(framePath)
  }))
);
  
  // Sort by sharpness (highest first)
  framesWithScores.sort((a, b) => b.blurScore - a.blurScore);
  
  // Keep top percentile
  const keepCount = Math.max(
    minFrames,
    Math.min(maxFrames, Math.ceil(framesWithScores.length * percentile))
  );
  
  const sharpFrames = framesWithScores.slice(0, keepCount);
  const rejectedCount = framePaths.length - sharpFrames.length;
  const rejectedPercent = ((rejectedCount / framePaths.length) * 100).toFixed(1);
  
  console.log(`✅ Kept ${sharpFrames.length} sharp frames, rejected ${rejectedCount} blurry (${rejectedPercent}%)`);
  
  return sharpFrames.map(f => f.path);
}

/**
 * Extract frames from video
 */
function extractFrames(videoPath, outputDir, fps = 1) {
  return new Promise((resolve, reject) => {
    console.log('Extracting frames from video at 1 fps...');
    
    ffmpeg(videoPath)
      .on('end', () => {
        const frames = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.jpg'))
          .map(f => path.join(outputDir, f))
          .sort();
        console.log(`Extracted ${frames.length} frames`);
        resolve(frames);
      })
      .on('error', (err) => {
        reject(new Error('Frame extraction failed'));
      })
      .outputOptions([
        '-vf', `fps=${fps}`,
        '-q:v', '2'
      ])
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
  
  frameResults.forEach(result => {
    // Weight by confidence
    // High confidence detections get more weight
    const confidence = result.aiDetection?.ai_confidence || 0;
    const weight = confidence / 100; // 0 to 1
    
    const isAI = result.aiDetection?.likely_ai_generated ? 1 : 0;
    
    weightedSum += isAI * weight;
    totalWeight += weight;
  });
  
  const weightedScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  const avgConfidence = totalWeight > 0 ? (totalWeight / frameResults.length) * 100 : 0;
  
  return {
    score: weightedScore,
    confidence: avgConfidence
  };
}

/**
 * Get dynamic thresholds based on video characteristics
 */
function getDynamicThresholds(totalFrames, analyzedFrames) {
  // Shorter videos: stricter thresholds (less room for error)
  // Longer videos: more lenient (compression artifacts)
  
  let aiThreshold, suspiciousThreshold;
  
  if (totalFrames <= 15) {
    // Very short video
    aiThreshold = 60;  // 60% of frames must be AI
    suspiciousThreshold = 40;
  } else if (totalFrames <= 30) {
    // Short video
    aiThreshold = 50;
    suspiciousThreshold = 35;
  } else if (totalFrames <= 100) {
    // Medium video
    aiThreshold = 40;
    suspiciousThreshold = 30;
  } else {
    // Long video (more compression artifacts)
    aiThreshold = 35;
    suspiciousThreshold = 25;
  }
  
  return { aiThreshold, suspiciousThreshold };
}

/**
 * Analyze video for AI-generated content
 */

/**
 * Cached AI detection wrapper
 * Uses MD5 hash of frame to cache results
 */
async function detectAIGenerationCached(framePath) {
  try {
    // Generate hash of frame for cache key
    const buffer = fs.readFileSync(framePath);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    
    // Check cache first
    const cached = detectionCache.get(hash);
    if (cached) {
      return cached;
    }
    
    // Not in cache - analyze frame
    const result = await detectAIGeneration(framePath);
    
    // Store in cache
    detectionCache.set(hash, result);
    
    return result;
  } catch (err) {
    console.error(`Cache error for ${path.basename(framePath)}:`, err.message);
    // Fallback to non-cached
    return await detectAIGenerationCached(framePath);
  }
}

async function analyzeVideo(videoPath) {
  const tempDir = path.join(__dirname, 'temp', `video-${Date.now()}`);
  
  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    console.log('Starting video analysis...');
    
    // Get video metadata first
    
    // Extract frames at 1 fps
    const allFrames = await extractFrames(videoPath, tempDir, 1);
    
    if (allFrames.length === 0) {
      throw new Error('No frames extracted from video');
    }
    
    // ============================================
    // NEW: BLUR FILTERING
    // ============================================
    console.log('');
    const sharpFrames = await filterBlurryFrames(allFrames, {
      minFrames: 5,
      maxFrames: 10,
      percentile: 0.7  // Keep top 70% sharpest
    });
    
    // Limit frames to analyze
    const maxFramesToAnalyze = Math.min(10, sharpFrames.length);
    const framesToAnalyze = sharpFrames.slice(0, maxFramesToAnalyze);
    
    
    // Temporal consistency analysis
    const temporalAnalysis = await analyzeTemporalConsistency(framesToAnalyze, {
      minFrames: 3
    });

    

    // Run deepfake detection and frame analysis IN PARALLEL
    console.log(`Analyzing ${framesToAnalyze.length} frames...`);
    
    const [deepfakeAnalysis, frameResults] = await Promise.all([
      // Deepfake detection (face-focused analysis)
      analyzeForDeepfakes(framesToAnalyze, tempDir),
      
      // Frame AI analysis (run all frames in parallel too)
      Promise.all(framesToAnalyze.map(async (framePath) => {
        try {
          return await detectAIGeneration(framePath);
        } catch (err) {
          console.error(`Failed to analyze frame ${path.basename(framePath)}:`, err.message);
          return null;
        }
      })).then(results => results.filter(r => r !== null))
    ]);
    
    if (frameResults.length === 0) {
      throw new Error('Failed to analyze any frames');
    }
    
    // ============================================
    // NEW: WEIGHTED AGGREGATION
    // ============================================
    const weighted = calculateWeightedScore(frameResults);
    
    // Count AI and suspicious frames (for compatibility)
    let aiFrames = 0;
    let suspiciousFrames = 0;
    
    frameResults.forEach(result => {
      const aiDetection = result || {};
      
      if (aiDetection.likely_ai_generated || aiDetection.ai_confidence > 75) {
        aiFrames++;
      }
      
      if (aiDetection.likely_ai_generated || aiDetection.ai_confidence > 50) {
        suspiciousFrames++;
      }
    });
    
    const aiPercentage = (aiFrames / frameResults.length) * 100;
    const suspiciousPercentage = (suspiciousFrames / frameResults.length) * 100;
    
    // ============================================
    // NEW: DYNAMIC THRESHOLDS
    // ============================================
    const thresholds = getDynamicThresholds(allFrames.length, frameResults.length);
    console.log(`📊 Dynamic thresholds for ${allFrames.length} frame video: AI=${thresholds.aiThreshold}%, Suspicious=${thresholds.suspiciousThreshold}%`);
    
    // Determine verdict using dynamic thresholds AND weighted score
    let verdict;
    let videoConfidence;
    
    if (aiPercentage >= thresholds.aiThreshold || weighted.score >= thresholds.aiThreshold) {
      verdict = 'LIKELY_AI_GENERATED';
      videoConfidence = 100 - Math.max(aiPercentage, weighted.score);
    } else if (suspiciousPercentage >= thresholds.suspiciousThreshold || weighted.score >= thresholds.suspiciousThreshold) {
      verdict = 'SUSPICIOUS';
      videoConfidence = 100 - Math.max(suspiciousPercentage, weighted.score);
    } else if (aiPercentage > 10) {
      verdict = 'POSSIBLY_MANIPULATED';
      videoConfidence = 100 - aiPercentage;
    } else {
      verdict = 'AUTHENTIC';
      videoConfidence = 100 - aiPercentage;
    }
    
    // Ensure confidence is in valid range
    videoConfidence = Math.max(0, Math.min(100, Math.round(videoConfidence)));
    
    console.log('');
    console.log(`📊 Analysis Results:`);
    console.log(`   Verdict: ${verdict}`);
    console.log(`   Confidence: ${videoConfidence}%`);
    console.log(`   AI Frames: ${aiFrames}/${frameResults.length} (${Math.round(aiPercentage)}%)`);
    console.log(`   Suspicious Frames: ${suspiciousFrames}/${frameResults.length} (${Math.round(suspiciousPercentage)}%)`);
    console.log(`   Weighted Score: ${weighted.score.toFixed(1)}% (confidence-weighted)`);
    
    // ============================================
    // FRAME PROVENANCE MATCHING (region pHash)
    // ============================================
    let frameProvenanceMatches = [];
    try {
      const provenance = new ProvenanceService();
      const framesToMatch = framesToAnalyze.slice(0, 5); // Limit to 5 frames for performance
      console.log(`\n🔍 Running frame provenance matching on ${framesToMatch.length} frames...`);
      
      for (let i = 0; i < framesToMatch.length; i++) {
        try {
          const framePath = framesToMatch[i];
          const frameTime = `${Math.floor(i / 1)}s`; // Approximate timestamp
          
          // Generate region pHashes for this frame
          const regionHashes = await provenance.generateAllRegionHashes(framePath);
          if (!regionHashes || Object.keys(regionHashes).length === 0) continue;
          
          // Generate full pHash
          const { generatePHash } = require('./phash-module');
          const phashResult = await generatePHash(framePath);
          const framePHash = phashResult?.hash || null;
          
          // Search database for matches
          const matches = await provenance.findSimilarContent(
            framePHash,
            regionHashes,
            null, // no fingerprint to exclude
            85    // threshold
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
                camera: match.camera_make ? `${match.camera_make} ${match.camera_model || ''}`.trim() : null,
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
        framesAnalyzed: frameResults.length,
        totalFrames: allFrames.length,
        aiFrames: aiFrames,
        aiPercentage: Math.round(aiPercentage),
        suspiciousFrames: suspiciousFrames,
        suspiciousPercentage: Math.round(suspiciousPercentage),
        weightedScore: weighted.score,
        weightedConfidence: weighted.confidence,
        thresholds: thresholds,
        temporalConsistency: {
          score: temporalAnalysis.score,
          consistent: temporalAnalysis.consistent,
          inconsistencies: temporalAnalysis.inconsistencies,
          indicators: temporalAnalysis.indicators
        },
        deepfakeDetection: {
          detected: deepfakeAnalysis.isDeepfake,
          confidence: deepfakeAnalysis.confidence,
          facesAnalyzed: deepfakeAnalysis.facesAnalyzed,
          aiFacePercentage: deepfakeAnalysis.aiFacePercentage,
          indicators: deepfakeAnalysis.indicators
        },
       frameResults: frameResults,
        frameProvenanceMatches: frameProvenanceMatches.length > 0 ? {
          matches_found: frameProvenanceMatches.length,
          matches: frameProvenanceMatches,
        } : null,
      },
      metadata: null
    };
    
  } catch (error) {
    console.error('Video analysis error:', error);
    return {
      success: false,
      error: error.message
    };
    
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  }
}

module.exports = {
  analyzeVideo
};

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

module.exports.getVideoMetadata = getVideoMetadata;
