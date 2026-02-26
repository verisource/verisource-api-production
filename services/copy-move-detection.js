/**
 * Copy-Move Detection Service v1.1 (Improved)
 * Detects duplicated (cloned) regions within a single image.
 *
 * Improvements vs v1:
 * - Adaptive blockStep to cap block count (prevents runaway CPU/GC)
 * - Grid-based spatial clustering (avoids O(n^2) blowups)
 * - Bounding boxes include blockSize (correct region extents)
 * - Area estimation uses occupancy grid (handles overlapping blocks)
 * - Option guards (blockSize >= 8, divisible by 4, sane thresholds)
 * - Returns scale info to map analysis bboxes back to original coordinates
 *
 * Dependencies: sharp
 */

const sharp = require("sharp");
const fs = require("fs").promises;

const MAX_ANALYSIS_WIDTH = 1024;

// Safety caps (tune to your Railway plan + typical traffic)
const MAX_BLOCKS_TARGET = 45000;     // adaptive step tries to keep blocks under this
const MAX_MATCHES_PER_BUCKET = 20000; // prevents pathological buckets from exploding

class CopyMoveDetection {
  /**
   * Perform copy-move (clone) detection
   * @param {string|Buffer} input - File path or image buffer
   * @param {Object} options - Analysis options
   * @param {number} options.blockSize - Block size in pixels (default: 16; must be >=8 and divisible by 4)
   * @param {number} options.blockStep - Step between blocks (default: 4; may be increased adaptively)
   * @param {number} options.similarityThreshold - Max descriptor distance to consider a match (default: 0.025)
   * @param {number} options.minSpatialDistance - Min pixel distance between matched blocks (default: 3*blockSize)
   * @param {number} options.minClusterSize - Min matched blocks to form a clone region (default: 12)
   * @param {number} options.searchWindow - How many sorted neighbors to compare (default: 8)
   * @returns {Object} Copy-move detection results
   */
  async analyze(input, options = {}) {
    const startTime = Date.now();

    // Defaults
    let {
      blockSize = 16,
      blockStep = 4,
      similarityThreshold = 0.025,
      minSpatialDistance = null, // default computed from blockSize
      minClusterSize = 12,
      searchWindow = 8,
    } = options;

    try {
      // Guardrails
      blockSize = Number(blockSize);
      blockStep = Number(blockStep);
      similarityThreshold = Number(similarityThreshold);
      minClusterSize = Number(minClusterSize);
      searchWindow = Number(searchWindow);

      if (!Number.isFinite(blockSize) || blockSize < 8) blockSize = 16;
      if (blockSize % 4 !== 0) blockSize = Math.round(blockSize / 4) * 4; // keep sub-grid logic valid
      if (!Number.isFinite(blockStep) || blockStep < 1) blockStep = 4;
      if (!Number.isFinite(similarityThreshold) || similarityThreshold <= 0) similarityThreshold = 0.025;
      if (!Number.isFinite(minClusterSize) || minClusterSize < 6) minClusterSize = 12;
      if (!Number.isFinite(searchWindow) || searchWindow < 2) searchWindow = 8;

      // Default minSpatialDistance scales with blockSize
      if (minSpatialDistance == null || !Number.isFinite(Number(minSpatialDistance))) {
        minSpatialDistance = 3 * blockSize;
      } else {
        minSpatialDistance = Number(minSpatialDistance);
      }

      // Load image
      const imageBuffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
      const metadata = await sharp(imageBuffer).metadata();

      // Skip very small images
      if (!metadata?.width || !metadata?.height || metadata.width < 100 || metadata.height < 100) {
        return this._buildResult({
          clone_detected: false,
          verdict: "IMAGE_TOO_SMALL",
          severity: "none",
          confidence: 0,
          message: "Image too small for copy-move analysis",
          startTime,
          format: metadata?.format || "unknown",
        });
      }

      const originalWidth = metadata.width;
      const originalHeight = metadata.height;

      // Downscale + grayscale for analysis
      const processed = await sharp(imageBuffer)
        .rotate() // Apply EXIF orientation
        .resize({ width: MAX_ANALYSIS_WIDTH, withoutEnlargement: true })
        .grayscale()
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = processed.info.width;
      const height = processed.info.height;
      const pixels = processed.data;

      if (width < 64 || height < 64) {
        return this._buildResult({
          clone_detected: false,
          verdict: "IMAGE_TOO_SMALL",
          severity: "none",
          confidence: 0,
          message: "Processed image too small",
          startTime,
          format: metadata.format,
        });
      }

      // Adaptive blockStep to cap block count
      blockStep = this._adaptBlockStep(width, height, blockSize, blockStep);

      const scaleX = width / originalWidth;
      const scaleY = height / originalHeight;

      console.log(
        `🔍 Copy-Move Detection: ${width}x${height} grayscale, blockSize=${blockSize}, step=${blockStep}, minSpatial=${minSpatialDistance}...`
      );

      // Step 1: Extract blocks and compute descriptors
      const blocks = this._extractBlocks(pixels, width, height, blockSize, blockStep);
      console.log(`   Extracted ${blocks.length} blocks`);

      if (blocks.length < 20) {
        return this._buildResult({
          clone_detected: false,
          verdict: "INSUFFICIENT_DATA",
          severity: "none",
          confidence: 0,
          message: "Not enough blocks for analysis",
          startTime,
          format: metadata.format,
          analysis_dimensions: { width, height },
          analysis_scale: { x: scaleX, y: scaleY, original_width: originalWidth, original_height: originalHeight },
        });
      }

      // Step 2: Sort blocks by descriptor for efficient matching
      blocks.sort((a, b) => {
        // Lexicographic compare of float descriptors
        for (let i = 0; i < a.descriptor.length; i++) {
          const da = a.descriptor[i];
          const db = b.descriptor[i];
          if (da !== db) return da - db;
        }
        return 0;
      });

      // Step 3: Find matches among sorted neighbors
      const matches = this._findMatches(blocks, similarityThreshold, minSpatialDistance, searchWindow);
      console.log(`   Found ${matches.length} raw matches`);

      // Step 4: Cluster matches into coherent regions
      const clusters = this._clusterMatches(matches, blockSize, blockStep, minClusterSize);
      console.log(`   Formed ${clusters.length} clusters (min size: ${minClusterSize})`);

      // Step 5: Build result
      if (clusters.length === 0) {
        return this._buildResult({
          clone_detected: false,
          verdict: "NO_CLONES_DETECTED",
          severity: "none",
          confidence: 0,
          clone_regions: [],
          total_matches: matches.length,
          indicators: ["No copy-move forgery detected"],
          startTime,
          format: metadata.format,
          analysis_dimensions: { width, height },
          analysis_scale: { x: scaleX, y: scaleY, original_width: originalWidth, original_height: originalHeight },
        });
      }

      const cloneRegions = clusters.map((cluster, idx) => {
        const sourceBbox = this._computeBoundingBox(cluster.sources, blockSize);
        const destBbox = this._computeBoundingBox(cluster.destinations, blockSize);

        // Better area estimate using occupancy grid (reduces overlap inflation)
        const sourceAreaPct = this._estimateAreaPercentage(cluster.sources, width, height, blockSize, blockStep);
        const destAreaPct = this._estimateAreaPercentage(cluster.destinations, width, height, blockSize, blockStep);
        const areaPercent = Math.max(sourceAreaPct, destAreaPct);

        // Confidence: bigger clusters with more consistent shift vectors = higher confidence
        const sizeScore = Math.min(cluster.sources.length / 20, 1.0) * 40;
        const consistencyScore = cluster.shiftConsistency * 40;
        const distScore = Math.min(cluster.avgDistance / (Math.max(width, height) * 0.3), 1.0) * 20;
        const regionConfidence = Math.round(Math.min(sizeScore + consistencyScore + distScore, 100));

        // Map bboxes back to original pixel space (approx)
        const sourceBboxOriginal = this._scaleBboxToOriginal(sourceBbox, scaleX, scaleY);
        const destBboxOriginal = this._scaleBboxToOriginal(destBbox, scaleX, scaleY);

        return {
          region_id: idx + 1,
          source: {
            location: this._describeLocation(sourceBbox, width, height),
            bounding_box: sourceBbox,
            bounding_box_original: sourceBboxOriginal,
          },
          destination: {
            location: this._describeLocation(destBbox, width, height),
            bounding_box: destBbox,
            bounding_box_original: destBboxOriginal,
          },
          shift_vector: cluster.dominantShift,
          block_count: cluster.sources.length,
          area_percentage: parseFloat(areaPercent.toFixed(2)),
          confidence: regionConfidence,
          description: `Cloned region: ${cluster.sources.length} blocks copied from ${this._describeLocation(
            sourceBbox,
            width,
            height
          )} to ${this._describeLocation(destBbox, width, height)}`,
        };
      });

      const overallConfidence = Math.max(...cloneRegions.map((r) => r.confidence));
      const totalCloneArea = cloneRegions.reduce((sum, r) => sum + r.area_percentage, 0);

      let severity = "none";
      if (overallConfidence >= 75) severity = "high";
      else if (overallConfidence >= 50) severity = "medium";
      else if (overallConfidence >= 30) severity = "low";

      let verdict = "NO_CLONES_DETECTED";
      if (overallConfidence >= 60) verdict = "CLONE_DETECTED";
      else if (overallConfidence >= 35) verdict = "POSSIBLE_CLONE";

      const indicators = [
        `${cloneRegions.length} cloned region(s) detected`,
        `Total cloned area (approx): ${totalCloneArea.toFixed(1)}% of image`,
        ...cloneRegions.map(
          (r) =>
            `⚠️ Region ${r.region_id}: ${r.block_count} blocks from ${r.source.location} → ${r.destination.location} (${r.confidence}% confidence)`
        ),
      ];

      return this._buildResult({
        clone_detected: true,
        verdict,
        severity,
        confidence: overallConfidence,
        clone_regions: cloneRegions,
        total_clone_area_percentage: parseFloat(totalCloneArea.toFixed(2)),
        total_matches: matches.length,
        cluster_count: clusters.length,
        indicators,
        startTime,
        format: metadata.format,
        analysis_dimensions: { width, height },
        analysis_scale: { x: scaleX, y: scaleY, original_width: originalWidth, original_height: originalHeight },
      });
    } catch (err) {
      console.error("Copy-move detection error:", err.message);
      return this._buildResult({
        clone_detected: false,
        verdict: "ANALYSIS_FAILED",
        severity: "none",
        confidence: 0,
        message: err.message,
        startTime,
        format: "unknown",
      });
    }
  }

