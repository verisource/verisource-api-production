const https = require('https');

/**
 * Google Custom Search Integration for VeriSource
 * Performs reverse image search to find where images appear online
 */

const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_VISION_KEY; // Reuse existing Google credentials

/**
 * Perform reverse image search using Google Custom Search API
 * @param {string} imageUrl - Public URL of the image to search
 * @returns {Promise<Object>}
 */
async function reverseImageSearch(imageUrl) {
  if (!SEARCH_ENGINE_ID || !GOOGLE_API_KEY) {
    return {
      enabled: false,
      message: 'Google Custom Search not configured'
    };
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: SEARCH_ENGINE_ID,
      searchType: 'image',
      imgUrl: imageUrl,
      num: 10, // Return top 10 results
      safe: 'off'
    });

    const options = {
      hostname: 'www.googleapis.com',
      path: `/customsearch/v1?${params}`,
      method: 'GET',
      headers: {
        'User-Agent': 'VeriSource/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          // Check for API errors
          if (result.error) {
            return resolve({
              enabled: true,
              found: false,
              error: result.error.message,
              processing_time_ms: Date.now() - startTime
            });
          }

          // No results found
          if (!result.items || result.items.length === 0) {
            return resolve({
              enabled: true,
              found: false,
              message: 'No matching images found online',
              processing_time_ms: Date.now() - startTime
            });
          }

          // Process results
          const matches = result.items.map(item => ({
            title: item.title,
            url: item.link,
            display_url: item.displayLink,
            snippet: item.snippet,
            thumbnail: item.image?.thumbnailLink,
            context_url: item.image?.contextLink,
            width: item.image?.width,
            height: item.image?.height
          }));

          resolve({
            enabled: true,
            found: true,
            total_results: parseInt(result.searchInformation?.totalResults) || matches.length,
            search_time: parseFloat(result.searchInformation?.searchTime) || 0,
            matches: matches,
            processing_time_ms: Date.now() - startTime,
            service: 'Google Custom Search'
          });

        } catch (error) {
          reject(new Error(`Failed to parse Google response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Google Custom Search request timeout'));
    });
    req.end();
  });
}

/**
 * Search for image by uploading to a temporary public URL
 * Note: This requires the image to be publicly accessible
 * @param {string} localPath - Local path to image file
 * @returns {Promise<Object>}
 */
async function searchLocalImage(localPath) {
  // For local images, we'd need to upload to a temporary public URL first
  // This is a placeholder for future implementation
  return {
    enabled: false,
    message: 'Local image search requires public URL hosting (not yet implemented)'
  };
}

/**
 * Check if Google Custom Search is configured
 */
function isConfigured() {
  return !!(SEARCH_ENGINE_ID && GOOGLE_API_KEY);
}

module.exports = {
  reverseImageSearch,
  searchLocalImage,
  isConfigured
};
