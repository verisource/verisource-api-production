/**
 * Bing Visual Search Service
 * Uses Microsoft's Bing Visual Search API for reverse image search
 */

const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

class BingVisualSearchService {
  constructor() {
    this.apiKey = process.env.BING_SEARCH_API_KEY;
    this.endpoint = process.env.BING_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/images/visualsearch';
    
    this.sandboxMode = !this.apiKey;
    if (this.sandboxMode) {
      console.log('Bing Visual Search: Running in sandbox/mock mode');
    }
  }

  /**
   * Search Bing using image buffer
   * @param {Buffer} imageBuffer - The image file buffer
   * @param {Object} options - Search options
   * @returns {Object} Bing search results
   */
  async searchByImage(imageBuffer, options = {}) {
    const {
      market = 'en-US',
      safeSearch = 'Moderate'
    } = options;

    if (this.sandboxMode) {
      return { status: "unavailable", message: "Bing Visual Search API not configured", total_results: 0, pages_with_image: [] };
    }

    try {
      const form = new FormData();
      form.append('image', imageBuffer, {
        filename: 'search_image.jpg',
        contentType: 'image/jpeg'
      });

      const response = await axios.post(this.endpoint, form, {
        headers: {
          ...form.getHeaders(),
          'Ocp-Apim-Subscription-Key': this.apiKey
        },
        params: {
          mkt: market,
          safeSearch: safeSearch
        },
        timeout: 30000
      });

      return this.parseResults(response.data);
    } catch (error) {
      console.error('Bing Visual Search error:', error.message);
      return {
        status: 'error',
        error: error.message,
        total_results: 0,
        matches: []
      };
    }
  }

  /**
   * Search Bing using image URL
   * @param {string} imageUrl - URL of the image to search
   * @param {Object} options - Search options
   * @returns {Object} Bing search results
   */
  async searchByUrl(imageUrl, options = {}) {
    const {
      market = 'en-US',
      safeSearch = 'Moderate'
    } = options;

    if (this.sandboxMode) {
      return { status: "unavailable", message: "Bing Visual Search API not configured", total_results: 0, pages_with_image: [] };
    }

    try {
      const knowledgeRequest = {
        imageInfo: {
          url: imageUrl
        }
      };

      const form = new FormData();
      form.append('knowledgeRequest', JSON.stringify(knowledgeRequest));

      const response = await axios.post(this.endpoint, form, {
        headers: {
          ...form.getHeaders(),
          'Ocp-Apim-Subscription-Key': this.apiKey
        },
        params: {
          mkt: market,
          safeSearch: safeSearch
        },
        timeout: 30000
      });

      return this.parseResults(response.data);
    } catch (error) {
      console.error('Bing URL search error:', error.message);
      return {
        status: 'error',
        error: error.message,
        total_results: 0,
        matches: []
      };
    }
  }

