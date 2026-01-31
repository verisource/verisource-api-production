/**
 * Wikimedia Commons Hash Collector for VeriSource
 * 
 * Crawls Wikimedia Commons for images, generates pHash,
 * and stores to database with rich metadata.
 * 
 * FIXED: Proper User-Agent, retry logic, and rate limiting
 */

const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const imghash = require('imghash');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const API_BASE = 'https://commons.wikimedia.org/w/api.php';
const BATCH_SIZE = 50; // Images per request
const REQUEST_DELAY = 3000; // 3 seconds between API requests
const DOWNLOAD_DELAY = 500; // 500ms between image downloads (more conservative)
const MAX_RETRIES = 3; // Retry failed downloads
const RETRY_DELAY = 1000; // 1 second between retries

// FIXED: Proper User-Agent with contact info (required by Wikimedia)
const USER_AGENT = 'VeriSource/1.0 (Content Verification Service; https://verisource.io; contact@verisource.io)';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Stats tracking
let stats = {
  requestsMade: 0,
  imagesFound: 0,
  imagesHashed: 0,
  imagesSaved: 0,
  skippedNoUrl: 0,
  skippedNotImage: 0,
  skippedTooLarge: 0,
  skippedDownload: 0,
  skippedHash: 0,
  skippedDuplicate: 0,
  retriesSucceeded: 0,
  errors: 0,
  startTime: Date.now()
};

// Continue token for pagination
let continueToken = null;

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch JSON from URL with timeout
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': USER_AGENT
      },
      timeout: 30000
    };

    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Download image from URL with timeout and retries
 * FIXED: Proper User-Agent and retry logic
 */
async function downloadImage(url, maxSize = 5 * 1024 * 1024, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    
    const options = {
      headers: {
        'User-Agent': USER_AGENT,  // FIXED: Full User-Agent with contact info
        'Accept': 'image/*',
        'Accept-Encoding': 'identity'  // Don't request compressed (simpler)
      },
      timeout: 30000
    };

    const req = protocol.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, maxSize, retryCount).then(resolve).catch(reject);
        return;
      }

      // Handle rate limiting
      if (res.statusCode === 429 || res.statusCode === 503) {
        if (retryCount < MAX_RETRIES) {
          const retryAfter = parseInt(res.headers['retry-after']) || RETRY_DELAY;
          console.log(`   ⏳ Rate limited, waiting ${retryAfter}ms...`);
          setTimeout(() => {
            downloadImage(url, maxSize, retryCount + 1).then(resolve).catch(reject);
          }, retryAfter);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      let totalSize = 0;

      res.on('data', chunk => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          req.destroy();
          reject(new Error('File too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', (err) => {
      // Retry on network errors
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => {
          downloadImage(url, maxSize, retryCount + 1)
            .then((result) => {
              stats.retriesSucceeded++;
              resolve(result);
            })
            .catch(reject);
        }, RETRY_DELAY * (retryCount + 1));
      } else {
        reject(err);
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => {
          downloadImage(url, maxSize, retryCount + 1)
            .then((result) => {
              stats.retriesSucceeded++;
              resolve(result);
            })
            .catch(reject);
        }, RETRY_DELAY * (retryCount + 1));
      } else {
        reject(new Error('Download timeout'));
      }
    });
  });
}

/**
 * Generate perceptual hash from image buffer
 */
