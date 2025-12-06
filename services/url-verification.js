/**
 * URL Verification Service
 * Downloads media from URLs using yt-dlp and prepares for verification
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Supported platforms (yt-dlp handles 1000+ but these are reliable)
const SUPPORTED_PLATFORMS = [
  { name: 'YouTube', patterns: ['youtube.com', 'youtu.be'] },
  { name: 'TikTok', patterns: ['tiktok.com'] },
  { name: 'Twitter', patterns: ['twitter.com', 'x.com'] },
  { name: 'Reddit', patterns: ['reddit.com', 'redd.it'] },
  { name: 'Vimeo', patterns: ['vimeo.com'] },
  { name: 'Twitch', patterns: ['twitch.tv', 'clips.twitch.tv'] },
  { name: 'Instagram', patterns: ['instagram.com'] },
  { name: 'Facebook', patterns: ['facebook.com', 'fb.watch'] },
  { name: 'Telegram', patterns: ['t.me', 'telegram.me'] },
  { name: 'Direct', patterns: ['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.gif'] }
];

/**
 * Check if URL is from a supported platform
 */
function detectPlatform(url) {
  const urlLower = url.toLowerCase();
  
  for (const platform of SUPPORTED_PLATFORMS) {
    if (platform.patterns.some(p => urlLower.includes(p))) {
      return platform.name;
    }
  }
  
  return 'Unknown';
}

/**
 * Validate URL format
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download media from URL using yt-dlp
 * @param {string} url - Media URL
 * @param {string} outputDir - Directory to save downloaded file
 * @returns {Promise<Object>} Download result with file path and metadata
 */
async function downloadMedia(url, outputDir = '/tmp') {
  const result = {
    success: false,
    file_path: null,
    filename: null,
    platform: null,
    media_type: null,
    metadata: {},
    error: null
  };

  // Validate URL
  if (!isValidUrl(url)) {
    result.error = 'Invalid URL format';
    return result;
  }

  // Detect platform
  result.platform = detectPlatform(url);
  console.log(`🌐 Detected platform: ${result.platform}`);

  // Generate unique filename
  const fileId = crypto.randomBytes(8).toString('hex');
  const outputTemplate = path.join(outputDir, `verisource_${fileId}.%(ext)s`);

  try {
    // First, get metadata without downloading
    console.log('📋 Fetching media metadata...');
    const metadataJson = execSync(
      `yt-dlp --dump-json --no-download "${url}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    
    const metadata = JSON.parse(metadataJson);
    result.metadata = {
      title: metadata.title || null,
      description: metadata.description?.substring(0, 500) || null,
      uploader: metadata.uploader || metadata.channel || null,
      upload_date: metadata.upload_date ? formatDate(metadata.upload_date) : null,
      duration: metadata.duration || null,
      view_count: metadata.view_count || null,
      like_count: metadata.like_count || null,
      thumbnail: metadata.thumbnail || null,
      original_url: metadata.webpage_url || url,
      extractor: metadata.extractor || null
    };

    // Determine if video or image
    const isImage = metadata.ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(metadata.ext.toLowerCase());
    result.media_type = isImage ? 'image' : 'video';

    console.log(`📥 Downloading ${result.media_type}...`);

    // Download the media
    const downloadArgs = [
      '-o', outputTemplate,
      '--no-playlist',
      '--max-filesize', '100M',
    ];

    // For videos, get best quality up to 1080p
    if (result.media_type === 'video') {
      downloadArgs.push('-f', 'best[height<=1080]/best');
    }

    downloadArgs.push(url);

    execSync(`yt-dlp ${downloadArgs.map(a => `"${a}"`).join(' ')}`, {
      encoding: 'utf-8',
      timeout: 120000,  // 2 minute timeout
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Find the downloaded file
    const files = fs.readdirSync(outputDir).filter(f => f.startsWith(`verisource_${fileId}`));
    
    if (files.length === 0) {
      result.error = 'Download completed but file not found';
      return result;
    }

    result.file_path = path.join(outputDir, files[0]);
    result.filename = files[0];
    result.success = true;

    // Get file size
    const stats = fs.statSync(result.file_path);
    result.metadata.file_size = stats.size;

    console.log(`✅ Downloaded: ${result.filename} (${formatBytes(stats.size)})`);

  } catch (err) {
    console.error('❌ Download error:', err.message);
    
    // Parse common errors
    if (err.message.includes('Video unavailable')) {
      result.error = 'Video unavailable or private';
    } else if (err.message.includes('Login required')) {
      result.error = 'Login required - content may be private';
    } else if (err.message.includes('429') || err.message.includes('rate limit')) {
      result.error = 'Rate limited by platform - try again later';
    } else if (err.message.includes('not supported')) {
      result.error = 'URL not supported';
    } else if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
      result.error = 'Download timed out';
    } else {
      result.error = err.message.substring(0, 200);
    }
  }

  return result;
}

/**
 * Format YYYYMMDD to ISO date
 */
function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Clean up downloaded file
 */
function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up: ${path.basename(filePath)}`);
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

/**
 * Get supported platforms list
 */
function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS.map(p => ({
    name: p.name,
    reliability: ['YouTube', 'TikTok', 'Twitter', 'Reddit', 'Vimeo'].includes(p.name) ? 'high' : 'medium'
  }));
}

module.exports = {
  downloadMedia,
  detectPlatform,
  isValidUrl,
  cleanupFile,
  getSupportedPlatforms
};