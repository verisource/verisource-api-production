/**
 * TinEye Reverse Image Search Service
 * Searches 50+ billion indexed images to find where an image appears online
 */

const axios = require('axios');
const { timeStamp } = require('console');
const crypto = require('crypto');
const FormData = require('form-data');

class TinEyeSearchService {
  constructor() {
    // TinEye API credentials
    this.apiUrl = process.env.TINEYE_API_URL || 'https://api.tineye.com/rest/';
   this.apiKey = process.env.TINEYE_API_KEY || process.env.TINEYE_PRIVATE_KEY;
    
  // Fallback to sandbox for testing
    this.sandboxMode = !this.apiKey;
    if (this.sandboxMode) {
      console.log('TinEye: Running in sandbox/mock mode');
    }
  }

  /**
   * Generate HMAC signature for TinEye API authentication
   */
  generateSignature(httpVerb, contentType, date, requestUri, imageData = null) {
    const stringToSign = [
      httpVerb,
      contentType,
      date,
      requestUri
    ].join('\n');
    
    const hmac = crypto.createHmac('sha256', this.privateKey);
    hmac.update(stringToSign);
    return hmac.digest('hex');
  }

  /**
   * Search TinEye using image buffer
   * @param {Buffer} imageBuffer - The image file buffer
   * @param {Object} options - Search options
   * @returns {Object} TinEye search results
   */
  async searchByImage(imageBuffer, options = {}) {
    const {
      limit = 100,
      offset = 0,
      sortBy = 'crawl_date', // 'crawl_date' or 'score'
      sortOrder = 'asc' // 'asc' (oldest first) or 'desc'
    } = options;

    if (this.sandboxMode) {
      return this.getMockResults(imageBuffer);
    }

    try {
      const form = new FormData();
      form.append('image_upload', imageBuffer, {
        filename: 'search_image.jpg',
        contentType: 'image/jpeg'
      });
      form.append('limit', limit.toString());
      form.append('offset', offset.toString());
      form.append('sort', sortBy);
      form.append('order', sortOrder);

      const date = new Date().toUTCString();
      const requestUri = '/search/';
      const url = this.apiUrl + 'search/';
      const response = await axios.post(url, form, {
  headers: {
    ...form.getHeaders(),
    'x-api-key': this.apiKey
  },
        timeout: 30000 // 30 second timeout
      });

      return this.parseResults(response.data);
    } catch (error) {
      console.error('TinEye search error:', error.message);
      return {
        status: 'error',
        error: error.message,
        total_results: 0,
        matches: []
      };
    }
  }

  /**
   * Search TinEye using image URL
   * @param {string} imageUrl - URL of the image to search
   * @param {Object} options - Search options
   * @returns {Object} TinEye search results
   */
  async searchByUrl(imageUrl, options = {}) {
    const {
      limit = 100,
      offset = 0,
      sortBy = 'crawl_date',
      sortOrder = 'asc'
    } = options;

    if (this.sandboxMode) {
      return this.getMockResults(null, imageUrl);
    }

    try {
      const params = new URLSearchParams({
        url: imageUrl,
        limit: limit.toString(),
        offset: offset.toString(),
        sort: sortBy,
        order: sortOrder
      });

      const date = new Date().toUTCString();
      const requestUri = `/search/?${params.toString()}`;
      const signature = this.generateSignature('GET', '', date, requestUri);

      const response = await axios.get(`${this.apiUrl}search/`, {
        params,
        headers: {
          'Date': date,
          'X-Api-Key': this.publicKey,
          'X-Api-Signature': signature
        },
        timeout: 30000
      });

      return this.parseResults(response.data);
    } catch (error) {
      console.error('TinEye URL search error:', error.message);
      return {
        status: 'error',
        error: error.message,
        total_results: 0,
        matches: []
      };
    }
  }