  /**
   * Parse Bing Visual Search API response
   */
  parseResults(data) {
    if (!data || !data.tags) {
      return {
        status: 'not_found',
        total_results: 0,
        matches: [],
        similar_images: [],
        pages_with_image: [],
        visual_tags: []
      };
    }

    let pagesContainingImage = [];
    let visuallySimilarImages = [];
    let relatedSearches = [];
    let productOffers = [];
    let bestGuessLabel = null;

    // Parse each tag
    data.tags.forEach(tag => {
      if (!tag.actions) return;

      tag.actions.forEach(action => {
        switch (action.actionType) {
          case 'PagesIncluding':
            // Pages that contain this exact image
            if (action.data && action.data.value) {
              pagesContainingImage = action.data.value.map(page => ({
                url: page.hostPageUrl,
                domain: this.extractDomain(page.hostPageUrl),
                title: page.name,
                thumbnail: page.thumbnailUrl,
                date_indexed: page.datePublished || null,
                image_url: page.contentUrl,
                width: page.width,
                height: page.height,
                host_page_display_url: page.hostPageDisplayUrl
              }));
            }
            break;

          case 'VisualSearch':
          case 'ImageById':
            // Visually similar images
            if (action.data && action.data.value) {
              visuallySimilarImages = action.data.value.map(img => ({
                url: img.hostPageUrl,
                domain: this.extractDomain(img.hostPageUrl),
                thumbnail: img.thumbnailUrl,
                image_url: img.contentUrl,
                title: img.name,
                width: img.width,
                height: img.height,
                similarity_score: img.similarity || null
              }));
            }
            break;

          case 'RelatedSearches':
            // Related search queries
            if (action.data && action.data.value) {
              relatedSearches = action.data.value.map(search => ({
                text: search.text,
                thumbnail: search.thumbnail ? search.thumbnail.url : null
              }));
            }
            break;

          case 'ProductVisualSearch':
            // Product matches (if image is a product)
            if (action.data && action.data.value) {
              productOffers = action.data.value.map(product => ({
                name: product.name,
                price: product.offers ? product.offers[0]?.price : null,
                currency: product.offers ? product.offers[0]?.priceCurrency : null,
                seller: product.offers ? product.offers[0]?.seller?.name : null,
                url: product.hostPageUrl,
                image_url: product.contentUrl
              }));
            }
            break;

          case 'BestRepresentativeQuery':
            // What Bing thinks the image is
            if (action.data && action.data.text) {
              bestGuessLabel = action.data.text;
            }
            break;
        }
      });

      // Check for display name as best guess
      if (tag.displayName && !bestGuessLabel) {
        bestGuessLabel = tag.displayName;
      }
    });

    // Analyze domain distribution
    const domainCounts = {};
    const domainTypes = {
      news_sites: 0,
      social_media: 0,
      stock_photo_sites: 0,
      blogs: 0,
      ecommerce: 0,
      other: 0
    };

    const socialMediaDomains = ['twitter.com', 'facebook.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'linkedin.com', 'pinterest.com'];
    const stockPhotoDomains = ['shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'stock.adobe.com', 'depositphotos.com', 'dreamstime.com'];
    const newsDomains = ['reuters.com', 'bbc.com', 'cnn.com', 'apnews.com', 'nytimes.com', 'theguardian.com', 'foxnews.com', 'nbcnews.com'];
    const ecommerceDomains = ['amazon.com', 'ebay.com', 'walmart.com', 'etsy.com', 'aliexpress.com'];

    pagesContainingImage.forEach(page => {
      const domain = page.domain;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;

      if (socialMediaDomains.some(d => domain.includes(d))) {
        domainTypes.social_media++;
      } else if (stockPhotoDomains.some(d => domain.includes(d))) {
        domainTypes.stock_photo_sites++;
      } else if (newsDomains.some(d => domain.includes(d)) || domain.includes('news')) {
        domainTypes.news_sites++;
      } else if (ecommerceDomains.some(d => domain.includes(d)) || domain.includes('shop')) {
        domainTypes.ecommerce++;
      } else if (domain.includes('blog') || domain.includes('wordpress') || domain.includes('medium.com')) {
        domainTypes.blogs++;
      } else {
        domainTypes.other++;
      }
    });

    // Get earliest indexed date
    let firstIndexed = null;
    let mostRecent = null;
    
    const datedPages = pagesContainingImage.filter(p => p.date_indexed);
    if (datedPages.length > 0) {
      datedPages.sort((a, b) => new Date(a.date_indexed) - new Date(b.date_indexed));
      firstIndexed = datedPages[0];
      mostRecent = datedPages[datedPages.length - 1];
    }

    return {
      status: pagesContainingImage.length > 0 ? 'found' : 'not_found',
      total_results: pagesContainingImage.length,
      
      best_guess_label: bestGuessLabel,
      
      pages_with_image: pagesContainingImage.slice(0, 20),
      
      similar_images: {
        count: visuallySimilarImages.length,
        images: visuallySimilarImages.slice(0, 10)
      },
      
      first_indexed: firstIndexed ? {
        date: firstIndexed.date_indexed,
        url: firstIndexed.url,
        domain: firstIndexed.domain,
        title: firstIndexed.title
      } : null,
      
      most_recent: mostRecent ? {
        date: mostRecent.date_indexed,
        url: mostRecent.url,
        domain: mostRecent.domain,
        title: mostRecent.title
      } : null,
      
      domain_breakdown: domainTypes,
      
      top_domains: Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count]) => ({ domain, count })),
      
      related_searches: relatedSearches.slice(0, 10),
      
      product_matches: productOffers.length > 0 ? {
        is_product: true,
        offers: productOffers.slice(0, 5)
      } : {
        is_product: false,
        offers: []
      },
      
      visual_match_stats: {
        exact_matches: pagesContainingImage.length,
        similar_matches: visuallySimilarImages.length,
        total: pagesContainingImage.length + visuallySimilarImages.length
      }
    };
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
   * Mock results for testing/sandbox mode
   */
  getMockResults(imageBuffer = null, imageUrl = null) {
    let hash = '000000';
    if (imageBuffer) {
      hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 6);
    } else if (imageUrl) {
      hash = crypto.createHash('md5').update(imageUrl).digest('hex').substring(0, 6);
    }

