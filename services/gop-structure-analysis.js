
/**
 * GOP Structure Analysis for Video AI Detection
 * Analyzes I/B/P frame distribution and GOP patterns to detect AI-generated videos
 * 
 * Key indicators:
 * - I-frame percentage: AI videos often 10-100%, real devices 1-3%
 * - B-frame presence: Often missing in AI-generated videos
 * - GOP length consistency: Real devices have consistent GOP intervals
 * - GOP patterns: Known device signatures (iPhone=30, Android=varies)
 */

const { execSync, exec } = require('child_process');
const path = require('path');

/**
 * Extract frame type information using ffprobe
 * @param {string} videoPath - Path to video file
 * @returns {Promise<Object>} Frame analysis results
 */
async function extractFrameTypes(videoPath) {
  return new Promise((resolve, reject) => {
    // Use ffprobe to get frame types for first 300 frames (10 sec at 30fps)
    const cmd = `ffprobe -v quiet -select_streams v:0 -show_frames -show_entries frame=pict_type,key_frame,pts_time -of csv=p=0 "${videoPath}" 2>/dev/null | head -300`;
    
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Try alternative approach with just frame count
        const altCmd = `ffprobe -v quiet -select_streams v:0 -count_frames -show_entries stream=nb_read_frames,codec_name -of csv=p=0 "${videoPath}" 2>/dev/null`;
        exec(altCmd, { timeout: 15000 }, (altError, altStdout) => {
          if (altError) {
            resolve({ success: false, error: error.message });
            return;
          }
          resolve({ 
            success: true, 
            frames: [],
            limited: true,
            totalFrames: parseInt(altStdout.trim().split(',')[0]) || 0
          });
        });
        return;
      }
      
      const lines = stdout.trim().split('\n').filter(l => l.length > 0);
      const frames = [];
      
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 3) {
          // Format is: key_frame, pts_time, pict_type
          // pict_type may have extra text (e.g., 'I,H.26...' on first frame)
          let frameType = parts[2].charAt(0).toUpperCase(); // Take just first char (I, P, or B)
          if (!['I', 'P', 'B'].includes(frameType)) {
            frameType = 'unknown';
          }
          frames.push({
            type: frameType,
            keyFrame: parts[0] === '1',
            pts: parts[1] ? parseFloat(parts[1]) : null
          });
        }
      }
      
      resolve({ success: true, frames, limited: false });
    });
  });
}

/**
 * Analyze GOP structure from frame data
 * @param {Array} frames - Array of frame objects with type info
 * @returns {Object} GOP analysis results
 */
function analyzeGOPStructure(frames) {
  if (!frames || frames.length === 0) {
    return {
      success: false,
      error: 'No frame data available'
    };
  }
  
  // Count frame types
  const counts = { I: 0, P: 0, B: 0, unknown: 0 };
  const iFramePositions = [];
  
  frames.forEach((frame, index) => {
    const type = (frame.type || '').toUpperCase();
    if (type === 'I') {
      counts.I++;
      iFramePositions.push(index);
    } else if (type === 'P') {
      counts.P++;
    } else if (type === 'B') {
      counts.B++;
    } else {
      counts.unknown++;
    }
  });
  
  const totalFrames = frames.length;
  const iFramePercentage = (counts.I / totalFrames) * 100;
  const bFramePercentage = (counts.B / totalFrames) * 100;
  const pFramePercentage = (counts.P / totalFrames) * 100;
  
  // Calculate GOP lengths (distance between I-frames)
  const gopLengths = [];
  for (let i = 1; i < iFramePositions.length; i++) {
    gopLengths.push(iFramePositions[i] - iFramePositions[i - 1]);
  }
  
  // GOP statistics
  let gopStats = {
    avgLength: 0,
    minLength: 0,
    maxLength: 0,
    standardDeviation: 0,
    consistency: 0, // 0-100, higher = more consistent
    commonLength: null
  };
  
  if (gopLengths.length > 0) {
    gopStats.avgLength = gopLengths.reduce((a, b) => a + b, 0) / gopLengths.length;
    gopStats.minLength = Math.min(...gopLengths);
    gopStats.maxLength = Math.max(...gopLengths);
    
    // Standard deviation
    const variance = gopLengths.reduce((sum, val) => sum + Math.pow(val - gopStats.avgLength, 2), 0) / gopLengths.length;
    gopStats.standardDeviation = Math.sqrt(variance);
    
    // Coefficient of variation (lower = more consistent)
    const cv = (gopStats.standardDeviation / gopStats.avgLength) * 100;
    gopStats.consistency = Math.max(0, 100 - cv);
    
    // Find most common GOP length
    const lengthCounts = {};
    gopLengths.forEach(len => {
      lengthCounts[len] = (lengthCounts[len] || 0) + 1;
    });
    const sortedLengths = Object.entries(lengthCounts).sort((a, b) => b[1] - a[1]);
    if (sortedLengths.length > 0) {
      gopStats.commonLength = parseInt(sortedLengths[0][0]);
    }
  }
  
  return {
    success: true,
    totalFrames,
    frameCounts: counts,
    percentages: {
      iFrame: Math.round(iFramePercentage * 10) / 10,
      pFrame: Math.round(pFramePercentage * 10) / 10,
      bFrame: Math.round(bFramePercentage * 10) / 10
    },
    gopStats,
    iFramePositions: iFramePositions.slice(0, 20), // First 20 for debugging
    gopLengths: gopLengths.slice(0, 20)
  };
}

