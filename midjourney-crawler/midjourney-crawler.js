/**
 * VeriSource Midjourney Showcase Crawler (v3 — final)
 * 
 * Crawls Midjourney's public Community Showcase for confirmed
 * AI-generated images. Inserts into ai_image_hashes with
 * source='midjourney'.
 * 
 * No login or subscription needed — showcase is public.
 * 
 * Deploy: Railway service or cron alongside Civitai crawler.
 * Run once: node midjourney-crawler.js --once
 * Scheduled: node midjourney-crawler.js (default 4hr interval)
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
const sharp = require('sharp');

// ─── Configuration ───────────────────────────────────────────

const CONFIG = {
  showcaseTypes: ['recent', 'top', 'hot'],
  cdnBase: 'https://cdn.midjourney.com',

  // Rate limiting
  requestDelayMs: 2000,
  imageDownloadDelayMs: 300,
  maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT || '3', 10),

  // Crawl settings
  maxImagesPerRun: parseInt(process.env.MAX_IMAGES_PER_RUN || '2000', 10),
  minWidth: 256,
  minHeight: 256,

  // Capture multiple images per job (grids, upscales, variants)
  captureAllVariants: process.env.CAPTURE_ALL_VARIANTS === 'true',

  // Database
  dbTable: 'ai_image_hashes',

  // Retry
  retryAttempts: 3,
  retryDelayMs: 3000,
  downloadTimeout: 15000,
  maxRedirects: 5,
};

// ─── Database ────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// ─── Hash Generation ─────────────────────────────────────────
// generateAHash: average-hash (luminance threshold), not true DCT pHash.
// Stored in phash column for compatibility with Civitai data.

async function generateAHash(buffer) {
  try {
    const resized = await sharp(buffer)
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    const pixels = Array.from(resized);
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    let bits = '';
    for (const p of pixels) bits += p > avg ? '1' : '0';
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

async function generateDHash(buffer) {
  try {
    const resized = await sharp(buffer)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    const pixels = Array.from(resized);
    let bits = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        bits += pixels[row * 9 + col] < pixels[row * 9 + col + 1] ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

// ─── HTTP with Retry ─────────────────────────────────────────

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

function httpGetOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || CONFIG.downloadTimeout;
    const redirects = options.redirectsLeft || CONFIG.maxRedirects;

    if (redirects <= 0) return reject(new Error('Too many redirects'));

    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(new Error('Invalid URL')); }

    const proto = parsed.protocol === 'https:' ? https : http;
    const req = proto.get(url, {
      timeout,
      headers: {
        'User-Agent': 'VeriSource-MidjourneyCrawler/3.0',
        'Accept': options.accept || '*/*',
      },
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error('Redirect without Location'));
        const next = new URL(loc, url).toString();
        return httpGetOnce(next, { ...options, redirectsLeft: redirects - 1 })
          .then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        err.retryAfter = res.headers['retry-after'] || null;
        return reject(err);
      }

      const chunks = [];
      let bytes = 0;
      const maxBytes = options.maxBytes || 25 * 1024 * 1024;

      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          return reject(new Error('Response too large'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        data: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || '',
        status: res.statusCode,
      }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function httpGet(url, options = {}) {
  const attempts = options.retries || CONFIG.retryAttempts;
  for (let i = 0; i < attempts; i++) {
    try {
      return await httpGetOnce(url, options);
    } catch (err) {
      const retryable = err.code === 'ECONNRESET'
        || err.code === 'ETIMEDOUT'
        || err.message === 'Timeout'
        || (err.statusCode && RETRYABLE_CODES.has(err.statusCode));

      if (!retryable || i === attempts - 1) throw err;

      // Honor Retry-After header when present
      let delay;
      if (err.retryAfter) {
        const ra = parseInt(err.retryAfter, 10);
        delay = isNaN(ra) ? CONFIG.retryDelayMs * (i + 1) : ra * 1000;
      } else if (err.statusCode === 429) {
        delay = CONFIG.retryDelayMs * (i + 1) * 3;
      } else {
        delay = CONFIG.retryDelayMs * (i + 1);
      }
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Timestamp Normalization ─────────────────────────────────

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number') {
    const ts = value > 1e12 ? value : value * 1000;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ─── Stable Source ID ────────────────────────────────────────

function makeSourceId(jobId, imgPath, idx) {
  if (!CONFIG.captureAllVariants) return jobId;
  // Use the filename from the path for stability across ordering changes
  if (imgPath) {
    const filename = String(imgPath).split('/').pop().split('?')[0];
    if (filename && filename !== imgPath) {
      return `${jobId}_${filename}`;
    }
  }
  return `${jobId}_${idx}`;
}

// ─── Showcase Scraping ───────────────────────────────────────

function extractVariants(job, seen) {
  const images = [];
  const jobId = job.id || job.job_id || job.parent_id;
  if (!jobId) return images;

  const paths = job.image_paths || [];
  const variants = CONFIG.captureAllVariants ? paths : paths.slice(0, 1);

  if (variants.length === 0) {
    variants.push(`${jobId}/0_0.png`);
  }

  for (let idx = 0; idx < variants.length; idx++) {
    const imgPath = variants[idx];
    const imgUrl = imgPath.startsWith('http')
      ? imgPath
      : `${CONFIG.cdnBase}/${imgPath}`;
    const sourceId = makeSourceId(jobId, imgPath, idx);

    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    images.push({
      url: imgUrl,
      jobId,
      sourceId,
      prompt: job.prompt || job.full_command || null,
      width: job.width || null,
      height: job.height || null,
      version: job.version || job.model_version || null,
      enqueueTime: job.enqueue_time || null,
    });
  }

  return images;
}

async function fetchShowcaseImages(type = 'recent') {
  const images = [];

  try {
    const url = `https://www.midjourney.com/showcase/${type}/`;
    console.log(`  Fetching showcase: ${type}`);
    const response = await httpGet(url, {
      accept: 'text/html,application/xhtml+xml',
      timeout: 30000,
    });

    const html = response.data.toString('utf-8');
    const seen = new Set();

    // Primary: parse __NEXT_DATA__ for structured data
    const jsonPattern = /__NEXT_DATA__[^>]*>(.*?)<\/script>/s;
    const jsonMatch = html.match(jsonPattern);
    if (jsonMatch) {
      try {
        const nextData = JSON.parse(jsonMatch[1]);
        const props = nextData?.props?.pageProps;
        const jobs = props?.jobs || props?.images || [];

        for (const job of jobs) {
          const extracted = extractVariants(job, seen);
          extracted.forEach(img => {
            img.crawlChannel = 'showcase_' + type;
          });
          images.push(...extracted);
        }
      } catch (parseErr) {
        console.log(`    __NEXT_DATA__ parse failed: ${parseErr.message}`);
      }
    }

    // Fallback: regex extract CDN URLs
    if (images.length === 0) {
      const cdnPattern = /https:\/\/cdn\.midjourney\.com\/([a-f0-9-]+)\/([^\s"']+\.(?:png|webp|jpeg|jpg))/gi;
      for (const match of html.matchAll(cdnPattern)) {
        const imageUrl = match[0];
        const jobId = match[1];
        const filename = match[2].split('?')[0];
        const sourceId = CONFIG.captureAllVariants
          ? `${jobId}_${filename}`
          : jobId;

        if (seen.has(sourceId)) continue;
        seen.add(sourceId);

        images.push({
          url: imageUrl,
          jobId,
          sourceId,
          prompt: null,
          width: null,
          height: null,
          version: null,
          enqueueTime: null,
          crawlChannel: 'showcase_' + type + '_regex',
        });
      }
    }

    console.log(`    Found ${images.length} images (${type})`);
  } catch (err) {
    console.warn(`  ⚠️ Showcase fetch failed (${type}): ${err.message}`);
  }

  return images;
}

async function fetchExploreAPI() {
  const images = [];

  try {
    const url = `https://www.midjourney.com/api/app/recent-jobs/?amount=50`;
    console.log(`  Trying explore API...`);

    const response = await httpGet(url, {
      accept: 'application/json',
      timeout: 15000,
    });

    if (!response.contentType.toLowerCase().includes('json')) {
      console.log(`  Explore API returned non-JSON`);
      return images;
    }

    const data = JSON.parse(response.data.toString('utf-8'));
    const jobs = Array.isArray(data) ? data : (data.jobs || data.images || []);

    const seen = new Set();
    for (const job of jobs) {
      const extracted = extractVariants(job, seen);
      extracted.forEach(img => {
        img.crawlChannel = 'explore_api';
      });
      images.push(...extracted);
    }

    console.log(`    Found ${images.length} images (explore API)`);
  } catch (err) {
    console.log(`  Explore API not available: ${err.message}`);
  }

  return images;
}

// ─── Image Processing ────────────────────────────────────────

async function processImage(imageData) {
  try {
    // Check duplicate by source + source_id
    const existing = await pool.query(
      `SELECT id FROM ${CONFIG.dbTable} WHERE source = 'midjourney' AND source_id = $1`,
      [imageData.sourceId]
    );
    if (existing.rows.length > 0) {
      return { skipped: true, reason: 'duplicate_id' };
    }

    // Download image
    const response = await httpGet(imageData.url, {
      accept: 'image/*',
      maxBytes: 25 * 1024 * 1024,
    });

    const imageBuffer = response.data;
    if (imageBuffer.length < 1000) {
      return { skipped: true, reason: 'too_small_file' };
    }

    // Validate image via sharp (more reliable than content-type)
    let width = imageData.width;
    let height = imageData.height;
    try {
      const metadata = await sharp(imageBuffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      const ct = response.contentType.toLowerCase();
      if (!ct.startsWith('image/')) {
        return { skipped: true, reason: 'not_image' };
      }
    }

    if (width && height && (width < CONFIG.minWidth || height < CONFIG.minHeight)) {
      return { skipped: true, reason: 'too_small_dims' };
    }

    // Exact duplicate check by sha256
    const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const sha256Dup = await pool.query(
      `SELECT id FROM ${CONFIG.dbTable} WHERE sha256 = $1 LIMIT 1`,
      [sha256]
    );
    if (sha256Dup.rows.length > 0) {
      return { skipped: true, reason: 'duplicate_sha256' };
    }

    const [phash, dhash] = await Promise.all([
      generateAHash(imageBuffer),
      generateDHash(imageBuffer),
    ]);

    // Midjourney version from prompt
    let mjVersion = imageData.version || null;
    if (!mjVersion && imageData.prompt) {
      const vMatch = imageData.prompt.match(/--v\s+(\d+\.?\d*)/i);
      if (vMatch) mjVersion = `v${vMatch[1]}`;
    }

    const sourceCreatedAt = normalizeTimestamp(imageData.enqueueTime);

    // Insert with ON CONFLICT, check rowCount
    try {
      const insertResult = await pool.query(`
        INSERT INTO ${CONFIG.dbTable} (
          source, source_id, source_url,
          phash, dhash, sha256,
          width, height, file_size,
          generator_model, generator_type,
          prompt, negative_prompt,
          sampler, steps, cfg_scale, seed,
          nsfw_level, is_ai_generated, confidence,
          source_created_at, crawled_at
        ) VALUES (
          'midjourney', $1, $2,
          $3, $4, $5,
          $6, $7, $8,
          $9, 'midjourney',
          $10, NULL,
          NULL, NULL, NULL, NULL,
          'None', true, 1.0,
          $11, NOW()
        )
        ON CONFLICT (source, source_id) DO NOTHING
      `, [
        imageData.sourceId,
        imageData.url,
        phash,
        dhash,
        sha256,
        width,
        height,
        imageBuffer.length,
        mjVersion ? `midjourney_${mjVersion}` : 'midjourney',
        imageData.prompt || null,
        sourceCreatedAt,
      ]);

      if (insertResult.rowCount === 0) {
        return { skipped: true, reason: 'duplicate_race' };
      }
    } catch (err) {
      if (err.code === '23505') {
        return { skipped: true, reason: 'duplicate_race' };
      }
      throw err;
    }

    return {
      saved: true,
      sourceId: imageData.sourceId,
      sha256: sha256.substring(0, 12) + '...',
      width,
      height,
      version: mjVersion,
    };

  } catch (err) {
    return { error: true, message: err.message, sourceId: imageData.sourceId };
  }
}

// ─── Bounded Concurrency ─────────────────────────────────────

async function processWithConcurrency(images, concurrency) {
  let saved = 0, errors = 0;
  const skipBreakdown = {};
  const errorBreakdown = {};

  // Queue-based approach
  const queue = [...images];

  async function worker() {
    while (queue.length > 0) {
      const img = queue.shift();
      if (!img) break;

      const result = await processImage(img);

      if (result.saved) {
        saved++;
      } else if (result.skipped) {
        skipBreakdown[result.reason] = (skipBreakdown[result.reason] || 0) + 1;
      } else if (result.error) {
        errors++;
        const key = result.message.substring(0, 40);
        errorBreakdown[key] = (errorBreakdown[key] || 0) + 1;
      }

      const total = saved + Object.values(skipBreakdown).reduce((a, b) => a + b, 0) + errors;
      if (total % 50 === 0) {
        const skipped = Object.values(skipBreakdown).reduce((a, b) => a + b, 0);
        console.log(`  Progress: ${total}/${images.length} | saved: ${saved}, skipped: ${skipped}, errors: ${errors}`);
      }

      await sleep(CONFIG.imageDownloadDelayMs);
    }
  }

  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Final progress line
  const totalSkipped = Object.values(skipBreakdown).reduce((a, b) => a + b, 0);
  console.log(`  Final: ${saved + totalSkipped + errors}/${images.length} | saved: ${saved}, skipped: ${totalSkipped}, errors: ${errors}`);

  return { saved, skipBreakdown, errors, errorBreakdown };
}

// ─── Main Crawl ──────────────────────────────────────────────

async function runCrawl() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   VeriSource Midjourney Showcase Crawler v3      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  Max per run: ${CONFIG.maxImagesPerRun}`);
  console.log(`  Concurrency: ${CONFIG.maxConcurrentDownloads}`);
  console.log(`  Variants: ${CONFIG.captureAllVariants ? 'all' : 'one per job'}`);

  // Ensure indexes exist
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_sha256 ON ${CONFIG.dbTable}(sha256)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${CONFIG.dbTable}_source ON ${CONFIG.dbTable}(source)`);
  } catch {}

  // Current stats
  try {
    const stats = await pool.query(`
      SELECT source, COUNT(*) as count
      FROM ${CONFIG.dbTable}
      GROUP BY source ORDER BY count DESC
    `);
    console.log('\n  Current database:');
    stats.rows.forEach(r => console.log(`    ${r.source}: ${r.count}`));
  } catch {}

  // Collect images from all sources
  let allImages = [];

  const exploreImages = await fetchExploreAPI();
  allImages.push(...exploreImages);
  await sleep(CONFIG.requestDelayMs);

  for (const type of CONFIG.showcaseTypes) {
    const images = await fetchShowcaseImages(type);
    allImages.push(...images);
    await sleep(CONFIG.requestDelayMs);
  }

  // Deduplicate by sourceId
  const seen = new Set();
  allImages = allImages.filter(img => {
    if (seen.has(img.sourceId)) return false;
    seen.add(img.sourceId);
    return true;
  });

  console.log(`\n  Unique images found: ${allImages.length}`);

  if (allImages.length > CONFIG.maxImagesPerRun) {
    allImages = allImages.slice(0, CONFIG.maxImagesPerRun);
    console.log(`  Limited to ${CONFIG.maxImagesPerRun}`);
  }

  if (allImages.length === 0) {
    console.log('  No images to process. Showcase may have changed format.');
    return;
  }

  // Process
  console.log(`\n═══ Processing Images ═══`);
  const results = await processWithConcurrency(allImages, CONFIG.maxConcurrentDownloads);

  // Report
  console.log('\n═══ Crawl Complete ═══');
  console.log(`  Saved:   ${results.saved}`);
  const totalSkipped = Object.values(results.skipBreakdown).reduce((a, b) => a + b, 0);
  console.log(`  Skipped: ${totalSkipped}`);
  if (totalSkipped > 0) {
    console.log('  Skip breakdown:');
    Object.entries(results.skipBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => console.log(`    ${reason}: ${count}`));
  }
  console.log(`  Errors:  ${results.errors}`);
  if (results.errors > 0) {
    console.log('  Error breakdown:');
    Object.entries(results.errorBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([err, count]) => console.log(`    ${err}: ${count}`));
  }

  try {
    const mj = await pool.query(
      `SELECT COUNT(*) as count FROM ${CONFIG.dbTable} WHERE source = 'midjourney'`
    );
    console.log(`\n  Total Midjourney in DB: ${mj.rows[0].count}`);
  } catch {}
}

// ─── Scheduler with Overlap Lock ─────────────────────────────

let isRunning = false;

async function startScheduler() {
  const intervalHours = parseInt(process.env.CRAWL_INTERVAL_HOURS || '4', 10);
  console.log(`Scheduler: every ${intervalHours} hours\n`);

  // Initial run — lock-protected
  isRunning = true;
  try {
    await runCrawl();
  } finally {
    isRunning = false;
  }

  setInterval(async () => {
    if (isRunning) {
      console.log('Skipping — previous crawl still running');
      return;
    }
    isRunning = true;
    try {
      await runCrawl();
    } catch (err) {
      console.error('Crawl error:', err.message);
    } finally {
      isRunning = false;
    }
  }, intervalHours * 60 * 60 * 1000);
}

// ─── Entry Point ─────────────────────────────────────────────

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === '--once') {
    runCrawl()
      .then(() => pool.end())
      .catch(err => { console.error('Fatal:', err); process.exit(1); });
  } else {
    startScheduler().catch(err => { console.error('Fatal:', err); process.exit(1); });
  }
}

module.exports = { runCrawl, processImage, CONFIG, pool };