    const scenario = parseInt(hash.substring(0, 2), 16) % 4;

    switch (scenario) {
      case 0: // No results
        return {
          status: 'not_found',
          total_results: 0,
          best_guess_label: 'photograph',
          pages_with_image: [],
          similar_images: {
            count: 5,
            images: [
              {
                url: 'https://example.com/similar1.jpg',
                domain: 'example.com',
                thumbnail: 'https://example.com/thumb1.jpg',
                similarity_score: 0.75
              }
            ]
          },
          first_indexed: null,
          most_recent: null,
          domain_breakdown: {
            news_sites: 0,
            social_media: 0,
            stock_photo_sites: 0,
            blogs: 0,
            ecommerce: 0,
            other: 0
          },
          related_searches: [
            { text: 'similar images' },
            { text: 'related content' }
          ],
          product_matches: {
            is_product: false,
            offers: []
          },
          visual_match_stats: {
            exact_matches: 0,
            similar_matches: 5,
            total: 5
          }
        };

      case 1: // Found on social media
        return {
          status: 'found',
          total_results: 156,
          best_guess_label: 'viral social media post',
          pages_with_image: [
            {
              url: 'https://twitter.com/breaking_news/status/1234567890',
              domain: 'twitter.com',
              title: 'BREAKING: Major event happening now',
              date_indexed: '2024-11-14T10:30:00Z',
              thumbnail: 'https://pbs.twimg.com/media/example.jpg'
            },
            {
              url: 'https://reddit.com/r/worldnews/comments/abc123',
              domain: 'reddit.com',
              title: 'Breaking news discussion thread',
              date_indexed: '2024-11-14T11:00:00Z'
            },
            {
              url: 'https://facebook.com/news.outlet/posts/123456',
              domain: 'facebook.com',
              title: 'News Outlet - Breaking Coverage',
              date_indexed: '2024-11-14T11:30:00Z'
            }
          ],
          similar_images: {
            count: 42,
            images: [
              {
                url: 'https://somesite.com/related.jpg',
                domain: 'somesite.com',
                similarity_score: 0.89
              }
            ]
          },
          first_indexed: {
            date: '2024-11-14T10:30:00Z',
            url: 'https://twitter.com/breaking_news/status/1234567890',
            domain: 'twitter.com',
            title: 'BREAKING: Major event happening now'
          },
          most_recent: {
            date: '2024-11-14T11:30:00Z',
            url: 'https://facebook.com/news.outlet/posts/123456',
            domain: 'facebook.com',
            title: 'News Outlet - Breaking Coverage'
          },
          domain_breakdown: {
            news_sites: 23,
            social_media: 98,
            stock_photo_sites: 0,
            blogs: 12,
            ecommerce: 0,
            other: 23
          },
          top_domains: [
            { domain: 'twitter.com', count: 45 },
            { domain: 'reddit.com', count: 32 },
            { domain: 'facebook.com', count: 21 }
          ],
          related_searches: [
            { text: 'breaking news today' },
            { text: 'latest updates' }
          ],
          product_matches: {
            is_product: false,
            offers: []
          },
          visual_match_stats: {
            exact_matches: 156,
            similar_matches: 42,
            total: 198
          }
        };

      case 2: // Product image
        return {
          status: 'found',
          total_results: 89,
          best_guess_label: 'wireless bluetooth headphones',
          pages_with_image: [
            {
              url: 'https://amazon.com/dp/B08XYZ123',
              domain: 'amazon.com',
              title: 'Premium Wireless Headphones - Noise Canceling',
              date_indexed: '2024-08-15T00:00:00Z'
            },
            {
              url: 'https://bestbuy.com/site/headphones/123456',
              domain: 'bestbuy.com',
              title: 'Premium Wireless Headphones',
              date_indexed: '2024-08-20T00:00:00Z'
            }
          ],
          similar_images: {
            count: 234,
            images: []
          },
          first_indexed: {
            date: '2024-08-15T00:00:00Z',
            url: 'https://amazon.com/dp/B08XYZ123',
            domain: 'amazon.com',
            title: 'Premium Wireless Headphones - Noise Canceling'
          },
          domain_breakdown: {
            news_sites: 5,
            social_media: 12,
            stock_photo_sites: 0,
            blogs: 15,
            ecommerce: 57,
            other: 0
          },
          product_matches: {
            is_product: true,
            offers: [
              {
                name: 'Premium Wireless Headphones',
                price: 299.99,
                currency: 'USD',
                seller: 'Amazon',
                url: 'https://amazon.com/dp/B08XYZ123'
              },
              {
                name: 'Premium Wireless Headphones',
                price: 279.99,
                currency: 'USD',
                seller: 'Best Buy',
                url: 'https://bestbuy.com/site/headphones/123456'
              }
            ]
          },
          visual_match_stats: {
            exact_matches: 89,
            similar_matches: 234,
            total: 323
          }
        };

      case 3: // News/media content
      default:
        return {
          status: 'found',
          total_results: 312,
          best_guess_label: 'news photograph journalism',
          pages_with_image: [
            {
              url: 'https://reuters.com/world/article-12345',
              domain: 'reuters.com',
              title: 'Major International Story - Reuters',
              date_indexed: '2024-09-01T14:00:00Z'
            },
            {
              url: 'https://bbc.com/news/world-67890',
              domain: 'bbc.com',
              title: 'International Coverage - BBC News',
              date_indexed: '2024-09-01T15:30:00Z'
            },
            {
              url: 'https://cnn.com/2024/09/01/world/story',
              domain: 'cnn.com',
              title: 'World News Coverage - CNN',
              date_indexed: '2024-09-01T16:00:00Z'
            }
          ],
          similar_images: {
            count: 67,
            images: []
          },
          first_indexed: {
            date: '2024-09-01T14:00:00Z',
            url: 'https://reuters.com/world/article-12345',
            domain: 'reuters.com',
            title: 'Major International Story - Reuters'
          },
          most_recent: {
            date: '2024-11-10T00:00:00Z',
            url: 'https://twitter.com/user/status/999',
            domain: 'twitter.com',
            title: 'Recent share'
          },
          domain_breakdown: {
            news_sites: 189,
            social_media: 78,
            stock_photo_sites: 0,
            blogs: 25,
            ecommerce: 0,
            other: 20
          },
          top_domains: [
            { domain: 'reuters.com', count: 45 },
            { domain: 'bbc.com', count: 38 },
            { domain: 'twitter.com', count: 35 },
            { domain: 'cnn.com', count: 28 }
          ],
          related_searches: [
            { text: 'news story' },
            { text: 'current events' },
            { text: 'journalism' }
          ],
          product_matches: {
            is_product: false,
            offers: []
          },
          visual_match_stats: {
            exact_matches: 312,
            similar_matches: 67,
            total: 379
          }
        };
    }
  }
}

module.exports = new BingVisualSearchService();