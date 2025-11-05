/**
 * Batch Processor Service
 * Handles parallel processing of multiple image files for verification
 */

const fs = require('fs').promises;

class BatchProcessor {
  
  /**
   * Process multiple files in parallel with concurrency control
   * @param {Array} files - Array of multer file objects
   * @param {Object} options - Processing options
   * @param {string} options.userId - User ID for tracking
   * @param {number} options.concurrency - Number of files to process simultaneously
   * @param {boolean} options.checkDuplicates - Whether to check for duplicates
   * @returns {Object} Batch processing results
   */
  async processBatch(files, options = {}) {
    const concurrency = options.concurrency || 10;
    const startTime = Date.now();
    
    console.log(`[BatchProcessor] Starting batch of ${files.length} files with concurrency ${concurrency}`);
    
    const results = [];
    
    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      
      console.log(`[BatchProcessor] Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(files.length / concurrency)}`);
      
      const batchResults = await Promise.allSettled(
        batch.map((file, index) => 
          this.processFile(file, i + index, options)
        )
      );
      
      results.push(...batchResults);
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`[BatchProcessor] Completed in ${processingTime}ms`);
    
    return this.formatResults(files, results, processingTime);
  }
  
  /**
   * Process a single file
   * @param {Object} file - Multer file object
   * @param {number} index - File index in batch
   * @param {Object} options - Processing options
   * @returns {Object} Processing result
   */
  async processFile(file, index, options) {
    try {
      console.log(`[BatchProcessor] Processing file ${index + 1}: ${file.originalname}`);
      
      // Import the image processor dynamically to avoid circular dependencies
      const { canonicalizeImage } = require('../canonicalization');
      
      // Process the image using your existing processor
      const result = await canonicalizeImage(file.path, {
        userId: options.userId,
        checkDuplicates: options.checkDuplicates !== false,
        originalName: file.originalname
      });
      
      // Clean up temp file
      await fs.unlink(file.path).catch(err => {
        console.warn(`[BatchProcessor] Failed to delete temp file ${file.path}:`, err.message);
      });
      
      // Format the success result
      return {
        index,
        filename: file.originalname,
        status: 'success',
        fileId: result.fileId || this.generateFileId(),
        fingerprint: {
          sha256: result.sha256 || result.hash,
          perceptualHash: result.perceptualHash || result.phash,
          hashVersion: result.hashVersion || 'v2'
        },
        metadata: {
          width: result.width || result.metadata?.width,
          height: result.height || result.metadata?.height,
          format: result.format || result.metadata?.format || file.mimetype?.split('/')[1],
          size: file.size,
          created: result.created || result.metadata?.created || new Date()
        },
        matches: this.formatMatches(result.matches || []),
        verification: {
          isOriginal: !result.matches || result.matches.length === 0,
          confidence: result.confidence || this.calculateConfidence(result),
          warnings: this.generateWarnings(result)
        },
        processingTime: result.processingTime || null
      };
      
    } catch (error) {
      console.error(`[BatchProcessor] Error processing file ${index + 1} (${file.originalname}):`, error.message);
      
      // Clean up temp file on error
      await fs.unlink(file.path).catch(() => {});
      
      // Format the error result
      return {
        index,
        filename: file.originalname,
        status: 'failed',
        error: {
          code: this.getErrorCode(error),
          message: this.getErrorMessage(error),
          details: error.details || error.stack?.split('\n')[0] || ''
        }
      };
    }
  }
  
  /**
   * Format batch results into a standardized response
   * @param {Array} files - Original file array
   * @param {Array} results - Promise.allSettled results
   * @param {number} processingTime - Total processing time in ms
   * @returns {Object} Formatted batch results
   */
  formatResults(files, results, processingTime) {
    const formatted = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Handle rejected promises
        console.error(`[BatchProcessor] Unexpected rejection for file ${index}:`, result.reason);
        return {
          index,
          filename: files[index]?.originalname || 'unknown',
          status: 'failed',
          error: {
            code: 'PROCESSING_ERROR',
            message: result.reason?.message || 'Unknown error occurred',
            details: ''
          }
        };
      }
    });
    
    // Calculate summary statistics
    const successful = formatted.filter(r => r.status === 'success').length;
    const failed = formatted.filter(r => r.status === 'failed').length;
    const duplicatesFound = formatted.reduce((count, r) => {
      return count + (r.status === 'success' && r.matches && r.matches.length > 0 ? 1 : 0);
    }, 0);
    
    return {
      summary: {
        total: files.length,
        successful,
        failed,
        duplicatesFound
      },
      timing: {
        processingTime,
        avgTimePerFile: Math.round(processingTime / files.length)
      },
      results: formatted
    };
  }
  
  /**
   * Format match results for consistency
   * @param {Array} matches - Raw match results
   * @returns {Array} Formatted matches
   */
  formatMatches(matches) {
    return matches.map(match => ({
      matchId: match.matchId || match.id || match.fileId,
      filename: match.filename || match.name,
      uploadedBy: match.uploadedBy || match.userId,
      uploadedAt: match.uploadedAt || match.createdAt,
      similarity: match.similarity || match.score,
      confidence: this.getSimilarityConfidence(match.similarity || match.score),
      matchType: this.getMatchType(match.similarity || match.score)
    }));
  }
  
  /**
   * Generate warnings based on processing results
   * @param {Object} result - Processing result
   * @returns {Array} Array of warning messages
   */
  generateWarnings(result) {
    const warnings = [];
    
    // Check for duplicates
    if (result.matches && result.matches.length > 0) {
      warnings.push('Possible duplicate detected');
    }
    
    // Check for low resolution
    const width = result.width || result.metadata?.width;
    const height = result.height || result.metadata?.height;
    if (width && height && (width < 500 || height < 500)) {
      warnings.push('Low resolution image - may affect verification accuracy');
    }
    
    // Check for very low resolution
    if (width && height && (width < 200 || height < 200)) {
      warnings.push('Very low resolution - verification results may be unreliable');
    }
    
    // Check for quality issues
    if (result.quality && result.quality < 50) {
      warnings.push('Low quality/heavy compression detected');
    }
    
    // Check for unusual aspect ratios
    if (width && height) {
      const aspectRatio = width / height;
      if (aspectRatio > 5 || aspectRatio < 0.2) {
        warnings.push('Unusual aspect ratio detected');
      }
    }
    
    return warnings;
  }
  
  /**
   * Calculate confidence level based on result data
   * @param {Object} result - Processing result
   * @returns {string} Confidence level: 'high', 'medium', or 'low'
   */
  calculateConfidence(result) {
    if (result.confidence) {
      return result.confidence;
    }
    
    // Calculate based on image properties
    const width = result.width || result.metadata?.width || 0;
    const height = result.height || result.metadata?.height || 0;
    const pixels = width * height;
    
    if (pixels >= 2000000) return 'high';  // 2MP+
    if (pixels >= 500000) return 'medium'; // 500K - 2MP
    return 'low'; // < 500K
  }
  
  /**
   * Get similarity confidence level
   * @param {number} similarity - Similarity score (0-1)
   * @returns {string} Confidence level
   */
  getSimilarityConfidence(similarity) {
    if (similarity >= 0.95) return 'very-high';
    if (similarity >= 0.85) return 'high';
    if (similarity >= 0.75) return 'medium';
    return 'low';
  }
  
  /**
   * Get match type based on similarity score
   * @param {number} similarity - Similarity score (0-1)
   * @returns {string} Match type
   */
  getMatchType(similarity) {
    if (similarity >= 0.98) return 'exact-duplicate';
    if (similarity >= 0.90) return 'near-duplicate';
    if (similarity >= 0.80) return 'similar';
    return 'possible-match';
  }
  
  /**
   * Get error code from error object
   * @param {Error} error - Error object
   * @returns {string} Error code
   */
  getErrorCode(error) {
    // Check for explicit error code
    if (error.code) return error.code;
    
    const message = error.message.toLowerCase();
    
    // Check for common error patterns
    if (message.includes('invalid') || message.includes('corrupt')) {
      return 'INVALID_IMAGE';
    }
    if (message.includes('size') || message.includes('small')) {
      return 'IMAGE_TOO_SMALL';
    }
    if (message.includes('large') || message.includes('exceeds')) {
      return 'IMAGE_TOO_LARGE';
    }
    if (message.includes('format') || message.includes('unsupported')) {
      return 'UNSUPPORTED_FORMAT';
    }
    if (message.includes('timeout')) {
      return 'PROCESSING_TIMEOUT';
    }
    if (message.includes('memory')) {
      return 'OUT_OF_MEMORY';
    }
    
    return 'PROCESSING_ERROR';
  }
  
  /**
   * Get user-friendly error message
   * @param {Error} error - Error object
   * @returns {string} User-friendly error message
   */
  getErrorMessage(error) {
    const code = this.getErrorCode(error);
    
    const messages = {
      'INVALID_IMAGE': 'File is corrupted or not a valid image format',
      'IMAGE_TOO_SMALL': 'Image dimensions are too small for reliable verification',
      'IMAGE_TOO_LARGE': 'Image file size exceeds the maximum allowed',
      'UNSUPPORTED_FORMAT': 'Image format is not supported',
      'PROCESSING_TIMEOUT': 'Image processing took too long and was cancelled',
      'OUT_OF_MEMORY': 'Image is too large to process',
      'PROCESSING_ERROR': 'An error occurred while processing the image'
    };
    
    return messages[code] || error.message || 'Unknown error occurred';
  }
  
  /**
   * Generate a unique file ID
   * @returns {string} Unique file ID
   */
  generateFileId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `file_${timestamp}_${random}`;
  }
}

module.exports = new BatchProcessor();