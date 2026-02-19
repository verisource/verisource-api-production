/**
 * VeriSource News Crawler (v2)
 *
 * Improvements added:
 * - Canonical image model: news_images (canonical) + news_image_mentions (per-article mention)
 * - Stronger dedupe: sha256/md5 uniqueness (not just source+url)
 * - URL canonicalization (strip common cache-busters / resizing params)
 * - Quality gates (min bytes, min dimensions, reject trackers/thumbnails)
 * - SSRF hardening (DNS resolve + block private IP ranges)
 * - Enforce image Content-Type
 * - Concurrency pool + per-host throttle/backoff-friendly structure
 * - Hashes stored as bigint (for fast Hamming distance later) + hex strings for readability
 * - Real pHash (DCT-based) instead of aHash misnamed as pHash
 */

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const dns = require("dns").promises;
const { URL } = require("url");
const { Pool } = require("pg");
const { parseStringPromise } = require("xml2js");
const sharp = require("sharp");

// -------------------------
// Database connection
// -------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// -------------------------
// Crawl settings
// -------------------------
const REQUEST_DELAY_MS = 1500;
const IMAGE_TIMEOUT_MS = 15000;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

// Quality gates
const MIN_IMAGE_BYTES = 20 * 1024;
const MIN_DIMENSION = 300;

// Concurrency + per-host throttle
const MAX_CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY || "8", 10);
const PER_HOST_MIN_GAP_MS = parseInt(process.env.PER_HOST_MIN_GAP_MS || "700", 10);

