/**
 * Provenance Service v3
 * Enhanced content lineage tracking with detailed change detection
 * 
 * IMPROVEMENTS OVER v2:
 * 1. Change Detection - captures WHAT changed (resolution, format, metadata, color, crop, watermark)
 * 2. Diff Storage - stores detailed diffs in content_relationships
 * 3. Scalable Search - uses pHash prefix filtering in SQL instead of loading all rows
 * 4. Smart Direction - determines parent/child based on evidence (resolution, timestamp, metadata)
 * 5. Change Summary - human-readable description of modifications
 */

const db = require('../db-minimal');
const sharp = require('sharp');

class ProvenanceService {
  
  // ============================================================================
  // MULTI-REGION PHASH GENERATION (unchanged from v2)
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
      bottom2Thirds: (w, h) => ({ left: 0, top: h * 0.34, width: w, height: h * 0.66 })
    };
  }

  async generateRegionPHash(input, regionFn = null) {
    try {
      let image = sharp(input);
      
      if (regionFn) {
        const meta = await sharp(input).metadata();
        const bounds = regionFn(meta.width, meta.height);
        image = image.extract({
          left: Math.floor(bounds.left),
          top: Math.floor(bounds.top),
          width: Math.floor(bounds.width),
          height: Math.floor(bounds.height)
        });
      }
      
      const { data } = await sharp(await image.toBuffer())
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      
      let binaryHash = '';
      for (let i = 0; i < data.length; i++) binaryHash += data[i] > avg ? '1' : '0';
      
      let hexHash = '';
      for (let i = 0; i < binaryHash.length; i += 4) {
        hexHash += parseInt(binaryHash.substr(i, 4), 2).toString(16);
      }
      
      return hexHash;
    } catch (err) {
      console.error(`⚠️ Error generating region pHash: ${err.message}`);
      return null;
    }
  }

  async generateAllRegionHashes(input) {
    const regions = this.getRegionDefinitions();
    const hashes = {};
    
    console.log('🔍 Generating multi-region pHashes (18 regions)...');
    const startTime = Date.now();
    
    for (const [name, regionFn] of Object.entries(regions)) {
      const hash = await this.generateRegionPHash(input, regionFn);
      if (hash) hashes[name] = hash;
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Generated ${Object.keys(hashes).length} region pHashes in ${elapsed}ms`);
    
    return hashes;
  }

  // ============================================================================
  // PHASH COMPARISON (unchanged from v2)
  // ============================================================================
  
  hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return Infinity;
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const byte1 = parseInt(hash1[i], 16);
      const byte2 = parseInt(hash2[i], 16);
      let xor = byte1 ^ byte2;
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
    return Math.round(Math.max(0, 100 - (distance / maxBits * 100)));
  }

  compareRegionHashes(hashes1, hashes2) {
    let bestMatch = { similarity: 0, region1: null, region2: null };
    
    const regions = Object.keys(hashes1).filter(r => hashes2[r]);
    
    for (const region of regions) {
      const sim = this.similarityScore(hashes1[region], hashes2[region]);
      if (sim > bestMatch.similarity) {
        bestMatch = { similarity: sim, region1: region, region2: region };
      }
    }
    
    return bestMatch;
  }

  // ============================================================================
  // NEW: SCALABLE SEARCH (replaces LIMIT 1000 full scan)
  // ============================================================================

  /**
   * Find similar content using pHash prefix filtering in SQL
   * Instead of loading 1000+ rows and comparing in JS, we:
   * 1. Use the first 8 chars of pHash as a prefix filter (catches ~85%+ similarity)
   * 2. Only load candidates that share prefix similarity
   * 3. Do precise comparison on the smaller candidate set
   */
  async findSimilarContent(phash, regionHashes = null, excludeFingerprint = null, threshold = 85) {
    console.log('🔍 findSimilarContent:', { hasPhash: !!phash, hasRegions: !!regionHashes, exclude: typeof excludeFingerprint === 'string' ? excludeFingerprint.substring(0,8) : excludeFingerprint, threshold });
    if (!phash && !regionHashes) return [];
    
    try {
      const similar = [];
      
      // TIER 1: Exact and near-exact matches via pHash prefix
      // First 4 hex chars = first 16 bits. Matching prefix means <=~15% difference
      if (phash) {
        const prefixLengths = [8, 6, 4]; // Try progressively shorter prefixes
        let candidates = [];
        
        for (const prefixLen of prefixLengths) {
          const prefix = phash.substring(0, prefixLen);
          
          let query = `
            SELECT DISTINCT ON (fingerprint) 
              fingerprint, phash, phash_regions, upload_date, media_kind, 
              original_filename, file_size, file_type, width, height,
              has_camera_info, has_gps, exif_date, camera_make, camera_model
            FROM verifications 
            WHERE phash IS NOT NULL
              AND LEFT(phash, $1) = $2
          `;
          const params = [prefixLen, prefix];
          
          if (excludeFingerprint) {
            query += ` AND fingerprint != $3`;
            params.push(excludeFingerprint);
          }
          
          query += ` ORDER BY fingerprint, (width IS NULL) ASC, upload_date DESC LIMIT 500`;
          
          const result = await db.query(query, params);
          candidates = result.rows;
          if (candidates.length > 0) {
            console.log('📊 First candidate from DB:', { fp: candidates[0].fingerprint?.substring(0,8), w: candidates[0].width, h: candidates[0].height });
          }
          
          // If we got results with a long prefix, those are high-quality matches
          if (candidates.length > 0 && prefixLen >= 6) break;
          // If short prefix returns too many, that's fine - we'll filter in JS
          if (candidates.length > 0) break;
        }
        
        // Also get some candidates without prefix match for region comparison
        if (regionHashes && candidates.length < 50) {
          let regionQuery = `
            SELECT DISTINCT ON (fingerprint) 
              fingerprint, phash, phash_regions, upload_date, media_kind, 
              original_filename, file_size, file_type, width, height,
              has_camera_info, has_gps, exif_date, camera_make, camera_model
            FROM verifications 
            WHERE phash_regions IS NOT NULL
              AND phash IS NOT NULL
          `;
          
          // Build query with optional fingerprint exclusion
          let regionParams = [];
          if (excludeFingerprint) {
            regionQuery += ` AND fingerprint != $1`;
            regionParams.push(excludeFingerprint);
          }
          regionQuery += ` ORDER BY fingerprint, (width IS NULL) ASC, upload_date DESC LIMIT 500`;
          
          const regionResult = await db.query(regionQuery, regionParams);
          
          // Merge without duplicates
          const existingFps = new Set(candidates.map(c => c.fingerprint));
          for (const row of regionResult.rows) {
            if (!existingFps.has(row.fingerprint)) {
              candidates.push(row);
            }
          }
        }
        
        console.log('🔍 Candidates to score:', candidates.length);
        // Score all candidates
        for (const row of candidates) {
          let bestSimilarity = 0;
          let matchDetails = { region1: 'full', region2: 'full' };
          
          if (phash && row.phash) {
            bestSimilarity = this.similarityScore(phash, row.phash);
          }
          
          if (regionHashes && row.phash_regions) {
            try {
              const storedRegions = typeof row.phash_regions === 'string' 
                ? JSON.parse(row.phash_regions) 
                : row.phash_regions;
              
              const regionMatch = this.compareRegionHashes(regionHashes, storedRegions);
              
              if (regionMatch.similarity > bestSimilarity) {
                bestSimilarity = regionMatch.similarity;
                matchDetails = { region1: regionMatch.region1, region2: regionMatch.region2 };
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
          
          if (bestSimilarity >= threshold) {
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
              exif_date: row.exif_date || null,
              camera_make: row.camera_make || null,
              camera_model: row.camera_model || null,
              match_type: matchDetails.region1 === 'full' && matchDetails.region2 === 'full' 
                ? 'full_image' : 'region_match',
              matched_regions: matchDetails
            });
          }
        }
      }
      
      similar.sort((a, b) => b.similarity - a.similarity);
      return similar;
      
    } catch (err) {
      console.error('⚠️ Error finding similar content:', err.message);
      return [];
    }
  }

  // ============================================================================
  // NEW: CHANGE DETECTION - What specifically changed between two files
  // ============================================================================

  /**
   * Detect all changes between a parent and child file
   * @param {Object} parentMeta - Parent file metadata (from verifications table + image analysis)
   * @param {Object} childMeta - Child file metadata
   * @param {number} similarity - pHash similarity score
   * @param {string} matchType - 'full_image' or 'region_match'
   * @param {Object} matchedRegions - Which regions matched
   * @returns {Object} Detailed change report
   */
  detectChanges(parentMeta, childMeta, similarity, matchType, matchedRegions) {
    const changes = [];
    const changeFlags = {};
    
    // 1. RESOLUTION CHANGE
    console.log('📐 Resolution check:', { parent: { w: parentMeta.width, h: parentMeta.height }, child: { w: childMeta.width, h: childMeta.height } });
    if (parentMeta.width && childMeta.width && parentMeta.height && childMeta.height) {
      const parentPixels = parentMeta.width * parentMeta.height;
      const childPixels = childMeta.width * childMeta.height;
      
      if (parentMeta.width !== childMeta.width || parentMeta.height !== childMeta.height) {
        const scalePercent = Math.round((childPixels / parentPixels) * 100);
        
        // Check if aspect ratio changed
        const parentAR = (parentMeta.width / parentMeta.height).toFixed(3);
        const childAR = (childMeta.width / childMeta.height).toFixed(3);
        const aspectChanged = parentAR !== childAR;
        
        if (childPixels < parentPixels * 0.5) {
          changes.push({
            type: 'resolution_downscaled',
            severity: 'significant',
            detail: `Downscaled to ${scalePercent}% (${parentMeta.width}×${parentMeta.height} → ${childMeta.width}×${childMeta.height})`,
            parent_value: `${parentMeta.width}×${parentMeta.height}`,
            child_value: `${childMeta.width}×${childMeta.height}`,
            scale_percent: scalePercent
          });
          changeFlags.resolution_downscaled = true;
        } else if (childPixels > parentPixels * 1.5) {
          changes.push({
            type: 'resolution_upscaled',
            severity: 'moderate',
            detail: `Upscaled to ${scalePercent}% (${parentMeta.width}×${parentMeta.height} → ${childMeta.width}×${childMeta.height})`,
            parent_value: `${parentMeta.width}×${parentMeta.height}`,
            child_value: `${childMeta.width}×${childMeta.height}`,
            scale_percent: scalePercent
          });
          changeFlags.resolution_upscaled = true;
        } else {
          changes.push({
            type: 'resolution_changed',
            severity: 'minor',
            detail: `Resolution changed (${parentMeta.width}×${parentMeta.height} → ${childMeta.width}×${childMeta.height})`,
            parent_value: `${parentMeta.width}×${parentMeta.height}`,
            child_value: `${childMeta.width}×${childMeta.height}`,
            scale_percent: scalePercent
          });
          changeFlags.resolution_changed = true;
        }
        
        if (aspectChanged) {
          changes.push({
            type: 'aspect_ratio_changed',
            severity: 'significant',
            detail: `Aspect ratio changed (${parentAR} → ${childAR})`,
            parent_value: parentAR,
            child_value: childAR
          });
          changeFlags.aspect_ratio_changed = true;
        }
      }
    }
    
    // 2. FORMAT CHANGE
    if (parentMeta.format && childMeta.format) {
      const pFmt = parentMeta.format.toLowerCase();
      const cFmt = childMeta.format.toLowerCase();
      
      if (pFmt !== cFmt) {
        const lossyToLossy = ['jpeg', 'jpg', 'webp'].includes(pFmt) && ['jpeg', 'jpg', 'webp'].includes(cFmt);
        const losslessToLossy = ['png', 'tiff', 'bmp'].includes(pFmt) && ['jpeg', 'jpg', 'webp'].includes(cFmt);
        
        changes.push({
          type: 'format_converted',
          severity: losslessToLossy ? 'significant' : 'minor',
          detail: `Format converted (${pFmt} → ${cFmt})${losslessToLossy ? ' — quality loss likely' : ''}`,
          parent_value: pFmt,
          child_value: cFmt,
          quality_loss: losslessToLossy || lossyToLossy
        });
        changeFlags.format_converted = true;
      }
    }
    
    // 3. FILE SIZE CHANGE (indicates recompression)
    if (parentMeta.file_size && childMeta.file_size) {
      const sizeRatio = childMeta.file_size / parentMeta.file_size;
      
      if (sizeRatio < 0.5) {
        changes.push({
          type: 'heavily_compressed',
          severity: 'significant',
          detail: `File size reduced ${Math.round((1 - sizeRatio) * 100)}% (${this._formatBytes(parentMeta.file_size)} → ${this._formatBytes(childMeta.file_size)})`,
          parent_value: parentMeta.file_size,
          child_value: childMeta.file_size,
          compression_ratio: sizeRatio.toFixed(3)
        });
        changeFlags.heavily_compressed = true;
      } else if (sizeRatio < 0.8 || sizeRatio > 1.2) {
        changes.push({
          type: 'recompressed',
          severity: 'minor',
          detail: `File size changed ${sizeRatio < 1 ? 'reduced' : 'increased'} (${this._formatBytes(parentMeta.file_size)} → ${this._formatBytes(childMeta.file_size)})`,
          parent_value: parentMeta.file_size,
          child_value: childMeta.file_size,
          compression_ratio: sizeRatio.toFixed(3)
        });
        changeFlags.recompressed = true;
      }
    }
    
    // 4. METADATA CHANGES
    if (parentMeta.has_exif !== undefined && childMeta.has_exif !== undefined) {
      if (parentMeta.has_exif && !childMeta.has_exif) {
        changes.push({
          type: 'metadata_stripped',
          severity: 'significant',
          detail: 'EXIF metadata was removed — possible attempt to hide origin',
          parent_value: 'EXIF present',
          child_value: 'EXIF absent'
        });
        changeFlags.metadata_stripped = true;
      } else if (!parentMeta.has_exif && childMeta.has_exif) {
        changes.push({
          type: 'metadata_added',
          severity: 'significant',
          detail: 'EXIF metadata was added — possible metadata injection',
          parent_value: 'EXIF absent',
          child_value: 'EXIF present'
        });
        changeFlags.metadata_added = true;
      } else if (parentMeta.has_exif && childMeta.has_exif) {
        // Both have EXIF - check if camera info changed
        if (parentMeta.camera_make && childMeta.camera_make && 
            parentMeta.camera_make !== childMeta.camera_make) {
          changes.push({
            type: 'metadata_tampered',
            severity: 'high',
            detail: `Camera make changed (${parentMeta.camera_make} → ${childMeta.camera_make}) — metadata likely fabricated`,
            parent_value: parentMeta.camera_make,
            child_value: childMeta.camera_make
          });
          changeFlags.metadata_tampered = true;
        }
        
        if (parentMeta.gps_present && !childMeta.gps_present) {
          changes.push({
            type: 'gps_stripped',
            severity: 'moderate',
            detail: 'GPS location data was removed',
            parent_value: 'GPS present',
            child_value: 'GPS absent'
          });
          changeFlags.gps_stripped = true;
        }
      }
    }
    
    // 5. CROP DETECTION (from region matching)
    // Only report as cropped if similarity is below 98% — high similarity via region match
    // likely means color filter/recompression rather than actual crop
    if (matchType === 'region_match' && matchedRegions && similarity < 98) {
      const cropRegion = matchedRegions.region1 || matchedRegions.region2;
      const cropDescription = this._describeCropRegion(cropRegion);
      
      changes.push({
        type: 'cropped',
        severity: 'significant',
        detail: `Image was cropped — best match is ${cropDescription}`,
        matched_region: cropRegion,
        crop_description: cropDescription
      });
      changeFlags.cropped = true;
    } else if (matchType === 'region_match' && similarity >= 98) {
      // High similarity via region match = likely color adjustment, not crop
      changes.push({
        type: 'color_adjusted',
        severity: 'minor',
        detail: `Color or filter adjustment detected (${similarity}% match)`,
        similarity: similarity
      });
      changeFlags.color_adjusted = true;
    }
    
    // 6. METADATA STRIPPING DETECTION
    if (parentMeta.has_camera_info && !childMeta.has_camera_info) {
      changes.push({
        type: 'metadata_stripped',
        severity: 'critical',
        detail: parentMeta.camera_make && parentMeta.camera_model 
          ? `Camera information removed (was: ${parentMeta.camera_make} ${parentMeta.camera_model})`
          : 'Camera information was present in original but removed',
        parent_had_camera: true,
        child_has_camera: false
      });
      changeFlags.metadata_stripped = true;
    }
    
    // 7. GPS STRIPPING DETECTION
    if (parentMeta.has_gps && !childMeta.has_gps) {
      changes.push({
        type: 'gps_stripped',
        severity: 'critical',
        detail: 'GPS location data was present in original but removed',
        parent_had_gps: true,
        child_has_gps: false
      });
      changeFlags.gps_stripped = true;
    }
    
    // 8. DATE MODIFICATION DETECTION
    if (parentMeta.exif_date && childMeta.exif_date) {
      const parentDate = new Date(parentMeta.exif_date);
      const childDate = new Date(childMeta.exif_date);
      const daysDiff = Math.abs((childDate - parentDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 1) {
        changes.push({
          type: 'date_modified',
          severity: 'significant',
          detail: `EXIF date changed from ${parentDate.toISOString().split('T')[0]} to ${childDate.toISOString().split('T')[0]}`,
          parent_date: parentMeta.exif_date,
          child_date: childMeta.exif_date,
          days_difference: Math.round(daysDiff)
        });
        changeFlags.date_modified = true;
      }
    } else if (parentMeta.exif_date && !childMeta.exif_date) {
      changes.push({
        type: 'date_stripped',
        severity: 'significant',
        detail: `Original date (${new Date(parentMeta.exif_date).toISOString().split('T')[0]}) was removed`,
        parent_date: parentMeta.exif_date
      });
      changeFlags.date_stripped = true;
    }

    // 9. VISUAL SIMILARITY ASSESSMENT
    if (similarity < 100 && similarity >= 85 && !changeFlags.cropped) {
      // Something visual changed but not a crop
      if (similarity >= 95 && !changeFlags.format_converted && !changeFlags.recompressed) {
        changes.push({
          type: 'minor_visual_edit',
          severity: 'minor',
          detail: `Minor visual changes detected (${similarity}% similar) — possible color/contrast adjustment, watermark, or minor edit`,
          similarity: similarity
        });
        changeFlags.minor_visual_edit = true;
      } else if (similarity >= 85 && similarity < 95) {
        changes.push({
          type: 'significant_visual_edit',
          severity: 'significant',
          detail: `Significant visual changes detected (${similarity}% similar) — possible filter, overlay, text addition, or content modification`,
          similarity: similarity
        });
        changeFlags.significant_visual_edit = true;
      }
    }
    
    // Generate human-readable summary
    const summary = this._generateChangeSummary(changes, changeFlags, similarity);
    
    return {
      changes,
      change_flags: changeFlags,
      change_count: changes.length,
      summary,
      severity: this._overallSeverity(changes),
      similarity
    };
  }

  /**
   * Describe a crop region in plain language
   */
  _describeCropRegion(region) {
    const descriptions = {
      center50: 'the center 50% of the original',
      center60: 'the center 60% of the original',
      center70: 'the center 70% of the original',
      center80: 'the center 80% of the original',
      topLeft: 'the top-left quadrant',
      topRight: 'the top-right quadrant',
      bottomLeft: 'the bottom-left quadrant',
      bottomRight: 'the bottom-right quadrant',
      topHalf: 'the top half',
      bottomHalf: 'the bottom half',
      leftHalf: 'the left half',
      rightHalf: 'the right half',
      topThird: 'the top third',
      middleThird: 'the middle third',
      bottomThird: 'the bottom third',
      top2Thirds: 'the top two-thirds',
      bottom2Thirds: 'the bottom two-thirds',
      full: 'the full image'
    };
    return descriptions[region] || region;
  }

  /**
   * Generate human-readable change summary
   */
  _generateChangeSummary(changes, flags, similarity) {
    if (changes.length === 0) {
      if (similarity === 100) return 'Exact duplicate — no detectable changes';
      return `Near-identical copy (${similarity}% match)`;
    }
    
    const parts = [];
    
    if (flags.cropped) parts.push('cropped');
    if (flags.resolution_downscaled) parts.push('downscaled');
    if (flags.resolution_upscaled) parts.push('upscaled');
    if (flags.resolution_changed) parts.push('resized');
    if (flags.aspect_ratio_changed) parts.push('aspect ratio changed');
    if (flags.format_converted) parts.push('format converted');
    if (flags.heavily_compressed) parts.push('heavily compressed');
    if (flags.recompressed) parts.push('recompressed');
    if (flags.metadata_stripped) parts.push('metadata stripped');
    if (flags.metadata_added) parts.push('metadata injected');
    if (flags.metadata_tampered) parts.push('metadata tampered');
    if (flags.gps_stripped) parts.push('GPS removed');
    if (flags.significant_visual_edit) parts.push('visually edited');
    if (flags.minor_visual_edit) parts.push('minor edits');
    
    if (parts.length === 0) return `Modified copy (${similarity}% match)`;
    
    return `${parts.join(', ')} (${similarity}% match)`;
  }

  /**
   * Determine overall severity from change list
   */
  _overallSeverity(changes) {
    if (changes.some(c => c.severity === 'high')) return 'high';
    if (changes.some(c => c.severity === 'significant')) return 'significant';
    if (changes.some(c => c.severity === 'moderate')) return 'moderate';
    if (changes.some(c => c.severity === 'minor')) return 'minor';
    return 'none';
  }

  /**
   * Format bytes to human-readable
   */
  _formatBytes(bytes) {
    if (!bytes) return 'unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // ============================================================================
  // NEW: SMART PARENT/CHILD DIRECTION
  // ============================================================================

  /**
   * Determine which file is the likely original (parent) based on evidence
   * Returns the fingerprint that should be the parent
   * 
   * Evidence hierarchy:
   * 1. Earlier timestamp (strongest signal)
   * 2. Higher resolution (originals are usually larger)
   * 3. Larger file size (less compression = closer to original)
   * 4. Has EXIF data (originals usually have metadata)
   * 5. Has more metadata (less stripped)
   */
  determineParentChild(existingMeta, newMeta) {
    let existingScore = 0;
    let newScore = 0;
    const evidence = [];
    
    // 1. Timestamp (weight: 3) — earlier submission is likely the original
    if (existingMeta.first_seen && newMeta.upload_date) {
      const existingDate = new Date(existingMeta.first_seen);
      const newDate = new Date(newMeta.upload_date);
      if (existingDate < newDate) {
        existingScore += 3;
        evidence.push('existing was submitted first');
      } else if (newDate < existingDate) {
        newScore += 3;
        evidence.push('new file was submitted first');
      }
    }
    
    // 2. Resolution (weight: 2) — higher res is likely the original
    if (existingMeta.width && existingMeta.height && newMeta.width && newMeta.height) {
      const existingPixels = existingMeta.width * existingMeta.height;
      const newPixels = newMeta.width * newMeta.height;
      if (existingPixels > newPixels * 1.1) {
        existingScore += 2;
        evidence.push('existing has higher resolution');
      } else if (newPixels > existingPixels * 1.1) {
        newScore += 2;
        evidence.push('new file has higher resolution');
      }
    }
    
    // 3. File size (weight: 1) — larger usually means less compressed
    if (existingMeta.file_size && newMeta.file_size) {
      if (existingMeta.file_size > newMeta.file_size * 1.2) {
        existingScore += 1;
        evidence.push('existing has larger file size');
      } else if (newMeta.file_size > existingMeta.file_size * 1.2) {
        newScore += 1;
        evidence.push('new file has larger file size');
      }
    }
    
    // 4. EXIF presence (weight: 2) — originals usually have metadata
    if (existingMeta.has_exif && !newMeta.has_exif) {
      existingScore += 2;
      evidence.push('existing has EXIF metadata');
    } else if (!existingMeta.has_exif && newMeta.has_exif) {
      newScore += 2;
      evidence.push('new file has EXIF metadata');
    }
    
    // Default: existing is parent (it was here first in our system)
    const existingIsParent = existingScore >= newScore;
    
    return {
      parent_fingerprint: existingIsParent ? existingMeta.fingerprint : newMeta.fingerprint,
      child_fingerprint: existingIsParent ? newMeta.fingerprint : existingMeta.fingerprint,
      confidence: Math.abs(existingScore - newScore),
      direction: existingIsParent ? 'existing_is_parent' : 'new_is_parent',
      evidence
    };
  }

  // ============================================================================
  // ENHANCED RELATIONSHIP CLASSIFICATION
  // ============================================================================

  /**
   * Enhanced relationship type with change-aware classification
   */
  getRelationshipType(similarity, isScreenshot = false, matchType = 'full_image', changeFlags = {}) {
    if (similarity === 100) return 'exact_match';
    if (isScreenshot) return 'screenshot';
    
    // Use change flags for more precise classification
    if (changeFlags.metadata_tampered) return 'metadata_tampered';
    if (changeFlags.metadata_stripped && changeFlags.recompressed) return 'sanitized';
    if (changeFlags.cropped) return 'cropped';
    if (changeFlags.heavily_compressed) return 'heavily_recompressed';
    if (changeFlags.format_converted && similarity >= 95) return 'format_converted';
    if (changeFlags.resolution_downscaled) return 'downscaled';
    if (changeFlags.resolution_upscaled) return 'upscaled';
    if (changeFlags.metadata_stripped) return 'metadata_stripped';
    
    // Fallback to similarity-based
    if (similarity >= 95) return 'recompressed';
    if (matchType === 'region_match') return 'cropped';
    if (similarity >= 85) return 'derivative';
    return 'similar';
  }

  // ============================================================================
  // ENHANCED RELATIONSHIP RECORDING (with diff storage)
  // ============================================================================

  /**
   * Record a relationship with full change diff
   */
  async recordRelationship(parentFingerprint, childFingerprint, relationshipType, similarityScore, changeDiff = null) {
    try {
      await db.query(`
        INSERT INTO content_relationships 
          (parent_fingerprint, child_fingerprint, relationship_type, similarity_score, change_diff)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (parent_fingerprint, child_fingerprint) DO UPDATE
        SET relationship_type = $3, similarity_score = $4, change_diff = $5, detected_at = CURRENT_TIMESTAMP
      `, [parentFingerprint, childFingerprint, relationshipType, similarityScore, 
          changeDiff ? JSON.stringify(changeDiff) : null]);
      
      await db.query(`
        UPDATE verifications 
        SET is_derivative = TRUE, parent_fingerprint = $1
        WHERE fingerprint = $2 AND is_derivative = FALSE
      `, [parentFingerprint, childFingerprint]);
      
      return true;
    } catch (err) {
      // If change_diff column doesn't exist yet, fall back to without it
      if (err.message.includes('change_diff')) {
        try {
          await db.query(`
            INSERT INTO content_relationships 
              (parent_fingerprint, child_fingerprint, relationship_type, similarity_score)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (parent_fingerprint, child_fingerprint) DO UPDATE
            SET relationship_type = $3, similarity_score = $4, detected_at = CURRENT_TIMESTAMP
          `, [parentFingerprint, childFingerprint, relationshipType, similarityScore]);
          
          await db.query(`
            UPDATE verifications 
            SET is_derivative = TRUE, parent_fingerprint = $1
            WHERE fingerprint = $2 AND is_derivative = FALSE
          `, [parentFingerprint, childFingerprint]);
          
          console.log('⚠️ change_diff column not yet added — run migration');
          return true;
        } catch (fallbackErr) {
          console.error('⚠️ Error recording relationship (fallback):', fallbackErr.message);
          return false;
        }
      }
      console.error('⚠️ Error recording relationship:', err.message);
      return false;
    }
  }

  // ============================================================================
  // ENHANCED PROVENANCE CHECK (main entry point)
  // ============================================================================

  /**
   * Enhanced check with change detection and smart direction
   * 
   * @param {string} fingerprint - SHA256 of the new file
   * @param {string} phash - Primary pHash
   * @param {Object} regionHashes - All region hashes
   * @param {boolean} isScreenshot - Whether screenshot detected
   * @param {Object} fileMeta - Metadata about the new file:
   *   { width, height, format, file_size, file_type, has_exif, camera_make, gps_present, upload_date }
   */
  async checkAndRecordProvenance(fingerprint, phash, regionHashes = null, isScreenshot = false, fileMeta = {}) {
    try {
      const similar = await this.findSimilarContent(phash, regionHashes, fingerprint, 75);
      
      if (similar.length === 0) {
        console.log('   ✅ Original content (no similar content found)');
        return {
          is_original: true,
          similar_content: [],
          relationships_recorded: 0,
          changes_detected: []
        };
      }
      
      console.log(`   ⚠️ Found ${similar.length} similar content matches`);
      
      let recorded = 0;
      const allChanges = [];
      
      for (const match of similar.slice(0, 5)) {
        // Get parent metadata for comparison
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
          exif_date: match.exif_date || null,
          camera_make: match.camera_make || null,
          camera_model: match.camera_model || null
        };
        
        const newMeta = {
          fingerprint,
          upload_date: fileMeta.upload_date || new Date().toISOString(),
          width: fileMeta.width || null,
          height: fileMeta.height || null,
          file_size: fileMeta.file_size || null,
          format: fileMeta.format || null,
          file_type: fileMeta.file_type || null,
          has_camera_info: fileMeta.has_camera_info || false,
          has_gps: fileMeta.has_gps || false,
          exif_date: fileMeta.exif_date || null,
          camera_make: fileMeta.camera_make || null,
          camera_model: fileMeta.camera_model || null
        };
        
        // Detect what changed
        const changeDiff = this.detectChanges(
          parentMeta, newMeta, 
          match.similarity, match.match_type, match.matched_regions
        );
        
        // Determine parent/child direction
        const direction = this.determineParentChild(parentMeta, newMeta);
        
        // Get enhanced relationship type
        const relType = this.getRelationshipType(
          match.similarity, isScreenshot, match.match_type, changeDiff.change_flags
        );
        
        // Record with full diff
        const success = await this.recordRelationship(
          direction.parent_fingerprint,
          direction.child_fingerprint,
          relType,
          match.similarity,
          changeDiff
        );
        
        if (success) {
          recorded++;
          console.log(`   📎 ${relType}: ${match.fingerprint.substring(0, 8)}... (${match.similarity}%) [${changeDiff.summary}]`);
        }
        
        allChanges.push({
          match_fingerprint: match.fingerprint.substring(0, 8),
          similarity: match.similarity,
          relationship_type: relType,
          direction: direction.direction,
          direction_evidence: direction.evidence,
          changes: changeDiff
        });
      }
      
      // Build privacy-safe response
      const safeSimilarContent = similar.slice(0, 5).map((match, i) => ({
        fingerprint_prefix: match.fingerprint.substring(0, 8),
        similarity: match.similarity,
        first_seen: match.first_seen,
        media_kind: match.media_kind,
        match_type: match.match_type,
        relationship_type: allChanges[i]?.relationship_type || 
          this.getRelationshipType(match.similarity, isScreenshot, match.match_type),
        changes: allChanges[i]?.changes || null
      }));
      
      const safeMostSimilar = similar[0] ? {
        fingerprint_prefix: similar[0].fingerprint.substring(0, 8),
        similarity: similar[0].similarity,
        first_seen: similar[0].first_seen,
        match_type: similar[0].match_type,
        relationship_type: allChanges[0]?.relationship_type ||
          this.getRelationshipType(similar[0].similarity, isScreenshot, similar[0].match_type),
        changes: allChanges[0]?.changes || null
      } : null;
      
      return {
        is_original: false,
        similar_content: safeSimilarContent,
        relationships_recorded: recorded,
        most_similar: safeMostSimilar,
        changes_detected: allChanges
      };
      
    } catch (err) {
      console.error('⚠️ Error checking provenance:', err.message);
      return { is_original: true, error: err.message, changes_detected: [] };
    }
  }

  // ============================================================================
  // TIMELINE (enhanced with change details)
  // ============================================================================

  async getTimeline(fingerprint) {
    try {
      const timeline = [];
      
      const verificationsResult = await db.query(`
        SELECT * FROM verifications 
        WHERE fingerprint = $1 
        ORDER BY upload_date ASC
      `, [fingerprint]);
      
      const verifications = verificationsResult.rows;
      
      if (verifications.length === 0) {
        return { found: false, timeline: [] };
      }
      
      const first = verifications[0];
      timeline.push({
        timestamp: first.upload_date,
        event_type: 'first_verified',
        details: {
          media_kind: first.media_kind,
          filename: first.original_filename,
          file_size: first.file_size
        }
      });
      
      if (first.polygon_tx_hash) {
        timeline.push({
          timestamp: first.polygon_timestamp || first.upload_date,
          event_type: 'blockchain_confirmed',
          details: {
            network: 'polygon',
            block_number: first.polygon_block_number,
            transaction_hash: first.polygon_tx_hash
          }
        });
      }
      
      if (first.bitcoin_proof_status === 'confirmed') {
        timeline.push({
          timestamp: first.bitcoin_submitted_at,
          event_type: 'blockchain_confirmed',
          details: { network: 'bitcoin', status: 'confirmed' }
        });
      }
      
      for (let i = 1; i < verifications.length; i++) {
        timeline.push({
          timestamp: verifications[i].upload_date,
          event_type: 're_verification',
          details: { verification_number: i + 1 }
        });
      }
      
      // Enhanced: include change details for derivatives
      const derivativesResult = await db.query(`
        SELECT cr.*, v.upload_date, v.media_kind, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.child_fingerprint
        WHERE cr.parent_fingerprint = $1
        ORDER BY cr.detected_at ASC
      `, [fingerprint]);
      
      for (const deriv of derivativesResult.rows) {
        let changeDiff = null;
        if (deriv.change_diff) {
          try {
            changeDiff = typeof deriv.change_diff === 'string' 
              ? JSON.parse(deriv.change_diff) 
              : deriv.change_diff;
          } catch (e) { /* ignore parse errors */ }
        }
        
        timeline.push({
          timestamp: deriv.detected_at,
          event_type: 'derivative_detected',
          details: {
            child_fingerprint: deriv.child_fingerprint,
            relationship_type: deriv.relationship_type,
            similarity: deriv.similarity_score,
            filename: deriv.original_filename,
            changes: changeDiff  // NEW: what specifically changed
          }
        });
      }
      
      const parentResult = await db.query(`
        SELECT cr.*, v.upload_date, v.original_filename
        FROM content_relationships cr
        JOIN verifications v ON v.fingerprint = cr.parent_fingerprint
        WHERE cr.child_fingerprint = $1
      `, [fingerprint]);
      
      let parent = null;
      if (parentResult.rows.length > 0) {
        const p = parentResult.rows[0];
        let changeDiff = null;
        if (p.change_diff) {
          try {
            changeDiff = typeof p.change_diff === 'string' 
              ? JSON.parse(p.change_diff) : p.change_diff;
          } catch (e) { /* ignore */ }
        }
        
        parent = {
          fingerprint: p.parent_fingerprint,
          relationship_type: p.relationship_type,
          similarity: p.similarity_score,
          first_seen: p.upload_date,
          changes: changeDiff  // NEW: how this file differs from parent
        };
      }
      
      timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM verifications WHERE fingerprint = $1',
        [fingerprint]
      );
      
      return {
        found: true,
        fingerprint,
        first_seen: first.upload_date,
        verification_count: parseInt(countResult.rows[0].count),
        is_derivative: !!parent,
        parent,
        derivatives_count: derivativesResult.rows.length,
        timeline
      };
      
    } catch (err) {
      console.error('⚠️ Error getting timeline:', err.message);
      return { found: false, error: err.message };
    }
  }

  // ============================================================================
  // STATS
  // ============================================================================

  async getStats() {
    try {
      const relationshipsCount = await db.query('SELECT COUNT(*) as count FROM content_relationships');
      const derivativesCount = await db.query('SELECT COUNT(*) as count FROM verifications WHERE is_derivative = TRUE');
      const uniqueParents = await db.query('SELECT COUNT(DISTINCT parent_fingerprint) as count FROM content_relationships');
      const withRegionHashes = await db.query('SELECT COUNT(*) as count FROM verifications WHERE phash_regions IS NOT NULL');
      
      // NEW: breakdown by relationship type
      let typeBreakdown = {};
      try {
        const typeResult = await db.query(`
          SELECT relationship_type, COUNT(*) as count 
          FROM content_relationships 
          GROUP BY relationship_type 
          ORDER BY count DESC
        `);
        typeBreakdown = Object.fromEntries(
          typeResult.rows.map(r => [r.relationship_type, parseInt(r.count)])
        );
      } catch (e) { /* ignore */ }
      
      return {
        total_relationships: parseInt(relationshipsCount.rows[0].count),
        total_derivatives: parseInt(derivativesCount.rows[0].count),
        unique_originals_with_derivatives: parseInt(uniqueParents.rows[0].count),
        verifications_with_region_hashes: parseInt(withRegionHashes.rows[0].count),
        relationship_types: typeBreakdown  // NEW
      };
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = new ProvenanceService();