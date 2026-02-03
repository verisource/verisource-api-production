const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const imghash = require('imghash');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG = {
  searchDelayMs: 3000,
  imageDelayMs: 500,
  maxImagesPerRun: 1000,
  dbTable: 'ai_image_hashes'
};

const SEARCH_QUERIES = [
  'photorealistic portrait', 'anime girl', 'anime boy', 'digital art fantasy',
  'oil painting', 'watercolor', 'concept art', 'cyberpunk', 'steampunk',
  'hyperrealistic', 'pixel art', 'beautiful woman', 'handsome man',
  'fantasy creature', 'dragon', 'robot', 'cat portrait', 'dog portrait',
  'landscape mountain', 'ocean sunset', 'forest', 'city skyline', 'space galaxy',
  'trending artstation', 'unreal engine', 'octane render', 'cinematic lighting',
  'stable diffusion', 'midjourney style', 'product photography', 'game art'
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

let stats = { queriesProcessed: 0, imagesFound: 0, imagesDownloaded: 0, imagesHashed: 0, imagesSaved: 0, skippedDuplicate: 0, skippedDownloadFail: 0, skippedHashFail: 0, errors: 0, startTime: Date.now() };

function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.imagesSaved / (uptime / 60) || 0;
  console.log('\n--- Stats (' + uptime + 's) ---');
  console.log('Queries: ' + stats.queriesProcessed + ', Found: ' + stats.imagesFound + ', Saved: ' + stats.imagesSaved + ', Rate: ' + rate.toFixed(1) + '/min');
}

async function initDatabase() {
  await pool.query('CREATE TABLE IF NOT EXISTS ' + CONFIG.dbTable + ' (id SERIAL PRIMARY KEY, source VARCHAR(50) DEFAULT \'lexica\', source_id VARCHAR(255), source_url TEXT, phash VARCHAR(64), dhash VARCHAR(64), sha256 VARCHAR(64), width INTEGER, height INTEGER, file_size INTEGER, generator_model VARCHAR(255), prompt TEXT, guidance_scale FLOAT, seed BIGINT, is_ai_generated BOOLEAN DEFAULT true, nsfw BOOLEAN DEFAULT false, crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(source, source_id))');
  console.log('Database initialized');
}

function fetchWithCookie(url, cookie) {
  return new Promise(function(resolve, reject) {
    const urlObj = new URL(url);
    const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html', 'Cookie': '__Secure-next-auth.session-token=' + cookie }, timeout: 30000 }, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, data: data }); });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadImage(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://lexica.art/' }, timeout: 30000 }, function(res) {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}

function extractImagesFromHtml(html) {
  const images = [];
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      if (data.props && data.props.pageProps && data.props.pageProps.images) return data.props.pageProps.images;
    } catch (e) {}
  }
  const imgMatches = html.matchAll(/image\.lexica\.art\/(?:md|sm)\/([a-f0-9-]+)/g);
  for (const m of imgMatches) images.push({ id: m[1], src: 'https://image.lexica.art/md/' + m[1] });
  return images;
}

async function searchLexica(query, cookie) {
  try {
    console.log('\nSearching: "' + query + '"');
    const response = await fetchWithCookie('https://lexica.art/?q=' + encodeURIComponent(query), cookie);
    if (response.status !== 200) { console.log('HTTP ' + response.status); return []; }
    const images = extractImagesFromHtml(response.data);
    console.log('Found ' + images.length + ' images');
    return images;
  } catch (err) { console.error('Search error:', err.message); stats.errors++; return []; }
}

async function generatePHash(buf) {
  try {
    const norm = await sharp(buf).resize(64, 64, { fit: 'fill' }).grayscale().png().toBuffer();
    const tmp = path.join(os.tmpdir(), 'lex_' + Date.now() + '.png');
    fs.writeFileSync(tmp, norm);
    const hash = await imghash.hash(tmp, 16);
    fs.unlinkSync(tmp);
    return hash;
  } catch (e) { return null; }
}

async function generateDHash(buf) {
  try {
    const proc = await sharp(buf).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
    const px = Array.from(proc);
    let h = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) h += px[r * 9 + c] < px[r * 9 + c + 1] ? '1' : '0';
    let hex = '';
    for (let i = 0; i < h.length; i += 4) hex += parseInt(h.substr(i, 4), 2).toString(16);
    return hex;
  } catch (e) { return null; }
}