  /**
   * Parse TinEye API response into standardized format
   */
  parseResults(data) {
    if (!data || data.code !== 200) {
      return {
        status: 'error',
        error: data?.message || 'Unknown error',
        total_results: 0,
        matches: []
      };
    }

    const results = data.results || {};
    const matches = results.matches || [];

    // Sort matches by crawl_date to find oldest (first appearance)
    const sortedMatches = matches.sort((a, b) => {
      return new Date(a.crawl_date) - new Date(b.crawl_date);
    });

    const firstAppearance = sortedMatches.length > 0 ? sortedMatches[0] : null;
    const mostRecent = sortedMatches.length > 0 ? sortedMatches[sortedMatches.length - 1] : null;

    // Analyze domains
    const domainCounts = {};
    const domainTypes = {
      news_sites: 0,
      social_media: 0,
      stock_photo_sites: 0,
      blogs: 0,
      other: 0
    };

    const socialMediaDomains = [
      'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'linkedin.com',
      'pinterest.com', 'tumblr.com', 'snapchat.com', 'youtube.com', 'vimeo.com',
      'threads.net', 'mastodon.social', 'bsky.app', 'discord.com', 'telegram.org',
      'whatsapp.com', 'weibo.com', 'vk.com', 'flickr.com', 'imgur.com'
    ];
    const stockPhotoDomains = [
      'shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'stock.adobe.com', 'depositphotos.com',
      'dreamstime.com', 'alamy.com', '123rf.com', 'bigstockphoto.com', 'canstockphoto.com',
      'pond5.com', 'stocksy.com', 'eyeem.com', 'envato.com', 'elements.envato.com',
      'unsplash.com', 'pexels.com', 'pixabay.com', 'freepik.com', 'vectorstock.com',
      'fotosearch.com', 'superstock.com', 'agefotostock.com', 'masterfile.com'
    ];
    const newsDomains = [
      'reuters.com', 'bbc.com', 'cnn.com', 'apnews.com', 'nytimes.com', 'theguardian.com',
      'washingtonpost.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'foxnews.com',
      'usatoday.com', 'latimes.com', 'wsj.com', 'bloomberg.com', 'politico.com',
      'npr.org', 'pbs.org', 'time.com', 'newsweek.com', 'theatlantic.com',
      'forbes.com', 'businessinsider.com', 'huffpost.com', 'dailymail.co.uk', 'sky.com'
    ];

    matches.forEach(match => {
      const domain = match.domain || this.extractDomain(match.page_url);
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;

      if (socialMediaDomains.some(d => domain.includes(d))) {
        domainTypes.social_media++;
      } else if (stockPhotoDomains.some(d => domain.includes(d))) {
        domainTypes.stock_photo_sites++;
      } else if (newsDomains.some(d => domain.includes(d)) || domain.includes('news')) {
        domainTypes.news_sites++;
      } else if (domain.includes('blog') || domain.includes('wordpress') || domain.includes('medium.com')) {
        domainTypes.blogs++;
      } else {
        domainTypes.other++;
      }
    });

    // Detect modifications
    const modifications = this.detectModifications(matches);

    // Determine if it's a stock photo
    const isStockPhoto = domainTypes.stock_photo_sites > 0;

    // Calculate age
    let ageInfo = null;
    if (firstAppearance) {
      // Get crawl_date from backlinks if not directly available
      let crawlDate = firstAppearance.crawl_date;
      if (!crawlDate && firstAppearance.backlinks && firstAppearance.backlinks.length > 0) {
        crawlDate = firstAppearance.backlinks[0].crawl_date;
      }
      
      if (crawlDate) {
        const firstDate = new Date(crawlDate);
        const now = new Date();
        const ageDays = Math.floor((now - firstDate) / (1000 * 60 * 60 * 24));
        
        ageInfo = {
          days: ageDays,
          months: Math.floor(ageDays / 30),
          years: Math.floor(ageDays / 365),
          human_readable: this.formatAge(ageDays)
        };
      }
    }

    return {
      status: 'found',
      total_results: results.total_results || matches.length,
      total_backlinks: results.total_backlinks || 0,
      
      first_appearance: firstAppearance ? {
        date: firstAppearance.crawl_date,
        age: ageInfo,
        source_url: firstAppearance.page_url,
        source_domain: firstAppearance.domain || this.extractDomain(firstAppearance.page_url),
        image_url: firstAppearance.image_url,
        backlinks: firstAppearance.backlinks || 0
      } : null,

      most_recent_appearance: mostRecent ? {
        date: mostRecent.crawl_date,
        source_url: mostRecent.page_url,
        source_domain: mostRecent.domain || this.extractDomain(mostRecent.page_url)
      } : null,

      top_matches: sortedMatches.slice(0, 10).map(match => {
        const firstBacklink = Array.isArray(match.backlinks) && match.backlinks[0];
        return {
          url: match.page_url || (firstBacklink && firstBacklink.backlink) || null,
          domain: match.domain || this.extractDomain(match.page_url || (firstBacklink && firstBacklink.backlink)),
          crawl_date: match.crawl_date || (firstBacklink && firstBacklink.crawl_date) || null,
          image_url: match.image_url,
          match_percentage: match.score ? Math.round(match.score) : 100,
          backlinks: Array.isArray(match.backlinks) ? match.backlinks.length : 0,
          width: match.width,
          height: match.height
        };
      }),

      domain_breakdown: domainTypes,
      top_domains: Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count]) => ({ domain, count })),

      modifications_detected: modifications,
      is_stock_photo: isStockPhoto,
      
      raw_match_count: matches.length
    };
  }

  /**
   * Detect image modifications across matches
   */
  detectModifications(matches) {
    const modifications = [];
    
    if (matches.length === 0) return modifications;

    // Get first (likely original) dimensions
    const firstMatch = matches[0];
    const originalWidth = firstMatch.width;
    const originalHeight = firstMatch.height;

    matches.forEach(match => {
      // Check for crops (different dimensions)
      if (match.width && match.height) {
        if (match.width !== originalWidth || match.height !== originalHeight) {
          const existingCrop = modifications.find(m => m.type === 'crop');
          if (!existingCrop) {
            modifications.push({
              type: 'crop',
              description: 'Cropped or resized version detected',
              example_url: match.page_url,
              original_dimensions: `${originalWidth}x${originalHeight}`,
              modified_dimensions: `${match.width}x${match.height}`,
              crawl_date: match.crawl_date
            });
          }
        }
      }

      // Check for watermark indicators in URL/domain
      if (match.page_url && (
        match.page_url.includes('no-watermark') ||
        match.page_url.includes('unwatermarked') ||
        match.page_url.includes('watermark-removed')
      )) {
        modifications.push({
          type: 'watermark_removed',
          description: 'Watermark may have been removed',
          example_url: match.page_url,
          crawl_date: match.crawl_date
        });
      }
    });

    return modifications;
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Format age in human-readable format
   */
  formatAge(days) {
    if (days < 1) return 'Less than a day old';
    if (days === 1) return '1 day old';
    if (days < 30) return `${days} days old`;
    if (days < 60) return '1 month old';
    if (days < 365) return `${Math.floor(days / 30)} months old`;
    if (days < 730) return '1 year old';
    
    const years = Math.floor(days / 365);
    const remainingMonths = Math.floor((days % 365) / 30);
    
    if (remainingMonths === 0) {
      return `${years} years old`;
    }
    return `${years} years, ${remainingMonths} months old`;
  }

  /**
   * Mock results for testing/sandbox mode
   */
  getMockResults(imageBuffer = null, imageUrl = null) {
    // Generate consistent mock data based on image hash
    let hash = '000000';
    if (imageBuffer) {
      hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 6);
    } else if (imageUrl) {
      hash = crypto.createHash('md5').update(imageUrl).digest('hex').substring(0, 6);
    }

    // Use hash to determine mock scenario
    const scenario = parseInt(hash.substring(0, 2), 16) % 4;

    switch (scenario) {
      case 0: // No results found (original image)
        return {
          status: 'not_found',
          total_results: 0,
          matches: [],
          first_appearance: null,
          most_recent_appearance: null,
          top_matches: [],
          domain_breakdown: {
            news_sites: 0,
            social_media: 0,
            stock_photo_sites: 0,
            blogs: 0,
            other: 0
          },
          modifications_detected: [],
          is_stock_photo: false,
          message: 'No matches found in 50+ billion indexed images'
        };

      case 1: // Stock photo
        return {
          status: 'found',
          total_results: 89,
          first_appearance: {
            date: '2019-06-20T00:00:00Z',
            age: {
              days: 1975,
              months: 65,
              years: 5,
              human_readable: '5 years, 5 months old'
            },
            source_url: 'https://www.shutterstock.com/image-photo/happy-business-team-1234567890',
            source_domain: 'shutterstock.com',
            image_url: 'https://image.shutterstock.com/1234567890.jpg',
            backlinks: 89
          },
          most_recent_appearance: {
            date: '2024-11-10T00:00:00Z',
            source_url: 'https://fake-company.com/about-us',
            source_domain: 'fake-company.com'
          },
          top_matches: [
            {
              url: 'https://www.shutterstock.com/image-photo/happy-business-team-1234567890',
              domain: 'shutterstock.com',
              crawl_date: '2019-06-20T00:00:00Z',
              match_percentage: 100,
              backlinks: 89
            },
            {
              url: 'https://www.gettyimages.com/detail/987654321',
              domain: 'gettyimages.com',
              crawl_date: '2019-06-25T00:00:00Z',
              match_percentage: 100,
              backlinks: 56
            }
          ],
          domain_breakdown: {
            news_sites: 0,
            social_media: 12,
            stock_photo_sites: 35,
            blogs: 15,
            other: 27
          },
          modifications_detected: [],
          is_stock_photo: true
        };

      case 2: // Old news photo being recycled
        return {
          status: 'found',
          total_results: 1247,
          first_appearance: {
            date: '2020-03-15T08:23:00Z',
            age: {
              days: 1706,
              months: 56,
              years: 4,
              human_readable: '4 years, 8 months old'
            },
            source_url: 'https://www.reuters.com/world/syria-bombing-aftermath-2020',
            source_domain: 'reuters.com',
            image_url: 'https://cloudfront-us-east-2.images.arcpublishing.com/reuters/syria.jpg',
            backlinks: 234
          },
          most_recent_appearance: {
            date: '2024-11-14T12:00:00Z',
            source_url: 'https://twitter.com/user123/status/1234567890',
            source_domain: 'twitter.com'
          },
          top_matches: [
            {
              url: 'https://www.reuters.com/world/syria-bombing-aftermath-2020',
              domain: 'reuters.com',
              crawl_date: '2020-03-15T08:23:00Z',
              match_percentage: 100,
              backlinks: 234
            },
            {
              url: 'https://www.bbc.com/news/world-middle-east-51234567',
              domain: 'bbc.com',
              crawl_date: '2020-03-16T00:00:00Z',
              match_percentage: 100,
              backlinks: 189
            },
            {
              url: 'https://apnews.com/article/syria-conflict-aleppo',
              domain: 'apnews.com',
              crawl_date: '2020-03-15T12:00:00Z',
              match_percentage: 98,
              backlinks: 156
            }
          ],
          domain_breakdown: {
            news_sites: 456,
            social_media: 312,
            stock_photo_sites: 0,
            blogs: 89,
            other: 390
          },
          modifications_detected: [
            {
              type: 'crop',
              description: 'Cropped version detected',
              example_url: 'https://somesite.com/cropped.jpg',
              crawl_date: '2021-06-20T00:00:00Z'
            }
          ],
          is_stock_photo: false
        };

      case 3: // Few results (moderately shared)
      default:
        return {
          status: 'found',
          total_results: 23,
          first_appearance: {
            date: '2024-10-01T14:30:00Z',
            age: {
              days: 45,
              months: 1,
              years: 0,
              human_readable: '1 month old'
            },
            source_url: 'https://medium.com/@photographer/my-latest-work',
            source_domain: 'medium.com',
            image_url: 'https://miro.medium.com/abc123.jpg',
            backlinks: 23
          },
          most_recent_appearance: {
            date: '2024-11-10T00:00:00Z',
            source_url: 'https://pinterest.com/pin/123456',
            source_domain: 'pinterest.com'
          },
          top_matches: [
            {
              url: 'https://medium.com/@photographer/my-latest-work',
              domain: 'medium.com',
              crawl_date: '2024-10-01T14:30:00Z',
              match_percentage: 100,
              backlinks: 23
            }
          ],
          domain_breakdown: {
            news_sites: 2,
            social_media: 15,
            stock_photo_sites: 0,
            blogs: 6,
            other: 0
          },
          modifications_detected: [],
          is_stock_photo: false
        };
    }
  }
}

module.exports = new TinEyeSearchService();