/**
 * VeriSource Training Data Extractor v2.0
 * ====================================================
 * Pulls images from Railway PostgreSQL crawled databases
 * and prepares a balanced training dataset for GPU model training.
 *
 * v2.0 additions:
 *   - generator_label field on every image (for generator detection classifier)
 *   - Local directory scanning for DALL-E, Grok, Nano Banana, SDXL images
 *   - OOD (out-of-distribution) support via resolveGeneratorLabel()
 *   - local_path copy support in downloadBatch()
 *
 * AI-Generated (positive):
 *   - ai_image_hashes     (Civitai, 188K+)
 *   - lexica_images        (future)
 *   - chatgpt_images       (future)
 *   - Local: dalle3, grok, nanobana, portrait, vehicle, property
 *
 * Authentic (negative) — three-tier real image pipeline:
 *   TIER 1: media_hashes WHERE source='wikimedia' AND jpg/jpeg
 *   TIER 2: news_images_v1
 *   TIER 3: media_hashes WHERE source='bluesky'
 *
 * Usage:
 *   DATABASE_URL=postgres://... node extract_training_data.js [options]
 *
 * Options:
 *   --max-per-class N          Max images per class (default: 10000)
 *   --output-dir PATH          Output directory (default: /workspace/training-data)
 *   --val-ratio N              Validation split ratio (default: 0.1)
 *   --test-ratio N             Test split ratio (default: 0.1)
 *   --min-width N              Minimum image width (default: 256)
 *   --min-height N             Minimum image height (default: 256)
 *   --skip-download            Only generate metadata/splits, no download
 *   --incremental              Only download images not already present
 *   --generator-filter         Comma-separated generator models to include
 *   --exclude-animated         Skip animated content (default: true)
 *   --wikimedia-ratio N        Fraction of real images from Wikimedia (default: 0.5)
 *   --news-ratio N             Fraction of real images from news (default: 0.2)
 *   --bluesky-ratio N          Fraction of real images from Bluesky (default: 0.3)
 *   --skip-bluesky-screening   Skip AI pre-screening for Bluesky (faster, riskier)
 *   --bluesky-confidence N     Max AI confidence % to accept Bluesky image (default: 20)
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────

const CONFIG = {
  maxPerClass:            parseInt(process.env.MAX_PER_CLASS || '10000', 10),
  outputDir:              process.env.OUTPUT_DIR || '/workspace/training-data',
  valRatio:               parseFloat(process.env.VAL_RATIO || '0.1'),
  testRatio:              parseFloat(process.env.TEST_RATIO || '0.1'),
  minWidth:               parseInt(process.env.MIN_WIDTH || '256', 10),
  minHeight:              parseInt(process.env.MIN_HEIGHT || '256', 10),
  concurrentDownloads:    parseInt(process.env.CONCURRENT_DOWNLOADS || '10', 10),
  downloadTimeout:        parseInt(process.env.DOWNLOAD_TIMEOUT || '15000', 10),
  excludeAnimated:        process.env.EXCLUDE_ANIMATED !== 'false',
  maxDownloadBytes:       parseInt(process.env.MAX_DOWNLOAD_BYTES || String(25 * 1024 * 1024), 10),
  maxRedirects:           parseInt(process.env.MAX_REDIRECTS || '5', 10),
  userAgent:              process.env.DOWNLOAD_USER_AGENT || 'VeriSourceTrainingExtractor/2.0',
  retryAttempts:          3,
  retryDelay:             2000,
  skipDownload:           false,
  incremental:            false,
  generatorFilter:        undefined,
  aiFloorPerSource:       parseInt(process.env.AI_FLOOR_PER_SOURCE || '500', 10),
  aiFloorSources:         (process.env.AI_FLOOR_SOURCES || 'civitai,lexica,chatgpt')
                            .split(',').map(s => s.trim()).filter(Boolean),

  // Real image source ratios (must sum to 1.0)
  wikimediaRatio:         parseFloat(process.env.WIKIMEDIA_RATIO || '0.5'),
  newsRatio:              parseFloat(process.env.NEWS_RATIO || '0.2'),
  blueskyRatio:           parseFloat(process.env.BLUESKY_RATIO || '0.3'),

  // Bluesky screening
  skipBlueskyScreening:   process.env.SKIP_BLUESKY_SCREENING === 'true',
  blueskyConfidence:      parseInt(process.env.BLUESKY_CONFIDENCE || '20', 10),

  // Local generator directories
  localGeneratorBasePath: process.env.LOCAL_GENERATOR_PATH || '/mnt/verisource/training-data/ai',
};

// ─── CLI args ────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('--')) continue;
    const next = tokens[i + 1];
    const hasValue = next && !next.startsWith('--');
    switch (t) {
      case '--max-per-class':          if (hasValue) { out.maxPerClass = parseInt(next, 10); i++; } break;
      case '--output-dir':             if (hasValue) { out.outputDir = next; i++; } break;
      case '--val-ratio':              if (hasValue) { out.valRatio = parseFloat(next); i++; } break;
      case '--test-ratio':             if (hasValue) { out.testRatio = parseFloat(next); i++; } break;
      case '--min-width':              if (hasValue) { out.minWidth = parseInt(next, 10); i++; } break;
      case '--min-height':             if (hasValue) { out.minHeight = parseInt(next, 10); i++; } break;
      case '--skip-download':          out.skipDownload = true; break;
      case '--incremental':            out.incremental = true; break;
      case '--generator-filter':       if (hasValue) { out.generatorFilter = next.split(',').map(s => s.trim()).filter(Boolean); i++; } break;
      case '--exclude-animated':       if (hasValue) { out.excludeAnimated = next !== 'false'; i++; } else { out.excludeAnimated = true; } break;
      case '--ai-floor':               if (hasValue) { out.aiFloorPerSource = parseInt(next, 10); i++; } break;
      case '--ai-floor-sources':       if (hasValue) { out.aiFloorSources = next.split(',').map(s => s.trim()).filter(Boolean); i++; } break;
      case '--wikimedia-ratio':        if (hasValue) { out.wikimediaRatio = parseFloat(next); i++; } break;
      case '--news-ratio':             if (hasValue) { out.newsRatio = parseFloat(next); i++; } break;
      case '--bluesky-ratio':          if (hasValue) { out.blueskyRatio = parseFloat(next); i++; } break;
      case '--skip-bluesky-screening': out.skipBlueskyScreening = true; break;
      case '--bluesky-confidence':     if (hasValue) { out.blueskyConfidence = parseInt(next, 10); i++; } break;
      default: break;
    }
  }
  return out;
}

Object.assign(CONFIG, parseArgs(process.argv));

// Normalize ratios so they always sum to 1.0
const ratioSum = CONFIG.wikimediaRatio + CONFIG.newsRatio + CONFIG.blueskyRatio;
if (Math.abs(ratioSum - 1.0) > 0.01) {
  CONFIG.wikimediaRatio /= ratioSum;
  CONFIG.newsRatio      /= ratioSum;
  CONFIG.blueskyRatio   /= ratioSum;
  console.log(`⚠️  Ratios normalized to sum 1.0: wikimedia=${CONFIG.wikimediaRatio.toFixed(2)} news=${CONFIG.newsRatio.toFixed(2)} bluesky=${CONFIG.blueskyRatio.toFixed(2)}`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Generator Label Resolution ───────────────────────────────
// Maps source + generator_model to a normalized generator class label.
// Used for generator detection classifier training.
//
// OOD (out-of-distribution) handling:
//   - Known generators get specific labels
//   - Unknown/ambiguous sources return 'unknown'
//   - 'unknown' class is used for OOD detection at inference time

function resolveGeneratorLabel(source, generatorModel) {
  // API-sourced generators (local directories)
  if (source === 'dall_e_3' || source === 'dalle3') return 'dall_e_3';
  if (source === 'grok') return 'grok';
  if (source === 'gemini_flash' || source === 'nanobana') return 'gemini_flash';
  if (source === 'sdxl_portrait' || source === 'sdxl_vehicle' || source === 'sdxl_property') return 'sdxl_realistic';

  // Real images
  if (source === 'wikimedia' || source === 'news' || source === 'bluesky') return 'authentic';

  // Verification history — label unknown since source is mixed
  if (source === 'verification_history' || source === 'verification_crossref' || source === 'verification_history_exif') return 'unknown';

  // Civitai — use generator_model field for finer classification
  if (source === 'civitai') {
    if (!generatorModel || generatorModel === 'unknown') return 'stable_diffusion';
    const g = generatorModel.toLowerCase();
    if (g.includes('flux')) return 'flux';
    if (g.includes('sdxl') || g.includes('xl')) return 'sdxl_realistic';
    if (g.includes('sd') || g.includes('stable diffusion') || g.includes('realistic vision')) return 'stable_diffusion';
    return 'stable_diffusion'; // default Civitai fallback
  }

  return 'unknown';
}

// ─── Database Helpers ────────────────────────────────────────

async function hasTable(tableName) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [tableName]
  );
  return r.rows.length > 0;
}

async function getExistingColumns(tableName) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  return new Set(r.rows.map(x => x.column_name));
}

function pickFirstColumn(existingCols, candidates) {
  for (const c of candidates) if (existingCols.has(c)) return c;
  return null;
}

// ─── Database Stats ──────────────────────────────────────────

async function getDatasetStats() {
  console.log('\n═══ Current Database Stats ═══\n');

  const queries = [
    {
      label: 'AI Image Hashes (Civitai)',
      sql: `SELECT COUNT(*) as total,
              COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash,
              COUNT(DISTINCT COALESCE(generator_model, generator_type, 'unknown')) as unique_generators
            FROM ai_image_hashes
            WHERE source_url IS NOT NULL`,
    },
    {
      label: 'AI by Generator',
      sql: `SELECT COALESCE(generator_model, generator_type, 'unknown') as generator, COUNT(*) as count
            FROM ai_image_hashes
            WHERE source_url IS NOT NULL
            GROUP BY COALESCE(generator_model, generator_type, 'unknown')
            ORDER BY count DESC LIMIT 15`,
    },
    {
      label: 'media_hashes (Real Images)',
      sql: `SELECT source, COUNT(*) as total,
              COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash,
              COUNT(CASE WHEN source_url IS NOT NULL THEN 1 END) as with_url
            FROM media_hashes
            GROUP BY source
            ORDER BY total DESC`,
    },
    {
      label: 'Wikimedia JPEGs (Tier 1 — highest confidence)',
      sql: `SELECT COUNT(*) as total
            FROM media_hashes
            WHERE source = 'wikimedia'
              AND (LOWER(source_url) LIKE '%.jpg' OR LOWER(source_url) LIKE '%.jpeg'
                   OR LOWER(source_url) LIKE '%25.jpg' OR LOWER(source_url) LIKE '%25.jpeg')`,
    },
    {
      label: 'News Images (Tier 2)',
      sql: `SELECT COUNT(*) as total,
              COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash
            FROM news_images_v1
            WHERE image_url IS NOT NULL`,
    },
    {
      label: 'Bluesky Images (Tier 3 — requires screening)',
      sql: `SELECT COUNT(*) as total,
              COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash
            FROM media_hashes
            WHERE source = 'bluesky'`,
    },
    {
      label: 'Verifications',
      sql: `SELECT COUNT(*) as total,
              COUNT(CASE WHEN has_camera_info=true THEN 1 END) as with_camera_exif,
              COUNT(CASE WHEN phash IS NOT NULL THEN 1 END) as with_phash
            FROM verifications
            WHERE media_kind='image'`,
    },
  ];

  const stats = {};
  for (const q of queries) {
    try {
      const result = await pool.query(q.sql);
      console.log(`  ${q.label}:`);
      if (result.rows.length === 1) {
        Object.entries(result.rows[0]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
        stats[q.label] = result.rows[0];
      } else {
        result.rows.forEach(row => console.log(`    ${Object.values(row).join(': ')}`));
        stats[q.label] = result.rows;
      }
      console.log('');
    } catch (err) {
      console.log(`    ⚠️  ${err.message}\n`);
    }
  }
  return stats;
}

// ─── Fetch AI Images (Civitai DB) ────────────────────────────

async function fetchAIImages(limit) {
  console.log(`\n📥 Fetching up to ${limit} AI images from ai_image_hashes...`);

  const params = [];
  let p = 1;
  const where = [
    'source_url IS NOT NULL',
    'phash IS NOT NULL',
  ];

  if (CONFIG.excludeAnimated) {
    where.push(
      `source_url NOT ILIKE '%.gif%'`,
      `source_url NOT ILIKE '%.webm%'`,
      `source_url NOT ILIKE '%.mp4%'`
    );
  }
  if (Number.isFinite(CONFIG.minWidth) && CONFIG.minWidth > 0) {
    where.push(`(width IS NULL OR width >= $${p})`);
    params.push(CONFIG.minWidth); p++;
  }
  if (Number.isFinite(CONFIG.minHeight) && CONFIG.minHeight > 0) {
    where.push(`(height IS NULL OR height >= $${p})`);
    params.push(CONFIG.minHeight); p++;
  }
  if (CONFIG.generatorFilter && CONFIG.generatorFilter.length) {
    where.push(`(generator_model = ANY($${p}) OR generator_type = ANY($${p}))`);
    params.push(CONFIG.generatorFilter); p++;
  }

  params.push(limit);
  const sql = `
    SELECT id, source, source_id, source_url, phash,
      COALESCE(generator_model, generator_type, 'unknown') as generator,
      prompt, negative_prompt, sampler, steps, cfg_scale, seed,
      width, height, file_size, nsfw_level
    FROM ai_image_hashes
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN generator_model IS NOT NULL THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT $${p}
  `;

  const result = await pool.query(sql, params);
  console.log(`  ✅ Found ${result.rows.length} AI images`);

  const genCounts = {};
  result.rows.forEach(r => { genCounts[r.generator] = (genCounts[r.generator] || 0) + 1; });
  console.log('  Generator distribution:');
  Object.entries(genCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([g, c]) => console.log(`    ${g}: ${c}`));

  return result.rows.map(r => ({
    id: `ai_civitai_${r.id}`,
    url: r.source_url,
    label: 'ai',
    generator_label: resolveGeneratorLabel('civitai', r.generator),
    source: 'civitai',
    downloadable: true,
    metadata: {
      generator_model: r.generator,
      prompt: r.prompt,
      negative_prompt: r.negative_prompt,
      sampler: r.sampler,
      steps: r.steps,
      cfg_scale: r.cfg_scale,
      seed: r.seed,
      width: r.width,
      height: r.height,
      file_size: r.file_size,
      phash: r.phash,
      nsfw_level: r.nsfw_level,
    },
  }));
}

// ─── Fetch Lexica (future) ────────────────────────────────────

async function fetchLexicaImages(limit) {
  if (!(await hasTable('lexica_images'))) return [];
  console.log(`\n📥 Fetching up to ${limit} AI images from Lexica...`);
  const params = [];
  let p = 1;
  let q = `SELECT id, image_url, width, height, phash, prompt FROM lexica_images WHERE image_url IS NOT NULL AND phash IS NOT NULL`;
  if (CONFIG.minWidth > 0) { q += ` AND (width IS NULL OR width >= $${p})`; params.push(CONFIG.minWidth); p++; }
  if (CONFIG.minHeight > 0) { q += ` AND (height IS NULL OR height >= $${p})`; params.push(CONFIG.minHeight); p++; }
  q += ` ORDER BY RANDOM() LIMIT $${p}`;
  params.push(limit);
  const r = await pool.query(q, params);
  console.log(`  Found ${r.rows.length} Lexica images`);
  return r.rows.map(row => ({
    id: `ai_lexica_${row.id}`,
    url: row.image_url,
    label: 'ai',
    generator_label: resolveGeneratorLabel('lexica', null),
    source: 'lexica',
    downloadable: true,
    metadata: { prompt: row.prompt, width: row.width, height: row.height, phash: row.phash },
  }));
}

// ─── Fetch ChatGPT (future) ───────────────────────────────────

async function fetchChatGPTImages(limit) {
  if (!(await hasTable('chatgpt_images'))) return [];
  console.log(`\n📥 Fetching up to ${limit} AI images from ChatGPT...`);
  const params = [];
  let p = 1;
  let q = `SELECT id, image_url, width, height, phash, prompt, model FROM chatgpt_images WHERE image_url IS NOT NULL AND phash IS NOT NULL`;
  if (CONFIG.minWidth > 0) { q += ` AND (width IS NULL OR width >= $${p})`; params.push(CONFIG.minWidth); p++; }
  if (CONFIG.minHeight > 0) { q += ` AND (height IS NULL OR height >= $${p})`; params.push(CONFIG.minHeight); p++; }
  q += ` ORDER BY RANDOM() LIMIT $${p}`;
  params.push(limit);
  const r = await pool.query(q, params);
  console.log(`  Found ${r.rows.length} ChatGPT images`);
  return r.rows.map(row => ({
    id: `ai_chatgpt_${row.id}`,
    url: row.image_url,
    label: 'ai',
    generator_label: resolveGeneratorLabel('dall_e_3', row.model),
    source: 'chatgpt',
    downloadable: true,
    metadata: { prompt: row.prompt, generator_model: row.model || 'chatgpt', width: row.width, height: row.height, phash: row.phash },
  }));
}

// ─── Fetch Local Generator Images ────────────────────────────
// Scans local directories for images generated by DALL-E, Grok,
// Nano Banana, and SDXL. These are already on disk — no download needed.

async function fetchLocalGeneratorImages() {
  const LOCAL_DIRS = [
    { dir: path.join(CONFIG.localGeneratorBasePath, 'dalle3'),   source: 'dall_e_3' },
    { dir: path.join(CONFIG.localGeneratorBasePath, 'grok'),     source: 'grok' },
    { dir: path.join(CONFIG.localGeneratorBasePath, 'nanobana'), source: 'gemini_flash' },
    { dir: path.join(CONFIG.localGeneratorBasePath, 'portrait'), source: 'sdxl_portrait' },
    { dir: path.join(CONFIG.localGeneratorBasePath, 'vehicle'),  source: 'sdxl_vehicle' },
    { dir: path.join(CONFIG.localGeneratorBasePath, 'property'), source: 'sdxl_property' },
  ];

  const results = [];
  console.log('\n📁 Scanning local generator directories...');

  for (const { dir, source } of LOCAL_DIRS) {
    if (!fs.existsSync(dir)) {
      console.log(`  ⚠️  Not found, skipping: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map(f => path.join(dir, f))
      .filter(f => {
        try { return fs.statSync(f).size > 1000; } catch { return false; }
      });

    const genLabel = resolveGeneratorLabel(source, null);
    console.log(`  ${source} → ${genLabel}: ${files.length} images`);

    files.forEach((filePath, idx) => {
      results.push({
        id: `local_${source}_${idx}`,
        url: null,
        local_path: filePath,
        label: 'ai',
        generator_label: genLabel,
        source,
        downloadable: false,
        metadata: {
          local_file: filePath,
          generator_model: source,
        },
      });
    });
  }

  console.log(`  ✅ Total local generator images: ${results.length}`);
  return results;
}

// ─── TIER 1: Wikimedia JPEGs ──────────────────────────────────

async function fetchWikimediaImages(limit) {
  console.log(`\n📥 [Tier 1] Fetching up to ${limit} Wikimedia JPEG images...`);

  const result = await pool.query(`
    SELECT id, phash, sha256, source_url, author_handle, ingested_at
    FROM media_hashes
    WHERE source = 'wikimedia'
      AND phash IS NOT NULL
      AND source_url IS NOT NULL
      AND (
        LOWER(source_url) LIKE '%.jpg'
        OR LOWER(source_url) LIKE '%.jpeg'
        OR LOWER(source_url) LIKE '%25.jpg'
        OR LOWER(source_url) LIKE '%25.jpeg'
        OR LOWER(source_url) LIKE '%2F%.jpg'
        OR LOWER(source_url) LIKE '%2F%.jpeg'
      )
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);

  console.log(`  ✅ Found ${result.rows.length} Wikimedia JPEG images`);

  return result.rows.map(r => ({
    id: `real_wikimedia_${r.id}`,
    url: buildWikimediaDownloadUrl(r.source_url),
    label: 'real',
    generator_label: 'authentic',
    source: 'wikimedia',
    downloadable: true,
    confidence_tier: 1,
    metadata: {
      source_url: r.source_url,
      author: r.author_handle,
      ingested_at: r.ingested_at,
      phash: r.phash,
      sha256: r.sha256,
      note: 'Wikimedia Commons JPEG — high confidence real image',
    },
  }));
}

function buildWikimediaDownloadUrl(wikiUrl) {
  try {
    const decoded = decodeURIComponent(wikiUrl);
    const match = decoded.match(/wiki\/File:(.+)$/i);
    if (!match) return wikiUrl;
    const filename = match[1];
    const encoded = encodeURIComponent(filename).replace(/%20/g, '_');
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}`;
  } catch {
    return wikiUrl;
  }
}

// ─── TIER 2: News Images ──────────────────────────────────────

async function fetchNewsImages(limit) {
  console.log(`\n📥 [Tier 2] Fetching up to ${limit} news images from news_images_v1...`);

  try {
    const result = await pool.query(`
      SELECT id, image_url, source, source_name, article_url,
             article_title, phash, published_at
      FROM news_images_v1
      WHERE image_url IS NOT NULL
        AND phash IS NOT NULL
      ORDER BY RANDOM()
      LIMIT $1
    `, [limit]);

    console.log(`  ✅ Found ${result.rows.length} news images`);

    const sourceCounts = {};
    result.rows.forEach(r => {
      const src = r.source_name || r.source || 'unknown';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });
    console.log('  Source distribution (top 10):');
    Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([source, count]) => console.log(`    ${source}: ${count}`));

    return result.rows.map(r => ({
      id: `real_news_${r.id}`,
      url: r.image_url,
      label: 'real',
      generator_label: 'authentic',
      source: 'news',
      downloadable: true,
      confidence_tier: 2,
      metadata: {
        news_source: r.source_name || r.source,
        title: r.article_title,
        article_url: r.article_url,
        published_at: r.published_at,
        phash: r.phash,
        note: 'Editorial press photography — high confidence real image',
      },
    }));
  } catch (err) {
    console.log(`  ⚠️  News query failed: ${err.message}`);
    return [];
  }
}

// ─── TIER 3: Bluesky Images ───────────────────────────────────

async function fetchBlueskyImages(limit) {
  console.log(`\n📥 [Tier 3] Fetching Bluesky images (target: ${limit})...`);

  if (CONFIG.skipBlueskyScreening) {
    console.log(`  ⚠️  Screening DISABLED. WARNING: ~10-20% contamination expected.`);
  } else {
    console.log(`  Screening: ENABLED — max AI confidence threshold: ${CONFIG.blueskyConfidence}%`);
  }

  const fetchLimit = CONFIG.skipBlueskyScreening ? limit : Math.min(limit * 4, 500000);

  const result = await pool.query(`
    SELECT id, phash, sha256, source_url, author_handle,
           author_did, post_created_at, ingested_at
    FROM media_hashes
    WHERE source = 'bluesky'
      AND phash IS NOT NULL
      AND source_url IS NOT NULL
    ORDER BY RANDOM()
    LIMIT $1
  `, [fetchLimit]);

  console.log(`  Fetched ${result.rows.length} candidates from database`);

  if (CONFIG.skipBlueskyScreening) {
    return result.rows.slice(0, limit).map(r => blueskyRowToImage(r, false));
  }

  console.log(`\n  🔍 Pre-screening via pHash cross-reference...`);
  const knownAIHashes = await getKnownAIPHashes();
  console.log(`  Loaded ${knownAIHashes.size} known AI pHashes for comparison`);

  const screened = [];
  let rejected = 0;

  for (const row of result.rows) {
    if (screened.length >= limit) break;
    if (knownAIHashes.has(row.phash)) { rejected++; continue; }
    if (isLikelyAI(row.phash, knownAIHashes)) { rejected++; continue; }
    screened.push(blueskyRowToImage(row, true));
  }

  const acceptRate = ((screened.length / result.rows.length) * 100).toFixed(1);
  console.log(`  ✅ Accepted: ${screened.length} | Rejected: ${rejected} | Accept rate: ${acceptRate}%`);

  return screened;
}

function blueskyRowToImage(r, screened) {
  return {
    id: `real_bluesky_${r.id}`,
    url: r.source_url,
    label: 'real',
    generator_label: 'authentic',
    source: 'bluesky',
    downloadable: true,
    confidence_tier: 3,
    metadata: {
      source_url: r.source_url,
      author_did: r.author_did,
      author_handle: r.author_handle,
      post_created_at: r.post_created_at,
      ingested_at: r.ingested_at,
      phash: r.phash,
      sha256: r.sha256,
      screened,
      note: screened
        ? 'Bluesky social image — pHash screened, medium confidence'
        : 'Bluesky social image — UNSCREENED, use with caution',
    },
  };
}

async function getKnownAIPHashes() {
  const result = await pool.query(
    `SELECT DISTINCT phash FROM ai_image_hashes WHERE phash IS NOT NULL`
  );
  return new Set(result.rows.map(r => r.phash));
}

function isLikelyAI(phash, knownAIHashes, threshold = 10) {
  if (!phash || phash.length < 8) return false;
  const toBinary = (hex) =>
    hex.split('').map(h => parseInt(h, 16).toString(2).padStart(4, '0')).join('');
  const targetBin = toBinary(phash);
  const sample = [];
  let count = 0;
  for (const h of knownAIHashes) { if (count++ > 1000) break; sample.push(h); }
  for (const knownHash of sample) {
    if (knownHash.length !== phash.length) continue;
    const knownBin = toBinary(knownHash);
    let distance = 0;
    for (let i = 0; i < Math.min(targetBin.length, knownBin.length); i++) {
      if (targetBin[i] !== knownBin[i]) distance++;
      if (distance >= threshold) break;
    }
    if (distance < threshold) return true;
  }
  return false;
}

// ─── Combined Real Image Fetcher ──────────────────────────────

async function fetchRealImages(limit) {
  console.log(`\n═══ Real Image Pipeline (target: ${limit}) ═══`);
  console.log(`  Wikimedia (Tier 1): ${(CONFIG.wikimediaRatio * 100).toFixed(0)}% = ${Math.floor(limit * CONFIG.wikimediaRatio)} images`);
  console.log(`  News      (Tier 2): ${(CONFIG.newsRatio * 100).toFixed(0)}% = ${Math.floor(limit * CONFIG.newsRatio)} images`);
  console.log(`  Bluesky   (Tier 3): ${(CONFIG.blueskyRatio * 100).toFixed(0)}% = ${Math.floor(limit * CONFIG.blueskyRatio)} images`);

  const wikimediaLimit = Math.floor(limit * CONFIG.wikimediaRatio);
  const newsLimit      = Math.floor(limit * CONFIG.newsRatio);
  const blueskyLimit   = limit - wikimediaLimit - newsLimit;

  const [wikimediaImages, newsImages, blueskyImages] = await Promise.all([
    fetchWikimediaImages(wikimediaLimit),
    fetchNewsImages(newsLimit),
    fetchBlueskyImages(blueskyLimit),
  ]);

  const seen = new Set();
  const allReal = [];

  for (const img of [...wikimediaImages, ...newsImages, ...blueskyImages]) {
    const hash = img.metadata?.phash;
    if (hash && seen.has(hash)) continue;
    if (hash) seen.add(hash);
    allReal.push(img);
  }

  const shortfall = limit - allReal.length;
  if (shortfall > 0 && wikimediaImages.length > wikimediaLimit) {
    console.log(`\n  ℹ️  Filling ${shortfall} image shortfall from Wikimedia surplus`);
    const extra = wikimediaImages.slice(wikimediaLimit, wikimediaLimit + shortfall);
    extra.forEach(img => {
      if (!seen.has(img.metadata?.phash)) {
        allReal.push(img);
        if (img.metadata?.phash) seen.add(img.metadata.phash);
      }
    });
  }

  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  allReal.forEach(img => { tierCounts[img.confidence_tier] = (tierCounts[img.confidence_tier] || 0) + 1; });

  console.log(`\n  ─── Real Image Summary ───`);
  console.log(`  Tier 1 Wikimedia: ${tierCounts[1] || 0}`);
  console.log(`  Tier 2 News:      ${tierCounts[2] || 0}`);
  console.log(`  Tier 3 Bluesky:   ${tierCounts[3] || 0}`);
  console.log(`  Total real:       ${allReal.length}`);

  return allReal;
}

// ─── Verification History ─────────────────────────────────────

async function fetchVerificationHistory(limit) {
  console.log(`\n📥 Fetching high-confidence images from verification history...`);
  const images = { ai: [], real: [] };
  const halfLimit = Math.ceil(limit / 2);

  if (!(await hasTable('verifications'))) {
    console.log(`  ⚠️  verifications table not found; skipping.`);
    return images;
  }

  const cols = await getExistingColumns('verifications');
  const urlCol = pickFirstColumn(cols, [
    'file_url', 'storage_url', 'public_url', 'download_url', 'source_url', 'media_url', 'url',
  ]);
  const urlSelect = urlCol ? `, ${urlCol} as file_url` : `, NULL::text as file_url`;
  const hasSightengineScore = cols.has('sightengine_score');
  const hasAiConfidence = cols.has('ai_confidence');

  const possibleQueries = [];
  if (hasSightengineScore) {
    possibleQueries.push({
      label: 'sightengine_score column',
      aiSql: `SELECT id, fingerprint, phash, media_kind, sightengine_score, has_camera_info, camera_make, camera_model ${urlSelect}
              FROM verifications WHERE sightengine_score >= 0.90 AND phash IS NOT NULL AND media_kind='image'
              ORDER BY sightengine_score DESC LIMIT $1`,
      realSql: `SELECT id, fingerprint, phash, media_kind, sightengine_score, has_camera_info, camera_make, camera_model ${urlSelect}
                FROM verifications WHERE sightengine_score <= 0.05 AND phash IS NOT NULL AND media_kind='image' AND has_camera_info=true
                ORDER BY sightengine_score ASC LIMIT $1`,
    });
  }
  if (hasAiConfidence) {
    possibleQueries.push({
      label: 'ai_confidence column',
      aiSql: `SELECT id, fingerprint, phash, media_kind, ai_confidence, has_camera_info, camera_make, camera_model ${urlSelect}
              FROM verifications WHERE ai_confidence >= 90 AND phash IS NOT NULL AND media_kind='image'
              ORDER BY ai_confidence DESC LIMIT $1`,
      realSql: `SELECT id, fingerprint, phash, media_kind, ai_confidence, has_camera_info, camera_make, camera_model ${urlSelect}
                FROM verifications WHERE ai_confidence <= 5 AND phash IS NOT NULL AND media_kind='image' AND has_camera_info=true
                ORDER BY ai_confidence ASC LIMIT $1`,
    });
  }

  let foundScores = false;
  for (const qs of possibleQueries) {
    try {
      const aiR   = await pool.query(qs.aiSql, [halfLimit]);
      const realR = await pool.query(qs.realSql, [halfLimit]);
      if (aiR.rows.length > 0 || realR.rows.length > 0) {
        console.log(`  ✅ Found scores via: ${qs.label}`);
        console.log(`    High-confidence AI:   ${aiR.rows.length}`);
        console.log(`    High-confidence Real: ${realR.rows.length}`);
        aiR.rows.forEach(r => images.ai.push({
          id: `verified_ai_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
          phash: r.phash, label: 'ai', generator_label: 'unknown', source: 'verification_history',
          metadata: { fingerprint: r.fingerprint, phash: r.phash,
            score: r.sightengine_score || r.ai_confidence,
            camera: r.camera_make ? `${r.camera_make} ${r.camera_model || ''}`.trim() : null },
        }));
        realR.rows.forEach(r => images.real.push({
          id: `verified_real_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
          phash: r.phash, label: 'real', generator_label: 'authentic', source: 'verification_history',
          metadata: { fingerprint: r.fingerprint, phash: r.phash,
            score: r.sightengine_score || r.ai_confidence,
            camera: r.camera_make ? `${r.camera_make} ${r.camera_model || ''}`.trim() : null },
        }));
        foundScores = true;
        break;
      }
    } catch { continue; }
  }

  if (!foundScores) {
    console.log(`  ⚠️  No score columns found. Falling back to EXIF labeling...`);
    try {
      const exifR = await pool.query(`
        SELECT id, fingerprint, phash, camera_make, camera_model ${urlSelect}
        FROM verifications
        WHERE has_camera_info=true AND camera_make IS NOT NULL AND phash IS NOT NULL AND media_kind='image'
        ORDER BY RANDOM() LIMIT $1`, [halfLimit]);
      console.log(`    Found ${exifR.rows.length} images with camera EXIF`);
      exifR.rows.forEach(r => images.real.push({
        id: `verified_exif_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
        phash: r.phash, label: 'real', generator_label: 'authentic', source: 'verification_history_exif',
        metadata: { fingerprint: r.fingerprint, phash: r.phash,
          camera: `${r.camera_make} ${r.camera_model || ''}`.trim(),
          note: 'EXIF-based label (weak signal)' },
      }));
    } catch (e) { console.log(`    ⚠️  EXIF fallback failed: ${e.message}`); }
  }

  try {
    const xref = await pool.query(`
      SELECT v.id, v.fingerprint, v.phash
      FROM verifications v
      INNER JOIN ai_image_hashes ai ON v.phash = ai.phash
      WHERE v.phash IS NOT NULL AND v.media_kind='image'
      LIMIT $1`, [halfLimit]);
    if (xref.rows.length > 0) {
      console.log(`\n  🎯 Cross-ref: ${xref.rows.length} verifications matched ai_image_hashes`);
      const seen = new Set(images.ai.map(i => i.metadata.fingerprint));
      xref.rows.forEach(r => {
        if (!seen.has(r.fingerprint)) {
          images.ai.push({
            id: `verified_xref_${r.id}`, url: null, downloadable: false,
            phash: r.phash, label: 'ai', generator_label: 'unknown', source: 'verification_crossref',
            metadata: { fingerprint: r.fingerprint, phash: r.phash, note: 'Matched verification + Civitai' },
          });
        }
      });
    }
  } catch {}

  console.log(`\n  Verification totals: ${images.ai.length} AI, ${images.real.length} real`);
  return images;
}

// ─── Image Download / Copy ────────────────────────────────────

function getExtension(url) {
  try {
    if (!url) return '.jpg';
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
  } catch {}
  return '.jpg';
}

function downloadImage(url, destPath, {
  timeoutMs = CONFIG.downloadTimeout,
  maxBytes = CONFIG.maxDownloadBytes,
  redirectDepth = 0,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('Missing URL'));
    if (redirectDepth > CONFIG.maxRedirects) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }

    const protocol = parsed.protocol === 'https:' ? https : http;
    const req = protocol.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': 'image/*',
        'From': 'verisource-training@verisource.io',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error(`Redirect without Location`));
        const nextUrl = new URL(loc, url).toString();
        res.resume();
        return downloadImage(nextUrl, destPath, { timeoutMs, maxBytes, redirectDepth: redirectDepth + 1 })
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }

      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (!ct.startsWith('image/')) { res.resume(); return reject(new Error(`Not image: ${ct}`)); }
      if (CONFIG.excludeAnimated && ct.startsWith('image/gif')) { res.resume(); return reject(new Error('GIF skipped')); }

      const tmpPath = `${destPath}.tmp`;
      const out = fs.createWriteStream(tmpPath);
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error('Too large')); });
      res.on('error', err => { out.destroy(); reject(err); });
      out.on('error', err => { res.destroy(); reject(err); });
      out.on('finish', () => {
        try {
          if (bytes < 1000) { fs.unlinkSync(tmpPath); return reject(new Error('Too small')); }
          fs.renameSync(tmpPath, destPath);
          resolve({ size: bytes, contentType: ct });
        } catch (e) {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
          reject(e);
        }
      });
      res.pipe(out);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout')));
  });
}

async function downloadWithRetry(url, destPath, attempts = CONFIG.retryAttempts) {
  for (let i = 0; i < attempts; i++) {
    try { return await downloadImage(url, destPath); }
    catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, CONFIG.retryDelay * (i + 1)));
    }
  }
}

async function downloadBatch(images, outputDir, label) {
  const dir = path.join(outputDir, label);
  fs.mkdirSync(dir, { recursive: true });
  let downloaded = 0, skipped = 0, failed = 0;
  const errors = {};

  for (let i = 0; i < images.length; i += CONFIG.concurrentDownloads) {
    const batch = images.slice(i, i + CONFIG.concurrentDownloads);
    await Promise.all(batch.map(async (img) => {

      // Handle local files — copy instead of download
      if (img.local_path) {
        const ext = path.extname(img.local_path) || '.jpg';
        const destPath = path.join(dir, `${img.id}${ext}`);
        if (CONFIG.incremental && fs.existsSync(destPath)) {
          try { if (fs.statSync(destPath).size > 1000) { skipped++; return; } } catch {}
        }
        try {
          fs.copyFileSync(img.local_path, destPath);
          downloaded++;
        } catch (err) {
          failed++;
          const k = String(err.message || 'copy error').substring(0, 60);
          errors[k] = (errors[k] || 0) + 1;
        }
        return;
      }

      if (!img.url) { skipped++; return; }
      const ext = getExtension(img.url);
      const filename = `${img.id}${ext}`;
      const destPath = path.join(dir, filename);
      if (CONFIG.incremental && fs.existsSync(destPath)) {
        try { if (fs.statSync(destPath).size > 1000) { skipped++; return; } } catch {}
      }
      try {
        await downloadWithRetry(img.url, destPath);
        downloaded++;
      } catch (err) {
        failed++;
        const k = String(err.message || 'error').substring(0, 60);
        errors[k] = (errors[k] || 0) + 1;
      }
    }));
    const total = downloaded + skipped + failed;
    if (total % 100 === 0 || i + CONFIG.concurrentDownloads >= images.length) {
      process.stdout.write(`\r  [${label}] ${downloaded} ok, ${skipped} skip, ${failed} fail / ${images.length}`);
    }
  }
  console.log('');
  if (Object.keys(errors).length > 0) {
    console.log('  Errors:');
    Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([e, c]) => console.log(`    ${e}: ${c}`));
  }
  return { downloaded, skipped, failed };
}

// ─── Split Assignment ─────────────────────────────────────────

function getSplitKey(img) {
  return img?.metadata?.phash || img?.phash || img?.metadata?.fingerprint || img?.url || img?.local_path || img?.id;
}

function assignSplits(images) {
  const sorted = [...images].sort((a, b) => {
    const ha = crypto.createHash('md5').update(getSplitKey(a)).digest('hex');
    const hb = crypto.createHash('md5').update(getSplitKey(b)).digest('hex');
    return ha.localeCompare(hb);
  });
  const n = sorted.length;
  const nTest  = Math.floor(n * CONFIG.testRatio);
  const nVal   = Math.floor(n * CONFIG.valRatio);
  const nTrain = n - nTest - nVal;
  const splits = {};
  sorted.forEach((img, i) => {
    if (i < nTrain)             splits[img.id] = 'train';
    else if (i < nTrain + nVal) splits[img.id] = 'val';
    else                         splits[img.id] = 'test';
  });
  console.log(`\n  Splits: train=${nTrain}, val=${nVal}, test=${nTest}`);
  return splits;
}

// ─── AI Floor Balancing ───────────────────────────────────────

function deterministicSort(images) {
  return [...images].sort((a, b) => {
    const ha = crypto.createHash('md5').update(getSplitKey(a)).digest('hex');
    const hb = crypto.createHash('md5').update(getSplitKey(b)).digest('hex');
    return ha.localeCompare(hb);
  });
}

function balanceAIWithFloors(aiImages, maxPerClass) {
  const bySource = new Map();
  for (const img of aiImages) {
    const src = img.source || 'unknown';
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(img);
  }
  for (const [src, imgs] of bySource.entries()) bySource.set(src, deterministicSort(imgs));

  const balanced = [];
  let remaining = maxPerClass;
  const floor = CONFIG.aiFloorPerSource;
  const sources = CONFIG.aiFloorSources;
  const maxFloorTotal = Math.floor(maxPerClass * 0.4);
  const effectiveFloor = (sources.length * floor > maxFloorTotal && sources.length > 0)
    ? Math.floor(maxFloorTotal / sources.length) : floor;

  if (effectiveFloor !== floor) console.log(`\n  ⚠️  AI floor reduced ${floor} → ${effectiveFloor} (40% cap)`);

  const report = [];
  for (const src of sources) {
    const imgs = bySource.get(src) || [];
    const take = Math.min(effectiveFloor, imgs.length, remaining);
    balanced.push(...imgs.slice(0, take));
    remaining -= take;
    bySource.set(src, imgs.slice(take));
    report.push({ src, took: take, avail: imgs.length });
  }
  console.log(`\n  AI floor sampling:`);
  report.forEach(r => console.log(`    ${r.src}: ${r.took}/${r.avail}`));

  const poolImgs = deterministicSort([...bySource.values()].flat());
  balanced.push(...poolImgs.slice(0, remaining));
  return balanced;
}

// ─── Main Pipeline ────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   VeriSource Training Data Extraction v2.0      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nConfig:`);
  console.log(`  Max per class:        ${CONFIG.maxPerClass}`);
  console.log(`  Output dir:           ${CONFIG.outputDir}`);
  console.log(`  Val/Test ratio:       ${CONFIG.valRatio}/${CONFIG.testRatio}`);
  console.log(`  Min WxH:              ${CONFIG.minWidth}x${CONFIG.minHeight}`);
  console.log(`  Skip download:        ${CONFIG.skipDownload}`);
  console.log(`  Incremental:          ${CONFIG.incremental}`);
  console.log(`  AI floor per source:  ${CONFIG.aiFloorPerSource}`);
  console.log(`  AI floor sources:     ${CONFIG.aiFloorSources.join(', ')}`);
  console.log(`  Local generator path: ${CONFIG.localGeneratorBasePath}`);
  console.log(`\nReal image source ratios:`);
  console.log(`  Wikimedia (Tier 1):   ${(CONFIG.wikimediaRatio * 100).toFixed(0)}%`);
  console.log(`  News      (Tier 2):   ${(CONFIG.newsRatio * 100).toFixed(0)}%`);
  console.log(`  Bluesky   (Tier 3):   ${(CONFIG.blueskyRatio * 100).toFixed(0)}%`);
  console.log(`  Bluesky screening:    ${CONFIG.skipBlueskyScreening ? 'DISABLED' : `ENABLED (<${CONFIG.blueskyConfidence}% AI confidence)`}`);

  await getDatasetStats();

  // ── Fetch AI images ──
  const aiImages = [];
  aiImages.push(...(await fetchAIImages(CONFIG.maxPerClass)));
  aiImages.push(...(await fetchLexicaImages(CONFIG.maxPerClass)));
  aiImages.push(...(await fetchChatGPTImages(CONFIG.maxPerClass)));
  aiImages.push(...(await fetchLocalGeneratorImages()));

  // ── Fetch Real images (three-tier pipeline) ──
  const realImages = await fetchRealImages(CONFIG.maxPerClass);

  // ── Verification history ──
  const verified = await fetchVerificationHistory(Math.ceil(CONFIG.maxPerClass / 2));

  // ── Merge (dedupe by phash) ──
  const aiHashes   = new Set(aiImages.map(i => i.metadata?.phash).filter(Boolean));
  const realHashes = new Set(realImages.map(i => i.metadata?.phash).filter(Boolean));
  let addAI = 0, addReal = 0;
  verified.ai.forEach(img => {
    const h = img.metadata?.phash || img.phash;
    if (h && !aiHashes.has(h)) { aiImages.push(img); aiHashes.add(h); addAI++; }
  });
  verified.real.forEach(img => {
    const h = img.metadata?.phash || img.phash;
    if (h && !realHashes.has(h)) { realImages.push(img); realHashes.add(h); addReal++; }
  });
  console.log(`\n═══ Verification Merged: +${addAI} AI, +${addReal} real ═══`);

  // ── Generator label summary ──
  const genLabelCounts = {};
  aiImages.forEach(i => {
    const g = i.generator_label || 'unknown';
    genLabelCounts[g] = (genLabelCounts[g] || 0) + 1;
  });
  console.log(`\n═══ Generator Label Distribution ═══`);
  Object.entries(genLabelCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([g, c]) => console.log(`  ${g}: ${c}`));

  // ── Balance ──
  const aiTarget   = Math.min(CONFIG.maxPerClass, aiImages.length);
  const realTarget = Math.min(CONFIG.maxPerClass, realImages.length);
  const balancedAI   = balanceAIWithFloors(aiImages, aiTarget);
  const balancedReal = deterministicSort(realImages).slice(0, realTarget);
  const minCount     = Math.min(balancedAI.length, balancedReal.length);
  const finalAI      = balancedAI.slice(0, minCount);
  const finalReal    = balancedReal.slice(0, minCount);

  // ── Source breakdown of final dataset ──
  const realSourceCounts = {};
  finalReal.forEach(i => { realSourceCounts[i.source] = (realSourceCounts[i.source] || 0) + 1; });
  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  finalReal.forEach(i => { tierCounts[i.confidence_tier] = (tierCounts[i.confidence_tier] || 0) + 1; });

  console.log(`\n═══ Final Balanced Dataset ═══`);
  console.log(`  AI:    ${finalAI.length}`);
  console.log(`  Real:  ${finalReal.length}`);
  console.log(`    ├─ Tier 1 Wikimedia: ${tierCounts[1] || 0}`);
  console.log(`    ├─ Tier 2 News:      ${tierCounts[2] || 0}`);
  console.log(`    └─ Tier 3 Bluesky:   ${tierCounts[3] || 0}`);
  console.log(`  Total: ${finalAI.length + finalReal.length}`);

  // ── Splits ──
  const allImages = [...finalAI, ...finalReal];
  const splits = assignSplits(allImages);

  // ── Download / Copy ──
  if (!CONFIG.skipDownload) {
    console.log(`\n═══ Downloading / Copying Images ═══`);
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    const dlAI   = finalAI.filter(x => (x.url && x.downloadable !== false) || x.local_path);
    const dlReal = finalReal.filter(x => x.url && x.downloadable !== false);
    console.log(`  AI (download+copy): ${dlAI.length}/${finalAI.length}, Real: ${dlReal.length}/${finalReal.length}`);
    const aiS   = await downloadBatch(dlAI, CONFIG.outputDir, 'ai');
    const realS = await downloadBatch(dlReal, CONFIG.outputDir, 'real');
    console.log(`\n  Summary: AI ${aiS.downloaded}ok/${aiS.failed}fail, Real ${realS.downloaded}ok/${realS.failed}fail`);
  }

  // ── Metadata ──
  const metadataPath = path.join(CONFIG.outputDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify({
    created_at: new Date().toISOString(),
    version: '2.0',
    config: CONFIG,
    stats: {
      ai_total: finalAI.length,
      real_total: finalReal.length,
      real_by_source: realSourceCounts,
      real_by_tier: tierCounts,
      generator_labels: genLabelCounts,
    },
    images: allImages.map(img => ({ ...img, split: splits[img.id], split_key: getSplitKey(img) })),
  }, null, 2));
  console.log(`\n  Metadata: ${metadataPath}`);

  // ── Splits file ──
  const splitsPath = path.join(CONFIG.outputDir, 'splits.json');
  const splitSummary = {
    created_at: new Date().toISOString(),
    splits: {},
    counts: { train: { ai: 0, real: 0 }, val: { ai: 0, real: 0 }, test: { ai: 0, real: 0 } },
  };
  allImages.forEach(img => {
    const split = splits[img.id];
    const ext = img.local_path ? path.extname(img.local_path) : getExtension(img.url);
    splitSummary.splits[img.id] = {
      split,
      label: img.label,
      generator_label: img.generator_label || resolveGeneratorLabel(img.source, img.metadata?.generator_model),
      filename: `${img.id}${ext || '.jpg'}`,
      downloadable: !!(img.url || img.local_path) && img.downloadable !== false,
      confidence_tier: img.confidence_tier || null,
      local_path: img.local_path || null,
    };
    splitSummary.counts[split][img.label]++;
  });
  fs.writeFileSync(splitsPath, JSON.stringify(splitSummary, null, 2));
  console.log(`  Splits: ${splitsPath}`);

  // ── Split directories ──
  console.log(`\n═══ Split Directories ═══`);
  for (const split of ['train', 'val', 'test']) {
    for (const label of ['ai', 'real']) {
      const splitDir = path.join(CONFIG.outputDir, 'splits', split, label);
      fs.mkdirSync(splitDir, { recursive: true });
      let count = 0;
      Object.entries(splitSummary.splits).forEach(([id, info]) => {
        if (info.split !== split || info.label !== label || !info.downloadable) return;
        const src = path.join(CONFIG.outputDir, label, info.filename);
        const dst = path.join(splitDir, info.filename);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          try { fs.symlinkSync(src, dst); count++; }
          catch { try { fs.copyFileSync(src, dst); count++; } catch {} }
        }
      });
      console.log(`  ${split}/${label}: ${count}`);
    }
  }

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║          Extraction Complete! v2.0               ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  console.log(`\nDataset: ${CONFIG.outputDir}`);
  console.log(`\nGenerator labels available for classifier training:`);
  Object.entries(genLabelCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([g, c]) => console.log(`  ${g}: ${c} images`));
  console.log(`\nNext steps:`);
  console.log(`  1. rsync dataset to RunPod:`);
  console.log(`     rsync -avz ${CONFIG.outputDir}/ root@<runpod-ip>:/workspace/training-data/`);
  console.log(`  2. Run binary classifier training:`);
  console.log(`     python3 training_pipeline.py --dataset-dir /workspace/training-data`);
  console.log(`  3. Run generator classifier training:`);
  console.log(`     python3 train_generator_classifier.py --dataset-dir /workspace/training-data`);

  await pool.end();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });