/**
 * VeriSource Bluesky Hash Collector
 * 
 * Connects to Bluesky's Jetstream firehose, filters for posts with images,
 * downloads blobs, generates perceptual hashes, and stores to database.
 */

const WebSocket = require('ws');
const sharp = require('sharp');
const imghash = require('imghash');
const { Pool } = require('pg');
const https = require('https');
const http = require('http');
require('dotenv').config();

// Configuration
const config = {
  jetstream: {
    url: 'wss://jetstream2.us-east.bsky.network/subscribe',
    collections: ['app.bsky.feed.post'],
    reconnectDelay: 5000,
    maxReconnectDelay: 60000
  },
  db: {
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000
  },
  processing: {
    hashBits: 16,           // 64-bit hash (16 hex chars)
    maxImageSize: 5000000,  // 5MB max
    timeout: 30000          // 30s timeout for blob download
  }
};

// Database pool
const pool = new Pool(config.db);

// Stats tracking
const stats = {
  postsReceived: 0,
  imagesProcessed: 0,
  hashesStored: 0,
  errors: 0,
  duplicatesSkipped: 0,
  startTime: Date.now()
};

/**
 * Initialize database table if not exists
 */
async function initDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS media_hashes (
      id SERIAL PRIMARY KEY,
      phash BIGINT NOT NULL,
      source VARCHAR(32) NOT NULL,
      source_id VARCHAR(255) NOT NULL,
      source_url VARCHAR(512),
      author_did VARCHAR(255),
      captured_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(source, source_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_media_hashes_phash ON media_hashes(phash);
    CREATE INDEX IF NOT EXISTS idx_media_hashes_source ON media_hashes(source);
    CREATE INDEX IF NOT EXISTS idx_media_hashes_captured_at ON media_hashes(captured_at);
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('[DB] Table media_hashes ready');
  } catch (err) {
    console.error('[DB] Error initializing table:', err.message);
    throw err;
  }
}

/**
 * Download image blob from Bluesky
 */
