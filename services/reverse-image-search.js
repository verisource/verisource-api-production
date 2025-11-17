/**
 * Unified Reverse Image Search Service
 * Combines results from TinEye, Bing, and other search engines
 * for comprehensive image verification
 */

const TinEyeService = require('./tineye-search');
const BingVisualSearchService = require('./bing-visual-search');
const GoogleReverseSearchService = require('./google-reverse-search');

class ReverseImageSearchService {
  constructor() {
    this.services = {
      tineye: TinEyeService,  // Already an instance, no 'new'
      bing: BingVisualSearchService,  // Already an instance, no 'new'
      google: new GoogleReverseSearchService()  // This one needs 'new'
    };
  }
  
  /**
   * Perform comprehensive reverse image search across all services
   * @param {Buffer} imageBuffer - The image file buffer
   * @param {Object} options - Search options
   * @returns {Object} Combined search results with analysis
   */
  async search(imageBuffer, options = {}) {
    const {
      services = ['tineye', 'google', 'bing'], // Which services to use
      timeout = 60000, // Total timeout for all searches
      includeAnalysis = true // Include combined analysis
    } = options;

    const startTime = Date.now();
    const results = {
      search_performed: true,
      timestamp: new Date().toISOString(),
      services_used: services,
      
      // Individual service results
      tineye: null,
      bing: null,
      google: null,
      
      // Combined analysis
      combined_analysis: null,
      
      // Summary
      summary: null,
      
      // Warnings and recommendations
      warnings: [],
      recommendation: null,
      
      // Performance
      performance: {
        total_time_ms: 0,
        services_timing: {}
      }
    };

    // Run searches in parallel
    const searchPromises = [];

    if (services.includes('tineye')) {
      const tineyeStart = Date.now();
      searchPromises.push(
        this.services.tineye.searchByImage(imageBuffer, options.tineye || {})
          .then(result => {
            results.tineye = result;
            results.performance.services_timing.tineye = Date.now() - tineyeStart;
          })
          .catch(error => {
            results.tineye = { status: 'error', error: error.message };
            results.performance.services_timing.tineye = Date.now() - tineyeStart;
          })
      );
    }

    if (services.includes('bing')) {
      const bingStart = Date.now();
      searchPromises.push(
        this.services.bing.searchByImage(imageBuffer, options.bing || {})
          .then(result => {
            results.bing = result;
            results.performance.services_timing.bing = Date.now() - bingStart;
          })
          .catch(error => {
            results.bing = { status: 'error', error: error.message };
            results.performance.services_timing.bing = Date.now() - bingStart;
          })
      );
    }

    if (services.includes('google')) {
      const googleStart = Date.now();
      searchPromises.push(
        this.services.google.search(imageBuffer, options.google || {})
          .then(result => {
            results.google = result;
            results.performance.services_timing.google = Date.now() - googleStart;
          })
          .catch(error => {
            results.google = { status: 'error', error: error.message };
            results.performance.services_timing.google = Date.now() - googleStart;
          })
      );
    }
    // Wait for all searches to complete
    await Promise.all(searchPromises);

    results.performance.total_time_ms = Date.now() - startTime;

    // Perform combined analysis
    if (includeAnalysis) {
      results.combined_analysis = this.analyzeResults(results);
      results.summary = this.generateSummary(results);
      results.warnings = this.generateWarnings(results);
      results.recommendation = this.generateRecommendation(results);
    }

    return results;
  }

