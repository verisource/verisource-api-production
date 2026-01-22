/**
 * VeriSource News Crawler
 * 
 * Crawls major news outlets via RSS feeds for images, extracts metadata,
 * generates hashes, and stores for reverse search verification.
 * 
 * Purpose:
 * 1. Build database of authenticated news images
 * 2. Enable verification: "This matches a Reuters photo from March 2024"
 * 3. Support legal/insurance/journalism verification use cases
 * 
 * Note: This crawler verifies source matches only - it does not make
 * credibility judgments. Users decide what to make of the source.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
const { parseStringPromise } = require('xml2js');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const REQUEST_DELAY = 2000;
const IMAGE_TIMEOUT = 15000;

/**
 * Comprehensive News Sources - 100+ outlets across 13 categories
 */
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


async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_images (
        id SERIAL PRIMARY KEY,
        source VARCHAR(50) NOT NULL,
        source_name VARCHAR(100) NOT NULL,
        article_url TEXT NOT NULL,
        article_title TEXT,
        image_url TEXT NOT NULL,
        phash TEXT,
        dhash TEXT,
        md5 VARCHAR(32),
        published_at TIMESTAMP,
        crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB,
        UNIQUE(source, image_url)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_phash ON news_images(phash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_dhash ON news_images(dhash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_md5 ON news_images(md5)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_source ON news_images(source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_news_images_published ON news_images(published_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_crawl_state (
        source VARCHAR(50) PRIMARY KEY,
        last_crawl TIMESTAMP,
        articles_processed INTEGER DEFAULT 0,
        images_saved INTEGER DEFAULT 0
      )
    `);

    console.log('✓ Database tables initialized');
  } finally {
    client.release();
  }
}

function fetchUrl(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'VeriSource News Crawler/1.0 (Media verification service)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
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
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function parseFeed(feedUrl) {
  try {
    const data = await fetchUrl(feedUrl);
    const xml = data.toString();
    const result = await parseStringPromise(xml, { explicitArray: false });
    
    const channel = result.rss?.channel || result.feed;
    if (!channel) return [];
    
    const items = channel.item || channel.entry || [];
    const itemArray = Array.isArray(items) ? items : [items];
    
    return itemArray.map(item => ({
      title: item.title?._text || item.title || '',
      link: item.link?.href || item.link?._text || item.link || '',
      pubDate: item.pubDate || item.published || item.updated || null,
      description: item.description?._text || item.description || item.summary?._text || item.summary || '',
      mediaContent: extractMediaUrls(item)
    }));
  } catch (error) {
    console.error(`   Feed error (${feedUrl}): ${error.message}`);
    return [];
  }
}

function extractMediaUrls(item) {
  const urls = [];
  
  if (item['media:content']) {
    const media = Array.isArray(item['media:content']) ? item['media:content'] : [item['media:content']];
    media.forEach(m => {
      if (m.$ && m.$.url) urls.push(m.$.url);
      if (m.url) urls.push(m.url);
    });
  }
  
  if (item['media:thumbnail']) {
    const thumb = item['media:thumbnail'];
    if (thumb.$ && thumb.$.url) urls.push(thumb.$.url);
    if (thumb.url) urls.push(thumb.url);
  }
  
  if (item.enclosure) {
    const enc = item.enclosure;
    if (enc.$ && enc.$.url && enc.$.type?.startsWith('image')) urls.push(enc.$.url);
    if (enc.url && enc.type?.startsWith('image')) urls.push(enc.url);
  }
  
  const desc = item.description?._text || item.description || '';
  const imgMatches = desc.match(/<img[^>]+src="([^"]+)"/gi) || [];
  imgMatches.forEach(match => {
    const srcMatch = match.match(/src="([^"]+)"/i);
    if (srcMatch) urls.push(srcMatch[1]);
  });
  
  const content = item['content:encoded']?._text || item['content:encoded'] || '';
  const contentImgMatches = content.match(/<img[^>]+src="([^"]+)"/gi) || [];
  contentImgMatches.forEach(match => {
    const srcMatch = match.match(/src="([^"]+)"/i);
    if (srcMatch) urls.push(srcMatch[1]);
  });
  
  return [...new Set(urls.filter(url => 
    url && 
    (url.startsWith('http://') || url.startsWith('https://')) &&
    (/\.(jpg|jpeg|png|gif|webp)/i.test(url) || /image|img|photo|media|cdn/i.test(url))
  ))];
}

async function processImage(imageUrl) {
  try {
    const imageBuffer = await fetchUrl(imageUrl, IMAGE_TIMEOUT);
    const md5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
    
    let phash = null;
    let dhash = null;
    
    try {
      const sharp = require('sharp');
      const pHashBuffer = await sharp(imageBuffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
      phash = generatePHash(pHashBuffer);
    } catch (e) {}
    
    try {
      const sharp = require('sharp');
      const dHashBuffer = await sharp(imageBuffer)
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
      dhash = generateDHash(dHashBuffer);
    } catch (e) {}
    
    return { md5, phash, dhash };
  } catch (error) {
    return { md5: null, phash: null, dhash: null, error: error.message };
  }
}

function generatePHash(buffer) {
  const pixels = Array.from(buffer);
  const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  let hash = '';
  for (const pixel of pixels) {
    hash += pixel > avg ? '1' : '0';
  }
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) {
    hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
  }
  return hexHash;
}

function generateDHash(buffer) {
  const pixels = Array.from(buffer);
  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      hash += left > right ? '1' : '0';
    }
  }
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) {
    hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
  }
  return hexHash;
}

async function saveImage(source, article, imageUrl, hashes) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO news_images (
        source, source_name, article_url, article_title, image_url,
        phash, dhash, md5, published_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (source, image_url) DO UPDATE SET
        phash = COALESCE(EXCLUDED.phash, news_images.phash),
        dhash = COALESCE(EXCLUDED.dhash, news_images.dhash),
        md5 = COALESCE(EXCLUDED.md5, news_images.md5)
    `, [
      source.slug,
      source.name,
      article.link,
      article.title,
      imageUrl,
      hashes.phash,
      hashes.dhash,
      hashes.md5,
      article.pubDate ? new Date(article.pubDate) : null,
      JSON.stringify({ description: article.description?.substring(0, 500) })
    ]);
    return true;
  } catch (error) {
    if (!error.message.includes('duplicate')) {
      console.error(`   DB error: ${error.message}`);
    }
    return false;
  } finally {
    client.release();
  }
}

async function imageExists(source, imageUrl) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT 1 FROM news_images WHERE source = $1 AND image_url = $2',
      [source, imageUrl]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

async function updateCrawlState(source, articlesProcessed, imagesSaved) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO news_crawl_state (source, last_crawl, articles_processed, images_saved)
      VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
      ON CONFLICT (source) DO UPDATE SET
        last_crawl = CURRENT_TIMESTAMP,
        articles_processed = news_crawl_state.articles_processed + $2,
        images_saved = news_crawl_state.images_saved + $3
    `, [source, articlesProcessed, imagesSaved]);
  } finally {
    client.release();
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crawlSource(source, maxImages = 50) {
  console.log(`\n📰 Crawling: ${source.name}`);
  
  let articlesProcessed = 0;
  let imagesSaved = 0;
  
  for (const feedUrl of source.feeds) {
    console.log(`   Feed: ${feedUrl.substring(0, 60)}...`);
    
    const articles = await parseFeed(feedUrl);
    console.log(`   Found ${articles.length} articles`);
    
    for (const article of articles) {
      if (imagesSaved >= maxImages) break;
      articlesProcessed++;
      
      for (const imageUrl of article.mediaContent) {
        if (imagesSaved >= maxImages) break;
        
        if (await imageExists(source.slug, imageUrl)) {
          process.stdout.write('s');
          continue;
        }
        
        const hashes = await processImage(imageUrl);
        
        if (hashes.md5 || hashes.phash || hashes.dhash) {
          const saved = await saveImage(source, article, imageUrl, hashes);
          if (saved) {
            imagesSaved++;
            process.stdout.write('.');
          } else {
            process.stdout.write('x');
          }
        } else {
          process.stdout.write('e');
        }
        
        await delay(100);
      }
    }
    
    await delay(REQUEST_DELAY);
  }
  
  await updateCrawlState(source.slug, articlesProcessed, imagesSaved);
  console.log(`\n   ✓ ${source.name}: ${articlesProcessed} articles, ${imagesSaved} images saved`);
  
  return { articlesProcessed, imagesSaved };
}

async function crawl(options = {}) {
  const {
    tiers = ['wire_services', 'us_broadcast', 'us_newspapers', 'us_conservative', 'uk_media', 'international'],
    maxImagesPerSource = 50
  } = options;
  
  console.log('🚀 Starting News Crawler...');
  console.log(`   Tiers: ${tiers.join(', ')}`);
  console.log(`   Max images per source: ${maxImagesPerSource}`);
  
  await initDatabase();
  
  let totalArticles = 0;
  let totalImages = 0;
  
  for (const tier of tiers) {
    const sources = NEWS_SOURCES[tier];
    if (!sources) {
      console.log(`   ⚠️ Unknown tier: ${tier}`);
      continue;
    }
    
    console.log(`\n📁 Tier: ${tier} (${sources.length} sources)`);
    
    for (const source of sources) {
      try {
        const result = await crawlSource(source, maxImagesPerSource);
        totalArticles += result.articlesProcessed;
        totalImages += result.imagesSaved;
      } catch (error) {
        console.error(`   ❌ Error crawling ${source.name}: ${error.message}`);
      }
      
      await delay(REQUEST_DELAY);
    }
  }
  
  console.log(`\n==================================================`);
  console.log(`✅ Crawl complete!`);
  console.log(`   Total articles: ${totalArticles}`);
  console.log(`   Total images: ${totalImages}`);
  console.log(`==================================================`);
  
  return { totalArticles, totalImages };
}

async function getStats() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT source) as sources,
        COUNT(phash) as with_phash,
        MIN(published_at) as oldest,
        MAX(published_at) as newest
      FROM news_images
    `);
    
    const bySource = await client.query(`
      SELECT source, source_name, COUNT(*) as count
      FROM news_images
      GROUP BY source, source_name
      ORDER BY count DESC
    `);
    
    return { ...result.rows[0], bySource: bySource.rows };
  } finally {
    client.release();
  }
}

module.exports = { crawl, getStats, initDatabase, NEWS_SOURCES };

if (require.main === module) {
  const tiers = process.env.CRAWL_TIERS?.split(',') || ['wire_services', 'us_broadcast', 'us_newspapers', 'us_conservative', 'uk_media', 'international'];
  const maxImages = parseInt(process.env.MAX_IMAGES_PER_SOURCE) || 50;
  
  crawl({ tiers, maxImagesPerSource: maxImages })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}