/**
 * OpenTimestamps Blockchain Verification Service
 * Anchors content hashes to Bitcoin blockchain for free, tamper-proof timestamping
 * 
 * Features:
 * - Free timestamping via Bitcoin blockchain
 * - Cryptographic proof of existence at specific time
 * - Independently verifiable by anyone
 * - No API keys or accounts needed
 * 
 * Docs: https://opentimestamps.org/
 */

const OpenTimestamps = require('opentimestamps');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

class OpenTimestampsService {
  
  constructor() {
    this.stampDir = './blockchain-stamps';
    this.initializeDirectory();
  }

  /**
   * Initialize directory for storing timestamp proofs
   */
  async initializeDirectory() {
    try {
      await fs.mkdir(this.stampDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create stamps directory:', error);
    }
  }

  /**
   * Fetch Bitcoin block time from public API
   */
  async getBlockTime(height) {
    return new Promise((resolve) => {
      https.get(`https://blockchain.info/block-height/${height}?format=json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.blocks && json.blocks[0]) {
              resolve({
                time: json.blocks[0].time,
                hash: json.blocks[0].hash
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }

  /**
   * Find Bitcoin attestations in timestamp
   */
  findBitcoinAttestations(timestamp, attestations = []) {
    if (timestamp.attestations) {
      for (const att of timestamp.attestations) {
        if (att.constructor.name === 'BitcoinBlockHeaderAttestation') {
          attestations.push(att);
        }
      }
    }
    if (timestamp.ops) {
      for (const [op, nextTs] of timestamp.ops) {
        this.findBitcoinAttestations(nextTs, attestations);
      }
    }
    return attestations;
  }

  /**
   * Create timestamp for a file hash
   * @param {string} fileHash - SHA-256 hash of the file
   * @param {string} filename - Original filename for reference
   * @returns {Object} Timestamp result
   */
  async timestamp(fileHash, filename = 'unknown') {
    try {
      console.log(`🔗 Creating OpenTimestamps proof for ${filename}...`);
      
      // Convert hex hash to buffer
      const hashBuffer = Buffer.from(fileHash, 'hex');
      
      // Create detached timestamp
      const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
        new OpenTimestamps.Ops.OpSHA256(),
        hashBuffer
      );

      // Stamp it (this submits to calendar servers)
      await OpenTimestamps.stamp(detached);

      // Serialize the timestamp proof
      const proofBytes = detached.serializeToBytes();
      const proofHex = Buffer.from(proofBytes).toString('hex');

      // Save proof to file
      const proofPath = path.join(this.stampDir, `${fileHash}.ots`);
      await fs.writeFile(proofPath, proofBytes);

      console.log(`✅ Timestamp created and submitted to calendar servers`);
      console.log(`   Proof saved: ${proofPath}`);

      return {
        success: true,
        hash: fileHash,
        proof_file: proofPath,
        proof_hex: proofHex,
        status: 'pending',
        message: 'Timestamp submitted to calendar servers. Bitcoin confirmation pending (may take hours).',
        submitted_at: new Date().toISOString(),
        estimated_confirmation: this.estimateConfirmation()
      };

    } catch (error) {
      console.error('❌ OpenTimestamps error:', error);
      return {
        success: false,
        error: error.message,
        hash: fileHash
      };
    }
  }

  /**
   * Verify an existing timestamp
   * @param {string} fileHash - SHA-256 hash to verify
   * @returns {Object} Verification result
   */
  async verify(fileHash) {
    try {
      const proofPath = path.join(this.stampDir, `${fileHash}.ots`);
      
      // Check if proof exists
      try {
        await fs.access(proofPath);
      } catch {
        return {
          verified: false,
          status: 'not_found',
          message: 'No timestamp proof found for this file'
        };
      }

      // Read the proof
      const proofBytes = await fs.readFile(proofPath);
      
      // Deserialize
      const detached = OpenTimestamps.DetachedTimestampFile.deserialize(proofBytes);

      // Upgrade the timestamp (checks if Bitcoin confirmation is available)
      const upgraded = await OpenTimestamps.upgrade(detached);

      // Save upgraded proof if changed
      if (upgraded) {
        const upgradedBytes = detached.serializeToBytes();
        await fs.writeFile(proofPath, upgradedBytes);
      }

      // Find Bitcoin attestations
      const bitcoinAttestations = this.findBitcoinAttestations(detached.timestamp);

      if (bitcoinAttestations.length === 0) {
        return {
          verified: false,
          status: 'pending',
          message: 'Timestamp exists but Bitcoin confirmation is still pending',
          submitted_at: await this.getSubmissionTime(fileHash)
        };
      }

      // Get the earliest (lowest block height) attestation
      const earliest = bitcoinAttestations.reduce((min, att) => 
        att.height < min.height ? att : min
      );

      // Fetch actual block time and hash
      const blockInfo = await this.getBlockTime(earliest.height);

      return {
        verified: true,
        status: 'confirmed',
        message: 'Timestamp confirmed on Bitcoin blockchain',
        bitcoin: {
          block_height: earliest.height,
          block_hash: blockInfo?.hash || null,
          block_time: blockInfo?.time || null,
          timestamp: blockInfo ? new Date(blockInfo.time * 1000).toISOString() : null
        },
        attestations_count: bitcoinAttestations.length,
        proof_file: proofPath,
        verify_url: `https://opentimestamps.org/verify.html`
      };

    } catch (error) {
      console.error('❌ Verification error:', error);
      return {
        verified: false,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Check status of a timestamp without full verification
   * @param {string} fileHash - SHA-256 hash
   * @returns {Object} Status info
   */
  async getStatus(fileHash) {
    try {
      const proofPath = path.join(this.stampDir, `${fileHash}.ots`);
      
      // Check if proof exists
      try {
        await fs.access(proofPath);
      } catch {
        return {
          exists: false,
          status: 'not_timestamped'
        };
      }

      // Get file stats for submission time
      const stats = await fs.stat(proofPath);
      
      return {
        exists: true,
        status: 'submitted',
        proof_file: proofPath,
        submitted_at: stats.birthtime.toISOString(),
        estimated_confirmation: this.estimateConfirmation(stats.birthtime)
      };

    } catch (error) {
      return {
        exists: false,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Estimate when Bitcoin confirmation will occur
   * @param {Date} submissionTime - When timestamp was submitted
   * @returns {string} Estimated confirmation time
   */
  estimateConfirmation(submissionTime = new Date()) {
    // Bitcoin blocks are ~10 minutes
    // Calendar servers usually batch submissions hourly
    const hoursToWait = 2; // Conservative estimate
    const confirmationTime = new Date(submissionTime.getTime() + (hoursToWait * 60 * 60 * 1000));
    return confirmationTime.toISOString();
  }

  /**
   * Get submission time from proof file
   * @param {string} fileHash 
   * @returns {string} ISO timestamp
   */
  async getSubmissionTime(fileHash) {
    try {
      const proofPath = path.join(this.stampDir, `${fileHash}.ots`);
      const stats = await fs.stat(proofPath);
      return stats.birthtime.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Batch timestamp multiple hashes
   * @param {Array} hashes - Array of {hash, filename} objects
   * @returns {Array} Results for each hash
   */
  async batchTimestamp(hashes) {
    const results = [];
    
    for (const item of hashes) {
      const result = await this.timestamp(item.hash, item.filename);
      results.push(result);
      
      // Small delay to avoid overwhelming calendar servers
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Export proof for independent verification
   * @param {string} fileHash 
   * @returns {Object} Proof data for sharing
   */
  async exportProof(fileHash) {
    try {
      const proofPath = path.join(this.stampDir, `${fileHash}.ots`);
      const proofBytes = await fs.readFile(proofPath);
      const proofHex = Buffer.from(proofBytes).toString('hex');
      
      return {
        success: true,
        hash: fileHash,
        proof_hex: proofHex,
        proof_base64: proofBytes.toString('base64'),
        verify_url: `https://opentimestamps.org/?hash=${fileHash}`,
        instructions: 'Upload the .ots file to opentimestamps.org to independently verify'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up old pending timestamps (optional maintenance)
   * @param {number} daysOld - Remove pending stamps older than this
   */
  async cleanupOldPending(daysOld = 7) {
    try {
      const files = await fs.readdir(this.stampDir);
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.ots')) continue;

        const filePath = path.join(this.stampDir, file);
        const stats = await fs.stat(filePath);

        // Only clean if old and still pending (small file size indicates pending)
        if (stats.birthtime.getTime() < cutoffTime && stats.size < 500) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }

      console.log(`🧹 Cleaned up ${cleaned} old pending timestamps`);
      return { cleaned };

    } catch (error) {
      console.error('Cleanup error:', error);
      return { cleaned: 0, error: error.message };
    }
  }
}

module.exports = new OpenTimestampsService();