  /**
   * Adaptive step to cap block explosion.
   */
  _adaptBlockStep(width, height, blockSize, initialStep) {
    let step = Math.max(1, Math.floor(initialStep));
    const maxX = Math.max(0, width - blockSize);
    const maxY = Math.max(0, height - blockSize);

    const estimatedBlocks = (s) => {
      const nx = Math.floor(maxX / s) + 1;
      const ny = Math.floor(maxY / s) + 1;
      return nx * ny;
    };

    while (estimatedBlocks(step) > MAX_BLOCKS_TARGET) {
      step += 1;
      if (step > blockSize) break; // don’t go crazy
    }
    return step;
  }

  /**
   * Extract blocks from grayscale image and compute feature descriptors
   * Descriptor: [mean, variance, gradMag, subblock_means×16] — 19 floats normalized to [0,1]
   */
  _extractBlocks(pixels, width, height, blockSize, step) {
    const blocks = [];
    const subGridSize = 4;
    const subBlockSize = Math.max(1, Math.floor(blockSize / subGridSize));

    for (let y = 0; y <= height - blockSize; y += step) {
      for (let x = 0; x <= width - blockSize; x += step) {
        let sum = 0;
        let sumSq = 0;
        let gradSum = 0;

        const subMeans = new Array(subGridSize * subGridSize).fill(0);
        const subCounts = new Array(subGridSize * subGridSize).fill(0);

        for (let by = 0; by < blockSize; by++) {
          const rowBase = (y + by) * width;
          for (let bx = 0; bx < blockSize; bx++) {
            const px = pixels[rowBase + (x + bx)];
            sum += px;
            sumSq += px * px;

            // Gradient magnitude (cheap central diff)
            if (bx > 0 && by > 0 && bx < blockSize - 1 && by < blockSize - 1) {
              const gx =
                pixels[rowBase + (x + bx + 1)] - pixels[rowBase + (x + bx - 1)];
              const gy =
                pixels[(y + by + 1) * width + (x + bx)] -
                pixels[(y + by - 1) * width + (x + bx)];
              gradSum += Math.sqrt(gx * gx + gy * gy);
            }

            // Sub-block index (4×4 grid)
            const sY = Math.min(Math.floor(by / subBlockSize), subGridSize - 1);
            const sX = Math.min(Math.floor(bx / subBlockSize), subGridSize - 1);
            const si = sY * subGridSize + sX;

            subMeans[si] += px;
            subCounts[si] += 1;
          }
        }

        const count = blockSize * blockSize;
        const mean = sum / count;
        const variance = sumSq / count - mean * mean;
        const gradMag = gradSum / Math.max(count - 4 * blockSize + 4, 1);

        // Skip low-variance blocks (flat areas produce false matches)
        const normVar = Math.min(variance / (128 * 128), 1.0);
        if (normVar < 0.0008) continue;

        const descriptor = [
          mean / 255,
          normVar,
          Math.min(gradMag / 180, 1.0),
        ];

        for (let s = 0; s < subMeans.length; s++) {
          const denom = subCounts[s] > 0 ? subCounts[s] * 255 : 255;
          descriptor.push(subMeans[s] / denom);
        }

        blocks.push({ x, y, descriptor });
      }
    }

    return blocks;
  }