/**
 * Known device GOP patterns
 */
const DEVICE_GOP_PATTERNS = {
  // Apple devices typically use GOP of 30 or 60
  apple: { lengths: [30, 60, 15], tolerance: 2 },
  // Samsung often uses 30 or variable
  samsung: { lengths: [30, 15, 60], tolerance: 3 },
  // Generic Android can vary widely
  android: { lengths: [30, 15, 60, 120], tolerance: 5 },
  // Professional cameras
  professional: { lengths: [12, 15, 24, 30], tolerance: 1 },
  // Screen recording typically has high I-frame density
  screenRecording: { iFrameMin: 5, iFrameMax: 15 },
  // AI generators often have very high I-frame percentage or all I-frames
  aiTypical: { iFrameMin: 10, allIFrames: true }
};

/**
 * Detect if GOP matches known device patterns
 * @param {Object} gopAnalysis - Results from analyzeGOPStructure
 * @returns {Object} Device pattern matching results
 */
function matchDevicePattern(gopAnalysis) {
  if (!gopAnalysis.success) {
    return { matched: false, device: null };
  }
  
  const { gopStats, percentages } = gopAnalysis;
  const commonLength = gopStats.commonLength;
  const consistency = gopStats.consistency;
  
  // Check for Apple pattern
  if (DEVICE_GOP_PATTERNS.apple.lengths.some(len => Math.abs(commonLength - len) <= DEVICE_GOP_PATTERNS.apple.tolerance)) {
    if (consistency >= 85) {
      return { matched: true, device: 'apple', confidence: consistency };
    }
  }
  
  // Check for Samsung pattern
  if (DEVICE_GOP_PATTERNS.samsung.lengths.some(len => Math.abs(commonLength - len) <= DEVICE_GOP_PATTERNS.samsung.tolerance)) {
    if (consistency >= 75) {
      return { matched: true, device: 'samsung', confidence: consistency };
    }
  }
  
  // Check for professional camera pattern
  if (DEVICE_GOP_PATTERNS.professional.lengths.some(len => Math.abs(commonLength - len) <= DEVICE_GOP_PATTERNS.professional.tolerance)) {
    if (consistency >= 90) {
      return { matched: true, device: 'professional', confidence: consistency };
    }
  }
  
  // Generic consistent GOP suggests real device
  if (consistency >= 80 && commonLength >= 10 && commonLength <= 120) {
    return { matched: true, device: 'generic_device', confidence: consistency };
  }
  
  return { matched: false, device: null };
}

/**
 * Main GOP analysis function
 * @param {string} videoPath - Path to video file
 * @returns {Promise<Object>} Complete GOP analysis with AI scoring
 */
