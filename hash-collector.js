/**
 * VeriSource Bluesky Hash Collector - HYBRID MODE
 * 
 * Strategy:
 * - Tier 1: Curated journalist accounts → Index IMMEDIATELY
 * - Tier 2: All other posts → Queue, check engagement after 1 hour, index if 50+ likes
 * 
 * This maximizes provenance value while catching viral citizen journalism.
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

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Engagement threshold for non-curated posts
  minLikes: parseInt(process.env.MIN_LIKES) || 50,
  
  // How long to wait before checking engagement (ms)
  engagementDelay: parseInt(process.env.ENGAGEMENT_DELAY) || 60 * 60 * 1000, // 1 hour
  
  // How often to process the pending queue (ms)
  queueInterval: parseInt(process.env.QUEUE_INTERVAL) || 5 * 60 * 1000, // 5 minutes
  
  // Max pending queue size (oldest dropped if exceeded)
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 10000,
  
  // Bluesky API rate limit (requests per minute)
  apiRateLimit: 100
};

// ============================================================================
// CURATED ACCOUNTS - Journalists & News Organizations
// ============================================================================

const CURATED_DIDS = new Set([
  // === MAJOR NEWS ORGANIZATIONS (VERIFIED) ===
  'did:plc:a67zdrt4nl2tv2qojpngogbq', // @apnews.com - Associated Press
  'did:plc:jbvnehrrdqoulco4rf5gxg5r', // @reuters.com - Reuters
  'did:plc:eclio37ymobqex2ncko63h4r', // @nytimes.com - NY Times
  'did:plc:k5nskatzhyxersjilvtnz4lh', // @washingtonpost.com - Washington Post
  'did:plc:i3fhjvvkbmirhyu4aeihhrnv', // @wsj.com - Wall Street Journal
  'did:plc:dzezcmpb3fhcpns4n4xm4ur5', // @cnn.com - CNN
  'did:plc:ln72v57ivz2g46uqf4xxqiuh', // @npr.org - NPR
  'did:plc:vovinwhtulbsx4mwfw26r5ni', // @theguardian.com - The Guardian
  'did:plc:wmho6q2uiyktkam3jsvrms3s', // @nbcnews.com - NBC News
  'did:plc:3bxtpdpr73tf7tldv5q4oyqc', // @cbsnews.com - CBS News
  'did:plc:yf6hctt2ug3qyfty4in64yob', // @politico.com - Politico
  'did:plc:uewxgchsjy4kmtu7dcxa77es', // @bloomberg.com - Bloomberg
  
  // === TECH NEWS (VERIFIED) ===
  'did:plc:vtpyqvwce4x6gpa5dcizqecy', // @techcrunch.com - TechCrunch
  'did:plc:7exlcsle4mjfhu3wnhcgizz6', // @theverge.com - The Verge
  'did:plc:inz4fkbbp7ms3ixufw6xuvdi', // @wired.com - Wired
  
  // Note: bbc.com, abcnews.go.com, bellingcat.bsky.social not found on Bluesky
  // Add more verified DIDs as news orgs join Bluesky
]);

// ============================================================================
// DATABASE & STATE
// ============================================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// In-memory pending queue for engagement checks
// Map: postUri -> { did, rkey, images[], createdAt, queuedAt }
const pendingQueue = new Map();

let stats = {
  connected: false,
  postsReceived: 0,
  curatedIndexed: 0,
  queuedForEngagement: 0,
  engagementChecks: 0,
  engagementPassed: 0,
  engagementFailed: 0,
  imagesFound: 0,
  imagesHashed: 0,
  imagesSaved: 0,
  errors: 0,
  apiCalls: 0,
  startTime: Date.now()
};

// ============================================================================
// BLUESKY API - Engagement Check
// ============================================================================

async function getPostEngagement(did, rkey) {
  return new Promise((resolve, reject) => {
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ likes: 0, reposts: 0, error: `HTTP ${res.statusCode}` });
            return;
          }
          
          const json = JSON.parse(data);
          const post = json.thread?.post;
          
          if (!post) {
            resolve({ likes: 0, reposts: 0, error: 'Post not found' });
            return;
          }
          
          resolve({
            likes: post.likeCount || 0,
            reposts: post.repostCount || 0,
            replies: post.replyCount || 0
          });
        } catch (err) {
          resolve({ likes: 0, reposts: 0, error: err.message });
        }
      });
      res.on('error', () => resolve({ likes: 0, reposts: 0, error: 'Request failed' }));
    }).on('error', () => resolve({ likes: 0, reposts: 0, error: 'Connection failed' }));
    
    stats.apiCalls++;
  });
}

// ============================================================================
// IMAGE PROCESSING
// ============================================================================

async function downloadBlob(did, cid) {
  return new Promise((resolve, reject) => {
    const url = `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${cid}@jpeg`;
    
    https.get(url, (res) => {
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

function generateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ============================================================================
// DATABASE
// ============================================================================

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
      'bluesky',
      data.source_id,
      data.source_url,
      data.author_handle,
      data.author_did,
      data.post_created_at
    ]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('DB save error:', err.message);
    return false;
  }
}

// ============================================================================
// IMAGE INDEXING
// ============================================================================

async function indexImages(did, rkey, images, createdAt, tier) {
  const postUrl = `https://bsky.app/profile/${did}/post/${rkey}`;
  let savedCount = 0;
  
  for (const image of images) {
    const cid = image.image?.ref?.$link || 
                image.image?.ref?.toString() || 
                image.image?.cid;
    
    if (!cid) {
      stats.errors++;
      continue;
    }
    
    try {
      const imageBuffer = await downloadBlob(did, cid);
      
      const [phash, sha256] = await Promise.all([
        generatePHash(imageBuffer),
        generateSHA256(imageBuffer)
      ]);
      
      if (!phash) {
        stats.errors++;
        continue;
      }
      
      stats.imagesHashed++;
      
      const saved = await saveHash({
        phash,
        sha256,
        source_id: `${did}/${rkey}/${cid}`,
        source_url: postUrl,
        author_handle: null,
        author_did: did,
        post_created_at: new Date(createdAt)
      });
      
      if (saved) {
        stats.imagesSaved++;
        savedCount++;
        console.log(`✅ [${tier}] Saved: ${postUrl}`);
      }
      
    } catch (err) {
      stats.errors++;
    }
  }
  
  return savedCount;
}

// ============================================================================
// PENDING QUEUE MANAGEMENT
// ============================================================================

function addToQueue(did, rkey, images, createdAt) {
  const uri = `${did}/${rkey}`;
  
  // Don't re-queue
  if (pendingQueue.has(uri)) return;
  
  // Enforce max queue size (drop oldest)
  if (pendingQueue.size >= CONFIG.maxQueueSize) {
    const oldest = pendingQueue.keys().next().value;
    pendingQueue.delete(oldest);
  }
  
  pendingQueue.set(uri, {
    did,
    rkey,
    images,
    createdAt,
    queuedAt: Date.now()
  });
  
  stats.queuedForEngagement++;
}

async function processQueue() {
  const now = Date.now();
  const toProcess = [];
  
  // Find posts ready for engagement check (queued > 1 hour ago)
  for (const [uri, data] of pendingQueue) {
    if (now - data.queuedAt >= CONFIG.engagementDelay) {
      toProcess.push({ uri, ...data });
    }
  }
  
  if (toProcess.length === 0) return;
  
  console.log(`\n🔍 Processing ${toProcess.length} pending posts for engagement check...`);
  
  // Rate limit: process up to 100 per interval
  const batch = toProcess.slice(0, CONFIG.apiRateLimit);
  
  for (const post of batch) {
    pendingQueue.delete(post.uri);
    stats.engagementChecks++;
    
    const engagement = await getPostEngagement(post.did, post.rkey);
    const totalEngagement = (engagement.likes || 0) + (engagement.reposts || 0);
    
    if (totalEngagement >= CONFIG.minLikes) {
      stats.engagementPassed++;
      console.log(`📈 Engagement passed: ${totalEngagement} (${engagement.likes} likes, ${engagement.reposts} reposts)`);
      await indexImages(post.did, post.rkey, post.images, post.createdAt, 'VIRAL');
    } else {
      stats.engagementFailed++;
      // Silently discard low-engagement posts
    }
    
    // Small delay between API calls
    await new Promise(r => setTimeout(r, 100));
  }
}

// ============================================================================
// EVENT PROCESSING
// ============================================================================

async function processEvent(event) {
  try {
    const did = event.did;
    const commit = event.commit;
    const record = commit?.record;
    const rkey = commit?.rkey;
    
    if (!did || !record || !rkey) return;
    
    // Check for embedded images
    const embed = record?.embed;
    if (!embed) return;
    
    let images = [];
    
    if (embed.$type === 'app.bsky.embed.images') {
      images = embed.images || [];
    } else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
      images = embed.media?.images || [];
    }
    
    if (images.length === 0) return;
    
    stats.imagesFound += images.length;
    
    // TIER 1: Curated accounts - index immediately
    if (CURATED_DIDS.has(did)) {
      stats.curatedIndexed++;
      await indexImages(did, rkey, images, record.createdAt, 'CURATED');
      return;
    }
    
    // TIER 2: All others - queue for engagement check
    addToQueue(did, rkey, images, record.createdAt);
    
  } catch (err) {
    stats.errors++;
  }
}

// ============================================================================
// STATS
// ============================================================================

function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const uptimeMin = uptime / 60;
  const rate = stats.imagesSaved / uptimeMin || 0;
  
  console.log(`\n📊 Stats (${Math.floor(uptimeMin)}m uptime) - HYBRID MODE`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Posts received: ${stats.postsReceived}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   TIER 1 (Curated - Immediate):`);
  console.log(`     Indexed: ${stats.curatedIndexed}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   TIER 2 (Engagement Check):`);
  console.log(`     Queued: ${stats.queuedForEngagement}`);
  console.log(`     Pending: ${pendingQueue.size}`);
  console.log(`     Checked: ${stats.engagementChecks}`);
  console.log(`     Passed (${CONFIG.minLikes}+ likes): ${stats.engagementPassed}`);
  console.log(`     Discarded: ${stats.engagementFailed}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Images hashed: ${stats.imagesHashed}`);
  console.log(`   Images saved: ${stats.imagesSaved}`);
  console.log(`   API calls: ${stats.apiCalls}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Rate: ${rate.toFixed(1)} images/min`);
}

// ============================================================================
// WEBSOCKET CONNECTION
// ============================================================================

function connect() {
  const url = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
  console.log('🔌 Connecting to Bluesky Jetstream (HYBRID MODE)...');
  
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    console.log('✅ Connected to Jetstream');
    console.log(`📋 Tier 1: ${CURATED_DIDS.size} curated accounts (immediate)`);
    console.log(`📈 Tier 2: Others queued, indexed if ${CONFIG.minLikes}+ likes after 1 hour`);
    stats.connected = true;
  });
  
  ws.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      
      if (event.kind === 'commit' && event.commit?.operation === 'create') {
        stats.postsReceived++;
        await processEvent(event);
      }
    } catch (err) {
      stats.errors++;
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Disconnected, reconnecting in 5s...');
    stats.connected = false;
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    stats.errors++;
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   VeriSource Bluesky Hash Collector - HYBRID MODE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📦 Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`⚙️  Min engagement: ${CONFIG.minLikes} likes`);
  console.log(`⏱️  Engagement delay: ${CONFIG.engagementDelay / 60000} minutes`);
  console.log(`📋 Curated accounts: ${CURATED_DIDS.size}`);
  
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  
  // Start queue processor
  setInterval(processQueue, CONFIG.queueInterval);
  console.log(`🔄 Queue processor: every ${CONFIG.queueInterval / 60000} minutes`);
  
  // Start stats printer
  setInterval(printStats, 30000);
  
  // Connect to firehose
  connect();
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  printStats();
  console.log(`⚠️  ${pendingQueue.size} posts in pending queue will be lost`);
  await pool.end();
  process.exit(0);
});

main();