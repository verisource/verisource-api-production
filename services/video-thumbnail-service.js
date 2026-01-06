// =============================================
// VIDEO THUMBNAIL SERVICE
// Extracts thumbnail frames from videos
// =============================================

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');

class VideoThumbnailService {
  
  /**
   * Extract a thumbnail from a video file
   * @param {string} videoPath - Path to video file
   * @param {object} options - Options
   * @returns {object} - { success, thumbnail_base64, thumbnail_path, dimensions }
   */
  static async extractThumbnail(videoPath, options = {}) {
    const {
      timestamp = '00:00:01',  // Default: 1 second in
      width = 320,             // Thumbnail width
      outputPath = null,       // If provided, save to file
      format = 'jpg',
      quality = 80
    } = options;
    
    const requestId = Date.now();
    const tempPath = outputPath || path.join(os.tmpdir(), `thumb_${requestId}.${format}`);
    
    try {
      // Get video duration first
      const duration = await this.getVideoDuration(videoPath);
      
      // Pick a good timestamp (25% into video, or 1 second, whichever is less)
      let seekTime = Math.min(duration * 0.25, 1);
      if (duration < 1) seekTime = 0;
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .on('end', resolve)
          .on('error', reject)
          .screenshots({
            timestamps: [seekTime],
            filename: path.basename(tempPath),
            folder: path.dirname(tempPath),
            size: `${width}x?`  // Maintain aspect ratio
          });
      });
      
      // Check if file was created
      if (!fs.existsSync(tempPath)) {
        throw new Error('Thumbnail generation failed - no output file');
      }
      
      // Get dimensions
      const sharp = require('sharp');
      const metadata = await sharp(tempPath).metadata();
      
      // Read as base64
      const thumbnailBuffer = fs.readFileSync(tempPath);
      const thumbnail_base64 = `data:image/${format};base64,${thumbnailBuffer.toString('base64')}`;
      
      // Cleanup temp file unless outputPath was specified
      if (!outputPath) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      
      return {
        success: true,
        thumbnail_base64,
        thumbnail_path: outputPath || null,
        dimensions: {
          width: metadata.width,
          height: metadata.height
        },
        source_timestamp: seekTime,
        video_duration: duration
      };
      
    } catch (error) {
      console.error('⚠️ Thumbnail extraction error:', error.message);
      
      // Cleanup on error
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
      
      return {
        success: false,
        error: error.message,
        thumbnail_base64: null,
        thumbnail_path: null
      };
    }
  }
  
  /**
   * Get video duration in seconds
   */
  static async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          resolve(10); // Default to 10 seconds on error
        } else {
          resolve(metadata.format.duration || 10);
        }
      });
    });
  }
  
  /**
   * Extract multiple thumbnails (for video preview strip)
   */
  static async extractThumbnailStrip(videoPath, count = 5, width = 160) {
    try {
      const duration = await this.getVideoDuration(videoPath);
      const interval = duration / (count + 1);
      const thumbnails = [];
      
      for (let i = 1; i <= count; i++) {
        const timestamp = interval * i;
        const result = await this.extractThumbnail(videoPath, {
          timestamp: timestamp,
          width: width
        });
        
        if (result.success) {
          thumbnails.push({
            index: i,
            timestamp: timestamp,
            thumbnail_base64: result.thumbnail_base64,
            dimensions: result.dimensions
          });
        }
      }
      
      return {
        success: true,
        count: thumbnails.length,
        video_duration: duration,
        thumbnails
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        thumbnails: []
      };
    }
  }
}

module.exports = VideoThumbnailService;