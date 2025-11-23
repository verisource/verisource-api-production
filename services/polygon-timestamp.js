/**
 * Polygon Blockchain Timestamping Service
 * Instant blockchain confirmations (~2 seconds)
 * Low cost (~$0.0001-0.001 per timestamp)
 */
const ethers = require('ethers');

class PolygonTimestampService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.enabled = false;
    this.initialize();
  }

  initialize() {
    const rpcUrl = process.env.POLYGON_RPC_URL;
    const privateKey = process.env.POLYGON_PRIVATE_KEY;
    
    if (!rpcUrl || !privateKey) {
      console.log('⚠️ Polygon not configured - set POLYGON_RPC_URL and POLYGON_PRIVATE_KEY');
      return;
    }

    try {
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.enabled = true;
      console.log('✅ Polygon service initialized:', this.wallet.address);
    } catch (error) {
      console.error('❌ Polygon initialization failed:', error.message);
    }
  }

  /**
   * Timestamp a file hash to Polygon blockchain
   * @param {string} fileHash - SHA-256 hash of the file
   * @param {string} filename - Original filename for reference
   * @returns {Object} Transaction result
   */
  async timestamp(fileHash, filename = 'unknown') {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Polygon service not configured'
      };
    }

    try {
      console.log(`🔗 Timestamping to Polygon: ${filename}`);
      
      // Get current gas price
      const gasPrice = await this.provider.getGasPrice();
      
      // Create transaction with hash in data field
      const tx = await this.wallet.sendTransaction({
        to: this.wallet.address, // Send to self
        value: ethers.utils.parseEther('0'), // No value transfer
        data: '0x' + fileHash, // File hash as data
        gasLimit: 21000 + (fileHash.length / 2), // Base + data
        gasPrice: gasPrice
      });

      console.log(`📤 Transaction sent: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait(1); // 1 confirmation
      
      console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

      // Get block timestamp
      const block = await this.provider.getBlock(receipt.blockNumber);
      
      // Calculate cost
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const maticCost = ethers.utils.formatEther(gasCost);
      
      // Estimate USD cost (approximate - would need price oracle for real-time)
      const maticPriceUSD = 0.45; // Approximate
      const costUSD = (parseFloat(maticCost) * maticPriceUSD).toFixed(6);

      return {
        success: true,
        transaction_hash: receipt.transactionHash,
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        gas_used: receipt.gasUsed.toString(),
        gas_cost_matic: maticCost,
        gas_cost_usd: costUSD,
        explorer_url: `https://polygonscan.com/tx/${receipt.transactionHash}`,
        confirmations: 1,
        network: 'polygon'
      };

    } catch (error) {
      console.error('❌ Polygon timestamp failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify a timestamp on Polygon
   * @param {string} txHash - Transaction hash
   * @returns {Object} Verification result
   */
  async verify(txHash) {
    if (!this.enabled) {
      return { success: false, error: 'Polygon service not configured' };
    }

    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        return { success: false, error: 'Transaction not found' };
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);
      const block = await this.provider.getBlock(receipt.blockNumber);

      return {
        success: true,
        hash: tx.data.substring(2), // Remove 0x prefix
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        confirmations: await this.provider.getBlockNumber() - receipt.blockNumber
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check wallet balance
   */
  async getBalance() {
    if (!this.enabled) return null;
    
    try {
      const balance = await this.wallet.getBalance();
      return ethers.utils.formatEther(balance);
    } catch (error) {
      console.error('Error getting balance:', error.message);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new PolygonTimestampService();
