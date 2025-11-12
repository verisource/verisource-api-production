const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { generatePHash, searchSimilarImages } = require('./phash-module');
const { detectAIGeneration } = require('./ai-image-detector');
const { analyzeFrameRate } = require('./services/frame-rate-verification');
const temporalDetector = require('./services/video-analysis/temporal-inconsistency');
const frequencyAnalyzer = require('./services/video-analysis/frequency-analyzer');
async function extractFrames(videoPath, fps = 1) {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(path.dirname(videoPath), 'frames');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPattern = path.join(outputDir, 'frame_%04d.jpg');
    console.log('Extracting frames from video at', fps, 'fps...');
    ffmpeg(videoPath)
      .on('end', () => {
        const frames = fs.readdirSync(outputDir)
          .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
          .map(f => path.join(outputDir, f));
        console.log('Extracted', frames.length, 'frames');
        resolve({ success: true, frameCount: frames.length, frames: frames, outputDir: outputDir });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
        reject(err);
      })
      .outputOptions(['-vf', 'fps=' + fps, '-q:v', '2'])
      .output(outputPattern)
      .run();
  });
}

async function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration,
          format: metadata.format.format_name,
          size: metadata.format.size,
          width: videoStream?.width,
          height: videoStream?.height,
          codec: videoStream?.codec_name
        });
      }
    });
  });
}

async function analyzeVideo(videoPath, options = {}) {
  const fps = options.fps || 1;
  const maxFrames = options.maxFrames || 30;
  // Temporal inconsistency detection
  let temporalAnalysis = null;
  try {
    temporalAnalysis = await temporalDetector.analyzeVideo(videoPath, { fps: 1, maxFrames: 30 });
  } catch (err) {
    console.error('⚠️ Temporal analysis error:', err.message);
  }

  // Frequency domain analysis
  let frequencyAnalysis = null;
  try {
    frequencyAnalysis = await frequencyAnalyzer.analyzeVideo(videoPath, { maxFrames: 5 });
  } catch (err) {
    console.error('⚠️ Frequency analysis error:', err.message);
  }
  try {
    console.log('Starting video analysis...');
    
    // Check frame rate consistency
    console.log('Checking frame rate consistency...');
    const frameRateAnalysis = await analyzeFrameRate(videoPath);
    
    const metadata = await getVideoMetadata(videoPath);
    const extraction = await extractFrames(videoPath, fps);
    const framesToAnalyze = extraction.frames.slice(0, maxFrames);
    console.log('Analyzing', framesToAnalyze.length, 'frames...');
    const frameResults = [];
    let suspiciousFrames = 0;
    let aiGeneratedFrames = 0;
    for (let i = 0; i < framesToAnalyze.length; i++) {
      const framePath = framesToAnalyze[i];
      const frameNumber = i + 1;
      try {
        const phashResult = await generatePHash(framePath);
        const aiDetection = await detectAIGeneration(framePath);
        const frameAnalysis = {
          frameNumber: frameNumber,
          timestamp: (frameNumber - 1) / fps,
          phash: phashResult.success ? phashResult.phash : null,
          aiDetection: aiDetection,
          suspicious: aiDetection.likely_ai_generated || aiDetection.ai_confidence > 50
        };
        if (frameAnalysis.suspicious) suspiciousFrames++;
        if (aiDetection.likely_ai_generated) aiGeneratedFrames++;
        frameResults.push(frameAnalysis);
      } catch (err) {
        console.error('Error analyzing frame', frameNumber, ':', err.message);
      }
    }
    const analyzedFrames = frameResults.filter(f => !f.error).length;
    const suspiciousPercentage = (suspiciousFrames / analyzedFrames) * 100;
    const aiPercentage = (aiGeneratedFrames / analyzedFrames) * 100;
    let videoConfidence = 100;
    let verdict = 'AUTHENTIC';
    if (aiPercentage > 70) {
      videoConfidence = 90;
      verdict = 'LIKELY_AI_GENERATED';
    } else if (aiPercentage > 50) {
      videoConfidence = 75;
      verdict = 'LIKELY_AI_GENERATED';
    } else if (aiPercentage > 30) {
      videoConfidence = 60;
      verdict = 'SUSPICIOUS';
    } else if (suspiciousPercentage > 50) {
      videoConfidence = 50;
      verdict = 'SUSPICIOUS';
    } else if (suspiciousPercentage > 30) {
      videoConfidence = 70;
      verdict = 'POSSIBLY_MANIPULATED';
    } else if (suspiciousPercentage > 10) {
      videoConfidence = 85;
      verdict = 'POSSIBLY_MANIPULATED';
    }
    try {
      fs.rmSync(extraction.outputDir, { recursive: true, force: true });
    } catch (err) {}
    return {
      success: true,
      metadata: metadata,
      analysis: {
        framesAnalyzed: analyzedFrames,
        totalFrames: extraction.frameCount,
        suspiciousFrames: suspiciousFrames,
        aiGeneratedFrames: aiGeneratedFrames,
        suspiciousPercentage: Math.round(suspiciousPercentage),
        aiPercentage: Math.round(aiPercentage),
        videoConfidence: videoConfidence,
        verdict: verdict,
        frameRateAnalysis: frameRateAnalysis,
        temporalAnalysis: temporalAnalysis,
        frequencyAnalysis: frequencyAnalysis
      },
      frames: frameResults.slice(0, 10)
    };
  } catch (error) {
    console.error('Video analysis error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { analyzeVideo, getVideoMetadata, extractFrames };
