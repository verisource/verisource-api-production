/**
 * VeriSource Lexica Crawler
 * 
 * Crawls Lexica.art's public API to build a database of confirmed AI-generated images
 * for hash lookup (instant matching) and training data collection.
 * 
 * Lexica is search-based (no feed/pagination), so we use diverse search terms
 * to maximize coverage across their 10M+ Stable Diffusion image database.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Lexica API configuration
const LEXICA_API = 'https://lexica.art/api/v1/search';
const REQUEST_DELAY = 5000; // 2 seconds between requests (be respectful)

// Diverse search terms for broad coverage
const SEARCH_TERMS = [
  // Art styles
  'portrait', 'landscape', 'abstract', 'surreal', 'realistic', 'photorealistic',
  'digital art', 'concept art', 'fantasy art', 'sci-fi', 'cyberpunk', 'steampunk',
  'anime', 'manga', 'cartoon', 'illustration', 'painting', 'oil painting',
  'watercolor', 'sketch', 'pencil drawing', '3d render', 'octane render',
  'unreal engine', 'blender', 'cinema 4d', 'vray',
  
  // Subjects
  'woman', 'man', 'girl', 'boy', 'face', 'eyes', 'hands',
  'cat', 'dog', 'dragon', 'wolf', 'bird', 'horse', 'tiger', 'lion',
  'forest', 'mountain', 'ocean', 'beach', 'city', 'castle', 'temple',
  'space', 'planet', 'galaxy', 'stars', 'moon', 'sunset', 'sunrise',
  'flowers', 'trees', 'garden', 'nature', 'water', 'fire', 'ice',
  
  // Aesthetics
  'beautiful', 'stunning', 'epic', 'dramatic', 'moody', 'dark', 'light',
  'colorful', 'vibrant', 'pastel', 'neon', 'glowing', 'ethereal', 'dreamy',
  'cinematic', 'atmospheric', 'detailed', 'intricate', 'ornate', 'minimalist',
  
  // Artists/styles commonly referenced
  'artstation', 'deviantart', 'trending', 'award winning', 'masterpiece',
  'greg rutkowski', 'alphonse mucha', 'studio ghibli', 'makoto shinkai',
  'wlop', 'rossdraws', 'sakimichan', 'artgerm',
  
  // Technical terms
  '8k', '4k', 'highly detailed', 'sharp focus', 'professional',
  'ray tracing', 'global illumination', 'volumetric lighting',
  'depth of field', 'bokeh', 'hdr', 'ultra realistic',
  
  // Misc popular
  'robot', 'mech', 'armor', 'sword', 'magic', 'wizard', 'witch',
  'angel', 'demon', 'god', 'goddess', 'warrior', 'knight', 'samurai',
  'alien', 'monster', 'creature', 'horror', 'dark fantasy',
  'steampunk city', 'underwater', 'floating islands', 'ruins',
  'cherry blossom', 'snow', 'rain', 'storm', 'lightning'
];

/**
 * Initialize database table
 */
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Create table if not exists (same schema as Civitai crawler)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_images (
        id SERIAL PRIMARY KEY,
        source VARCHAR(50) NOT NULL,
        source_id VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        phash VARCHAR(64),
        dhash VARCHAR(64),
        md5 VARCHAR(32),
        width INTEGER,
        height INTEGER,
        prompt TEXT,
        model VARCHAR(255),
        generator VARCHAR(100),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_id)
      )
    `);
    
    // Create indexes for fast lookups
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_images_phash ON ai_images(phash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_images_dhash ON ai_images(dhash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_images_md5 ON ai_images(md5)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_images_source ON ai_images(source)`);
    
    console.log('✓ Database table initialized');
  } finally {
    client.release();
  }
}

/**
 * Fetch URL with timeout
 */
function fetchUrl(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'VeriSource/1.0 (AI Image Verification Service)',
        'Accept': 'application/json'
      },
      timeout
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
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
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Search Lexica API
 */
async function searchLexica(query) {
  const url = `${LEXICA_API}?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetchUrl(url);
    const data = JSON.parse(response.toString());
    return data.images || [];
  } catch (error) {
    console.error(`   Search error for "${query}": ${error.message}`);
    return [];
  }
}

/**
 * Download image and generate hashes
 */
async function processImage(imageData) {
  try {
    // Download image
    const imageBuffer = await fetchUrl(imageData.src, 15000);
    
    // Generate MD5
    const md5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
    
    // Generate perceptual hashes using sharp + custom implementation
    let phash = null;
    let dhash = null;
    
    try {
      const sharp = require('sharp');
      
      // pHash: resize to 32x32, grayscale, DCT-based
      const pHashBuffer = await sharp(imageBuffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
      phash = generatePHash(pHashBuffer);
    } catch (e) {
      console.error(`   pHash error: ${e.message}`);
    }
    
    try {
      const sharp = require('sharp');
      
      // dHash: resize to 9x8, compare adjacent pixels
      const dHashBuffer = await sharp(imageBuffer)
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
      dhash = generateDHash(dHashBuffer);
    } catch (e) {
      console.error(`   dHash error: ${e.message}`);
    }
    
    return { md5, phash, dhash };
  } catch (error) {
    return { md5: null, phash: null, dhash: null, error: error.message };
  }
}

/**
 * Generate perceptual hash from 32x32 grayscale buffer
 */
function generatePHash(buffer) {
  // Simple average-based pHash
  const pixels = Array.from(buffer);
  const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  
  let hash = '';
  for (const pixel of pixels) {
    hash += pixel > avg ? '1' : '0';
  }
  
  // Convert binary to hex
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) {
    hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
  }
  
  return hexHash;
}

/**
 * Generate difference hash from 9x8 grayscale buffer
 */
function generateDHash(buffer) {
  const pixels = Array.from(buffer);
  let hash = '';
  
  // Compare adjacent horizontal pixels
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      hash += left > right ? '1' : '0';
    }
  }
  
  // Convert binary to hex
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) {
    hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
  }
  
  return hexHash;
}

/**
 * Save image to database
 */
async function saveImage(imageData, hashes) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO ai_images (source, source_id, url, phash, dhash, md5, width, height, prompt, model, generator, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (source, source_id) DO UPDATE SET
        phash = COALESCE(EXCLUDED.phash, ai_images.phash),
        dhash = COALESCE(EXCLUDED.dhash, ai_images.dhash),
        md5 = COALESCE(EXCLUDED.md5, ai_images.md5)
    `, [
      'lexica',
      imageData.id,
      imageData.src,
      hashes.phash,
      hashes.dhash,
      hashes.md5,
      imageData.width || null,
      imageData.height || null,
      imageData.prompt || null,
      imageData.model || 'stable-diffusion', // Lexica is all SD
      'stable-diffusion',
      JSON.stringify({
        srcSmall: imageData.srcSmall,
        gallery: imageData.gallery,
        grid: imageData.grid,
        promptid: imageData.promptid,
        nsfw: imageData.nsfw
      })
    ]);
    return true;
  } catch (error) {
    if (!error.message.includes('duplicate')) {
      console.error(`   DB error: ${error.message}`);
    }
    return false;
  } finally {
    client.release();
  }
}

