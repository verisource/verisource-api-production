const vision = require('@google-cloud/vision');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function searchGoogleVision(imagePath) {
  if (!process.env.GOOGLE_VISION_API_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { enabled: false, message: 'Google Vision API not configured' };
  }
  
  try {
    const client = new vision.ImageAnnotatorClient();
    const [result] = await client.webDetection(imagePath);
    const webDetection = result.webDetection;
    
    return {
      enabled: true,
      service: 'Google Vision',
      results: {
        full_matches: webDetection.fullMatchingImages?.map(img => ({
          url: img.url
        })) || [],
        pages_with_image: webDetection.pagesWithMatchingImages?.map(page => ({
          url: page.url,
          page_title: page.pageTitle
        })) || [],
        labels: webDetection.webEntities?.map(entity => ({
          description: entity.description,
          score: entity.score
        })) || []
      }
    };
  } catch (error) {
    console.error('Google Vision error:', error.message);
    return { enabled: true, service: 'Google Vision', error: error.message };
  }
}

async function searchTinEye(imagePath) {
  if (!process.env.TINEYE_API_KEY || !process.env.TINEYE_API_SECRET) {
    return { enabled: false, message: 'TinEye API not configured' };
  }
  
  try {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    
    const response = await axios.post('https://api.tineye.com/rest/search/', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${process.env.TINEYE_API_KEY}`
      }
    });
    
    return {
      enabled: true,
      service: 'TinEye',
      results: {
        total_matches: response.data.results?.num_matches || 0,
        matches: response.data.results?.matches?.slice(0, 10) || []
      }
    };
  } catch (error) {
    console.error('TinEye error:', error.message);
    return { enabled: true, service: 'TinEye', error: error.message };
  }
}

async function searchBingVisual(imagePath) {
  if (!process.env.BING_SEARCH_API_KEY) {
    return { enabled: false, message: 'Bing Visual Search API not configured' };
  }
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const formData = new FormData();
    formData.append('image', imageBuffer, { filename: 'image.jpg' });
    
    const response = await axios.post(
      'https://api.bing.microsoft.com/v7.0/images/visualsearch',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY
        }
      }
    );
    
    return {
      enabled: true,
      service: 'Bing Visual Search',
      results: {
        similar_images: response.data.tags?.[0]?.actions?.find(
          a => a.actionType === 'VisualSearch'
        )?.data?.value?.slice(0, 10) || []
      }
    };
  } catch (error) {
    console.error('Bing error:', error.message);
    return { enabled: true, service: 'Bing Visual Search', error: error.message };
  }
}

async function searchAllEngines(imagePath, options = {}) {
  const {
    enableGoogle = false,
    enableTinEye = false,
    enableBing = true
  } = options;
  
  const searches = [];
  
  if (enableGoogle) searches.push(searchGoogleVision(imagePath));
  if (enableTinEye) searches.push(searchTinEye(imagePath));
  if (enableBing) searches.push(searchBingVisual(imagePath));
  
  if (searches.length === 0) {
    return { enabled: false, message: 'No external search engines enabled' };
  }
  
  const results = await Promise.all(searches);
  
  return {
    searched_engines: results.map(r => r.service).filter(Boolean),
    results: results.filter(r => r.enabled !== false),
    summary: {
      total_external_matches: results.reduce((sum, r) => {
        if (r.results?.full_matches) return sum + r.results.full_matches.length;
        if (r.results?.total_matches) return sum + r.results.total_matches;
        return sum;
      }, 0),
      engines_searched: results.filter(r => r.enabled !== false).length,
      engines_with_results: results.filter(r => r.results && !r.error).length
    }
  };
}

module.exports = {
  searchGoogleVision,
  searchTinEye,
  searchBingVisual,
  searchAllEngines
};
