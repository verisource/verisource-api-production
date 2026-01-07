/**
 * Bluesky Hash Collector for VeriSource
 * 
 * Connects to Bluesky Jetstream firehose, filters for images,
 * generates pHash, and stores to database.
 */

const WebSocket = require('ws');
const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const imghash = require('imghash');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Stats tracking
let stats = {
  connected: false,
  postsReceived: 0,
  imagesFound: 0,
  imagesHashed: 0,
  imagesSaved: 0,
  errors: 0,
  startTime: Date.now()
};

/**
 * Download blob from Bluesky CDN
 */
async function downloadBlob(did, cid) {
  return new Promise((resolve, reject) => {
    // Use the CDN URL format
    const url = `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${cid}@jpeg`;
    
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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
    // Convert to PNG for consistent hashing
    const normalizedBuffer = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'fill' })
      .grayscale()
      .png()
      .toBuffer();
    
    // Save temp file for imghash
    const tempPath = path.join(os.tmpdir(), `hash_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tempPath, normalizedBuffer);
    
    // Generate hash
    const hash = await imghash.hash(tempPath, 16);
    
    // Cleanup
    fs.unlinkSync(tempPath);
    
    return hash;
  } catch (err) {
    console.error('pHash error:', err.message);
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
    INSERT INTO media_hashes (phash, sha256, source, source_id, source_url, author_handle, author_did, captured_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id
  `;
  
  try {
    const result = await pool.query(query, [
      data.phash,
      data.sha256,
      'bluesky',
      data.source_id,
      data.source_url,
      data.author_handle,
      data.author_did,
      data.captured_at
    ]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('DB save error:', err.message);
    return false;
  }
}

/**
 * Process a post with images
 */
async function processPost(commit) {
  try {
    const record = commit.record;
    const did = commit.did;
    const rkey = commit.rkey;
    
    // Check for embedded images
    const embed = record?.embed;
    if (!embed) return;
    
    let images = [];
    
    // Handle different embed types
    if (embed.$type === 'app.bsky.embed.images') {
      images = embed.images || [];
    } else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
      images = embed.media?.images || [];
    }
    
    if (images.length === 0) return;
    
    stats.imagesFound += images.length;
    
    for (const image of images) {
      // Try different ways to get the CID
      const cid = image.image?.ref?.$link || 
                  image.image?.ref?.toString() || 
                  image.image?.cid ||
                  (typeof image.image?.ref === 'string' ? image.image.ref : null);
      
      if (!cid) {
        console.log('No CID found in image:', JSON.stringify(image).slice(0, 200));
        stats.errors++;
        continue;
      }
      
      try {
        // Download blob
        const imageBuffer = await downloadBlob(did, cid);
        
        // Generate hashes
        const [phash, sha256] = await Promise.all([
          generatePHash(imageBuffer),
          generateSHA256(imageBuffer)
        ]);
        
        if (!phash) {
          stats.errors++;
          continue;
        }
        
        stats.imagesHashed++;
        
        // Build post URL
        const postUrl = `https://bsky.app/profile/${did}/post/${rkey}`;
        
        // Save to database
        const saved = await saveHash({
          phash,
          sha256,
          source_id: `${did}/${rkey}/${cid}`,
          source_url: postUrl,
          author_handle: null,
          author_did: did,
          captured_at: new Date(record.createdAt)
        });
        
        if (saved) {
          stats.imagesSaved++;
          console.log(`✅ Saved: ${postUrl}`);
        }
        
      } catch (err) {
        stats.errors++;
        console.error(`Image error: ${err.message}`);
      }
    }
  } catch (err) {
    stats.errors++;
    console.error(`Post error: ${err.message}`);
  }
}

/**
 * Print stats every 30 seconds
 */
function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.imagesSaved / (uptime / 60) || 0;
  
  console.log(`\n📊 Stats (${uptime}s uptime):`);
  console.log(`   Posts received: ${stats.postsReceived}`);
  console.log(`   Images found: ${stats.imagesFound}`);
  console.log(`   Images hashed: ${stats.imagesHashed}`);
  console.log(`   Images saved: ${stats.imagesSaved}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Rate: ${rate.toFixed(1)} images/min`);
}

/**
 * Connect to Jetstream
 */
function connect() {
  console.log('🔌 Connecting to Bluesky Jetstream...');
  
  const ws = new WebSocket(JETSTREAM_URL);
  
  ws.on('open', () => {
    console.log('✅ Connected to Jetstream');
    stats.connected = true;
  });
  
  ws.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      // Only process commit events for posts
      if (event.kind === 'commit' && event.commit?.operation === 'create') {
        stats.postsReceived++;
        await processPost(event.commit);
      }
    } catch (err) {
      stats.errors++;
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Disconnected from Jetstream, reconnecting in 5s...');
    stats.connected = false;
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    stats.errors++;
  });
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Starting Bluesky Hash Collector');
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
  
  // Test database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  
  // Start stats printer
  setInterval(printStats, 30000);
  
  // Connect to Jetstream
  connect();
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  printStats();
  await pool.end();
  process.exit(0);
});

main();
