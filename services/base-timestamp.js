/**
 * Base Blockchain Timestamping Service
 * Ethereum L2 with fast confirmations (~2 seconds)
 * Low cost (~$0.001-0.01 per timestamp)
 * Inherits Ethereum security via rollup
 */

const ethers = require('ethers');

class BaseTimestampService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.enabled = false;
    this.initialize();
  }

  initialize() {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const privateKey = process.env.BASE_PRIVATE_KEY || process.env.POLYGON_PRIVATE_KEY;
    
    if (!privateKey) {
      console.log('⚠️ Base not configured - set BASE_PRIVATE_KEY (or uses POLYGON_PRIVATE_KEY)');
      return;
    }

    try {
      const StaticJsonRpcProvider = ethers.providers?.StaticJsonRpcProvider;
      const JsonRpcProvider = ethers.providers?.JsonRpcProvider;
      const Wallet = ethers.Wallet;
      
      const baseNetwork = {
        name: 'base',
        chainId: 8453
      };
      
      if (StaticJsonRpcProvider) {
        this.provider = new StaticJsonRpcProvider(rpcUrl, baseNetwork);
        console.log('📡 Base: Using StaticJsonRpcProvider');
      } else if (JsonRpcProvider) {
        this.provider = new JsonRpcProvider(rpcUrl, baseNetwork);
        console.log('📡 Base: Using JsonRpcProvider');
      } else {
        throw new Error('No JsonRpcProvider available in ethers module');
      }
      
      this.wallet = new Wallet(privateKey, this.provider);
      this.enabled = true;
      console.log('✅ Base service initialized:', this.wallet.address);
    } catch (error) {
      console.error('❌ Base initialization failed:', error.message);
    }
  }

  async timestamp(fileHash, filename = 'unknown') {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Base service not configured'
      };
    }

    try {
      console.log(`🔵 Timestamping to Base: ${filename}`);
      
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

      console.log(`📤 Base TX sent: ${tx.hash}`);

      const receipt = await tx.wait(1);
      
      console.log(`✅ Base confirmed in block ${receipt.blockNumber}`);

      const block = await this.provider.getBlock(receipt.blockNumber);
      
      let ethCost = '0';
      try {
        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice || receipt.effectiveGasPrice || feeData.gasPrice;
        
        if (gasUsed && gasPrice) {
          const gasCost = BigInt(gasUsed.toString()) * BigInt(gasPrice.toString());
          const formatEther = ethers.formatEther || ethers.utils?.formatEther;
          ethCost = formatEther(gasCost);
        }
      } catch (costErr) {
        console.log('⚠️ Could not calculate gas cost:', costErr.message);
      }
      
      const ethPriceUSD = 3500;
      const costUSD = (parseFloat(ethCost) * ethPriceUSD).toFixed(6);

      return {
        success: true,
        transaction_hash: tx.hash || receipt.hash,
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        gas_used: receipt.gasUsed.toString(),
        gas_cost_eth: ethCost,
        gas_cost_usd: costUSD,
        explorer_url: `https://basescan.org/tx/${tx.hash || receipt.hash}`,
        confirmations: 1,
        network: 'base'
      };

    } catch (error) {
      console.error('❌ Base timestamp failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async verify(txHash) {
    if (!this.enabled) {
      return { success: false, error: 'Base service not configured' };
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
      console.error('Error getting Base balance:', error.message);
      return null;
    }
  }
}

module.exports = new BaseTimestampService();
