/**
 * Temporal Consistency Analyzer
 * Detects unnatural frame-to-frame changes in videos
 * Common in AI-generated content
 */

const sharp = require('sharp');
const path = require('path');

/**
 * Calculate pixel-wise difference between two frames
 * Returns percentage difference (0-100)
 */
async function calculateFrameDifference(frame1Path, frame2Path) {
  try {
    // Load both frames as raw buffers
    const [img1, img2] = await Promise.all([
      sharp(frame1Path)
        .resize(256, 256, { fit: 'inside' }) // Resize for speed
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(frame2Path)
        .resize(256, 256, { fit: 'inside' })
        .raw()
        .toBuffer({ resolveWithObject: true })
    ]);
    
    // Ensure same dimensions
    if (img1.info.width !== img2.info.width || img1.info.height !== img2.info.height) {
      return null;
    }
    
    // Calculate absolute pixel difference
    let totalDiff = 0;
    const pixelCount = img1.data.length;
    
    for (let i = 0; i < pixelCount; i++) {
      totalDiff += Math.abs(img1.data[i] - img2.data[i]);
    }
    
    // Normalize to percentage (0-100)
    const percentDiff = (totalDiff / pixelCount / 255) * 100;
    
    return percentDiff;
    
  } catch (err) {
    console.error(`Error comparing frames: ${err.message}`);
    return null;
  }
}

/**
 * Analyze temporal consistency across video frames
 * Detects unnatural jumps, morphing, flickering
 */
async function analyzeTemporalConsistency(framePaths, options = {}) {
  const minFrames = options.minFrames || 3;
  
  if (framePaths.length < minFrames) {
    return {
      consistent: true,
      score: 100,
      inconsistencies: 0,
      reason: `Need at least ${minFrames} frames for temporal analysis`
    };
  }
  
  console.log(`🎬 Analyzing temporal consistency across ${framePaths.length} frames...`);
  
  const differences = [];
  const inconsistencies = [];
  
  // Compare consecutive frames
  for (let i = 0; i < framePaths.length - 1; i++) {
    const diff = await calculateFrameDifference(framePaths[i], framePaths[i + 1]);
    
    if (diff !== null) {
      differences.push(diff);
      
      // Detect sudden jumps (after first frame)
      if (i > 0) {
        const prevDiff = differences[i - 1];
        const jumpSize = Math.abs(diff - prevDiff);
        
        // Flag if difference changes by >30%
        if (jumpSize > 30) {
          inconsistencies.push({
            frameIndex: i + 1,
            jumpSize: jumpSize.toFixed(1),
            type: diff > prevDiff ? 'sudden_change' : 'sudden_stabilization',
            prevDiff: prevDiff.toFixed(1),
            currDiff: diff.toFixed(1)
          });
        }
      }
    }
  }
  
  if (differences.length === 0) {
    return {
      consistent: true,
      score: 100,
      inconsistencies: 0,
      reason: 'Could not calculate frame differences'
    };
  }
  
  // Calculate statistics
  const avgDiff = differences.reduce((a, b) => a + b, 0) / differences.length;
  const variance = differences.reduce((sq, n) => sq + Math.pow(n - avgDiff, 2), 0) / differences.length;
  const stdDev = Math.sqrt(variance);
  
  // High standard deviation = inconsistent temporal flow
  // AI videos often have stdDev > 15
  const consistencyScore = Math.max(0, 100 - (stdDev * 3));
  
  const isConsistent = consistencyScore > 60 && inconsistencies.length < 3;
  
  console.log(`   Average frame-to-frame change: ${avgDiff.toFixed(1)}%`);
  console.log(`   Standard deviation: ${stdDev.toFixed(1)}`);
  console.log(`   Temporal consistency score: ${consistencyScore.toFixed(1)}%`);
  console.log(`   Inconsistencies detected: ${inconsistencies.length}`);
  
  if (inconsistencies.length > 0) {
    console.log(`   ⚠️  Detected ${inconsistencies.length} temporal anomalies`);
  }
  
  return {
    consistent: isConsistent,
    score: Math.round(consistencyScore),
    inconsistencies: inconsistencies.length,
    avgDifference: parseFloat(avgDiff.toFixed(1)),
    stdDeviation: parseFloat(stdDev.toFixed(1)),
    details: inconsistencies.slice(0, 5), // Return first 5 anomalies
    indicators: getTemporalIndicators(consistencyScore, inconsistencies.length, stdDev)
  };
}

/**
 * Generate human-readable indicators
 */
function getTemporalIndicators(score, inconsistencyCount, stdDev) {
  const indicators = [];
  
  if (score < 50) {
    indicators.push('Very low temporal consistency - likely AI-generated');
  } else if (score < 70) {
    indicators.push('Low temporal consistency - possibly AI or heavily edited');
  } else if (score < 85) {
    indicators.push('Moderate temporal consistency - some editing detected');
  } else {
    indicators.push('Good temporal consistency - appears natural');
  }
  
  if (inconsistencyCount >= 5) {
    indicators.push(`High number of frame jumps (${inconsistencyCount}) - characteristic of AI generation`);
  } else if (inconsistencyCount >= 3) {
    indicators.push(`Multiple frame jumps detected (${inconsistencyCount})`);
  }
  
  if (stdDev > 20) {
    indicators.push('Very high frame variance - unstable video characteristics');
  } else if (stdDev > 15) {
    indicators.push('High frame variance - inconsistent frame changes');
  }
  
  return indicators;
}

module.exports = {
  analyzeTemporalConsistency,
  calculateFrameDifference
};
