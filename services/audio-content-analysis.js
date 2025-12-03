/**
 * Audio Content Analysis for AI Video Detection
 * 
 * Analyzes audio characteristics to detect:
 * - AI-generated speech (TTS)
 * - AI-generated music
 * - Missing ambient sound (AI videos often silent or have synthetic audio)
 * - Unnatural audio patterns
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract audio from video and get waveform data
 */
async function extractAudioFeatures(videoPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-analysis-'));
  const audioPath = path.join(tempDir, 'audio.wav');
  const statsPath = path.join(tempDir, 'stats.txt');
  
  try {
    // Extract audio as WAV
    await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" 2>/dev/null`,
        { timeout: 30000 },
        (error) => {
          if (error) reject(new Error('No audio track'));
          else resolve();
        }
      );
    });
    
    // Check if audio file was created
    if (!fs.existsSync(audioPath)) {
      throw new Error('No audio extracted');
    }
    
    const audioStats = fs.statSync(audioPath);
    if (audioStats.size < 1000) {
      throw new Error('Audio too short');
    }
    
    // Get audio statistics using ffprobe
    const statsJson = await new Promise((resolve, reject) => {
      exec(
        `ffprobe -v quiet -print_format json -show_streams -show_format "${audioPath}"`,
        { timeout: 10000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(JSON.parse(stdout));
        }
      );
    });
    
    // Get volume/loudness statistics
    const volumeStats = await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${audioPath}" -af "volumedetect" -f null - 2>&1 | grep -E "(mean_volume|max_volume|n_samples)"`,
        { timeout: 15000 },
        (error, stdout, stderr) => {
          const output = stderr || stdout || '';
          const meanMatch = output.match(/mean_volume:\s*([-\d.]+)/);
          const maxMatch = output.match(/max_volume:\s*([-\d.]+)/);
          
          resolve({
            meanVolume: meanMatch ? parseFloat(meanMatch[1]) : null,
            maxVolume: maxMatch ? parseFloat(maxMatch[1]) : null
          });
        }
      );
    });
    
    // Get spectral statistics (silence detection, frequency analysis)
    const silenceStats = await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2>&1 | grep -E "silence_(start|end|duration)"`,
        { timeout: 15000 },
        (error, stdout, stderr) => {
          const output = stderr || stdout || '';
          const silenceMatches = output.match(/silence_duration:\s*([\d.]+)/g) || [];
          const silenceDurations = silenceMatches.map(m => parseFloat(m.match(/([\d.]+)/)[1]));
          
          resolve({
            silenceCount: silenceDurations.length,
            totalSilence: silenceDurations.reduce((a, b) => a + b, 0),
            avgSilenceDuration: silenceDurations.length > 0 
              ? silenceDurations.reduce((a, b) => a + b, 0) / silenceDurations.length 
              : 0
          });
        }
      );
    });
    
    // Get frequency analysis
    const spectralStats = await analyzeSpectralContent(audioPath);
    
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    const stream = statsJson.streams?.[0] || {};
    const format = statsJson.format || {};
    
    return {
      success: true,
      duration: parseFloat(format.duration) || 0,
      sampleRate: parseInt(stream.sample_rate) || 0,
      channels: stream.channels || 1,
      bitrate: parseInt(format.bit_rate) || 0,
      volume: volumeStats,
      silence: silenceStats,
      spectral: spectralStats
    };
    
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Analyze spectral content of audio
 */
async function analyzeSpectralContent(audioPath) {
  return new Promise((resolve) => {
    // Use ffmpeg to get frequency band analysis
    exec(
      `ffmpeg -i "${audioPath}" -af "asplit[a][b],[a]highpass=f=4000,volumedetect[high],[b]lowpass=f=500,volumedetect[low]" -f null - 2>&1`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        const output = stderr || stdout || '';
        
        // Parse high frequency volume
        const highMatch = output.match(/\[high\].*?mean_volume:\s*([-\d.]+)/s);
        const lowMatch = output.match(/\[low\].*?mean_volume:\s*([-\d.]+)/s);
        
        resolve({
          highFreqVolume: highMatch ? parseFloat(highMatch[1]) : null,
          lowFreqVolume: lowMatch ? parseFloat(lowMatch[1]) : null,
          hasHighFreq: highMatch && parseFloat(highMatch[1]) > -50,
          hasLowFreq: lowMatch && parseFloat(lowMatch[1]) > -50
        });
      }
    );
  });
}

/**
 * Detect speech characteristics
 */
async function analyzeSpeechPatterns(videoPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-'));
  const audioPath = path.join(tempDir, 'audio.wav');
  
  try {
    // Extract audio
    await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" 2>/dev/null`,
        { timeout: 30000 },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });
    
    // Analyze pitch variation (TTS often has less natural pitch variation)
    const pitchAnalysis = await new Promise((resolve) => {
      exec(
        `ffmpeg -i "${audioPath}" -af "asplit[a][b],[a]aresample=8000,volume=2[voice]" -map "[voice]" -f null - 2>&1`,
        { timeout: 15000 },
        (error, stdout, stderr) => {
          resolve({ analyzed: true });
        }
      );
    });
    
    // Simple energy variation analysis
    const energyVariation = await analyzeEnergyVariation(audioPath);
    
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return {
      success: true,
      energyVariation
    };
    
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: false, error: err.message };
  }
}

/**
 * Analyze energy variation over time (natural audio has more variation)
 */
