/**
 * VeriSource Civitai Crawler
 * 
 * Crawls Civitai's public API to build a database of confirmed AI-generated images
 * for hash lookup (instant matching) and training data collection.
 * 
 * Purpose:
 * 1. Build pHash database of known AI images for millisecond lookups
 * 2. Collect training data for local AI detection model
 * 3. Capture rich metadata (model, prompt, sampler, etc.) for generator attribution
 */

const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');
const sharp = require('sharp');
const imageHash = require('image-hash');
const { promisify } = require('util');

// Configuration
const CONFIG = {
  // Civitai API
  civitaiBaseUrl: 'https://civitai.com/api/v1',
  imagesPerPage: 100,  // Max allowed by API
  
  // Rate limiting (be respectful)
  requestDelayMs: 1000,        // 1 second between API calls
  imageDownloadDelayMs: 200,   // 200ms between image downloads
  maxConcurrentDownloads: 3,
  
  // Crawl settings
  skipNsfw: true,              // Skip NSFW content
  minWidth: 256,               // Skip tiny images
  minHeight: 256,
  maxImagesPerRun: 10000,      // Limit per run to avoid runaway
  
  // Storage
  saveImages: false,           // Set true to save actual images for training
  imageStoragePath: './images',
  
  // Database
  dbTable: 'ai_image_hashes'
};

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Initialize database table for AI image hashes
 */
