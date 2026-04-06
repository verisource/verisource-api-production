const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Wikimedia OAuth 1.0a Credentials ───────────────────────
const OAUTH = {
  consumerKey:    '3c5ed3af67c074751644d9deaa5dfb25',
  consumerSecret: '6a781262d0e26478d6cf20596f08d3834099c6c1',
  accessToken:    'bbbbdb857ce0c32da617472ab4685df1',
  accessSecret:   '0457285dadbd5d6ea1960e4490bfd78612e5c697',
};

const pool = new Pool({
  connectionString: 'postgresql://postgres:rEjPheNZGZsLHxSdQlflcYTPiQeMcFwB@shinkansen.proxy.rlwy.net:33448/railway',
  ssl: { rejectUnauthorized: false }
});

const outDir = '/mnt/verisource/training-data/real';
fs.mkdirSync(outDir, { recursive: true });

let done = 0, fail = 0;

// ─── OAuth 1.0a Header Builder ───────────────────────────────
function buildOAuthHeader(url) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const params = {
    oauth_consumer_key:     OAUTH.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            OAUTH.accessToken,
    oauth_version:          '1.0',
  };

  const sortedParams = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const baseString = [
    'GET',
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  const signingKey = `${encodeURIComponent(OAUTH.consumerSecret)}&${encodeURIComponent(OAUTH.accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  params.oauth_signature = signature;

  return 'OAuth ' + Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
    .join(', ');
}

// ─── Wikimedia URL Builder ────────────────────────────────────
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

// ─── Authenticated Download ───────────────────────────────────
async function download(url, dest) {
  return new Promise(res => {
    const oauthHeader = buildOAuthHeader(url);
    const curl = spawn('curl', [
      '--http2', '-L', '-s', '-f',
      '--max-time', '15',
      '-A', 'VeriSourceBot/1.0 (https://verisource.io; Brian@verisource.io)',
      '-H', `Authorization: ${oauthHeader}`,
      '-o', dest,
      url
    ]);
    curl.on('close', code => {
      if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 1000) done++;
      else { fail++; try { fs.unlinkSync(dest); } catch {} }
      res();
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────
async function run() {
  const r = await pool.query(
    "SELECT source_id, source_url FROM media_hashes WHERE source='wikimedia' AND source_url IS NOT NULL LIMIT 100000"
  );
  console.log('Found:', r.rows.length, 'Wikimedia entries');

  for (const row of r.rows) {
    const imageUrl = buildImageUrl(row.source_url);
    if (!imageUrl) { fail++; continue; }

    const dest = path.join(outDir, 'wiki_' + row.source_id.replace(/[^a-z0-9]/gi, '_').substring(0, 80) + '.jpg');
    if (fs.existsSync(dest)) { done++; continue; }

    await download(imageUrl, dest);
    await new Promise(r => setTimeout(r, 400));
    if ((done + fail) % 100 === 0) process.stdout.write('\r✅ ' + done + ' ❌ ' + fail);
  }

  console.log('\nComplete. Done:', done, 'Fail:', fail);
  pool.end();
}

run();