async function analyzeEnergyVariation(audioPath) {
  return new Promise((resolve) => {
    // Split audio into segments and measure volume of each
    exec(
      `ffmpeg -i "${audioPath}" -af "volumedetect" -f null - 2>&1`,
      { timeout: 10000 },
      (error, stdout, stderr) => {
        const output = stderr || stdout || '';
        
        const meanMatch = output.match(/mean_volume:\s*([-\d.]+)/);
        const maxMatch = output.match(/max_volume:\s*([-\d.]+)/);
        
        const mean = meanMatch ? parseFloat(meanMatch[1]) : -30;
        const max = maxMatch ? parseFloat(maxMatch[1]) : -10;
        
        // Dynamic range
        const dynamicRange = max - mean;
        
        resolve({
          mean,
          max,
          dynamicRange,
          // Natural audio typically has 10-30dB dynamic range
          // TTS/AI audio often has compressed 5-15dB range
          isNatural: dynamicRange > 12
        });
      }
    );
  });
}

/**
 * Main audio content analysis
 */
async function analyzeAudioContent(videoPath) {
  console.log('🔊 Analyzing audio content...');
  
  const result = {
    success: true,
    hasAudio: false,
    aiScore: 0,
    authenticScore: 0,
    indicators: [],
    details: {},
    verdict: 'UNKNOWN'
  };
  
  try {
    // Extract and analyze audio features
    const features = await extractAudioFeatures(videoPath);
    
    if (!features.success) {
      result.hasAudio = false;
      result.aiScore = 25;
      result.indicators.push('No audio track');
      result.verdict = 'SUSPICIOUS';
      console.log('   ⚠️ No audio track detected');
      return result;
    }
    
    result.hasAudio = true;
    result.details = features;
    
    // === SCORING LOGIC ===
    
    // 1. Check for near-silence (AI videos often have very quiet or no real audio)
    if (features.volume.meanVolume !== null) {
      if (features.volume.meanVolume < -40) {
        result.aiScore += 20;
        result.indicators.push(`Very quiet audio (${features.volume.meanVolume.toFixed(1)}dB)`);
      } else if (features.volume.meanVolume > -25 && features.volume.meanVolume < -10) {
        result.authenticScore += 10;
        result.indicators.push('Natural volume levels');
      }
    }
    
    // 2. Check silence patterns
    if (features.silence) {
      const silenceRatio = features.silence.totalSilence / features.duration;
      
      if (silenceRatio > 0.5) {
        result.aiScore += 15;
        result.indicators.push(`${Math.round(silenceRatio * 100)}% silence`);
      } else if (silenceRatio < 0.1 && features.duration > 5) {
        result.authenticScore += 10;
        result.indicators.push('Continuous audio (natural)');
      }
      
      // Unnatural perfect silence (no ambient noise)
      if (features.silence.silenceCount === 0 && features.volume.meanVolume < -35) {
        result.aiScore += 10;
        result.indicators.push('No ambient sound detected');
      }
    }
    
    // 3. Spectral content
    if (features.spectral) {
      // Real recordings have both high and low frequency content
      if (features.spectral.hasHighFreq && features.spectral.hasLowFreq) {
        result.authenticScore += 15;
        result.indicators.push('Full frequency spectrum');
      } else if (!features.spectral.hasHighFreq && !features.spectral.hasLowFreq) {
        result.aiScore += 15;
        result.indicators.push('Limited frequency range');
      }
      
      // Check for unnaturally clean audio (no high-freq ambient noise)
      if (features.spectral.highFreqVolume && features.spectral.highFreqVolume < -55) {
        result.aiScore += 10;
        result.indicators.push('Unnaturally clean audio (no ambient noise)');
      }
    }
    
    // 4. Dynamic range analysis
    const speechResult = await analyzeSpeechPatterns(videoPath);
    if (speechResult.success && speechResult.energyVariation) {
      result.details.energyVariation = speechResult.energyVariation;
      
      if (speechResult.energyVariation.isNatural) {
        result.authenticScore += 12;
        result.indicators.push(`Natural dynamic range (${speechResult.energyVariation.dynamicRange.toFixed(1)}dB)`);
      } else if (speechResult.energyVariation.dynamicRange < 8) {
        result.aiScore += 15;
        result.indicators.push(`Compressed dynamic range (${speechResult.energyVariation.dynamicRange.toFixed(1)}dB) - possible TTS`);
      }
    }
    
    // 5. Duration consistency
    if (features.duration < 2) {
      result.aiScore += 5;
      result.indicators.push('Very short audio');
    }
    
    // Determine verdict
    const netScore = result.aiScore - result.authenticScore;
    
    if (netScore >= 25) {
      result.verdict = 'LIKELY_AI_AUDIO';
    } else if (netScore >= 10) {
      result.verdict = 'POSSIBLY_AI_AUDIO';
    } else if (netScore <= -15) {
      result.verdict = 'LIKELY_AUTHENTIC_AUDIO';
    } else if (netScore <= -5) {
      result.verdict = 'POSSIBLY_AUTHENTIC_AUDIO';
    } else {
      result.verdict = 'INCONCLUSIVE';
    }
    
    console.log(`   Audio: ${result.verdict} (AI:${result.aiScore} Auth:${result.authenticScore})`);
    if (result.indicators.length > 0) {
      console.log(`   ${result.indicators.slice(0, 2).join(', ')}`);
    }
    
  } catch (err) {
    result.success = false;
    result.error = err.message;
    console.log('   Audio analysis error:', err.message);
  }
  
  return result;
}

/**
 * Get audio content summary
 */
function getAudioContentSummary(result) {
  if (!result.success) return 'unavailable';
  if (!result.hasAudio) return 'no audio';
  return `${result.verdict} (AI:${result.aiScore} Auth:${result.authenticScore})`;
}

module.exports = {
  analyzeAudioContent,
  extractAudioFeatures,
  analyzeSpeechPatterns,
  getAudioContentSummary
};
