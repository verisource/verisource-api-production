/**
 * Provenance Timeline Builder (v1.2)
 * Generates a unified chronological timeline from all verification signals
 *
 * Combines: EXIF, blockchain, news coverage, reverse search, platform detection
 *
 * Improvements vs v1.1:
 * 1) More deterministic timestamp parsing (handles timezone-less ISO safely)
 * 2) Avoid repeated timestamp normalization (normalize on insert)
 * 3) Adds rank + evidence_id for stable UI ordering + evidence trail linkage
 * 4) Dedupe keys prefer URL when available (avoids collapsing distinct evidence)
 * 5) Exports calculateTimeSpan + generateTimelineSummary (optional but useful)
 */

function buildProvenanceTimeline(data) {
  const timeline = [];
  const verifiedAt = normalizeTimestamp(data.verified_at) || new Date().toISOString();

  const pushEvent = (evt) => {
    if (!evt) return;
    const ts = normalizeTimestamp(evt.timestamp);
    if (!ts) return;
    timeline.push({ ...evt, timestamp: ts });
  };

  // 1) EXIF / Camera date
  if (data.exif?.date_taken) {
    pushEvent({
      type: "EXIF_CREATED",
      timestamp: data.exif.date_taken,
      icon: "📷",
      label: "Photo/Video Created",
      source:
        data.exif.camera_make && data.exif.camera_model
          ? `${data.exif.camera_make} ${data.exif.camera_model}`.trim()
          : "Camera metadata",
      details: data.exif.gps
        ? `GPS: ${safeFixed(data.exif.gps.latitude, 4)}, ${safeFixed(data.exif.gps.longitude, 4)}`
        : null,
      url: null,
      relevance: null,
      confidence: 0.85,
      precision: inferPrecision(data.exif.date_taken),
      timestamp_source: "exif",
      evidence_id: "exif:date_taken",
      rank: 10,
    });
  }

  // 2) Platform first posted
  if (data.platform_detection?.detected) {
    const platformDate = data.platform_detection.estimated_upload_date || data.platform_detection.detected_at;
    if (platformDate) {
      pushEvent({
        type: "PLATFORM_POSTED",
        timestamp: platformDate,
        icon: "📱",
        label: "Posted to Platform",
        source: data.platform_detection.platform || "Social Media",
        details: data.platform_detection.username ? `@${data.platform_detection.username}` : null,
        url: data.platform_detection.url || null,
        relevance: null,
        confidence: data.platform_detection.estimated_upload_date ? 0.6 : 0.75,
        precision: data.platform_detection.estimated_upload_date ? "estimated" : inferPrecision(platformDate),
        timestamp_source: "platform",
        evidence_id: data.platform_detection.url ? `platform:${data.platform_detection.url}` : "platform:detected",
        rank: 30,
      });
    }
  }

  // 3) News coverage (top 5)
  if (data.tv_corroboration?.clips?.length > 0) {
    for (const clip of data.tv_corroboration.clips.slice(0, 5)) {
      const ts = parseGDELTDate(clip.date);
      if (!ts) continue;
      pushEvent({
        type: "NEWS_COVERAGE",
        timestamp: ts,
        icon: "📰",
        label: "News Coverage",
        source: clip.source || "Unknown",
        details: clip.title || null,
        url: clip.url || null,
        relevance: clip.relevance ?? null,
        confidence: 0.75,
        precision: "day",
        timestamp_source: "news",
        evidence_id: clip.url ? `news:${clip.url}` : `news:${clip.source || "unknown"}`,
        rank: 50,
      });
    }
  }

  // 4) Reverse image search (earliest first seen)
  if (data.reverse_image_search?.earliest_known_online?.date) {
    const earliest = data.reverse_image_search.earliest_known_online;
    pushEvent({
      type: "ONLINE_FIRST_SEEN",
      timestamp: earliest.date,
      icon: "🔍",
      label: "First Seen Online",
      source: earliest.domain || "TinEye",
      details: earliest.source === "persisted" ? "Earliest known appearance (verified)" : "Earliest indexed appearance",
      url: earliest.url || null,
      relevance: 1.0,
      confidence: earliest.source === "persisted" ? 0.85 : 0.7,
      precision: inferPrecision(earliest.date),
      timestamp_source: "reverse_search",
      evidence_id: earliest.url ? `reverse:${earliest.url}` : `reverse:${earliest.domain || "tineye"}`,
      rank: 40,
    });
  } else if (data.reverse_image_search?.tineye?.oldest_result?.crawl_date) {
    const oldest = data.reverse_image_search.tineye.oldest_result;
    pushEvent({
      type: "ONLINE_FIRST_SEEN",
      timestamp: oldest.crawl_date,
      icon: "🔍",
      label: "First Seen Online",
      source: oldest.domain || "TinEye",
      details: "Earliest indexed appearance",
      url: oldest.url || null,
      relevance: 1.0,
      confidence: 0.7,
      precision: inferPrecision(oldest.crawl_date),
      timestamp_source: "reverse_search",
      evidence_id: oldest.url ? `reverse:${oldest.url}` : `reverse:${oldest.domain || "tineye"}`,
      rank: 40,
    });
  }

  // 4a) Combined analysis earliest (fallback if no ONLINE_FIRST_SEEN yet)
  if (data.reverse_image_search?.combined_analysis?.age_analysis?.earliest_date) {
    const earliestDate = data.reverse_image_search.combined_analysis.age_analysis.earliest_date;
    const alreadyHasOldest = timeline.some((e) => e.type === "ONLINE_FIRST_SEEN");
    if (!alreadyHasOldest) {
      pushEvent({
        type: "ONLINE_FIRST_SEEN",
        timestamp: earliestDate,
        icon: "🔍",
        label: "First Seen Online",
        source: "Reverse Image Search",
        details: data.reverse_image_search.combined_analysis.age_analysis.age_readable || null,
        url: null,
        relevance: 0.9,
        confidence: 0.6,
        precision: "estimated",
        timestamp_source: "reverse_search",
        evidence_id: "reverse:combined_analysis",
        rank: 40,
      });
    }
  }

  // 4b) Additional online matches (top 3 distinct)
  if (data.reverse_image_search?.tineye?.results?.length > 0) {
    const oldestUrl = data.reverse_image_search.tineye.oldest_result?.url;
    const candidates = data.reverse_image_search.tineye.results
      .filter((r) => {
        const url = r.backlinks?.[0]?.url;
        return (r.crawl_date || r.date) && url && url !== oldestUrl;
      })
      .slice(0, 10);
    for (const result of candidates) {
      const url = result.backlinks?.[0]?.url || null;
      pushEvent({
        type: "ONLINE_MATCH",
        timestamp: result.crawl_date || result.date,
        icon: "🌐",
        label: "Found Online",
        source: result.domain || extractDomain(url) || "Web",
        details: null,
        url,
        relevance: null,
        confidence: 0.6,
        precision: inferPrecision(result.crawl_date || result.date),
        timestamp_source: "reverse_search",
        evidence_id: url ? `reverse:${url}` : `reverse:${result.domain || "web"}`,
        rank: 45,
      });
    }
  }

  // 4c) Generic reverse results fallback
  if (data.reverse_image_search?.results?.length > 0 && !timeline.some((e) => e.type === "ONLINE_FIRST_SEEN")) {
    for (const result of data.reverse_image_search.results.slice(0, 8)) {
      const rawDate = result.crawl_date || result.date || result.backlinks?.[0]?.crawl_date;
      if (!rawDate) continue;
      pushEvent({
        type: "ONLINE_MATCH",
        timestamp: rawDate,
        icon: "🔍",
        label: "Found Online",
        source: result.domain || extractDomain(result.url) || "Web",
        details: result.title || null,
        url: result.url || null,
        relevance: null,
        confidence: 0.5,
        precision: inferPrecision(rawDate),
        timestamp_source: "reverse_search",
        evidence_id: result.url ? `reverse:${result.url}` : `reverse:${result.domain || "web"}`,
        rank: 45,
      });
    }
  }

  // 4d) Stock photo detection
  if (
    data.reverse_image_search?.tineye?.is_stock_photo ||
    data.reverse_image_search?.combined_analysis?.content_type === "stock_photo"
  ) {
    const stockSites = data.reverse_image_search.tineye?.domain_breakdown?.stock_photo_sites || 0;
    pushEvent({
      type: "STOCK_PHOTO",
      timestamp: verifiedAt,
      icon: "📸",
      label: "Stock Photo Detected",
      source: "TinEye Analysis",
      details: stockSites > 0 ? `Found on ${stockSites} stock photo sites` : "Matches stock photo databases",
      url: null,
      relevance: null,
      confidence: 0.7,
      precision: "exact",
      timestamp_source: "analysis",
      evidence_id: "analysis:stock_photo",
      rank: 60,
    });
  }

  // 4e) Landmark detections
  if (data.reverse_search?.landmarks?.length > 0) {
    const landmarkEvents = data.reverse_search.landmarks.map((landmark) => ({
      type: "LANDMARK_DETECTED",
      timestamp: verifiedAt,
      icon: "📍",
      label: "Landmark Detected",
      source: landmark.name,
      details:
        landmark.location?.lat && landmark.location?.lng
          ? `${landmark.location.lat.toFixed(3)}, ${landmark.location.lng.toFixed(3)} • ${Math.round((landmark.confidence || 0) * 100)}% match`
          : `Frame ${landmark.frame} • ${Math.round((landmark.confidence || 0) * 100)}% match`,
      url: null,
      relevance: landmark.confidence ?? null,
      confidence: landmark.confidence ?? 0.5,
      precision: "exact",
      timestamp_source: "analysis",
      evidence_id: `analysis:landmark:${landmark.name}`,
      rank: 60,
    }));
    const uniqueLandmarks = dedupeByKey(landmarkEvents, (e) => e.source, (a, b) => (b.confidence || 0) - (a.confidence || 0));
    for (const e of uniqueLandmarks.slice(0, 5)) pushEvent(e);
  }

  // 4f) Fingerprint database matches
  if (data.fingerprint_matches?.timeline_events?.length > 0) {
    for (const event of data.fingerprint_matches.timeline_events) {
      pushEvent({
        type: event.type,
        timestamp: event.timestamp,
        icon: event.icon,
        label: event.label,
        source: event.source,
        details: event.details,
        url: event.url,
        relevance: event.relevance,
        confidence: event.confidence ?? 0.75,
        precision: event.precision ?? inferPrecision(event.timestamp),
        timestamp_source: "fingerprint_db",
        is_earliest_fingerprint: event.is_earliest,
        evidence_id: event.url ? `fp:${event.url}` : `fp:${event.source || "match"}`,
        rank: 35,
      });
    }
  }

  // 5) First verification
  if (data.verification?.status === "PREVIOUSLY_VERIFIED" && data.verification?.first_seen) {
    pushEvent({
      type: "FIRST_VERIFIED",
      timestamp: data.verification.first_seen,
      icon: "✓",
      label: "First Verified",
      source: "VeriSource",
      details: data.verification.times_verified ? `Verified ${data.verification.times_verified} times total` : null,
      url: null,
      relevance: null,
      confidence: 0.9,
      precision: inferPrecision(data.verification.first_seen),
      timestamp_source: "verisource",
      evidence_id: "verisource:first_seen",
      rank: 70,
    });
  }

  // 6) Blockchain timestamps
  if (data.blockchain_verification?.submitted_at || data.blockchain_verification?.timestamp) {
    const btcTimestamp = data.blockchain_verification.submitted_at || data.blockchain_verification.timestamp;
    pushEvent({
      type: "BLOCKCHAIN_BITCOIN",
      timestamp: btcTimestamp,
      icon: "₿",
      label: "Bitcoin Timestamp",
      source: "OpenTimestamps",
      details: data.blockchain_verification.status || "Anchored to Bitcoin blockchain",
      url: null,
      relevance: null,
      confidence: 0.95,
      precision: "exact",
      timestamp_source: "blockchain",
      evidence_id: data.blockchain_verification.txid ? `btc:${data.blockchain_verification.txid}` : "btc:opentimestamps",
      rank: 65,
    });
  }

  if (data.polygon_verification?.timestamp) {
    const tx = data.polygon_verification.transaction_hash;
    pushEvent({
      type: "BLOCKCHAIN_POLYGON",
      timestamp: data.polygon_verification.timestamp,
      icon: "🔷",
      label: "Polygon Timestamp",
      source: "Polygon Network",
      details: data.polygon_verification.block_number ? `Block #${data.polygon_verification.block_number}` : null,
      url: tx ? `https://polygonscan.com/tx/${tx}` : null,
      relevance: null,
      confidence: 0.95,
      precision: "exact",
      timestamp_source: "blockchain",
      evidence_id: tx ? `polygon:${tx}` : "polygon:timestamp",
      rank: 65,
    });
  }

  if (data.base_verification?.timestamp) {
    const tx = data.base_verification.transaction_hash;
    pushEvent({
      type: "BLOCKCHAIN_BASE",
      timestamp: data.base_verification.timestamp,
      icon: "🔵",
      label: "Base Timestamp",
      source: "Base Network (L2)",
      details: data.base_verification.block_number ? `Block #${data.base_verification.block_number}` : null,
      url: tx ? `https://basescan.org/tx/${tx}` : null,
      relevance: null,
      confidence: 0.95,
      precision: "exact",
      timestamp_source: "blockchain",
      evidence_id: tx ? `base:${tx}` : "base:timestamp",
      rank: 65,
    });
  }

  if (data.ethereum_verification?.timestamp) {
    const tx = data.ethereum_verification.transaction_hash;
    pushEvent({
      type: "BLOCKCHAIN_ETHEREUM",
      timestamp: data.ethereum_verification.timestamp,
      icon: "⟠",
      label: "Ethereum Timestamp",
      source: "Ethereum Mainnet (L1)",
      details: data.ethereum_verification.block_number ? `Block #${data.ethereum_verification.block_number}` : null,
      url: tx ? `https://etherscan.io/tx/${tx}` : null,
      relevance: null,
      confidence: 0.95,
      precision: "exact",
      timestamp_source: "blockchain",
      evidence_id: tx ? `eth:${tx}` : "eth:timestamp",
      rank: 65,
    });
  }

  // 7) Current submission
  if (data.verified_at) {
    pushEvent({
      type: "SUBMISSION",
      timestamp: verifiedAt,
      icon: "📤",
      label: "Submitted for Verification",
      source: "VeriSource",
      details: data.verification?.status === "PREVIOUSLY_VERIFIED" ? "Re-verification" : "First submission",
      url: null,
      relevance: null,
      confidence: 0.95,
      precision: "exact",
      timestamp_source: "verisource",
      evidence_id: "verisource:verified_at",
      rank: 80,
    });
  }

  const deduped = dedupeTimelineEvents(timeline);

  deduped.sort((a, b) => {
    const da = new Date(a.timestamp).getTime();
    const db = new Date(b.timestamp).getTime();
    if (da !== db) return da - db;
    const ra = a.rank ?? 999;
    const rb = b.rank ?? 999;
    if (ra !== rb) return ra - rb;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const anomalies = detectTimelineAnomalies(deduped, data);
  const span = calculateTimeSpan(deduped);
  const summary = generateTimelineSummary(deduped, anomalies, data);

  return { events: deduped, span, anomalies, summary };
}

function parseGDELTDate(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr === "string" && (dateStr.includes("-") || dateStr.includes("T"))) {
    return normalizeTimestamp(dateStr);
  }
  const match = String(dateStr).match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  return null;
}

function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp === "number") {
    if (timestamp < 4102444800) return new Date(timestamp * 1000).toISOString();
    return new Date(timestamp).toISOString();
  }
  if (typeof timestamp === "string") {
    const s = timestamp.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00Z`);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
      const d = new Date(`${s}Z`);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function inferPrecision(raw) {
  if (!raw) return "estimated";
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "day";
  if (s.includes("T")) return "exact";
  return "estimated";
}

function safeFixed(n, digits) {
  if (typeof n !== "number" || !isFinite(n)) return "unknown";
  return n.toFixed(digits);
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

function dedupeTimelineEvents(events) {
  const map = new Map();
  for (const e of events) {
    const dayKey = e.timestamp ? e.timestamp.slice(0, 10) : "no-day";
    const urlKey = e.url ? String(e.url) : null;
    const domain = extractDomain(e.url) || e.source || "unknown";
    let key;
    if (e.type === "ONLINE_MATCH" || e.type === "ONLINE_FIRST_SEEN" || e.type === "NEWS_COVERAGE") {
      key = `${e.type}|${urlKey || domain}|${dayKey}`;
    } else if (e.type === "LANDMARK_DETECTED") {
      key = `${e.type}|${e.source}|${dayKey}`;
    } else {
      const minuteKey = e.timestamp ? e.timestamp.slice(0, 16) : "no-minute";
      key = `${e.type}|${minuteKey}|${e.source || "unknown"}`;
    }
    const prev = map.get(key);
    if (!prev) {
      map.set(key, e);
      continue;
    }
    const prevScore = (prev.confidence ?? 0) * 100 + (prev.relevance ?? 0);
    const nextScore = (e.confidence ?? 0) * 100 + (e.relevance ?? 0);
    if (nextScore > prevScore) map.set(key, e);
  }
  const out = Array.from(map.values());
  const onlineMatches = out.filter((x) => x.type === "ONLINE_MATCH").sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const firstSeen = out.filter((x) => x.type !== "ONLINE_MATCH");
  const trimmedOnline = onlineMatches.slice(0, 3);
  return [...firstSeen, ...trimmedOnline];
}

function dedupeByKey(arr, keyFn, sortFn) {
  const sorted = [...arr].sort(sortFn);
  const out = [];
  const seen = new Set();
  for (const item of sorted) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function toDateOrNull(ts) {
  const iso = normalizeTimestamp(ts);
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function detectTimelineAnomalies(timeline, data) {
  const anomalies = [];
  const exifEvent = timeline.find((e) => e.type === "EXIF_CREATED");
  const newsEvents = timeline.filter((e) => e.type === "NEWS_COVERAGE");
  const submissionEvent = timeline.find((e) => e.type === "SUBMISSION");
  const firstVerified = timeline.find((e) => e.type === "FIRST_VERIFIED");
  const onlineFirstSeen = timeline.find((e) => e.type === "ONLINE_FIRST_SEEN");
  const onlineMatches = timeline.filter((e) => e.type === "ONLINE_MATCH" || e.type === "ONLINE_FIRST_SEEN");

  const diffDays = (a, b) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  const diffHoursAbs = (a, b) => Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60));

  if (exifEvent && newsEvents.length > 0) {
    const exifDate = toDateOrNull(exifEvent.timestamp);
    if (exifDate) {
      for (const news of newsEvents) {
        const newsDate = toDateOrNull(news.timestamp);
        if (!newsDate) continue;
        const days = diffDays(exifDate, newsDate);
        if (days > 30) {
          anomalies.push({
            type: "RECYCLED_CONTENT",
            severity: "high",
            message: `News reported similar event ${days} days before camera date — possible recycled content`,
            events: [news.timestamp, exifEvent.timestamp],
          });
          break;
        }
      }
    }
  }

  if (exifEvent && submissionEvent) {
    const exifDate = toDateOrNull(exifEvent.timestamp);
    const submitDate = toDateOrNull(submissionEvent.timestamp);
    if (exifDate && submitDate && exifDate > submitDate) {
      const hoursDiff = Math.floor((exifDate - submitDate) / (1000 * 60 * 60));
      anomalies.push({
        type: "FUTURE_DATED",
        severity: "medium",
        message: `Camera metadata shows date ${hoursDiff} hours after submission — device clock may be incorrect`,
        events: [submissionEvent.timestamp, exifEvent.timestamp],
      });
    }
  }

  if (exifEvent && onlineFirstSeen) {
    const exifDate = toDateOrNull(exifEvent.timestamp);
    const onlineDate = toDateOrNull(onlineFirstSeen.timestamp);
    if (exifDate && onlineDate) {
      const days = diffDays(exifDate, onlineDate);
      if (days > 7) {
        anomalies.push({
          type: "PREDATES_EXIF",
          severity: "high",
          message: `Image found online ${days} days before camera date — metadata may be manipulated`,
          events: [onlineFirstSeen.timestamp, exifEvent.timestamp],
        });
      }
    }
  }

  if (exifEvent && !onlineFirstSeen && onlineMatches.length > 0) {
    const exifDate = toDateOrNull(exifEvent.timestamp);
    if (exifDate) {
      for (const match of onlineMatches) {
        const matchDate = toDateOrNull(match.timestamp);
        if (!matchDate) continue;
        const days = diffDays(exifDate, matchDate);
        if (days > 7) {
          anomalies.push({
            type: "PREDATES_EXIF",
            severity: "high",
            message: `Image found online ${days} days before camera date — metadata may be manipulated`,
            events: [match.timestamp, exifEvent.timestamp],
          });
          break;
        }
      }
    }
  }

  if (newsEvents.length > 0 && (submissionEvent || firstVerified)) {
    const referenceEvent = firstVerified || submissionEvent;
    const referenceDate = toDateOrNull(referenceEvent.timestamp);
    const earliestNewsDate = newsEvents
      .map((e) => toDateOrNull(e.timestamp))
      .filter(Boolean)
      .reduce((min, d) => (min === null || d < min ? d : min), null);
    if (referenceDate && earliestNewsDate) {
      const hoursDiff = diffHoursAbs(referenceDate, earliestNewsDate);
      if (hoursDiff < 2) {
        anomalies.push({
          type: "RAPID_SPREAD",
          severity: "info",
          message: "Content verified within 2 hours of news coverage — likely breaking news",
          events: [earliestNewsDate.toISOString(), referenceEvent.timestamp],
        });
      }
    }
  }

  if (exifEvent && (firstVerified || submissionEvent)) {
    const referenceEvent = firstVerified || submissionEvent;
    const exifDate = toDateOrNull(exifEvent.timestamp);
    const verifyDate = toDateOrNull(referenceEvent.timestamp);
    if (exifDate && verifyDate) {
      const days = diffDays(verifyDate, exifDate);
      if (days > 365) {
        anomalies.push({
          type: "OLD_CONTENT",
          severity: "info",
          message: `Content is ${Math.floor(days / 30)} months old based on camera date`,
          events: [exifEvent.timestamp, referenceEvent.timestamp],
        });
      }
    }
  }

  if (onlineFirstSeen && firstVerified) {
    const onlineDate = toDateOrNull(onlineFirstSeen.timestamp);
    const verifiedDate = toDateOrNull(firstVerified.timestamp);
    if (onlineDate && verifiedDate) {
      const days = diffDays(verifiedDate, onlineDate);
      if (days > 30) {
        anomalies.push({
          type: "LATE_VERIFICATION",
          severity: "info",
          message: `Content was online ${days} days before first VeriSource verification`,
          events: [onlineFirstSeen.timestamp, firstVerified.timestamp],
        });
      }
    }
  }

  return anomalies;
}

function calculateTimeSpan(timeline) {
  if (timeline.length < 2) return null;
  const timestamps = timeline.map((e) => toDateOrNull(e.timestamp)).filter(Boolean);
  if (timestamps.length < 2) return null;
  const earliest = new Date(Math.min(...timestamps.map((d) => d.getTime())));
  const latest = new Date(Math.max(...timestamps.map((d) => d.getTime())));
  const diffMs = latest - earliest;
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  let label;
  if (days > 0) label = `${days} day${days > 1 ? "s" : ""}`;
  else if (hours > 0) label = `${hours} hour${hours > 1 ? "s" : ""}`;
  else label = `${minutes} minute${minutes > 1 ? "s" : ""}`;
  return { earliest: earliest.toISOString(), latest: latest.toISOString(), minutes, hours, days, label };
}

function generateTimelineSummary(timeline, anomalies, data) {
  const parts = [];
  const hasExif = timeline.some((e) => e.type === "EXIF_CREATED");
  const hasBlockchain = timeline.some((e) => e.type.startsWith("BLOCKCHAIN_"));
  const newsCount = timeline.filter((e) => e.type === "NEWS_COVERAGE").length;
  const onlineFirstSeen = timeline.find((e) => e.type === "ONLINE_FIRST_SEEN");
  const onlineCount = timeline.filter((e) => e.type === "ONLINE_MATCH" || e.type === "ONLINE_FIRST_SEEN").length;
  const isPreviouslyVerified = timeline.some((e) => e.type === "FIRST_VERIFIED");
  const isStockPhoto = timeline.some((e) => e.type === "STOCK_PHOTO");

  if (hasExif) parts.push("Camera metadata present");
  if (isPreviouslyVerified) {
    const times = data.verification?.times_verified || 2;
    parts.push(`Previously verified ${times}x`);
  }
  if (onlineFirstSeen) {
    const firstSeenDate = toDateOrNull(onlineFirstSeen.timestamp);
    if (firstSeenDate) {
      const now = new Date();
      const daysDiff = Math.floor((now - firstSeenDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > 30) parts.push(`First online ${Math.floor(daysDiff / 30)} months ago`);
      else if (daysDiff > 0) parts.push(`First online ${daysDiff} days ago`);
    }
  }
  if (newsCount > 0) parts.push(`${newsCount} news source${newsCount > 1 ? "s" : ""} corroborate`);
  if (onlineCount > 0 && !onlineFirstSeen) parts.push(`${onlineCount} online match${onlineCount > 1 ? "es" : ""}`);
  if (isStockPhoto) parts.push("Stock photo detected");
  if (hasBlockchain) {
    const blockchainCount = timeline.filter((e) => e.type.startsWith("BLOCKCHAIN_")).length;
    parts.push(blockchainCount > 1 ? `Anchored on ${blockchainCount} blockchains` : "Blockchain anchored");
  }
  const highSeverity = anomalies.filter((a) => a.severity === "high");
  if (highSeverity.length > 0) parts.push("⚠️ Issues detected");
  return parts.join(" • ") || "Verification in progress";
}

module.exports = {
  buildProvenanceTimeline,
  parseGDELTDate,
  normalizeTimestamp,
  detectTimelineAnomalies,
  toDateOrNull,
  inferPrecision,
  calculateTimeSpan,
  generateTimelineSummary,
};