async function generatePHash(imageBuffer) {
  try {
    const normalizedBuffer = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'fill' })
      .grayscale()
      .png()
      .toBuffer();

    const tempPath = path.join(os.tmpdir(), `hash_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tempPath, normalizedBuffer);

    const hash = await imghash.hash(tempPath, 16);
    fs.unlinkSync(tempPath);

    return hash;
  } catch (err) {
    return null;
  }
}

/**
 * Generate SHA256 hash from buffer
 */
function generateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get image info including metadata
 */
async function getImageInfo(titles) {
  const url = `${API_BASE}?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=url|user|timestamp|size|mime|extmetadata&format=json`;
  
  try {
    const data = await fetchJson(url);
    stats.requestsMade++;
    return data.query?.pages || {};
  } catch (err) {
    stats.errors++;
    console.error(`API error: ${err.message}`);
    return {};
  }
}

/**
 * Extract metadata from Commons API response
 */
function extractMetadata(imageInfo) {
  const info = imageInfo.imageinfo?.[0];
  if (!info) return null;

  const extmeta = info.extmetadata || {};
  
  return {
    url: info.url,
    thumbUrl: info.thumburl,
    user: info.user,
    timestamp: info.timestamp,
    size: info.size,
    width: info.width,
    height: info.height,
    mime: info.mime,
    license: extmeta.LicenseShortName?.value || null,
    licenseUrl: extmeta.LicenseUrl?.value || null,
    artist: extmeta.Artist?.value?.replace(/<[^>]*>/g, '') || null,
    description: extmeta.ImageDescription?.value?.replace(/<[^>]*>/g, '')?.slice(0, 500) || null,
    categories: extmeta.Categories?.value || null,
    dateOriginal: extmeta.DateTimeOriginal?.value || null,
    gpsLat: extmeta.GPSLatitude?.value || null,
    gpsLon: extmeta.GPSLongitude?.value || null
  };
}

/**
 * Check if image already exists in database
 */
async function imageExists(sourceId) {
  try {
    const result = await pool.query(
      'SELECT id FROM media_hashes WHERE source = $1 AND source_id = $2',
      ['wikimedia', sourceId]
    );
    return result.rows.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Save hash to database with metadata
 */
async function saveHash(data) {
  const query = `
    INSERT INTO media_hashes (
      phash, sha256, source, source_id, source_url, 
      author_handle, author_did, post_created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [
      data.phash,
      data.sha256,
      'wikimedia',
      data.source_id,
      data.source_url,
      data.author,
      data.license,
      data.post_created_at
    ]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('DB save error:', err.message);
    return false;
  }
}

/**
 * Get thumbnail URL for smaller download
 * FIXED: Use smaller thumbnails instead of full resolution
 */
