/**
 * Video Audio Analysis
 * Analyzes audio track characteristics to detect AI-generated videos
 * AI videos often have: no audio, synthetic audio, or mismatched audio
 */

const ffmpeg = require('fluent-ffmpeg');

/**
 * Extract audio info from video using ffprobe
 */
function getAudioInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
      const videoStreams = metadata.streams.filter(s => s.codec_type === 'video');
      
      resolve({
        hasAudio: audioStreams.length > 0,
        audioStreamCount: audioStreams.length,
        videoStreamCount: videoStreams.length,
        audioStreams: audioStreams.map(s => ({
          codec: s.codec_name,
          sampleRate: s.sample_rate,
          channels: s.channels,
          bitrate: s.bit_rate,
          duration: s.duration
        })),
        videoDuration: videoStreams[0]?.duration || metadata.format?.duration,
        format: metadata.format
      });
    });
  });
}

/**
 * Analyze audio characteristics for AI detection
 */
async function analyzeVideoAudio(videoPath) {
  const result = {
    hasAudio: false,
    aiScore: 0,
    authenticScore: 0,
    indicators: [],
    audioQuality: null,
    suspiciousPatterns: [],
    verdict: 'UNKNOWN'
  };

  try {
    // Get audio info
    const audioInfo = await getAudioInfo(videoPath);
    result.hasAudio = audioInfo.hasAudio;
    result.audioInfo = audioInfo;

    // No audio = suspicious for most videos
    if (!audioInfo.hasAudio) {
      result.aiScore += 35;
      result.indicators.push('No audio track - common in AI-generated videos');
      result.suspiciousPatterns.push('missing_audio');
      result.verdict = 'SUSPICIOUS';
      return result;
    }

    const audioStream = audioInfo.audioStreams[0];

    // Check audio codec
    if (audioStream.codec === 'aac') {
      result.authenticScore += 10;
      result.indicators.push('AAC codec (standard for device recordings)');
    } else if (audioStream.codec === 'mp3') {
      result.aiScore += 5;
      result.indicators.push('MP3 codec (possibly re-encoded)');
    } else if (audioStream.codec === 'opus') {
      result.aiScore += 10;
      result.indicators.push('Opus codec (often from screen recording/streaming)');
    } else if (audioStream.codec === 'pcm_s16le' || audioStream.codec === 'pcm_f32le') {
      result.aiScore += 15;
      result.indicators.push('Raw PCM audio (unusual for camera recording)');
    }

    // Check sample rate
    const sampleRate = parseInt(audioStream.sampleRate);
    if (sampleRate === 48000) {
      result.authenticScore += 10;
      result.indicators.push('48kHz sample rate (standard for video recording)');
    } else if (sampleRate === 44100) {
      result.authenticScore += 5;
      result.indicators.push('44.1kHz sample rate (CD quality)');
    } else if (sampleRate === 16000 || sampleRate === 22050) {
      result.aiScore += 20;
      result.indicators.push(`Low sample rate (${sampleRate}Hz) - common in AI/TTS audio`);
      result.suspiciousPatterns.push('low_sample_rate');
    }

    // Check channels
    if (audioStream.channels === 2) {
      result.authenticScore += 10;
      result.indicators.push('Stereo audio (typical for device recording)');
    } else if (audioStream.channels === 1) {
      result.aiScore += 10;
      result.indicators.push('Mono audio (common in AI-generated or synthetic audio)');
      result.suspiciousPatterns.push('mono_audio');
    }

    // Check audio/video duration match
    const videoDuration = parseFloat(audioInfo.videoDuration);
    const audioDuration = parseFloat(audioStream.duration);
    
    if (videoDuration && audioDuration) {
      const durationDiff = Math.abs(videoDuration - audioDuration);
      
      if (durationDiff < 0.1) {
        result.authenticScore += 10;
        result.indicators.push('Audio/video duration match perfectly');
      } else if (durationDiff > 1) {
        result.aiScore += 25;
        result.indicators.push(`Audio/video duration mismatch (${durationDiff.toFixed(1)}s) - suspicious`);
        result.suspiciousPatterns.push('duration_mismatch');
      }
    }

    // Check bitrate
    const bitrate = parseInt(audioStream.bitrate);
    if (bitrate) {
      if (bitrate >= 128000) {
        result.authenticScore += 5;
        result.indicators.push(`Good audio bitrate (${Math.round(bitrate/1000)}kbps)`);
      } else if (bitrate < 64000) {
        result.aiScore += 15;
        result.indicators.push(`Low audio bitrate (${Math.round(bitrate/1000)}kbps) - possibly synthetic`);
        result.suspiciousPatterns.push('low_bitrate');
      }
    }

    // Calculate final scores
    result.aiScore = Math.max(0, Math.min(100, result.aiScore));
    result.authenticScore = Math.max(0, Math.min(100, result.authenticScore));

    // Determine verdict
    if (result.aiScore >= 50) {
      result.verdict = 'SUSPICIOUS_AUDIO';
    } else if (result.aiScore >= 30) {
      result.verdict = 'POSSIBLY_SYNTHETIC';
    } else if (result.authenticScore >= 30) {
      result.verdict = 'LIKELY_AUTHENTIC';
    } else {
      result.verdict = 'UNKNOWN';
    }

  } catch (err) {
    result.error = err.message;
    result.indicators.push(`Audio analysis error: ${err.message}`);
  }

  return result;
}

