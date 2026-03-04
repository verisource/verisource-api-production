/**
 * VeriSource Training Data Extractor (schema-matched)
 * ====================================================
 * Pulls images from your Railway PostgreSQL crawled databases
 * and prepares a balanced training dataset for GPU model training.
 *
 * Actual database tables used:
 *   AI-Generated (positive):
 *     - ai_image_hashes (Civitai crawler, 147K+ rows)
 *     - (future) lexica_images, chatgpt_images
 *
 *   Authentic (negative):
 *     - news_images (26K+ rows, URL in metadata->>'final_url')
 *
 *   Verification history:
 *     - verifications (EXIF-labeled, future Sightengine scores)
 *
 * Usage:
 *   DATABASE_URL=postgres://... node extract_training_data.js [options]
 *
 * Options:
 *   --max-per-class N     Maximum images per class (default: 10000)
 *   --output-dir PATH     Output directory (default: /workspace/training-data)
 *   --val-ratio N         Validation split ratio (default: 0.1)
 *   --test-ratio N        Test split ratio (default: 0.1)
 *   --min-width N         Minimum image width (default: 256)
 *   --min-height N        Minimum image height (default: 256)
 *   --skip-download       Only generate metadata/splits, no image download
 *   --incremental         Only download images not already present
 *   --generator-filter    Comma-separated generator models to include
 *   --exclude-animated    Skip animated/video content (default: true)
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
  maxPerClass: parseInt(process.env.MAX_PER_CLASS || '10000', 10),
  outputDir: process.env.OUTPUT_DIR || '/workspace/training-data',
  valRatio: parseFloat(process.env.VAL_RATIO || '0.1'),
  testRatio: parseFloat(process.env.TEST_RATIO || '0.1'),
  minWidth: parseInt(process.env.MIN_WIDTH || '256', 10),
  minHeight: parseInt(process.env.MIN_HEIGHT || '256', 10),
  concurrentDownloads: parseInt(process.env.CONCURRENT_DOWNLOADS || '10', 10),
  downloadTimeout: parseInt(process.env.DOWNLOAD_TIMEOUT || '15000', 10),
  excludeAnimated: process.env.EXCLUDE_ANIMATED !== 'false',
  maxDownloadBytes: parseInt(process.env.MAX_DOWNLOAD_BYTES || String(25 * 1024 * 1024), 10),
  maxRedirects: parseInt(process.env.MAX_REDIRECTS || '5', 10),
  userAgent: process.env.DOWNLOAD_USER_AGENT || 'VeriSourceTrainingExtractor/1.3',
  retryAttempts: 3,
  retryDelay: 2000,
  skipDownload: false,
  incremental: false,
  generatorFilter: undefined,
  aiFloorPerSource: parseInt(process.env.AI_FLOOR_PER_SOURCE || '500', 10),
  aiFloorSources: (process.env.AI_FLOOR_SOURCES || 'civitai,lexica,chatgpt')
    .split(',').map(s => s.trim()).filter(Boolean),
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
      case '--max-per-class':    if (hasValue) { out.maxPerClass = parseInt(next, 10); i++; } break;
      case '--output-dir':       if (hasValue) { out.outputDir = next; i++; } break;
      case '--val-ratio':        if (hasValue) { out.valRatio = parseFloat(next); i++; } break;
      case '--test-ratio':       if (hasValue) { out.testRatio = parseFloat(next); i++; } break;
      case '--min-width':        if (hasValue) { out.minWidth = parseInt(next, 10); i++; } break;
      case '--min-height':       if (hasValue) { out.minHeight = parseInt(next, 10); i++; } break;
      case '--skip-download':    out.skipDownload = true; break;
      case '--incremental':      out.incremental = true; break;
      case '--generator-filter': if (hasValue) { out.generatorFilter = next.split(',').map(s => s.trim()).filter(Boolean); i++; } break;
      case '--exclude-animated': if (hasValue) { out.excludeAnimated = next !== 'false'; i++; } else { out.excludeAnimated = true; } break;
      case '--ai-floor':         if (hasValue) { out.aiFloorPerSource = parseInt(next, 10); i++; } break;
      case '--ai-floor-sources': if (hasValue) { out.aiFloorSources = next.split(',').map(s => s.trim()).filter(Boolean); i++; } break;
      default: break;
    }
  }
  return out;
}

Object.assign(CONFIG, parseArgs(process.argv));
if (!Number.isFinite(CONFIG.maxPerClass) || CONFIG.maxPerClass <= 0) CONFIG.maxPerClass = 10000;
if (!Number.isFinite(CONFIG.concurrentDownloads) || CONFIG.concurrentDownloads <= 0) CONFIG.concurrentDownloads = 10;
if (!Number.isFinite(CONFIG.downloadTimeout) || CONFIG.downloadTimeout <= 0) CONFIG.downloadTimeout = 15000;
if (!Number.isFinite(CONFIG.maxDownloadBytes) || CONFIG.maxDownloadBytes <= 0) CONFIG.maxDownloadBytes = 25 * 1024 * 1024;
if (!Number.isFinite(CONFIG.maxRedirects) || CONFIG.maxRedirects < 0) CONFIG.maxRedirects = 5;
if (!Number.isFinite(CONFIG.aiFloorPerSource) || CONFIG.aiFloorPerSource < 0) CONFIG.aiFloorPerSource = 500;

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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
      label: 'News Images (Real)',
      sql: `SELECT COUNT(*) as total,
            COUNT(CASE WHEN phash_hex IS NOT NULL THEN 1 END) as with_phash,
            COUNT(CASE WHEN metadata->>'final_url' IS NOT NULL THEN 1 END) as with_url
            FROM news_images`,
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
      console.log(`    ⚠️ ${err.message}\n`);
    }
  }
  return stats;
}

// ─── Fetch AI Images (ai_image_hashes table) ─────────────────

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
    params.push(CONFIG.minWidth);
    p++;
  }
  if (Number.isFinite(CONFIG.minHeight) && CONFIG.minHeight > 0) {
    where.push(`(height IS NULL OR height >= $${p})`);
    params.push(CONFIG.minHeight);
    p++;
  }
  if (CONFIG.generatorFilter && CONFIG.generatorFilter.length) {
    where.push(`(generator_model = ANY($${p}) OR generator_type = ANY($${p}))`);
    params.push(CONFIG.generatorFilter);
    p++;
  }

  params.push(limit);
  const sql = `
    SELECT id, source, source_id, source_url, phash,
      COALESCE(generator_model, generator_type, 'unknown') as generator,
      prompt, negative_prompt, sampler, steps, cfg_scale, seed,
      width, height, file_size, nsfw_level,
      'civitai' as source_label
    FROM ai_image_hashes
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN generator_model IS NOT NULL THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT $${p}
  `;

  const result = await pool.query(sql, params);
  console.log(`  Found ${result.rows.length} AI images`);

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

// ─── Fetch Lexica (future) ───────────────────────────────────

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
    id: `ai_lexica_${row.id}`, url: row.image_url, label: 'ai', source: 'lexica', downloadable: true,
    metadata: { prompt: row.prompt, width: row.width, height: row.height, phash: row.phash },
  }));
}

// ─── Fetch ChatGPT (future) ──────────────────────────────────

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
    id: `ai_chatgpt_${row.id}`, url: row.image_url, label: 'ai', source: 'chatgpt', downloadable: true,
    metadata: { prompt: row.prompt, generator_model: row.model || 'chatgpt', width: row.width, height: row.height, phash: row.phash },
  }));
}

// ─── Fetch Real Images (news_images) ─────────────────────────
// Schema: id, phash_hex, width, height, metadata (JSONB with final_url)

async function fetchRealImages(limit) {
  console.log(`\n📥 Fetching up to ${limit} authentic images from news_images...`);
  const images = [];

  try {
    const params = [];
    let p = 1;
    const where = [
      `metadata->>'final_url' IS NOT NULL`,
      `phash_hex IS NOT NULL`,
    ];

    if (Number.isFinite(CONFIG.minWidth) && CONFIG.minWidth > 0) {
      where.push(`(width IS NULL OR width >= $${p})`);
      params.push(CONFIG.minWidth);
      p++;
    }
    if (Number.isFinite(CONFIG.minHeight) && CONFIG.minHeight > 0) {
      where.push(`(height IS NULL OR height >= $${p})`);
      params.push(CONFIG.minHeight);
      p++;
    }

    params.push(limit);
    const sql = `
      SELECT id, phash_hex, width, height, content_type,
             metadata->>'final_url' as image_url,
             metadata->>'source' as source_name,
             metadata->>'title' as title,
             metadata->>'article_url' as article_url,
             first_seen_at
      FROM news_images
      WHERE ${where.join(' AND ')}
      ORDER BY RANDOM()
      LIMIT $${p}
    `;

    const result = await pool.query(sql, params);
    console.log(`  News images: ${result.rows.length}`);

    const sourceCounts = {};
    result.rows.forEach(r => {
      const src = r.source_name || 'unknown';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });
    console.log('  News source distribution (top 10):');
    Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([source, count]) => console.log(`    ${source}: ${count}`));

    result.rows.forEach(r => {
      images.push({
        id: `real_news_${r.id}`,
        url: r.image_url,
        label: 'real',
        source: 'news',
        downloadable: true,
        metadata: {
          news_source: r.source_name,
          title: r.title,
          article_url: r.article_url,
          first_seen_at: r.first_seen_at,
          width: r.width,
          height: r.height,
          phash: r.phash_hex,
          content_type: r.content_type,
        },
      });
    });
  } catch (err) {
    console.log(`  ⚠️ News images query failed: ${err.message}`);
  }

  console.log(`  Total real images: ${images.length}`);
  return images;
}

// ─── Verification History ────────────────────────────────────

async function fetchVerificationHistory(limit) {
  console.log(`\n📥 Fetching high-confidence images from verification history...`);
  const images = { ai: [], real: [] };
  const halfLimit = Math.ceil(limit / 2);

  if (!(await hasTable('verifications'))) {
    console.log(`  ⚠️ verifications table not found; skipping.`);
    return images;
  }

  const cols = await getExistingColumns('verifications');
  const urlCol = pickFirstColumn(cols, [
    'file_url', 'storage_url', 'public_url', 'download_url', 'source_url', 'media_url', 'url',
  ]);
  const urlSelect = urlCol ? `, ${urlCol} as file_url` : `, NULL::text as file_url`;

  // Check for score columns
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
      const aiR = await pool.query(qs.aiSql, [halfLimit]);
      const realR = await pool.query(qs.realSql, [halfLimit]);
      if (aiR.rows.length > 0 || realR.rows.length > 0) {
        console.log(`  ✅ Found scores via: ${qs.label}`);
        console.log(`    High-confidence AI: ${aiR.rows.length}`);
        console.log(`    High-confidence Real: ${realR.rows.length}`);
        aiR.rows.forEach(r => images.ai.push({
          id: `verified_ai_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
          phash: r.phash, label: 'ai', source: 'verification_history',
          metadata: { fingerprint: r.fingerprint, phash: r.phash,
            score: r.sightengine_score || r.ai_confidence,
            camera: r.camera_make ? `${r.camera_make} ${r.camera_model || ''}`.trim() : null },
        }));
        realR.rows.forEach(r => images.real.push({
          id: `verified_real_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
          phash: r.phash, label: 'real', source: 'verification_history',
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
    console.log(`  ⚠️ No score columns found. Falling back to EXIF labeling...`);
    try {
      const exifR = await pool.query(`
        SELECT id, fingerprint, phash, camera_make, camera_model ${urlSelect}
        FROM verifications
        WHERE has_camera_info=true AND camera_make IS NOT NULL AND phash IS NOT NULL AND media_kind='image'
        ORDER BY RANDOM() LIMIT $1`, [halfLimit]);
      console.log(`    Found ${exifR.rows.length} images with camera EXIF`);
      exifR.rows.forEach(r => images.real.push({
        id: `verified_exif_${r.id}`, url: r.file_url || null, downloadable: !!r.file_url,
        phash: r.phash, label: 'real', source: 'verification_history_exif',
        metadata: { fingerprint: r.fingerprint, phash: r.phash,
          camera: `${r.camera_make} ${r.camera_model || ''}`.trim(),
          note: 'EXIF-based label (weak signal)' },
      }));
    } catch (e) { console.log(`    ⚠️ EXIF fallback failed: ${e.message}`); }
    console.log(`\n  📋 Run add_score_columns.sql to start storing Sightengine scores.`);
  }

  // Cross-ref: verifications matching ai_image_hashes on phash
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
            phash: r.phash, label: 'ai', source: 'verification_crossref',
            metadata: { fingerprint: r.fingerprint, phash: r.phash, note: 'Matched verification + Civitai' },
          });
        }
      });
    }
  } catch {}

  console.log(`\n  Verification totals: ${images.ai.length} AI, ${images.real.length} real`);
  return images;
}

// ─── Image Download ──────────────────────────────────────────

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
      headers: { 'User-Agent': CONFIG.userAgent, 'Accept': 'image/*' },
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
    catch (err) { if (i === attempts - 1) throw err; await new Promise(r => setTimeout(r, CONFIG.retryDelay * (i + 1))); }
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

// ─── Split Assignment ────────────────────────────────────────

function getSplitKey(img) {
  return img?.metadata?.phash || img?.phash || img?.metadata?.fingerprint || img?.url || img?.id;
}

function assignSplits(images) {
  const sorted = [...images].sort((a, b) => {
    const ha = crypto.createHash('md5').update(getSplitKey(a)).digest('hex');
    const hb = crypto.createHash('md5').update(getSplitKey(b)).digest('hex');
    return ha.localeCompare(hb);
  });
  const n = sorted.length;
  const nTest = Math.floor(n * CONFIG.testRatio);
  const nVal = Math.floor(n * CONFIG.valRatio);
  const nTrain = n - nTest - nVal;
  const splits = {};
  sorted.forEach((img, i) => {
    if (i < nTrain) splits[img.id] = 'train';
    else if (i < nTrain + nVal) splits[img.id] = 'val';
    else splits[img.id] = 'test';
  });
  console.log(`\n  Splits: train=${nTrain}, val=${nVal}, test=${nTest}`);
  return splits;
}

// ─── AI Floor Balancing ──────────────────────────────────────

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

  if (effectiveFloor !== floor) console.log(`\n  ⚠️ AI floor reduced ${floor} → ${effectiveFloor} (40% cap)`);

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

  const pool = deterministicSort([...bySource.values()].flat());
  balanced.push(...pool.slice(0, remaining));
  return balanced;
}

// ─── Main Pipeline ───────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   VeriSource Training Data Extraction Pipeline  ║');
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

  await getDatasetStats();

  // Fetch AI from all sources
  const aiImages = [];
  aiImages.push(...(await fetchAIImages(CONFIG.maxPerClass)));
  aiImages.push(...(await fetchLexicaImages(CONFIG.maxPerClass)));
  aiImages.push(...(await fetchChatGPTImages(CONFIG.maxPerClass)));

  // Fetch Real
  const realImages = await fetchRealImages(CONFIG.maxPerClass);

  // Verification history
  const verified = await fetchVerificationHistory(Math.ceil(CONFIG.maxPerClass / 2));

  // Merge (dedupe by phash)
  const aiHashes = new Set(aiImages.map(i => i.metadata?.phash).filter(Boolean));
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

  // Balance
  const aiTarget = Math.min(CONFIG.maxPerClass, aiImages.length);
  const realTarget = Math.min(CONFIG.maxPerClass, realImages.length);
  const balancedAI = balanceAIWithFloors(aiImages, aiTarget);
  const balancedReal = deterministicSort(realImages).slice(0, realTarget);
  const minCount = Math.min(balancedAI.length, balancedReal.length);
  const finalAI = balancedAI.slice(0, minCount);
  const finalReal = balancedReal.slice(0, minCount);

  console.log(`\n═══ Balanced Dataset ═══`);
  console.log(`  AI:    ${finalAI.length} (civitai: ${finalAI.filter(i => i.source === 'civitai').length})`);
  console.log(`  Real:  ${finalReal.length} (news: ${finalReal.filter(i => i.source === 'news').length})`);
  console.log(`  Total: ${finalAI.length + finalReal.length}`);

  // Splits
  const allImages = [...finalAI, ...finalReal];
  const splits = assignSplits(allImages);

  // Download
  if (!CONFIG.skipDownload) {
    console.log(`\n═══ Downloading Images ═══`);
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    const dlAI = finalAI.filter(x => x.url && x.downloadable !== false);
    const dlReal = finalReal.filter(x => x.url && x.downloadable !== false);
    if (dlAI.length !== finalAI.length || dlReal.length !== finalReal.length) {
      console.log(`  Downloadable: AI ${dlAI.length}/${finalAI.length}, Real ${dlReal.length}/${finalReal.length}`);
    }
    const aiS = await downloadBatch(dlAI, CONFIG.outputDir, 'ai');
    const realS = await downloadBatch(dlReal, CONFIG.outputDir, 'real');
    console.log(`\n  Summary: AI ${aiS.downloaded}ok/${aiS.failed}fail, Real ${realS.downloaded}ok/${realS.failed}fail`);
  }

  // Metadata
  const metadataPath = path.join(CONFIG.outputDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify({
    created_at: new Date().toISOString(), config: CONFIG,
    stats: { ai_total: finalAI.length, real_total: finalReal.length },
    images: allImages.map(img => ({ ...img, split: splits[img.id], split_key: getSplitKey(img) })),
  }, null, 2));
  console.log(`\n  Metadata: ${metadataPath}`);

  // Splits file
  const splitsPath = path.join(CONFIG.outputDir, 'splits.json');
  const splitSummary = {
    created_at: new Date().toISOString(), splits: {},
    counts: { train: { ai: 0, real: 0 }, val: { ai: 0, real: 0 }, test: { ai: 0, real: 0 } },
  };
  allImages.forEach(img => {
    const split = splits[img.id];
    const ext = getExtension(img.url);
    splitSummary.splits[img.id] = { split, label: img.label, filename: `${img.id}${ext}`, downloadable: !!img.url && img.downloadable !== false };
    splitSummary.counts[split][img.label]++;
  });
  fs.writeFileSync(splitsPath, JSON.stringify(splitSummary, null, 2));
  console.log(`  Splits: ${splitsPath}`);

  // Split directories
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
          try { fs.symlinkSync(src, dst); count++; } catch { try { fs.copyFileSync(src, dst); count++; } catch {} }
        }
      });
      console.log(`  ${split}/${label}: ${count}`);
    }
  }

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║          Extraction Complete!                    ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  console.log(`\nDataset: ${CONFIG.outputDir}`);
  console.log(`Next: rsync to RunPod, then python3 training_pipeline.py --dataset-dir /workspace/training-data`);

  await pool.end();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });