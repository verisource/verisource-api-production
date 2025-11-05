/**
 * Batch Store Service
 * In-memory cache for storing batch verification results
 * Results are automatically deleted after 24 hours
 */

const NodeCache = require('node-cache');

class BatchStore {
  constructor() {
    // Initialize cache with 24-hour TTL
    this.cache = new NodeCache({
      stdTTL: 86400, // 24 hours in seconds
      checkperiod: 600, // Check for expired entries every 10 minutes
      useClones: false, // Don't clone objects (better performance)
      deleteOnExpire: true
    });
    
    // Track statistics
    this.stats = {
      totalBatches: 0,
      activeBatches: 0
    };
    
    // Listen for events
    this.cache.on('set', (key) => {
      this.stats.activeBatches = this.cache.keys().length;
      console.log(`[BatchStore] Stored batch: ${key} (Total active: ${this.stats.activeBatches})`);
    });
    
    this.cache.on('expired', (key) => {
      this.stats.activeBatches = this.cache.keys().length;
      console.log(`[BatchStore] Batch expired: ${key}`);
    });
    
    this.cache.on('del', (key) => {
      this.stats.activeBatches = this.cache.keys().length;
      console.log(`[BatchStore] Batch deleted: ${key}`);
    });
  }
  
  /**
   * Save batch results to cache
   * @param {string} batchId - Unique batch identifier
   * @param {Object} batchData - Batch results data
   * @returns {boolean} Success status
   */
  saveBatch(batchId, batchData) {
    try {
      const success = this.cache.set(batchId, batchData);
      
      if (success) {
        this.stats.totalBatches++;
      }
      
      return success;
    } catch (error) {
      console.error(`[BatchStore] Error saving batch ${batchId}:`, error);
      return false;
    }
  }
  
  /**
   * Retrieve batch results from cache
   * @param {string} batchId - Unique batch identifier
   * @returns {Object|null} Batch data or null if not found
   */
  getBatch(batchId) {
    try {
      const batchData = this.cache.get(batchId);
      
      if (!batchData) {
        console.log(`[BatchStore] Batch not found: ${batchId}`);
        return null;
      }
      
      return batchData;
    } catch (error) {
      console.error(`[BatchStore] Error retrieving batch ${batchId}:`, error);
      return null;
    }
  }
  
  /**
   * Delete batch from cache
   * @param {string} batchId - Unique batch identifier
   * @returns {boolean} Success status
   */
  deleteBatch(batchId) {
    try {
      const deleted = this.cache.del(batchId);
      return deleted > 0;
    } catch (error) {
      console.error(`[BatchStore] Error deleting batch ${batchId}:`, error);
      return false;
    }
  }
  
  /**
   * Check if batch exists
   * @param {string} batchId - Unique batch identifier
   * @returns {boolean} True if batch exists
   */
  hasBatch(batchId) {
    return this.cache.has(batchId);
  }
  
  /**
   * Get all batch IDs (for admin/debugging)
   * @returns {Array} Array of batch IDs
   */
  getAllBatchIds() {
    return this.cache.keys();
  }
  
  /**
   * Get batches by user ID (requires storing userId in batch data)
   * @param {string} userId - User identifier
   * @returns {Array} Array of batch data for user
   */
  getUserBatches(userId) {
    const allKeys = this.cache.keys();
    const userBatches = [];
    
    for (const key of allKeys) {
      const batch = this.cache.get(key);
      if (batch && batch.userId === userId) {
        userBatches.push(batch);
      }
    }
    
    return userBatches;
  }
  
  /**
   * Update TTL for a specific batch
   * @param {string} batchId - Unique batch identifier
   * @param {number} ttl - Time to live in seconds
   * @returns {boolean} Success status
   */
  extendBatchTTL(batchId, ttl) {
    try {
      return this.cache.ttl(batchId, ttl);
    } catch (error) {
      console.error(`[BatchStore] Error extending TTL for batch ${batchId}:`, error);
      return false;
    }
  }
  
  /**
   * Get remaining TTL for a batch
   * @param {string} batchId - Unique batch identifier
   * @returns {number} Remaining TTL in seconds (0 if not found)
   */
  getBatchTTL(batchId) {
    try {
      const ttl = this.cache.getTtl(batchId);
      
      if (!ttl) return 0;
      
      const now = Date.now();
      const remaining = Math.floor((ttl - now) / 1000);
      
      return remaining > 0 ? remaining : 0;
    } catch (error) {
      console.error(`[BatchStore] Error getting TTL for batch ${batchId}:`, error);
      return 0;
    }
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      activeBatches: this.cache.keys().length,
      cacheStats: this.cache.getStats()
    };
  }
  
  /**
   * Clear all batches (use with caution!)
   * @returns {void}
   */
  clearAll() {
    console.warn('[BatchStore] Clearing all batches from cache');
    this.cache.flushAll();
    this.stats.activeBatches = 0;
  }
  
  /**
   * Clean up expired batches manually
   * @returns {number} Number of deleted batches
   */
  cleanup() {
    const beforeCount = this.cache.keys().length;
    
    // Force check for expired entries
    this.cache.keys().forEach(key => {
      this.cache.get(key); // Triggers expiration check
    });
    
    const afterCount = this.cache.keys().length;
    const deleted = beforeCount - afterCount;
    
    if (deleted > 0) {
      console.log(`[BatchStore] Cleaned up ${deleted} expired batches`);
    }
    
    return deleted;
  }
}

// Create singleton instance
const batchStore = new BatchStore();

// Optional: Schedule periodic cleanup (every hour)
setInterval(() => {
  batchStore.cleanup();
}, 3600000); // 1 hour

module.exports = batchStore;
