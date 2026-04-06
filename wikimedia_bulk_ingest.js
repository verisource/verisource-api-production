/**
 * VeriSource — Wikimedia Commons Bulk Ingest Pipeline
 * ====================================================
 * Downloads and indexes millions of real photographs from
 * Wikimedia Commons for AI detection training data.
 *
 * Strategy:
 *   1. Parse Wikimedia SQL dump (commonswiki-latest-image.sql.gz)
 *   2. Filter to high-confidence real photographs (pre-2022, JPEG, min resolution)
 *   3. Download images at high concurrency using RunPod bandwidth
 *   4. Generate pHash + SHA256 fingerprints
 *   5. Batch insert into media_hashes table
 *   6. Checkpoint/resume — safe to interrupt and restart
 *
 * Usage:
 *   node wikimedia_bulk_ingest.js --step download-dump
 *   node wikimedia_bulk_ingest.js --step parse-dump
 *   node wikimedia_bulk_ingest.js --step ingest
 *   node wikimedia_bulk_ingest.js --step all
 *   node wikimedia_bulk_ingest.js --step ingest --resume
 *
 * Options:
 *   --step          download-dump | parse-dump | ingest | all
 *   --resume        Resume from last checkpoint
 *   --concurrent    Concurrent downloads (default: 50)
 *   --batch-size    DB insert batch size (default: 500)
 *   --max-images    Maximum images to ingest (default: unlimited)
 *   --pre-2022      Only include pre-2022 uploads (default: true)
 *   --min-width     Minimum image width (default: 800)
 *   --min-height    Minimum image height (default: 600)
 *   --output-dir    Directory for downloaded images
 *
 * Requirements:
 *   npm install pg sharp axios p-limit piscina
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { Pool } = require('pg');
const { execSync, spawn } = require('child_process');

// ─── Configuration ───────────────────────────────────────────

const CONFIG = {
  baseDir:          '/mnt/verisource/wikimedia-ingest',
  imageDir:         '/mnt/verisource/wikimedia-images',
  dumpDir:          '/workspace/wikimedia-dump',
  checkpointFile:   '/mnt/verisource/wikimedia-ingest/checkpoint.json',
  urlListFile:      '/mnt/verisource/wikimedia-ingest/image_urls.jsonl',
  progressFile:     '/mnt/verisource/wikimedia-ingest/progress.json',
  logFile:          '/mnt/verisource/wikimedia-ingest/ingest.log',

  dumpUrl:          'https://dumps.wikimedia.org/commonswiki/latest/commonswiki-latest-image.sql.gz',

  pre2022Only:      true,
  cutoffDate:       '20220601000000',
  minWidth:         800,
  minHeight:        600,
  allowedMimeTypes: ['jpeg', 'jpg'],

  concurrent:       5,
  downloadTimeout:  20000,
  maxRetries:       3,
  retryDelay:       2000,
  maxDownloadBytes: 50 * 1024 * 1024,
  userAgent:        'VeriSourceBot/1.0 (https://verisource.io; training-data@verisource.io) Node.js',

  batchSize:        500,
  maxImages:        Infinity,
  skipExisting:     true,
};

// Parse CLI args
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const t = args[i];
  const next = args[i + 1];
  const hasVal = next && !next.startsWith('--');
  switch (t) {
    case '--concurrent':    if (hasVal) { CONFIG.concurrent = parseInt(next); i++; } break;
    case '--batch-size':    if (hasVal) { CONFIG.batchSize = parseInt(next); i++; } break;
    case '--max-images':    if (hasVal) { CONFIG.maxImages = parseInt(next); i++; } break;
    case '--min-width':     if (hasVal) { CONFIG.minWidth = parseInt(next); i++; } break;
    case '--min-height':    if (hasVal) { CONFIG.minHeight = parseInt(next); i++; } break;
    case '--output-dir':    if (hasVal) { CONFIG.imageDir = next; i++; } break;
    case '--no-pre-2022':   CONFIG.pre2022Only = false; break;
    case '--resume':        CONFIG.resume = true; break;
  }
}

const STEP = args.find(a => !a.startsWith('--')) || 'all';

for (const dir of [CONFIG.baseDir, CONFIG.imageDir, CONFIG.dumpDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ─── Logging ─────────────────────────────────────────────────

const logStream = fs.createWriteStream(CONFIG.logFile, { flags: 'a' });

function log(msg, level = 'INFO') {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

function logProgress(stats) {
  process.stdout.write(
    `\r  ✅ ${stats.ingested.toLocaleString()} ingested | ` +
    `⏭️  ${stats.skipped.toLocaleString()} skipped | ` +
    `❌ ${stats.failed.toLocaleString()} failed | ` +
    `📋 ${stats.total.toLocaleString()} total | ` +
    `⚡ ${stats.rate}/min`
  );
}

// ─── Database ────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_hashes (
      id SERIAL PRIMARY KEY,
      phash VARCHAR(64),
      sha256 VARCHAR(64),
      source VARCHAR(50),
      source_id VARCHAR(255),
      source_url TEXT,
      author_handle VARCHAR(255),
      author_did VARCHAR(255),
      post_created_at TIMESTAMP,
      ingested_at TIMESTAMP DEFAULT NOW(),
      phash_cluster_id INTEGER,
      is_blocked BOOLEAN DEFAULT FALSE,
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      UNIQUE(source, source_id)
    )
  `);

  for (const col of [
    'ALTER TABLE media_hashes ADD COLUMN IF NOT EXISTS width INTEGER',
    'ALTER TABLE media_hashes ADD COLUMN IF NOT EXISTS height INTEGER',
    'ALTER TABLE media_hashes ADD COLUMN IF NOT EXISTS file_size INTEGER',
  ]) {
    await pool.query(col).catch(() => {});
  }

  await pool.query('CREATE INDEX IF NOT EXISTS idx_mh_phash ON media_hashes(phash)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_mh_source ON media_hashes(source,source_id)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_mh_sha256 ON media_hashes(sha256)').catch(() => {});
}

async function batchInsert(records) {
  if (records.length === 0) return 0;

  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const r of records) {
    values.push(`($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},NOW())`);
    params.push(
      r.phash,
      r.sha256,
      'wikimedia',
      r.source_id,
      r.source_url,
      r.author || null,
      r.upload_date || null,
      r.file_size || null,
    );
  }

  const sql = `
    INSERT INTO media_hashes (phash, sha256, source, source_id, source_url, author_handle, post_created_at, file_size, ingested_at)
    VALUES ${values.join(',')}
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id
  `;

  try {
    const result = await pool.query(sql, params);
    return result.rowCount;
  } catch (err) {
    log(`Batch insert error: ${err.message}`, 'ERROR');
    return 0;
  }
}

async function getExistingSourceIds() {
  log('Loading existing Wikimedia source IDs from database...');
  const result = await pool.query(
    `SELECT source_id FROM media_hashes WHERE source = 'wikimedia'`
  );
  const existing = new Set(result.rows.map(r => r.source_id));
  log(`Found ${existing.size.toLocaleString()} existing Wikimedia entries`);
  return existing;
}

// ─── Wikimedia URL Builder ────────────────────────────────────

function buildWikimediaUrl(filename) {
  const encoded = filename.replace(/ /g, '_');
  const md5 = crypto.createHash('md5').update(encoded).digest('hex');
  const a = md5[0];
  const ab = md5.substring(0, 2);
  const encodedFilename = encodeURIComponent(encoded).replace(/%2F/g, '/');
  return `https://upload.wikimedia.org/wikipedia/commons/${a}/${ab}/${encodedFilename}`;
}

function buildWikiPageUrl(filename) {
  const encoded = encodeURIComponent(filename.replace(/ /g, '_'));
  return `https://commons.wikimedia.org/wiki/File:${encoded}`;
}

function parseWikimediaTimestamp(ts) {
  if (!ts || ts.length < 14) return null;
  try {
    const y = ts.substring(0, 4);
    const mo = ts.substring(4, 6);
    const d = ts.substring(6, 8);
    const h = ts.substring(8, 10);
    const mi = ts.substring(10, 12);
    const s = ts.substring(12, 14);
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  } catch {
    return null;
  }
}

// ─── Step 1: Download Dump ────────────────────────────────────

async function downloadDump() {
  const gzFile = path.join(CONFIG.dumpDir, 'commonswiki-latest-image.sql.gz');
  const sqlFile = path.join(CONFIG.dumpDir, 'commonswiki-latest-image.sql');

  if (fs.existsSync(sqlFile)) {
    const stats = fs.statSync(sqlFile);
    if (stats.size > 1e9) {
      log(`SQL dump already exists (${(stats.size / 1e9).toFixed(1)}GB), skipping download`);
      return sqlFile;
    }
  }

  log('╔══════════════════════════════════════════════════╗');
  log('║   Step 1: Downloading Wikimedia Dump            ║');
  log('╚══════════════════════════════════════════════════╝');
  log(`URL: ${CONFIG.dumpUrl}`);

  if (!fs.existsSync(gzFile) || fs.statSync(gzFile).size < 1e9) {
    log('Downloading compressed dump...');
    await new Promise((resolve, reject) => {
      const wget = spawn('wget', ['-c', '--progress=dot:giga', '-O', gzFile, CONFIG.dumpUrl], { stdio: 'inherit' });
      wget.on('close', code => code === 0 ? resolve() : reject(new Error(`wget failed: ${code}`)));
    });
    log('✅ Download complete');
  }

  log('Decompressing dump...');
  await new Promise((resolve, reject) => {
    const gunzip = spawn('gunzip', ['-k', '-v', gzFile], { stdio: 'inherit' });
    gunzip.on('close', code => code === 0 ? resolve() : reject(new Error(`gunzip failed: ${code}`)));
  });
  log('✅ Decompression complete');

  return sqlFile;
}

// ─── Step 2: Parse Dump ───────────────────────────────────────

async function parseDump() {
  log('╔══════════════════════════════════════════════════╗');
  log('║   Step 2: Parsing Wikimedia Dump                ║');
  log('╚══════════════════════════════════════════════════╝');

  const gzFile = path.join(CONFIG.dumpDir, 'commonswiki-latest-image.sql.gz');
  const zlib = require('zlib');
  const urlListPath = CONFIG.urlListFile;
  const writeStream = fs.createWriteStream(urlListPath);
  const gunzipStream = fs.createReadStream(gzFile).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: gunzipStream, crlfDelay: Infinity });

  let linesProcessed = 0;
  let imagesFound = 0;
  let imagesFiltered = 0;
  const startTime = Date.now();

  log('Parsing SQL dump...');

  for await (const line of rl) {
    linesProcessed++;
    if (!line.startsWith('INSERT INTO `image`')) continue;

    const valuesMatch = line.match(/VALUES\s*(.+)$/s);
    if (!valuesMatch) continue;

    const records = splitSQLValues(valuesMatch[1]);

    for (const record of records) {
      try {
        const parsed = parseSQLRecord(record);
        if (!parsed) continue;

        imagesFound++;

        if (!["jpg","jpeg"].includes(parsed.name.toLowerCase().split(".").pop())) continue;
        if (parsed.width < CONFIG.minWidth) continue;
        if (parsed.height < CONFIG.minHeight) continue;
        if (CONFIG.pre2022Only && parsed.timestamp > CONFIG.cutoffDate) continue;

        const imageUrl = buildWikimediaUrl(parsed.name);
        const pageUrl = buildWikiPageUrl(parsed.name);

        const entry = {
          name: parsed.name,
          source_id: parsed.name,
          image_url: imageUrl,
          page_url: pageUrl,
          width: parsed.width,
          height: parsed.height,
          size: parsed.size,
          sha1: parsed.sha1,
          timestamp: parsed.timestamp,
          upload_date: parseWikimediaTimestamp(parsed.timestamp),
        };

        if (imagesFiltered % 10 !== 0) { imagesFiltered++; continue; }
        writeStream.write(JSON.stringify(entry) + '\n');
        imagesFiltered++;

      } catch (err) {
        // Skip malformed records
      }
    }

    if (linesProcessed % 100000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(linesProcessed / elapsed);
      process.stdout.write(
        `\r  Lines: ${linesProcessed.toLocaleString()} | ` +
        `Found: ${imagesFound.toLocaleString()} | ` +
        `Filtered in: ${imagesFiltered.toLocaleString()} | ` +
        `Rate: ${rate}/s`
      );
    }
  }

  writeStream.end();
  console.log('');
  log(`\n✅ Parse complete: ${imagesFiltered.toLocaleString()} images passing filters`);
  log(`   URL list saved to: ${urlListPath}`);

  fs.writeFileSync(path.join(CONFIG.baseDir, 'parse_stats.json'), JSON.stringify({
    parsed_at: new Date().toISOString(),
    lines_processed: linesProcessed,
    images_found: imagesFound,
    images_filtered: imagesFiltered,
    filters: { pre2022Only: CONFIG.pre2022Only, minWidth: CONFIG.minWidth, minHeight: CONFIG.minHeight }
  }, null, 2));

  return imagesFiltered;
}

function parseSQLRecord(record) {
  const inner = record.trim().replace(/^\(/, '').replace(/\)$/, '');
  const fields = [];
  let current = '';
  let inString = false;
  let escape = false;

  for (const char of inner) {
    if (escape) { current += char; escape = false; }
    else if (char === '\\') { escape = true; current += char; }
    else if (char === "'" && !inString) { inString = true; current += char; }
    else if (char === "'" && inString) { inString = false; current += char; }
    else if (char === ',' && !inString) { fields.push(current.trim()); current = ''; }
    else { current += char; }
  }
  if (current) fields.push(current.trim());

  if (fields.length < 11) return null;

  const unquote = s => s.replace(/^'/, '').replace(/'$/, '').replace(/\\'/g, "'");

  return {
    name:      unquote(fields[0]),
    size:      parseInt(fields[1]) || 0,
    width:     parseInt(fields[2]) || 0,
    height:    parseInt(fields[3]) || 0,
    sha1:      unquote(fields[12]),
    timestamp: unquote(fields[11]),
  };
}

function splitSQLValues(valuesStr) {
  const records = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    if (escape) { escape = false; continue; }
    if (char === '\\' && inString) { escape = true; continue; }
    if (char === "'" && !inString) { inString = true; continue; }
    if (char === "'" && inString) { inString = false; continue; }
    if (inString) continue;
    if (char === '(') { if (depth === 0) start = i; depth++; }
    else if (char === ')') { depth--; if (depth === 0) records.push(valuesStr.substring(start, i + 1)); }
  }

  return records;
}

// ─── Image Download and Hash ──────────────────────────────────

function downloadImage(url, destPath, timeout) {
  const to = timeout || CONFIG.downloadTimeout;
  return new Promise(function(resolve, reject) {
    const tmpPath = destPath + '.tmp';
    const timeoutSecs = Math.ceil(to / 1000);
    const fs2 = require('fs');
    const args = [
      '--http2', '-L', '-s', '-f',
      '--max-time', String(timeoutSecs),
      '--connect-timeout', '10',
      '-A', CONFIG.userAgent,
      '-H', 'Accept: image/*',
      '-o', tmpPath,
      '-w', '%{http_code}|%{size_download}',
      url
    ];
    const curl = spawn('curl', args);
    let stdout = '';
    curl.stdout.on('data', d => { stdout += d.toString(); });
    curl.on('close', code => {
      try {
        if (code !== 0) {
          try { if (fs2.existsSync(tmpPath)) fs2.unlinkSync(tmpPath); } catch(e) {}
          return reject(new Error('curl failed=' + code));
        }
        const parts = stdout.trim().split('|');
        const httpCode = parseInt(parts[0]) || 0;
        if (httpCode !== 200) {
          try { if (fs2.existsSync(tmpPath)) fs2.unlinkSync(tmpPath); } catch(e) {}
          return reject(new Error('HTTP ' + httpCode));
        }
        if (!fs2.existsSync(tmpPath)) return reject(new Error('missing'));
        const stat = fs2.statSync(tmpPath);
        if (stat.size < 1000) {
          try { fs2.unlinkSync(tmpPath); } catch(e) {}
          return reject(new Error('too small'));
        }
        fs2.renameSync(tmpPath, destPath);
        resolve({ size: stat.size, sha256: '' });
      } catch(e) {
        try { if (fs2.existsSync(tmpPath)) fs2.unlinkSync(tmpPath); } catch(ex) {}
        reject(e);
      }
    });
    curl.on('error', err => reject(new Error('curl: ' + err.message)));
  });
}

async function generatePHash(imagePath) {
  try {
    const sharp = require('sharp');
    const { data } = await sharp(imagePath)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Array.from(data);
    const size = 32;
    const smallSize = 8;
    const dct = [];

    for (let u = 0; u < smallSize; u++) {
      for (let v = 0; v < smallSize; v++) {
        let sum = 0;
        for (let x = 0; x < size; x++) {
          for (let y = 0; y < size; y++) {
            sum += pixels[x * size + y] *
              Math.cos((2 * x + 1) * u * Math.PI / (2 * size)) *
              Math.cos((2 * y + 1) * v * Math.PI / (2 * size));
          }
        }
        dct.push(sum);
      }
    }

    const dctSubset = dct.slice(1);
    const mean = dctSubset.reduce((a, b) => a + b, 0) / dctSubset.length;
    const bits = dctSubset.map(v => v > mean ? 1 : 0);
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4).join(''), 2).toString(16);
    }
    return hex.padEnd(16, '0').substring(0, 16);
  } catch {
    return null;
  }
}

// ─── Step 3: Ingest ───────────────────────────────────────────

async function ingest() {
  log('╔══════════════════════════════════════════════════╗');
  log('║   Step 3: Downloading and Ingesting Images      ║');
  log('╚══════════════════════════════════════════════════╝');

  if (!fs.existsSync(CONFIG.urlListFile)) {
    throw new Error(`URL list not found at ${CONFIG.urlListFile}. Run --step parse-dump first`);
  }

  await ensureTable();

  let checkpoint = { lastLine: 0, ingested: 0, skipped: 0, failed: 0 };
  if (CONFIG.resume && fs.existsSync(CONFIG.checkpointFile)) {
    checkpoint = JSON.parse(fs.readFileSync(CONFIG.checkpointFile, 'utf8'));
    log(`Resuming from line ${checkpoint.lastLine.toLocaleString()}`);
  }

  const existingIds = CONFIG.skipExisting ? await getExistingSourceIds() : new Set();

  log('Counting total URLs...');
  const totalLines = parseInt(execSync(`wc -l < ${CONFIG.urlListFile}`).toString().trim());
  log(`Total images to process: ${totalLines.toLocaleString()}`);

  const urlStream = fs.createReadStream(CONFIG.urlListFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: urlStream });

  const stats = {
    total: totalLines,
    ingested: checkpoint.ingested,
    skipped: checkpoint.skipped,
    failed: checkpoint.failed,
    rate: 0,
  };

  let pendingBatch = [];
  let lineNumber = 0;
  const startTime = Date.now();
  let lastRateCalc = Date.now();
  let lastIngestedCount = stats.ingested;

  const saveCheckpoint = () => {
    fs.writeFileSync(CONFIG.checkpointFile, JSON.stringify({
      ...checkpoint,
      lastLine: lineNumber,
      ingested: stats.ingested,
      skipped: stats.skipped,
      failed: stats.failed,
      savedAt: new Date().toISOString(),
    }, null, 2));
  };

  const checkpointInterval = setInterval(saveCheckpoint, 30000);

  const rateInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastRateCalc) / 1000 / 60;
    stats.rate = Math.round((stats.ingested - lastIngestedCount) / elapsed);
    lastIngestedCount = stats.ingested;
    lastRateCalc = now;
    logProgress(stats);
  }, 10000);

  async function processEntry(entry) {
    if (existingIds.has(entry.source_id)) { stats.skipped++; return; }

    const safeId = entry.source_id.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const imagePath = path.join(CONFIG.imageDir, safeId + '.jpg');

    try {
      let downloadResult;
      for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
        try {
          downloadResult = await downloadImage(encodeURI(entry.image_url), imagePath);
          break;
        } catch (err) {
          if (attempt === CONFIG.maxRetries - 1) throw err;
          if (err.message.includes('404')) throw err;
          await new Promise(r => setTimeout(r, CONFIG.retryDelay * (attempt + 1)));
        }
      }

      const phash = await generatePHash(imagePath);

      pendingBatch.push({
        phash: phash || null,
        sha256: downloadResult.sha256,
        source_id: entry.source_id,
        source_url: entry.page_url,
        author: null,
        upload_date: entry.upload_date,
        file_size: downloadResult.size,
      });

      existingIds.add(entry.source_id);
      stats.ingested++;
      await new Promise(r => setTimeout(r, 500));

      if (pendingBatch.length >= CONFIG.batchSize) {
        const batch = pendingBatch.splice(0, CONFIG.batchSize);
        await batchInsert(batch);
      }

    } catch (err) {
      stats.failed++;
      try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch {}
    }
  }

  const processConcurrent = async (entries) => {
    const semaphore = new Array(CONFIG.concurrent).fill(null);
    let entryIdx = 0;
    const worker = async () => {
      while (entryIdx < entries.length) {
        if (stats.ingested >= CONFIG.maxImages) break;
        const entry = entries[entryIdx++];
        await processEntry(entry);
      }
    };
    await Promise.all(semaphore.map(() => worker()));
  };

  const CHUNK_SIZE = 1000;
  let chunk = [];

  for await (const line of rl) {
    lineNumber++;
    if (lineNumber <= checkpoint.lastLine) continue;
    if (!line.trim()) continue;

    try {
      chunk.push(JSON.parse(line));
    } catch { continue; }

    if (chunk.length >= CHUNK_SIZE) {
      await processConcurrent(chunk);
      chunk = [];
      if (pendingBatch.length > 0) await batchInsert(pendingBatch.splice(0));
      saveCheckpoint();
      if (stats.ingested >= CONFIG.maxImages) { log(`\nReached max images limit`); break; }
    }
  }

  if (chunk.length > 0) await processConcurrent(chunk);
  if (pendingBatch.length > 0) await batchInsert(pendingBatch);

  clearInterval(checkpointInterval);
  clearInterval(rateInterval);
  saveCheckpoint();

  console.log('');
  log('\n✅ Ingest complete!');
  log(`   Ingested:  ${stats.ingested.toLocaleString()}`);
  log(`   Skipped:   ${stats.skipped.toLocaleString()} (already in DB)`);
  log(`   Failed:    ${stats.failed.toLocaleString()}`);
  log(`   Total time: ${((Date.now() - startTime) / 3600000).toFixed(1)} hours`);

  const countResult = await pool.query(`SELECT COUNT(*) FROM media_hashes WHERE source = 'wikimedia'`);
  log(`   Total Wikimedia in DB: ${parseInt(countResult.rows[0].count).toLocaleString()}`);
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  log('╔══════════════════════════════════════════════════╗');
  log('║   VeriSource Wikimedia Bulk Ingest v1.0         ║');
  log('╚══════════════════════════════════════════════════╝');
  log(`Step: ${STEP}`);
  log(`Concurrent downloads: ${CONFIG.concurrent}`);
  log(`Pre-2022 only: ${CONFIG.pre2022Only}`);
  log(`Min resolution: ${CONFIG.minWidth}x${CONFIG.minHeight}`);
  log(`Output dir: ${CONFIG.imageDir}`);

  try {
    if (STEP === 'download-dump' || STEP === 'all') await downloadDump();
    if (STEP === 'parse-dump'   || STEP === 'all') await parseDump();
    if (STEP === 'ingest'       || STEP === 'all') await ingest();
    log('\n✅ All steps complete');
  } catch (err) {
    log(`Fatal error: ${err.message}`, 'ERROR');
    log(err.stack, 'ERROR');
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
}

main();