function getThumbnailUrl(originalUrl, maxWidth = 800) {
  // Wikimedia thumbnail URL pattern
  // Original: https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg
  // Thumb: https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/800px-Example.jpg
  
  if (originalUrl.includes('/commons/thumb/')) {
    // Already a thumbnail
    return originalUrl;
  }
  
  const match = originalUrl.match(/\/commons\/([a-f0-9])\/([a-f0-9]{2})\/(.+)$/i);
  if (match) {
    const [, first, second, filename] = match;
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${first}/${second}/${filename}/${maxWidth}px-${filename}`;
  }
  
  // Can't transform, use original
  return originalUrl;
}

/**
 * Process a single image
 */
async function processImage(title, metadata) {
  try {
    // Check for URL
    if (!metadata?.url) {
      stats.skippedNoUrl++;
      return;
    }

    // Check mime type
    const validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validMimes.includes(metadata.mime)) {
      stats.skippedNotImage++;
      return;
    }
    
    // Skip very large files (>5MB) - but we'll try thumbnail first
    const useOriginal = metadata.size <= 2 * 1024 * 1024; // Use original if under 2MB
    
    // FIXED: Check for duplicates before downloading
    if (await imageExists(title)) {
      stats.skippedDuplicate++;
      return;
    }

    stats.imagesFound++;

    // FIXED: Try thumbnail first for large files
    let imageBuffer;
    let downloadUrl = useOriginal ? metadata.url : getThumbnailUrl(metadata.url, 800);
    
    try {
      imageBuffer = await downloadImage(downloadUrl);
    } catch (err) {
      // If thumbnail fails, try original (if not already tried)
      if (!useOriginal && metadata.size <= 5 * 1024 * 1024) {
        try {
          imageBuffer = await downloadImage(metadata.url);
        } catch (err2) {
          stats.skippedDownload++;
          return;
        }
      } else {
        stats.skippedDownload++;
        return;
      }
    }

    // Generate hashes
    const [phash, sha256] = await Promise.all([
      generatePHash(imageBuffer),
      generateSHA256(imageBuffer)
    ]);

    if (!phash) {
      stats.skippedHash++;
      return;
    }

    stats.imagesHashed++;

    // Save to database
    const saved = await saveHash({
      phash,
      sha256,
      source_id: title,
      source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      author: metadata.artist || metadata.user,
      license: metadata.license,
      post_created_at: metadata.timestamp ? new Date(metadata.timestamp) : new Date()
    });

    if (saved) {
      stats.imagesSaved++;
      const shortTitle = title.replace('File:', '').slice(0, 40);
      console.log(`✅ Saved: ${shortTitle}... [${metadata.license || 'unknown'}]`);
    }

  } catch (err) {
    stats.errors++;
    console.error(`Process error: ${err.message}`);
  }
}

/**
 * Fetch recent uploads - images only
 */
async function fetchRecentUploads() {
  // Use aimime to filter to images only
  let url = `${API_BASE}?action=query&list=allimages&ailimit=${BATCH_SIZE}&aisort=timestamp&aidir=descending&aiprop=timestamp|url|size|mime|user&format=json`;
  
  if (continueToken) {
    url += `&aicontinue=${encodeURIComponent(continueToken)}`;
  }

  try {
    console.log('📥 Fetching recent uploads from Commons...');
    const data = await fetchJson(url);
    stats.requestsMade++;

    // Update continue token
    continueToken = data.continue?.aicontinue || null;

    const allImages = data.query?.allimages || [];
    
    // Filter to only actual image files
    const images = allImages.filter(img => 
      /\.(jpg|jpeg|png|gif|webp)$/i.test(img.name)
    );

    console.log(`   Found ${images.length} images (filtered from ${allImages.length})`);

    if (images.length === 0) {
      return;
    }

    // Get full metadata for these images
    const titles = images.map(img => `File:${img.name}`);
    const infoPages = await getImageInfo(titles);

    // Process each image
    for (const [pageId, pageInfo] of Object.entries(infoPages)) {
      if (pageId === '-1') continue;
      
      const title = pageInfo.title;
      const metadata = extractMetadata(pageInfo);
      
      await processImage(title, metadata);
      
      // FIXED: More conservative delay between image downloads
      await sleep(DOWNLOAD_DELAY);
    }

  } catch (err) {
    stats.errors++;
    console.error(`Fetch error: ${err.message}`);
  }
}

/**
 * Print stats
 */
function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.imagesSaved / (uptime / 60) || 0;

  console.log(`\n📊 Stats (${uptime}s uptime):`);
  console.log(`   Requests made: ${stats.requestsMade}`);
  console.log(`   Images found: ${stats.imagesFound}`);
  console.log(`   Images hashed: ${stats.imagesHashed}`);
  console.log(`   Images saved: ${stats.imagesSaved}`);
  console.log(`   Rate: ${rate.toFixed(1)} images/min`);
  console.log(`   Retries succeeded: ${stats.retriesSucceeded}`);
  console.log(`   Skipped:`);
  console.log(`     - Duplicate: ${stats.skippedDuplicate}`);
  console.log(`     - No URL: ${stats.skippedNoUrl}`);
  console.log(`     - Not image: ${stats.skippedNotImage}`);
  console.log(`     - Too large: ${stats.skippedTooLarge}`);
  console.log(`     - Download fail: ${stats.skippedDownload}`);
  console.log(`     - Hash fail: ${stats.skippedHash}`);
  console.log(`   Errors: ${stats.errors}`);
}

/**
 * Main crawl loop
 */
async function crawlLoop() {
  while (true) {
    await fetchRecentUploads();
    
    // Wait between batches
    await sleep(REQUEST_DELAY);
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Starting Wikimedia Commons Hash Collector');
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`📋 Batch size: ${BATCH_SIZE} images per request`);
  console.log(`⏱️  Download delay: ${DOWNLOAD_DELAY}ms`);
  console.log(`🔄 Max retries: ${MAX_RETRIES}`);

  // Test database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Start stats printer
  setInterval(printStats, 60000);

  // Start crawl loop
  crawlLoop();
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  printStats();
  await pool.end();
  process.exit(0);
});

main();