/**
 * Quick check for AI audio patterns
 */
function hasAISuspiciousAudio(audioAnalysis) {
  if (!audioAnalysis) return false;
  
  return (
    !audioAnalysis.hasAudio ||
    audioAnalysis.aiScore >= 40 ||
    audioAnalysis.suspiciousPatterns?.includes('missing_audio') ||
    audioAnalysis.suspiciousPatterns?.includes('low_sample_rate')
  );
}

/**
 * Apply audio analysis results to overall AI score
 * @param {Object} videoAnalysis - Current video analysis results
 * @param {Object} audioAnalysis - Audio analysis results
 * @returns {Object} Updated video analysis with audio factors
 */
function applyAudioAnalysisToScore(videoAnalysis, audioAnalysis) {
  if (!audioAnalysis || audioAnalysis.error) {
    return videoAnalysis;
  }

  const result = { ...videoAnalysis };
  
  // Initialize audio_analysis section
  result.audio_analysis = {
    hasAudio: audioAnalysis.hasAudio,
    aiScore: audioAnalysis.aiScore,
    authenticScore: audioAnalysis.authenticScore,
    verdict: audioAnalysis.verdict,
    indicators: audioAnalysis.indicators,
    suspiciousPatterns: audioAnalysis.suspiciousPatterns
  };

  // Adjust AI confidence based on audio
  if (!audioAnalysis.hasAudio) {
    // No audio is suspicious - increase AI confidence
    const boost = 15;
    result.ai_confidence = Math.min(100, (result.ai_confidence || 0) + boost);
    result.audio_analysis.adjustment = `+${boost}% AI confidence (no audio track)`;
  } else if (audioAnalysis.aiScore >= 40) {
    // Suspicious audio patterns
    const boost = Math.round(audioAnalysis.aiScore * 0.3);
    result.ai_confidence = Math.min(100, (result.ai_confidence || 0) + boost);
    result.audio_analysis.adjustment = `+${boost}% AI confidence (suspicious audio)`;
  } else if (audioAnalysis.authenticScore >= 30) {
    // Authentic audio signals - slight reduction
    const reduction = Math.round(audioAnalysis.authenticScore * 0.2);
    result.ai_confidence = Math.max(0, (result.ai_confidence || 0) - reduction);
    result.audio_analysis.adjustment = `-${reduction}% AI confidence (authentic audio signals)`;
  }

  return result;
}

module.exports = {
  analyzeVideoAudio,
  getAudioInfo,
  hasAISuspiciousAudio,
  applyAudioAnalysisToScore
};