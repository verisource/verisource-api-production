/**
 * Wikimedia Commons Hash Collector for VeriSource
 * 
 * Crawls Wikimedia Commons for images, generates pHash,
 * and stores to database with rich metadata.
 * 
 * Features:
 * - No authentication required
 * - Rich metadata (author, license, date, categories)
 * - Historical backfill capability
 * - ~200 requests/sec allowed (very generous)
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
const REQUEST_DELAY = 1000; // 1 second between requests (conservative)

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
  errors: 0,
  startTime: Date.now()
};

// Continue token for pagination
let continueToken = null;

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'VeriSource/1.0 (Content Verification Service; https://verisource.io; contact@verisource.io)'
      }
    };

    https.get(url, options, (res) => {
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
    }).on('error', reject);
  });
}

/**
 * Download image from URL
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    
    const options = {
      headers: {
        'User-Agent': 'VeriSource/1.0 (Content Verification Service)'
      }
    };

    protocol.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
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
    artist: extmeta.Artist?.value?.replace(/<[^>]*>/g, '') || null, // Strip HTML
    description: extmeta.ImageDescription?.value?.replace(/<[^>]*>/g, '')?.slice(0, 500) || null,
    categories: extmeta.Categories?.value || null,
    dateOriginal: extmeta.DateTimeOriginal?.value || null,
    gpsLat: extmeta.GPSLatitude?.value || null,
    gpsLon: extmeta.GPSLongitude?.value || null
  };
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
      data.author, // Store in author_handle
      data.license, // Store license in author_did for now
      data.post_created_at
    ]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('DB save error:', err.message);
    return false;
  }
}

/**
 * Process a single image
 */
async function processImage(title, metadata) {
  try {
    if (!metadata?.url) return;

    // Skip non-image files
    if (!metadata.mime?.startsWith('image/')) return;
    
    // Skip very large files (>10MB)
    if (metadata.size > 10 * 1024 * 1024) return;

    // Skip SVG (can't hash well)
    if (metadata.mime === 'image/svg+xml') return;

    stats.imagesFound++;

    // Download image
    const imageBuffer = await downloadImage(metadata.url);

    // Generate hashes
    const [phash, sha256] = await Promise.all([
      generatePHash(imageBuffer),
      generateSHA256(imageBuffer)
    ]);

    if (!phash) {
      stats.errors++;
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
      const shortTitle = title.replace('File:', '').slice(0, 50);
      console.log(`✅ Saved: ${shortTitle}... [${metadata.license || 'unknown'}]`);
    }

  } catch (err) {
    stats.errors++;
    if (process.env.DEBUG) {
      console.error(`Image error: ${err.message}`);
    }
  }
}

/**
 * Fetch recent uploads
 */
async function fetchRecentUploads() {
  let url = `${API_BASE}?action=query&list=allimages&ailimit=${BATCH_SIZE}&aisort=timestamp&aidir=descending&format=json`;
  
  if (continueToken) {
    url += `&aicontinue=${encodeURIComponent(continueToken)}`;
  }

  try {
    console.log('📥 Fetching recent uploads from Commons...');
    const data = await fetchJson(url);
    stats.requestsMade++;

    // Update continue token
    continueToken = data.continue?.aicontinue || null;

    const images = data.query?.allimages || [];
    
    if (images.length === 0) {
      console.log('No images found in batch');
      return;
    }

    // Get full metadata for these images
    const titles = images.map(img => img.name);
    const infoPages = await getImageInfo(titles.map(t => `File:${t}`));

    // Process each image
    for (const [pageId, pageInfo] of Object.entries(infoPages)) {
      if (pageId === '-1') continue; // Missing page
      
      const title = pageInfo.title;
      const metadata = extractMetadata(pageInfo);
      
      await processImage(title, metadata);
      
      // Small delay between image downloads
      await new Promise(resolve => setTimeout(resolve, 100));
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
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Rate: ${rate.toFixed(1)} images/min`);
}

/**
 * Main crawl loop
 */
async function crawlLoop() {
  while (true) {
    await fetchRecentUploads();
    
    // Wait between batches
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Starting Wikimedia Commons Hash Collector');
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`📋 Batch size: ${BATCH_SIZE} images per request`);

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