/**
 * Check if image already exists
 */
async function imageExists(sourceId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT 1 FROM ai_images WHERE source = $1 AND source_id = $2',
      ['lexica', sourceId]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Get crawl progress
 */
async function getCrawlProgress() {
  const client = await pool.connect();
  try {
    // Get last search term index from metadata table
    const result = await client.query(`
      SELECT value FROM crawler_state WHERE key = 'lexica_term_index'
    `);
    return result.rows.length > 0 ? parseInt(result.rows[0].value) : 0;
  } catch (error) {
    // Table might not exist yet
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Save crawl progress
 */
async function saveCrawlProgress(termIndex) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS crawler_state (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await client.query(`
      INSERT INTO crawler_state (key, value, updated_at)
      VALUES ('lexica_term_index', $1, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP
    `, [termIndex.toString()]);
  } finally {
    client.release();
  }
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main crawler function
 */
async function crawl(options = {}) {
  const {
    maxImages = 500,
    termsPerRun = 5, // Number of search terms to process per run
    skipNsfw = true
  } = options;
  
  console.log('🚀 Starting Lexica crawler...');
  console.log(`   Max images: ${maxImages}`);
  console.log(`   Terms per run: ${termsPerRun}`);
  console.log(`   Skip NSFW: ${skipNsfw}`);
  
  await initDatabase();
  
  // Get starting term index
  let termIndex = await getCrawlProgress();
  console.log(`📌 Starting from term index: ${termIndex} ("${SEARCH_TERMS[termIndex % SEARCH_TERMS.length]}")`);
  
  let totalProcessed = 0;
  let totalSaved = 0;
  let termsProcessed = 0;
  
  while (totalProcessed < maxImages && termsProcessed < termsPerRun) {
    const term = SEARCH_TERMS[termIndex % SEARCH_TERMS.length];
    console.log(`\n🔍 Searching: "${term}" (term ${termIndex + 1}/${SEARCH_TERMS.length})`);
    
    const images = await searchLexica(term);
    console.log(`   Found ${images.length} images`);
    
    for (const image of images) {
      if (totalProcessed >= maxImages) break;
      
      // Skip NSFW if configured
      if (skipNsfw && image.nsfw) {
        process.stdout.write('n');
        continue;
      }
      
      // Check if already processed
      if (await imageExists(image.id)) {
        process.stdout.write('s'); // skip
        continue;
      }
      
      // Process image
      const hashes = await processImage(image);
      
      if (hashes.md5 || hashes.phash || hashes.dhash) {
        const saved = await saveImage(image, hashes);
        if (saved) {
          totalSaved++;
          process.stdout.write('.');
        } else {
          process.stdout.write('x');
        }
      } else {
        process.stdout.write('e'); // error
      }
      
      totalProcessed++;
      
      // Small delay between image downloads
      await delay(100);
    }
    
    termIndex++;
    termsProcessed++;
    
    // Save progress
    await saveCrawlProgress(termIndex);
    
    // Delay between searches
    await delay(REQUEST_DELAY * 2);
  }
  
  console.log(`\n\n==================================================`);
  console.log(`✅ Crawl complete!`);
  console.log(`   Processed: ${totalProcessed} images`);
  console.log(`   Saved: ${totalSaved} new images`);
  console.log(`   Next term index: ${termIndex}`);
  console.log(`==================================================`);
  
  return { processed: totalProcessed, saved: totalSaved, termIndex };
}

/**
 * Get database stats
 */
async function getStats() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN source = 'lexica' THEN 1 END) as lexica_count,
        COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash,
        COUNT(CASE WHEN dhash IS NOT NULL THEN 1 END) as with_dhash
      FROM ai_images
    `);
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Export for use as module
module.exports = { crawl, getStats, initDatabase, searchLexica };

// Run directly if executed as script
if (require.main === module) {
  crawl({
    maxImages: parseInt(process.env.MAX_IMAGES) || 500,
    termsPerRun: parseInt(process.env.TERMS_PER_RUN) || 10,
    skipNsfw: process.env.SKIP_NSFW !== 'false'
  })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}