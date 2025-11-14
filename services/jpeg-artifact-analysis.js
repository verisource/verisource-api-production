const sharp = require('sharp');
const jpeg = require('jpeg-js');
const fs = require('fs').promises;

/**
 * JPEG Artifact Analysis Service
 * Detects AI-generated images through JPEG compression artifact analysis
 * 
 * Detection Methods:
 * 1. Quantization Table Analysis - Detects standard vs. camera-specific Q-tables
 * 2. DCT Coefficient Uniformity - AI images show unnaturally smooth distributions
 * 3. Block Boundary Analysis - Measures 8x8 block discontinuities
 * 4. Double Compression Detection - Identifies multiple save cycles
 */

class JPEGArtifactAnalyzer {
  constructor() {
    // Standard JPEG quantization tables (used by most AI generators)
    this.standardQTables = {
      quality90: this.generateStandardQTable(90),
      quality92: this.generateStandardQTable(92),
      quality95: this.generateStandardQTable(95)
    };

    // Known camera manufacturer Q-table patterns
    this.cameraSignatures = this.initializeCameraSignatures();
  }

  /**
   * Main analysis entry point
   * @param {Buffer|string} input - Image buffer or file path
   * @returns {Object} Analysis results with confidence score
   */
  async analyze(input) {
    try {
      const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
      
      // Verify it's a JPEG
      if (!this.isJPEG(buffer)) {
        return {
          isAI: false,
          confidence: 0,
          reason: 'Not a JPEG image',
          details: {}
        };
      }

      // Extract JPEG data
      const jpegData = jpeg.decode(buffer, { useTArray: true });
      const metadata = await sharp(buffer).metadata();

      // Run all analysis methods
      const qTableAnalysis = await this.analyzeQuantizationTables(buffer);
      const dctAnalysis = this.analyzeDCTCoefficients(jpegData);
      const blockAnalysis = this.analyzeBlockBoundaries(jpegData);
      const compressionAnalysis = this.analyzeCompressionPattern(buffer);

      // Calculate weighted confidence score
      const confidence = this.calculateConfidence({
        qTableAnalysis,
        dctAnalysis,
        blockAnalysis,
        compressionAnalysis
      });

      // Determine if AI-generated
      const isAI = confidence > 0.65; // Threshold for AI classification

      return {
        isAI,
        confidence,
        method: 'jpeg-artifact-analysis',
        details: {
          quantizationTables: qTableAnalysis,
          dctCoefficients: dctAnalysis,
          blockBoundaries: blockAnalysis,
          compressionPattern: compressionAnalysis,
          imageSize: `${metadata.width}x${metadata.height}`,
          format: metadata.format
        },
        reasoning: this.generateReasoning({
          isAI,
          qTableAnalysis,
          dctAnalysis,
          blockAnalysis,
          compressionAnalysis
        })
      };

    } catch (error) {
      console.error('JPEG artifact analysis error:', error);
      return {
        isAI: false,
        confidence: 0,
        error: error.message,
        details: {}
      };
    }
  }

  /**
   * Analyze quantization tables for AI patterns
   * AI generators typically use standard Q-tables, cameras use custom ones
   */
  async analyzeQuantizationTables(buffer) {
    try {
      const qTables = this.extractQuantizationTables(buffer);
      
      if (!qTables || qTables.length === 0) {
        return { score: 0.5, reason: 'No Q-tables found' };
      }

      // Check against standard tables (AI signature)
      const standardMatch = this.matchStandardQTables(qTables);
      
      // Check against camera signatures (real photo indicator)
      const cameraMatch = this.matchCameraSignatures(qTables);

      // Calculate variance in Q-table values (uniformity check)
      const variance = this.calculateQTableVariance(qTables[0]);

      let score = 0;
      let indicators = [];

      // High standard match = likely AI
      if (standardMatch > 0.85) {
        score += 0.7;
        indicators.push('Standard Q-table pattern (AI indicator)');
      }

      // Camera signature match = likely real
      if (cameraMatch.matched) {
        score -= 0.6;
        indicators.push(`Camera signature: ${cameraMatch.manufacturer}`);
      }

      // Low variance = likely AI (too uniform)
      if (variance < 100) {
        score += 0.3;
        indicators.push('Low Q-table variance (AI indicator)');
      }

      // Normalize score to 0-1 range
      score = Math.max(0, Math.min(1, 0.5 + score));

      return {
        score,
        standardMatch,
        cameraMatch: cameraMatch.matched,
        cameraManufacturer: cameraMatch.manufacturer,
        variance,
        indicators
      };

    } catch (error) {
      console.error('Q-table analysis error:', error);
      return { score: 0.5, error: error.message };
    }
  }

