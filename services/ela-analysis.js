/**
 * Error Level Analysis (ELA) Service
 * Detects cloned, edited, or manipulated regions in images
 * 
 * How it works:
 * 1. Re-save the image at a known JPEG quality (e.g., 95%)
 * 2. Compare the difference between original and re-saved
 * 3. Edited regions show different error levels than original regions
 * 4. Cloned/airbrushed/content-aware filled areas stand out
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

class ELAAnalysis {
  
  /**
   * Perform Error Level Analysis on an image
   * @param {string} imagePath - Path to the image file
   * @param {number} quality - JPEG quality for re-compression (default: 95)
   * @returns {Object} ELA analysis results
   */
  async analyze(imagePath, quality = 95) {
    try {
      console.log('🔬 Running Error Level Analysis...');
      
      // Read original image
      const originalBuffer = await fs.readFile(imagePath);
      const metadata = await sharp(originalBuffer).metadata();
      
      // Skip non-JPEG or very small images
      if (metadata.width < 100 || metadata.height < 100) {
        return { success: false, reason: 'Image too small for ELA' };
      }
      
      // Re-compress at known quality
      const recompressedBuffer = await sharp(originalBuffer)
        .jpeg({ quality: quality })
        .toBuffer();
      
      // Get raw pixel data for both
      const originalPixels = await sharp(originalBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
        
      const recompressedPixels = await sharp(recompressedBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Calculate error levels
      const elaResult = this.calculateErrorLevels(
        originalPixels.data,
        recompressedPixels.data,
        originalPixels.info.width,
        originalPixels.info.height,
        originalPixels.info.channels
      );
      
      // Analyze for manipulation indicators
      const manipulationAnalysis = this.detectManipulation(elaResult);
      
      console.log(`   ELA complete: ${manipulationAnalysis.verdict} (${manipulationAnalysis.confidence}% confidence)`);
      
      return {
        success: true,
        width: metadata.width,
        height: metadata.height,
        quality_used: quality,
        ...elaResult,
        ...manipulationAnalysis
      };
      
    } catch (err) {
      console.error('⚠️ ELA analysis error:', err.message);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Calculate pixel-level error differences
   */
  calculateErrorLevels(original, recompressed, width, height, channels) {
    const totalPixels = width * height;
    const errors = new Float32Array(totalPixels);
    
    let totalError = 0;
    let maxError = 0;
    let minError = 255;
    
    // Calculate error for each pixel
    for (let i = 0; i < totalPixels; i++) {
      const pixelStart = i * channels;
      let pixelError = 0;
      
      // Sum absolute differences across channels (RGB)
      for (let c = 0; c < Math.min(channels, 3); c++) {
        const diff = Math.abs(original[pixelStart + c] - recompressed[pixelStart + c]);
        pixelError += diff;
      }
      
      pixelError = pixelError / Math.min(channels, 3); // Average across channels
      errors[i] = pixelError;
      totalError += pixelError;
      maxError = Math.max(maxError, pixelError);
      minError = Math.min(minError, pixelError);
    }
    
    const meanError = totalError / totalPixels;
    
    // Calculate standard deviation
    let varianceSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      varianceSum += Math.pow(errors[i] - meanError, 2);
    }
    const stdDev = Math.sqrt(varianceSum / totalPixels);
    
    // Divide image into grid and analyze regions
    const gridSize = 16; // 16x16 grid
    const regionAnalysis = this.analyzeRegions(errors, width, height, gridSize, meanError, stdDev);
    
    return {
      mean_error: Math.round(meanError * 100) / 100,
      max_error: Math.round(maxError * 100) / 100,
      min_error: Math.round(minError * 100) / 100,
      std_dev: Math.round(stdDev * 100) / 100,
      regions: regionAnalysis
    };
  }
  
  /**
   * Analyze image regions for inconsistencies
   */
  analyzeRegions(errors, width, height, gridSize, globalMean, globalStdDev) {
    const cellWidth = Math.floor(width / gridSize);
    const cellHeight = Math.floor(height / gridSize);
    const regions = [];
    const suspiciousRegions = [];
    
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        let regionSum = 0;
        let regionCount = 0;
        
        // Calculate mean error for this region
        for (let y = gy * cellHeight; y < (gy + 1) * cellHeight && y < height; y++) {
          for (let x = gx * cellWidth; x < (gx + 1) * cellWidth && x < width; x++) {
            const idx = y * width + x;
            regionSum += errors[idx];
            regionCount++;
          }
        }
        
        const regionMean = regionSum / regionCount;
        const deviation = (regionMean - globalMean) / (globalStdDev || 1);
        
        regions.push({
          x: gx,
          y: gy,
          mean: Math.round(regionMean * 100) / 100,
          deviation: Math.round(deviation * 100) / 100
        });
        
        // Flag regions that deviate significantly (more than 2 std devs)
        if (Math.abs(deviation) > 2.0) {
          suspiciousRegions.push({
            x: gx,
            y: gy,
            gridPosition: `${gx},${gy}`,
            location: this.describeLocation(gx, gy, gridSize),
            mean_error: Math.round(regionMean * 100) / 100,
            deviation: Math.round(deviation * 100) / 100,
            type: deviation > 0 ? 'high_error' : 'low_error',
            interpretation: deviation > 0 
              ? 'Region may have been edited (different compression history)'
              : 'Region may be cloned or digitally generated (too uniform)'
          });
        }
      }
    }
    
    return {
      grid_size: gridSize,
      total_regions: regions.length,
      suspicious_count: suspiciousRegions.length,
      suspicious_regions: suspiciousRegions
    };
  }
  
  /**
   * Describe region location in human terms
   */
  describeLocation(x, y, gridSize) {
    const third = gridSize / 3;
    
    let vertical = '';
    if (y < third) vertical = 'top';
    else if (y < third * 2) vertical = 'middle';
    else vertical = 'bottom';
    
    let horizontal = '';
    if (x < third) horizontal = 'left';
    else if (x < third * 2) horizontal = 'center';
    else horizontal = 'right';
    
    if (vertical === 'middle' && horizontal === 'center') return 'center';
    if (horizontal === 'center') return vertical;
    if (vertical === 'middle') return horizontal;
    return `${vertical}-${horizontal}`;
  }
  
  /**
   * Analyze ELA results for manipulation indicators
   */
  detectManipulation(elaResult) {
    const suspiciousCount = elaResult.regions.suspicious_count;
    const totalRegions = elaResult.regions.total_regions;
    const suspiciousPercent = (suspiciousCount / totalRegions) * 100;
    const stdDev = elaResult.std_dev;
    
    // Scoring factors
    let manipulationScore = 0;
    const indicators = [];
    
    // Factor 1: Suspicious region count
    if (suspiciousCount >= 10) {
      manipulationScore += 30;
      indicators.push(`${suspiciousCount} regions show inconsistent error levels`);
    } else if (suspiciousCount >= 5) {
      manipulationScore += 20;
      indicators.push(`${suspiciousCount} regions show inconsistent error levels`);
    } else if (suspiciousCount >= 2) {
      manipulationScore += 10;
      indicators.push(`${suspiciousCount} regions show minor inconsistencies`);
    }
    
    // Factor 2: High standard deviation (indicates mixed compression history)
    if (stdDev > 15) {
      manipulationScore += 25;
      indicators.push('High error variance suggests multiple compression generations');
    } else if (stdDev > 10) {
      manipulationScore += 15;
      indicators.push('Moderate error variance detected');
    }
    
    // Factor 3: Clustered suspicious regions (indicates localized editing)
    const clusters = this.findClusters(elaResult.regions.suspicious_regions);
    if (clusters.length > 0) {
      manipulationScore += 20;
      indicators.push(`${clusters.length} clustered suspicious area(s) detected`);
    }
    
    // Factor 4: Mix of high and low error regions (indicates splicing or cloning)
    const highErrorRegions = elaResult.regions.suspicious_regions.filter(r => r.type === 'high_error');
    const lowErrorRegions = elaResult.regions.suspicious_regions.filter(r => r.type === 'low_error');
    
    if (highErrorRegions.length > 0 && lowErrorRegions.length > 0) {
      manipulationScore += 15;
      indicators.push('Mixed error patterns suggest composite or cloned content');
    }
    
    // Determine verdict
    let verdict, severity, confidence;
    
    if (manipulationScore >= 60) {
      verdict = 'LIKELY_MANIPULATED';
      severity = 'critical';
      confidence = Math.min(95, 60 + manipulationScore / 2);
    } else if (manipulationScore >= 35) {
      verdict = 'POSSIBLY_MANIPULATED';
      severity = 'significant';
      confidence = Math.min(80, 40 + manipulationScore);
    } else if (manipulationScore >= 15) {
      verdict = 'MINOR_INCONSISTENCIES';
      severity = 'minor';
      confidence = Math.min(60, 30 + manipulationScore);
    } else {
      verdict = 'NO_MANIPULATION_DETECTED';
      severity = 'none';
      confidence = Math.max(20, 80 - manipulationScore * 2);
    }
    
    return {
      manipulation_score: manipulationScore,
      verdict,
      severity,
      confidence: Math.round(confidence),
      indicators,
      high_error_regions: highErrorRegions.length,
      low_error_regions: lowErrorRegions.length,
      clusters: clusters
    };
  }
  
  /**
   * Find clusters of adjacent suspicious regions
   */
  findClusters(suspiciousRegions) {
    if (suspiciousRegions.length < 2) return [];
    
    const clusters = [];
    const visited = new Set();
    
    for (const region of suspiciousRegions) {
      const key = `${region.x},${region.y}`;
      if (visited.has(key)) continue;
      
      // BFS to find connected regions
      const cluster = [];
      const queue = [region];
      
      while (queue.length > 0) {
        const current = queue.shift();
        const currentKey = `${current.x},${current.y}`;
        
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);
        cluster.push(current);
        
        // Check adjacent regions
        for (const other of suspiciousRegions) {
          const otherKey = `${other.x},${other.y}`;
          if (visited.has(otherKey)) continue;
          
          const dx = Math.abs(other.x - current.x);
          const dy = Math.abs(other.y - current.y);
          
          if (dx <= 1 && dy <= 1) {
            queue.push(other);
          }
        }
      }
      
      if (cluster.length >= 2) {
        clusters.push({
          size: cluster.length,
          location: this.describeLocation(
            Math.round(cluster.reduce((s, r) => s + r.x, 0) / cluster.length),
            Math.round(cluster.reduce((s, r) => s + r.y, 0) / cluster.length),
            16
          ),
          type: cluster[0].type,
          regions: cluster.map(r => r.gridPosition)
        });
      }
    }
    
    return clusters;
  }
}

module.exports = new ELAAnalysis();
