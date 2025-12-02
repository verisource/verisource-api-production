/**
 * Bitrate Anomaly Detection for Video AI Detection
 */

const { spawn } = require('child_process');

async function analyzeBitrate(filePath) {
  try {
    const frameData = await getFrameBitrates(filePath);
    
    if (!frameData || frameData.length < 5) {
      return { success: false, error: 'Insufficient frame data', frameCount: frameData ? frameData.length : 0 };
    }
    
    const bitrates = frameData.map(f => f.size);
    const stats = calculateBitrateStats(bitrates);
    const analysis = analyzeBitratePatterns(stats, frameData);
    
    return {
      success: true,
      frameCount: frameData.length,
      stats: stats,
      analysis: analysis,
      aiScore: analysis.aiScore,
      authenticScore: analysis.authenticScore,
      verdict: analysis.verdict,
      indicators: analysis.indicators
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getFrameBitrates(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-select_streams', 'v:0', '-show_entries', 'packet=size,pts_time,flags', '-of', 'json', filePath];
    const ffprobe = spawn('ffprobe', args);
    let stdout = '';
    
    ffprobe.stdout.on('data', (data) => { stdout += data.toString(); });
    ffprobe.on('close', (code) => {
      if (code !== 0) { reject(new Error('ffprobe failed')); return; }
      try {
        const data = JSON.parse(stdout);
        const packets = data.packets || [];
        const frames = [];
        let currentFrameSize = 0, currentTime = 0, isKeyframe = false;
        
        for (const packet of packets) {
          const size = parseInt(packet.size) || 0;
          const time = parseFloat(packet.pts_time) || 0;
          const flags = packet.flags || '';
          
          if (flags.includes('K')) {
            if (currentFrameSize > 0) frames.push({ size: currentFrameSize, time: currentTime, isKeyframe: isKeyframe });
            currentFrameSize = size; currentTime = time; isKeyframe = true;
          } else {
            currentFrameSize += size; isKeyframe = false;
          }
        }
        if (currentFrameSize > 0) frames.push({ size: currentFrameSize, time: currentTime, isKeyframe: isKeyframe });
        resolve(frames);
      } catch (parseErr) { reject(new Error('Failed to parse ffprobe output')); }
    });
    ffprobe.on('error', (err) => { reject(new Error('ffprobe spawn error: ' + err.message)); });
  });
}

function calculateBitrateStats(bitrates) {
  if (!bitrates || bitrates.length === 0) return null;
  
  const n = bitrates.length;
  const sum = bitrates.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = bitrates.map(b => Math.pow(b - mean, 2)).reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;
  
  const changes = [];
  for (let i = 1; i < bitrates.length; i++) {
    const change = Math.abs(bitrates[i] - bitrates[i-1]);
    changes.push(bitrates[i-1] > 0 ? (change / bitrates[i-1]) * 100 : 0);
  }
  
  const similarFrames = bitrates.filter(b => Math.abs(b - mean) / mean < 0.05).length;
  
  return {
    count: n, mean: Math.round(mean), stdDev: Math.round(stdDev),
    cv: parseFloat(cv.toFixed(2)), min: Math.min(...bitrates), max: Math.max(...bitrates),
    avgFrameChange: parseFloat((changes.reduce((a, b) => a + b, 0) / changes.length || 0).toFixed(2)),
    maxFrameChange: parseFloat((Math.max(...changes) || 0).toFixed(2)),
    similarityRatio: parseFloat((similarFrames / n).toFixed(3))
  };
}

function analyzeBitratePatterns(stats, frameData) {
  if (!stats) return { aiScore: 0, authenticScore: 0, verdict: 'UNKNOWN', indicators: ['Insufficient data'] };
  
  let aiScore = 0, authenticScore = 0;
  const indicators = [];
  
  if (stats.cv < 15) { aiScore += 30; indicators.push('Very consistent bitrate (CV: ' + stats.cv + '%) - AI-like'); }
  else if (stats.cv < 25) { aiScore += 15; indicators.push('Low bitrate variation (CV: ' + stats.cv + '%)'); }
  else if (stats.cv > 40) { authenticScore += 20; indicators.push('Natural bitrate variation (CV: ' + stats.cv + '%)'); }
  else if (stats.cv > 30) { authenticScore += 10; indicators.push('Moderate bitrate variation (CV: ' + stats.cv + '%)'); }
  
  if (stats.similarityRatio > 0.6) { aiScore += 25; indicators.push('High frame similarity (' + Math.round(stats.similarityRatio * 100) + '%)'); }
  else if (stats.similarityRatio > 0.4) { aiScore += 10; indicators.push('Moderate frame similarity'); }
  else if (stats.similarityRatio < 0.2) { authenticScore += 15; indicators.push('Natural frame variation'); }
  
  if (stats.avgFrameChange < 10) { aiScore += 20; indicators.push('Low frame-to-frame variation - AI-like'); }
  else if (stats.avgFrameChange > 30) { authenticScore += 15; indicators.push('High frame-to-frame variation - natural'); }
  
  if (stats.maxFrameChange < 50 && stats.count > 10) { aiScore += 10; indicators.push('No significant bitrate spikes'); }
  else if (stats.maxFrameChange > 150) { authenticScore += 10; indicators.push('Natural bitrate spikes detected'); }
  
  let verdict = 'UNCERTAIN';
  if (aiScore >= 50) verdict = 'SUSPICIOUS_BITRATE';
  else if (aiScore >= 30) verdict = 'POSSIBLY_SYNTHETIC';
  else if (authenticScore >= 30) verdict = 'NATURAL_BITRATE';
  else if (authenticScore >= 15) verdict = 'LIKELY_NATURAL';
  
  return { aiScore, authenticScore, verdict, indicators };
}

module.exports = { analyzeBitrate };
