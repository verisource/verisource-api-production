/**
 * VeriSource — Civitai Training Image Downloader
 * Reads source_url from ai_image_hashes and downloads images to disk.
 * Saves to /mnt/verisource/training-data/ai/civitai/
 * Run on RunPod: node download_civitai_images.js
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgresql://postgres:rEjPheNZGZsLHxSdQlflcYTPiQeMcFwB@shinkansen.proxy.rlwy.net:33448/railway',
  ssl: { rejectUnauthorized: false }
});

const OUT_DIR = '/mnt/verisource/training-data/ai/civitai';
const BATCH_SIZE = 1000;
const CONCURRENCY = 10;
const DELAY_MS = 200;
const TARGET = 100000; // download up to 100K

fs.mkdirSync(OUT_DIR, { recursive: true });

let done = 0, fail = 0, skip = 0;

function download(url, dest) {
  return new Promise(res => {
    const tmp = dest + '.tmp';
    const curl = spawn('curl', [
      '-L', '-s', '-f',
      '--max-time', '20',
      '--connect-timeout', '10',
      '-A', 'VeriSourceBot/1.0',
      '-o', tmp,
      url
    ]);
    curl.on('close', code => {
      if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
        fs.renameSync(tmp, dest);
        res(true);
      } else {
        try { fs.unlinkSync(tmp); } catch {}
        res(false);
      }
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function processBatch(rows) {
  const tasks = rows.map(async row => {
    if (!row.source_url) { skip++; return; }

    const safeId = String(row.source_id || row.id).replace(/[^a-z0-9]/gi, '_').substring(0, 80);
    const dest = path.join(OUT_DIR, `civitai_${safeId}.jpg`);

    if (fs.existsSync(dest)) { skip++; return; }

    const success = await download(row.source_url, dest);
    if (success) done++;
    else fail++;

    await sleep(DELAY_MS);
  });

  // Process CONCURRENCY at a time
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + CONCURRENCY));
    process.stdout.write(`\r✅ ${done} ❌ ${fail} ⏭️  ${skip} | total: ${done + fail + skip}`);
  }
}

async function run() {
  console.log('Civitai Training Image Downloader');
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Target: ${TARGET} images\n`);

  const existingCount = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).length;
  console.log(`Already downloaded: ${existingCount}`);
  done = existingCount;

  let offset = 0;

  while ((done + fail) < TARGET) {
    const result = await pool.query(
      `SELECT id, source_id, source_url FROM ai_image_hashes 
       WHERE source_url IS NOT NULL 
         AND (generator_type = 'civitai' OR source_url LIKE '%civitai%' OR source_url LIKE '%image.civitai%')
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (result.rows.length === 0) {
      console.log('\nNo more records to process.');
      break;
    }

    await processBatch(result.rows);
    offset += BATCH_SIZE;

    if (done + fail + skip >= TARGET) break;
  }

  console.log('\n\nComplete!');
  console.log(`Downloaded: ${done} | Failed: ${fail} | Skipped: ${skip}`);
  pool.end();
}

run().catch(console.error);