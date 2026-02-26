/**
 * JPEG Ghost Analysis Service v2
 * Detects image splicing by identifying regions saved at different JPEG quality levels
 * 
 * How it works:
 * 1. Re-save the image at multiple JPEG quality levels (60-95)
 * 2. For each quality level, compute pixel-by-pixel difference from original
 * 3. Regions originally compressed at a given quality will "disappear" (minimal difference)
 *    when re-saved at that same quality
 * 4. Pasted-in regions from a different source remain visible as "ghosts"
 * 5. If different regions disappear at different quality levels → composite detected
 * 
 * Applicable to: JPEG images with compression artifacts present
 * Limited by: social platform recompression, PNG→JPEG conversions, heavy resizing
 * 
 * Dependencies: sharp (already in VeriSource stack)
 */

const sharp = require('sharp');
const fs = require('fs').promises;

// Analysis resolution cap — JPEG ghosts are macro artifacts; full 4K is unnecessary
const MAX_ANALYSIS_WIDTH = 1024;

class JPEGGhostAnalysis {

  /**
   * Perform JPEG Ghost Analysis
   * @param {string|Buffer} input - File path or image buffer
   * @param {Object} options - Analysis options
   * @param {number} options.qualityMin - Minimum quality to test (default: 60)
   * @param {number} options.qualityMax - Maximum quality to test (default: 95)
   * @param {number} options.qualityStep - Step between quality levels (default: 5)
   * @param {number} options.blockSize - Block size for regional analysis (default: 8, aligns with JPEG DCT blocks)
   * @param {number} options.ghostThresholdRatio - Relative threshold: bestScore/dominantScore must be below this (default: 0.7)
   * @param {number} options.ghostThresholdAbs - Absolute threshold: dominantScore - bestScore must exceed this RMSE (default: 2.0)
   * @param {number} options.minRegionBlocks - Minimum contiguous blocks to form a ghost region (default: 6)
   * @param {number} options.minBoundingDim - Minimum bounding box dimension in blocks to avoid speckle (default: 3)
   * @returns {Object} Ghost analysis results
   */
  async analyze(input, options = {}) {
    const startTime = Date.now();
    
    const {
      qualityMin = 60,
      qualityMax = 95,
      qualityStep = 5,
      blockSize = 8,       // Aligned with JPEG 8×8 DCT blocks
      ghostThresholdRatio = 0.7,
      ghostThresholdAbs = 2.0,
      minRegionBlocks = 6,
      minBoundingDim = 3
    } = options;

    try {
      // Load original image
      const imageBuffer = Buffer.isBuffer(input) 
        ? input 
        : await fs.readFile(input);
      
      const metadata = await sharp(imageBuffer).metadata();
      
      // ═══ Format gating (Recommendation #1) ═══
      // Ghost analysis is meaningful only on JPEGs that retain compression artifacts.
      // Non-JPEG images lack DCT block structure — results would be misleading.
      const isJpeg = metadata.format === 'jpeg' || metadata.format === 'jpg';
      
      if (!isJpeg) {
        return this._buildNotApplicableResult(metadata.format, startTime);
      }

      // Skip very small images
      if (metadata.width < 100 || metadata.height < 100) {
        return this._buildResult(false, 'Image too small for ghost analysis', startTime, metadata.format);
      }

      // ═══ Performance: downscale + grayscale (Recommendation #3) ═══
      // JPEG ghosts are macro artifacts visible at lower resolution.
      // Grayscale (1 channel) cuts memory and compute by ~3x.
      const basePipeline = sharp(imageBuffer)
        .rotate()                                    // Apply EXIF orientation (Rec #6)
        .resize({ width: MAX_ANALYSIS_WIDTH, withoutEnlargement: true })
        .grayscale()                                 // Luminance only
        .removeAlpha();

      const original = await basePipeline
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = original.info.width;
      const height = original.info.height;
      const channels = 1; // grayscale

      // ═══ Dimension validation (Recommendation #6) ═══
      if (width < 64 || height < 64) {
        return this._buildResult(false, 'Processed image too small', startTime, metadata.format);
      }

      // Stable JPEG buffer at analysis resolution for re-encoding
      const analysisJpegBuffer = await sharp(original.data, {
        raw: { width, height, channels }
      }).jpeg({ quality: 100 }).toBuffer();

      // Test each quality level
      const qualityLevels = [];
      for (let q = qualityMin; q <= qualityMax; q += qualityStep) {
        qualityLevels.push(q);
      }

      console.log(`👻 JPEG Ghost Analysis: testing ${qualityLevels.length} quality levels (${qualityMin}-${qualityMax}), ${width}x${height} grayscale...`);

      // Compute difference maps for each quality level
      const differenceMaps = [];
      
      for (const quality of qualityLevels) {
        const resaved = await sharp(analysisJpegBuffer)
          .jpeg({ quality })
          .toBuffer();

        const resavedPixels = await sharp(resaved)
          .rotate()
          .grayscale()
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        // ═══ Dimension check (Recommendation #6) ═══
        if (resavedPixels.info.width !== width || resavedPixels.info.height !== height) {
          console.warn(`   ⚠️ Dimension mismatch at Q${quality}: ${resavedPixels.info.width}x${resavedPixels.info.height} vs ${width}x${height}, skipping`);
          continue;
        }

        const blockMap = this._computeBlockDifferences(
          original.data,
          resavedPixels.data,
          width,
          height,
          channels,
          blockSize
        );

        differenceMaps.push({
          quality,
          blockMap,
          globalMean: blockMap.globalMean,
          globalMedian: blockMap.globalMedian,
          globalStd: blockMap.globalStd
        });
      }

      if (differenceMaps.length < 3) {
        return this._buildResult(false, 'Insufficient quality levels processed', startTime, metadata.format);
      }

      // ═══ Find dominant quality using median (Recommendation #11) ═══
      const dominantQuality = this._findDominantQuality(differenceMaps);

      // ═══ Detect ghost regions with abs+relative thresholds (Recommendation #10) ═══
      const ghostRegions = this._detectGhostRegions(
        differenceMaps,
        dominantQuality,
        width,
        height,
        blockSize,
        ghostThresholdRatio,
        ghostThresholdAbs,
        minRegionBlocks,
        minBoundingDim
      );

      const uniformityScore = this._computeUniformityScore(differenceMaps, dominantQuality);

      // Build verdict
      const ghostDetected = ghostRegions.length > 0;
      const totalGhostArea = ghostRegions.reduce((sum, r) => sum + r.area_percentage, 0);

      let verdict, severity, confidence;
      
      if (!ghostDetected) {
        verdict = 'UNIFORM_COMPRESSION';
        severity = 'none';
        confidence = Math.min(95, Math.round(70 + (1 - uniformityScore) * 25));
      } else if (totalGhostArea > 25) {
        verdict = 'COMPOSITE_DETECTED';
        severity = 'high';
        confidence = Math.min(95, Math.round(60 + totalGhostArea * 0.5 + ghostRegions.length * 5));
      } else if (totalGhostArea > 10) {
        verdict = 'COMPOSITE_DETECTED';
        severity = 'medium';
        confidence = Math.min(90, Math.round(50 + totalGhostArea * 0.8));
      } else if (totalGhostArea > 3) {
        verdict = 'POSSIBLE_SPLICE';
        severity = 'low';
        confidence = Math.min(75, Math.round(40 + totalGhostArea * 2));
      } else {
        verdict = 'MINOR_QUALITY_VARIANCE';
        severity = 'minimal';
        confidence = Math.round(30 + totalGhostArea * 5);
      }

      const elapsed = Date.now() - startTime;
      console.log(`   Ghost analysis complete: ${verdict} (${elapsed}ms, ${ghostRegions.length} ghost regions)`);

      return {
        success: true,
        applicable: true,
        ghost_detected: ghostDetected,
        verdict,
        severity,
        confidence,
        
        quality_map: {
          dominant_quality: dominantQuality.quality,
          secondary_qualities: ghostRegions
            .map(r => r.quality_mismatch)
            .filter((v, i, a) => a.indexOf(v) === i),
          uniformity_score: Math.round(uniformityScore * 100) / 100
        },

        ghost_regions: ghostRegions.map(r => ({
          quality_mismatch: r.quality_mismatch,
          location: r.location,
          area_percentage: Math.round(r.area_percentage * 100) / 100,
          confidence: r.confidence,
          block_count: r.block_count,
          bounding_box: r.bounding_box,
          description: `Region compressed at ~Q${r.quality_mismatch}, surrounding image at ~Q${dominantQuality.quality}`
        })),

        total_ghost_area_percentage: Math.round(totalGhostArea * 100) / 100,
        quality_levels_tested: qualityLevels,
        indicators: this._buildIndicators(ghostDetected, ghostRegions, dominantQuality, uniformityScore),
        
        // ═══ Applicability & limitations (Recommendation #12) ═══
        limitations: this._buildLimitations(metadata),

        source_format: metadata.format,
        analysis_resolution: { width, height },
        original_resolution: { width: metadata.width, height: metadata.height },
        block_size: blockSize,
        analysis_time_ms: elapsed
      };

    } catch (err) {
      console.error('👻 JPEG Ghost Analysis error:', err.message);
      return this._buildResult(false, `Analysis error: ${err.message}`, startTime, 'unknown');
    }
  }

