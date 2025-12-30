/**
 * Provenance Timeline Builder
 * Generates a unified chronological timeline from all verification signals
 * 
 * Combines: EXIF, blockchain, news coverage, reverse search, platform detection
 */

/**
 * Build a complete provenance timeline from verification data
 * @param {Object} data - All verification results
 * @returns {Object} Provenance timeline with events, span, anomalies, summary
 */
function buildProvenanceTimeline(data) {
  const timeline = [];
  
  // 1. EXIF/Camera date
  if (data.exif?.date_taken) {
    timeline.push({
      type: 'EXIF_CREATED',
      timestamp: normalizeTimestamp(data.exif.date_taken),
      icon: '📷',
      label: 'Photo/Video Created',
      source: data.exif.camera_make && data.exif.camera_model 
        ? `${data.exif.camera_make} ${data.exif.camera_model}`.trim()
        : 'Camera metadata',
      details: data.exif.gps 
        ? `GPS: ${data.exif.gps.latitude?.toFixed(4)}, ${data.exif.gps.longitude?.toFixed(4)}`
        : null,
      url: null,
      relevance: null
    });
  }
  
  // 2. Platform first posted (if detected)
  if (data.platform_detection?.detected) {
    const platformDate = data.platform_detection.estimated_upload_date || 
                         data.platform_detection.detected_at;
    if (platformDate) {
      timeline.push({
        type: 'PLATFORM_POSTED',
        timestamp: normalizeTimestamp(platformDate),
        icon: '📱',
        label: 'Posted to Platform',
        source: data.platform_detection.platform || 'Social Media',
        details: data.platform_detection.username 
          ? `@${data.platform_detection.username}`
          : null,
        url: data.platform_detection.url || null,
        relevance: null
      });
    }
  }
  
  // 3. News coverage events (top 5 by relevance)
  if (data.tv_corroboration?.clips?.length > 0) {
    const newsClips = data.tv_corroboration.clips
      .slice(0, 5)
      .map(clip => ({
        type: 'NEWS_COVERAGE',
        timestamp: parseGDELTDate(clip.date),
        icon: '📰',
        label: 'News Coverage',
        source: clip.source || 'Unknown',
        details: clip.title || null,
        url: clip.url || null,
        relevance: clip.relevance || null
      }))
      .filter(event => event.timestamp); // Only include if we have a valid date
    
    timeline.push(...newsClips);
  }
  
  // 4. Reverse image search results (earliest matches)
  if (data.reverse_image_search?.results?.length > 0) {
    const searchResults = data.reverse_image_search.results
      .filter(r => r.crawl_date || r.date || r.backlinks?.[0]?.crawl_date)
      .slice(0, 3)
      .map(result => ({
        type: 'ONLINE_MATCH',
        timestamp: normalizeTimestamp(
          result.crawl_date || result.date || result.backlinks?.[0]?.crawl_date
        ),
        icon: '🔍',
        label: 'Found Online',
        source: result.domain || extractDomain(result.url) || 'Web',
        details: result.title || null,
        url: result.url || null,
        relevance: null
      }))
      .filter(event => event.timestamp);
    
    timeline.push(...searchResults);
  }
  
  // 4.5. Landmark detections from video frames
  if (data.reverse_search?.landmarks?.length > 0) {
    const landmarkEvents = data.reverse_search.landmarks
      .map(landmark => ({
        type: 'LANDMARK_DETECTED',
        timestamp: data.verified_at || new Date().toISOString(),
        icon: '📍',
        label: 'Landmark Detected',
        source: landmark.name,
        details: landmark.location?.lat && landmark.location?.lng
          ? `${landmark.location.lat.toFixed(3)}, ${landmark.location.lng.toFixed(3)} • ${Math.round(landmark.confidence * 100)}% match`
          : `Frame ${landmark.frame} • ${Math.round(landmark.confidence * 100)}% match`,
        url: null,
        relevance: landmark.confidence
      }));
    
    // Deduplicate by landmark name (keep highest confidence)
    const uniqueLandmarks = [];
    const seenNames = new Set();
    landmarkEvents
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .forEach(event => {
        if (!seenNames.has(event.source)) {
          seenNames.add(event.source);
          uniqueLandmarks.push(event);
        }
      });
    
    timeline.push(...uniqueLandmarks.slice(0, 5)); // Top 5 unique landmarks
  }
  // 5. First verification (if previously seen)
  if (data.verification?.status === 'PREVIOUSLY_VERIFIED' && data.verification?.first_seen) {
    timeline.push({
      type: 'FIRST_VERIFIED',
      timestamp: normalizeTimestamp(data.verification.first_seen),
      icon: '✓',
      label: 'First Verified',
      source: 'VeriSource',
      details: data.verification.times_verified 
        ? `Verified ${data.verification.times_verified} times total`
        : null,
      url: null,
      relevance: null
    });
  }
  
  // 6. Blockchain timestamps
  if (data.blockchain_verification?.submitted_at || data.blockchain_verification?.timestamp) {
    const btcTimestamp = data.blockchain_verification.submitted_at || 
                         data.blockchain_verification.timestamp;
    if (btcTimestamp) {
      timeline.push({
        type: 'BLOCKCHAIN_BITCOIN',
        timestamp: normalizeTimestamp(btcTimestamp),
        icon: '₿',
        label: 'Bitcoin Timestamp',
        source: 'OpenTimestamps',
        details: data.blockchain_verification.status || 'Anchored to Bitcoin blockchain',
        url: null,
        relevance: null
      });
    }
  }
  
  if (data.polygon_verification?.timestamp) {
    timeline.push({
      type: 'BLOCKCHAIN_POLYGON',
      timestamp: normalizeTimestamp(data.polygon_verification.timestamp),
      icon: '🔷',
      label: 'Polygon Timestamp',
      source: 'Polygon Network',
      details: data.polygon_verification.block_number 
        ? `Block #${data.polygon_verification.block_number}`
        : null,
      url: data.polygon_verification.transaction_hash 
        ? `https://polygonscan.com/tx/${data.polygon_verification.transaction_hash}`
        : null,
      relevance: null
    });
  }
  
  // 7. Current submission
  if (data.verified_at) {
    timeline.push({
      type: 'SUBMISSION',
      timestamp: normalizeTimestamp(data.verified_at),
      icon: '📤',
      label: 'Submitted for Verification',
      source: 'VeriSource',
      details: data.verification?.status === 'PREVIOUSLY_VERIFIED' 
        ? 'Re-verification' 
        : 'First submission',
      url: null,
      relevance: null
    });
  }
  
  // Sort chronologically (oldest first)
  timeline.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
  });
  
  // Detect anomalies
  const anomalies = detectTimelineAnomalies(timeline, data);
  
  // Calculate time span
  const span = calculateTimeSpan(timeline);
  
  // Generate summary
  const summary = generateTimelineSummary(timeline, anomalies, data);
  
  return {
    events: timeline,
    span: span,
    anomalies: anomalies,
    summary: summary
  };
}

