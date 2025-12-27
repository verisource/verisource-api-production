/**
 * TV Corroboration Service - Phase 1
 * Searches broadcast news archives via GDELT API to corroborate events
 * 
 * Features:
 * - Search GDELT TV API for related broadcast coverage
 * - Event classification (determines search weight)
 * - Basic confidence adjustment
 * - Graceful degradation on API failure
 * 
 * Cost: FREE (GDELT is a public research API)
 * Rate limits: None published, but be respectful
 */

const fetch = require('node-fetch');

class TVCorroboration {
  constructor() {
    this.baseUrl = 'https://api.gdeltproject.org/api/v2/tv/tv';
    this.timeout = 15000; // 15 second timeout
    this.maxRetries = 2;
  }

  /**
   * Main entry point - search for broadcast corroboration
   * @param {Object} submission - Verification submission data
   * @returns {Object} Corroboration results
   */
  async search(submission) {
    const startTime = Date.now();
    
    const result = {
      searched: false,
      found: false,
      resultCount: 0,
      clips: [],
      adjustment: 0,
      confidence: 'none',
      eventClass: null,
      query: null,
      searchTime: 0,
      error: null,
      disclaimer: 'Broadcast coverage confirms media reported on a similar event. This does not independently verify the submitted content originated from this event.'
    };

    try {
      // Step 1: Classify the event type
      result.eventClass = this.classifyEvent(submission);
      
      // Skip search if not applicable
      if (result.eventClass === 'NOT_APPLICABLE') {
        result.note = 'Content type not suitable for broadcast corroboration';
        return result;
      }

      // Step 2: Build search query
      const query = this.buildQuery(submission);
      result.query = query;

      if (!query || query.trim().length < 3) {
        result.note = 'Insufficient context to search broadcast archives';
        return result;
      }

      // Step 3: Determine date range
      const dateRange = this.getDateRange(submission);

      // Step 4: Execute search
      const searchResult = await this.executeSearch(query, dateRange);
      result.searched = true;
      
      if (searchResult.clips && searchResult.clips.length > 0) {
        result.found = true;
        result.resultCount = searchResult.clips.length;
        result.clips = this.processClips(searchResult.clips, submission);
        
        // Step 5: Calculate confidence adjustment
        const scoring = this.calculateAdjustment(result.clips, result.eventClass);
        result.adjustment = scoring.adjustment;
        result.confidence = scoring.confidence;
        result.matchQuality = scoring.matchQuality;
      } else {
        // No results - determine if absence is meaningful
        result.note = this.getNoResultsNote(result.eventClass);
      }

    } catch (error) {
      result.error = error.message;
      result.note = 'Broadcast archive search temporarily unavailable';
      console.error('TV Corroboration error:', error.message);
    }

    result.searchTime = Date.now() - startTime;
    return result;
  }

  /**
   * Classify the event to determine search weight
   */
  classifyEvent(submission) {
    const text = this.extractSearchableText(submission).toLowerCase();
    
    // High newsworthiness - absence is significant
    const certainCoverage = [
      'plane crash', 'aircraft', 'building collapse', 'mass shooting',
      'hurricane', 'tornado', 'earthquake', 'tsunami', 'wildfire',
      'terrorist', 'terrorism', 'explosion', 'bombing',
      'assassination', 'coup', 'invasion', 'military strike',
      'hostage', 'mass casualty', 'bridge collapse'
    ];
    
    for (const term of certainCoverage) {
      if (text.includes(term)) {
        return 'CERTAIN_COVERAGE';
      }
    }
    
    // Medium newsworthiness
    const probableCoverage = [
      'fire', 'accident', 'crash', 'shooting', 'flood',
      'protest', 'demonstration', 'riot', 'evacuation',
      'rescue', 'hostage', 'police', 'arrest',
      'storm', 'disaster', 'emergency', 'strike',
      'military', 'navy', 'army', 'coast guard'
    ];
    
    for (const term of probableCoverage) {
      if (text.includes(term)) {
        return 'PROBABLE_COVERAGE';
      }
    }
    
    // Content types where TV search doesn't apply
    const notApplicable = [
      'screenshot', 'document', 'selfie', 'portrait',
      'product', 'artwork', 'meme', 'graphic', 'logo',
      'receipt', 'invoice', 'form', 'certificate'
    ];
    
    for (const term of notApplicable) {
      if (text.includes(term)) {
        return 'NOT_APPLICABLE';
      }
    }
    
    // Default - coverage unlikely
    return 'UNLIKELY_COVERAGE';
  }

