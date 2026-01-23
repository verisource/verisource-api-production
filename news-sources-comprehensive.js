/**
 * VeriSource Comprehensive News Sources
 * 
 * 100+ major news outlets organized by category
 * Copy this into your news-crawler.js to replace the existing NEWS_SOURCES
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
      name: 'Fox News',
      slug: 'foxnews',
      feeds: [
        'https://moxie.foxnews.com/google-publisher/us.xml',
        'https://moxie.foxnews.com/google-publisher/world.xml'
      ]
    },
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
      name: 'Miami Herald',
      slug: 'miamiherald',
      feeds: ['https://www.miamiherald.com/news/local/?widgetName=rssfeed&widgetContentId=712015&get498tele498498=1']
    },
    {
      name: 'Dallas Morning News',
      slug: 'dallasnews',
      feeds: ['https://www.dallasnews.com/feed/']
    },
    {
      name: 'San Francisco Chronicle',
      slug: 'sfchronicle',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:sfchronicle.com&ceid=US:en&hl=en-US&gl=US']
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
      name: 'Houston Chronicle',
      slug: 'houstonchronicle',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:houstonchronicle.com&ceid=US:en&hl=en-US&gl=US']
    },
    {
      name: 'Atlanta Journal-Constitution',
      slug: 'ajc',
      feeds: ['https://www.ajc.com/feed/']
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
      name: 'The Local (EU)',
      slug: 'thelocal',
      feeds: ['https://www.thelocal.com/feeds/rss.php']
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
    },
    {
      name: 'Straits Times',
      slug: 'straitstimes',
      feeds: ['https://www.straitstimes.com/news/world/rss.xml']
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
      name: "Barron's",
      slug: 'barrons',
      feeds: ['https://news.google.com/rss/search?q=when:24h+allinurl:barrons.com&ceid=US:en&hl=en-US&gl=US']
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
    },
    {
      name: 'ZDNet',
      slug: 'zdnet',
      feeds: ['https://www.zdnet.com/news/rss.xml']
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

// Export for use
module.exports = NEWS_SOURCES;

// ===========================================
// SUMMARY
// ===========================================
// Total Sources: ~100+
// 
// Tiers to enable by default (recommended):
// - wire_services (4 sources)
// - us_broadcast (8 sources)
// - us_newspapers (8 sources)
// - us_conservative (10 sources)
// - us_progressive (8 sources)
// - uk_media (9 sources)
// - international (8 sources)
// - business (8 sources)
//
// Add more tiers as needed:
// - us_regional (10 sources)
// - europe_media (7 sources)
// - asia_pacific (6 sources)
// - technology (7 sources)
// - magazines (5 sources)