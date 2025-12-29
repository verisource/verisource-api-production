/**
 * Video Reverse Search Service
 * Extracts key frames from videos and performs reverse image search
 * to find if the content has appeared online before
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const reverseImageSearch = require('./reverse-image-search');

class VideoReverseSearchService {
  
  /**
   * Extract key frames from video using scene detection for shorts
   * or fixed intervals for longer videos
   */
  async extractKeyFrames(videoPath, options = {}) {
    const {
      maxFrames = 5,
      duration = null,
      isShort = false
    } = options;
    
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-reverse-'));
    const frames = [];
    
    try {
      // Get video duration if not provided
      const videoDuration = duration || await this.getVideoDuration(videoPath);
      const isShortVideo = isShort || videoDuration <= 60;
      
      if (isShortVideo) {
        // For shorts: use scene detection to catch different clips
        await this.extractSceneFrames(videoPath, tempDir, maxFrames);
      } else {
        // For longer videos: fixed intervals
        await this.extractIntervalFrames(videoPath, tempDir, videoDuration, maxFrames);
      }
      
      // Read extracted frames
      const frameFiles = fs.readdirSync(tempDir)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .slice(0, maxFrames);
      
      for (const file of frameFiles) {
        const framePath = path.join(tempDir, file);
        const buffer = await sharp(framePath)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        
        frames.push({
          filename: file,
          buffer,
          timestamp: this.parseTimestampFromFilename(file)
        });
      }
      
      return { success: true, frames, tempDir };
      
    } catch (err) {
      // Cleanup on error
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
      return { success: false, error: err.message, frames: [], tempDir: null };
    }
  }
  
  /**
   * Extract frames at scene changes (for shorts/compilations)
   */
  async extractSceneFrames(videoPath, outputDir, maxFrames) {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          '-vf', `select='gt(scene,0.3)',showinfo`,
          '-vsync', 'vfr',
          '-q:v', '2',
          '-frames:v', String(maxFrames)
        ])
        .output(path.join(outputDir, 'scene-%03d.jpg'))
        .on('end', resolve)
        .on('error', (err) => {
          // Fallback to interval extraction if scene detection fails
          console.log('Scene detection failed, using interval extraction');
          this.extractIntervalFrames(videoPath, outputDir, null, maxFrames)
            .then(resolve)
            .catch(reject);
        })
        .run();
    });
  }
  
  /**
   * Extract frames at fixed intervals (for longer videos)
   */
  async extractIntervalFrames(videoPath, outputDir, duration, maxFrames) {
    const videoDuration = duration || await this.getVideoDuration(videoPath);
    const intervals = [];
    
    // Calculate timestamps at 10%, 30%, 50%, 70%, 90%
    const percentages = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (let i = 0; i < Math.min(maxFrames, percentages.length); i++) {
      intervals.push(videoDuration * percentages[i]);
    }
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          '-vf', `fps=1/${Math.ceil(videoDuration / maxFrames)}`,
          '-q:v', '2',
          '-frames:v', String(maxFrames)
        ])
        .output(path.join(outputDir, 'interval-%03d.jpg'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }
  
  /**
   * Get video duration in seconds
   */
  getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration || 30);
      });
    });
  }
  
  /**
   * Parse timestamp from filename
   */
  parseTimestampFromFilename(filename) {
    const match = filename.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
  
  /**
   * Main method: Search for video content online
   */
  async searchVideo(videoPath, options = {}) {
    const {
      maxFrames = 5,
      duration = null,
      platform = null,
      includeServices = ['tineye']
    } = options;
    
    const startTime = Date.now();
    const isShort = platform?.toLowerCase().includes('short') || 
                   platform?.toLowerCase().includes('tiktok') ||
                   platform?.toLowerCase().includes('reel') ||
                   (duration && duration <= 60);
    
    console.log(`🔍 Starting video reverse search (${isShort ? 'short' : 'standard'} mode)...`);
    
    // Step 1: Extract key frames
    const extraction = await this.extractKeyFrames(videoPath, {
      maxFrames,
      duration,
      isShort
    });
    
    if (!extraction.success) {
      return {
        success: false,
        error: extraction.error,
        matches_found: 0
      };
    }
    
    console.log(`   Extracted ${extraction.frames.length} key frames`);
    
    // Step 2: Run reverse search on ALL frames in PARALLEL
    console.log(`   Searching ${extraction.frames.length} frames in parallel...`);
    
    const searchPromises = extraction.frames.map((frame, i) => {
     return reverseImageSearch.search(frame.buffer, {
        services: includeServices
      }).then(searchResult => {
        return { index: i, frame, searchResult, error: null };
      }).catch(err => {
        return { index: i, frame, searchResult: null, error: err.message };
      });
    });
    
    const searchResults = await Promise.all(searchPromises);
    
    // Process results
    const frameResults = [];
    let totalMatches = 0;
    let earliestDate = null;
    const allSources = [];
    
    for (const result of searchResults) {
      const { index, frame, searchResult, error } = result;
      
      if (error) {
        console.log(`   Frame ${index + 1} search error: ${error}`);
        frameResults.push({
          frame: index + 1,
          timestamp: frame.timestamp,
          matches: 0,
          error
        });
        continue;
      }
      
      const frameMatches = this.extractMatches(searchResult);
      
      frameResults.push({
        frame: index + 1,
        timestamp: frame.timestamp,
        matches: frameMatches.length,
        sources: frameMatches.slice(0, 5)
      });
      
      totalMatches += frameMatches.length;
      
      for (const match of frameMatches) {
        if (match.date) {
          const matchDate = new Date(match.date);
          if (!earliestDate || matchDate < earliestDate) {
            earliestDate = matchDate;
          }
        }
        allSources.push(match);
      }
    }
    
    console.log(`   Parallel search complete: ${totalMatches} matches found`); 
    // Cleanup temp files
    if (extraction.tempDir) {
      try { fs.rmSync(extraction.tempDir, { recursive: true, force: true }); } catch(e) {}
    }
    
    // Step 3: Analyze and deduplicate results
    const analysis = this.analyzeResults(frameResults, allSources, earliestDate);
    
    const elapsed = Date.now() - startTime;
    console.log(`   Search complete: ${totalMatches} matches found in ${elapsed}ms`);
    
    return {
      success: true,
      frames_analyzed: extraction.frames.length,
      matches_found: totalMatches,
      unique_sources: analysis.uniqueSources.length,
      earliest_appearance: earliestDate ? earliestDate.toISOString().split('T')[0] : null,
      verdict: analysis.verdict,
      confidence: analysis.confidence,
      frame_results: frameResults,
      top_sources: analysis.uniqueSources.slice(0, 10),
      platforms_found: analysis.platforms,
      search_time_ms: elapsed
    };
  }
  
  /**
   * Extract match information from search results
   */
  extractMatches(searchResult) {
    const matches = [];
    
   // TinEye matches
    if (searchResult.tineye?.top_matches) {
      for (const match of searchResult.tineye.top_matches) {
        matches.push({
          source: 'tineye',
          url: match.url || null,
          domain: match.domain || null,
          date: match.crawl_date || null,
          title: null
        });
      }
    }
    
    // Bing matches
    if (searchResult.bing?.similar_images) {
      for (const match of searchResult.bing.similar_images) {
        matches.push({
          source: 'bing',
          url: match.hostPageUrl || match.contentUrl,
          domain: this.extractDomain(match.hostPageUrl),
          date: match.datePublished,
          title: match.name
        });
      }
    }
    
    // Google matches
    if (searchResult.google?.web_entities) {
      for (const match of searchResult.google.pages_with_matching_images || []) {
        matches.push({
          source: 'google',
          url: match.url,
          domain: this.extractDomain(match.url),
          date: null, // Google doesn't always provide dates
          title: match.pageTitle
        });
      }
    }
    
    return matches;
  }
  
  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return null;
    }
  }
  
  /**
   * Analyze aggregated results
   */
  analyzeResults(frameResults, allSources, earliestDate) {
    // Deduplicate by domain
    const domainMap = new Map();
    for (const source of allSources) {
      const key = source.domain || source.url;
      if (key && !domainMap.has(key)) {
        domainMap.set(key, source);
      }
    }
    const uniqueSources = Array.from(domainMap.values());
    
    // Identify platforms
    const platforms = new Set();
    for (const source of uniqueSources) {
      const domain = source.domain?.toLowerCase() || '';
      if (domain.includes('tiktok')) platforms.add('TikTok');
      if (domain.includes('youtube')) platforms.add('YouTube');
      if (domain.includes('instagram')) platforms.add('Instagram');
      if (domain.includes('twitter') || domain.includes('x.com')) platforms.add('Twitter/X');
      if (domain.includes('facebook')) platforms.add('Facebook');
      if (domain.includes('reddit')) platforms.add('Reddit');
      if (domain.includes('shutterstock') || domain.includes('getty') || domain.includes('stock')) platforms.add('Stock Footage');
    }
    
    // Determine verdict
    let verdict = 'NO_MATCHES_FOUND';
    let confidence = 50; // Neutral - no matches doesn't mean original
    
    if (uniqueSources.length > 0) {
      if (uniqueSources.length >= 10) {
        verdict = 'WIDELY_DISTRIBUTED';
        confidence = 20; // Low authenticity - content is everywhere
      } else if (platforms.has('Stock Footage')) {
        verdict = 'STOCK_FOOTAGE_DETECTED';
        confidence = 15;
      } else if (earliestDate) {
        const daysSinceFirst = Math.floor((Date.now() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceFirst > 30) {
          verdict = 'PRE_EXISTING_CONTENT';
          confidence = 25;
        } else {
          verdict = 'RECENT_MATCHES';
          confidence = 60;
        }
      } else {
        verdict = 'MATCHES_FOUND';
        confidence = 40;
      }
    }
    
    return {
      uniqueSources,
      platforms: Array.from(platforms),
      verdict,
      confidence
    };
  }
}

module.exports = new VideoReverseSearchService();