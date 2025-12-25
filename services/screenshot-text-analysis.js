/**
 * Screenshot Text Analysis Service
 * Extracts text from screenshots and searches for matches online
 * Designed for fact-checkers to verify cropped screenshot content
 */

const vision = require('@google-cloud/vision');
const fs = require('fs');

// Initialize Vision client (reuse from google-vision-search if available)
let client;
try {
  if (process.env.GOOGLE_VISION_KEY_BASE64) {
    const keyJson = Buffer.from(process.env.GOOGLE_VISION_KEY_BASE64, 'base64').toString('utf8');
    const credentials = JSON.parse(keyJson);
    client = new vision.ImageAnnotatorClient({ credentials });
  } else if (fs.existsSync('./google-vision-key.json')) {
    client = new vision.ImageAnnotatorClient({
      keyFilename: './google-vision-key.json'
    });
  }
} catch (error) {
  console.error('❌ Screenshot text analysis: Vision client init failed:', error.message);
}

/**
 * Known fact-check domains
 */
const FACT_CHECK_DOMAINS = [
  'snopes.com',
  'factcheck.org',
  'politifact.com',
  'fullfact.org',
  'reuters.com/fact-check',
  'apnews.com/ap-fact-check',
  'afp.com/fact-check',
  'leadstories.com',
  'checkyourfact.com',
  'truthorfiction.com'
];

/**
 * Known fraud/template sites
 */
const FRAUD_TEMPLATE_SITES = [
  'fake-texts.com',
  'ifaketextmessage.com',
  'fakedetail.com',
  'generatestatus.com',
  'zeoob.com',
  'fakeinfo.net',
  'prankmenot.com'
];

/**
 * News/credible source domains
 */
const CREDIBLE_NEWS_DOMAINS = [
  'bbc.com', 'bbc.co.uk',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'reuters.com',
  'apnews.com',
  'cnn.com',
  'npr.org',
  'pbs.org'
];

/**
 * Extract text from image using Google Vision OCR
 * @param {string|Buffer} image - File path or buffer
 * @returns {Object} Extracted text and metadata
 */