// -------------------------
// NEWS SOURCES
// -------------------------
const NEWS_SOURCES = {
  // ===========================================
  // TIER 1: WIRE SERVICES (highest priority)
  // ===========================================
  wire_services: [
    {
      name: 'Reuters',
      slug: 'reuters',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'Associated Press',
      slug: 'ap',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:apnews.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'AFP',
      slug: 'afp',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:afp.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'UPI',
      slug: 'upi',
      feeds: ['https://rss.upi.com/news/news.rss']
    }
  ],

  // ===========================================
  // TIER 2: US NATIONAL - BROADCAST NETWORKS
  // ===========================================
  us_broadcast: [
    {
      name: 'CNN',
      slug: 'cnn',
      feeds: [
        'http://rss.cnn.com/rss/cnn_topstories.rss',
        'http://rss.cnn.com/rss/cnn_world.rss',
        'http://rss.cnn.com/rss/cnn_us.rss'
      ]
    },
    {
      name: 'Fox News',
      slug: 'foxnews',
      feeds: [
        'https://moxie.foxnews.com/google-publisher/us.xml',
        'https://moxie.foxnews.com/google-publisher/world.xml',
        'https://moxie.foxnews.com/google-publisher/politics.xml'
      ]
    },
    {
      name: 'MSNBC',
      slug: 'msnbc',
      feeds: ['https://www.msnbc.com/feeds/latest']
    },
    {
      name: 'ABC News',
      slug: 'abc',
      feeds: [
        'https://abcnews.go.com/abcnews/topstories',
        'https://abcnews.go.com/abcnews/usheadlines',
        'https://abcnews.go.com/abcnews/internationalheadlines'
      ]
    },
    {
      name: 'CBS News',
      slug: 'cbs',
      feeds: [
        'https://www.cbsnews.com/latest/rss/main',
        'https://www.cbsnews.com/latest/rss/us',
        'https://www.cbsnews.com/latest/rss/world'
      ]
    },
    {
      name: 'NBC News',
      slug: 'nbc',
      feeds: [
        'https://feeds.nbcnews.com/nbcnews/public/news',
        'https://feeds.nbcnews.com/nbcnews/public/world'
      ]
    },
    {
      name: 'PBS NewsHour',
      slug: 'pbs',
      feeds: ['https://www.pbs.org/newshour/feeds/rss/headlines']
    },
    {
      name: 'NPR',
      slug: 'npr',
      feeds: [
        'https://feeds.npr.org/1001/rss.xml',
        'https://feeds.npr.org/1004/rss.xml',
        'https://feeds.npr.org/1003/rss.xml'
      ]
    }
  ],

  // ===========================================
  // TIER 3: US NATIONAL - MAJOR NEWSPAPERS
  // ===========================================
  us_newspapers: [
    {
      name: 'New York Times',
      slug: 'nytimes',
      feeds: [
        'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml'
      ]
    },
    {
      name: 'Washington Post',
      slug: 'washpost',
      feeds: [
        'https://feeds.washingtonpost.com/rss/world',
        'https://feeds.washingtonpost.com/rss/national',
        'https://feeds.washingtonpost.com/rss/politics'
      ]
    },
    {
      name: 'USA Today',
      slug: 'usatoday',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:usatoday.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'Wall Street Journal',
      slug: 'wsj',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:wsj.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'New York Post',
      slug: 'nypost',
      feeds: ['https://nypost.com/feed/']
    },
    {
      name: 'Politico',
      slug: 'politico',
      feeds: [
        'https://www.politico.com/rss/politicopicks.xml',
        'https://www.politico.com/rss/congress.xml'
      ]
    },
    {
      name: 'The Hill',
      slug: 'thehill',
      feeds: ['https://thehill.com/feed/']
    },
    {
      name: 'Axios',
      slug: 'axios',
      feeds: ['https://api.axios.com/feed/']
    }
  ],

  // ===========================================
  // TIER 4: US CONSERVATIVE MEDIA
  // ===========================================
  us_conservative: [
    {
      name: 'Newsmax',
      slug: 'newsmax',
      feeds: [
        'https://www.newsmax.com/rss/Politics/1',
        'https://www.newsmax.com/rss/US/18',
        'https://www.newsmax.com/rss/GlobalTalk/162'
      ]
    },
    {
      name: 'Breitbart',
      slug: 'breitbart',
      feeds: ['https://feeds.feedburner.com/breitbart']
    },
    {
      name: 'Washington Examiner',
      slug: 'washexaminer',
      feeds: ['https://www.washingtonexaminer.com/feed']
    },
    {
      name: 'Daily Wire',
      slug: 'dailywire',
      feeds: ['https://www.dailywire.com/feeds/rss.xml']
    },
    {
      name: 'Washington Times',
      slug: 'washtimes',
      feeds: ['https://www.washingtontimes.com/rss/headlines/news/']
    },
    {
      name: 'National Review',
      slug: 'nationalreview',
      feeds: ['https://www.nationalreview.com/feed/']
    },
    {
      name: 'The Federalist',
      slug: 'federalist',
      feeds: ['https://thefederalist.com/feed/']
    },
    {
      name: 'Townhall',
      slug: 'townhall',
      feeds: ['https://townhall.com/feed/']
    },
    {
      name: 'RedState',
      slug: 'redstate',
      feeds: ['https://redstate.com/feed/']
    },
    {
      name: 'The Blaze',
      slug: 'theblaze',
      feeds: ['https://www.theblaze.com/feeds/feed.rss']
    }
  ],

  // ===========================================
  // TIER 5: US PROGRESSIVE/LEFT MEDIA
  // ===========================================
  us_progressive: [
    {
      name: 'HuffPost',
      slug: 'huffpost',
      feeds: ['https://www.huffpost.com/section/front-page/feed']
    },
    {
      name: 'Vox',
      slug: 'vox',
      feeds: ['https://www.vox.com/rss/index.xml']
    },
    {
      name: 'Slate',
      slug: 'slate',
      feeds: ['https://slate.com/feeds/all.rss']
    },
    {
      name: 'Salon',
      slug: 'salon',
      feeds: ['https://www.salon.com/feed/']
    },
    {
      name: 'The Atlantic',
      slug: 'atlantic',
      feeds: ['https://www.theatlantic.com/feed/all/']
    },
    {
      name: 'Mother Jones',
      slug: 'motherjones',
      feeds: ['https://www.motherjones.com/feed/']
    },
    {
      name: 'The Nation',
      slug: 'thenation',
      feeds: ['https://www.thenation.com/feed/']
    },
    {
      name: 'The Daily Beast',
      slug: 'dailybeast',
      feeds: ['https://feeds.thedailybeast.com/rss/articles']
    }
  ],

  // ===========================================
  // TIER 6: US REGIONAL NEWSPAPERS
  // ===========================================
  us_regional: [
    {
      name: 'LA Times',
      slug: 'latimes',
      feeds: [
        'https://www.latimes.com/world-nation/rss2.0.xml',
        'https://www.latimes.com/california/rss2.0.xml'
      ]
    },
    {
      name: 'Chicago Tribune',
      slug: 'chicagotribune',
      feeds: ['https://www.chicagotribune.com/feed/']
    },
    {
      name: 'Boston Globe',
      slug: 'bostonglobe',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:bostonglobe.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'Dallas Morning News',
      slug: 'dallasnews',
      feeds: ['https://www.dallasnews.com/feed/']
    },
    {
      name: 'Seattle Times',
      slug: 'seattletimes',
      feeds: ['https://www.seattletimes.com/feed/']
    },
    {
      name: 'Denver Post',
      slug: 'denverpost',
      feeds: ['https://www.denverpost.com/feed/']
    },
    {
      name: 'Atlanta Journal-Constitution',
      slug: 'ajc',
      feeds: ['https://www.ajc.com/feed/']
    },
    {
      name: 'San Francisco Chronicle',
      slug: 'sfchronicle',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:sfchronicle.com&ceid=US:en&hl=en-US&gl=US']
    }
  ],

  // ===========================================
  // TIER 7: UK/BRITISH MEDIA
  // ===========================================
  uk_media: [
    {
      name: 'BBC News',
      slug: 'bbc',
      feeds: [
        'https://feeds.bbci.co.uk/news/world/rss.xml',
        'https://feeds.bbci.co.uk/news/uk/rss.xml',
        'https://feeds.bbci.co.uk/news/business/rss.xml',
        'https://feeds.bbci.co.uk/news/technology/rss.xml'
      ]
    },
    {
      name: 'The Guardian',
      slug: 'guardian',
      feeds: [
        'https://www.theguardian.com/world/rss',
        'https://www.theguardian.com/us-news/rss',
        'https://www.theguardian.com/uk-news/rss'
      ]
    },
    {
      name: 'Daily Mail',
      slug: 'dailymail',
      feeds: ['https://www.dailymail.co.uk/articles.rss']
    },
    {
      name: 'The Independent',
      slug: 'independent',
      feeds: [
        'https://www.independent.co.uk/news/world/rss',
        'https://www.independent.co.uk/news/uk/rss'
      ]
    },
    {
      name: 'Sky News',
      slug: 'sky',
      feeds: [
        'https://feeds.skynews.com/feeds/rss/world.xml',
        'https://feeds.skynews.com/feeds/rss/uk.xml'
      ]
    },
    {
      name: 'The Telegraph',
      slug: 'telegraph',
      feeds: ['https://www.telegraph.co.uk/rss.xml']
    },
    {
      name: 'The Mirror',
      slug: 'mirror',
      feeds: ['https://www.mirror.co.uk/news/?service=rss']
    },
    {
      name: 'The Sun',
      slug: 'thesun',
      feeds: ['https://www.thesun.co.uk/feed/']
    },
    {
      name: 'Financial Times',
      slug: 'ft',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:ft.com&ceid=US:en&hl=en-US&gl=US']
    }
  ],

  // ===========================================
  // TIER 8: EUROPEAN MEDIA
  // ===========================================
  europe_media: [
    {
      name: 'France 24',
      slug: 'france24',
      feeds: ['https://www.france24.com/en/rss']
    },
    {
      name: 'DW News',
      slug: 'dw',
      feeds: ['https://rss.dw.com/xml/rss-en-all']
    },
    {
      name: 'Euronews',
      slug: 'euronews',
      feeds: ['https://www.euronews.com/rss']
    },
    {
      name: 'Der Spiegel (English)',
      slug: 'spiegel',
      feeds: ['https://www.spiegel.de/international/index.rss']
    },
    {
      name: 'Irish Times',
      slug: 'irishtimes',
      feeds: ['https://www.irishtimes.com/feed/']
    },
    {
      name: 'RTE News',
      slug: 'rte',
      feeds: ['https://www.rte.ie/feeds/rss/?index=/news/']
    }
  ],

  // ===========================================
  // TIER 9: MIDDLE EAST & INTERNATIONAL
  // ===========================================
  international: [
    {
      name: 'Al Jazeera',
      slug: 'aljazeera',
      feeds: ['https://www.aljazeera.com/xml/rss/all.xml']
    },
    {
      name: 'Times of Israel',
      slug: 'timesofisrael',
      feeds: ['https://www.timesofisrael.com/feed/']
    },
    {
      name: 'Jerusalem Post',
      slug: 'jpost',
      feeds: ['https://www.jpost.com/rss/rssfeedsfrontpage.aspx']
    },
    {
      name: 'Arab News',
      slug: 'arabnews',
      feeds: ['https://www.arabnews.com/rss.xml']
    },
    {
      name: 'South China Morning Post',
      slug: 'scmp',
      feeds: ['https://www.scmp.com/rss/91/feed']
    },
    {
      name: 'Japan Times',
      slug: 'japantimes',
      feeds: ['https://www.japantimes.co.jp/feed/']
    },
    {
      name: 'Times of India',
      slug: 'timesofindia',
      feeds: ['https://timesofindia.indiatimes.com/rssfeedstopstories.cms']
    },
    {
      name: 'Sydney Morning Herald',
      slug: 'smh',
      feeds: ['https://www.smh.com.au/rss/feed.xml']
    }
  ],

  // ===========================================
  // TIER 10: ASIA-PACIFIC
  // ===========================================
  asia_pacific: [
    {
      name: 'ABC Australia',
      slug: 'abc_au',
      feeds: [
        'https://www.abc.net.au/news/feed/1948/rss.xml',
        'https://www.abc.net.au/news/feed/51120/rss.xml'
      ]
    },
    {
      name: 'CBC News (Canada)',
      slug: 'cbc',
      feeds: [
        'https://www.cbc.ca/cmlink/rss-topstories',
        'https://www.cbc.ca/cmlink/rss-world'
      ]
    },
    {
      name: 'NHK World',
      slug: 'nhk',
      feeds: ['https://www3.nhk.or.jp/rss/news/cat0.xml']
    },
    {
      name: 'Channel NewsAsia',
      slug: 'cna',
      feeds: ['https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml']
    },
    {
      name: 'Korea Herald',
      slug: 'koreaherald',
      feeds: ['http://www.koreaherald.com/common/rss.php']
    }
  ],

  // ===========================================
  // TIER 11: BUSINESS/FINANCIAL
  // ===========================================
  business: [
    {
      name: 'Bloomberg',
      slug: 'bloomberg',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:bloomberg.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'CNBC',
      slug: 'cnbc',
      feeds: [
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        'https://www.cnbc.com/id/100727362/device/rss/rss.html'
      ]
    },
    {
      name: 'Fortune',
      slug: 'fortune',
      feeds: ['https://fortune.com/feed/']
    },
    {
      name: 'Forbes',
      slug: 'forbes',
      feeds: ['https://www.forbes.com/real-time/feed/']
    },
    {
      name: 'Business Insider',
      slug: 'businessinsider',
      feeds: ['https://www.businessinsider.com/rss']
    },
    {
      name: 'MarketWatch',
      slug: 'marketwatch',
      feeds: ['https://www.marketwatch.com/rss/topstories']
    },
    {
      name: 'The Economist',
      slug: 'economist',
      feeds: ['https://www.economist.com/rss']
    }
  ],

  // ===========================================
  // TIER 12: TECHNOLOGY
  // ===========================================
  technology: [
    {
      name: 'TechCrunch',
      slug: 'techcrunch',
      feeds: ['https://techcrunch.com/feed/']
    },
    {
      name: 'The Verge',
      slug: 'verge',
      feeds: ['https://www.theverge.com/rss/index.xml']
    },
    {
      name: 'Ars Technica',
      slug: 'arstechnica',
      feeds: ['https://feeds.arstechnica.com/arstechnica/index']
    },
    {
      name: 'Wired',
      slug: 'wired',
      feeds: ['https://www.wired.com/feed/rss']
    },
    {
      name: 'Engadget',
      slug: 'engadget',
      feeds: ['https://www.engadget.com/rss.xml']
    },
    {
      name: 'CNET',
      slug: 'cnet',
      feeds: ['https://www.cnet.com/rss/news/']
    }
  ],

  // ===========================================
  // TIER 13: MAGAZINES/LONG-FORM
  // ===========================================
  magazines: [
    {
      name: 'Newsweek',
      slug: 'newsweek',
      feeds: ['https://www.newsweek.com/rss']
    },
    {
      name: 'Time',
      slug: 'time',
      feeds: ['https://time.com/feed/']
    },
    {
      name: 'The New Yorker',
      slug: 'newyorker',
      feeds: ['https://www.newyorker.com/feed/everything']
    },
    {
      name: 'Vanity Fair',
      slug: 'vanityfair',
      feeds: ['https://www.vanityfair.com/feed/rss']
    },
    {
      name: 'Rolling Stone',
      slug: 'rollingstone',
      feeds: ['https://www.rollingstone.com/feed/']
    }
  ]
};

