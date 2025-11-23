/**
 * External AI Detection Service
 * Integrates with Hive AI API for high-accuracy AI detection
 * 
 * Provides 95%+ accuracy AI detection as premium feature
 */

const crypto = require('crypto');

// Configuration
const HIVE_API_URL = process.env.HIVE_API_URL || 'https://api.thehive.ai/api/v2/task/sync';
const HIVE_API_KEY = process.env.HIVE_API_KEY || null;

// Cache for results (avoid re-checking same content)
const resultCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Detect AI-generated content using Hive AI API
 * @param {string} filePathOrUrl - Local file path or URL
 * @param {string} hash - SHA-256 hash for caching
 * @param {string} mediaType - 'image', 'video', or 'audio'
 * @returns {Promise<Object>} Detection result
 */
async function detectAI(filePathOrUrl, hash, mediaType = 'image') {
  // Check cache first
  const cacheKey = `${hash}-${mediaType}`;
  const cached = resultCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Returning cached AI detection result for', hash.substring(0, 16));
    return cached.result;
  }

  // Check if API key is configured
  if (!HIVE_API_KEY) {
    console.warn('Hive API key not configured - using mock response');
    return getMockResponse(mediaType);
  }

  try {
    // Call Hive API
    const result = await callHiveAPI(filePathOrUrl, mediaType);
    
    // Cache the result
    resultCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    // Clean old cache entries periodically
    cleanCache();

    return result;
  } catch (error) {
    console.error('External AI detection error:', error.message);
    
    // Return degraded response on error
    return {
      provider: 'hive_ai',
      status: 'error',
      error: error.message,
      confidence: null,
      result: null,
      fallback: true
    };
  }
}

/**
 * Call Hive AI API
 */
async function callHiveAPI(filePathOrUrl, mediaType) {
  const isUrl = filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://');
  
  // Prepare request payload
  const payload = {
    media_type: mediaType,
    models: ['ai_generated'] // Hive's AI detection model
  };

  if (isUrl) {
    payload.url = filePathOrUrl;
  } else {
    // For local files, we'd need to upload or provide URL
    // In production, upload to temporary S3 bucket or similar
    throw new Error('Local file upload not implemented - provide URL');
  }

  const response = await fetch(HIVE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${HIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Hive API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Parse Hive response
  return parseHiveResponse(data, mediaType);
}

/**
 * Parse Hive API response
 */
function parseHiveResponse(data, mediaType) {
  // Hive returns: { status, outputs: [{ classes: [{ class, score }] }] }
  
  if (data.status[0].response.status !== 'success') {
    throw new Error('Hive API processing failed');
  }

  const outputs = data.status[0].response.output || [];
  const aiClasses = outputs.flatMap(o => o.classes || [])
    .filter(c => c.class === 'ai_generated' || c.class === 'real');

  // Get AI score (0-1)
  const aiClass = aiClasses.find(c => c.class === 'ai_generated');
  const realClass = aiClasses.find(c => c.class === 'real');
  
  const aiScore = aiClass ? aiClass.score : 0;
  const realScore = realClass ? realClass.score : 1 - aiScore;

  // Convert to our format (0-100, higher = more authentic)
  const authenticConfidence = Math.round(realScore * 100);

  return {
    provider: 'hive_ai',
    status: 'success',
    confidence: authenticConfidence,
    result: authenticConfidence >= 50 ? 'authentic' : 'ai_generated',
    authentic_confidence: authenticConfidence,
    ai_confidence: 100 - authenticConfidence,
    details: {
      ai_score: aiScore,
      real_score: realScore,
      media_type: mediaType
    }
  };
}

/**
 * Mock response for development/testing
 */
function getMockResponse(mediaType) {
  // Return mock data that simulates Hive API
  // In development, we can adjust these to test different scenarios
  
  return {
    provider: 'hive_ai_mock',
    status: 'mock',
    confidence: 85,
    result: 'authentic',
    authentic_confidence: 85,
    ai_confidence: 15,
    details: {
      note: 'Mock response - configure HIVE_API_KEY for real detection',
      media_type: mediaType
    }
  };
}

/**
 * Clean old cache entries
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of resultCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      resultCache.delete(key);
    }
  }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    entries: resultCache.size,
    ttl_hours: CACHE_TTL / (1000 * 60 * 60)
  };
}

/**
 * Clear cache (for testing)
 */
function clearCache() {
  resultCache.clear();
}

module.exports = {
  detectAI,
  getCacheStats,
  clearCache
};
