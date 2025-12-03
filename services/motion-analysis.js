/**
 * Motion Analysis for Video AI Detection
 * Analyzes optical flow and edge stability to detect AI-generated videos
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function calculateFrameDifference(frame1, frame2, width, height) {
  const pixels1 = new Uint8Array(frame1);
  const pixels2 = new Uint8Array(frame2);
  
  let totalDiff = 0;
  let maxDiff = 0;
  let significantChanges = 0;
  const threshold = 30;
  
  const blockSize = 8;
  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  const blockMotion = [];
  
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let blockDiff = 0;
      let blockPixels = 0;
      
      for (let y = 0; y < blockSize; y++) {
        for (let x = 0; x < blockSize; x++) {
          const px = bx * blockSize + x;
          const py = by * blockSize + y;
          const idx = py * width + px;
          
          if (idx < pixels1.length && idx < pixels2.length) {
            const diff = Math.abs(pixels1[idx] - pixels2[idx]);
            blockDiff += diff;
            totalDiff += diff;
            blockPixels++;
            
            if (diff > threshold) significantChanges++;
            if (diff > maxDiff) maxDiff = diff;
          }
        }
      }
      
      blockMotion.push(blockPixels > 0 ? blockDiff / blockPixels : 0);
    }
  }
  
  const avgDiff = totalDiff / pixels1.length;
  const avgBlockMotion = blockMotion.reduce((a, b) => a + b, 0) / blockMotion.length;
  const blockVariance = blockMotion.reduce((sum, m) => sum + Math.pow(m - avgBlockMotion, 2), 0) / blockMotion.length;
  const blockStdDev = Math.sqrt(blockVariance);
  const motionCV = avgBlockMotion > 0 ? (blockStdDev / avgBlockMotion) * 100 : 0;
  
  return {
    avgDiff,
    maxDiff,
    significantChanges,
    changeRatio: significantChanges / pixels1.length,
    blockMotion,
    motionCV,
    avgBlockMotion
  };
}

function detectEdges(grayBuffer, width, height) {
  const pixels = new Uint8Array(grayBuffer);
  const edges = new Uint8Array(width * height);
  
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
      
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kidx = (ky + 1) * 3 + (kx + 1);
          gx += pixels[idx] * sobelX[kidx];
          gy += pixels[idx] * sobelY[kidx];
        }
      }
      
      edges[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  
  return edges;
}

function compareEdgeStability(edges1, edges2, width, height) {
  const edgeThreshold = 50;
  
  let stableEdges = 0;
  let disappearingEdges = 0;
  let appearingEdges = 0;
  let totalEdges1 = 0;
  let totalEdges2 = 0;
  let flickerScore = 0;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const e1 = edges1[idx];
      const e2 = edges2[idx];
      
      const isEdge1 = e1 > edgeThreshold;
      const isEdge2 = e2 > edgeThreshold;
      
      if (isEdge1) totalEdges1++;
      if (isEdge2) totalEdges2++;
      
      if (isEdge1 && isEdge2) {
        stableEdges++;
      } else if (isEdge1 && !isEdge2) {
        let foundNearby = false;
        for (let dy = -2; dy <= 2 && !foundNearby; dy++) {
          for (let dx = -2; dx <= 2 && !foundNearby; dx++) {
            const nidx = (y + dy) * width + (x + dx);
            if (nidx >= 0 && nidx < edges2.length && edges2[nidx] > edgeThreshold) {
              foundNearby = true;
            }
          }
        }
        if (!foundNearby) {
          disappearingEdges++;
          flickerScore += e1;
        }
      } else if (!isEdge1 && isEdge2) {
        let foundNearby = false;
        for (let dy = -2; dy <= 2 && !foundNearby; dy++) {
          for (let dx = -2; dx <= 2 && !foundNearby; dx++) {
            const nidx = (y + dy) * width + (x + dx);
            if (nidx >= 0 && nidx < edges1.length && edges1[nidx] > edgeThreshold) {
              foundNearby = true;
            }
          }
        }
        if (!foundNearby) {
          appearingEdges++;
          flickerScore += e2;
        }
      }
    }
  }
  
  const avgEdges = (totalEdges1 + totalEdges2) / 2;
  
  return {
    stableEdges,
    disappearingEdges,
    appearingEdges,
    totalEdges: avgEdges,
    stabilityRatio: avgEdges > 0 ? stableEdges / avgEdges : 1,
    flickerRatio: avgEdges > 0 ? (disappearingEdges + appearingEdges) / avgEdges : 0,
    flickerScore: avgEdges > 0 ? flickerScore / avgEdges : 0
  };
}

async function analyzeFrameMotion(framePaths) {
  if (!framePaths || framePaths.length < 3) {
    return { success: false, error: 'Need at least 3 frames' };
  }
  
  const motionResults = [];
  const edgeResults = [];
  
  const analysisWidth = 320;
  const analysisHeight = 180;
  
  let prevGray = null;
  let prevEdges = null;
  
  for (let i = 0; i < Math.min(framePaths.length, 15); i++) {
    try {
      const grayBuffer = await sharp(framePaths[i])
        .resize(analysisWidth, analysisHeight, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();
      
      const edges = detectEdges(grayBuffer, analysisWidth, analysisHeight);
      
      if (prevGray) {
        const motion = calculateFrameDifference(prevGray, grayBuffer, analysisWidth, analysisHeight);
        motionResults.push(motion);
        
        const edgeStability = compareEdgeStability(prevEdges, edges, analysisWidth, analysisHeight);
        edgeResults.push(edgeStability);
      }
      
      prevGray = grayBuffer;
      prevEdges = edges;
      
    } catch (err) {
      console.error(`Motion analysis error on frame ${i}:`, err.message);
    }
  }
  
  if (motionResults.length === 0) {
    return { success: false, error: 'Could not analyze frame motion' };
  }
  
  return {
    success: true,
    motionResults,
    edgeResults,
    framesAnalyzed: motionResults.length + 1
  };
}

function calculateMotionScores(analysisResults) {
  if (!analysisResults.success) {
    return {
      success: false,
      error: analysisResults.error,
      aiScore: 0,
      authenticScore: 0
    };
  }
  
  const { motionResults, edgeResults } = analysisResults;
  
  // === OPTICAL FLOW ANALYSIS ===
  const avgMotionCV = motionResults.reduce((sum, m) => sum + m.motionCV, 0) / motionResults.length;
  const motionCVs = motionResults.map(m => m.motionCV);
  const cvVariance = motionCVs.reduce((sum, cv) => sum + Math.pow(cv - avgMotionCV, 2), 0) / motionCVs.length;
  const cvStdDev = Math.sqrt(cvVariance);
  const avgFrameDiff = motionResults.reduce((sum, m) => sum + m.avgDiff, 0) / motionResults.length;
  
  let suddenChanges = 0;
  for (let i = 1; i < motionResults.length; i++) {
    const diff = Math.abs(motionResults[i].avgDiff - motionResults[i-1].avgDiff);
    if (diff > motionResults[i-1].avgDiff * 2) suddenChanges++;
  }
  
  // === EDGE STABILITY ANALYSIS ===
  const avgStabilityRatio = edgeResults.reduce((sum, e) => sum + e.stabilityRatio, 0) / edgeResults.length;
  const avgFlickerRatio = edgeResults.reduce((sum, e) => sum + e.flickerRatio, 0) / edgeResults.length;
  const maxFlickerRatio = Math.max(...edgeResults.map(e => e.flickerRatio));
  const avgDisappearing = edgeResults.reduce((sum, e) => sum + e.disappearingEdges, 0) / edgeResults.length;
  
  // === MOTION-FLICKER CORRELATION ===
  const hasSignificantMotion = avgFrameDiff > 5 || avgMotionCV > 60;
  const hasLowFlicker = avgFlickerRatio < 0.05;
  const hasHighFlicker = avgFlickerRatio > 0.20;
  
  // Expected flicker based on motion
  const expectedFlicker = Math.min(0.4, avgFrameDiff * 0.015 + 0.02);
  const flickerRatio = expectedFlicker > 0 ? avgFlickerRatio / expectedFlicker : 1;
  
  // === SCORING ===
  let aiScore = 0;
  let authenticScore = 0;
  const indicators = [];
  
  // Strong signal: motion with unnaturally stable edges
  if (hasSignificantMotion && hasLowFlicker) {
    aiScore += 25;
    indicators.push(`Unnatural smoothness: motion ${avgFrameDiff.toFixed(1)} but ${(avgFlickerRatio * 100).toFixed(1)}% flicker`);
  }
  
  // Motion-flicker correlation checks (KEY IMPROVEMENT)
  if (flickerRatio < 0.25) {
    // Very low flicker relative to motion - strong AI signal
    aiScore += 20;
    indicators.push(`Very low flicker (${Math.round(flickerRatio * 100)}% of expected)`);
  } else if (flickerRatio < 0.55) {
    // Moderately low flicker - suspicious
    aiScore += 12;
    indicators.push(`Reduced flicker (${Math.round(flickerRatio * 100)}% of expected)`);
  } else if (flickerRatio >= 0.70 && flickerRatio <= 1.4) {
    // Natural correlation
    authenticScore += 15;
    indicators.push('Natural motion-flicker correlation');
  } else if (flickerRatio > 2.0 && avgFrameDiff < 10) {
    // Too much flicker for the motion - AI morphing artifacts
    aiScore += 10;
    indicators.push(`Excess flicker (${Math.round(flickerRatio * 100)}% of expected)`);
  }
  
  // Uniform motion pattern (AI smoothness)
  if (avgMotionCV < 40 && cvStdDev < 15) {
    aiScore += 10;
    indicators.push(`Uniform motion (CV: ${avgMotionCV.toFixed(1)})`);
  }
  
  // Natural motion variation
  if (avgMotionCV > 70 && avgMotionCV < 160 && cvStdDev > 20) {
    authenticScore += 8;
    indicators.push(`Natural motion variation (CV: ${avgMotionCV.toFixed(1)})`);
  }
  
  // Sudden motion changes
  if (suddenChanges >= 3) {
    aiScore += 8;
    indicators.push(`${suddenChanges} sudden motion changes`);
  }
  
  // High flicker WITH high motion = natural camera movement
  if (hasHighFlicker && avgFrameDiff > 15) {
    authenticScore += 12;
    indicators.push('Motion-correlated flicker (natural)');
  }
  
  // Very low motion (static AI video)
  if (avgFrameDiff < 2) {
    aiScore += 8;
    indicators.push('Unnaturally static');
  }
  
  // Edge stability during motion
  if (avgStabilityRatio > 0.82 && hasSignificantMotion) {
    aiScore += 8;
    indicators.push(`Too stable during motion (${(avgStabilityRatio * 100).toFixed(1)}%)`);
  } else if (avgStabilityRatio < 0.5) {
    aiScore += 10;
    indicators.push(`Poor edge stability (${(avgStabilityRatio * 100).toFixed(1)}%)`);
  }
  
  // Flicker spike
  if (maxFlickerRatio > 0.35) {
    aiScore += 6;
    indicators.push(`Flicker spike (${(maxFlickerRatio * 100).toFixed(1)}%)`);
  }
  
  // Determine verdict
  const netScore = aiScore - authenticScore;
  let verdict;
  
  if (netScore >= 20) {
    verdict = 'LIKELY_AI';
  } else if (netScore >= 8) {
    verdict = 'POSSIBLY_AI';
  } else if (netScore <= -12) {
    verdict = 'LIKELY_AUTHENTIC';
  } else if (netScore <= -4) {
    verdict = 'POSSIBLY_AUTHENTIC';
  } else {
    verdict = 'INCONCLUSIVE';
  }
  
  return {
    success: true,
    opticalFlow: {
      avgMotionCV: Math.round(avgMotionCV * 10) / 10,
      cvStdDev: Math.round(cvStdDev * 10) / 10,
      avgFrameDiff: Math.round(avgFrameDiff * 10) / 10,
      suddenChanges
    },
    edgeStability: {
      avgStabilityRatio: Math.round(avgStabilityRatio * 1000) / 1000,
      avgFlickerRatio: Math.round(avgFlickerRatio * 1000) / 1000,
      maxFlickerRatio: Math.round(maxFlickerRatio * 1000) / 1000,
      avgDisappearing: Math.round(avgDisappearing)
    },
    correlation: {
      expectedFlicker: Math.round(expectedFlicker * 1000) / 1000,
      flickerRatio: Math.round(flickerRatio * 100) / 100
    },
    aiScore,
    authenticScore,
    indicators,
    verdict,
    framesAnalyzed: analysisResults.framesAnalyzed
  };
}

async function analyzeMotion(videoPath, framePaths = null) {
  console.log('🎬 Analyzing motion patterns...');
  
  if (!framePaths || framePaths.length === 0) {
    return {
      success: false,
      error: 'Frame paths required',
      aiScore: 0,
      authenticScore: 0
    };
  }
  
  const analysisResults = await analyzeFrameMotion(framePaths);
  const scores = calculateMotionScores(analysisResults);
  
  if (scores.success) {
    console.log(`   Motion: diff=${scores.opticalFlow.avgFrameDiff} CV=${scores.opticalFlow.avgMotionCV}`);
    console.log(`   Flicker: ${(scores.edgeStability.avgFlickerRatio * 100).toFixed(1)}% (${Math.round(scores.correlation.flickerRatio * 100)}% of expected)`);
    console.log(`   Scores: AI ${scores.aiScore} | Auth ${scores.authenticScore} → ${scores.verdict}`);
  }
  
  return scores;
}

function getMotionSummary(result) {
  if (!result.success) return 'unavailable';
  return `diff:${result.opticalFlow.avgFrameDiff} flicker:${Math.round(result.correlation.flickerRatio * 100)}% → ${result.verdict}`;
}

module.exports = {
  analyzeMotion,
  analyzeFrameMotion,
  calculateMotionScores,
  getMotionSummary
};
