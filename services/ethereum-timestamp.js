/**
 * Ethereum L1 Blockchain Timestamping Service
 * Enterprise tier - maximum security and decentralization
 * Higher cost (~$1-10 per timestamp depending on gas)
 * Slower confirmations (~12-15 seconds per block)
 * Highest security guarantee - native Ethereum consensus
 */

const ethers = require('ethers');

class EthereumTimestampService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.enabled = false;
    this.initialize();
  }

  initialize() {
    // Support multiple RPC providers for reliability
    const rpcUrl = process.env.ETHEREUM_RPC_URL || 
                   process.env.ETH_RPC_URL || 
                   'https://eth.llamarpc.com'; // Free public RPC fallback
    
    // Ethereum can use its own key or fall back to shared key
    const privateKey = process.env.ETHEREUM_PRIVATE_KEY || 
                       process.env.ETH_PRIVATE_KEY ||
                       process.env.BASE_PRIVATE_KEY || 
                       process.env.POLYGON_PRIVATE_KEY;
    
    if (!privateKey) {
      console.log('⚠️ Ethereum L1 not configured - set ETHEREUM_PRIVATE_KEY');
      return;
    }

    try {
      const StaticJsonRpcProvider = ethers.providers?.StaticJsonRpcProvider;
      const JsonRpcProvider = ethers.providers?.JsonRpcProvider;
      const Wallet = ethers.Wallet;
      
      const ethNetwork = {
        name: 'mainnet',
        chainId: 1
      };
      
      if (StaticJsonRpcProvider) {
        this.provider = new StaticJsonRpcProvider(rpcUrl, ethNetwork);
        console.log('📡 Ethereum L1: Using StaticJsonRpcProvider');
      } else if (JsonRpcProvider) {
        this.provider = new JsonRpcProvider(rpcUrl, ethNetwork);
        console.log('📡 Ethereum L1: Using JsonRpcProvider');
      } else {
        throw new Error('No JsonRpcProvider available in ethers module');
      }
      
      this.wallet = new Wallet(privateKey, this.provider);
      this.enabled = true;
      console.log('✅ Ethereum L1 service initialized:', this.wallet.address);
    } catch (error) {
      console.error('❌ Ethereum L1 initialization failed:', error.message);
    }
  }

  async timestamp(fileHash, filename = 'unknown') {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Ethereum L1 service not configured'
      };
    }

    try {
      console.log(`⟠ Timestamping to Ethereum L1: ${filename}`);
      
      // Get current fee data - Ethereum uses EIP-1559
      const feeData = await this.provider.getFeeData();
      
      const parseEther = ethers.parseEther || ethers.utils?.parseEther;
      
      // Build transaction with EIP-1559 fee structure if available
      const txParams = {
        to: this.wallet.address,
        value: parseEther('0'),
        data: '0x' + fileHash,
        gasLimit: 25000  // Simple data transaction
      };
      
      // Use EIP-1559 if supported, otherwise legacy gas price
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        txParams.maxFeePerGas = feeData.maxFeePerGas;
        txParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        txParams.type = 2;  // EIP-1559 transaction
        console.log(`   Gas: maxFee=${ethers.formatUnits ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : 'N/A'} gwei`);
      } else {
        txParams.gasPrice = feeData.gasPrice;
        console.log(`   Gas: legacy price=${ethers.formatUnits ? ethers.formatUnits(feeData.gasPrice, 'gwei') : 'N/A'} gwei`);
      }

      const tx = await this.wallet.sendTransaction(txParams);

      console.log(`📤 Ethereum TX sent: ${tx.hash}`);

      // Wait for 2 confirmations on mainnet for safety
      const receipt = await tx.wait(2);
      
      console.log(`✅ Ethereum confirmed in block ${receipt.blockNumber} (2 confirmations)`);

      const block = await this.provider.getBlock(receipt.blockNumber);
      const blockTimestamp = block?.timestamp 
        ? new Date(block.timestamp * 1000).toISOString() 
        : new Date().toISOString();
      
      // Calculate gas cost
      let ethCost = '0';
      try {
        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice || receipt.gasPrice || feeData.gasPrice;
        
        if (gasUsed && effectiveGasPrice) {
          const gasCost = BigInt(gasUsed.toString()) * BigInt(effectiveGasPrice.toString());
          const formatEther = ethers.formatEther || ethers.utils?.formatEther;
          ethCost = formatEther(gasCost);
        }
      } catch (costErr) {
        console.log('⚠️ Could not calculate gas cost:', costErr.message);
      }
      
      // ETH price estimate for cost display
      const ethPriceUSD = 3500;
      const costUSD = (parseFloat(ethCost) * ethPriceUSD).toFixed(4);

      return {
        success: true,
        transaction_hash: tx.hash || receipt.hash,
        block_number: receipt.blockNumber,
        timestamp: blockTimestamp,
        gas_used: receipt.gasUsed.toString(),
        gas_cost_eth: ethCost,
        gas_cost_usd: costUSD,
        explorer_url: `https://etherscan.io/tx/${tx.hash || receipt.hash}`,
        confirmations: 2,
        network: 'ethereum'
      };

    } catch (error) {
      console.error('❌ Ethereum L1 timestamp failed:', error.message);
      
      // Provide helpful error context
      if (error.message.includes('insufficient funds')) {
        return {
          success: false,
          error: 'Insufficient ETH balance for gas fees',
          suggestion: 'Enterprise timestamping requires ETH for L1 gas'
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async verify(txHash) {
    if (!this.enabled) {
      return { success: false, error: 'Ethereum L1 service not configured' };
    }

    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        return { success: false, error: 'Transaction not found' };
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);
      const block = await this.provider.getBlock(receipt.blockNumber);
      const currentBlock = await this.provider.getBlockNumber();
      
      const blockTimestamp = block?.timestamp 
        ? new Date(block.timestamp * 1000).toISOString() 
        : null;

      return {
        success: true,
        hash: tx.data.substring(2),  // Remove 0x prefix
        block_number: receipt.blockNumber,
        timestamp: blockTimestamp,
        confirmations: currentBlock - receipt.blockNumber,
        network: 'ethereum',
        explorer_url: `https://etherscan.io/tx/${txHash}`
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
      console.error('Error getting Ethereum balance:', error.message);
      return null;
    }
  }

  async estimateGasCost() {
    if (!this.enabled) return null;
    
    try {
      const feeData = await this.provider.getFeeData();
      const gasLimit = 25000;
      
      const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
      if (!gasPrice) return null;
      
      const estimatedCost = BigInt(gasLimit) * BigInt(gasPrice.toString());
      const formatEther = ethers.formatEther || ethers.utils?.formatEther;
      const ethCost = formatEther(estimatedCost);
      
      const ethPriceUSD = 3500;
      const costUSD = (parseFloat(ethCost) * ethPriceUSD).toFixed(4);
      
      return {
        gas_limit: gasLimit,
        gas_price_gwei: ethers.formatUnits ? ethers.formatUnits(gasPrice, 'gwei') : 'N/A',
        estimated_eth: ethCost,
        estimated_usd: costUSD
      };
    } catch (error) {
      console.error('Error estimating gas:', error.message);
      return null;
    }
  }
}

module.exports = new EthereumTimestampService();