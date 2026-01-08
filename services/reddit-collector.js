/**
 * Reddit Hash Collector for VeriSource
 * 
 * Crawls public Reddit posts for images, generates pHash,
 * and stores to database. Uses public JSON endpoints (no auth).
 * 
 * Rate limit: ~10 requests/minute without auth
 */

const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const imghash = require('imghash');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Subreddits to crawl (high-value for verification)
const SUBREDDITS = [
  'pics',
  'news',
  'worldnews',
  'videos',
  'interestingasfuck',
  'PublicFreakout',
  'quityourbullshit',
  'insurance',
  'legaladvice',
  'scams'
];

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Stats tracking
let stats = {
  requestsMade: 0,
  postsProcessed: 0,
  imagesFound: 0,
  imagesHashed: 0,
  imagesSaved: 0,
  errors: 0,
  startTime: Date.now()
};

// Track last seen post per subreddit for pagination
const lastSeen = {};

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'VeriSource/1.0 (Content Verification Service)'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Download image from URL
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    
    const options = {
      headers: {
        'User-Agent': 'VeriSource/1.0 (Content Verification Service)'
      }
    };

    protocol.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Generate perceptual hash from image buffer
 */
async function generatePHash(imageBuffer) {
  try {
    const normalizedBuffer = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'fill' })
      .grayscale()
      .png()
      .toBuffer();

    const tempPath = path.join(os.tmpdir(), `hash_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tempPath, normalizedBuffer);

    const hash = await imghash.hash(tempPath, 16);
    fs.unlinkSync(tempPath);

    return hash;
  } catch (err) {
    return null;
  }
}

/**
 * Generate SHA256 hash from buffer
 */
function generateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Save hash to database
 */
async function saveHash(data) {
  const query = `
    INSERT INTO media_hashes (phash, sha256, source, source_id, source_url, author_handle, author_did, post_created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [
      data.phash,
      data.sha256,
      'reddit',
      data.source_id,
      data.source_url,
      data.author_handle,
      null, // author_did not applicable for Reddit
      data.post_created_at
    ]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('DB save error:', err.message);
    return false;
  }
}

/**
 * Extract image URL from Reddit post
 */
function getImageUrl(post) {
  const data = post.data;

  // Direct image links
  if (data.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(data.url)) {
    return data.url;
  }

  // Reddit hosted images
  if (data.url && data.url.includes('i.redd.it')) {
    return data.url;
  }

  // Imgur direct links
  if (data.url && data.url.includes('imgur.com') && !data.url.includes('/a/') && !data.url.includes('/gallery/')) {
    // Convert imgur page to direct image
    if (!data.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return data.url + '.jpg';
    }
    return data.url;
  }

  // Reddit preview images
  if (data.preview?.images?.[0]?.source?.url) {
    // Reddit encodes URLs, need to decode
    return data.preview.images[0].source.url.replace(/&amp;/g, '&');
  }

  // Reddit thumbnail (fallback, lower quality)
  if (data.thumbnail && data.thumbnail.startsWith('http') && !['self', 'default', 'nsfw'].includes(data.thumbnail)) {
    return data.thumbnail;
  }

  return null;
}

/**
 * Process a single Reddit post
 */
async function processPost(post) {
  try {
    const data = post.data;
    const imageUrl = getImageUrl(post);

    if (!imageUrl) return;

    stats.imagesFound++;

    // Download image
    const imageBuffer = await downloadImage(imageUrl);

    // Generate hashes
    const [phash, sha256] = await Promise.all([
      generatePHash(imageBuffer),
      generateSHA256(imageBuffer)
    ]);

    if (!phash) {
      stats.errors++;
      return;
    }

    stats.imagesHashed++;

    // Save to database
    const saved = await saveHash({
      phash,
      sha256,
      source_id: data.id,
      source_url: `https://reddit.com${data.permalink}`,
      author_handle: data.author,
      post_created_at: new Date(data.created_utc * 1000)
    });

    if (saved) {
      stats.imagesSaved++;
      console.log(`✅ Saved: r/${data.subreddit} - ${data.title.slice(0, 50)}...`);
    }

  } catch (err) {
    stats.errors++;
    if (process.env.DEBUG) {
      console.error(`Post error: ${err.message}`);
    }
  }
}

/**
 * Fetch and process posts from a subreddit
 */
async function crawlSubreddit(subreddit) {
  try {
    const after = lastSeen[subreddit] || '';
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25${after ? '&after=' + after : ''}`;

    console.log(`📥 Fetching r/${subreddit}...`);

    const json = await fetchJson(url);
    stats.requestsMade++;

    const posts = json?.data?.children || [];

    if (posts.length > 0) {
      // Update pagination cursor
      lastSeen[subreddit] = json.data.after;

      for (const post of posts) {
        stats.postsProcessed++;
        await processPost(post);
      }
    }

  } catch (err) {
    stats.errors++;
    console.error(`Error crawling r/${subreddit}: ${err.message}`);
  }
}

/**
 * Print stats
 */
function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.imagesSaved / (uptime / 60) || 0;

  console.log(`\n📊 Stats (${uptime}s uptime):`);
  console.log(`   Requests made: ${stats.requestsMade}`);
  console.log(`   Posts processed: ${stats.postsProcessed}`);
  console.log(`   Images found: ${stats.imagesFound}`);
  console.log(`   Images hashed: ${stats.imagesHashed}`);
  console.log(`   Images saved: ${stats.imagesSaved}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Rate: ${rate.toFixed(1)} images/min`);
}

/**
 * Main crawl loop
 */
async function crawlLoop() {
  let subredditIndex = 0;

  while (true) {
    const subreddit = SUBREDDITS[subredditIndex];
    await crawlSubreddit(subreddit);

    // Move to next subreddit
    subredditIndex = (subredditIndex + 1) % SUBREDDITS.length;

    // Wait 6 seconds between requests (~10 req/min to stay under limit)
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Starting Reddit Hash Collector');
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`📋 Subreddits: ${SUBREDDITS.join(', ')}`);

  // Test database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Start stats printer
  setInterval(printStats, 60000);

  // Start crawl loop
  crawlLoop();
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  printStats();
  await pool.end();
  process.exit(0);
});

main();