async function extractText(image) {
  if (!client) {
    return {
      success: false,
      error: 'Google Vision client not initialized',
      text: null
    };
  }

  try {
    let imageContent;
    if (Buffer.isBuffer(image)) {
      imageContent = { content: image };
    } else if (typeof image === 'string') {
      imageContent = { source: { filename: image } };
    } else {
      throw new Error('Image must be a Buffer or file path');
    }

    const [result] = await client.annotateImage({
      image: imageContent,
      features: [
        { type: 'TEXT_DETECTION' },
        { type: 'DOCUMENT_TEXT_DETECTION' }
      ]
    });

    const fullText = result.fullTextAnnotation?.text || '';
    const textBlocks = result.textAnnotations?.slice(1).map(t => ({
      text: t.description,
      confidence: t.confidence || null,
      bounds: t.boundingPoly?.vertices
    })) || [];

    return {
      success: true,
      text: fullText.trim(),
      text_blocks: textBlocks,
      languages: result.fullTextAnnotation?.pages?.[0]?.property?.detectedLanguages?.map(l => ({
        code: l.languageCode,
        confidence: l.confidence
      })) || [],
      word_count: fullText.split(/\s+/).filter(w => w.length > 0).length,
      character_count: fullText.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

/**
 * Search for extracted text online
 * @param {string} text - Text to search for
 * @param {function} webSearchFn - Web search function
 * @returns {Object} Search results with categorization
 */
async function searchTextOnline(text, webSearchFn) {
  if (!text || text.length < 10) {
    return {
      searched: false,
      reason: 'Text too short to search',
      results: []
    };
  }

  // Extract key phrases (sentences or chunks)
  const phrases = extractKeyPhrases(text);
  
  const results = {
    searched: true,
    phrases_searched: phrases.length,
    exact_matches: [],
    partial_matches: [],
    fact_checks: [],
    fraud_templates: [],
    credible_sources: [],
    other_sources: []
  };

  for (const phrase of phrases.slice(0, 3)) { // Limit to 3 phrases
    try {
      // Search with quotes for exact match
      const searchResults = await webSearchFn(`"${phrase}"`);
      
      if (searchResults && searchResults.results) {
        for (const result of searchResults.results) {
          const domain = extractDomain(result.url);
          const match = {
            phrase: phrase,
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            domain: domain
          };

          // Categorize the result
          if (FACT_CHECK_DOMAINS.some(d => domain.includes(d))) {
            results.fact_checks.push({
              ...match,
              type: 'fact_check',
              verdict: extractVerdict(result.snippet)
            });
          } else if (FRAUD_TEMPLATE_SITES.some(d => domain.includes(d))) {
            results.fraud_templates.push({
              ...match,
              type: 'fraud_template'
            });
          } else if (CREDIBLE_NEWS_DOMAINS.some(d => domain.includes(d))) {
            results.credible_sources.push({
              ...match,
              type: 'credible_news'
            });
          } else {
            results.other_sources.push(match);
          }

          // Check for exact match
          if (result.snippet && result.snippet.toLowerCase().includes(phrase.toLowerCase())) {
            results.exact_matches.push(match);
          } else {
            results.partial_matches.push(match);
          }
        }
      }
    } catch (error) {
      console.error(`⚠️ Search error for phrase: ${error.message}`);
    }
  }

  return results;
}

/**
 * Extract key phrases from text for searching
 */
function extractKeyPhrases(text) {
  // Split by common delimiters
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 15);
  
  // Take unique, meaningful phrases
  const phrases = [];
  for (const sentence of sentences) {
    const cleaned = sentence.trim().replace(/\s+/g, ' ');
    if (cleaned.length >= 20 && cleaned.length <= 150) {
      phrases.push(cleaned);
    }
  }
  
  // If no good sentences, take chunks
  if (phrases.length === 0 && text.length >= 20) {
    phrases.push(text.substring(0, 100).trim());
  }
  
  return [...new Set(phrases)].slice(0, 5);
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Try to extract verdict from fact-check snippet
 */
function extractVerdict(snippet) {
  if (!snippet) return 'UNKNOWN';
  const lower = snippet.toLowerCase();
  
  if (lower.includes('false') || lower.includes('fake') || lower.includes('fabricated')) {
    return 'FALSE';
  }
  if (lower.includes('true') || lower.includes('verified') || lower.includes('accurate')) {
    return 'TRUE';
  }
  if (lower.includes('misleading') || lower.includes('out of context')) {
    return 'MISLEADING';
  }
  if (lower.includes('partly') || lower.includes('partial')) {
    return 'PARTLY_FALSE';
  }
  
  return 'UNKNOWN';
}

/**
 * Analyze screenshot text and search for verification
 * Main entry point for the service
 * @param {string|Buffer} image - Image file path or buffer
 * @param {function} webSearchFn - Web search function to use
 * @returns {Object} Complete analysis results
 */
async function analyzeScreenshotText(image, webSearchFn) {
  console.log('📝 Extracting text from screenshot...');
  
  // Step 1: Extract text
  const extraction = await extractText(image);
  
  if (!extraction.success || !extraction.text) {
    return {
      performed: true,
      success: false,
      error: extraction.error || 'No text found in image',
      extracted_text: null,
      web_verification: null,
      recommendation: null
    };
  }

  console.log(`✅ Extracted ${extraction.word_count} words from screenshot`);

  // Step 2: Search online (if webSearchFn provided)
  let webVerification = null;
  if (webSearchFn && extraction.text.length >= 20) {
    console.log('🔍 Searching for extracted text online...');
    webVerification = await searchTextOnline(extraction.text, webSearchFn);
    console.log(`✅ Found ${webVerification.exact_matches?.length || 0} exact matches`);
  }

  // Step 3: Generate recommendation
  const recommendation = generateRecommendation(extraction, webVerification);

  return {
    performed: true,
    success: true,
    extracted_text: {
      full_text: extraction.text,
      word_count: extraction.word_count,
      character_count: extraction.character_count,
      languages: extraction.languages,
      key_phrases: extractKeyPhrases(extraction.text)
    },
    web_verification: webVerification,
    recommendation: recommendation
  };
}

/**
 * Generate recommendation based on analysis
 */
function generateRecommendation(extraction, webVerification) {
  const warnings = [];
  let riskLevel = 'LOW';
  let action = 'PROCEED_WITH_CAUTION';

  if (!webVerification) {
    return {
      action: 'MANUAL_VERIFICATION_NEEDED',
      risk_level: 'UNKNOWN',
      warnings: ['Web search not performed - verify text manually'],
      summary: 'Text extracted but not verified online'
    };
  }

  // Check for fraud templates
  if (webVerification.fraud_templates?.length > 0) {
    riskLevel = 'CRITICAL';
    action = 'DO_NOT_USE';
    warnings.push({
      type: 'FRAUD_TEMPLATE',
      severity: 'CRITICAL',
      message: 'Text matches known fraud/fake message template',
      sources: webVerification.fraud_templates.map(f => f.domain)
    });
  }

  // Check for fact-checks
  if (webVerification.fact_checks?.length > 0) {
    const falseVerdicts = webVerification.fact_checks.filter(f => 
      f.verdict === 'FALSE' || f.verdict === 'MISLEADING'
    );
    
    if (falseVerdicts.length > 0) {
      riskLevel = 'HIGH';
      action = 'DO_NOT_PUBLISH';
      warnings.push({
        type: 'FACT_CHECK_FALSE',
        severity: 'HIGH',
        message: `Flagged as FALSE by ${falseVerdicts.length} fact-checker(s)`,
        sources: falseVerdicts.map(f => ({
          domain: f.domain,
          url: f.url,
          verdict: f.verdict
        }))
      });
    } else {
      warnings.push({
        type: 'FACT_CHECK_FOUND',
        severity: 'MEDIUM',
        message: 'Found in fact-check databases - review before publishing',
        sources: webVerification.fact_checks.map(f => f.domain)
      });
    }
  }

  // Check for credible source verification
  if (webVerification.credible_sources?.length > 0) {
    if (riskLevel !== 'CRITICAL' && riskLevel !== 'HIGH') {
      riskLevel = 'LOW';
    }
    warnings.push({
      type: 'CREDIBLE_SOURCE_MATCH',
      severity: 'INFO',
      message: 'Text found on credible news sources',
      sources: webVerification.credible_sources.map(s => s.domain)
    });
  }

  // No matches found
  if (webVerification.exact_matches?.length === 0 && 
      webVerification.partial_matches?.length === 0) {
    riskLevel = 'MEDIUM';
    action = 'VERIFY_ORIGINAL_SOURCE';
    warnings.push({
      type: 'NO_MATCHES',
      severity: 'MEDIUM',
      message: 'Text not found online - could be original, fabricated, or deleted',
      recommendation: 'Request original source from submitter'
    });
  }

  return {
    action: action,
    risk_level: riskLevel,
    warnings: warnings,
    summary: generateSummary(riskLevel, webVerification),
    total_matches: (webVerification.exact_matches?.length || 0) + 
                   (webVerification.partial_matches?.length || 0),
    fact_checks_found: webVerification.fact_checks?.length || 0,
    fraud_flags: webVerification.fraud_templates?.length || 0
  };
}

/**
 * Generate human-readable summary
 */
function generateSummary(riskLevel, webVerification) {
  if (riskLevel === 'CRITICAL') {
    return '🚨 CRITICAL: Text matches known fraud template - DO NOT USE';
  }
  if (riskLevel === 'HIGH') {
    return '⚠️ WARNING: Text flagged as FALSE by fact-checkers';
  }
  if (webVerification?.credible_sources?.length > 0) {
    return '✅ Text verified on credible news sources';
  }
  if (webVerification?.exact_matches?.length > 0) {
    return 'ℹ️ Text found online - review sources before publishing';
  }
  return '❓ Text not found online - verify with original source';
}

/**
 * Web search using SerpAPI (Google Search)
 * @param {string} query - Search query
 * @returns {Object} Search results
 */
async function serpApiWebSearch(query) {
  const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      error: 'SerpAPI not configured',
      results: []
    };
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: apiKey,
      num: 10,
      hl: 'en',
      gl: 'us'
    });

    const url = 'https://serpapi.com/search.json?' + params.toString();
    
    const response = await fetch(url, {
      method: 'GET',
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error('SerpAPI error: ' + response.status);
    }

    const data = await response.json();
    
    const results = (data.organic_results || []).map(r => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
      position: r.position
    }));

    return {
      success: true,
      results: results,
      total: results.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
}

module.exports = {
  extractText,
  searchTextOnline,
  analyzeScreenshotText,
  serpApiWebSearch,
  FACT_CHECK_DOMAINS,
  FRAUD_TEMPLATE_SITES,
  CREDIBLE_NEWS_DOMAINS
};
