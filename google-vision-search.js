/**
 * Google Vision API Integration for Verisource
 */

const vision = require('@google-cloud/vision');
const fs = require('fs');

// Initialize client
let client;

try {
  // Option 1: Use base64 environment variable (for Railway production)
  if (process.env.GOOGLE_VISION_KEY_BASE64) {
    console.log('�� Loading Google Vision key from environment variable...');
    const keyJson = Buffer.from(process.env.GOOGLE_VISION_KEY_BASE64, 'base64').toString('utf8');
    const credentials = JSON.parse(keyJson);
    
    client = new vision.ImageAnnotatorClient({ credentials });
    console.log('✅ Google Vision client initialized from environment');
  }
  // Option 2: Use JSON file (for local development)
  else if (fs.existsSync('./google-vision-key.json')) {
    console.log('📦 Loading Google Vision key from file...');
    client = new vision.ImageAnnotatorClient({
      keyFilename: './google-vision-key.json'
    });
    console.log('✅ Google Vision client initialized from file');
  }
  else {
    console.warn('⚠️  Google Vision key not configured');
  }
} catch (error) {
  console.error('❌ Failed to initialize Google Vision client:', error.message);
}

/**
 * Analyze image using Google Vision API
 */
async function analyzeImage(image) {
  if (!client) {
    return {
      enabled: false,
      service: 'Google Vision',
      error: 'Client not initialized'
    };
  }

  try {
    let imageContent;
    if (Buffer.isBuffer(image)) {
      imageContent = { content: image };
    } else if (typeof image === 'string') {
      imageContent = { source: { filename: image } };
    } else {
      throw new Error('Image must be a Buffer or file path string');
    }

    const [result] = await client.annotateImage({
      image: imageContent,
      features: [
        { type: 'WEB_DETECTION', maxResults: 10 },
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'LABEL_DETECTION', maxResults: 10 },
        { type: 'LOGO_DETECTION', maxResults: 5 },
        { type: 'FACE_DETECTION', maxResults: 10 }
      ]
    });

    return {
      enabled: true,
      found: result.webDetection?.pagesWithMatchingImages?.length > 0,
      service: 'Google Vision',
      results: {
        web_detection: {
          full_matching_images: result.webDetection?.fullMatchingImages?.slice(0, 5).map(img => ({
            url: img.url
          })) || [],
          partial_matching_images: result.webDetection?.partialMatchingImages?.slice(0, 5).map(img => ({
            url: img.url
          })) || [],
          pages_with_matching_images: result.webDetection?.pagesWithMatchingImages?.slice(0, 5).map(page => ({
            url: page.url,
            page_title: page.pageTitle
          })) || [],
          web_entities: result.webDetection?.webEntities?.slice(0, 10).map(entity => ({
            description: entity.description,
            score: entity.score
          })) || [],
          best_guess_labels: result.webDetection?.bestGuessLabels?.map(label => label.label) || []
        },
        safe_search: {
          adult: result.safeSearchAnnotation?.adult || 'UNKNOWN',
          violence: result.safeSearchAnnotation?.violence || 'UNKNOWN',
          racy: result.safeSearchAnnotation?.racy || 'UNKNOWN',
          is_safe: (
            result.safeSearchAnnotation?.adult === 'VERY_UNLIKELY' ||
            result.safeSearchAnnotation?.adult === 'UNLIKELY'
          ) && (
            result.safeSearchAnnotation?.violence === 'VERY_UNLIKELY' ||
            result.safeSearchAnnotation?.violence === 'UNLIKELY'
          )
        },
        labels: result.labelAnnotations?.map(label => ({
          description: label.description,
          score: label.score
        })) || [],
        logos: result.logoAnnotations?.map(logo => ({
          description: logo.description,
          score: logo.score
        })) || [],
        faces: {
          count: result.faceAnnotations?.length || 0
        }
      }
    };

  } catch (error) {
    console.error('Google Vision API error:', error);
    return {
      enabled: true,
      found: false,
      service: 'Google Vision',
      error: error.message
    };
  }
}

module.exports = {
  analyzeImage
};
