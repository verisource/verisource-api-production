/**
 * VeriSource News Crawler Scheduler
 */

const { crawl, getStats, initDatabase } = require('./news-crawler');
const http = require('http');

const CRAWL_INTERVAL = parseInt(process.env.CRAWL_INTERVAL) || 60;
const MAX_IMAGES_PER_SOURCE = parseInt(process.env.MAX_IMAGES_PER_SOURCE) || 50;
const CRAWL_TIERS = (process.env.CRAWL_TIERS || 'wire_services,international,us_major,other_major').split(',');
const PORT = process.env.PORT || 8080;

let isRunning = false;
let lastRun = null;
let lastStats = null;

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
    await crawl({
      tiers: CRAWL_TIERS,
      maxImagesPerSource: MAX_IMAGES_PER_SOURCE
    });
    
    lastRun = new Date();
    lastStats = await getStats();
    
    console.log(`\n📊 Database stats:`);
    console.log(`   Total images: ${lastStats.total}`);
    console.log(`   Sources: ${lastStats.sources}`);
    console.log(`   With pHash: ${lastStats.with_phash}`);
    
  } catch (error) {
    console.error('❌ Crawl error:', error.message);
  } finally {
    isRunning = false;
  }
}

function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const stats = lastStats || await getStats().catch(() => null);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        crawler: 'news',
        isRunning,
        lastRun: lastRun?.toISOString(),
        nextRun: lastRun 
          ? new Date(lastRun.getTime() + CRAWL_INTERVAL * 60000).toISOString()
          : 'starting soon',
        stats: stats ? {
          totalImages: stats.total,
          sources: stats.sources,
          withPHash: stats.with_phash,
          oldestArticle: stats.oldest,
          newestArticle: stats.newest,
          bySource: stats.bySource
        } : null,
        config: {
          intervalMinutes: CRAWL_INTERVAL,
          maxImagesPerSource: MAX_IMAGES_PER_SOURCE,
          tiers: CRAWL_TIERS
        }
      }, null, 2));
    } else if (req.url === '/trigger' && req.method === 'POST') {
      if (!isRunning) {
        runCrawlCycle();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Crawl triggered' }));
      } else {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Crawl already in progress' }));
      }
    } else if (req.url === '/stats') {
      const stats = await getStats().catch(() => null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  server.listen(PORT, () => {
    console.log(`🏥 Health check server on port ${PORT}`);
  });
}

async function main() {
  console.log('🚀 VeriSource News Crawler Scheduler');
  console.log(`   Tiers: ${CRAWL_TIERS.join(', ')}`);
  console.log(`   Max images per source: ${MAX_IMAGES_PER_SOURCE}`);
  console.log(`   Interval: ${CRAWL_INTERVAL} minutes`);
  
  await initDatabase();

  // Fix hash column sizes if needed
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query("ALTER TABLE news_images ALTER COLUMN phash TYPE TEXT, ALTER COLUMN dhash TYPE TEXT;").catch(() => {});
  await pool.end();
  startHealthServer();
  await runCrawlCycle();
  
  setInterval(runCrawlCycle, CRAWL_INTERVAL * 60 * 1000);
  console.log(`\n⏰ Next crawl in ${CRAWL_INTERVAL} minutes...`);
}

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});