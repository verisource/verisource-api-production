/**
 * Provenance Service v3.1
 * Enhanced content lineage tracking with detailed change detection
 *
 * CHANGES IN v3.1 (recommended fixes):
 * 1) TRUE pHash (DCT-based) generation
 *    - Your prior "pHash" logic was actually an aHash-style average threshold.
 *    - This version implements real pHash (32x32 -> DCT -> top-left 8x8 median threshold).
 *
 * 2) Metadata field normalization
 *    - detectChanges now consistently uses: has_exif, has_gps, has_camera_info, camera_make, camera_model, exif_date.
 *    - checkAndRecordProvenance maps both parent/new metadata into that consistent shape.
 *
 * 3) Change deduplication
 *    - Prevents duplicate "metadata_stripped" / "gps_stripped" entries and reconciles severity.
 *
 * 4) Region fallback search is now targeted (no broad LIMIT 500 scan)
 *    - Uses JSONB region prefixes for a few key regions (center70/center80/full) when available.
 *
 * 5) Region hashing performance improvements
 *    - Reads metadata once, avoids extra sharp decode/encode cycles, uses clone/extract properly.
 *
 * 6) Prefix filtering comments corrected
 *    - Prefix match is a candidate-pruning heuristic, not a guaranteed similarity bound.
 */

const db = require("../db-minimal");
const sharp = require("sharp");

class ProvenanceService {
  constructor() {
    // Pre-compute DCT cos table for 32x32 (used in pHash)
    this._cos32 = this._buildCosTable(32);
  }

  // ============================================================================
  // MULTI-REGION pHash GENERATION (true pHash, DCT-based)
  // ============================================================================