async function analyzeGOP(videoPath) {
  const result = {
    success: false,
    aiScore: 0,
    authenticScore: 0,
    verdict: 'UNKNOWN',
    indicators: [],
    details: {}
  };
  
  try {
    // Extract frame types
    const frameData = await extractFrameTypes(videoPath);
    
    if (!frameData.success) {
      result.error = frameData.error;
      return result;
    }
    
    // If we couldn't get detailed frame info, return limited results
    if (frameData.limited) {
      result.success = true;
      result.limited = true;
      result.details.totalFrames = frameData.totalFrames;
      result.verdict = 'INSUFFICIENT_DATA';
      return result;
    }
    
    // Analyze GOP structure
    const gopAnalysis = analyzeGOPStructure(frameData.frames);
    
    if (!gopAnalysis.success) {
      result.error = gopAnalysis.error;
      return result;
    }
    
    result.success = true;
    result.details = gopAnalysis;
    
    const { percentages, gopStats, frameCounts } = gopAnalysis;
    
    // === AI SCORING ===
    
    // 1. I-frame percentage analysis (strongest indicator)
    if (percentages.iFrame >= 95) {
      // All or nearly all I-frames = very suspicious (common in AI video)
      result.aiScore += 50;
      result.indicators.push('All I-frames (' + percentages.iFrame + '%) - typical of AI generation');
    } else if (percentages.iFrame >= 50) {
      // Very high I-frame percentage
      result.aiScore += 35;
      result.indicators.push('Very high I-frame ratio (' + percentages.iFrame + '%)');
    } else if (percentages.iFrame >= 20) {
      // Elevated I-frame percentage
      result.aiScore += 20;
      result.indicators.push('Elevated I-frame ratio (' + percentages.iFrame + '%)');
    } else if (percentages.iFrame >= 10) {
      // Slightly high
      result.aiScore += 10;
      result.indicators.push('Above-average I-frame ratio (' + percentages.iFrame + '%)');
    } else if (percentages.iFrame <= 5 && percentages.iFrame >= 1) {
      // Normal I-frame percentage for device recording
      result.authenticScore += 15;
      result.indicators.push('Normal I-frame ratio (' + percentages.iFrame + '%)');
    }
    
    // 2. B-frame analysis
    if (frameCounts.B === 0 && gopAnalysis.totalFrames > 30) {
      // No B-frames in a substantial video = suspicious
      result.aiScore += 25;
      result.indicators.push('No B-frames detected - common in AI video');
    } else if (percentages.bFrame >= 30) {
      // Good B-frame usage = authentic indicator
      result.authenticScore += 20;
      result.indicators.push('Healthy B-frame usage (' + percentages.bFrame + '%)');
    } else if (percentages.bFrame >= 10) {
      // Some B-frames
      result.authenticScore += 10;
      result.indicators.push('B-frames present (' + percentages.bFrame + '%)');
    }
    
    // 3. GOP consistency analysis
    if (gopStats.consistency >= 90) {
      // Very consistent GOP = likely real device
      result.authenticScore += 15;
      result.indicators.push('Consistent GOP structure (' + Math.round(gopStats.consistency) + '%)');
    } else if (gopStats.consistency >= 70) {
      // Reasonably consistent
      result.authenticScore += 8;
      result.indicators.push('Moderately consistent GOP (' + Math.round(gopStats.consistency) + '%)');
    } else if (gopStats.consistency < 40 && gopStats.avgLength > 0) {
      // Very inconsistent GOP = suspicious
      result.aiScore += 15;
      result.indicators.push('Irregular GOP structure (' + Math.round(gopStats.consistency) + '% consistency)');
    }
    
    // 4. GOP length analysis
    if (gopStats.commonLength) {
      // Check for typical device GOP lengths
      const typicalLengths = [15, 30, 60, 120];
      const isTypicalLength = typicalLengths.some(len => Math.abs(gopStats.commonLength - len) <= 2);
      
      if (isTypicalLength) {
        result.authenticScore += 10;
        result.indicators.push('Standard GOP length (' + gopStats.commonLength + ' frames)');
      } else if (gopStats.commonLength < 5) {
        // Very short GOP = suspicious
        result.aiScore += 15;
        result.indicators.push('Unusually short GOP (' + gopStats.commonLength + ' frames)');
      } else if (gopStats.commonLength > 150) {
        // Very long GOP = unusual
        result.aiScore += 5;
        result.indicators.push('Unusually long GOP (' + gopStats.commonLength + ' frames)');
      }
    }
    
    // 5. Device pattern matching
    const deviceMatch = matchDevicePattern(gopAnalysis);
    if (deviceMatch.matched) {
      result.authenticScore += 15;
      result.indicators.push('GOP matches ' + deviceMatch.device + ' device pattern (' + Math.round(deviceMatch.confidence) + '%)');
      result.deviceMatch = deviceMatch;
    }
    
    // === FINAL VERDICT ===
    const netScore = result.aiScore - result.authenticScore;
    
    if (netScore >= 40) {
      result.verdict = 'LIKELY_AI';
    } else if (netScore >= 20) {
      result.verdict = 'POSSIBLY_AI';
    } else if (netScore <= -20) {
      result.verdict = 'LIKELY_AUTHENTIC';
    } else if (netScore <= -5) {
      result.verdict = 'POSSIBLY_AUTHENTIC';
    } else {
      result.verdict = 'INCONCLUSIVE';
    }
    
  } catch (error) {
    result.error = error.message;
  }
  
  return result;
}

/**
 * Get display-friendly summary of GOP analysis
 * @param {Object} gopResult - Results from analyzeGOP
 * @returns {string} Human-readable summary
 */
function getGOPSummary(gopResult) {
  if (!gopResult.success) {
    return 'GOP analysis unavailable';
  }
  
  const parts = [];
  const details = gopResult.details;
  
  if (details.percentages) {
    parts.push('I:' + details.percentages.iFrame + '%');
    if (details.percentages.bFrame > 0) {
      parts.push('B:' + details.percentages.bFrame + '%');
    }
  }
  
  if (details.gopStats && details.gopStats.commonLength) {
    parts.push('GOP:' + details.gopStats.commonLength);
  }
  
  return parts.join(' | ') + ' → ' + gopResult.verdict;
}

module.exports = {
  analyzeGOP,
  analyzeGOPStructure,
  extractFrameTypes,
  matchDevicePattern,
  getGOPSummary,
  DEVICE_GOP_PATTERNS
};


