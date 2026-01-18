/**
 * VeriSource Civitai Crawler
 * 
 * Crawls Civitai's public API to build a database of confirmed AI-generated images
 * for hash lookup (instant matching) and training data collection.
 */

const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');
const sharp = require('sharp');

// Configuration
const CONFIG = {
  civitaiBaseUrl: 'https://civitai.com/api/v1',
  imagesPerPage: 100,
  requestDelayMs: 1000,
  imageDownloadDelayMs: 200,
  maxConcurrentDownloads: 3,
  skipNsfw: true,
  minWidth: 256,
  minHeight: 256,
  maxImagesPerRun: 10000,
  saveImages: false,
  imageStoragePath: './images',
  dbTable: 'ai_image_hashes'
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${CONFIG.dbTable} (
      id SERIAL PRIMARY KEY,
      source VARCHAR(50) NOT NULL DEFAULT 'civitai',
      source_id VARCHAR(100),
      source_url TEXT,
      phash VARCHAR(64),
      dhash VARCHAR(64),
      average_hash VARCHAR(64),
      sha256 VARCHAR(64),
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      generator_model VARCHAR(255),
      generator_type VARCHAR(50),
      prompt TEXT,
      negative_prompt TEXT,
      sampler VARCHAR(100),
      steps INTEGER,
      cfg_scale FLOAT,
      seed BIGINT,
      nsfw_level VARCHAR(20),
      is_ai_generated BOOLEAN DEFAULT true,
      confidence FLOAT DEFAULT 1.0,
      source_created_at TIMESTAMP,
      crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_phash ON ${CONFIG.dbTable}(phash);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_dhash ON ${CONFIG.dbTable}(dhash);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_sha256 ON ${CONFIG.dbTable}(sha256);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_generator ON ${CONFIG.dbTable}(generator_model);
    CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_source ON ${CONFIG.dbTable}(source, source_id);
  `;
  await pool.query(createTableQuery);
  console.log('✓ Database table initialized');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'VeriSource-Crawler/1.0 (content-verification-research)',
        'Accept': 'application/json'
      }
    };
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

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https.get(url, {
        headers: { 'User-Agent': 'VeriSource-Crawler/1.0' }
      }, (res) => {
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

async function generatePHash(imageBuffer) {
  try {
    const processed = await sharp(imageBuffer)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    const pixels = Array.from(processed);
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    let hash = '';
    for (const pixel of pixels) {
      hash += pixel > mean ? '1' : '0';
    }
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

async function generateDHash(imageBuffer) {
  try {
    const processed = await sharp(imageBuffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    const pixels = Array.from(processed);
    let hash = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[row * 9 + col];
        const right = pixels[row * 9 + col + 1];
        hash += left < right ? '1' : '0';
      }
    }
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

async function processImage(imageData) {
  try {
    if (CONFIG.skipNsfw && imageData.nsfw) {
      return { skipped: true, reason: 'nsfw' };
    }
    if (imageData.width < CONFIG.minWidth || imageData.height < CONFIG.minHeight) {
      return { skipped: true, reason: 'too_small' };
    }
    const existing = await pool.query(
      `SELECT id FROM ${CONFIG.dbTable} WHERE source = 'civitai' AND source_id = $1`,
      [imageData.id.toString()]
    );
    if (existing.rows.length > 0) {
      return { skipped: true, reason: 'duplicate' };
    }
    const imageBuffer = await downloadImage(imageData.url);
    const [phash, dhash] = await Promise.all([
      generatePHash(imageBuffer),
      generateDHash(imageBuffer)
    ]);
    const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const meta = imageData.meta || {};
    await pool.query(`
      INSERT INTO ${CONFIG.dbTable} (
        source, source_id, source_url,
        phash, dhash, sha256,
        width, height, file_size,
        generator_model, generator_type, prompt, negative_prompt,
        sampler, steps, cfg_scale, seed,
        nsfw_level, source_created_at
      ) VALUES (
        'civitai', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
      'stable_diffusion',
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
    return { error: true, message: error.message, id: imageData.id };
  }
}

async function crawl(options = {}) {
  const {
    startCursor = null,
    maxImages = CONFIG.maxImagesPerRun,
    sortBy = 'Most Reactions'
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
      let url = `${CONFIG.civitaiBaseUrl}/images?limit=${CONFIG.imagesPerPage}&sort=${encodeURIComponent(sortBy)}`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }
      console.log(`\n📥 Fetching page... (processed: ${processedCount})`);
      const response = await fetchJson(url);
      if (!response.items || response.items.length === 0) {
        console.log('No more images to process');
        break;
      }
      console.log(`   Found ${response.items.length} images`);
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
        await new Promise(r => setTimeout(r, CONFIG.imageDownloadDelayMs));
      }
      cursor = response.metadata?.nextCursor;
      if (!cursor) {
        console.log('\nNo more pages');
        break;
      }
      await new Promise(r => setTimeout(r, CONFIG.requestDelayMs));
    } catch (error) {
      console.error('\nPage fetch error:', error.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log('\n\n✅ Crawl complete!');
  console.log(`   Processed: ${processedCount}`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Skipped: ${skipCount}`);
  console.log(`   Errors: ${errorCount}`);
  if (cursor) {
    console.log(`\n📌 Next cursor: ${cursor}`);
  }
  return { processedCount, successCount, skipCount, errorCount, nextCursor: cursor };
}

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
  return { overview: result.rows[0], topModels: modelStats.rows };
}

async function findByPHash(phash, threshold = 5) {
  const result = await pool.query(`
    SELECT * FROM ${CONFIG.dbTable}
    WHERE phash = $1
    LIMIT 10
  `, [phash]);
  return result.rows;
}

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

module.exports = { crawl, getStats, findByPHash, processImage, initDatabase, CONFIG };
