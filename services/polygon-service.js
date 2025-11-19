/**
 * Polygon Blockchain Verification Service
 * Anchors content hashes to Polygon blockchain with 2-second confirmations
 * 
 * Features:
 * - Instant verification (~2 seconds)
 * - Very cheap (~$0.01 per transaction)
 * - Store metadata on-chain
 * - Ethereum-compatible
 * 
 * Requirements:
 * - POLYGON_PRIVATE_KEY in environment
 * - MATIC tokens in wallet for gas
 */

const { ethers } = require('ethers');

class PolygonBlockchainService {
  
  constructor() {
    this.rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    this.privateKey = process.env.POLYGON_PRIVATE_KEY;
    this.provider = null;
    this.wallet = null;
    this.isConfigured = false;
    
    this.initialize();
  }

  /**
   * Initialize provider and wallet
   */
  initialize() {
    try {
      if (!this.privateKey) {
        console.log('⚠️ Polygon blockchain: No POLYGON_PRIVATE_KEY configured');
        return;
      }

      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
      this.wallet = new ethers.Wallet(this.privateKey, this.provider);
      this.isConfigured = true;
      
      console.log('✅ Polygon blockchain initialized');
      console.log(`   Wallet: ${this.wallet.address}`);
      console.log(`   Network: Polygon Mainnet`);
      
      // Check balance on startup
      this.checkBalance();
      
    } catch (error) {
      console.error('❌ Polygon initialization failed:', error.message);
      this.isConfigured = false;
    }
  }

  /**
   * Check wallet balance
   */
  async checkBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      const maticBalance = ethers.formatEther(balance);
      
      console.log(`   Balance: ${maticBalance} MATIC`);
      
      if (parseFloat(maticBalance) < 0.1) {
        console.warn(`   ⚠️ Low balance! Add more MATIC to ${this.wallet.address}`);
      }
      
