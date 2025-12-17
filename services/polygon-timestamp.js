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
      const JsonRpcProvider = ethers.JsonRpcProvider || ethers.providers?.JsonRpcProvider;
      const Wallet = ethers.Wallet;
      
      if (!JsonRpcProvider) {
        throw new Error('JsonRpcProvider not available in ethers module');
      }

      const polygonNetwork = {
        name: 'matic',
        chainId: 137
      };
      this.provider = new JsonRpcProvider(rpcUrl, polygonNetwork);
      this.wallet = new Wallet(privateKey, this.provider);
      this.enabled = true;
      console.log('✅ Polygon service initialized:', this.wallet.address);
    } catch (error) {
      console.error('❌ Polygon initialization failed:', error.message);
    }
  }

  async timestamp(fileHash, filename = 'unknown') {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Polygon service not configured'
      };
    }

    try {
      console.log(`🔗 Timestamping to Polygon: ${filename}`);
      
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      
      const parseEther = ethers.parseEther || ethers.utils?.parseEther;
      
      const tx = await this.wallet.sendTransaction({
        to: this.wallet.address,
        value: parseEther('0'),
        data: '0x' + fileHash,
        gasLimit: 25000,
        gasPrice: gasPrice
      });

      console.log(`📤 Transaction sent: ${tx.hash}`);

      const receipt = await tx.wait(1);
      
      console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

      const block = await this.provider.getBlock(receipt.blockNumber);
      
      // Safe gas cost calculation - handle both v5 and v6
      let maticCost = '0';
      try {
        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice || receipt.effectiveGasPrice || feeData.gasPrice;
        
        if (gasUsed && gasPrice) {
          const gasCost = BigInt(gasUsed.toString()) * BigInt(gasPrice.toString());
          const formatEther = ethers.formatEther || ethers.utils?.formatEther;
          maticCost = formatEther(gasCost);
        }
      } catch (costErr) {
        console.log('⚠️ Could not calculate gas cost:', costErr.message);
      }
      
      const maticPriceUSD = 0.45;
      const costUSD = (parseFloat(maticCost) * maticPriceUSD).toFixed(6);

      return {
        success: true,
        transaction_hash: tx.hash || receipt.hash,
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        gas_used: receipt.gasUsed.toString(),
        gas_cost_matic: maticCost,
        gas_cost_usd: costUSD,
        explorer_url: `https://polygonscan.com/tx/${tx.hash || receipt.hash}`,
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
        hash: tx.data.substring(2),
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        confirmations: await this.provider.getBlockNumber() - receipt.blockNumber
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getBalance() {
    if (!this.enabled) return null;
    
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      const formatEther = ethers.formatEther || ethers.utils?.formatEther;
      return formatEther(balance);
    } catch (error) {
      console.error('Error getting balance:', error.message);
      return null;
    }
  }
}

module.exports = new PolygonTimestampService();
