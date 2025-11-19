/**
 * Blur Detection and Filtering Module (Pure JavaScript)
 * 
 * Filters out blurry/low-quality frames before AI detection
 * Uses Sharp library for image analysis
 */

const sharp = require('sharp');
const fs = require('fs');

/**
 * Calculate blur score using image statistics
 * Higher score = sharper image
 */
async function calculateBlurScore(imagePath) {
  try {
    const image = sharp(imagePath);
    
    // Get image statistics
    const stats = await image.stats();
    const metadata = await image.metadata();
    
    // Use standard deviation across channels as sharpness indicator
    // Sharp images have higher variation (higher std dev)
    // Blurry images have lower variation (lower std dev)
    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    
    // Normalize by image size (larger images tend to have higher values)
    const pixelCount = metadata.width * metadata.height;
    const normalizedScore = (avgStdDev / Math.sqrt(pixelCount)) * 1000;
    
    return normalizedScore;
    
  } catch (err) {
    console.error(`Error calculating blur score for ${imagePath}:`, err.message);
    return 50; // Default to "acceptable" if detection fails
  }
}

/**
 * Filter frames by blur score
 * Returns only sharp, analyzable frames
 */
async function filterBlurryFrames(framePaths, options = {}) {
  const minFrames = options.minFrames || 5; // Minimum frames to keep
  const maxFrames = options.maxFrames || 30; // Maximum frames to analyze
  const percentile = options.percentile || 0.7; // Keep top 70% sharpest frames
  
  console.log(`🔍 Analyzing sharpness of ${framePaths.length} frames...`);
  
  // Calculate blur score for each frame
  const framesWithScores = [];
  for (const framePath of framePaths) {
    const blurScore = await calculateBlurScore(framePath);
    framesWithScores.push({
      path: framePath,
      blurScore: blurScore
    });
  }
  
  // Sort by blur score (highest = sharpest)
  framesWithScores.sort((a, b) => b.blurScore - a.blurScore);
  
  // Calculate dynamic threshold (top X% of frames)
  const keepCount = Math.max(
    minFrames,
    Math.min(
      maxFrames,
      Math.ceil(framesWithScores.length * percentile)
    )
  );
  
  // Keep sharpest frames
  const sharpFrames = framesWithScores.slice(0, keepCount);
  
  const rejectedCount = framePaths.length - sharpFrames.length;
  const rejectedPercent = ((rejectedCount / framePaths.length) * 100).toFixed(1);
  
  console.log(`✅ Kept ${sharpFrames.length} sharp frames, rejected ${rejectedCount} blurry frames (${rejectedPercent}%)`);
  
  // Show blur score range
  const minScore = sharpFrames[sharpFrames.length - 1].blurScore.toFixed(2);
  const maxScore = sharpFrames[0].blurScore.toFixed(2);
  console.log(`   Blur score range: ${minScore} - ${maxScore} (higher = sharper)`);
  
  // Return just the paths
  return sharpFrames.map(f => f.path);
}

module.exports = {
  calculateBlurScore,
  filterBlurryFrames
};
