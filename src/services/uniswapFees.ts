import { TaoStatsClient } from '@taostats/sdk';
import { JsonRpcProvider } from 'ethers';
import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { TOKENS } from '../config/tokens.js';

export interface FeeCollectionRecord {
  timestamp: string;
  token: string;
  amount: string;
  transactionHash: string;
  blockNumber: number;
}

export interface CombinedFeeCollection {
  timestamp: string;
  wtaoAmount: string;
  usdcAmount: string;
  transactionHash: string;
  blockNumber: number;
}

interface CachedFeeData {
  collections: FeeCollectionRecord[];
  lastBlockFetched: number;
  lastFetchTime: number;
}

export class UniswapFeesClient {
  private client: TaoStatsClient;
  private provider: JsonRpcProvider;
  private cache: Cache<CachedFeeData>;
  private cacheTTL: number;

  // Bittensor EVM RPC endpoint
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  // Uniswap V3 NonfungiblePositionManager contract address
  private readonly POSITION_MANAGER = '0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25';

  // WTAO (Wrapped TAO) contract address
  private readonly WTAO_ADDRESS = '0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81';

  // ERC-20 Transfer event signature
  private readonly TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  // Sept 1, 2025 - starting block for historical data
  private readonly START_BLOCK = 6400000;

  constructor(config: TaostatsConfig, cacheTTL: number = 60000) {
    this.client = new TaoStatsClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL);
    this.cache = new Cache();
    this.cacheTTL = cacheTTL; // Only used to check for new data, historical data never expires
  }

  /**
   * Pad address to 32 bytes (64 hex chars) for topic filtering
   */
  private padAddress(address: string): string {
    // Remove 0x prefix if present
    const addr = address.toLowerCase().replace('0x', '');
    // Pad to 64 characters (32 bytes)
    return '0x' + addr.padStart(64, '0');
  }

  /**
   * Extract address from padded topic
   */
  private extractAddress(paddedTopic: string): string {
    // Remove 0x and padding, keep last 40 characters (20 bytes)
    return '0x' + paddedTopic.slice(-40);
  }

  /**
   * Parse amount from hex and convert to human-readable format
   */
  private parseAmount(hexAmount: string, decimals: number): string {
    const rawAmount = BigInt(hexAmount);
    const divisor = BigInt(10 ** decimals);
    const wholePart = rawAmount / divisor;
    const fractionalPart = rawAmount % divisor;

    // Convert to string with proper decimal places
    const result = wholePart.toString() + '.' + fractionalPart.toString().padStart(decimals, '0');

    // Clean up trailing zeros
    return parseFloat(result).toString();
  }

  /**
   * Get transactions from address to Position Manager
   * Much more efficient than paginating through all USDC transfers
   */
  private async getPositionManagerTransactions(
    address: string,
    limit: number = 1000
  ): Promise<Array<{ hash: string; timestamp: string; blockNumber: number }>> {
    console.log(`Fetching transactions from ${address} to Position Manager...`);

    try {
      const allTransactions: Array<{ hash: string; timestamp: string; blockNumber: number }> = [];

      let page = 1;
      let hasMore = true;
      const maxPages = Math.ceil(limit / 200);

      while (hasMore && allTransactions.length < limit && page <= maxPages) {
        const response = await (this.client as any).httpClient.get('/api/evm/transaction/v1', {
          address: address,
          to_address: this.POSITION_MANAGER,
          limit: 200,
          page,
        });

        if (!response.success || !response.data) {
          throw new Error('Failed to fetch Position Manager transactions');
        }

        const txs = response.data.data || [];
        console.log(`Page ${page}: Received ${txs.length} transactions to Position Manager`);

        for (const tx of txs) {
          allTransactions.push({
            hash: tx.hash,
            timestamp: tx.timestamp,
            blockNumber: tx.block_number,
          });
        }

        // Check if we have more pages
        hasMore = txs.length === 200;
        page++;
      }

      console.log(`Found ${allTransactions.length} total transactions to Position Manager`);
      return allTransactions.slice(0, limit);
    } catch (error) {
      console.error('Error fetching Position Manager transactions:', error);
      throw error;
    }
  }

  /**
   * Get both USDC and WTAO amounts from specific transactions by querying block events
   * Returns map of transaction hash -> {usdc, wtao}
   */
  private async getFeeAmountsFromTransactions(
    address: string,
    transactions: Array<{ hash: string; timestamp: string; blockNumber: number }>
  ): Promise<Map<string, { usdc: string; wtao: string }>> {
    console.log(`Fetching fee amounts from ${transactions.length} transactions via block queries...`);

    const feeAmounts = new Map<string, { usdc: string; wtao: string }>();
    const normalizedWtao = this.WTAO_ADDRESS.toLowerCase();
    const normalizedUsdc = TOKENS.usdc.contractAddress!.toLowerCase(); // Non-null: USDC always has contract address
    const normalizedPM = this.POSITION_MANAGER.toLowerCase();
    const normalizedAddress = address.toLowerCase();

    // Group transactions by block number to minimize API calls
    const blockMap = new Map<number, Array<{ hash: string; timestamp: string; blockNumber: number }>>();
    for (const tx of transactions) {
      if (!blockMap.has(tx.blockNumber)) {
        blockMap.set(tx.blockNumber, []);
      }
      blockMap.get(tx.blockNumber)!.push(tx);
    }

    console.log(`Querying ${blockMap.size} unique blocks for ${transactions.length} transactions`);

    // Query each unique block with rate limiting
    let queryCount = 0;
    for (const [blockNumber, txsInBlock] of blockMap.entries()) {
      try {
        // Rate limiting: 60 calls/minute = 1 call/second, use 1.5s for safety
        if (queryCount > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        queryCount++;

        // Query all EVM logs for this block
        const response = await (this.client as any).httpClient.get('/api/evm/log/v1', {
          block_number: blockNumber,
          limit: 200, // Should be plenty for events in a single block
          page: 1,
        });

        if (!response.success || !response.data) {
          console.error(`Failed to fetch logs for block ${blockNumber}`);
          continue;
        }

        const logs = response.data.data || [];

        // First pass: identify transactions with DecreaseLiquidity events (not fee collections)
        const liquidityWithdrawals = new Set<string>();
        for (const log of logs) {
          const txHash = log.transaction_hash;
          if (!txsInBlock.some((tx) => tx.hash === txHash)) {
            continue;
          }
          // DecreaseLiquidity event indicates liquidity withdrawal, not fee collection
          if (log.event_name === 'DecreaseLiquidity') {
            liquidityWithdrawals.add(txHash);
          }
        }

        // Second pass: process events for fee collections only
        for (const log of logs) {
          const txHash = log.transaction_hash;
          if (!txsInBlock.some((tx) => tx.hash === txHash)) {
            continue; // Not one of our transactions
          }

          // Skip transactions with DecreaseLiquidity events
          if (liquidityWithdrawals.has(txHash)) {
            continue;
          }

          // Initialize fee amounts for this transaction if not exists
          if (!feeAmounts.has(txHash)) {
            feeAmounts.set(txHash, { usdc: '0', wtao: '0' });
          }
          const fees = feeAmounts.get(txHash)!;

          // Check for USDC Transfer from Position Manager to user
          if (
            log.address?.toLowerCase() === normalizedUsdc &&
            log.event_name === 'Transfer' &&
            log.args?.from?.toLowerCase() === normalizedPM &&
            log.args?.to?.toLowerCase() === normalizedAddress
          ) {
            const amountRaw = log.args.value || '0';
            const amount = this.parseAmount('0x' + BigInt(amountRaw).toString(16), TOKENS.usdc.decimals);
            fees.usdc = (parseFloat(fees.usdc) + parseFloat(amount)).toString();
            console.log(`  Block ${blockNumber}, TX ${txHash.slice(0, 10)}...: Found ${amount} USDC`);
          }

          // Check for WTAO Withdrawal event (WTAO being unwrapped)
          if (log.address?.toLowerCase() === normalizedWtao && log.event_name === 'Withdrawal') {
            const wadRaw = log.args?.wad || '0';
            const wadHex = '0x' + BigInt(wadRaw).toString(16);
            const amount = this.parseAmount(wadHex, 18);
            fees.wtao = (parseFloat(fees.wtao) + parseFloat(amount)).toString();
            console.log(`  Block ${blockNumber}, TX ${txHash.slice(0, 10)}...: Found ${amount} WTAO (unwrapped)`);
          }
        }

        // Log filtered transactions
        if (liquidityWithdrawals.size > 0) {
          console.log(`  Block ${blockNumber}: Filtered out ${liquidityWithdrawals.size} liquidity withdrawals`);
        }
      } catch (error) {
        console.error(`Error fetching logs for block ${blockNumber}:`, error);
      }
    }

    // Filter to only transactions that have USDC (fee collections)
    const feeCollectionTxs = new Map<string, { usdc: string; wtao: string }>();
    for (const [txHash, amounts] of feeAmounts.entries()) {
      if (parseFloat(amounts.usdc) > 0) {
        feeCollectionTxs.set(txHash, amounts);
      }
    }

    console.log(
      `Found ${feeCollectionTxs.size} fee collections (filtered from ${transactions.length} total transactions)`
    );
    return feeCollectionTxs;
  }

  /**
   * Get combined fee collections grouped by transaction with permanent caching
   * Optimized approach: Query transactions to Position Manager, then extract fee amounts from blocks
   * @param address - The EVM address
   * @param limit - Maximum number of transactions to fetch (default 1000)
   */
  async getCombinedFeeCollections(address: string, limit: number = 1000): Promise<CombinedFeeCollection[]> {
    const cacheKey = `uniswap-fees-${address}`;
    const now = Date.now();

    // Check cache first
    const cached = this.cache.get(cacheKey);

    // Historical data is cached permanently with Infinity TTL - just check if it exists
    if (cached) {
      console.log(`Cache hit for ${cacheKey} (${cached.collections.length} fee collections)`);

      // Convert to combined format
      const combined = this.combineByTransaction(cached.collections);
      return combined;
    }

    console.log(`Cache miss for ${cacheKey}, fetching all historical data...`);

    try {
      // Step 1: Get all transactions from address to Position Manager
      const transactions = await this.getPositionManagerTransactions(address, limit);
      console.log(`Found ${transactions.length} transactions to Position Manager for ${address}`);

      if (transactions.length === 0) {
        console.log('No Position Manager transactions found, returning empty result');

        // Cache empty result to avoid repeated API calls
        this.cache.set(
          cacheKey,
          {
            collections: [],
            lastBlockFetched: this.START_BLOCK,
            lastFetchTime: now,
          },
          Infinity // Never expire
        );

        return [];
      }

      // Step 2: Extract fee amounts (both USDC and WTAO) from transaction blocks
      const feeAmounts = await this.getFeeAmountsFromTransactions(address, transactions);
      console.log(`Found ${feeAmounts.size} fee collections from ${transactions.length} transactions`);

      if (feeAmounts.size === 0) {
        console.log('No fee collections found in transactions, returning empty result');

        // Cache empty result
        this.cache.set(
          cacheKey,
          {
            collections: [],
            lastBlockFetched: this.START_BLOCK,
            lastFetchTime: now,
          },
          Infinity
        );

        return [];
      }

      // Step 3: Convert to fee collection records format
      const allFees: FeeCollectionRecord[] = [];

      for (const [txHash, amounts] of feeAmounts.entries()) {
        // Find the transaction details
        const tx = transactions.find((t) => t.hash === txHash);
        if (!tx) continue;

        // Add USDC record
        if (amounts.usdc !== '0') {
          allFees.push({
            timestamp: tx.timestamp,
            token: 'USDC',
            amount: amounts.usdc,
            transactionHash: txHash,
            blockNumber: tx.blockNumber,
          });
        }

        // Add WTAO record
        if (amounts.wtao !== '0') {
          allFees.push({
            timestamp: tx.timestamp,
            token: 'WTAO',
            amount: amounts.wtao,
            transactionHash: txHash,
            blockNumber: tx.blockNumber,
          });
        }
      }

      // Find the highest block number
      const lastBlockFetched = Math.max(...allFees.map((f) => f.blockNumber));

      // Cache the result permanently (historical data never expires)
      this.cache.set(
        cacheKey,
        {
          collections: allFees,
          lastBlockFetched,
          lastFetchTime: now,
        },
        Infinity // Never expire - historical data is permanent
      );

      console.log(`Cached ${allFees.length} fee collection records up to block ${lastBlockFetched}`);

      // Convert to combined format
      const combined = this.combineByTransaction(allFees);
      return combined;
    } catch (error) {
      console.error('Error fetching fee collections:', error);
      throw new Error('Failed to fetch fee collections');
    }
  }

  /**
   * Helper method to combine fee collections by transaction hash
   */
  private combineByTransaction(allFees: FeeCollectionRecord[]): CombinedFeeCollection[] {
    // Group by transaction hash
    const byTransaction = new Map<string, { wtao?: string; usdc?: string; timestamp: string; blockNumber: number }>();

    for (const fee of allFees) {
      const existing = byTransaction.get(fee.transactionHash) || {
        timestamp: fee.timestamp,
        blockNumber: fee.blockNumber,
      };

      if (fee.token === 'WTAO') {
        existing.wtao = fee.amount;
      } else if (fee.token === 'USDC') {
        existing.usdc = fee.amount;
      }

      byTransaction.set(fee.transactionHash, existing);
    }

    // Convert to combined format
    const combined: CombinedFeeCollection[] = Array.from(byTransaction.entries()).map(([txHash, data]) => ({
      timestamp: data.timestamp,
      wtaoAmount: data.wtao || '0',
      usdcAmount: data.usdc || '0',
      transactionHash: txHash,
      blockNumber: data.blockNumber,
    }));

    // Sort by timestamp (newest first)
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    console.log(`Combined into ${combined.length} unique transactions`);

    return combined;
  }
}