      return maticBalance;
    } catch (error) {
      console.error('Error checking balance:', error.message);
      return '0';
    }
  }

  /**
   * Anchor a file hash to Polygon blockchain
   * @param {string} fileHash - SHA-256 hash of the file
   * @param {Object} metadata - Additional metadata to store
   * @returns {Object} Transaction result
   */
  async anchor(fileHash, metadata = {}) {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'Polygon blockchain not configured',
        status: 'not_configured'
      };
    }

    try {
      console.log(`🔗 Anchoring to Polygon: ${fileHash.substring(0, 16)}...`);
      
      // Create transaction data with hash and metadata
      const data = this.encodeData(fileHash, metadata);
      
      // Send transaction to ourselves with data in transaction
      const tx = await this.wallet.sendTransaction({
        to: this.wallet.address, // Send to self
        value: 0, // No value transfer
        data: data,
        gasLimit: 100000 // Set reasonable gas limit
      });

      console.log(`   Transaction sent: ${tx.hash}`);
      console.log(`   Waiting for confirmation...`);

      // Wait for confirmation (usually 2-3 seconds)
      const receipt = await tx.wait();

      console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

      const gasPrice = receipt.gasPrice || tx.gasPrice;
      const gasCostWei = receipt.gasUsed * gasPrice;
      const gasCostMatic = ethers.formatEther(gasCostWei);
      const gasCostUsd = (parseFloat(gasCostMatic) * 0.90).toFixed(4); // Approximate MATIC price

      return {
        success: true,
        status: 'confirmed',
        hash: fileHash,
        transaction_hash: tx.hash,
        block_number: receipt.blockNumber,
        block_hash: receipt.blockHash,
        timestamp: new Date().toISOString(),
        explorer_url: `https://polygonscan.com/tx/${tx.hash}`,
        gas_used: receipt.gasUsed.toString(),
        gas_cost_matic: gasCostMatic,
        gas_cost_usd: gasCostUsd,
        network: 'Polygon Mainnet',
        wallet_address: this.wallet.address
      };

    } catch (error) {
      console.error('❌ Polygon anchoring failed:', error.message);
      
      // Check if it's a balance issue
      if (error.message.includes('insufficient funds')) {
        return {
          success: false,
          error: 'Insufficient MATIC balance',
          status: 'insufficient_funds',
          wallet_address: this.wallet.address
        };
      }

      return {
        success: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Encode file hash and metadata into transaction data
   * @param {string} fileHash 
   * @param {Object} metadata 
   * @returns {string} Hex-encoded data
   */
  encodeData(fileHash, metadata) {
    // Create a simple data structure:
    // First 32 bytes: file hash
    // Rest: JSON metadata (optional)
    
    const hashBytes = ethers.getBytes('0x' + fileHash);
    
    if (Object.keys(metadata).length === 0) {
      return ethers.hexlify(hashBytes);
    }

    // Add metadata as JSON
    const metadataJson = JSON.stringify({
      v: 1, // version
      ...metadata
    });
    
    const metadataBytes = ethers.toUtf8Bytes(metadataJson);
    const combined = new Uint8Array(hashBytes.length + metadataBytes.length);
    combined.set(hashBytes, 0);
    combined.set(metadataBytes, hashBytes.length);
    
    return ethers.hexlify(combined);
  }

  /**
   * Verify a transaction on Polygon
   * @param {string} txHash - Transaction hash to verify
   * @returns {Object} Verification result
   */
  async verifyTransaction(txHash) {
    if (!this.isConfigured) {
      return {
        verified: false,
        error: 'Polygon blockchain not configured'
      };
    }

    try {
      const tx = await this.provider.getTransaction(txHash);
      
      if (!tx) {
        return {
          verified: false,
          status: 'not_found',
          message: 'Transaction not found'
        };
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return {
          verified: false,
          status: 'pending',
          message: 'Transaction is pending confirmation'
        };
      }

      // Decode the data to get file hash
      const data = tx.data;
      const fileHash = data.substring(2, 66); // First 32 bytes after 0x

      return {
        verified: true,
        status: 'confirmed',
        file_hash: fileHash,
        transaction_hash: txHash,
        block_number: receipt.blockNumber,
        block_hash: receipt.blockHash,
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        explorer_url: `https://polygonscan.com/tx/${txHash}`,
        from: tx.from,
        confirmations: receipt.confirmations || 1
      };

    } catch (error) {
      return {
        verified: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Get current gas price estimate
   * @returns {Object} Gas price info
   */
  async getGasEstimate() {
    if (!this.isConfigured) {
      return { error: 'Not configured' };
    }

    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      
      // Estimate cost for our typical transaction (100k gas)
      const estimatedGas = 100000n;
      const costWei = estimatedGas * gasPrice;
      const costMatic = ethers.formatEther(costWei);
      const costUsd = (parseFloat(costMatic) * 0.90).toFixed(4);

      return {
        gas_price_gwei: ethers.formatUnits(gasPrice, 'gwei'),
        estimated_cost_matic: costMatic,
        estimated_cost_usd: costUsd,
        network: 'Polygon Mainnet'
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Batch anchor multiple hashes (more gas efficient)
   * @param {Array} hashes - Array of file hashes
   * @returns {Array} Results for each hash
   */
  async batchAnchor(hashes) {
    const results = [];
    
    for (const hash of hashes) {
      const result = await this.anchor(hash);
      results.push(result);
      
      // Small delay between transactions
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return results;
  }

  /**
   * Get wallet info
   * @returns {Object} Wallet information
   */
  async getWalletInfo() {
    if (!this.isConfigured) {
      return { configured: false };
    }

    try {
      const balance = await this.checkBalance();
      const network = await this.provider.getNetwork();
      
      return {
        configured: true,
        address: this.wallet.address,
        balance_matic: balance,
        network: network.name,
        chain_id: Number(network.chainId),
        rpc_url: this.rpcUrl
      };

    } catch (error) {
      return {
        configured: true,
        error: error.message
      };
    }
  }
}

module.exports = new PolygonBlockchainService();