// -----------------------------------------------------------
// DB INIT (canonical + mentions + crawl state)
// -----------------------------------------------------------
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Rename old table if it exists (migration)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'news_images') 
           AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'news_images_v1') THEN
          ALTER TABLE news_images RENAME TO news_images_v1;
          RAISE NOTICE 'Renamed news_images to news_images_v1';
        END IF;
      END $$;
    `);

    // Create new canonical images table
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_images (
        id BIGSERIAL PRIMARY KEY,
        sha256 VARCHAR(64) UNIQUE NOT NULL,
        md5 VARCHAR(32),
        ahash_hex TEXT,
        dhash_hex TEXT,
        phash_hex TEXT,
        ahash_bigint BIGINT,
        dhash_bigint BIGINT,
        phash_bigint BIGINT,
        width INTEGER,
        height INTEGER,
        content_type VARCHAR(100),
        content_length INTEGER,
        first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      )
    `);

    // Create mentions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_image_mentions (
        id BIGSERIAL PRIMARY KEY,
        image_id BIGINT NOT NULL REFERENCES news_images(id) ON DELETE CASCADE,
        source VARCHAR(50) NOT NULL,
        source_name VARCHAR(100) NOT NULL,
        feed_url TEXT,
        feed_item_id TEXT,
        article_url TEXT NOT NULL,
        article_title TEXT,
        published_at TIMESTAMP,
        image_url_raw TEXT NOT NULL,
        image_url_canonical TEXT NOT NULL,
        crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB,
        UNIQUE(source, image_url_canonical, article_url)
      )
    `);

    // Indexes for news_images
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_v2_md5 ON news_images(md5)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_v2_sha256 ON news_images(sha256)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_v2_ahash_bigint ON news_images(ahash_bigint)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_v2_dhash_bigint ON news_images(dhash_bigint)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_v2_phash_bigint ON news_images(phash_bigint)`);

    // Indexes for mentions
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_source ON news_image_mentions(source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_published ON news_image_mentions(published_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_image_id ON news_image_mentions(image_id)`);

    // Crawl state table (updated schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_crawl_state_v2 (
        source VARCHAR(50) PRIMARY KEY,
        last_crawl TIMESTAMP,
        articles_processed INTEGER DEFAULT 0,
        images_saved INTEGER DEFAULT 0,
        images_rejected INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0
      )
    `);

    // Hamming distance function for later use
    await client.query(`
      CREATE OR REPLACE FUNCTION hamming_distance(a BIGINT, b BIGINT) 
      RETURNS INTEGER AS $$
        SELECT bit_count((a # b)::bit(64))::integer
      $$ LANGUAGE SQL IMMUTABLE;
    `);

    console.log("✓ Database tables initialized (v2)");
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------
// SSRF / network safety
// -----------------------------------------------------------
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((x) => parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;

  const [a, b] = parts;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  return false;
}

function isPrivateIPv6(ip) {
  const norm = ip.toLowerCase();
  if (norm === "::1") return true;
  if (norm.startsWith("fe80:")) return true;
  if (norm.startsWith("fc") || norm.startsWith("fd")) return true;
  return false;
}

async function assertSafeUrl(targetUrl) {
  const u = new URL(targetUrl);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`Blocked protocol: ${u.protocol}`);
  }
  if (!u.hostname) throw new Error("Invalid hostname");

  const results = await dns.lookup(u.hostname, { all: true });
  for (const r of results) {
    if (r.family === 4 && isPrivateIPv4(r.address)) {
      throw new Error(`Blocked private IPv4: ${r.address}`);
    }
    if (r.family === 6 && isPrivateIPv6(r.address)) {
      throw new Error(`Blocked private IPv6: ${r.address}`);
    }
  }
}

