/**
 * Temporal Inconsistency Detection
 * Detects frame-to-frame inconsistencies that indicate AI generation
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class TemporalInconsistencyDetector {
  
  async analyzeVideo(videoPath, options = {}) {
    try {
      console.log('⏱️ Analyzing temporal consistency...');
      
      const maxFrames = options.maxFrames || 30;
      const fps = options.fps || 1;
      
      const frameDir = await this.extractFrames(videoPath, fps, maxFrames);
      const inconsistencies = await this.detectInconsistencies(frameDir);
      this.cleanup(frameDir);
      
      const result = this.calculateResults(inconsistencies, maxFrames);
      
      console.log(`✅ Temporal analysis: ${inconsistencies.length} inconsistencies found`);
      
      return result;
      
    } catch (err) {
      console.error('⚠️ Temporal analysis error:', err.message);
      return {
        inconsistencies_detected: false,
        confidence: 0,
        error: err.message
      };
    }
  }

  async extractFrames(videoPath, fps, maxFrames) {
    return new Promise((resolve, reject) => {
      const frameDir = path.join(os.tmpdir(), `frames_${Date.now()}`);
      fs.mkdirSync(frameDir, { recursive: true });
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', `fps=${fps}`,
        '-frames:v', maxFrames.toString(),
        '-q:v', '2',
        path.join(frameDir, 'frame_%04d.jpg')
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

  async detectInconsistencies(frameDir) {
    const inconsistencies = [];
    const frames = fs.readdirSync(frameDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (frames.length < 2) {
      return inconsistencies;
    }

    for (let i = 0; i < frames.length - 1; i++) {
      const frame1 = path.join(frameDir, frames[i]);
      const frame2 = path.join(frameDir, frames[i + 1]);
      
      const diff = await this.compareFrames(frame1, frame2);
      
      if (diff.suspicious) {
        inconsistencies.push({
          frames: [i + 1, i + 2],
          type: diff.type,
          severity: diff.severity,
          details: diff.details
        });
      }
    }

    return inconsistencies;
  }

  async compareFrames(frame1Path, frame2Path) {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', frame1Path,
        '-i', frame2Path,
        '-filter_complex',
        '[0:v][1:v]blend=all_mode=difference,format=gray,showinfo',
        '-f', 'null',
        '-'
      ]);

      let output = '';

      ffmpeg.stderr.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', () => {
        try {
          const result = {
            suspicious: false,
            type: '',
            severity: 0,
            details: {}
          };

          const meanMatch = output.match(/mean:\[\s*([\d.]+)\s*[\d.]+\s*[\d.]+\]/);
          if (meanMatch) {
            const meanDiff = parseFloat(meanMatch[1]);
            result.details.mean_difference = meanDiff.toFixed(2);

            if (meanDiff > 50) {
              result.suspicious = true;
              result.type = 'large_frame_jump';
              result.severity = Math.min(100, Math.round(meanDiff));
              result.details.description = 'Unnatural frame-to-frame change';
            }
            
            if (meanDiff < 1) {
              result.suspicious = true;
              result.type = 'frozen_frame';
              result.severity = 40;
              result.details.description = 'Frame appears frozen or duplicated';
            }
          }

          resolve(result);
          
        } catch (err) {
          resolve({
            suspicious: false,
            type: 'analysis_error',
            severity: 0,
            details: { error: err.message }
          });
        }
      });
    });
  }

  calculateResults(inconsistencies, totalFrames) {
    const result = {
      inconsistencies_detected: inconsistencies.length > 0,
      count: inconsistencies.length,
      confidence: 0,
      severity: 'low',
      details: [],
      frames_analyzed: totalFrames
    };

    if (inconsistencies.length === 0) {
      result.confidence = 0;
      return result;
    }

    const avgSeverity = inconsistencies.reduce((sum, inc) => sum + inc.severity, 0) / inconsistencies.length;
    const inconsistencyRate = inconsistencies.length / totalFrames;

    result.confidence = Math.min(100, Math.round(
      (inconsistencyRate * 50) + (avgSeverity * 0.5)
    ));

    if (result.confidence > 70) {
      result.severity = 'high';
    } else if (result.confidence > 40) {
      result.severity = 'medium';
    }

    result.details = inconsistencies.slice(0, 5).map(inc => ({
      frames: `${inc.frames[0]}-${inc.frames[1]}`,
      type: inc.type,
      severity: inc.severity + '%'
    }));

    return result;
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

module.exports = new TemporalInconsistencyDetector();