/**
 * Parse GDELT date format: "20251226T180000Z" → ISO string
 */
function parseGDELTDate(dateStr) {
  if (!dateStr) return null;
  
  // Already ISO format
  if (dateStr.includes('-')) {
    return normalizeTimestamp(dateStr);
  }
  
  // Parse "20251226T180000Z" format
  const match = dateStr.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  }
  
  return null;
}

/**
 * Normalize various timestamp formats to ISO string
 */
function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;
  
  // Already a valid ISO string
  if (typeof timestamp === 'string' && timestamp.includes('T')) {
    return timestamp;
  }
  
  // Unix timestamp (seconds)
  if (typeof timestamp === 'number') {
    // If it's in seconds (before year 2100 in ms)
    if (timestamp < 4102444800) {
      return new Date(timestamp * 1000).toISOString();
    }
    return new Date(timestamp).toISOString();
  }
  
  // Try parsing as date string
  try {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (e) {
    // Fall through
  }
  
  return null;
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch (e) {
    return null;
  }
}

/**
 * Detect timeline anomalies
 */
function detectTimelineAnomalies(timeline, data) {
  const anomalies = [];
  
  const exifEvent = timeline.find(e => e.type === 'EXIF_CREATED');
  const newsEvents = timeline.filter(e => e.type === 'NEWS_COVERAGE');
  const submissionEvent = timeline.find(e => e.type === 'SUBMISSION');
  const firstVerified = timeline.find(e => e.type === 'FIRST_VERIFIED');
  
  // 1. Recycled content: news coverage significantly before claimed EXIF date
  if (exifEvent && newsEvents.length > 0) {
    const exifDate = new Date(exifEvent.timestamp);
    
    for (const news of newsEvents) {
      const newsDate = new Date(news.timestamp);
      const daysDiff = Math.floor((exifDate - newsDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 30) {
        anomalies.push({
          type: 'RECYCLED_CONTENT',
          severity: 'high',
          message: `News reported similar event ${daysDiff} days before camera date — possible recycled content`,
          events: [news.timestamp, exifEvent.timestamp]
        });
        break; // Only report once
      }
    }
  }
  
  // 2. Future-dated EXIF (camera date after submission)
  if (exifEvent && submissionEvent) {
    const exifDate = new Date(exifEvent.timestamp);
    const submitDate = new Date(submissionEvent.timestamp);
    
    if (exifDate > submitDate) {
      const hoursDiff = Math.floor((exifDate - submitDate) / (1000 * 60 * 60));
      anomalies.push({
        type: 'FUTURE_DATED',
        severity: 'medium',
        message: `Camera metadata shows date ${hoursDiff} hours after submission — clock may be incorrect`,
        events: [submissionEvent.timestamp, exifEvent.timestamp]
      });
    }
  }
  
  // 3. Content existed before EXIF date (online match predates camera)
  if (exifEvent) {
    const exifDate = new Date(exifEvent.timestamp);
    const onlineMatches = timeline.filter(e => e.type === 'ONLINE_MATCH');
    
    for (const match of onlineMatches) {
      const matchDate = new Date(match.timestamp);
      const daysDiff = Math.floor((exifDate - matchDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 7) {
        anomalies.push({
          type: 'PREDATES_EXIF',
          severity: 'high',
          message: `Image found online ${daysDiff} days before camera date — metadata may be manipulated`,
          events: [match.timestamp, exifEvent.timestamp]
        });
        break;
      }
    }
  }
  
  // 4. Rapid news coverage (content verified very close to news)
  if (newsEvents.length > 0 && (submissionEvent || firstVerified)) {
    const referenceEvent = firstVerified || submissionEvent;
    const referenceDate = new Date(referenceEvent.timestamp);
    const earliestNews = new Date(newsEvents[0].timestamp);
    
    const hoursDiff = Math.abs((referenceDate - earliestNews) / (1000 * 60 * 60));
    
    if (hoursDiff < 2) {
      anomalies.push({
        type: 'RAPID_SPREAD',
        severity: 'info',
        message: 'Content verified within 2 hours of news coverage — likely breaking news',
        events: [newsEvents[0].timestamp, referenceEvent.timestamp]
      });
    }
  }
  
  // 5. Large time gap between creation and first verification
  if (exifEvent && (firstVerified || submissionEvent)) {
    const referenceEvent = firstVerified || submissionEvent;
    const exifDate = new Date(exifEvent.timestamp);
    const verifyDate = new Date(referenceEvent.timestamp);
    
    const daysDiff = Math.floor((verifyDate - exifDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 365) {
      anomalies.push({
        type: 'OLD_CONTENT',
        severity: 'info',
        message: `Content is ${Math.floor(daysDiff / 30)} months old based on camera date`,
        events: [exifEvent.timestamp, referenceEvent.timestamp]
      });
    }
  }
  
  return anomalies;
}

/**
 * Calculate time span of timeline
 */
function calculateTimeSpan(timeline) {
  if (timeline.length < 2) {
    return null;
  }
  
  const timestamps = timeline
    .map(e => new Date(e.timestamp))
    .filter(d => !isNaN(d.getTime()));
  
  if (timestamps.length < 2) {
    return null;
  }
  
  const earliest = new Date(Math.min(...timestamps));
  const latest = new Date(Math.max(...timestamps));
  const diffMs = latest - earliest;
  
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  
  let label;
  if (days > 0) {
    label = `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    label = `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    label = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  
  return {
    earliest: earliest.toISOString(),
    latest: latest.toISOString(),
    minutes: minutes,
    hours: hours,
    days: days,
    label: label
  };
}

/**
 * Generate summary text
 */
function generateTimelineSummary(timeline, anomalies, data) {
  const parts = [];
  
  // Check for key signals
  const hasExif = timeline.some(e => e.type === 'EXIF_CREATED');
  const hasBlockchain = timeline.some(e => e.type.startsWith('BLOCKCHAIN_'));
  const newsCount = timeline.filter(e => e.type === 'NEWS_COVERAGE').length;
  const onlineCount = timeline.filter(e => e.type === 'ONLINE_MATCH').length;
  const isPreviouslyVerified = timeline.some(e => e.type === 'FIRST_VERIFIED');
  
  if (hasExif) {
    parts.push('Camera metadata verified');
  }
  
  if (isPreviouslyVerified) {
    const times = data.verification?.times_verified || 2;
    parts.push(`Previously verified ${times}x`);
  }
  
  if (newsCount > 0) {
    parts.push(`${newsCount} news source${newsCount > 1 ? 's' : ''} corroborate`);
  }
  
  if (onlineCount > 0) {
    parts.push(`${onlineCount} online match${onlineCount > 1 ? 'es' : ''}`);
  }
  
  if (hasBlockchain) {
    parts.push('Blockchain anchored');
  }
  
  // Add warning if high severity anomaly
  const highSeverity = anomalies.filter(a => a.severity === 'high');
  if (highSeverity.length > 0) {
    parts.push('⚠️ Issues detected');
  }
  
  return parts.join(' • ') || 'Verification in progress';
}

module.exports = { 
  buildProvenanceTimeline,
  parseGDELTDate,
  normalizeTimestamp,
  detectTimelineAnomalies
};