function downloadBlob(did, cid) {
  return new Promise((resolve, reject) => {
    const url = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
    
    const timeout = setTimeout(() => {
      reject(new Error('Blob download timeout'));
    }, config.processing.timeout);
    
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        reject(new Error(`Blob download failed: ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      let size = 0;
      
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > config.processing.maxImageSize) {
          res.destroy();
          clearTimeout(timeout);
          reject(new Error('Image too large'));
          return;
        }
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      
      res.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Generate perceptual hash from image buffer
 */
async function generatePHash(buffer) {
  try {
    // Normalize image: resize to standard size, convert to grayscale
    const normalized = await sharp(buffer)
      .resize(256, 256, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    // Generate hash using imghash
    const hash = await imghash.hash(buffer, config.processing.hashBits);
    
    // Convert hex hash to BigInt
    return BigInt('0x' + hash);
  } catch (err) {
    throw new Error(`Hash generation failed: ${err.message}`);
  }
}

/**
 * Store hash in database
 */
async function storeHash(hashData) {
  const query = `
    INSERT INTO media_hashes (phash, source, source_id, source_url, author_did, captured_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id
  `;
  
  const values = [
    hashData.phash.toString(),
    hashData.source,
    hashData.sourceId,
    hashData.sourceUrl,
    hashData.authorDid,
    hashData.capturedAt
  ];
  
  try {
    const result = await pool.query(query, values);
    if (result.rows.length > 0) {
      stats.hashesStored++;
      return true;
    } else {
      stats.duplicatesSkipped++;
      return false;
    }
  } catch (err) {
    console.error('[DB] Insert error:', err.message);
    stats.errors++;
    return false;
  }
}

/**
 * Process a single image from a post
 */
async function processImage(image, postMeta) {
  try {
    const cid = image.image?.ref?.$link;
    if (!cid) return;
    
    // Download blob
    const buffer = await downloadBlob(postMeta.did, cid);
    
    // Generate hash
    const phash = await generatePHash(buffer);
    
    // Build post URL
    const postId = postMeta.rkey;
    const sourceUrl = `https://bsky.app/profile/${postMeta.did}/post/${postId}`;
    
    // Store hash
    await storeHash({
      phash,
      source: 'bluesky',
      sourceId: `${postMeta.did}:${cid}`,
      sourceUrl,
      authorDid: postMeta.did,
      capturedAt: new Date(postMeta.createdAt)
    });
    
    stats.imagesProcessed++;
    
  } catch (err) {
    // Log but don't crash - some images will fail
    if (process.env.DEBUG) {
      console.error('[Process] Image error:', err.message);
    }
    stats.errors++;
  }
}

/**
 * Process incoming Jetstream event
 */
async function processEvent(event) {
  try {
    const data = JSON.parse(event);
    
    // Only process commit events with creates
    if (data.kind !== 'commit') return;
    if (data.commit?.operation !== 'create') return;
    if (data.commit?.collection !== 'app.bsky.feed.post') return;
    
    stats.postsReceived++;
    
    const record = data.commit.record;
    if (!record) return;
    
    // Check for embedded images
    const embed = record.embed;
    if (!embed) return;
    
    let images = [];
    
    // Direct image embed
    if (embed.$type === 'app.bsky.embed.images') {
      images = embed.images || [];
    }
    // Image + external link combo
    else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
      if (embed.media?.$type === 'app.bsky.embed.images') {
        images = embed.media.images || [];
      }
    }
    
    if (images.length === 0) return;
    
    // Process each image
    const postMeta = {
      did: data.did,
      rkey: data.commit.rkey,
      createdAt: record.createdAt || new Date().toISOString()
    };
    
    for (const image of images) {
      await processImage(image, postMeta);
    }
    
  } catch (err) {
    if (process.env.DEBUG) {
      console.error('[Event] Parse error:', err.message);
    }
    stats.errors++;
  }
}

/**
 * Print stats periodically
 */
function printStats() {
  const runtime = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.imagesProcessed / (runtime || 1);
  
  console.log(`[Stats] Runtime: ${runtime}s | Posts: ${stats.postsReceived} | Images: ${stats.imagesProcessed} | Stored: ${stats.hashesStored} | Dupes: ${stats.duplicatesSkipped} | Errors: ${stats.errors} | Rate: ${rate.toFixed(2)}/s`);
}

/**
 * Connect to Jetstream and start processing
 */
function connect() {
  const url = `${config.jetstream.url}?wantedCollections=${config.jetstream.collections.join(',')}`;
  
  console.log('[WS] Connecting to Jetstream...');
  
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    console.log('[WS] Connected to Jetstream');
    stats.startTime = Date.now();
  });
  
  ws.on('message', (data) => {
    processEvent(data.toString());
  });
  
  ws.on('close', (code, reason) => {
    console.log(`[WS] Disconnected: ${code} ${reason}`);
    scheduleReconnect();
  });
  
  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    ws.close();
  });
  
  return ws;
}

let reconnectDelay = config.jetstream.reconnectDelay;

function scheduleReconnect() {
  console.log(`[WS] Reconnecting in ${reconnectDelay / 1000}s...`);
  
  setTimeout(() => {
    connect();
  }, reconnectDelay);
  
  // Exponential backoff
  reconnectDelay = Math.min(reconnectDelay * 2, config.jetstream.maxReconnectDelay);
}

/**
 * Graceful shutdown
 */
function shutdown() {
  console.log('\n[System] Shutting down...');
  printStats();
  pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Main entry point
 */
async function main() {
  console.log('=================================');
  console.log('VeriSource Bluesky Hash Collector');
  console.log('=================================\n');
  
  // Validate config
  if (!process.env.DATABASE_URL) {
    console.error('[Error] DATABASE_URL environment variable required');
    process.exit(1);
  }
  
  // Initialize database
  await initDatabase();
  
  // Connect to Jetstream
  connect();
  
  // Print stats every 60 seconds
  setInterval(printStats, 60000);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});