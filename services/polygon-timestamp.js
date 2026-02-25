/**
 * Polygon Blockchain Timestamping Service
 * Instant blockchain confirmations (~2 seconds)
 * Low cost (~$0.0001-0.001 per timestamp)
 * 
 * Features:
 * - Multi-RPC fallback (never depends on a single provider)
 * - Ethers v5/v6 dual compatibility
 * - EIP-1559 fee support with legacy fallback
 * - Receipt polling across providers (not tied to sender)
 * - Domain-separated hash for legal defensibility
 * - Smart balance checking across RPCs
 */

const ethers = require('ethers');

// RPC endpoints in priority order
const FALLBACK_RPC_URLS = [
  'https://polygon-rpc.com',
  'https://polygon.llamarpc.com',
  'https://rpc-mainnet.matic.quiknode.pro',
  'https://polygon.drpc.org',
];

const POLYGON_NETWORK = {
  name: 'matic',
  chainId: 137
};

// Detect ethers version once at module load
const IS_ETHERS_V6 = typeof ethers.JsonRpcProvider === 'function';

class PolygonTimestampService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.enabled = false;
    this.rpcUrls = [];
    this.currentRpcIndex = 0;
    this.privateKey = null;
    this.initialize();
  }

  initialize() {
    const primaryRpc = process.env.POLYGON_RPC_URL;
    const privateKey = process.env.POLYGON_PRIVATE_KEY;

    if (!privateKey) {
      console.log('⚠️ Polygon not configured - set POLYGON_PRIVATE_KEY');
      return;
    }

    this.privateKey = privateKey;

    // Build RPC list: primary (env var) first, then fallbacks (deduplicated)
    this.rpcUrls = [];
    if (primaryRpc) {
      this.rpcUrls.push(primaryRpc);
    }
    for (const url of FALLBACK_RPC_URLS) {
      if (url !== primaryRpc) {
        this.rpcUrls.push(url);
      }
    }

    if (this.rpcUrls.length === 0) {
      console.log('⚠️ Polygon not configured - no RPC URLs available');
      return;
    }

    try {
      this.provider = this._createProvider(this.rpcUrls[0]);
      this.currentRpcIndex = 0;
      this.wallet = this._createWallet(privateKey, this.provider);
      this.enabled = true;

      console.log(`✅ Polygon service initialized: ${this.wallet.address}`);
      console.log(`📡 Ethers version: ${IS_ETHERS_V6 ? 'v6' : 'v5'}`);
      console.log(`📡 Primary RPC: ${this._maskUrl(this.rpcUrls[0])}`);
      console.log(`📡 Fallback RPCs: ${this.rpcUrls.length - 1} available`);
    } catch (error) {
      console.error('❌ Polygon initialization failed:', error.message);
    }
  }

  // ──────────────────────────────────────────────
  // Provider / Wallet creation (v5/v6 compatible)
  // ──────────────────────────────────────────────

  _createProvider(rpcUrl) {
    if (IS_ETHERS_V6) {
      // ethers v6: top-level JsonRpcProvider with static network
      return new ethers.JsonRpcProvider(rpcUrl, POLYGON_NETWORK.chainId, {
        staticNetwork: true
      });
    } else {
      // ethers v5: prefer StaticJsonRpcProvider to skip network detection
      const StaticProvider = ethers.providers?.StaticJsonRpcProvider;
      const JsonProvider = ethers.providers?.JsonRpcProvider;
      if (StaticProvider) {
        return new StaticProvider(rpcUrl, POLYGON_NETWORK);
      } else if (JsonProvider) {
        return new JsonProvider(rpcUrl, POLYGON_NETWORK);
      }
      throw new Error('No compatible JsonRpcProvider found in ethers');
    }
  }

  _createWallet(privateKey, provider) {
    return new ethers.Wallet(privateKey, provider);
  }

  // ──────────────────────────────────────────────
  // Utility helpers
  // ──────────────────────────────────────────────

  _parseEther(value) {
    return IS_ETHERS_V6 ? ethers.parseEther(value) : ethers.utils.parseEther(value);
  }

  _formatEther(value) {
    return IS_ETHERS_V6 ? ethers.formatEther(value) : ethers.utils.formatEther(value);
  }

  /**
   * Normalize a file hash into valid hex calldata.
   * - Strips leading 0x
   * - Validates hex characters
   * - Ensures even length
   */
  _normalizeHash(fileHash) {
    let hex = fileHash;
    if (hex.startsWith('0x') || hex.startsWith('0X')) {
      hex = hex.slice(2);
    }
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error(`Invalid hex characters in fileHash: ${fileHash.substring(0, 20)}...`);
    }
    if (hex.length % 2 !== 0) {
      hex = '0' + hex;
    }
    if (hex.length === 0) {
      throw new Error('fileHash is empty after normalization');
    }
    return hex;
  }

  /**
   * Build domain-separated calldata for legal defensibility.
   * Prefix "vs1:" (hex 7673313a) prevents hash collisions with other protocols.
   */
  _buildCalldata(fileHash) {
    const normalizedHash = this._normalizeHash(fileHash);
    return '0x7673313a' + normalizedHash;
  }

  /**
   * Mask API keys in URLs for safe logging.
   * Handles both path-based keys (/v2/KEY) and query params (?key=KEY)
   */
  _maskUrl(url) {
    try {
      const u = new URL(url);

      // Mask path-based keys
      const pathParts = u.pathname.split('/');
      if (pathParts.length > 2) {
        const key = pathParts[pathParts.length - 1];
        if (key.length > 8) {
          pathParts[pathParts.length - 1] = key.substring(0, 4) + '...' + key.substring(key.length - 4);
          u.pathname = pathParts.join('/');
        }
      }

      // Mask query param keys
      const params = new URLSearchParams(u.search);
      for (const [k, v] of params.entries()) {
        if (v.length > 8) {
          params.set(k, v.substring(0, 4) + '...' + v.substring(v.length - 4));
        }
      }
      u.search = params.toString();

      return u.toString();
    } catch {
      return '[invalid URL]';
    }
  }

  // ──────────────────────────────────────────────
  // RPC failover (loop-based, no recursion)
  // ──────────────────────────────────────────────

  /**
   * Switch to the next available RPC provider.
   * Uses a loop (not recursion) to avoid deep stacks.
   */
  _switchToNextRpc() {
    const startIndex = this.currentRpcIndex;

    for (let i = 1; i < this.rpcUrls.length; i++) {
      const nextIndex = (startIndex + i) % this.rpcUrls.length;
      const nextUrl = this.rpcUrls[nextIndex];

      try {
        this.provider = this._createProvider(nextUrl);
        this.wallet = this._createWallet(this.privateKey, this.provider);
        this.currentRpcIndex = nextIndex;
        console.log(`🔄 Switched to RPC: ${this._maskUrl(nextUrl)}`);
        return true;
      } catch (error) {
        console.error(`❌ Failed to create provider for ${this._maskUrl(nextUrl)}: ${error.message}`);
        continue;
      }
    }

    return false;
  }

  /**
   * Reset back to primary RPC after successful operations.
   */
  _resetToPrimaryRpc() {
    if (this.currentRpcIndex !== 0) {
      try {
        this.provider = this._createProvider(this.rpcUrls[0]);
        this.wallet = this._createWallet(this.privateKey, this.provider);
        this.currentRpcIndex = 0;
      } catch {
        console.log('⚠️ Could not reset to primary RPC, staying on fallback');
      }
    }
  }

  /**
   * Check if an error is an RPC-level issue worth retrying.
   */
  _isRpcError(error) {
    const code = error.code;
    const msg = (error.message || '').toLowerCase();
    return code === 'SERVER_ERROR' ||
           code === 'TIMEOUT' ||
           code === 'NETWORK_ERROR' ||
           code === 'ECONNREFUSED' ||
           msg.includes('timeout') ||
           msg.includes('missing response') ||
           msg.includes('rate limit') ||
           msg.includes('429') ||
           msg.includes('502') ||
           msg.includes('503') ||
           msg.includes('econnreset') ||
           msg.includes('fetch failed');
  }

  /**
   * Execute an operation with automatic RPC fallback.
   */
  async _withFallback(operation, operationName = 'operation') {
    let lastError;

    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      try {
        return await operation(this.provider, this.wallet);
      } catch (error) {
        lastError = error;

        if (this._isRpcError(error) && attempt < this.rpcUrls.length - 1) {
          console.log(`⚠️ RPC error during ${operationName}: ${error.message?.substring(0, 100)}`);
          if (!this._switchToNextRpc()) break;
        } else {
          throw error;
        }
      }
    }

    throw lastError;
  }

  // ──────────────────────────────────────────────
  // Core: Timestamp a file hash on Polygon
  // ──────────────────────────────────────────────

  async timestamp(fileHash, filename = 'unknown') {
    if (!this.enabled) {
      return { success: false, error: 'Polygon service not configured' };
    }

    try {
      console.log(`🔗 Timestamping to Polygon: ${filename}`);

      // Normalize and build domain-separated calldata
      const calldata = this._buildCalldata(fileHash);

      // Get fee data with fallback
      const feeData = await this._withFallback(
        async (provider) => provider.getFeeData(),
        'getFeeData'
      );

      // Estimate gas with 30% buffer, fallback to safe static limit
      let gasLimit;
      try {
        const estimated = await this._withFallback(
          async (provider, wallet) => provider.estimateGas({
            to: wallet.address,
            value: 0,
            data: calldata
          }),
          'estimateGas'
        );
        gasLimit = Math.ceil(Number(estimated.toString()) * 1.3);
      } catch (estErr) {
        console.log(`⚠️ Gas estimate failed, using safe default: ${estErr.message?.substring(0, 60)}`);
        gasLimit = 50000;
      }

      // Build transaction — prefer EIP-1559 when available
      const txParams = {
        to: this.wallet.address,
        value: this._parseEther('0'),
        data: calldata,
        gasLimit: gasLimit
      };

      // Polygon requires minimum 25 gwei priority fee
// Some RPCs return stale/low estimates, so enforce a floor
const MIN_PRIORITY_FEE = BigInt('25000000000'); // 25 gwei
const MIN_MAX_FEE = BigInt('50000000000');      // 50 gwei

if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
  const priorityFee = BigInt(feeData.maxPriorityFeePerGas.toString());
  const maxFee = BigInt(feeData.maxFeePerGas.toString());
  
  const safePriorityFee = priorityFee < MIN_PRIORITY_FEE ? MIN_PRIORITY_FEE : priorityFee;
  const safeMaxFee = maxFee < MIN_MAX_FEE ? MIN_MAX_FEE : maxFee;
  
  txParams.maxPriorityFeePerGas = safePriorityFee;
  txParams.maxFeePerGas = safeMaxFee;
  txParams.type = 2;
} else if (feeData.gasPrice) {
  const gasPrice = BigInt(feeData.gasPrice.toString());
  txParams.gasPrice = gasPrice < MIN_MAX_FEE ? MIN_MAX_FEE : gasPrice;
}

      // Send transaction with fallback
      const tx = await this._withFallback(
        async (provider, wallet) => wallet.sendTransaction(txParams),
        'sendTransaction'
      );

      const txHash = tx.hash;
      console.log(`📤 Transaction sent: ${txHash}`);

      // Poll for receipt across providers (decoupled from sender)
      const receipt = await this._pollForReceipt(txHash);

      console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

      const block = await this._withFallback(
        async (provider) => provider.getBlock(receipt.blockNumber),
        'getBlock'
      );

      // Calculate gas cost in POL only (no stale USD conversion)
      let polCost = '0';
      try {
        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice || receipt.gasPrice || feeData.gasPrice;

        if (gasUsed && effectiveGasPrice) {
          const gasCost = BigInt(gasUsed.toString()) * BigInt(effectiveGasPrice.toString());
          polCost = this._formatEther(gasCost);
        }
      } catch (costErr) {
        console.log('⚠️ Could not calculate gas cost:', costErr.message);
      }

      this._resetToPrimaryRpc();

      return {
        success: true,
        transaction_hash: txHash,
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        gas_used: receipt.gasUsed.toString(),
        gas_cost_pol: polCost,
        explorer_url: `https://polygonscan.com/tx/${txHash}`,
        confirmations: 1,
        network: 'polygon'
      };

    } catch (error) {
      console.error('❌ Polygon timestamp failed:', error.message);
      this._resetToPrimaryRpc();
      return { success: false, error: error.message };
    }
  }

  /**
   * Poll for transaction receipt across all RPC providers.
   * Not tied to the provider that sent the tx.
   */
  async _pollForReceipt(txHash, maxAttempts = 10, intervalMs = 5000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const receipt = await this._withFallback(
          async (provider) => provider.getTransactionReceipt(txHash),
          'pollReceipt'
        );

        if (receipt && receipt.blockNumber) {
          return receipt;
        }
      } catch (error) {
        console.log(`⚠️ Receipt poll ${attempt + 1}/${maxAttempts}: ${error.message?.substring(0, 60)}`);
      }

      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }

    throw new Error(`Transaction not confirmed after ${maxAttempts} attempts. Check: https://polygonscan.com/tx/${txHash}`);
  }

  // ──────────────────────────────────────────────
  // Verify an existing timestamp
  // ──────────────────────────────────────────────

  async verify(txHash) {
    if (!this.enabled) {
      return { success: false, error: 'Polygon service not configured' };
    }

    try {
      const tx = await this._withFallback(
        async (provider) => provider.getTransaction(txHash),
        'getTransaction'
      );
      if (!tx) {
        return { success: false, error: 'Transaction not found' };
      }

      const receipt = await this._withFallback(
        async (provider) => provider.getTransactionReceipt(txHash),
        'getTransactionReceipt'
      );

      // Handle pending transactions
      if (!receipt || !receipt.blockNumber) {
        return {
          success: true,
          status: 'pending',
          hash: tx.data.substring(2),
          message: 'Transaction is pending confirmation'
        };
      }

      const block = await this._withFallback(
        async (provider) => provider.getBlock(receipt.blockNumber),
        'getBlock'
      );
      const currentBlock = await this._withFallback(
        async (provider) => provider.getBlockNumber(),
        'getBlockNumber'
      );

      // Clamp confirmations >= 0 (handles reorgs)
      const confirmations = Math.max(0, currentBlock - receipt.blockNumber);

      return {
        success: true,
        status: 'confirmed',
        hash: tx.data.substring(2),
        block_number: receipt.blockNumber,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        confirmations: confirmations
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ──────────────────────────────────────────────
  // Balance check with multi-RPC verification
  // ──────────────────────────────────────────────

  /**
   * Get wallet balance. Tries multiple RPCs independently.
   * If first RPC returns 0, confirms with a second before reporting.
   * IMPORTANT: null or 0 return should NOT block timestamping —
   * let the actual transaction fail with a clear insufficient funds error.
   */
  async getBalance() {
    if (!this.enabled) return null;

    let zeroCount = 0;
    let lastValidBalance = null;

    // Check up to 3 RPCs
    for (let i = 0; i < Math.min(this.rpcUrls.length, 3); i++) {
      try {
        const provider = this._createProvider(this.rpcUrls[i]);
        const balance = await provider.getBalance(this.wallet.address);
        const formatted = this._formatEther(balance);

        if (parseFloat(formatted) > 0) {
          return formatted; // Non-zero — trust immediately
        }

        zeroCount++;
        lastValidBalance = formatted;

        // Two independent RPCs say 0 — probably real
        if (zeroCount >= 2) {
          return formatted;
        }
      } catch (error) {
        console.error(`⚠️ Balance read failed (${this._maskUrl(this.rpcUrls[i])}): ${error.message?.substring(0, 60)}`);
        continue;
      }
    }

    return lastValidBalance;
  }
}

module.exports = new PolygonTimestampService();