/**
 * Google Reverse Image Search Service (via SerpAPI)
 * Searches Google's massive image index for matches
 * Complements TinEye with better recent/viral content coverage
 */

const crypto = require('crypto');

class GoogleReverseSearchService {
  constructor() {
    this.apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    this.endpoint = 'https://serpapi.com/search.json';
    
    this.sandboxMode = !this.apiKey;
    if (this.sandboxMode) {
      console.log('Google Reverse Search (SerpAPI): Running in sandbox/mock mode');
    } else {
      console.log('Google Reverse Search (SerpAPI): API configured');
    }
  }

  /**
   * Search Google using image buffer
   * @param {Buffer} imageBuffer - The image file buffer
   * @param {Object} options - Search options
   * @returns {Object} Google reverse search results
   */
  async search(imageBuffer, options = {}) {
    if (this.sandboxMode) {
      return this.getMockResults(imageBuffer);
    }

    try {
      const fetch = (await import('node-fetch')).default;
      const FormData = (await import('form-data')).default;
      
      // Create form data with image file
      const formData = new FormData();
      formData.append('engine', 'google_reverse_image');
      formData.append('api_key', this.apiKey);
      formData.append('hl', options.language || 'en');
      formData.append('gl', options.country || 'us');
      
      // Append image as file (not base64 in URL)
      formData.append('image', imageBuffer, {
        filename: 'image.jpg',
        contentType: 'image/jpeg'
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
        timeout: 45000
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SerpAPI error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseResults(data);
      
    } catch (error) {
      console.error('Google reverse search error:', error.message);
      return {
        status: 'error',
        error: error.message,
        total_results: 0,
        matches: []
      };
    }
  }

  /**
   * Parse SerpAPI Google Reverse Image response
   */
  parseResults(data) {
    if (!data) {
      return { status: 'error', error: 'No data returned', total_results: 0 };
    }

    if (data.error) {
      return { status: 'error', error: data.error, total_results: 0 };
    }

    const results = {
      status: 'success',
      search_metadata: {
        id: data.search_metadata?.id,
        status: data.search_metadata?.status,
        created_at: data.search_metadata?.created_at
      },
      best_guess_label: null,
      inline_images: [],
      image_results: [],
      visual_matches: [],
      related_searches: [],
      total_results: 0,
      exact_matches: 0,
      pages_found: 0,
      similar_images: 0
    };

    // Knowledge graph (what Google thinks this is)
    if (data.knowledge_graph) {
      results.best_guess_label = data.knowledge_graph.title;
    }

    // Inline images (exact matches)
    if (data.inline_images && Array.isArray(data.inline_images)) {
      results.inline_images = data.inline_images.slice(0, 20).map(img => ({
        source: img.source,
        source_name: img.source_name || this.extractDomain(img.source),
        link: img.link,
        title: img.title
      }));
      results.exact_matches = data.inline_images.length;
    }

    // Image results (pages with this image)
    if (data.image_results && Array.isArray(data.image_results)) {
      results.image_results = data.image_results.slice(0, 30).map(result => ({
        position: result.position,
        title: result.title,
        link: result.link,
        domain: this.extractDomain(result.link),
        snippet: result.snippet,
        date: result.date || null
      }));
      results.pages_found = data.image_results.length;
    }

    // Visual matches (similar images)
    if (data.visual_matches && Array.isArray(data.visual_matches)) {
      results.visual_matches = data.visual_matches.slice(0, 20).map(match => ({
        title: match.title,
        link: match.link,
        domain: this.extractDomain(match.link),
        source: match.source
      }));
      results.similar_images = data.visual_matches.length;
    }

    // Related searches
    if (data.related_searches && Array.isArray(data.related_searches)) {
      results.related_searches = data.related_searches.slice(0, 10).map(search => ({
        query: search.query
      }));
    }

    results.total_results = results.exact_matches + results.pages_found + results.similar_images;
    results.status = results.total_results > 0 ? 'found' : 'not_found';
    results.analysis = this.analyzeResults(results);

    return results;
  }

  /**
   * Analyze results for insights
   */
  analyzeResults(results) {
    const analysis = {
      is_found_online: results.total_results > 0,
      spread_level: 'none',
      content_type: 'unknown',
      concerns: [],
      domain_breakdown: {}
    };

    // Determine spread level
    if (results.total_results === 0) {
      analysis.spread_level = 'none';
    } else if (results.total_results < 10) {
      analysis.spread_level = 'minimal';
    } else if (results.total_results < 50) {
      analysis.spread_level = 'moderate';
    } else if (results.total_results < 200) {
      analysis.spread_level = 'significant';
    } else {
      analysis.spread_level = 'viral';
    }

    // Analyze domains
    const domains = results.image_results.map(r => r.domain).filter(Boolean);
    
    // Check for stock photo sites
    const stockSites = ['shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'stock.adobe.com', 'depositphotos.com', 'dreamstime.com', 'alamy.com'];
    if (stockSites.some(site => domains.some(d => d.includes(site)))) {
      analysis.content_type = 'stock_photo';
      analysis.concerns.push('Image found on stock photo sites');
    }

    // Check for news sites
    const newsSites = ['reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'nytimes.com', 'theguardian.com'];
    if (newsSites.some(site => domains.some(d => d.includes(site)))) {
      analysis.content_type = 'news_photo';
      analysis.concerns.push('Image appears in news media');
    }

    // Check for social media
    const socialSites = ['twitter.com', 'facebook.com', 'instagram.com', 'reddit.com', 'pinterest.com'];
    if (socialSites.some(site => domains.some(d => d.includes(site)))) {
      analysis.content_type = 'social_media';
    }

    // Count domain types
    analysis.domain_breakdown = {
      social_media: domains.filter(d => socialSites.some(s => d.includes(s))).length,
      stock_photos: domains.filter(d => stockSites.some(s => d.includes(s))).length,
      news_sites: domains.filter(d => newsSites.some(s => d.includes(s))).length,
      other: domains.length - domains.filter(d => 
        [...socialSites, ...stockSites, ...newsSites].some(s => d.includes(s))
      ).length
    };

    return analysis;
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url.split('/')[2] || url;
    }
  }

  /**
   * Generate mock results for sandbox mode
   */
  getMockResults(imageBuffer) {
    // Create deterministic results based on image hash
    const hash = imageBuffer 
      ? crypto.createHash('md5').update(imageBuffer).digest('hex')
      : crypto.randomBytes(16).toString('hex');
    
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const scenario = hashNum % 5;

    const scenarios = {
      0: this.mockNotFound(),
      1: this.mockStockPhoto(hashNum),
      2: this.mockNewsPhoto(hashNum),
      3: this.mockSocialMedia(hashNum),
      4: this.mockViralContent(hashNum)
    };

    return scenarios[scenario];
  }

  mockNotFound() {
    return {
      status: 'not_found',
      search_metadata: { id: 'mock_search', status: 'Success' },
      best_guess_label: null,
      inline_images: [],
      image_results: [],
      visual_matches: [],
      related_searches: [],
      total_results: 0,
      exact_matches: 0,
      pages_found: 0,
      similar_images: 0,
      analysis: {
        is_found_online: false,
        spread_level: 'none',
        content_type: 'unknown',
        concerns: [],
        domain_breakdown: { social_media: 0, stock_photos: 0, news_sites: 0, other: 0 }
      }
    };
  }

  mockStockPhoto(seed) {
    const count = 50 + (seed % 200);
    return {
      status: 'found',
      search_metadata: { id: 'mock_search', status: 'Success' },
      best_guess_label: 'stock photo',
      inline_images: [
        { source: 'https://www.shutterstock.com/image/123', source_name: 'shutterstock.com', title: 'Professional stock image' },
        { source: 'https://www.istockphoto.com/photo/456', source_name: 'istockphoto.com', title: 'Business concept' }
      ],
      image_results: [
        { position: 1, title: 'Stock Photo', link: 'https://shutterstock.com/123', domain: 'shutterstock.com', snippet: 'Download this stock photo' },
        { position: 2, title: 'iStock Image', link: 'https://istockphoto.com/456', domain: 'istockphoto.com', snippet: 'Royalty-free stock photo' },
        { position: 3, title: 'Getty Images', link: 'https://gettyimages.com/789', domain: 'gettyimages.com', snippet: 'High quality stock photography' }
      ],
      visual_matches: [],
      related_searches: [{ query: 'similar stock photos' }],
      total_results: count,
      exact_matches: 3,
      pages_found: count - 3,
      similar_images: 0,
      analysis: {
        is_found_online: true,
        spread_level: 'significant',
        content_type: 'stock_photo',
        concerns: ['Image found on stock photo sites'],
        domain_breakdown: { social_media: 0, stock_photos: count, news_sites: 0, other: 0 }
      }
    };
  }

  mockNewsPhoto(seed) {
    const count = 20 + (seed % 100);
    return {
      status: 'found',
      search_metadata: { id: 'mock_search', status: 'Success' },
      best_guess_label: 'news photograph',
      inline_images: [
        { source: 'https://reuters.com/article/123', source_name: 'reuters.com', title: 'Reuters News Photo' }
      ],
      image_results: [
        { position: 1, title: 'Breaking News', link: 'https://reuters.com/123', domain: 'reuters.com', snippet: 'News coverage' },
        { position: 2, title: 'BBC Report', link: 'https://bbc.com/456', domain: 'bbc.com', snippet: 'Latest news' },
        { position: 3, title: 'CNN Article', link: 'https://cnn.com/789', domain: 'cnn.com', snippet: 'News story' }
      ],
      visual_matches: [],
      related_searches: [{ query: 'related news' }],
      total_results: count,
      exact_matches: 1,
      pages_found: count - 1,
      similar_images: 0,
      analysis: {
        is_found_online: true,
        spread_level: 'moderate',
        content_type: 'news_photo',
        concerns: ['Image appears in news media'],
        domain_breakdown: { social_media: 0, stock_photos: 0, news_sites: count, other: 0 }
      }
    };
  }

  mockSocialMedia(seed) {
    const count = 30 + (seed % 150);
    return {
      status: 'found',
      search_metadata: { id: 'mock_search', status: 'Success' },
      best_guess_label: 'social media image',
      inline_images: [
        { source: 'https://twitter.com/user/status/123', source_name: 'twitter.com', title: 'Tweet' },
        { source: 'https://reddit.com/r/pics/456', source_name: 'reddit.com', title: 'Reddit Post' }
      ],
      image_results: [
        { position: 1, title: 'Twitter Post', link: 'https://twitter.com/123', domain: 'twitter.com', snippet: 'Shared on Twitter' },
        { position: 2, title: 'Reddit Thread', link: 'https://reddit.com/456', domain: 'reddit.com', snippet: 'Reddit discussion' },
        { position: 3, title: 'Pinterest Pin', link: 'https://pinterest.com/789', domain: 'pinterest.com', snippet: 'Pinned image' }
      ],
      visual_matches: [],
      related_searches: [{ query: 'viral image' }],
      total_results: count,
      exact_matches: 2,
      pages_found: count - 2,
      similar_images: 0,
      analysis: {
        is_found_online: true,
        spread_level: 'moderate',
        content_type: 'social_media',
        concerns: [],
        domain_breakdown: { social_media: count, stock_photos: 0, news_sites: 0, other: 0 }
      }
    };
  }

  mockViralContent(seed) {
    const count = 500 + (seed % 2000);
    return {
      status: 'found',
      search_metadata: { id: 'mock_search', status: 'Success' },
      best_guess_label: 'viral meme',
      inline_images: [
        { source: 'https://knowyourmeme.com/123', source_name: 'knowyourmeme.com', title: 'Viral Meme' },
        { source: 'https://reddit.com/r/memes/456', source_name: 'reddit.com', title: 'Popular meme' }
      ],
      image_results: [
        { position: 1, title: 'Know Your Meme', link: 'https://knowyourmeme.com/123', domain: 'knowyourmeme.com', snippet: 'Meme database entry' },
        { position: 2, title: 'Reddit Memes', link: 'https://reddit.com/456', domain: 'reddit.com', snippet: 'Viral on Reddit' },
        { position: 3, title: 'Twitter Viral', link: 'https://twitter.com/789', domain: 'twitter.com', snippet: 'Trending on Twitter' }
      ],
      visual_matches: [
        { title: 'Similar meme', link: 'https://imgflip.com/123', domain: 'imgflip.com' }
      ],
      related_searches: [{ query: 'meme template' }, { query: 'viral image origin' }],
      total_results: count,
      exact_matches: 2,
      pages_found: count - 3,
      similar_images: 1,
      analysis: {
        is_found_online: true,
        spread_level: 'viral',
        content_type: 'social_media',
        concerns: ['Image is widely spread - verify original source'],
        domain_breakdown: { social_media: Math.floor(count * 0.7), stock_photos: 0, news_sites: Math.floor(count * 0.1), other: Math.floor(count * 0.2) }
      }
    };
  }
}

module.exports = GoogleReverseSearchService;