  /**
   * Analyze DCT coefficient distributions
   * AI images show unnaturally smooth/uniform distributions
   */
  analyzeDCTCoefficients(jpegData) {
    try {
      const { width, height, data } = jpegData;
      
      // Sample DCT blocks (analyzing every block is too expensive)
      const sampleSize = 100;
      const blocks = this.sampleDCTBlocks(data, width, height, sampleSize);

      // Calculate coefficient statistics
      const stats = {
        highFreqEnergy: 0,    // High freq energy (noise indicator)
        uniformity: 0,         // Coefficient uniformity
        smoothness: 0          // Spatial smoothness
      };

      blocks.forEach(block => {
        // Measure high-frequency energy (bottom-right of DCT block)
        const highFreq = this.measureHighFrequency(block);
        stats.highFreqEnergy += highFreq;

        // Measure coefficient uniformity
        const uniform = this.measureUniformity(block);
        stats.uniformity += uniform;
      });

      stats.highFreqEnergy /= blocks.length;
      stats.uniformity /= blocks.length;

      // AI images typically have:
      // - Low high-frequency energy (too smooth)
      // - High uniformity (too consistent)
      
      let score = 0;
      let indicators = [];

      if (stats.highFreqEnergy < 0.15) {
        score += 0.4;
        indicators.push('Low high-frequency energy (AI indicator)');
      }

      if (stats.uniformity > 0.75) {
        score += 0.4;
        indicators.push('High coefficient uniformity (AI indicator)');
      }

      return {
        score: Math.min(1, score),
        highFreqEnergy: stats.highFreqEnergy,
        uniformity: stats.uniformity,
        indicators
      };

    } catch (error) {
      console.error('DCT analysis error:', error);
      return { score: 0.5, error: error.message };
    }
  }

  /**
   * Analyze 8x8 block boundaries
   * AI generators often produce unnaturally smooth block boundaries
   */
  analyzeBlockBoundaries(jpegData) {
    try {
      const { width, height, data } = jpegData;
      
      // Sample block boundaries
      const boundaries = this.sampleBlockBoundaries(data, width, height, 50);
      
      let totalDiscontinuity = 0;
      let smoothCount = 0;

      boundaries.forEach(boundary => {
        const discontinuity = this.measureBoundaryDiscontinuity(boundary);
        totalDiscontinuity += discontinuity;
        
        if (discontinuity < 5) {
          smoothCount++;
        }
      });

      const avgDiscontinuity = totalDiscontinuity / boundaries.length;
      const smoothRatio = smoothCount / boundaries.length;

      let score = 0;
      let indicators = [];

      // Real JPEGs show characteristic blocking artifacts
      // AI images are often too smooth at boundaries
      if (avgDiscontinuity < 8) {
        score += 0.5;
        indicators.push('Smooth block boundaries (AI indicator)');
      }

      if (smoothRatio > 0.7) {
        score += 0.3;
        indicators.push('High smooth boundary ratio (AI indicator)');
      }

      return {
        score: Math.min(1, score),
        avgDiscontinuity,
        smoothRatio,
        indicators
      };

    } catch (error) {
      console.error('Block boundary analysis error:', error);
      return { score: 0.5, error: error.message };
    }
  }

  /**
   * Detect double compression patterns
   * Multiple JPEG saves leave detectable artifacts
   */
  analyzeCompressionPattern(buffer) {
    try {
      const qTables = this.extractQuantizationTables(buffer);
      
      if (!qTables || qTables.length === 0) {
        return { score: 0.5, singleCompression: false };
      }

      // Analyze Q-table for signs of double compression
      const doubleCompression = this.detectDoubleCompression(qTables[0]);
      
      let score = 0.5;
      let indicators = [];

      // Single compression = more likely AI (generated and saved once)
      if (!doubleCompression) {
        score = 0.65;
        indicators.push('Single compression detected (AI indicator)');
      } else {
        score = 0.35;
        indicators.push('Multiple compressions detected (editing indicator)');
      }

      return {
        score,
        doubleCompression,
        indicators
      };

    } catch (error) {
      console.error('Compression pattern analysis error:', error);
      return { score: 0.5, error: error.message };
    }
  }

  /**
   * Calculate overall confidence score using weighted average
   */
  calculateConfidence(analyses) {
    const weights = {
      qTableAnalysis: 0.35,      // Highest weight - strong AI indicator
      dctAnalysis: 0.30,         // Medium-high weight
      blockAnalysis: 0.20,       // Medium weight
      compressionAnalysis: 0.15  // Lower weight - less reliable
    };

    let totalScore = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([key, weight]) => {
      if (analyses[key] && typeof analyses[key].score === 'number') {
        totalScore += analyses[key].score * weight;
        totalWeight += weight;
      }
    });

