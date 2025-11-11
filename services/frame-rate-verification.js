/**
 * Frame Rate Consistency Verification
 * Detects edited sections by checking frame rate consistency
 * Inconsistent frame rates often indicate spliced/edited content
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function analyzeFrameRate(videoPath) {
  try {
    // Use ffprobe to get detailed frame information
    const { stdout } = await execPromise(
      `ffprobe -v quiet -select_streams v:0 -count_frames -show_entries stream=r_frame_rate,avg_frame_rate,nb_read_frames,duration -of json "${videoPath}"`
    );
    
    const data = JSON.parse(stdout);
    const stream = data.streams[0];
    
    if (!stream) {
      return { error: 'No video stream found' };
    }
    
    // Parse frame rates (format: "30000/1001" or "30/1")
    const rFrameRate = parseFraction(stream.r_frame_rate);
    const avgFrameRate = parseFraction(stream.avg_frame_rate);
    const totalFrames = parseInt(stream.nb_read_frames || 0);
    const duration = parseFloat(stream.duration || 0);
    
    // Calculate actual frame rate
    const actualFrameRate = duration > 0 ? totalFrames / duration : 0;
    
    // Check consistency (allow 2% variance)
    const variance = Math.abs(rFrameRate - avgFrameRate) / rFrameRate;
    const isConsistent = variance < 0.02; // Less than 2% difference
    
    const result = {
      declared_fps: Math.round(rFrameRate * 100) / 100,
      average_fps: Math.round(avgFrameRate * 100) / 100,
      actual_fps: Math.round(actualFrameRate * 100) / 100,
      total_frames: totalFrames,
      duration_seconds: Math.round(duration * 100) / 100,
      is_consistent: isConsistent,
      variance_percent: Math.round(variance * 10000) / 100,
      warnings: []
    };
    
    // Add warnings for suspicious patterns
    if (!isConsistent) {
      result.warnings.push('Frame rate inconsistency detected - possible editing or splicing');
    }
    
    if (variance > 0.1) {
      result.warnings.push(`High frame rate variance (${result.variance_percent}%) - likely edited`);
    }
    
    // Check for common editing patterns
    if (Math.abs(rFrameRate - 30) < 0.1 && Math.abs(avgFrameRate - 24) < 0.1) {
      result.warnings.push('Mixed 30fps and 24fps content - indicates editing or format conversion');
    }
    
    return result;
    
  } catch (error) {
    console.error('Frame rate analysis error:', error.message);
    return { error: error.message };
  }
}

function parseFraction(fractionStr) {
  if (!fractionStr) return 0;
  const [num, den] = fractionStr.split('/').map(Number);
  return den ? num / den : num;
}

module.exports = { analyzeFrameRate };
