/**
 * VeriSource Lexica Crawler Scheduler
 * 
 * Runs the crawler on a schedule for continuous database building.
 * Cycles through search terms to maximize coverage.
 */

const { crawl, getStats, initDatabase } = require('./lexica-crawler');
const http = require('http');

// Configuration
const CRAWL_INTERVAL = parseInt(process.env.CRAWL_INTERVAL) || 60; // minutes
const MAX_IMAGES = parseInt(process.env.MAX_IMAGES) || 500;
const TERMS_PER_RUN = parseInt(process.env.TERMS_PER_RUN) || 10;
const SKIP_NSFW = process.env.SKIP_NSFW !== 'false';
const PORT = process.env.PORT || 8080;

let isRunning = false;
let lastRun = null;
let lastStats = null;

/**
 * Run a single crawl cycle
 */
async function runCrawlCycle() {
  if (isRunning) {
    console.log('⚠️ Crawl already in progress, skipping...');
    return;
  }
  
  isRunning = true;
  console.log(`\n==================================================`);
  console.log(`🕐 Crawl cycle started at ${new Date().toISOString()}`);
  console.log(`==================================================`);
  
  try {
    const result = await crawl({
      maxImages: MAX_IMAGES,
      termsPerRun: TERMS_PER_RUN,
      skipNsfw: SKIP_NSFW
    });
    
    lastRun = new Date();
    lastStats = await getStats();
    
    console.log(`\n📊 Database stats:`);
    console.log(`   Total images: ${lastStats.total}`);
    console.log(`   Lexica images: ${lastStats.lexica_count}`);
    console.log(`   With pHash: ${lastStats.with_phash}`);
    console.log(`   With dHash: ${lastStats.with_dhash}`);
    
  } catch (error) {
    console.error('❌ Crawl error:', error.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Health check server for Railway
 */
function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const stats = lastStats || await getStats().catch(() => null);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        crawler: 'lexica',
        isRunning,
        lastRun: lastRun?.toISOString(),
        nextRun: lastRun 
          ? new Date(lastRun.getTime() + CRAWL_INTERVAL * 60000).toISOString()
          : 'starting soon',
        stats: stats ? {
          totalImages: stats.total,
          lexicaImages: stats.lexica_count,
          withPHash: stats.with_phash,
          withDHash: stats.with_dhash
        } : null,
        config: {
          intervalMinutes: CRAWL_INTERVAL,
          maxImagesPerRun: MAX_IMAGES,
          termsPerRun: TERMS_PER_RUN,
          skipNsfw: SKIP_NSFW
        }
      }, null, 2));
    } else if (req.url === '/trigger' && req.method === 'POST') {
      // Manual trigger endpoint
      if (!isRunning) {
        runCrawlCycle();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Crawl triggered' }));
      } else {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Crawl already in progress' }));
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  server.listen(PORT, () => {
    console.log(`🏥 Health check server on port ${PORT}`);
  });
}

/**
 * Main scheduler
 */
async function main() {
  console.log('🚀 VeriSource Lexica Crawler Scheduler');
  console.log(`   Images per run: ${MAX_IMAGES}`);
  console.log(`   Terms per run: ${TERMS_PER_RUN}`);
  console.log(`   Interval: ${CRAWL_INTERVAL} minutes`);
  console.log(`   Skip NSFW: ${SKIP_NSFW}`);
  
  // Initialize database
  await initDatabase();
  
  // Start health server
  startHealthServer();
  
  // Run initial crawl
  await runCrawlCycle();
  
  // Schedule subsequent runs
  setInterval(runCrawlCycle, CRAWL_INTERVAL * 60 * 1000);
  
  console.log(`\n⏰ Next crawl in ${CRAWL_INTERVAL} minutes...`);
}

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});

// Start
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});