  /**
   * Find matching blocks among sorted descriptors
   */
  _findMatches(sortedBlocks, threshold, minSpatialDistance, searchWindow) {
    const matches = [];

    for (let i = 0; i < sortedBlocks.length; i++) {
      const a = sortedBlocks[i];

      for (let j = 1; j <= searchWindow && i + j < sortedBlocks.length; j++) {
        const b = sortedBlocks[i + j];

        // Descriptor distance (L2)
        let dist = 0;
        for (let d = 0; d < a.descriptor.length; d++) {
          const diff = a.descriptor[d] - b.descriptor[d];
          dist += diff * diff;
        }
        dist = Math.sqrt(dist);

        if (dist > threshold) break;

        // Spatial distance check
        const sx = a.x - b.x;
        const sy = a.y - b.y;
        const spatialDist = Math.sqrt(sx * sx + sy * sy);

        if (spatialDist >= minSpatialDistance) {
          matches.push({
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            distance: dist,
            shiftX: b.x - a.x,
            shiftY: b.y - a.y,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Cluster matches by consistent shift vector.
   */
  _clusterMatches(matches, blockSize, blockStep, minClusterSize) {
    if (matches.length === 0) return [];

    const shiftBucketSize = blockSize;
    const buckets = new Map();

    for (const m of matches) {
      const qx = Math.round(m.shiftX / shiftBucketSize) * shiftBucketSize;
      const qy = Math.round(m.shiftY / shiftBucketSize) * shiftBucketSize;
      const key = `${qx},${qy}`;

      if (!buckets.has(key)) buckets.set(key, { matches: [], qx, qy });

      // Cap bucket size to prevent pathological explosions
      const bucket = buckets.get(key);
      if (bucket.matches.length < MAX_MATCHES_PER_BUCKET) bucket.matches.push(m);
    }

    // Merge neighboring buckets
    const mergedGroups = [];
    const usedKeys = new Set();

    for (const [key, bucket] of buckets) {
      if (usedKeys.has(key)) continue;

      const merged = [...bucket.matches];
      usedKeys.add(key);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nKey = `${bucket.qx + dx * shiftBucketSize},${bucket.qy + dy * shiftBucketSize}`;
          if (buckets.has(nKey) && !usedKeys.has(nKey)) {
            merged.push(...buckets.get(nKey).matches);
            usedKeys.add(nKey);
          }
        }
      }

      if (merged.length >= minClusterSize) mergedGroups.push(merged);
    }

    // For each merged group, spatially cluster by source proximity using grid index
    const clusters = [];

    for (const group of mergedGroups) {
      const coherentGroups = this._spatialClusterGrid(group, blockSize * 6);

      for (const coherent of coherentGroups) {
        if (coherent.length < minClusterSize) continue;

        // Compute shift consistency
        const avgShiftX = coherent.reduce((s, m) => s + m.shiftX, 0) / coherent.length;
        const avgShiftY = coherent.reduce((s, m) => s + m.shiftY, 0) / coherent.length;

        let shiftVariance = 0;
        for (const m of coherent) {
          shiftVariance += (m.shiftX - avgShiftX) ** 2 + (m.shiftY - avgShiftY) ** 2;
        }
        shiftVariance = Math.sqrt(shiftVariance / coherent.length);

        const maxExpectedVariance = blockStep * 4;
        const shiftConsistency = Math.max(0, 1 - shiftVariance / maxExpectedVariance);

        if (shiftConsistency < 0.5) continue;

        const avgDistance =
          coherent.reduce((s, m) => s + Math.hypot(m.ax - m.bx, m.ay - m.by), 0) / coherent.length;

        clusters.push({
          sources: coherent.map((m) => ({ x: m.ax, y: m.ay })),
          destinations: coherent.map((m) => ({ x: m.bx, y: m.by })),
          dominantShift: { x: Math.round(avgShiftX), y: Math.round(avgShiftY) },
          shiftConsistency,
          avgDistance,
          matchCount: coherent.length,
        });
      }
    }

    clusters.sort((a, b) => b.matchCount - a.matchCount);
    return clusters;
  }

  /**
   * Spatial clustering using a grid index (avoids O(n^2)).
   * Clusters matches by proximity of SOURCE blocks (ax, ay).
   */
  _spatialClusterGrid(matches, radius) {
    if (matches.length === 0) return [];

    const cellSize = Math.max(8, Math.floor(radius / 2));
    const grid = new Map();

    const cellKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const key = cellKey(m.ax, m.ay);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }

    const visited = new Uint8Array(matches.length);
    const groups = [];

    for (let i = 0; i < matches.length; i++) {
      if (visited[i]) continue;

      const group = [];
      const queue = [i];
      visited[i] = 1;

      let qi = 0;
      while (qi < queue.length) {
        const idx = queue[qi++];
        const a = matches[idx];
        group.push(a);

        const cx = Math.floor(a.ax / cellSize);
        const cy = Math.floor(a.ay / cellSize);

        // Check neighboring cells (3x3)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nk = `${cx + dx},${cy + dy}`;
            const indices = grid.get(nk);
            if (!indices) continue;

            for (const j of indices) {
              if (visited[j]) continue;
              const b = matches[j];
              const ddx = a.ax - b.ax;
              const ddy = a.ay - b.ay;
              if (ddx * ddx + ddy * ddy <= radius * radius) {
                visited[j] = 1;
                queue.push(j);
              }
            }
          }
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Compute bounding box for a set of points (top-lefts), including blockSize extent.
   */
  _computeBoundingBox(points, blockSize = 0) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
      x: minX,
      y: minY,
      width: (maxX - minX) + blockSize,
      height: (maxY - minY) + blockSize,
    };
  }

  /**
   * Estimate area percentage using a coarse occupancy grid keyed by blockStep.
   * This avoids overcounting due to overlapping blocks.
   */
  _estimateAreaPercentage(points, width, height, blockSize, blockStep) {
    if (!points || points.length === 0) return 0;

    const gx = Math.max(1, Math.floor(width / blockStep));
    const gy = Math.max(1, Math.floor(height / blockStep));
    const visited = new Set();

    // Mark occupancy around each block (approx coverage)
    // We mark the block's top-left cell; for more accuracy you can mark a small footprint.
    for (const p of points) {
      const ix = Math.floor(p.x / blockStep);
      const iy = Math.floor(p.y / blockStep);
      visited.add(`${ix},${iy}`);
    }

    // Convert occupied "cells" to approximate pixel area
    // Each cell represents roughly (blockStep x blockStep) area; expand by block size factor (approx).
    const cellArea = blockStep * blockStep;
    const rawArea = visited.size * cellArea;

    // Inflate slightly to approximate block coverage instead of just step cell coverage
    // but cap at full image.
    const inflate = Math.min((blockSize / blockStep), 4);
    const approxArea = Math.min(rawArea * inflate, width * height);

    return (approxArea / (width * height)) * 100;
  }

  _scaleBboxToOriginal(bbox, scaleX, scaleY) {
    // analysis = original * scale -> original = analysis / scale
    const invX = scaleX > 0 ? 1 / scaleX : 1;
    const invY = scaleY > 0 ? 1 / scaleY : 1;

    return {
      x: Math.round(bbox.x * invX),
      y: Math.round(bbox.y * invY),
      width: Math.round(bbox.width * invX),
      height: Math.round(bbox.height * invY),
    };
  }

  /**
   * Describe location in human-readable terms
   */
  _describeLocation(bbox, imgWidth, imgHeight) {
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const horizontal = cx < imgWidth * 0.33 ? "left" : cx > imgWidth * 0.67 ? "right" : "center";
    const vertical = cy < imgHeight * 0.33 ? "top" : cy > imgHeight * 0.67 ? "bottom" : "middle";

    if (horizontal === "center" && vertical === "middle") return "center";
    if (horizontal === "center") return vertical;
    if (vertical === "middle") return horizontal;
    return `${vertical}-${horizontal}`;
  }

  /**
   * Build standardized result object
   */
  _buildResult({
    clone_detected = false,
    verdict = "NO_CLONES_DETECTED",
    severity = "none",
    confidence = 0,
    clone_regions = [],
    total_clone_area_percentage = 0,
    total_matches = 0,
    cluster_count = 0,
    indicators = [],
    message = null,
    startTime,
    format = "unknown",
    analysis_dimensions = null,
    analysis_scale = null,
  }) {
    const analysisTime = Date.now() - startTime;

    const limitations = [
      "Copy-move detection identifies duplicated regions within the same image",
      "Rotated or mirrored cloning may not be detected in this version",
      "AI-generated inpainting or generative fill may not be detected",
      "Heavy post-processing (blur, color grading) after cloning reduces detection accuracy",
      "Social media recompression and resizing may degrade match quality",
      "Very small cloned regions may fall below detection threshold",
      "Highly repetitive textures (grass, bricks, water) can increase false positives",
    ];

    const result = {
      success: true,
      applicable: true,
      clone_detected,
      verdict,
      severity,
      confidence,
      clone_regions,
      total_clone_area_percentage,
      total_matches,
      cluster_count,
      indicators: indicators.length > 0 ? indicators : message ? [message] : ["Copy-move analysis complete"],
      limitations,
      source_format: format,
      analysis_dimensions,
      analysis_scale,
      analysis_time_ms: analysisTime,
    };

    console.log(`   Copy-move analysis complete: ${verdict} (${analysisTime}ms, ${clone_regions.length} clone regions)`);
    return result;
  }
}

module.exports = CopyMoveDetection;