async function initDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${CONFIG.dbTable} (
      id SERIAL PRIMARY KEY,
      
      -- Source identification
      source VARCHAR(50) NOT NULL DEFAULT 'civitai',
      source_id VARCHAR(100),
      source_url TEXT,
      
      -- Perceptual hashes for matching
      phash VARCHAR(64),
      dhash VARCHAR(64),
      average_hash VARCHAR(64),
      
      -- Cryptographic hash for exact match
      sha256 VARCHAR(64),
      
      -- Image metadata
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      
      -- AI generation metadata (the gold!)
      generator_model VARCHAR(255),
      generator_type VARCHAR(50),  -- 'stable_diffusion', 'midjourney', 'dalle', etc.
      prompt TEXT,
      negative_prompt TEXT,
      sampler VARCHAR(100),
      steps INTEGER,
      cfg_scale FLOAT,
      seed BIGINT,
      
      -- Classification
      nsfw_level VARCHAR(20),
      is_ai_generated BOOLEAN DEFAULT true,
      confidence FLOAT DEFAULT 1.0,
      
      -- Timestamps
      source_created_at TIMESTAMP,
      crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      -- Indexes
      UNIQUE(source, source_id)
    );
    
    -- Create indexes for fast lookups
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_phash ON ${CONFIG.dbTable}(phash);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_dhash ON ${CONFIG.dbTable}(dhash);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_sha256 ON ${CONFIG.dbTable}(sha256);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_generator ON ${CONFIG.dbTable}(generator_model);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_source ON ${CONFIG.dbTable}(source, source_id);
  `;
  
  await pool.query(createTableQuery);
  console.log('✓ Database table initialized');
}

/**
 * Fetch JSON from Civitai API
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'VeriSource-Crawler/1.0 (content-verification-research)',
        'Accept': 'application/json'
      }
    };
    
    // Add API key if available (optional, gets more data)
    if (process.env.CIVITAI_API_KEY) {
      options.headers['Authorization'] = `Bearer ${process.env.CIVITAI_API_KEY}`;
    }
    
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Download image and return buffer
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https.get(url, {
        headers: { 'User-Agent': 'VeriSource-Crawler/1.0' }
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }
        
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    
    request(url);
  });
}

/**
 * Generate perceptual hash from image buffer
 */
async function generatePHash(imageBuffer) {
  try {
    // Resize to 32x32 grayscale for consistent hashing
    const processed = await sharp(imageBuffer)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    // Simple pHash implementation
    // Convert to array of pixel values
    const pixels = Array.from(processed);
    
    // Calculate mean
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    
    // Generate hash: 1 if pixel > mean, 0 otherwise
    let hash = '';
    for (const pixel of pixels) {
      hash += pixel > mean ? '1' : '0';
    }
    
    // Convert binary to hex
    let hexHash = '';
    for (let i = 0; i < hash.length; i += 4) {
      hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
    }
    
    return hexHash;
  } catch (error) {
    console.error('pHash error:', error.message);
    return null;
  }
}

/**
 * Generate difference hash (dHash)
 */
async function generateDHash(imageBuffer) {
  try {
    // Resize to 9x8 grayscale
    const processed = await sharp(imageBuffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    const pixels = Array.from(processed);
    let hash = '';
    
    // Compare adjacent pixels
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[row * 9 + col];
        const right = pixels[row * 9 + col + 1];
        hash += left < right ? '1' : '0';
      }
    }
    
    // Convert to hex
    let hexHash = '';
    for (let i = 0; i < hash.length; i += 4) {
      hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
    }
    
    return hexHash;
  } catch (error) {
    console.error('dHash error:', error.message);
    return null;
  }
}

/**
 * Process a single image from Civitai
 */
async function processImage(imageData) {
  try {
    // Skip NSFW if configured
    if (CONFIG.skipNsfw && imageData.nsfw) {
      return { skipped: true, reason: 'nsfw' };
    }
    
    // Skip small images
    if (imageData.width < CONFIG.minWidth || imageData.height < CONFIG.minHeight) {
      return { skipped: true, reason: 'too_small' };
    }
    
    // Check if already processed
    const existing = await pool.query(
      `SELECT id FROM ${CONFIG.dbTable} WHERE source = 'civitai' AND source_id = $1`,
      [imageData.id.toString()]
    );
    
    if (existing.rows.length > 0) {
      return { skipped: true, reason: 'duplicate' };
    }
    
    // Download image
    const imageBuffer = await downloadImage(imageData.url);
    
    // Generate hashes
    const [phash, dhash] = await Promise.all([
      generatePHash(imageBuffer),
      generateDHash(imageBuffer)
    ]);
    
    const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // Extract metadata from Civitai's meta object
    const meta = imageData.meta || {};
    
    // Insert into database
    await pool.query(`
      INSERT INTO ${CONFIG.dbTable} (
        source, source_id, source_url,
        phash, dhash, sha256,
        width, height, file_size,
        generator_model, generator_type, prompt, negative_prompt,
        sampler, steps, cfg_scale, seed,
        nsfw_level, source_created_at
      ) VALUES (
        'civitai', $1, $2,
        $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18
      )
    `, [
      imageData.id.toString(),
      imageData.url,
      phash,
      dhash,
      sha256,
      imageData.width,
      imageData.height,
      imageBuffer.length,
      meta.Model || meta.model || null,
      'stable_diffusion',  // Civitai is primarily SD
      meta.prompt || null,
      meta.negativePrompt || meta.negative_prompt || null,
      meta.sampler || null,
      meta.steps || null,
      meta.cfgScale || meta.cfg_scale || null,
      meta.seed || null,
      imageData.nsfwLevel || (imageData.nsfw ? 'Mature' : 'None'),
      imageData.createdAt
    ]);
    
    return { success: true, id: imageData.id };
    
  } catch (error) {
    console.error(`\nError processing ${imageData.id}: ${error.message}`);
    return { error: true, message: error.message, id: imageData.id };
  }
}

/**
 * Main crawler function
 */
async function crawl(options = {}) {
  const {
    startCursor = null,
    maxImages = CONFIG.maxImagesPerRun,
    sortBy = 'Most Reactions'  // Gets popular/quality images first
  } = options;
  
  console.log('🚀 Starting Civitai crawler...');
  console.log(`   Max images: ${maxImages}`);
  console.log(`   Skip NSFW: ${CONFIG.skipNsfw}`);
  
  await initDatabase();
  
  let cursor = startCursor;
  let processedCount = 0;
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  while (processedCount < maxImages) {
    try {
      // Build API URL
      let url = `${CONFIG.civitaiBaseUrl}/images?limit=${CONFIG.imagesPerPage}&sort=${encodeURIComponent(sortBy)}`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }
      
      console.log(`\n📥 Fetching page... (processed: ${processedCount})`);
      
      // Fetch page of images
      const response = await fetchJson(url);
      
      if (!response.items || response.items.length === 0) {
        console.log('No more images to process');
        break;
      }
      
      console.log(`   Found ${response.items.length} images`);
      
      // Process images with concurrency control
      for (const imageData of response.items) {
        if (processedCount >= maxImages) break;
        
        const result = await processImage(imageData);
        processedCount++;
        
        if (result.success) {
          successCount++;
          process.stdout.write('.');
        } else if (result.skipped) {
          skipCount++;
          process.stdout.write('s');
        } else if (result.error) {
          errorCount++;
          process.stdout.write('x');
        }
        
        // Rate limit image downloads
        await new Promise(r => setTimeout(r, CONFIG.imageDownloadDelayMs));
      }
      
      // Get next cursor
      cursor = response.metadata?.nextCursor;
      if (!cursor) {
        console.log('\nNo more pages');
        break;
      }
      
      // Rate limit API requests
      await new Promise(r => setTimeout(r, CONFIG.requestDelayMs));
      
    } catch (error) {
      console.error('\nPage fetch error:', error.message);
      // Wait and retry
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log('\n\n✅ Crawl complete!');
  console.log(`   Processed: ${processedCount}`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Skipped: ${skipCount}`);
  console.log(`   Errors: ${errorCount}`);
  
  // Save cursor for next run
  if (cursor) {
    console.log(`\n📌 Next cursor: ${cursor}`);
    console.log('   Save this to resume crawling');
  }
  
  return {
    processedCount,
    successCount,
    skipCount,
    errorCount,
    nextCursor: cursor
  };
}

