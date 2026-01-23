/**
 * VeriSource Civitai Crawler Scheduler
 * 
 * Runs the crawler on a schedule for continuous database building.
 * Designed to run as a background service on Railway.
 */

const { crawl, getStats, initDatabase } = require('./crawler');
const { Pool } = require('pg');

// Configuration
const SCHEDULE = {
  // Crawl settings
  imagesPerRun: 500,          // Images per scheduled run
  intervalMinutes: 60,         // Run every hour
  
  // Cursor persistence
  cursorKey: 'civitai_crawler_cursor',
  
  // Health check
  healthCheckPort: process.env.PORT || 3000
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Create metadata table for storing crawler state
 */
async function initMetadata() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crawler_metadata (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get stored cursor for resume
 */
async function getCursor() {
  const result = await pool.query(
    'SELECT value FROM crawler_metadata WHERE key = $1',
    [SCHEDULE.cursorKey]
  );
  return result.rows[0]?.value || null;
}

/**
 * Save cursor for next run
 */
async function saveCursor(cursor) {
  await pool.query(`
    INSERT INTO crawler_metadata (key, value, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `, [SCHEDULE.cursorKey, cursor]);
}

/**
 * Run a single crawl cycle
 */
async function runCrawlCycle() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🕐 Crawl cycle started at ${new Date().toISOString()}`);
  console.log('='.repeat(50));
  
  try {
    // Get saved cursor
    const startCursor = await getCursor();
    if (startCursor) {
      console.log(`📌 Resuming from cursor: ${startCursor.substring(0, 20)}...`);
    }
    
    // Run crawl
    const result = await crawl({
      startCursor,
      maxImages: SCHEDULE.imagesPerRun
    });
    
    // Save new cursor
    if (result.nextCursor) {
      await saveCursor(result.nextCursor);
    }
    
    // Log stats
    const stats = await getStats();
    console.log(`\n📊 Database now contains: ${stats.overview.total_images} images`);
    console.log(`   Unique models: ${stats.overview.unique_models}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Crawl cycle failed:', error);
    throw error;
  }
}

/**
 * Simple health check server
 */
function startHealthCheck() {
  const http = require('http');
  
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      try {
        const stats = await getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          service: 'civitai-crawler',
          stats: stats.overview,
          lastCheck: new Date().toISOString()
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: error.message }));
      }
    } else if (req.url === '/stats') {
      try {
        const stats = await getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    } else if (req.url === '/trigger' && req.method === 'POST') {
      // Manual trigger endpoint
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Crawl triggered' }));
      runCrawlCycle().catch(console.error);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  server.listen(SCHEDULE.healthCheckPort, () => {
    console.log(`🏥 Health check server on port ${SCHEDULE.healthCheckPort}`);
  });
  
  return server;
}

/**
 * Main scheduler loop
 */
async function main() {
  console.log('🚀 VeriSource Civitai Crawler Scheduler');
  console.log(`   Images per run: ${SCHEDULE.imagesPerRun}`);
  console.log(`   Interval: ${SCHEDULE.intervalMinutes} minutes`);
  
  // Initialize
  await initDatabase();
  await initMetadata();
  
  // Run migration for hash column sizes
  await pool.query(`
  ALTER TABLE ai_image_hashes 
  ALTER COLUMN phash TYPE TEXT,
  ALTER COLUMN dhash TYPE TEXT,
  ALTER COLUMN average_hash TYPE TEXT;
`).then(() => console.log('✓ Hash columns migrated to TEXT'))
  .catch(err => console.error('Migration error:', err.message));
  
  // Start health check server
  startHealthCheck();
  
  // Run initial crawl
  await runCrawlCycle();
  
  // Schedule recurring crawls
  const intervalMs = SCHEDULE.intervalMinutes * 60 * 1000;
  
  setInterval(async () => {
    try {
      await runCrawlCycle();
    } catch (error) {
      console.error('Scheduled crawl failed:', error);
      // Don't exit, try again next interval
    }
  }, intervalMs);
  
  console.log(`\n⏰ Next crawl in ${SCHEDULE.intervalMinutes} minutes...`);
}

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down...');
  await pool.end();
  process.exit(0);
});

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});