  /**
   * Analyze and combine results from all services
   */
  analyzeResults(results) {
    const analysis = {
      is_original: true,
      confidence: 100,
      total_matches_found: 0,
      
      first_appearance: null,
      most_recent_appearance: null,
      
      likely_original_source: null,
      
      age_analysis: null,
      
      spread_analysis: {
        total_sites: 0,
        domain_types: {
          news_sites: 0,
          social_media: 0,
          stock_photo_sites: 0,
          blogs: 0,
          ecommerce: 0,
          other: 0
        }
      },
      
      content_type: 'unknown', // original, stock_photo, news_photo, viral_content, etc.
      
      modifications_detected: [],
      
      cross_reference_confidence: 0
    };

    // Aggregate total matches
    if (results.tineye && results.tineye.status === 'found') {
      analysis.total_matches_found += results.tineye.total_results || 0;
    }
    if (results.google && results.google.status === 'found') {
  analysis.total_matches_found += results.google.total_results || 0;
    }
    if (results.bing && results.bing.status === 'found') {
      analysis.total_matches_found += results.bing.total_results || 0;
    }

    // Determine if original
    if (analysis.total_matches_found > 0) {
      analysis.is_original = false;
      
      // Reduce confidence based on how many times found
      if (analysis.total_matches_found > 1000) {
        analysis.confidence = 10; // Highly circulated
      } else if (analysis.total_matches_found > 100) {
        analysis.confidence = 30;
      } else if (analysis.total_matches_found > 10) {
        analysis.confidence = 50;
      } else {
        analysis.confidence = 70;
      }
    }

    // Find earliest appearance (cross-reference both services)
    const appearances = [];
    
    if (results.tineye?.first_appearance) {
      appearances.push({
        source: 'tineye',
        ...results.tineye.first_appearance
      });
    }
    
    if (results.bing?.first_indexed) {
      appearances.push({
        source: 'bing',
        date: results.bing.first_indexed.date,
        source_url: results.bing.first_indexed.url,
        source_domain: results.bing.first_indexed.domain
      });
    }

    if (appearances.length > 0) {
      // Sort by date to find earliest
      appearances.sort((a, b) => new Date(a.date) - new Date(b.date));
      analysis.first_appearance = appearances[0];
      
      // Calculate age
      const firstDate = new Date(analysis.first_appearance.date);
      const now = new Date();
      const ageDays = Math.floor((now - firstDate) / (1000 * 60 * 60 * 24));
      
      analysis.age_analysis = {
        first_seen: analysis.first_appearance.date,
        age_days: ageDays,
        age_readable: this.formatAge(ageDays),
        is_old: ageDays > 30,
        is_very_old: ageDays > 365
      };
    }

    // Find most recent appearance
    const recentAppearances = [];
    
    if (results.tineye?.most_recent_appearance) {
      recentAppearances.push({
        source: 'tineye',
        ...results.tineye.most_recent_appearance
      });
    }
    
    if (results.bing?.most_recent) {
      recentAppearances.push({
        source: 'bing',
        date: results.bing.most_recent.date,
        source_url: results.bing.most_recent.url,
        source_domain: results.bing.most_recent.domain
      });
    }

    if (recentAppearances.length > 0) {
      recentAppearances.sort((a, b) => new Date(b.date) - new Date(a.date));
      analysis.most_recent_appearance = recentAppearances[0];
    }

    // Determine likely original source
    if (results.tineye?.first_appearance) {
      const domain = results.tineye.first_appearance.source_domain;
      const credibleSources = ['reuters.com', 'bbc.com', 'apnews.com', 'gettyimages.com', 'shutterstock.com', 'nytimes.com'];
      
      const isCredible = credibleSources.some(d => domain.includes(d));
      
      analysis.likely_original_source = {
        url: results.tineye.first_appearance.source_url,
        domain: domain,
        date: results.tineye.first_appearance.date,
        confidence: isCredible ? 95 : 75,
        is_credible_source: isCredible
      };
    }

    // Aggregate domain breakdown
    if (results.tineye?.domain_breakdown) {
      Object.keys(results.tineye.domain_breakdown).forEach(key => {
        if (analysis.spread_analysis.domain_types[key] !== undefined) {
          analysis.spread_analysis.domain_types[key] += results.tineye.domain_breakdown[key];
        }
      });
    }
    
    if (results.bing?.domain_breakdown) {
      Object.keys(results.bing.domain_breakdown).forEach(key => {
        if (analysis.spread_analysis.domain_types[key] !== undefined) {
          analysis.spread_analysis.domain_types[key] += results.bing.domain_breakdown[key];
        }
      });
    }

    analysis.spread_analysis.total_sites = Object.values(analysis.spread_analysis.domain_types).reduce((a, b) => a + b, 0);

    // Determine content type
    if (results.tineye?.is_stock_photo || results.bing?.domain_breakdown?.stock_photo_sites > 0) {
      analysis.content_type = 'stock_photo';
    } else if (results.bing?.product_matches?.is_product) {
      analysis.content_type = 'product_image';
    } else if (analysis.spread_analysis.domain_types.news_sites > analysis.spread_analysis.domain_types.social_media) {
      analysis.content_type = 'news_photo';
    } else if (analysis.total_matches_found > 500) {
      analysis.content_type = 'viral_content';
    } else if (analysis.total_matches_found > 0) {
      analysis.content_type = 'shared_content';
    } else {
      analysis.content_type = 'likely_original';
    }

    // Collect modifications
    if (results.tineye?.modifications_detected) {
      analysis.modifications_detected.push(...results.tineye.modifications_detected);
    }

    // Cross-reference confidence (if both services agree, higher confidence)
    if (results.tineye && results.bing) {
      const tineyeFound = results.tineye.status === 'found';
      const bingFound = results.bing.status === 'found';
      
      if (tineyeFound && bingFound) {
        analysis.cross_reference_confidence = 95;
      } else if (tineyeFound || bingFound) {
        analysis.cross_reference_confidence = 75;
      } else {
        analysis.cross_reference_confidence = 60;
      }
    }

    return analysis;
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(results) {
    const analysis = results.combined_analysis;
    
    if (!analysis) {
      return {
        headline: 'Search completed',
        description: 'Reverse image search completed but analysis not available.'
      };
    }

    if (analysis.is_original) {
      return {
        headline: '✅ LIKELY ORIGINAL - No matches found',
        description: 'This image was not found anywhere else online. It appears to be original or first-time upload.',
        match_count: 0,
        age: 'N/A',
        recommendation: 'Consider other verification factors (AI detection, metadata, etc.)'
      };
    }

    // Not original - provide details
    let headline = '';
    let description = '';
    
    if (analysis.content_type === 'stock_photo') {
      headline = '🖼️ STOCK PHOTO DETECTED';
      description = `This is a commercial stock photo found on stock image websites.`;
    } else if (analysis.content_type === 'product_image') {
      headline = '🛒 PRODUCT IMAGE';
      description = `This image is associated with commercial products.`;
    } else if (analysis.age_analysis?.is_very_old) {
      headline = '⚠️ OLD IMAGE - ' + analysis.age_analysis.age_readable.toUpperCase();
      description = `This image first appeared online ${analysis.age_analysis.age_readable} on ${analysis.likely_original_source?.domain || 'unknown source'}.`;
    } else if (analysis.total_matches_found > 500) {
      headline = '🔄 HIGHLY VIRAL CONTENT';
      description = `This image has been shared extensively across ${analysis.total_matches_found}+ websites.`;
    } else {
      headline = '⚠️ NOT ORIGINAL - Found ' + analysis.total_matches_found + ' times online';
      description = `This image has appeared on ${analysis.total_matches_found} websites.`;
    }

    return {
      headline: headline,
      description: description,
      match_count: analysis.total_matches_found,
      age: analysis.age_analysis?.age_readable || 'Unknown',
      first_source: analysis.likely_original_source?.domain || 'Unknown',
      content_type: analysis.content_type,
      recommendation: this.getShortRecommendation(analysis)
    };
  }

  /**
   * Generate warnings based on analysis
   */
  generateWarnings(results) {
    const warnings = [];
    const analysis = results.combined_analysis;

    if (!analysis) return warnings;

    // Old image warning
    if (analysis.age_analysis?.is_very_old) {
      warnings.push({
        type: 'OLD_IMAGE',
        severity: 'HIGH',
        message: `This image is ${analysis.age_analysis.age_readable}`,
        detail: `First appeared: ${analysis.first_appearance?.date || 'Unknown'}`,
        recommendation: 'DO NOT use as current event evidence'
      });
    } else if (analysis.age_analysis?.is_old) {
      warnings.push({
        type: 'AGED_IMAGE',
        severity: 'MEDIUM',
        message: `This image is ${analysis.age_analysis.age_readable}`,
        detail: `First appeared: ${analysis.first_appearance?.date || 'Unknown'}`,
        recommendation: 'Verify if context matches current use'
      });
    }

    // Stock photo warning
    if (analysis.content_type === 'stock_photo') {
      warnings.push({
        type: 'STOCK_PHOTO',
        severity: 'HIGH',
        message: 'This is a commercial stock photo',
        detail: 'Often used in fake profiles, testimonials, and scam websites',
        recommendation: 'Verify if usage is legitimate and properly licensed'
      });
    }

    // Viral content warning
    if (analysis.total_matches_found > 1000) {
      warnings.push({
        type: 'VIRAL_CONTENT',
        severity: 'MEDIUM',
        message: `Image found on ${analysis.total_matches_found}+ websites`,
        detail: 'Widely circulated content is often repurposed out of context',
        recommendation: 'Verify original context before using'
      });
    }

    // Modifications detected
    if (analysis.modifications_detected.length > 0) {
      analysis.modifications_detected.forEach(mod => {
        warnings.push({
          type: 'MODIFICATION_DETECTED',
          severity: 'MEDIUM',
          message: `Image modification detected: ${mod.type}`,
          detail: mod.description,
          recommendation: 'Compare with original source'
        });
      });
    }

    // Social media concentration
    if (analysis.spread_analysis.domain_types.social_media > analysis.spread_analysis.total_sites * 0.7) {
      warnings.push({
        type: 'SOCIAL_MEDIA_VIRAL',
        severity: 'MEDIUM',
        message: 'Image primarily spread through social media',
        detail: 'May indicate viral misinformation pattern',
        recommendation: 'Verify with primary news sources'
      });
    }

    return warnings;
  }

  /**
   * Generate overall recommendation
   */
  generateRecommendation(results) {
    const analysis = results.combined_analysis;
    const warnings = results.warnings;

    if (!analysis) {
      return {
        action: 'PROCEED_WITH_CAUTION',
        confidence: 50,
        reason: 'Unable to complete full analysis'
      };
    }

    // Original content - generally safe
    if (analysis.is_original) {
      return {
        action: 'LIKELY_SAFE',
        confidence: 75,
        reason: 'Image not found elsewhere online. Consider other verification factors.',
        caveats: [
          'Very recent images may not be indexed yet',
          'Verify with AI detection and metadata analysis'
        ]
      };
    }

    // High severity warnings
    const highSeverityWarnings = warnings.filter(w => w.severity === 'HIGH');
    
    if (highSeverityWarnings.length > 0) {
      if (analysis.age_analysis?.is_very_old) {
        return {
          action: 'DO_NOT_USE',
          confidence: 95,
          reason: `Image is ${analysis.age_analysis.age_readable} and being misrepresented`,
          original_source: analysis.likely_original_source?.url,
          caveats: [
            'Publishing this as current would spread misinformation'
          ]
        };
      }
      
      if (analysis.content_type === 'stock_photo') {
        return {
          action: 'VERIFY_LICENSING',
          confidence: 90,
          reason: 'Commercial stock photo - may be fraudulent if presented as original',
          original_source: analysis.likely_original_source?.url,
          caveats: [
            'Check if properly licensed',
            'Suspicious if used for testimonials or company photos'
          ]
        };
      }
    }

    // Medium severity - proceed with caution
    if (warnings.length > 0) {
      return {
        action: 'VERIFY_CONTEXT',
        confidence: 70,
        reason: 'Image found online - verify original context matches intended use',
        original_source: analysis.likely_original_source?.url,
        times_found: analysis.total_matches_found,
        caveats: warnings.map(w => w.message)
      };
    }

    // Found but no major concerns
    return {
      action: 'PROCEED_WITH_CAUTION',
      confidence: 65,
      reason: 'Image exists elsewhere online - verify attribution',
      original_source: analysis.likely_original_source?.url,
      times_found: analysis.total_matches_found
    };
  }

  /**
   * Get short recommendation text
   */
  getShortRecommendation(analysis) {
    if (analysis.is_original) {
      return 'Likely original - verify with other factors';
    }
    if (analysis.content_type === 'stock_photo') {
      return 'Stock photo - check licensing and context';
    }
    if (analysis.age_analysis?.is_very_old) {
      return 'Old image - do not use as current';
    }
    if (analysis.total_matches_found > 500) {
      return 'Viral content - verify original context';
    }
    return 'Found online - verify attribution';
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
   * Quick search - just check if image exists online
   * Returns simplified result for fast verification
   */
  async quickSearch(imageBuffer) {
    const results = await this.search(imageBuffer, {
      services: ['tineye', 'google', 'bing'], 
      includeAnalysis: true
    });

    return {
      found_online: !results.combined_analysis.is_original,
      match_count: results.combined_analysis.total_matches_found,
      age: results.combined_analysis.age_analysis?.age_readable || 'N/A',
      recommendation: results.recommendation?.action || 'UNKNOWN',
      first_source: results.combined_analysis.likely_original_source?.domain || null
    };
  }
}

module.exports = new ReverseImageSearchService();