/**
 * Get crawl statistics
 */
async function getStats() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_images,
      COUNT(DISTINCT generator_model) as unique_models,
      COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash,
      MIN(crawled_at) as first_crawl,
      MAX(crawled_at) as last_crawl
    FROM ${CONFIG.dbTable}
    WHERE source = 'civitai'
  `);
  
  const modelStats = await pool.query(`
    SELECT generator_model, COUNT(*) as count
    FROM ${CONFIG.dbTable}
    WHERE source = 'civitai' AND generator_model IS NOT NULL
    GROUP BY generator_model
    ORDER BY count DESC
    LIMIT 10
  `);
  
  return {
    overview: result.rows[0],
    topModels: modelStats.rows
  };
}

/**
 * Search for matching image by pHash
 */
async function findByPHash(phash, threshold = 5) {
  // For Hamming distance comparison, we'd need a more sophisticated query
  // This is exact match for now
  const result = await pool.query(`
    SELECT * FROM ${CONFIG.dbTable}
    WHERE phash = $1
    LIMIT 10
  `, [phash]);
  
  return result.rows;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'crawl';
  
  (async () => {
    try {
      switch (command) {
        case 'crawl':
          const maxImages = parseInt(args[1]) || 1000;
          await crawl({ maxImages });
          break;
          
        case 'stats':
          const stats = await getStats();
          console.log('\n📊 Civitai Crawler Statistics:');
          console.log(JSON.stringify(stats, null, 2));
          break;
          
        case 'init':
          await initDatabase();
          console.log('Database initialized');
          break;
          
        default:
          console.log(`
VeriSource Civitai Crawler

Usage:
  node crawler.js crawl [maxImages]  - Crawl images (default: 1000)
  node crawler.js stats              - Show statistics
  node crawler.js init               - Initialize database only
          `);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      await pool.end();
    }
  })();
}

module.exports = {
  crawl,
  getStats,
  findByPHash,
  processImage,
  initDatabase,
  CONFIG
};