  /**
   * Build search query from submission data
   */
  buildQuery(submission) {
    const terms = [];
    
    // Extract location
    if (submission.location) {
      terms.push(submission.location);
    } else if (submission.metadata?.gps?.location) {
      terms.push(submission.metadata.gps.location);
    } else if (submission.claimedLocation) {
      terms.push(submission.claimedLocation);
    }
    
    // Extract event type / description
    if (submission.eventType) {
      terms.push(submission.eventType);
    }
    
    if (submission.description) {
      // Extract key nouns from description
      const keywords = this.extractKeywords(submission.description);
      terms.push(...keywords.slice(0, 3));
    }
    
    // Use detected labels from image analysis
    if (submission.visualLabels && Array.isArray(submission.visualLabels)) {
      const relevantLabels = submission.visualLabels.filter(label => 
        this.isNewsworthy(label)
      );
      terms.push(...relevantLabels.slice(0, 2));
    }
    
    // Deduplicate and join
    const uniqueTerms = [...new Set(terms.filter(t => t && t.length > 2))];
    return uniqueTerms.join(' ');
  }

  /**
   * Extract keywords from text
   */
  extractKeywords(text) {
    if (!text) return [];
    
    // Simple keyword extraction - remove common words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 'just', 'can', 'now', 'also', 'into', 'over', 'after'
    ]);
    
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    // Return unique words, prioritizing longer ones
    return [...new Set(words)].sort((a, b) => b.length - a.length);
  }

  /**
   * Check if a label is newsworthy
   */
  isNewsworthy(label) {
    const newsworthyLabels = [
      'fire', 'smoke', 'explosion', 'flood', 'storm', 'tornado',
      'police', 'military', 'ambulance', 'helicopter', 'aircraft',
      'crash', 'accident', 'protest', 'crowd', 'riot', 'emergency',
      'rescue', 'disaster', 'damage', 'destruction', 'weapon'
    ];
    
    const lowerLabel = label.toLowerCase();
    return newsworthyLabels.some(nw => lowerLabel.includes(nw));
  }

  /**
   * Get date range for search
   */
  getDateRange(submission) {
    let referenceDate;
    
    // Try to get date from submission
    if (submission.claimedDate) {
      referenceDate = new Date(submission.claimedDate);
    } else if (submission.metadata?.exif?.DateTimeOriginal) {
      referenceDate = new Date(submission.metadata.exif.DateTimeOriginal);
    } else {
      // Default to recent (last 7 days)
      referenceDate = new Date();
    }
    
    // Search 3 days before to 7 days after reference date
    const startDate = new Date(referenceDate);
    startDate.setDate(startDate.getDate() - 3);
    
    const endDate = new Date(referenceDate);
    endDate.setDate(endDate.getDate() + 7);
    
    // Don't search future dates
    const now = new Date();
    if (endDate > now) {
      endDate.setTime(now.getTime());
    }
    
    return {
      start: this.formatGDELTDate(startDate),
      end: this.formatGDELTDate(endDate)
    };
  }

  /**
   * Format date for GDELT API (YYYYMMDDHHmmss)
   */
  formatGDELTDate(date) {
    return date.toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
  }

  /**
   * Execute search against GDELT TV API
   */
  async executeSearch(query, dateRange, retryCount = 0) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('query', `${query} market:"National"`);
    url.searchParams.set('mode', 'clipgallery');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', '25');
    url.searchParams.set('STARTDATETIME', dateRange.start);
    url.searchParams.set('ENDDATETIME', dateRange.end);
    
    console.log(`📺 TV Corroboration search: ${query}`);
    console.log(`   Date range: ${dateRange.start} to ${dateRange.end}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VeriSource/1.0 (Media Verification Platform)'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`GDELT API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // GDELT returns clips in various formats depending on mode
      let clips = [];
      if (Array.isArray(data)) {
        clips = data;
      } else if (data.clips) {
        clips = data.clips;
      } else if (data.articles) {
        clips = data.articles;
      }
      
      console.log(`   Found ${clips.length} broadcast clips`);
      
      return { clips };
      
    } catch (error) {
      if (error.name === 'AbortError') {
        error.message = 'GDELT API timeout';
      }
      
      if (retryCount < this.maxRetries) {
        console.log(`   Retry ${retryCount + 1}/${this.maxRetries}...`);
        await this.delay(1000 * (retryCount + 1));
        return this.executeSearch(query, dateRange, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Process and normalize clips from GDELT
   */
  processClips(clips, submission) {
    return clips.slice(0, 10).map(clip => {
      // GDELT clip structure varies - normalize it
      const processed = {
        station: clip.station || clip.source || 'Unknown',
        show: clip.show || clip.title || 'Unknown',
        date: clip.date || clip.airdate || clip.published,
        snippet: clip.snippet || clip.text || clip.description || '',
        url: clip.url || clip.show_url || clip.ia_show_url || null,
        thumbnail: clip.preview_thumb || clip.thumbnail || null
      };
      
      // Calculate relevance score for this clip
      processed.relevance = this.calculateRelevance(processed, submission);
      
      return processed;
    }).sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Calculate relevance score for a clip
   */
  calculateRelevance(clip, submission) {
    let score = 50; // Base score
    
    const searchText = this.extractSearchableText(submission).toLowerCase();
    const clipText = (clip.snippet + ' ' + clip.show).toLowerCase();
    
    // Check for keyword matches
    const keywords = this.extractKeywords(searchText);
    for (const keyword of keywords.slice(0, 5)) {
      if (clipText.includes(keyword)) {
        score += 10;
      }
    }
    
    // Check temporal proximity if we have dates
    if (submission.claimedDate && clip.date) {
      const claimedDate = new Date(submission.claimedDate);
      const clipDate = new Date(clip.date);
      const daysDiff = Math.abs((claimedDate - clipDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === 0) score += 20;
      else if (daysDiff <= 1) score += 15;
      else if (daysDiff <= 3) score += 10;
      else if (daysDiff <= 7) score += 5;
    }
    
    // Boost for major networks
    const majorNetworks = ['CNN', 'MSNBC', 'FOXNEWS', 'ABC', 'CBS', 'NBC', 'BBC', 'CSPAN'];
    if (majorNetworks.some(net => clip.station?.toUpperCase().includes(net))) {
      score += 10;
    }
    
    return Math.min(100, score);
  }

  /**
   * Calculate confidence adjustment based on results
   */
  calculateAdjustment(clips, eventClass) {
    if (!clips || clips.length === 0) {
      return { adjustment: 0, confidence: 'none', matchQuality: 'none' };
    }
    
    const bestMatch = clips[0];
    const matchCount = clips.length;
    
    // Determine match quality
    let matchQuality = 'weak';
    if (bestMatch.relevance >= 80) matchQuality = 'strong';
    else if (bestMatch.relevance >= 60) matchQuality = 'moderate';
    
    // Calculate adjustment based on event class and match quality
    const adjustmentMatrix = {
      'CERTAIN_COVERAGE': { strong: 15, moderate: 10, weak: 5 },
      'PROBABLE_COVERAGE': { strong: 12, moderate: 8, weak: 4 },
      'UNLIKELY_COVERAGE': { strong: 8, moderate: 5, weak: 2 }
    };
    
    const classAdjustments = adjustmentMatrix[eventClass] || adjustmentMatrix['UNLIKELY_COVERAGE'];
    let adjustment = classAdjustments[matchQuality];
    
    // Bonus for multiple corroborating sources
    if (matchCount >= 5) adjustment += 3;
    else if (matchCount >= 3) adjustment += 2;
    else if (matchCount >= 2) adjustment += 1;
    
    // Determine confidence level
    let confidence = 'low';
    if (matchQuality === 'strong' && matchCount >= 3) confidence = 'high';
    else if (matchQuality !== 'weak' && matchCount >= 2) confidence = 'medium';
    
    return {
      adjustment: Math.min(20, adjustment), // Cap at 20 points
      confidence,
      matchQuality,
      matchCount,
      bestMatchRelevance: bestMatch.relevance
    };
  }

  /**
   * Get note for when no results are found
   */
  getNoResultsNote(eventClass) {
    switch (eventClass) {
      case 'CERTAIN_COVERAGE':
        return 'No broadcast coverage found. For this event type, absence of coverage may warrant further investigation.';
      case 'PROBABLE_COVERAGE':
        return 'No broadcast coverage found. This may indicate a local event not picked up by monitored stations.';
      case 'UNLIKELY_COVERAGE':
        return 'No broadcast coverage found. This is expected for this type of content.';
      default:
        return 'No broadcast coverage found.';
    }
  }

  /**
   * Extract all searchable text from submission
   */
  extractSearchableText(submission) {
    const parts = [];
    
    if (submission.description) parts.push(submission.description);
    if (submission.location) parts.push(submission.location);
    if (submission.claimedLocation) parts.push(submission.claimedLocation);
    if (submission.eventType) parts.push(submission.eventType);
    if (submission.title) parts.push(submission.title);
    
    // Include detected labels
    if (submission.visualLabels && Array.isArray(submission.visualLabels)) {
      parts.push(...submission.visualLabels);
    }
    
    // Include OCR text if available
    if (submission.ocrText) parts.push(submission.ocrText);
    
    return parts.join(' ');
  }

  /**
   * Delay helper for retries
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new TVCorroboration();