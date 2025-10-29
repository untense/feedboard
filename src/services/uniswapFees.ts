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
   * Get USDC fee collections from Position Manager to an address with pagination
   */
  private async getUsdcFeeCollections(address: string, limit: number = 10000): Promise<FeeCollectionRecord[]> {
    const paddedPositionManager = this.padAddress(this.POSITION_MANAGER);

    console.log(`Fetching USDC fee collections from Position Manager to ${address}...`);

    try {
      const allFeeCollections: FeeCollectionRecord[] = [];
      const normalizedPM = this.POSITION_MANAGER.toLowerCase();
      const normalizedAddress = address.toLowerCase();

      let page = 1;
      let hasMore = true;
      const maxPages = Math.ceil(limit / 200); // Fetch enough pages to reach desired limit

      while (hasMore && allFeeCollections.length < limit && page <= maxPages) {
        const response = await (this.client as any).httpClient.get('/api/evm/log/v1', {
          address: TOKENS.usdc.contractAddress,
          topic0: this.TRANSFER_TOPIC,
          topic1: paddedPositionManager,
          limit: 200,
          page,
        });

        if (!response.success || !response.data) {
          throw new Error('Failed to fetch USDC fee collections');
        }

        const logs = response.data.data || [];
        console.log(`Page ${page}: Received ${logs.length} USDC transfer logs from API`);

        // Client-side filtering to ensure we only get transfers to the specific address
        const filtered = logs
          .filter((log: any) => {
            const from = this.extractAddress(log.topic1 || '').toLowerCase();
            const to = this.extractAddress(log.topic2 || '').toLowerCase();
            return from === normalizedPM && to === normalizedAddress;
          })
          .map((log: any) => ({
            timestamp: log.timestamp || log.created_at || '',
            token: 'USDC',
            amount: this.parseAmount(log.data || '0x0', TOKENS.usdc.decimals),
            transactionHash: log.transaction_hash || '',
            blockNumber: log.block_number || 0,
          }));

        allFeeCollections.push(...filtered);
        console.log(`Page ${page}: Found ${filtered.length} USDC fee collections (total: ${allFeeCollections.length})`);

        // Check if we have more pages
        hasMore = logs.length === 200;
        page++;
      }

      console.log(`Filtered to ${allFeeCollections.length} total USDC fee collections for ${address}`);
      return allFeeCollections.slice(0, limit);
    } catch (error) {
      console.error('Error fetching USDC fee collections:', error);
      throw error;
    }
  }

  /**
   * Get WTAO amounts from specific transactions by querying block events via Taostats API
   * This is much more efficient than RPC (which returns null) or paginating all WTAO transfers
   */
  private async getWtaoAmountsFromTransactions(
    transactions: Array<{ hash: string; timestamp: string; blockNumber: number }>
  ): Promise<Map<string, string>> {
    console.log(`Fetching WTAO amounts from ${transactions.length} transactions via block queries...`);

    const wtaoAmounts = new Map<string, string>();
    const normalizedWtao = this.WTAO_ADDRESS.toLowerCase();

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

        // Find Withdrawal events on WTAO contract for our transactions
        for (const log of logs) {
          const txHash = log.transaction_hash;
          if (!txsInBlock.some((tx) => tx.hash === txHash)) {
            continue; // Not one of our fee collection transactions
          }

          // Check for Withdrawal event on WTAO contract
          // Withdrawal(address indexed src, uint wad)
          if (log.address?.toLowerCase() === normalizedWtao && log.event_name === 'Withdrawal') {
            const wadRaw = log.args?.wad || '0';
            // Convert wadRaw to hex for parseAmount
            const wadHex = '0x' + BigInt(wadRaw).toString(16);
            const amount = this.parseAmount(wadHex, 18);

            // Sum up multiple withdrawals in the same transaction (if any)
            const existing = wtaoAmounts.get(txHash) || '0';
            const total = (parseFloat(existing) + parseFloat(amount)).toString();
            wtaoAmounts.set(txHash, total);

            console.log(`  Block ${blockNumber}, TX ${txHash.slice(0, 10)}...: Found ${amount} WTAO (unwrapped)`);
          }
        }
      } catch (error) {
        console.error(`Error fetching logs for block ${blockNumber}:`, error);
      }
    }

    console.log(`Found WTAO amounts for ${wtaoAmounts.size} of ${transactions.length} transactions`);
    return wtaoAmounts;
  }

  /**
   * Get combined fee collections grouped by transaction with permanent caching
   * Uses optimized approach: Taostats API for USDC + block queries for WTAO Withdrawal events
   * @param address - The EVM address
   * @param limit - Maximum number of records to fetch (default 10000)
   */
  async getCombinedFeeCollections(address: string, limit: number = 10000): Promise<CombinedFeeCollection[]> {
    const cacheKey = `uniswap-fees-${address}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // If we have cached data and it's not stale (within cacheTTL), return it
    if (cached && now - cached.lastFetchTime < this.cacheTTL) {
      console.log(`Cache hit for ${cacheKey} (${cached.collections.length} fee collections)`);

      // Convert to combined format
      const combined = this.combineByTransaction(cached.collections);
      return combined;
    }

    console.log(
      cached
        ? `Cache stale for ${cacheKey}, fetching new data since block ${cached.lastBlockFetched}...`
        : `Cache miss for ${cacheKey}, fetching all historical data...`
    );

    try {
      // Step 1: Get USDC fee collections (these define which transactions are fee collections)
      const usdcFees = await this.getUsdcFeeCollections(address, limit);
      console.log(`Found ${usdcFees.length} USDC fee collections for ${address}`);

      if (usdcFees.length === 0) {
        console.log('No USDC fee collections found, returning empty result');

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

      // Step 2: Extract transaction details for EVM RPC lookup
      const transactions = usdcFees.map((fee) => ({
        hash: fee.transactionHash,
        timestamp: fee.timestamp,
        blockNumber: fee.blockNumber,
      }));

      // Step 3: Query EVM RPC to get WTAO amounts for these specific transactions
      const wtaoAmounts = await this.getWtaoAmountsFromTransactions(transactions);

      // Step 4: Create fee collection records with both USDC and WTAO
      const allFees: FeeCollectionRecord[] = [];

      for (const usdcFee of usdcFees) {
        // Add USDC record
        allFees.push(usdcFee);

        // Add WTAO record if it exists for this transaction
        const wtaoAmount = wtaoAmounts.get(usdcFee.transactionHash);
        if (wtaoAmount && wtaoAmount !== '0') {
          allFees.push({
            timestamp: usdcFee.timestamp,
            token: 'WTAO',
            amount: wtaoAmount,
            transactionHash: usdcFee.transactionHash,
            blockNumber: usdcFee.blockNumber,
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
