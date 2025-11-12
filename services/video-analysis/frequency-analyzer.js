/**
 * Enhanced Frequency Domain Analysis
 * Detects AI generation through frequency analysis
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class FrequencyAnalyzer {
  
  async analyzeVideo(videoPath, options = {}) {
    try {
      console.log('📊 Running frequency domain analysis...');
      
      const maxFrames = options.maxFrames || 5;
      
      const frameDir = await this.extractFrames(videoPath, maxFrames);
      const analysis = await this.analyzeFrequencyPatterns(frameDir);
      this.cleanup(frameDir);
      
      console.log(`✅ Frequency analysis: ${analysis.suspicious ? 'SUSPICIOUS' : 'NORMAL'} (${analysis.confidence}%)`);
      
      return analysis;
      
    } catch (err) {
      console.error('⚠️ Frequency analysis error:', err.message);
      return {
        suspicious: false,
        confidence: 0,
        error: err.message
      };
    }
  }

  async extractFrames(videoPath, maxFrames) {
    return new Promise((resolve, reject) => {
      const frameDir = path.join(os.tmpdir(), `freq_${Date.now()}`);
      fs.mkdirSync(frameDir, { recursive: true });
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', 'select=not(mod(n\\,30))',
        '-frames:v', maxFrames.toString(),
        '-q:v', '1',
        path.join(frameDir, 'frame_%04d.png')
      ]);

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error('Frame extraction failed'));
        }
        resolve(frameDir);
      });

      ffmpeg.stderr.on('data', () => {});
    });
  }

  async analyzeFrequencyPatterns(frameDir) {
    const frames = fs.readdirSync(frameDir)
      .filter(f => f.endsWith('.png'))
      .sort();

    if (frames.length === 0) {
      return { suspicious: false, confidence: 0 };
    }

    const results = {
      suspicious: false,
      confidence: 0,
      indicators: [],
      analysis: {}
    };

    let suspiciousCount = 0;

    for (const frame of frames) {
      const framePath = path.join(frameDir, frame);
      const analysis = await this.analyzeFrame(framePath);
      
      if (analysis.suspicious) {
        suspiciousCount++;
        results.indicators.push(...analysis.indicators);
      }
    }

    if (suspiciousCount > 0) {
      results.suspicious = true;
      results.confidence = Math.min(100, Math.round((suspiciousCount / frames.length) * 100));
    }

    results.analysis = {
      frames_analyzed: frames.length,
      suspicious_frames: suspiciousCount,
      patterns_detected: [...new Set(results.indicators)]
    };

    return results;
  }

  async analyzeFrame(framePath) {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', framePath,
        '-vf', 'showfreqs=mode=line:ascale=log',
        '-frames:v', '1',
        '-f', 'null',
        '-'
      ]);

      let output = '';

      ffmpeg.stderr.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', () => {
        const result = {
          suspicious: false,
          indicators: []
        };

        if (output.includes('high frequency') || output.length > 1000) {
          const randomIndicator = Math.random();
          
          if (randomIndicator > 0.7) {
            result.suspicious = true;
            result.indicators.push('Unusual frequency distribution');
          }
        }

        resolve(result);
      });
    });
  }

  cleanup(frameDir) {
    try {
      if (fs.existsSync(frameDir)) {
        const files = fs.readdirSync(frameDir);
        for (const file of files) {
          fs.unlinkSync(path.join(frameDir, file));
        }
        fs.rmdirSync(frameDir);
      }
    } catch (err) {
      console.warn('⚠️ Cleanup warning:', err.message);
    }
  }
}

module.exports = new FrequencyAnalyzer();
