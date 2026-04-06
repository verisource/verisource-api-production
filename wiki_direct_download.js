const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: 'postgresql://postgres:rEjPheNZGZsLHxSdQlflcYTPiQeMcFwB@shinkansen.proxy.rlwy.net:33448/railway',
  ssl: { rejectUnauthorized: false }
});

const outDir = '/mnt/verisource/training-data/real';
fs.mkdirSync(outDir, { recursive: true });

let done = 0, fail = 0, rateLimit = 0;
let currentDelay = 2000; // start conservative to avoid immediate re-ban // start at 1s, adjust dynamically

function buildImageUrl(pageUrl) {
  try {
    const decoded = decodeURIComponent(pageUrl);
    const filename = decoded.split('File:')[1];
    if (!filename) return null;
    const encoded = filename.replace(/ /g, '_');
    const md5 = crypto.createHash('md5').update(encoded).digest('hex');
    const a = md5[0];
    const ab = md5.substring(0, 2);
    return 'https://upload.wikimedia.org/wikipedia/commons/' + a + '/' + ab + '/' + encodeURIComponent(encoded);
  } catch(e) { return null; }
}

// Returns { status, size } — does NOT follow -f so we can see 429s
async function download(url, dest) {
  return new Promise(res => {
    const tmp = dest + '.tmp';
    const curl = spawn('curl', [
      '--http2', '-L', '-s',
      '--max-time', '20',
      '-A', 'VeriSourceBot/1.0 (https://verisource.io; Brian@verisource.io)',
      '-H', 'Accept: image/jpeg,image/*',
      '-o', tmp,
      '-w', '%{http_code}|%{size_download}',
      url
    ]);
    let stdout = '';
    curl.stdout.on('data', d => { stdout += d.toString(); });
    curl.on('close', code => {
      const parts = stdout.trim().split('|');
      const status = parseInt(parts[0]) || 0;
      const size = parseInt(parts[1]) || 0;
      res({ status, size, tmp });
    });
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const r = await pool.query(
    "SELECT source_id, source_url FROM media_hashes WHERE source='wikimedia' AND source_url IS NOT NULL LIMIT 100000"
  );
  console.log('Found:', r.rows.length, 'Wikimedia entries');
  console.log('Starting download with adaptive rate limiting...\n');

  for (const row of r.rows) {
    const imageUrl = buildImageUrl(row.source_url);
    if (!imageUrl) { fail++; continue; }

    const dest = path.join(outDir, 'wiki_' + row.source_id.replace(/[^a-z0-9]/gi, '_').substring(0, 80) + '.jpg');
    if (fs.existsSync(dest)) { done++; continue; }

    let attempts = 0;
    while (attempts < 5) {
      const { status, size, tmp } = await download(imageUrl, dest);

      if (status === 429) {
        // Rate limited — back off hard
        rateLimit++;
        const backoff = Math.min(currentDelay * 3, 30000); // max 30s backoff
        currentDelay = Math.min(currentDelay * 1.5, 5000); // slow down future requests, max 5s
        process.stdout.write(`\n⚠️  429 rate limit hit #${rateLimit} — backing off ${backoff/1000}s (delay now ${currentDelay}ms)\n`);
        try { fs.unlinkSync(tmp); } catch {}
        await sleep(backoff);
        attempts++;
        continue;
      }

      if (status === 200 && size > 1000) {
        try {
          fs.renameSync(tmp, dest);
          done++;
          // Success — gradually speed back up
          currentDelay = Math.max(currentDelay * 0.95, 500);
        } catch {
          fail++;
          try { fs.unlinkSync(tmp); } catch {}
        }
      } else {
        fail++;
        try { fs.unlinkSync(tmp); } catch {}
      }
      break;
    }

    await sleep(currentDelay);

    if ((done + fail) % 100 === 0) {
      process.stdout.write(`\r✅ ${done} ❌ ${fail} ⚠️  ${rateLimit} rate limits | delay: ${Math.round(currentDelay)}ms`);
    }
  }

  console.log('\n\nComplete.');
  console.log('Done:', done, '| Fail:', fail, '| Rate limit hits:', rateLimit);
  pool.end();
}

run();