const {Pool} = require('pg');
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: 'postgresql://postgres:rEjPheNZGZsLHxSdQlflcYTPiQeMcFwB@shinkansen.proxy.rlwy.net:33448/railway',
  ssl: {rejectUnauthorized: false}
});

const outDir = '/mnt/verisource/training-data/real';
fs.mkdirSync(outDir, {recursive: true});

let done = 0, fail = 0;

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

async function download(url, dest) {
  return new Promise(res => {
    const curl = spawn('curl', ['--http2','-L','-s','-f','--max-time','15','-A','VeriSourceBot/1.0','-o',dest,url]);
    curl.on('close', code => {
      if (code===0 && fs.existsSync(dest) && fs.statSync(dest).size > 1000) done++;
      else { fail++; try { fs.unlinkSync(dest); } catch {} }
      res();
    });
  });
}

async function run() {
  const r = await pool.query("SELECT source_id, source_url FROM media_hashes WHERE source='wikimedia' AND source_url IS NOT NULL LIMIT 100000");
  console.log('Found:', r.rows.length, 'Wikimedia entries');
  for (const row of r.rows) {
    const imageUrl = buildImageUrl(row.source_url);
    if (!imageUrl) { fail++; continue; }
    const dest = path.join(outDir, 'wiki_' + row.source_id.replace(/[^a-z0-9]/gi,'_').substring(0,80) + '.jpg');
    if (fs.existsSync(dest)) { done++; continue; }
    await download(imageUrl, dest);
    await new Promise(r => setTimeout(r, 300));
    if ((done+fail) % 100 === 0) process.stdout.write('\r✅ ' + done + ' ❌ ' + fail);
  }
  console.log('\nComplete. Done:', done, 'Fail:', fail);
  pool.end();
}

run();