  /**
   * Compute block-level RMSE between original and re-saved
   * Uses grayscale (1 channel) for efficiency
   * Block size defaults to 8 to align with JPEG DCT blocks (Recommendation #4)
   * Right/bottom strips smaller than blockSize are ignored (Rec #7 — noted, consistent internally)
   */
  _computeBlockDifferences(originalData, resavedData, width, height, channels, blockSize) {
    const blocksX = Math.floor(width / blockSize);
    const blocksY = Math.floor(height / blockSize);
    const totalBlocks = blocksX * blocksY;
    const blocks = new Float64Array(totalBlocks);
    
    let globalSum = 0;

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let blockSum = 0;
        let pixelCount = 0;

        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            const x = bx * blockSize + dx;
            const y = by * blockSize + dy;
            const idx = (y * width + x) * channels;

            for (let c = 0; c < channels; c++) {
              const diff = originalData[idx + c] - resavedData[idx + c];
              blockSum += diff * diff;
            }
            pixelCount++;
          }
        }

        const rmse = Math.sqrt(blockSum / (pixelCount * channels));
        blocks[by * blocksX + bx] = rmse;
        globalSum += rmse;
      }
    }

    const globalMean = globalSum / totalBlocks;

    // ═══ Compute median for robust dominant quality detection (Recommendation #11) ═══
    const sorted = Float64Array.from(blocks).sort();
    const mid = Math.floor(totalBlocks / 2);
    const globalMedian = totalBlocks % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    let varianceSum = 0;
    for (let i = 0; i < totalBlocks; i++) {
      const diff = blocks[i] - globalMean;
      varianceSum += diff * diff;
    }
    const globalStd = Math.sqrt(varianceSum / totalBlocks);

    return { blocks, blocksX, blocksY, globalMean, globalMedian, globalStd };
  }

  /**
   * Find dominant quality using median RMSE (Recommendation #11)
   * Median resists skew from large spliced regions
   */
  _findDominantQuality(differenceMaps) {
    let bestMatch = null;
    let lowestMedian = Infinity;

    for (const dm of differenceMaps) {
      if (dm.globalMedian < lowestMedian) {
        lowestMedian = dm.globalMedian;
        bestMatch = dm;
      }
    }

    return bestMatch;
  }

  /**
   * Detect ghost regions using absolute + relative thresholds (Recommendation #10)
   * 
   * A block is flagged when:
   *   1. Its best quality differs from dominant by ≥10
   *   2. dominantScore - bestScore > ghostThresholdAbs (absolute RMSE)
   *   3. bestScore / dominantScore < ghostThresholdRatio (relative improvement)
   * 
   * Dual threshold prevents false positives in smooth areas (tiny absolute diff)
   * and in textured areas (misleading ratio)
   */
  _detectGhostRegions(differenceMaps, dominantQuality, width, height, blockSize, 
                       ghostThresholdRatio, ghostThresholdAbs, minRegionBlocks, minBoundingDim) {
    const blocksX = dominantQuality.blockMap.blocksX;
    const blocksY = dominantQuality.blockMap.blocksY;
    const totalBlocks = blocksX * blocksY;

    const blockBestQuality = new Int32Array(totalBlocks);
    const blockBestScore = new Float64Array(totalBlocks).fill(Infinity);

    for (const dm of differenceMaps) {
      for (let i = 0; i < totalBlocks; i++) {
        if (dm.blockMap.blocks[i] < blockBestScore[i]) {
          blockBestScore[i] = dm.blockMap.blocks[i];
          blockBestQuality[i] = dm.quality;
        }
      }
    }

    const dominantQ = dominantQuality.quality;
    const mismatchBlocks = [];

    for (let i = 0; i < totalBlocks; i++) {
      const bestQ = blockBestQuality[i];
      
      if (Math.abs(bestQ - dominantQ) < 10) continue;

      const dominantScore = dominantQuality.blockMap.blocks[i];
      const bestScore = blockBestScore[i];

      // ═══ Guard division-by-zero (Recommendation #8) ═══
      if (dominantScore <= 1e-9) continue;

      // ═══ Absolute + relative threshold combo (Recommendation #10) ═══
      const absDiff = dominantScore - bestScore;
      const ratio = bestScore / dominantScore;

      if (absDiff > ghostThresholdAbs && ratio < ghostThresholdRatio) {
        const bx = i % blocksX;
        const by = Math.floor(i / blocksX);
        mismatchBlocks.push({ bx, by, quality: bestQ, score: bestScore, dominantScore });
      }
    }

    return this._clusterBlocks(mismatchBlocks, blocksX, blocksY, blockSize, width, height, totalBlocks, minRegionBlocks, minBoundingDim);
  }

  /**
   * Cluster adjacent mismatch blocks into contiguous ghost regions
   * Uses index-pointer flood fill for O(n) instead of O(n²) shift() (Recommendation #9)
   */
  _clusterBlocks(mismatchBlocks, blocksX, blocksY, blockSize, imageWidth, imageHeight, totalBlocks, minRegionBlocks, minBoundingDim) {
    if (mismatchBlocks.length === 0) return [];

    const grid = new Map();
    for (const block of mismatchBlocks) {
      grid.set(`${block.bx},${block.by}`, block);
    }

    const visited = new Set();
    const regions = [];

    for (const block of mismatchBlocks) {
      const key = `${block.bx},${block.by}`;
      if (visited.has(key)) continue;

      // ═══ Efficient flood fill (Recommendation #9) ═══
      const cluster = [];
      const queue = [block];
      let qi = 0;
      
      while (qi < queue.length) {
        const current = queue[qi++];
        const ck = `${current.bx},${current.by}`;
        if (visited.has(ck)) continue;
        visited.add(ck);
        cluster.push(current);

        const neighbors = [
          { bx: current.bx - 1, by: current.by },
          { bx: current.bx + 1, by: current.by },
          { bx: current.bx, by: current.by - 1 },
          { bx: current.bx, by: current.by + 1 }
        ];

        for (const n of neighbors) {
          const nk = `${n.bx},${n.by}`;
          if (grid.has(nk) && !visited.has(nk)) {
            queue.push(grid.get(nk));
          }
        }
      }

      // ═══ Size + shape filtering (Recommendations #5) ═══
      if (cluster.length < minRegionBlocks) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const qualityCounts = {};
      
      for (const c of cluster) {
        minX = Math.min(minX, c.bx);
        minY = Math.min(minY, c.by);
        maxX = Math.max(maxX, c.bx);
        maxY = Math.max(maxY, c.by);
        qualityCounts[c.quality] = (qualityCounts[c.quality] || 0) + 1;
      }

      // ═══ Minimum bounding box dimension (Recommendation #5) ═══
      const bbWidthBlocks = maxX - minX + 1;
      const bbHeightBlocks = maxY - minY + 1;
      if (bbWidthBlocks < minBoundingDim && bbHeightBlocks < minBoundingDim) continue;

      const regionQuality = parseInt(Object.entries(qualityCounts)
        .sort((a, b) => b[1] - a[1])[0][0]);

      const areaPercentage = (cluster.length / totalBlocks) * 100;
      
      // ═══ Division-by-zero guard (Recommendation #8) ═══
      const avgScore = cluster.reduce((s, c) => s + c.score, 0) / cluster.length;
      const avgDominantScore = cluster.reduce((s, c) => s + c.dominantScore, 0) / cluster.length;
      const scoreRatio = avgDominantScore > 1e-9 
        ? Math.max(0, 1 - (avgScore / avgDominantScore))
        : 0;
      const confidence = Math.min(95, Math.round(40 + scoreRatio * 40 + Math.min(cluster.length, 50)));

      const centerX = ((minX + maxX) / 2) / blocksX;
      const centerY = ((minY + maxY) / 2) / blocksY;
      const location = this._describeLocation(centerX, centerY);

      regions.push({
        quality_mismatch: regionQuality,
        location,
        area_percentage: areaPercentage,
        confidence,
        block_count: cluster.length,
        bounding_box: {
          x: minX * blockSize,
          y: minY * blockSize,
          width: bbWidthBlocks * blockSize,
          height: bbHeightBlocks * blockSize
        }
      });
    }

    return regions.sort((a, b) => b.area_percentage - a.area_percentage);
  }

  /**
   * Compute uniformity score (0 = perfectly uniform, 1 = very mixed)
   */
  _computeUniformityScore(differenceMaps, dominantQuality) {
    const blocks = dominantQuality.blockMap.blocks;
    const totalBlocks = dominantQuality.blockMap.blocksX * dominantQuality.blockMap.blocksY;
    
    let mismatchCount = 0;
    
    for (let i = 0; i < totalBlocks; i++) {
      let bestQ = dominantQuality.quality;
      let bestScore = blocks[i];
      
      for (const dm of differenceMaps) {
        if (dm.blockMap.blocks[i] < bestScore) {
          bestScore = dm.blockMap.blocks[i];
          bestQ = dm.quality;
        }
      }
      
      if (Math.abs(bestQ - dominantQuality.quality) >= 10) {
        mismatchCount++;
      }
    }

    return mismatchCount / totalBlocks;
  }

  _describeLocation(normalizedX, normalizedY) {
    const vertical = normalizedY < 0.33 ? 'top' : normalizedY > 0.66 ? 'bottom' : 'center';
    const horizontal = normalizedX < 0.33 ? 'left' : normalizedX > 0.66 ? 'right' : 'center';
    
    if (vertical === 'center' && horizontal === 'center') return 'center';
    if (vertical === 'center') return horizontal;
    if (horizontal === 'center') return vertical;
    return `${vertical}-${horizontal}`;
  }

  _buildIndicators(ghostDetected, ghostRegions, dominantQuality, uniformityScore) {
    const indicators = [];

    indicators.push(`Dominant JPEG quality: ~Q${dominantQuality.quality}`);

    if (!ghostDetected) {
      indicators.push('Image shows uniform compression across all regions');
      indicators.push('No evidence of splicing from different JPEG sources');
    } else {
      indicators.push(`⚠️ ${ghostRegions.length} region(s) with different compression history detected`);
      
      for (const region of ghostRegions) {
        indicators.push(
          `⚠️ Ghost at ${region.location}: ~Q${region.quality_mismatch} vs dominant Q${dominantQuality.quality} ` +
          `(${region.area_percentage.toFixed(1)}% of image, ${region.confidence}% confidence)`
        );
      }

      if (uniformityScore > 0.3) {
        indicators.push('⚠️ High compression variance — strong evidence of compositing');
      } else if (uniformityScore > 0.15) {
        indicators.push('⚠️ Moderate compression variance — possible compositing');
      }
    }

    return indicators;
  }

  /**
   * Build limitations list (Recommendation #12)
   */
  _buildLimitations(metadata) {
    const limitations = [];

    limitations.push('Ghost analysis detects splicing from JPEG sources only — composites from RAW/PNG sources will not be detected');

    if (metadata.width === 1080 || metadata.width === 1200 || metadata.width === 2048) {
      limitations.push('Image dimensions suggest possible social media recompression — platform re-encoding may mask original artifacts');
    }

    if (metadata.density && metadata.density < 72) {
      limitations.push('Low DPI suggests web-optimized image — may have been re-saved multiple times');
    }

    limitations.push('Images re-encoded by messaging apps or social platforms may show uniform compression regardless of editing');
    limitations.push('Text overlays, stickers, or app-applied filters can create benign quality variance');

    return limitations;
  }

  /**
   * Result for non-JPEG formats (Recommendation #1)
   */
  _buildNotApplicableResult(format, startTime) {
    const formatNames = {
      png: 'PNG', webp: 'WebP', heif: 'HEIF/HEIC', tiff: 'TIFF',
      gif: 'GIF', avif: 'AVIF', raw: 'RAW'
    };
    const displayFormat = formatNames[format] || format?.toUpperCase() || 'unknown';

    return {
      success: true,
      applicable: false,
      ghost_detected: false,
      verdict: 'NOT_APPLICABLE',
      severity: 'none',
      confidence: 0,
      quality_map: null,
      ghost_regions: [],
      total_ghost_area_percentage: 0,
      indicators: [
        `Source format: ${displayFormat} — JPEG ghost analysis not applicable`,
        'Ghost analysis requires JPEG compression artifacts (DCT block structure)',
        `${displayFormat} images use different compression — use ELA and noise analysis instead`
      ],
      limitations: [
        `Image is ${displayFormat}, not JPEG — ghost analysis cannot detect quality-level mismatches`,
        'For non-JPEG composites, rely on ELA, copy-move detection, and noise fingerprinting'
      ],
      source_format: format,
      analysis_time_ms: Date.now() - startTime,
      reason: `JPEG ghost analysis is not applicable to ${displayFormat} images`
    };
  }

  _buildResult(success, reason, startTime, format) {
    return {
      success,
      applicable: success,
      ghost_detected: false,
      verdict: success ? 'UNIFORM_COMPRESSION' : 'ANALYSIS_FAILED',
      severity: 'none',
      confidence: 0,
      quality_map: null,
      ghost_regions: [],
      total_ghost_area_percentage: 0,
      indicators: [reason],
      limitations: [],
      source_format: format,
      analysis_time_ms: Date.now() - startTime,
      reason
    };
  }
}

module.exports = JPEGGhostAnalysis;