async function imageExists(id) {
  const r = await pool.query('SELECT id FROM ' + CONFIG.dbTable + ' WHERE source=$1 AND source_id=$2', ['lexica', id]);
  return r.rows.length > 0;
}

async function saveImage(d) {
  try {
    const r = await pool.query('INSERT INTO ' + CONFIG.dbTable + ' (source,source_id,source_url,phash,dhash,sha256,width,height,file_size,generator_model,prompt,guidance_scale,seed,is_ai_generated,nsfw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14) ON CONFLICT (source,source_id) DO NOTHING RETURNING id', ['lexica', d.source_id, d.source_url, d.phash, d.dhash, d.sha256, d.width, d.height, d.file_size, d.model || 'stable-diffusion', d.prompt, d.guidance, d.seed, d.nsfw || false]);
    return r.rows.length > 0;
  } catch (e) { return false; }
}

async function processImage(img) {
  try {
    if (!img.id) { stats.errors++; return {}; }
    if (await imageExists(img.id)) { stats.skippedDuplicate++; return { skipped: true }; }
    stats.imagesFound++;
    let buf;
    try { buf = await downloadImage(img.src || 'https://image.lexica.art/md/' + img.id); stats.imagesDownloaded++; } catch (e) { stats.skippedDownloadFail++; return { skipped: true }; }
    let meta;
    try { meta = await sharp(buf).metadata(); } catch (e) { meta = { width: 512, height: 512 }; }
    const phash = await generatePHash(buf);
    const dhash = await generateDHash(buf);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (!phash) { stats.skippedHashFail++; return { skipped: true }; }
    stats.imagesHashed++;
    const saved = await saveImage({ source_id: img.id, source_url: img.gallery || 'https://lexica.art/?q=' + img.id, phash: phash, dhash: dhash, sha256: sha256, width: meta.width, height: meta.height, file_size: buf.length, model: img.model, prompt: img.prompt, guidance: img.guidance, seed: img.seed, nsfw: img.nsfw });
    if (saved) { stats.imagesSaved++; return { success: true }; }
    return { skipped: true };
  } catch (e) { stats.errors++; return { error: true }; }
}

async function crawl(opts) {
  opts = opts || {};
  const queries = opts.queries || SEARCH_QUERIES;
  const maxImages = opts.maxImages || CONFIG.maxImagesPerRun;
  const cookie = opts.cookie || process.env.LEXICA_SESSION_COOKIE;
  if (!cookie) { console.error('LEXICA_SESSION_COOKIE not set'); process.exit(1); }
  console.log('Starting Lexica scraper... Max: ' + maxImages + ', Queries: ' + queries.length);
  await initDatabase();
  let total = 0;
  for (let i = 0; i < queries.length && total < maxImages; i++) {
    const images = await searchLexica(queries[i], cookie);
    stats.queriesProcessed++;
    for (let j = 0; j < images.length && total < maxImages; j++) {
      const r = await processImage(images[j]);
      total++;
      process.stdout.write(r.success ? '.' : r.skipped ? 's' : 'x');
      await new Promise(function(res) { setTimeout(res, CONFIG.imageDelayMs); });
    }
    await new Promise(function(res) { setTimeout(res, CONFIG.searchDelayMs); });
  }
  console.log('\n\nCrawl complete!');
  printStats();
}

async function main() {
  console.log('========================================');
  console.log('VeriSource Lexica Scraper');
  console.log('========================================');
  console.log('Database: ' + (process.env.DATABASE_URL ? 'YES' : 'NO'));
  console.log('Cookie: ' + (process.env.LEXICA_SESSION_COOKIE ? 'YES' : 'NO'));
  if (!process.env.LEXICA_SESSION_COOKIE) { console.error('LEXICA_SESSION_COOKIE required'); process.exit(1); }
  try { await pool.query('SELECT NOW()'); console.log('Database connected'); } catch (e) { console.error('DB failed:', e.message); process.exit(1); }
  await crawl();
  setInterval(function() { crawl(); }, 60 * 60 * 1000);
  setInterval(printStats, 5 * 60 * 1000);
}

process.on('SIGINT', async function() { printStats(); await pool.end(); process.exit(0); });
main().catch(console.error);