// -----------------------------------------------------------
// Per-host throttling
// -----------------------------------------------------------
const hostLastRequestAt = new Map();

async function throttleHost(url) {
  const u = new URL(url);
  const host = u.host;
  const now = Date.now();
  const last = hostLastRequestAt.get(host) || 0;
  const wait = Math.max(0, PER_HOST_MIN_GAP_MS - (now - last));
  if (wait > 0) await delay(wait);
  hostLastRequestAt.set(host, Date.now());
}

// -----------------------------------------------------------
// Fetch utility
// -----------------------------------------------------------
function fetchUrl(url, { timeoutMs = 30000, maxBytes = MAX_DOWNLOAD_BYTES, accept = "*/*" } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      await assertSafeUrl(url);
      await throttleHost(url);
    } catch (e) {
      reject(e);
      return;
    }

    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(
      url,
      {
        headers: {
          "User-Agent": "VeriSource News Crawler/2.0 (Media verification service)",
          Accept: accept,
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).toString();
          fetchUrl(nextUrl, { timeoutMs, maxBytes, accept }).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        let total = 0;

        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy();
            reject(new Error(`Max download exceeded: ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            headers: res.headers,
            finalUrl: url,
            statusCode: res.statusCode,
          });
        });

        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

// -----------------------------------------------------------
// URL canonicalization
// -----------------------------------------------------------
function canonicalizeImageUrl(imageUrl) {
  try {
    const u = new URL(imageUrl);

    const stripPrefixes = ["utm_", "fbclid", "gclid", "mc_cid", "mc_eid"];
    for (const key of [...u.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (stripPrefixes.some((p) => lower.startsWith(p)) || stripPrefixes.includes(lower)) {
        u.searchParams.delete(key);
      }
    }

    const resizeParams = ["w", "h", "width", "height", "quality", "q", "resize", "fit", "crop", "auto", "dpr"];
    for (const p of resizeParams) {
      if (u.searchParams.has(p)) u.searchParams.delete(p);
    }

    u.hash = "";
    return u.toString();
  } catch {
    return imageUrl;
  }
}

// -----------------------------------------------------------
// RSS parsing
// -----------------------------------------------------------
async function parseFeed(feedUrl) {
  try {
    const { buffer } = await fetchUrl(feedUrl, {
      timeoutMs: 30000,
      accept: "application/rss+xml, application/xml, text/xml, */*",
      maxBytes: 5 * 1024 * 1024,
    });

    const xml = buffer.toString();
    const result = await parseStringPromise(xml, { explicitArray: false });

    const channel = result.rss?.channel || result.feed;
    if (!channel) return [];

    const items = channel.item || channel.entry || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.map((item) => {
      const link =
        item.link?.href ||
        item.link?._text ||
        (Array.isArray(item.link) ? item.link.find((l) => l?.$?.rel === "alternate")?.$?.href : null) ||
        item.link ||
        "";

      return {
        title: item.title?._text || item.title || "",
        link,
        pubDate: item.pubDate || item.published || item.updated || null,
        description: item.description?._text || item.description || item.summary?._text || item.summary || "",
        guid: item.guid?._text || item.id?._text || item.guid || item.id || null,
        mediaContent: extractMediaUrls(item),
      };
    });
  } catch (error) {
    console.error(`   Feed error (${feedUrl}): ${error.message}`);
    return [];
  }
}

function extractMediaUrls(item) {
  const urls = [];

  if (item["media:content"]) {
    const media = Array.isArray(item["media:content"]) ? item["media:content"] : [item["media:content"]];
    media.forEach((m) => {
      if (m?.$?.url) urls.push(m.$.url);
      if (m?.url) urls.push(m.url);
    });
  }

  if (item["media:thumbnail"]) {
    const thumb = item["media:thumbnail"];
    if (thumb?.$?.url) urls.push(thumb.$.url);
    if (thumb?.url) urls.push(thumb.url);
  }

  if (item.enclosure) {
    const enc = item.enclosure;
    if (enc?.$?.url && enc?.$?.type?.startsWith("image")) urls.push(enc.$.url);
    if (enc?.url && enc?.type?.startsWith("image")) urls.push(enc.url);
  }

  const desc = item.description?._text || item.description || "";
  const imgMatches = desc.match(/<img[^>]+src="([^"]+)"/gi) || [];
  imgMatches.forEach((match) => {
    const srcMatch = match.match(/src="([^"]+)"/i);
    if (srcMatch) urls.push(srcMatch[1]);
  });

  const content = item["content:encoded"]?._text || item["content:encoded"] || "";
  const contentImgMatches = content.match(/<img[^>]+src="([^"]+)"/gi) || [];
  contentImgMatches.forEach((match) => {
    const srcMatch = match.match(/src="([^"]+)"/i);
    if (srcMatch) urls.push(srcMatch[1]);
  });

  const cleaned = urls
    .filter((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")))
    .map((u) => u.trim());

  return [...new Set(cleaned)];
}

// -----------------------------------------------------------
// Hashing utilities
// -----------------------------------------------------------
function bitsToHex(bits) {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function bitsToBigInt(bits) {
  return BigInt("0b" + bits);
}

// aHash (average hash) 8x8
function computeAHash8x8(gray8x8) {
  const pixels = Array.from(gray8x8);
  const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  let bits = "";
  for (const px of pixels) bits += px > avg ? "1" : "0";
  return { hex: bitsToHex(bits), bigint: bitsToBigInt(bits) };
}

// dHash (difference hash) from 9x8 -> 8x8
function computeDHash9x8(gray9x8) {
  const pixels = Array.from(gray9x8);
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return { hex: bitsToHex(bits), bigint: bitsToBigInt(bits) };
}

// Real pHash using DCT (Discrete Cosine Transform)
function dct2D(matrix, N) {
  const out = new Array(N * N).fill(0);
  const cosTable = Array.from({ length: N }, (_, u) =>
    Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)))
  );
  const alpha = (u) => (u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N));

  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          const px = matrix[y * N + x];
          sum += px * cosTable[u][x] * cosTable[v][y];
        }
      }
      out[v * N + u] = alpha(u) * alpha(v) * sum;
    }
  }
  return out;
}

function computePHash32(gray32x32) {
  const pixels = Array.from(gray32x32).map((v) => v - 128);
  const dct = dct2D(pixels, 32);

  // Take top-left 8x8 coefficients (excluding DC)
  const coeffs = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue; // skip DC
      coeffs.push(dct[y * 32 + x]);
    }
  }

  // Median threshold
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) {
        bits += "0";
        continue;
      }
      const c = dct[y * 32 + x];
      bits += c > median ? "1" : "0";
    }
  }

  return { hex: bitsToHex(bits), bigint: bitsToBigInt(bits) };
}

// -----------------------------------------------------------
// Image processing
// -----------------------------------------------------------
async function processImage(imageUrl) {
  try {
    const { buffer, headers, finalUrl } = await fetchUrl(imageUrl, {
      timeoutMs: IMAGE_TIMEOUT_MS,
      accept: "image/*,*/*;q=0.8",
      maxBytes: MAX_DOWNLOAD_BYTES,
    });

    const contentType = (headers["content-type"] || "").toString().toLowerCase();
    const contentLength = parseInt(headers["content-length"] || `${buffer.length}`, 10);

    // Must be an image
    if (!contentType.startsWith("image/")) {
      return { ok: false, reason: `non_image_content_type:${contentType || "unknown"}` };
    }

    // Quality gate: minimum bytes
    if (buffer.length < MIN_IMAGE_BYTES) {
      return { ok: false, reason: `too_small_bytes:${buffer.length}` };
    }

    // Decode and check dimensions
    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      return { ok: false, reason: "decode_failed" };
    }

    const width = meta.width || null;
    const height = meta.height || null;

    // Quality gate: minimum dimensions
    if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION) {
      return { ok: false, reason: `too_small_dims:${width}x${height}` };
    }

    // Compute hashes
    const md5 = crypto.createHash("md5").update(buffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    const ahashBuf = await sharp(buffer).resize(8, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    const ahash = computeAHash8x8(ahashBuf);

    const dhashBuf = await sharp(buffer).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    const dhash = computeDHash9x8(dhashBuf);

    const phashBuf = await sharp(buffer).resize(32, 32, { fit: "fill" }).grayscale().raw().toBuffer();
    const phash = computePHash32(phashBuf);

    return {
      ok: true,
      md5,
      sha256,
      ahash_hex: ahash.hex,
      dhash_hex: dhash.hex,
      phash_hex: phash.hex,
      ahash_bigint: ahash.bigint,
      dhash_bigint: dhash.bigint,
      phash_bigint: phash.bigint,
      width,
      height,
      content_type: contentType,
      content_length: contentLength,
      final_url: finalUrl,
    };
  } catch (error) {
    return { ok: false, reason: `fetch_error:${error.message}` };
  }
}

// -----------------------------------------------------------
// DB operations
// -----------------------------------------------------------
async function upsertCanonicalImage(img) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `
      INSERT INTO news_images (
        sha256, md5,
        ahash_hex, dhash_hex, phash_hex,
        ahash_bigint, dhash_bigint, phash_bigint,
        width, height, content_type, content_length, metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (sha256) DO UPDATE SET
        md5 = COALESCE(EXCLUDED.md5, news_images.md5),
        ahash_hex = COALESCE(EXCLUDED.ahash_hex, news_images.ahash_hex),
        dhash_hex = COALESCE(EXCLUDED.dhash_hex, news_images.dhash_hex),
        phash_hex = COALESCE(EXCLUDED.phash_hex, news_images.phash_hex),
        ahash_bigint = COALESCE(EXCLUDED.ahash_bigint, news_images.ahash_bigint),
        dhash_bigint = COALESCE(EXCLUDED.dhash_bigint, news_images.dhash_bigint),
        phash_bigint = COALESCE(EXCLUDED.phash_bigint, news_images.phash_bigint),
        width = COALESCE(EXCLUDED.width, news_images.width),
        height = COALESCE(EXCLUDED.height, news_images.height),
        content_type = COALESCE(EXCLUDED.content_type, news_images.content_type),
        content_length = COALESCE(EXCLUDED.content_length, news_images.content_length)
      RETURNING id
      `,
      [
        img.sha256,
        img.md5,
        img.ahash_hex,
        img.dhash_hex,
        img.phash_hex,
        img.ahash_bigint.toString(),
        img.dhash_bigint.toString(),
        img.phash_bigint.toString(),
        img.width,
        img.height,
        img.content_type,
        img.content_length,
        JSON.stringify({ final_url: img.final_url }),
      ]
    );

    return res.rows[0].id;
  } finally {
    client.release();
  }
}

async function insertMention({ imageId, source, feedUrl, article, imageUrlRaw, imageUrlCanonical, extraMeta = {} }) {
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO news_image_mentions (
        image_id, source, source_name, feed_url, feed_item_id,
        article_url, article_title, published_at,
        image_url_raw, image_url_canonical,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (source, image_url_canonical, article_url) DO NOTHING
      `,
      [
        imageId,
        source.slug,
        source.name,
        feedUrl || null,
        article.guid || null,
        article.link,
        article.title,
        article.pubDate ? new Date(article.pubDate) : null,
        imageUrlRaw,
        imageUrlCanonical,
        JSON.stringify({
          description: (article.description || "").substring(0, 500),
          ...extraMeta,
        }),
      ]
    );
    return true;
  } finally {
    client.release();
  }
}

async function mentionExists(sourceSlug, imageUrlCanonical, articleUrl) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT 1 FROM news_image_mentions WHERE source=$1 AND image_url_canonical=$2 AND article_url=$3`,
      [sourceSlug, imageUrlCanonical, articleUrl]
    );
    return r.rows.length > 0;
  } finally {
    client.release();
  }
}

async function updateCrawlState(sourceSlug, { articlesProcessed, imagesSaved, imagesRejected, errors }) {
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO news_crawl_state_v2 (source, last_crawl, articles_processed, images_saved, images_rejected, errors)
      VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5)
      ON CONFLICT (source) DO UPDATE SET
        last_crawl = CURRENT_TIMESTAMP,
        articles_processed = news_crawl_state_v2.articles_processed + $2,
        images_saved = news_crawl_state_v2.images_saved + $3,
        images_rejected = news_crawl_state_v2.images_rejected + $4,
        errors = news_crawl_state_v2.errors + $5
      `,
      [sourceSlug, articlesProcessed, imagesSaved, imagesRejected, errors]
    );
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------
// Concurrency pool helper (renamed to avoid conflict with pg pool)
// -----------------------------------------------------------
function createTaskPool(concurrency) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;

    active++;
    job()
      .catch(() => {})
      .finally(() => {
        active--;
        runNext();
      });
  };

  return {
    add(taskFn) {
      return new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            const v = await taskFn();
            resolve(v);
          } catch (e) {
            reject(e);
          }
        });
        runNext();
      });
    },
    async drain() {
      while (active > 0 || queue.length > 0) {
        await delay(50);
      }
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------
// Crawl one source
// -----------------------------------------------------------
async function crawlSource(source, maxMentions = 50) {
  console.log(`\n📰 Crawling: ${source.name}`);

  let articlesProcessed = 0;
  let imagesSaved = 0;
  let imagesRejected = 0;
  let errors = 0;

  const taskPool = createTaskPool(MAX_CONCURRENCY);

  for (const feedUrl of source.feeds) {
    console.log(`   Feed: ${feedUrl.substring(0, 80)}...`);

    const articles = await parseFeed(feedUrl);
    console.log(`   Found ${articles.length} articles`);

    for (const article of articles) {
      if (imagesSaved >= maxMentions) break;
      articlesProcessed++;

      let candidates = [...(article.mediaContent || [])];
      candidates = [...new Set(candidates.filter(Boolean))];

      for (const imageUrlRaw of candidates.slice(0, 6)) {
        if (imagesSaved >= maxMentions) break;

        const imageUrlCanonical = canonicalizeImageUrl(imageUrlRaw);

        if (await mentionExists(source.slug, imageUrlCanonical, article.link)) {
          process.stdout.write("s");
          continue;
        }

        await taskPool.add(async () => {
          const img = await processImage(imageUrlRaw);

          if (!img.ok) {
            imagesRejected++;
            process.stdout.write("r");
            return;
          }

          try {
            const imageId = await upsertCanonicalImage(img);
            await insertMention({
              imageId,
              source,
              feedUrl,
              article,
              imageUrlRaw,
              imageUrlCanonical,
              extraMeta: {
                width: img.width,
                height: img.height,
                content_type: img.content_type,
                content_length: img.content_length,
                final_url: img.final_url,
              },
            });

            imagesSaved++;
            process.stdout.write(".");
          } catch (e) {
            errors++;
            process.stdout.write("x");
          }
        });

        await delay(30);
      }
    }

    await delay(REQUEST_DELAY_MS);
  }

  await taskPool.drain();
  await updateCrawlState(source.slug, { articlesProcessed, imagesSaved, imagesRejected, errors });

  console.log(`\n   ✓ ${source.name}: ${articlesProcessed} articles, ${imagesSaved} mentions saved, ${imagesRejected} rejected, ${errors} errors`);

  return { articlesProcessed, imagesSaved, imagesRejected, errors };
}

// -----------------------------------------------------------
// Crawl tiers
// -----------------------------------------------------------
async function crawl(options = {}) {
  const {
    tiers = ["wire_services", "us_broadcast", "us_newspapers", "uk_media", "international"],
    maxMentionsPerSource = 50,
  } = options;

  console.log("🚀 Starting News Crawler v2...");
  console.log(`   Tiers: ${tiers.join(", ")}`);
  console.log(`   Max mentions per source: ${maxMentionsPerSource}`);
  console.log(`   Concurrency: ${MAX_CONCURRENCY}, Per-host gap: ${PER_HOST_MIN_GAP_MS}ms`);

  await initDatabase();

  let totalArticles = 0;
  let totalMentions = 0;
  let totalRejected = 0;
  let totalErrors = 0;

  for (const tier of tiers) {
    const sources = NEWS_SOURCES[tier];
    if (!sources) {
      console.log(`   ⚠️ Unknown tier: ${tier}`);
      continue;
    }

    console.log(`\n📁 Tier: ${tier} (${sources.length} sources)`);

    for (const source of sources) {
      try {
        const res = await crawlSource(source, maxMentionsPerSource);
        totalArticles += res.articlesProcessed;
        totalMentions += res.imagesSaved;
        totalRejected += res.imagesRejected;
        totalErrors += res.errors;
      } catch (e) {
        console.error(`   ❌ Error crawling ${source.name}: ${e.message}`);
        await updateCrawlState(source.slug, {
          articlesProcessed: 0,
          imagesSaved: 0,
          imagesRejected: 0,
          errors: 1,
        });
      }

      await delay(REQUEST_DELAY_MS);
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ Crawl complete (v2)!`);
  console.log(`   Total articles processed: ${totalArticles}`);
  console.log(`   Total mentions saved:     ${totalMentions}`);
  console.log(`   Total images rejected:    ${totalRejected}`);
  console.log(`   Total errors:             ${totalErrors}`);
  console.log(`==================================================`);

  return { totalArticles, totalMentions, totalRejected, totalErrors };
}

// -----------------------------------------------------------
// Stats
// -----------------------------------------------------------
async function getStats() {
  const client = await pool.connect();
  try {
    const img = await client.query(`
      SELECT
        COUNT(*)::int AS total_images,
        COUNT(md5)::int AS with_md5,
        COUNT(ahash_hex)::int AS with_ahash,
        COUNT(dhash_hex)::int AS with_dhash,
        COUNT(phash_hex)::int AS with_phash,
        MIN(first_seen_at) AS oldest_seen,
        MAX(first_seen_at) AS newest_seen
      FROM news_images
    `);

    const mentions = await client.query(`
      SELECT
        COUNT(*)::int AS total_mentions,
        COUNT(DISTINCT source)::int AS sources,
        MIN(published_at) AS oldest_published,
        MAX(published_at) AS newest_published
      FROM news_image_mentions
    `);

    const bySource = await client.query(`
      SELECT source, source_name, COUNT(*)::int AS count
      FROM news_image_mentions
      GROUP BY source, source_name
      ORDER BY count DESC
    `);

    // Also show v1 stats if table exists
    let v1Stats = null;
    try {
      const v1 = await client.query(`
        SELECT COUNT(*)::int AS total_images FROM news_images_v1
      `);
      v1Stats = v1.rows[0];
    } catch {
      // v1 table doesn't exist
    }

    return {
      images: img.rows[0],
      mentions: mentions.rows[0],
      bySource: bySource.rows,
      v1Stats,
    };
  } finally {
    client.release();
  }
}

module.exports = { crawl, getStats, initDatabase, NEWS_SOURCES, canonicalizeImageUrl };

if (require.main === module) {
  const tiers = process.env.CRAWL_TIERS?.split(",") || [
    "wire_services",
    "us_broadcast",
    "us_newspapers",
    "uk_media",
    "international",
  ];
  const maxMentions = parseInt(process.env.MAX_MENTIONS_PER_SOURCE || "50", 10);

  crawl({ tiers, maxMentionsPerSource: maxMentions })
    .then(async () => {
      const stats = await getStats();
      console.log("\n📊 Database stats:");
      console.log(`   Canonical images: ${stats.images.total_images}`);
      console.log(`   Total mentions: ${stats.mentions.total_mentions}`);
      console.log(`   Sources: ${stats.mentions.sources}`);
      if (stats.v1Stats) {
        console.log(`   Legacy v1 images: ${stats.v1Stats.total_images}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}