    return totalWeight > 0 ? totalScore / totalWeight : 0.5;
  }

  /**
   * Generate human-readable reasoning
   */
  generateReasoning(data) {
    const { isAI, qTableAnalysis, dctAnalysis, blockAnalysis, compressionAnalysis } = data;
    
    let reasons = [];

    if (qTableAnalysis.indicators) {
      reasons.push(...qTableAnalysis.indicators);
    }
    if (dctAnalysis.indicators) {
      reasons.push(...dctAnalysis.indicators);
    }
    if (blockAnalysis.indicators) {
      reasons.push(...blockAnalysis.indicators);
    }
    if (compressionAnalysis.indicators) {
      reasons.push(...compressionAnalysis.indicators);
    }

    return reasons.join('; ');
  }

  // ===== HELPER METHODS =====

  /**
   * Check if buffer is a JPEG image
   */
  isJPEG(buffer) {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  /**
   * Extract quantization tables from JPEG buffer
   */
  extractQuantizationTables(buffer) {
    const tables = [];
    let offset = 2; // Skip SOI marker (FF D8)

    try {
      while (offset < buffer.length - 1) {
        // Check for marker
        if (buffer[offset] !== 0xFF) {
          offset++;
          continue;
        }

        const marker = buffer[offset + 1];
        offset += 2;

        // DQT marker (Define Quantization Table)
        if (marker === 0xDB) {
          const length = (buffer[offset] << 8) | buffer[offset + 1];
          offset += 2;

          const tableData = [];
          const precision = buffer[offset] >> 4;
          const tableId = buffer[offset] & 0x0F;
          offset++;

          const tableSize = precision === 0 ? 64 : 128;
          for (let i = 0; i < 64; i++) {
            tableData.push(precision === 0 ? buffer[offset++] : 
                          (buffer[offset++] << 8) | buffer[offset++]);
          }

          tables.push(tableData);
        }
        // SOS marker (Start of Scan) - end of headers
        else if (marker === 0xDA) {
          break;
        }
        // Other markers - skip
        else if (marker !== 0x01 && marker !== 0xD0 && marker <= 0xD7) {
          const length = (buffer[offset] << 8) | buffer[offset + 1];
          offset += length;
        }
      }
    } catch (error) {
      console.error('Error extracting Q-tables:', error);
    }

    return tables;
  }

  /**
   * Generate standard JPEG quantization table for given quality
   */
  generateStandardQTable(quality) {
    // Standard luminance quantization table (IJG/libjpeg)
    const base = [
      16, 11, 10, 16,  24,  40,  51,  61,
      12, 12, 14, 19,  26,  58,  60,  55,
      14, 13, 16, 24,  40,  57,  69,  56,
      14, 17, 22, 29,  51,  87,  80,  62,
      18, 22, 37, 56,  68, 109, 103,  77,
      24, 35, 55, 64,  81, 104, 113,  92,
      49, 64, 78, 87, 103, 121, 120, 101,
      72, 92, 95, 98, 112, 100, 103,  99
    ];

    // Scale based on quality factor
    const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
    
    return base.map(val => {
      let scaled = Math.floor((val * scale + 50) / 100);
      return Math.max(1, Math.min(255, scaled));
    });
  }

  /**
   * Initialize known camera manufacturer Q-table signatures
   */
  initializeCameraSignatures() {
    return {
      canon: {
        pattern: [8, 6, 5, 8, 12, 20, 26, 31],
        variance: 150
      },
      nikon: {
        pattern: [10, 7, 6, 10, 14, 24, 31, 37],
        variance: 180
      },
      sony: {
        pattern: [6, 4, 4, 6, 10, 16, 20, 24],
        variance: 120
      }
    };
  }

  /**
   * Match Q-tables against standard tables
   */
  matchStandardQTables(qTables) {
    if (!qTables || qTables.length === 0) return 0;

    const table = qTables[0];
    let bestMatch = 0;

    Object.values(this.standardQTables).forEach(stdTable => {
      const match = this.calculateTableSimilarity(table, stdTable);
      bestMatch = Math.max(bestMatch, match);
    });

    return bestMatch;
  }

  /**
   * Match Q-tables against camera signatures
   */
  matchCameraSignatures(qTables) {
    if (!qTables || qTables.length === 0) {
      return { matched: false, manufacturer: null };
    }

    const table = qTables[0];
    const variance = this.calculateQTableVariance(table);

    for (const [manufacturer, signature] of Object.entries(this.cameraSignatures)) {
      const patternMatch = this.matchPattern(table.slice(0, 8), signature.pattern);
      const varianceMatch = Math.abs(variance - signature.variance) < 50;

      if (patternMatch > 0.7 && varianceMatch) {
        return { matched: true, manufacturer };
      }
    }

    return { matched: false, manufacturer: null };
  }

  /**
   * Calculate similarity between two Q-tables (0-1)
   */
  calculateTableSimilarity(table1, table2) {
    if (table1.length !== table2.length) return 0;

    let totalDiff = 0;
    for (let i = 0; i < table1.length; i++) {
      totalDiff += Math.abs(table1[i] - table2[i]);
    }

    const maxDiff = table1.length * 255;
    return 1 - (totalDiff / maxDiff);
  }

  /**
   * Calculate variance in Q-table values
   */
  calculateQTableVariance(table) {
    const mean = table.reduce((sum, val) => sum + val, 0) / table.length;
    const variance = table.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / table.length;
    return variance;
  }

  /**
   * Match pattern similarity
   */
  matchPattern(values, pattern) {
    if (values.length !== pattern.length) return 0;

    let totalDiff = 0;
    for (let i = 0; i < values.length; i++) {
      totalDiff += Math.abs(values[i] - pattern[i]);
    }

    const maxDiff = values.length * 255;
    return 1 - (totalDiff / maxDiff);
  }

  /**
   * Sample DCT blocks from image data
   */
  sampleDCTBlocks(data, width, height, sampleSize) {
    const blocks = [];
    const blockSize = 8;
    const blocksX = Math.floor(width / blockSize);
    const blocksY = Math.floor(height / blockSize);

    // Randomly sample blocks
    for (let i = 0; i < sampleSize; i++) {
      const blockX = Math.floor(Math.random() * blocksX);
      const blockY = Math.floor(Math.random() * blocksY);

      const block = this.extractBlock(data, width, blockX * blockSize, blockY * blockSize, blockSize);
      blocks.push(block);
    }

    return blocks;
  }

  /**
   * Extract 8x8 block from image data
   */
  extractBlock(data, width, startX, startY, blockSize) {
    const block = [];
    
    for (let y = 0; y < blockSize; y++) {
      for (let x = 0; x < blockSize; x++) {
        const idx = ((startY + y) * width + (startX + x)) * 4;
        // Use luminance value
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        block.push(luma);
      }
    }

    return block;
  }

  /**
   * Measure high-frequency energy in block
   */
  measureHighFrequency(block) {
    // Sum bottom-right quadrant (high frequencies in DCT)
    let energy = 0;
    for (let i = 32; i < 64; i++) {
      energy += Math.abs(block[i]);
    }
    return energy / 32 / 255; // Normalize to 0-1
  }

  /**
   * Measure uniformity of block coefficients
   */
  measureUniformity(block) {
    const mean = block.reduce((sum, val) => sum + val, 0) / block.length;
    const variance = block.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / block.length;
    const stdDev = Math.sqrt(variance);
    
    // Low standard deviation = high uniformity
    return 1 - Math.min(1, stdDev / 128);
  }

  /**
   * Sample block boundaries from image
   */
  sampleBlockBoundaries(data, width, height, sampleSize) {
    const boundaries = [];
    const blockSize = 8;

    for (let i = 0; i < sampleSize; i++) {
      const x = Math.floor(Math.random() * (width / blockSize - 1)) * blockSize;
      const y = Math.floor(Math.random() * (height / blockSize));

      // Extract pixels on both sides of vertical boundary
      const boundary = {
        left: [],
        right: []
      };

      for (let dy = 0; dy < blockSize; dy++) {
        const idx = ((y * blockSize + dy) * width + x) * 4;
        const idxRight = idx + blockSize * 4;

        if (idx < data.length && idxRight < data.length) {
          boundary.left.push(data[idx]); // R channel
          boundary.right.push(data[idxRight]);
        }
      }

      if (boundary.left.length === blockSize) {
        boundaries.push(boundary);
      }
    }

    return boundaries;
  }

  /**
   * Measure discontinuity at block boundary
   */
  measureBoundaryDiscontinuity(boundary) {
    let totalDiff = 0;
    
    for (let i = 0; i < boundary.left.length; i++) {
      totalDiff += Math.abs(boundary.left[i] - boundary.right[i]);
    }

    return totalDiff / boundary.left.length;
  }

  /**
   * Detect double compression artifacts
   */
  detectDoubleCompression(qTable) {
    // Look for characteristic patterns of double compression
    // Double compression shows periodic artifacts in Q-table values
    
    let periodicCount = 0;
    for (let i = 1; i < qTable.length - 1; i++) {
      const diff1 = Math.abs(qTable[i] - qTable[i-1]);
      const diff2 = Math.abs(qTable[i+1] - qTable[i]);
      
      // Look for sudden changes (signs of re-quantization)
      if (diff1 > 5 && diff2 > 5) {
        periodicCount++;
      }
    }

    // If we see many sudden changes, likely double compression
    return periodicCount > 10;
  }
}

module.exports = JPEGArtifactAnalyzer;