  getRegionDefinitions() {
    return {
      full: null,
      center50: (w, h) => ({ left: w * 0.25, top: h * 0.25, width: w * 0.5, height: h * 0.5 }),
      center60: (w, h) => ({ left: w * 0.20, top: h * 0.20, width: w * 0.6, height: h * 0.6 }),
      center70: (w, h) => ({ left: w * 0.15, top: h * 0.15, width: w * 0.7, height: h * 0.7 }),
      center80: (w, h) => ({ left: w * 0.10, top: h * 0.10, width: w * 0.8, height: h * 0.8 }),
      topLeft: (w, h) => ({ left: 0, top: 0, width: w * 0.5, height: h * 0.5 }),
      topRight: (w, h) => ({ left: w * 0.5, top: 0, width: w * 0.5, height: h * 0.5 }),
      bottomLeft: (w, h) => ({ left: 0, top: h * 0.5, width: w * 0.5, height: h * 0.5 }),
      bottomRight: (w, h) => ({ left: w * 0.5, top: h * 0.5, width: w * 0.5, height: h * 0.5 }),
      topHalf: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.5 }),
      bottomHalf: (w, h) => ({ left: 0, top: h * 0.5, width: w, height: h * 0.5 }),
      leftHalf: (w, h) => ({ left: 0, top: 0, width: w * 0.5, height: h }),
      rightHalf: (w, h) => ({ left: w * 0.5, top: 0, width: w * 0.5, height: h }),
      topThird: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.33 }),
      middleThird: (w, h) => ({ left: 0, top: h * 0.33, width: w, height: h * 0.34 }),
      bottomThird: (w, h) => ({ left: 0, top: h * 0.66, width: w, height: h * 0.34 }),
      top2Thirds: (w, h) => ({ left: 0, top: 0, width: w, height: h * 0.66 }),
      bottom2Thirds: (w, h) => ({ left: 0, top: h * 0.34, width: w, height: h * 0.66 }),
    };
  }

  // ---- DCT helpers (true pHash) ----

  _alpha(u, N) {
    return u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
  }

  _buildCosTable(N) {
    // cosTable[u][x] = cos(((2x+1)uπ)/(2N))
    const cosTable = Array.from({ length: N }, (_, u) =>
      Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)))
    );
    return cosTable;
  }

  _dct2D(pixels, N, cosTable) {
    // pixels: array length N*N, row-major
    const out = new Array(N * N).fill(0);
    for (let u = 0; u < N; u++) {
      const au = this._alpha(u, N);
      for (let v = 0; v < N; v++) {
        const av = this._alpha(v, N);
        let sum = 0;
        for (let x = 0; x < N; x++) {
          const cu = cosTable[u][x];
          for (let y = 0; y < N; y++) {
            const cv = cosTable[v][y];
            sum += pixels[y * N + x] * cu * cv;
          }
        }
        out[v * N + u] = au * av * sum;
      }
    }
    return out;
  }

  _bitsToHex(bits) {
    let hex = "";
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.substr(i, 4), 2).toString(16);
    }
    return hex;
  }

  _computePHashFromGray32(raw32) {
    // raw32: Buffer/Uint8Array length 1024 (32*32)
    // 1) center around 0
    const N = 32;
    const pixels = new Array(N * N);
    for (let i = 0; i < N * N; i++) pixels[i] = raw32[i] - 128;

    // 2) DCT using pre-computed cos table
    const dct = this._dct2D(pixels, 32, this._cos32);

    // 3) top-left 8x8, excluding DC, median threshold
    const coeffs = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x === 0 && y === 0) continue; // skip DC for median
        coeffs.push(dct[y * 32 + x]);
      }
    }
    const sorted = [...coeffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;

    // 4) build 64-bit hash (include DC bit as 0)
    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x === 0 && y === 0) {
          bits += "0";
          continue;
        }
        bits += dct[y * 32 + x] > median ? "1" : "0";
      }
    }
    return this._bitsToHex(bits);
  }

  async generateRegionPHash(input, regionFn = null, meta = null) {
    try {
      const base = sharp(input);
      const m = meta || (await base.metadata());
      if (!m?.width || !m?.height) return null;

      let img = base.clone();

      if (regionFn) {
        const bounds = regionFn(m.width, m.height);
        img = img.extract({
          left: Math.max(0, Math.floor(bounds.left)),
          top: Math.max(0, Math.floor(bounds.top)),
          width: Math.max(1, Math.floor(bounds.width)),
          height: Math.max(1, Math.floor(bounds.height)),
        });
      }

      const raw32 = await img.resize(32, 32, { fit: "fill" }).grayscale().raw().toBuffer();
      return this._computePHashFromGray32(raw32);
    } catch (err) {
      console.error(`⚠️ Error generating region pHash: ${err.message}`);
      return null;
    }
  }

  async generateAllRegionHashes(input) {
    const regions = this.getRegionDefinitions();
    const hashes = {};

    console.log("🔍 Generating multi-region pHashes (18 regions)...");
    const startTime = Date.now();

    // read metadata once
    let meta = null;
    try {
      meta = await sharp(input).metadata();
    } catch {
      meta = null;
    }

    // sequential is OK; if you want speed, you can parallelize a subset,
    // but sharp concurrency can spike memory. Start simple.
    for (const [name, regionFn] of Object.entries(regions)) {
      const hash = await this.generateRegionPHash(input, regionFn, meta);
      if (hash) hashes[name] = hash;
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ Generated ${Object.keys(hashes).length} region pHashes in ${elapsed}ms`);

    return hashes;
  }

  // ============================================================================
  // HASH COMPARISON
  // ============================================================================

  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return Infinity;

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      // Each char is a hex nibble (4 bits)
      const n1 = parseInt(hash1[i], 16);
      const n2 = parseInt(hash2[i], 16);
      let xor = n1 ^ n2;
      // popcount nibble
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    return distance;
  }

  similarityScore(hash1, hash2) {
    if (!hash1 || !hash2) return 0;
    const distance = this.hammingDistance(hash1, hash2);
    const maxBits = hash1.length * 4;
    return Math.round(Math.max(0, 100 - (distance / maxBits) * 100));
  }

  compareRegionHashes(hashes1, hashes2) {
    let bestMatch = { similarity: 0, region1: null, region2: null };

    const regions = Object.keys(hashes1).filter((r) => hashes2[r]);
    for (const region of regions) {
      const sim = this.similarityScore(hashes1[region], hashes2[region]);
      if (sim > bestMatch.similarity) {
        bestMatch = { similarity: sim, region1: region, region2: region };
      }
    }
    return bestMatch;
  }
  compareRegionHashesCross(hashes1, hashes2) {
    let bestMatch = { similarity: 0, region1: null, region2: null, crop_hint: false };
    const regions1 = Object.keys(hashes1);
    const regions2 = Object.keys(hashes2);
    for (const r1 of regions1) {
      for (const r2 of regions2) {
        const sim = this.similarityScore(hashes1[r1], hashes2[r2]);
        if (sim > bestMatch.similarity) {
          bestMatch = {
            similarity: sim,
            region1: r1,
            region2: r2,
            crop_hint: (r1 === 'full' && r2 !== 'full') || (r2 === 'full' && r1 !== 'full')
          };
        }
        if (sim >= 97) return bestMatch;
      }
    }
    return bestMatch;
  }
  // ============================================================================
  // SCALABLE SEARCH (prefix filtering + targeted region prefix fallback)
  // ============================================================================

  /**
   * Find similar content using prefix filtering in SQL.
   *
   * Important: prefix matching is a candidate-pruning heuristic (fast narrowing),
   * not a guaranteed similarity bound. We still score precisely in JS.
   */
  async findSimilarContent(phash, regionHashes = null, excludeFingerprint = null, threshold = 85) {
    console.log("🔍 findSimilarContent:", {
      hasPhash: !!phash,
      hasRegions: !!regionHashes,
      exclude: typeof excludeFingerprint === "string" ? excludeFingerprint.substring(0, 8) : excludeFingerprint,
      threshold,
    });

    if (!phash && !regionHashes) return [];

    try {
      const similar = [];
      let candidates = [];

      // Helper to run candidate query and merge distinct fingerprints
      const mergeCandidates = (rows) => {
        const existing = new Set(candidates.map((c) => c.fingerprint));
        for (const r of rows) {
          if (!existing.has(r.fingerprint)) {
            candidates.push(r);
            existing.add(r.fingerprint);
          }
        }
      };

      // --------------------------
      // TIER 1: full pHash prefix
      // --------------------------
      if (phash) {
        const prefixLengths = [8, 6, 4]; // longer -> stricter, shorter -> broader
        for (const prefixLen of prefixLengths) {
          const prefix = phash.substring(0, prefixLen);

          let query = `
            SELECT DISTINCT ON (fingerprint)
              fingerprint, phash, phash_regions, upload_date, media_kind,
              original_filename, file_size, file_type, width, height,
              has_camera_info, has_gps, has_exif, exif_date, camera_make, camera_model
            FROM verifications
            WHERE phash IS NOT NULL
              AND LEFT(phash, $1) = $2
          `;
          const params = [prefixLen, prefix];

          if (excludeFingerprint) {
            query += ` AND fingerprint != $3`;
            params.push(excludeFingerprint);
          }

          // prefer best metadata + earliest upload (closer to "first seen" for parent inference)
          query += ` ORDER BY fingerprint, (width IS NULL) ASC, upload_date ASC LIMIT 500`;

          const result = await db.query(query, params);
          if (result.rows?.length) {
            console.log("📊 Prefix candidates:", { prefixLen, count: result.rows.length });
            mergeCandidates(result.rows);
            // if we got strict matches, don't broaden unless we need more
            if (prefixLen >= 6 && candidates.length >= 50) break;
          }
        }
      }

      // --------------------------------------------
      // TIER 2: targeted region prefix fallback (no broad scan)
      // (JSONB/TEXT-safe via phash_regions::jsonb)
      // --------------------------------------------
      if (regionHashes) {
        // Pick a few high-signal regions to query by prefix (fast)
        const preferredRegions = ["center70", "center80", "full", "center60"];
        // Only use regions with valid hashes (at least 8 chars for prefix matching)
        const availableRegions = preferredRegions.filter((r) => regionHashes[r] && regionHashes[r].length >= 8);
        const regionPrefixLens = [6, 4]; // keep this small to avoid huge sets

        for (const region of availableRegions.slice(0, 3)) {
          for (const prefixLen of regionPrefixLens) {
            const prefix = regionHashes[region].substring(0, prefixLen);

            // Use ::jsonb cast for TEXT/JSONB column compatibility
            let rQuery = `
              SELECT DISTINCT ON (fingerprint)
                fingerprint, phash, phash_regions, upload_date, media_kind,
                original_filename, file_size, file_type, width, height,
                has_camera_info, has_gps, has_exif, exif_date, camera_make, camera_model
              FROM verifications
              WHERE phash_regions IS NOT NULL
                AND (phash_regions::jsonb->>$1) IS NOT NULL
                AND LEFT(phash_regions::jsonb->>$1, $2) = $3
            `;

            const rParams = [region, prefixLen, prefix];

            if (excludeFingerprint) {
              rQuery += ` AND fingerprint != $4`;
              rParams.push(excludeFingerprint);
            }

            rQuery += ` ORDER BY fingerprint, (width IS NULL) ASC, upload_date ASC LIMIT 300`;

            const rRes = await db.query(rQuery, rParams);
            if (rRes.rows?.length) {
              console.log("📊 Region prefix candidates:", { region, prefixLen, count: rRes.rows.length });
              mergeCandidates(rRes.rows);
            }

            // stop if we have plenty to score
            if (candidates.length >= 600) break;
          }
          if (candidates.length >= 600) break;
        }
      }

      // Safety cap on scoring work
      if (candidates.length > 800) {
        candidates = candidates.slice(0, 800);
      }
     // --------------------------------------------
      // TIER 2.5: Broad region scan (when prefix matching fails)
      // Scans all region-enabled entries with cheap gate + cross-region scoring
      // --------------------------------------------
      if (candidates.length === 0 && regionHashes && excludeFingerprint) {
        console.log('🔍 Tier 2.5: Running broad region scan...');
        try {
          const broadResult = await db.query(`
            SELECT DISTINCT ON (fingerprint)
              fingerprint, phash, phash_regions, upload_date, media_kind,
              original_filename, file_size, file_type, width, height,
              has_camera_info, has_gps, has_exif, exif_date, camera_make, camera_model
            FROM verifications
            WHERE phash_regions IS NOT NULL
              AND fingerprint != $1::text
            ORDER BY fingerprint, upload_date ASC
            LIMIT 2000
          `, [excludeFingerprint]);

          console.log('🔍 Tier 2.5: Scanning', broadResult.rows.length, 'entries with region hashes');

          // Cheap gate: quick cross-region check on a few key pairs
          const gated = [];
          for (const row of broadResult.rows) {
            try {
              const stored = typeof row.phash_regions === 'string' ? JSON.parse(row.phash_regions) : row.phash_regions;
              let quickMax = 0;
              // Check crop-friendly pairs
              const pairs = [
                ['full', 'center70'], ['center70', 'full'],
                ['full', 'center80'], ['center80', 'full'],
                ['full', 'center60'], ['center60', 'full']
              ];
              for (const [r1, r2] of pairs) {
                if (regionHashes[r1] && stored[r2]) {
                  const sim = this.similarityScore(regionHashes[r1], stored[r2]);
                  if (sim > quickMax) quickMax = sim;
                }
              }
              if (quickMax >= 30) {
                row._quickScore = quickMax;
                gated.push(row);
              }
            } catch (e) { /* skip unparseable */ }
          }

          console.log('🔍 Tier 2.5: Passed cheap gate:', gated.length, 'of', broadResult.rows.length);

          // Sort by quick score desc, take top 250
          gated.sort((a, b) => b._quickScore - a._quickScore);
          mergeCandidates(gated.slice(0, 250));
        } catch (broadErr) {
          console.log('⚠️ Tier 2.5 broad scan error:', broadErr.message);
        }
      }
      // --------------------------------------------
      // TIER 3: TinEye cross-reference fallback
      // Only runs when pHash/region prefix search found ZERO candidates
      // Links images that share >=3 TinEye match URLs
      // --------------------------------------------
      if (candidates.length === 0 && excludeFingerprint) {
        try {
          const sharedResult = await db.query(`
            SELECT b.fingerprint, COUNT(DISTINCT a.match_url) as shared_urls
            FROM external_matches a
            JOIN external_matches b ON a.match_url = b.match_url AND a.service = b.service
            WHERE a.fingerprint = $1
              AND b.fingerprint != $1
              AND a.service = 'tineye'
            GROUP BY b.fingerprint
            HAVING COUNT(DISTINCT a.match_url) >= 3
            LIMIT 50
          `, [excludeFingerprint]);

          if (sharedResult.rows?.length) {
            const fps = sharedResult.rows.map(r => r.fingerprint);
            console.log('🔗 TinEye cross-ref found:', fps.length, 'related fingerprints');

            const placeholders = fps.map((_, i) => `$${i + 1}::text`).join(',');
            console.log('🔗 TinEye cross-ref loading verifications for:', fps.length, 'fingerprints');
            const verifResult = await db.query(`
              SELECT DISTINCT ON (fingerprint)
                fingerprint, phash, phash_regions, upload_date, media_kind,
                original_filename, file_size, file_type, width, height,
                has_camera_info, has_gps, has_exif, exif_date, camera_make, camera_model
              FROM verifications
              WHERE fingerprint::text IN (${placeholders})
              ORDER BY fingerprint, (width IS NULL) ASC, upload_date ASC
            `, fps);
            if (verifResult.rows?.length) {
              verifResult.rows.forEach(r => r._tineye_match = true);
              mergeCandidates(verifResult.rows);
            }
          }
        } catch (tineyeErr) {
          console.log('⚠️ TinEye cross-ref fallback error:', tineyeErr.message);
        }
      }

      console.log("🔍 Candidates to score:", candidates.length);

      // --------------------------
      // Score candidates
      // --------------------------
      for (const row of candidates) {
        let bestSimilarity = 0;
        let matchDetails = { region1: "full", region2: "full" };

        if (phash && row.phash) {
          bestSimilarity = this.similarityScore(phash, row.phash);
        }

        if (regionHashes && row.phash_regions) {
          try {
            const storedRegions = typeof row.phash_regions === "string" ? JSON.parse(row.phash_regions) : row.phash_regions;
            const regionMatch = this.compareRegionHashesCross(regionHashes, storedRegions);

            if (regionMatch.similarity > bestSimilarity) {
              bestSimilarity = regionMatch.similarity;
              matchDetails = { region1: regionMatch.region1, region2: regionMatch.region2 };
            }
          } catch {
            // ignore parse errors
          }
        }

        const effectiveThreshold = row._tineye_match ? Math.min(threshold, 50) : threshold;
        if (bestSimilarity >= effectiveThreshold || row._tineye_match) {
          similar.push({
            fingerprint: row.fingerprint,
            similarity: bestSimilarity,
            first_seen: row.upload_date,
            media_kind: row.media_kind,
            filename: row.original_filename,
            file_size: row.file_size,
            file_type: row.file_type,
            width: row.width || null,
            height: row.height || null,
            has_camera_info: row.has_camera_info || false,
            has_gps: row.has_gps || false,
            has_exif: row.has_exif || false,
            exif_date: row.exif_date || null,
            camera_make: row.camera_make || null,
            camera_model: row.camera_model || null,
            match_type: row._tineye_match ? "tineye_cross_ref" : (matchDetails.region1 === "full" && matchDetails.region2 === "full" ? "full_image" : "region_match"),
            matched_regions: matchDetails,
          });
        }
      }

      similar.sort((a, b) => b.similarity - a.similarity);
      return similar;
    } catch (err) {
      console.error("⚠️ Error finding similar content:", err.message);
      return [];
    }
  }

  // ============================================================================
  // CHANGE DETECTION
  // ============================================================================

  detectChanges(parentMeta, childMeta, similarity, matchType, matchedRegions) {
    // Normalize metadata keys (single canonical set)
    const p = this._normalizeMeta(parentMeta);
    const c = this._normalizeMeta(childMeta);

    const changes = [];
    const flags = {};

    // 1) RESOLUTION CHANGE
    if (p.width && p.height && c.width && c.height) {
      const parentPixels = p.width * p.height;
      const childPixels = c.width * c.height;

      if (p.width !== c.width || p.height !== c.height) {
        const scalePercent = Math.round((childPixels / parentPixels) * 100);

        const parentAR = (p.width / p.height).toFixed(3);
        const childAR = (c.width / c.height).toFixed(3);
        const aspectChanged = parentAR !== childAR;

        if (childPixels < parentPixels * 0.5) {
          changes.push({
            type: "resolution_downscaled",
            severity: "significant",
            detail: `Downscaled to ${scalePercent}% (${p.width}×${p.height} → ${c.width}×${c.height})`,
            parent_value: `${p.width}×${p.height}`,
            child_value: `${c.width}×${c.height}`,
            scale_percent: scalePercent,
          });
          flags.resolution_downscaled = true;
        } else if (childPixels > parentPixels * 1.5) {
          changes.push({
            type: "resolution_upscaled",
            severity: "moderate",
            detail: `Upscaled to ${scalePercent}% (${p.width}×${p.height} → ${c.width}×${c.height})`,
            parent_value: `${p.width}×${p.height}`,
            child_value: `${c.width}×${c.height}`,
            scale_percent: scalePercent,
          });
          flags.resolution_upscaled = true;
        } else {
          changes.push({
            type: "resolution_changed",
            severity: "minor",
            detail: `Resolution changed (${p.width}×${p.height} → ${c.width}×${c.height})`,
            parent_value: `${p.width}×${p.height}`,
            child_value: `${c.width}×${c.height}`,
            scale_percent: scalePercent,
          });
          flags.resolution_changed = true;
        }

        if (aspectChanged) {
          changes.push({
            type: "aspect_ratio_changed",
            severity: "significant",
            detail: `Aspect ratio changed (${parentAR} → ${childAR})`,
            parent_value: parentAR,
            child_value: childAR,
          });
          flags.aspect_ratio_changed = true;
        }
      }
    }

    // 2) FORMAT CHANGE
    if (p.format && c.format) {
      const pFmt = String(p.format).toLowerCase();
      const cFmt = String(c.format).toLowerCase();
      if (pFmt !== cFmt) {
        const lossy = ["jpeg", "jpg", "webp"];
        const lossless = ["png", "tiff", "bmp"];
        const lossyToLossy = lossy.includes(pFmt) && lossy.includes(cFmt);
        const losslessToLossy = lossless.includes(pFmt) && lossy.includes(cFmt);

        changes.push({
          type: "format_converted",
          severity: losslessToLossy ? "significant" : "minor",
          detail: `Format converted (${pFmt} → ${cFmt})${losslessToLossy ? " — quality loss likely" : ""}`,
          parent_value: pFmt,
          child_value: cFmt,
          quality_loss: losslessToLossy || lossyToLossy,
        });
        flags.format_converted = true;
      }
    }

    // 3) FILE SIZE CHANGE
    if (p.file_size && c.file_size) {
      const sizeRatio = c.file_size / p.file_size;

      if (sizeRatio < 0.5) {
        changes.push({
          type: "heavily_compressed",
          severity: "significant",
          detail: `File size reduced ${Math.round((1 - sizeRatio) * 100)}% (${this._formatBytes(p.file_size)} → ${this._formatBytes(c.file_size)})`,
          parent_value: p.file_size,
          child_value: c.file_size,
          compression_ratio: sizeRatio.toFixed(3),
        });
        flags.heavily_compressed = true;
      } else if (sizeRatio < 0.8 || sizeRatio > 1.2) {
        changes.push({
          type: "recompressed",
          severity: "minor",
          detail: `File size changed ${sizeRatio < 1 ? "reduced" : "increased"} (${this._formatBytes(p.file_size)} → ${this._formatBytes(c.file_size)})`,
          parent_value: p.file_size,
          child_value: c.file_size,
          compression_ratio: sizeRatio.toFixed(3),
        });
        flags.recompressed = true;
      }
    }

    // 4) METADATA PRESENCE CHANGES (EXIF, camera info, GPS)
    if (p.has_exif && !c.has_exif) {
      changes.push({
        type: "metadata_stripped",
        severity: "significant",
        detail: "EXIF metadata removed",
        parent_value: "EXIF present",
        child_value: "EXIF absent",
      });
      flags.metadata_stripped = true;
    } else if (!p.has_exif && c.has_exif) {
      changes.push({
        type: "metadata_added",
        severity: "significant",
        detail: "EXIF metadata added",
        parent_value: "EXIF absent",
        child_value: "EXIF present",
      });
      flags.metadata_added = true;
    }

    if (p.has_camera_info && !c.has_camera_info) {
      changes.push({
        type: "camera_info_removed",
        severity: "moderate",
        detail: p.camera_make && p.camera_model ? `Camera info removed (was: ${p.camera_make} ${p.camera_model})` : "Camera info removed",
      });
      flags.camera_info_removed = true;
    } else if (!p.has_camera_info && c.has_camera_info) {
      changes.push({
        type: "camera_info_added",
        severity: "moderate",
        detail: c.camera_make && c.camera_model ? `Camera info added (${c.camera_make} ${c.camera_model})` : "Camera info added",
      });
      flags.camera_info_added = true;
    }

    if (p.has_gps && !c.has_gps) {
      changes.push({
        type: "gps_stripped",
        severity: "moderate",
        detail: "GPS location data removed",
        parent_value: "GPS present",
        child_value: "GPS absent",
      });
      flags.gps_stripped = true;
    } else if (!p.has_gps && c.has_gps) {
      changes.push({
        type: "gps_added",
        severity: "moderate",
        detail: "GPS location data added",
        parent_value: "GPS absent",
        child_value: "GPS present",
      });
      flags.gps_added = true;
    }

    // 5) METADATA TAMPERING (stronger guardrails)
    if (p.has_exif && c.has_exif && p.camera_make && c.camera_make && p.camera_make !== c.camera_make) {
      changes.push({
        type: "metadata_inconsistent",
        severity: "high",
        detail: `Camera make differs (${p.camera_make} → ${c.camera_make})`,
        parent_value: p.camera_make,
        child_value: c.camera_make,
      });
      flags.metadata_tampered = true;
    }

    // 6) DATE MODIFICATION
    if (p.exif_date && c.exif_date) {
      const parentDate = new Date(p.exif_date);
      const childDate = new Date(c.exif_date);
      const daysDiff = Math.abs((childDate - parentDate) / (1000 * 60 * 60 * 24));

      if (daysDiff > 1) {
        changes.push({
          type: "date_modified",
          severity: "significant",
          detail: `EXIF date changed from ${parentDate.toISOString().split("T")[0]} to ${childDate.toISOString().split("T")[0]}`,
          parent_date: p.exif_date,
          child_date: c.exif_date,
          days_difference: Math.round(daysDiff),
        });
        flags.date_modified = true;
      }
    } else if (p.exif_date && !c.exif_date) {
      changes.push({
        type: "date_stripped",
        severity: "significant",
        detail: `Original date (${new Date(p.exif_date).toISOString().split("T")[0]}) was removed`,
        parent_date: p.exif_date,
      });
      flags.date_stripped = true;
    }

    // 7) CROP / REGION MATCH INTERPRETATION
    if (matchType === "region_match" && matchedRegions) {
      const cropRegion = matchedRegions.region1 || matchedRegions.region2 || "unknown";
      const cropDescription = this._describeCropRegion(cropRegion);

      const likelyCrop = !!flags.aspect_ratio_changed || similarity < 96;

      if (likelyCrop) {
        changes.push({
          type: "cropped_or_partial_match",
          severity: "significant",
          detail: `Partial match suggests crop/overlay — best match is ${cropDescription}`,
          matched_region: cropRegion,
          crop_description: cropDescription,
        });
        flags.cropped = true;
      } else {
        changes.push({
          type: "minor_visual_edit",
          severity: "minor",
          detail: `Minor global edits likely (region match at ${similarity}% similarity)`,
          similarity,
        });
        flags.minor_visual_edit = true;
      }
    }

    // 8) VISUAL SIMILARITY ASSESSMENT (fallback narrative)
    if (similarity < 100 && similarity >= 85 && !flags.cropped) {
      if (similarity >= 95 && !flags.format_converted && !flags.recompressed) {
        changes.push({
          type: "minor_visual_edit",
          severity: "minor",
          detail: `Minor visual changes detected (${similarity}% similar) — possible color/contrast, watermark, or small edit`,
          similarity,
        });
        flags.minor_visual_edit = true;
      } else if (similarity >= 85 && similarity < 95) {
        changes.push({
          type: "significant_visual_edit",
          severity: "significant",
          detail: `Significant visual changes detected (${similarity}% similar) — possible overlay/text, filter, or content modification`,
          similarity,
        });
        flags.significant_visual_edit = true;
      }
    }

    // 9) Deduplicate changes by type + reconcile severities
    const deduped = this._dedupeChanges(changes);
    const dedupFlags = this._rebuildFlagsFromChanges(deduped, flags);

    const summary = this._generateChangeSummary(deduped, dedupFlags, similarity);

    return {
      changes: deduped,
      change_flags: dedupFlags,
      change_count: deduped.length,
      summary,
      severity: this._overallSeverity(deduped),
      similarity,
    };
  }

  _normalizeMeta(m) {
    const meta = m || {};
    return {
      fingerprint: meta.fingerprint,
      first_seen: meta.first_seen,
      upload_date: meta.upload_date,
      width: meta.width || null,
      height: meta.height || null,
      file_size: meta.file_size || null,
      format: meta.format || meta.file_type || null,
      file_type: meta.file_type || null,
      has_exif: !!meta.has_exif,
      has_camera_info: !!meta.has_camera_info,
      has_gps: !!meta.has_gps,
      exif_date: meta.exif_date || null,
      camera_make: meta.camera_make || null,
      camera_model: meta.camera_model || null,
    };
  }

  _severityRank(sev) {
    const rank = { critical: 5, high: 4, significant: 3, moderate: 2, minor: 1, none: 0 };
    const r = rank[String(sev || "none")];
    if (r === undefined) {
      console.warn(`⚠️ Unknown severity: ${sev}`);
    }
    return r ?? 0;
  }

  _dedupeChanges(changes) {
    const map = new Map(); // type -> change
    for (const c of changes) {
      const prev = map.get(c.type);
      if (!prev) {
        map.set(c.type, c);
        continue;
      }
      // keep the higher severity; if tie, keep the more detailed (longer detail)
      const prevRank = this._severityRank(prev.severity);
      const nextRank = this._severityRank(c.severity);
      if (nextRank > prevRank) {
        map.set(c.type, c);
      } else if (nextRank === prevRank && String(c.detail || "").length > String(prev.detail || "").length) {
        map.set(c.type, c);
      }
    }
    return Array.from(map.values());
  }

  _rebuildFlagsFromChanges(changes, existingFlags = {}) {
    const flags = { ...existingFlags };
    // reset duplicates by re-deriving key ones
    const keysToDerive = [
      "cropped",
      "resolution_downscaled",
      "resolution_upscaled",
      "resolution_changed",
      "aspect_ratio_changed",
      "format_converted",
      "heavily_compressed",
      "recompressed",
      "metadata_stripped",
      "metadata_added",
      "metadata_tampered",
      "gps_stripped",
      "gps_added",
      "camera_info_removed",
      "camera_info_added",
      "significant_visual_edit",
      "minor_visual_edit",
    ];
    for (const k of keysToDerive) flags[k] = false;

    for (const c of changes) {
      if (c.type === "cropped_or_partial_match") flags.cropped = true;
      if (c.type === "resolution_downscaled") flags.resolution_downscaled = true;
      if (c.type === "resolution_upscaled") flags.resolution_upscaled = true;
      if (c.type === "resolution_changed") flags.resolution_changed = true;
      if (c.type === "aspect_ratio_changed") flags.aspect_ratio_changed = true;
      if (c.type === "format_converted") flags.format_converted = true;
      if (c.type === "heavily_compressed") flags.heavily_compressed = true;
      if (c.type === "recompressed") flags.recompressed = true;
      if (c.type === "metadata_stripped") flags.metadata_stripped = true;
      if (c.type === "metadata_added") flags.metadata_added = true;
      if (c.type === "metadata_inconsistent") flags.metadata_tampered = true;
      if (c.type === "gps_stripped") flags.gps_stripped = true;
      if (c.type === "gps_added") flags.gps_added = true;
      if (c.type === "camera_info_removed") flags.camera_info_removed = true;
      if (c.type === "camera_info_added") flags.camera_info_added = true;
      if (c.type === "significant_visual_edit") flags.significant_visual_edit = true;
      if (c.type === "minor_visual_edit") flags.minor_visual_edit = true;
    }

    return flags;
  }

  _describeCropRegion(region) {
    const descriptions = {
      center50: "the center 50% of the original",
      center60: "the center 60% of the original",
      center70: "the center 70% of the original",
      center80: "the center 80% of the original",
      topLeft: "the top-left quadrant",
      topRight: "the top-right quadrant",
      bottomLeft: "the bottom-left quadrant",
      bottomRight: "the bottom-right quadrant",
      topHalf: "the top half",
      bottomHalf: "the bottom half",
      leftHalf: "the left half",
      rightHalf: "the right half",
      topThird: "the top third",
      middleThird: "the middle third",
      bottomThird: "the bottom third",
      top2Thirds: "the top two-thirds",
      bottom2Thirds: "the bottom two-thirds",
      full: "the full image",
    };
    return descriptions[region] || region;
  }

  _generateChangeSummary(changes, flags, similarity) {
    if (changes.length === 0) {
      if (similarity === 100) return "Exact duplicate — no detectable changes";
      return `Near-identical copy (${similarity}% match)`;
    }

    const parts = [];

    if (flags.cropped) parts.push("cropped/partial match");
    if (flags.resolution_downscaled) parts.push("downscaled");
    if (flags.resolution_upscaled) parts.push("upscaled");
    if (flags.resolution_changed) parts.push("resized");
    if (flags.aspect_ratio_changed) parts.push("aspect ratio changed");
    if (flags.format_converted) parts.push("format converted");
    if (flags.heavily_compressed) parts.push("heavily compressed");
    if (flags.recompressed) parts.push("recompressed");
    if (flags.metadata_stripped) parts.push("metadata removed");
    if (flags.metadata_added) parts.push("metadata added");
    if (flags.metadata_tampered) parts.push("metadata inconsistent");
    if (flags.gps_stripped) parts.push("GPS removed");
    if (flags.gps_added) parts.push("GPS added");
    if (flags.camera_info_removed) parts.push("camera info removed");
    if (flags.camera_info_added) parts.push("camera info added");
    if (flags.significant_visual_edit) parts.push("visually edited");
    if (flags.minor_visual_edit) parts.push("minor edits");

    if (parts.length === 0) return `Modified copy (${similarity}% match)`;
    return `${parts.join(", ")} (${similarity}% match)`;
  }

  _overallSeverity(changes) {
    if (changes.some((c) => c.severity === "critical")) return "critical";
    if (changes.some((c) => c.severity === "high")) return "high";
    if (changes.some((c) => c.severity === "significant")) return "significant";
    if (changes.some((c) => c.severity === "moderate")) return "moderate";
    if (changes.some((c) => c.severity === "minor")) return "minor";
    return "none";
  }

  _formatBytes(bytes) {
    if (!bytes) return "unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // ============================================================================
  // SMART PARENT/CHILD DIRECTION
  // ============================================================================

  determineParentChild(existingMeta, newMeta) {
    const existing = this._normalizeMeta(existingMeta);
    const incoming = this._normalizeMeta(newMeta);

    let existingScore = 0;
    let newScore = 0;
    const evidence = [];

    // 1) Timestamp (weight 3) - earlier submission is likely original in *your* system
    const eDateRaw = existing.first_seen || existing.upload_date;
    const nDateRaw = incoming.first_seen || incoming.upload_date;

    if (eDateRaw && nDateRaw) {
      const eDate = new Date(eDateRaw);
      const nDate = new Date(nDateRaw);
      if (eDate < nDate) {
        existingScore += 3;
        evidence.push("existing was submitted first");
      } else if (nDate < eDate) {
        newScore += 3;
        evidence.push("new file was submitted first");
      }
    }

    // 2) Resolution (weight 2)
    if (existing.width && existing.height && incoming.width && incoming.height) {
      const ePix = existing.width * existing.height;
      const nPix = incoming.width * incoming.height;
      if (ePix > nPix * 1.1) {
        existingScore += 2;
        evidence.push("existing has higher resolution");
      } else if (nPix > ePix * 1.1) {
        newScore += 2;
        evidence.push("new file has higher resolution");
      }
    }

    // 3) File size (weight 1)
    if (existing.file_size && incoming.file_size) {
      if (existing.file_size > incoming.file_size * 1.2) {
        existingScore += 1;
        evidence.push("existing has larger file size");
      } else if (incoming.file_size > existing.file_size * 1.2) {
        newScore += 1;
        evidence.push("new file has larger file size");
      }
    }

    // 4) EXIF presence (weight 2)
    if (existing.has_exif && !incoming.has_exif) {
      existingScore += 2;
      evidence.push("existing has EXIF metadata");
    } else if (!existing.has_exif && incoming.has_exif) {
      newScore += 2;
      evidence.push("new file has EXIF metadata");
    }

    const existingIsParent = existingScore >= newScore;

    return {
      parent_fingerprint: existingIsParent ? existing.fingerprint : incoming.fingerprint,
      child_fingerprint: existingIsParent ? incoming.fingerprint : existing.fingerprint,
      confidence: Math.abs(existingScore - newScore),
      direction: existingIsParent ? "existing_is_parent" : "new_is_parent",
      evidence,
    };
  }

  // ============================================================================
  // RELATIONSHIP CLASSIFICATION
  // ============================================================================

  getRelationshipType(similarity, isScreenshot = false, matchType = "full_image", changeFlags = {}) {
    if (similarity === 100) return "exact_match";
    if (isScreenshot) return "screenshot";

    if (changeFlags.metadata_tampered) return "metadata_inconsistent";
    if (changeFlags.metadata_stripped && changeFlags.recompressed) return "sanitized";
    if (changeFlags.cropped) return "cropped";
    if (changeFlags.heavily_compressed) return "heavily_recompressed";
    if (changeFlags.format_converted && similarity >= 95) return "format_converted";
    if (changeFlags.resolution_downscaled) return "downscaled";
    if (changeFlags.resolution_upscaled) return "upscaled";
    if (changeFlags.metadata_stripped) return "metadata_stripped";

    if (similarity >= 95) return "recompressed";
    if (matchType === "region_match") return "cropped_or_partial";
    if (similarity >= 85) return "derivative";
    return "similar";
  }

  // ============================================================================
  // RELATIONSHIP RECORDING (with diff storage)
  // ============================================================================

  async recordRelationship(parentFingerprint, childFingerprint, relationshipType, similarityScore, changeDiff = null) {
    try {
      await db.query(
        `
        INSERT INTO content_relationships
          (parent_fingerprint, child_fingerprint, relationship_type, similarity_score, change_diff)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (parent_fingerprint, child_fingerprint) DO UPDATE
        SET relationship_type = $3, similarity_score = $4, change_diff = $5, detected_at = CURRENT_TIMESTAMP
      `,
        [parentFingerprint, childFingerprint, relationshipType, similarityScore, changeDiff ? JSON.stringify(changeDiff) : null]
      );

      await db.query(
        `
        UPDATE verifications
        SET is_derivative = TRUE, parent_fingerprint = $1
        WHERE fingerprint = $2 AND is_derivative = FALSE
      `,
        [parentFingerprint, childFingerprint]
      );

      return true;
    } catch (err) {
      // Backward compatibility if change_diff column isn't present
      if (err.message.includes("change_diff")) {
        try {
          await db.query(
            `
            INSERT INTO content_relationships
              (parent_fingerprint, child_fingerprint, relationship_type, similarity_score)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (parent_fingerprint, child_fingerprint) DO UPDATE
            SET relationship_type = $3, similarity_score = $4, detected_at = CURRENT_TIMESTAMP
          `,
            [parentFingerprint, childFingerprint, relationshipType, similarityScore]
          );

          await db.query(
            `
            UPDATE verifications
            SET is_derivative = TRUE, parent_fingerprint = $1
            WHERE fingerprint = $2 AND is_derivative = FALSE
          `,
            [parentFingerprint, childFingerprint]
          );

          console.log("⚠️ change_diff column not yet added — run migration");
          return true;
        } catch (fallbackErr) {
          console.error("⚠️ Error recording relationship (fallback):", fallbackErr.message);
          return false;
        }
      }

      console.error("⚠️ Error recording relationship:", err.message);
      return false;
    }
  }

  // ============================================================================
  // MAIN ENTRY POINT
  // ============================================================================

  async checkAndRecordProvenance(fingerprint, phash, regionHashes = null, isScreenshot = false, fileMeta = {}) {
    try {
      const similar = await this.findSimilarContent(phash, regionHashes, fingerprint, 75);

      if (similar.length === 0) {
        console.log("   ✅ Original content (no similar content found)");
        return { is_original: true, similar_content: [], relationships_recorded: 0, changes_detected: [] };
      }

      console.log(`   ⚠️ Found ${similar.length} similar content matches`);

      let recorded = 0;
      const allChanges = [];

      for (const match of similar.slice(0, 5)) {
        const parentMeta = {
          fingerprint: match.fingerprint,
          first_seen: match.first_seen,
          file_size: match.file_size,
          file_type: match.file_type,
          media_kind: match.media_kind,
          width: match.width || null,
          height: match.height || null,
          has_camera_info: match.has_camera_info || false,
          has_gps: match.has_gps || false,
          has_exif: match.has_exif || false,
          exif_date: match.exif_date || null,
          camera_make: match.camera_make || null,
          camera_model: match.camera_model || null,
        };

        const newMeta = {
          fingerprint,
          upload_date: fileMeta.upload_date || new Date().toISOString(),
          width: fileMeta.width || null,
          height: fileMeta.height || null,
          file_size: fileMeta.file_size || null,
          format: fileMeta.format || null,
          file_type: fileMeta.file_type || null,
          has_camera_info: !!fileMeta.has_camera_info,
          has_gps: !!fileMeta.has_gps,
          has_exif: !!fileMeta.has_exif,
          exif_date: fileMeta.exif_date || null,
          camera_make: fileMeta.camera_make || null,
          camera_model: fileMeta.camera_model || null,
        };

        const changeDiff = this.detectChanges(parentMeta, newMeta, match.similarity, match.match_type, match.matched_regions);

        const direction = this.determineParentChild(parentMeta, newMeta);

        const relType = this.getRelationshipType(match.similarity, isScreenshot, match.match_type, changeDiff.change_flags);

        const success = await this.recordRelationship(direction.parent_fingerprint, direction.child_fingerprint, relType, match.similarity, changeDiff);

        if (success) {
          recorded++;
          console.log(
            `   📎 ${relType}: ${match.fingerprint.substring(0, 8)}... (${match.similarity}%) [${changeDiff.summary}]`
          );
        }

        allChanges.push({
          match_fingerprint: match.fingerprint.substring(0, 8),
          similarity: match.similarity,
          relationship_type: relType,
          direction: direction.direction,
          direction_evidence: direction.evidence,
          changes: changeDiff,
        });
      }

      const safeSimilarContent = similar.slice(0, 5).map((match, i) => ({
        fingerprint_prefix: match.fingerprint.substring(0, 8),
        similarity: match.similarity,
        first_seen: match.first_seen,
        media_kind: match.media_kind,
        match_type: match.match_type,
        relationship_type:
          allChanges[i]?.relationship_type || this.getRelationshipType(match.similarity, isScreenshot, match.match_type),
        changes: allChanges[i]?.changes || null,
      }));

      const safeMostSimilar = similar[0]
        ? {
            fingerprint_prefix: similar[0].fingerprint.substring(0, 8),
            similarity: similar[0].similarity,
            first_seen: similar[0].first_seen,
            match_type: similar[0].match_type,
            relationship_type:
              allChanges[0]?.relationship_type || this.getRelationshipType(similar[0].similarity, isScreenshot, similar[0].match_type),
            changes: allChanges[0]?.changes || null,
          }
        : null;

      return {
        is_original: false,
        similar_content: safeSimilarContent,
        relationships_recorded: recorded,
        most_similar: safeMostSimilar,
        changes_detected: allChanges,
      };
    } catch (err) {
      console.error("⚠️ Error checking provenance:", err.message);
      return { is_original: true, error: err.message, changes_detected: [] };
    }
  }

  // ============================================================================
  // TIMELINE (enhanced with change details)
  // ============================================================================

  async getTimeline(fingerprint) {
    try {
      const timeline = [];

      const verificationsResult = await db.query(
        `
        SELECT * FROM verifications
        WHERE fingerprint = $1
        ORDER BY upload_date ASC
      `,
        [fingerprint]
      );

      const verifications = verificationsResult.rows;
      if (verifications.length === 0) {
        return { found: false, timeline: [] };
      }

      const first = verifications[0];
      timeline.push({
        timestamp: first.upload_date,
        event_type: "first_verified",
        details: { media_kind: first.media_kind, filename: first.original_filename, file_size: first.file_size },
      });

      if (first.polygon_tx_hash) {
        timeline.push({
          timestamp: first.polygon_timestamp || first.upload_date,
          event_type: "blockchain_confirmed",
          details: { network: "polygon", block_number: first.polygon_block_number, transaction_hash: first.polygon_tx_hash },
        });
      }

      if (first.bitcoin_proof_status === "confirmed") {
        timeline.push({
          timestamp: first.bitcoin_submitted_at,
          event_type: "blockchain_confirmed",
          details: { network: "bitcoin", status: "confirmed" },
        });
      }

      for (let i = 1; i < verifications.length; i++) {
        timeline.push({
          timestamp: verifications[i].upload_date,
          event_type: "re_verification",
          details: { verification_number: i + 1 },
        });
      }

      const derivativesResult = await db.query(
        `
        SELECT DISTINCT ON (cr.child_fingerprint) cr.*, v.upload_date, v.media_kind, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.child_fingerprint
        WHERE cr.parent_fingerprint = $1
        ORDER BY cr.child_fingerprint, cr.detected_at ASC
      `,
        [fingerprint]
      );

      for (const deriv of derivativesResult.rows) {
        let changeDiff = null;
        if (deriv.change_diff) {
          try {
            changeDiff = typeof deriv.change_diff === "string" ? JSON.parse(deriv.change_diff) : deriv.change_diff;
          } catch {
            /* ignore */
          }
        }

        timeline.push({
          timestamp: deriv.detected_at,
          event_type: "derivative_detected",
          details: {
            child_fingerprint: deriv.child_fingerprint,
            relationship_type: deriv.relationship_type,
            similarity: deriv.similarity_score,
            filename: deriv.original_filename,
            changes: changeDiff,
          },
        });
      }

      const parentResult = await db.query(
        `
        SELECT cr.*, v.upload_date, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.parent_fingerprint
        WHERE cr.child_fingerprint = $1
      `,
        [fingerprint]
      );

      let parent = null;
      if (parentResult.rows.length > 0) {
        const p = parentResult.rows[0];
        let changeDiff = null;
        if (p.change_diff) {
          try {
            changeDiff = typeof p.change_diff === "string" ? JSON.parse(p.change_diff) : p.change_diff;
          } catch {
            /* ignore */
          }
        }

        parent = {
          fingerprint: p.parent_fingerprint,
          relationship_type: p.relationship_type,
          similarity: p.similarity_score,
          first_seen: p.upload_date,
          changes: changeDiff,
        };
      }

      timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const countResult = await db.query("SELECT COUNT(*) as count FROM verifications WHERE fingerprint = $1", [fingerprint]);

      return {
        found: true,
        fingerprint,
        first_seen: first.upload_date,
        verification_count: parseInt(countResult.rows[0].count, 10),
        is_derivative: !!parent,
        parent,
        derivatives_count: derivativesResult.rows.length,
        timeline,
      };
    } catch (err) {
      console.error("⚠️ Error getting timeline:", err.message);
      return { found: false, error: err.message };
    }
  }

  // ============================================================================
  // STATS
  // ============================================================================

  async getStats() {
    try {
      const relationshipsCount = await db.query("SELECT COUNT(*) as count FROM content_relationships");
      const derivativesCount = await db.query("SELECT COUNT(*) as count FROM verifications WHERE is_derivative = TRUE");
      const uniqueParents = await db.query("SELECT COUNT(DISTINCT parent_fingerprint) as count FROM content_relationships");
      const withRegionHashes = await db.query("SELECT COUNT(*) as count FROM verifications WHERE phash_regions IS NOT NULL");

      let typeBreakdown = {};
      try {
        const typeResult = await db.query(`
          SELECT relationship_type, COUNT(*) as count
          FROM content_relationships
          GROUP BY relationship_type
          ORDER BY count DESC
        `);
        typeBreakdown = Object.fromEntries(typeResult.rows.map((r) => [r.relationship_type, parseInt(r.count, 10)]));
      } catch {
        /* ignore */
      }

      return {
        total_relationships: parseInt(relationshipsCount.rows[0].count, 10),
        total_derivatives: parseInt(derivativesCount.rows[0].count, 10),
        unique_originals_with_derivatives: parseInt(uniqueParents.rows[0].count, 10),
        verifications_with_region_hashes: parseInt(withRegionHashes.rows[0].count, 10),
        relationship_types: typeBreakdown,
      };
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = new ProvenanceService();