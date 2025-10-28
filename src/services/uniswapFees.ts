import { TaoStatsClient } from '@taostats/sdk';
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

export class UniswapFeesClient {
  private client: TaoStatsClient;
  private cache: Cache<FeeCollectionRecord[]>;
  private cacheTTL: number;

  // Uniswap V3 NonfungiblePositionManager contract address
  private readonly POSITION_MANAGER = '0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25';

  // ERC-20 Transfer event signature
  private readonly TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  constructor(config: TaostatsConfig, cacheTTL: number = 60000) {
    this.client = new TaoStatsClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });
    this.cache = new Cache();
    this.cacheTTL = cacheTTL; // Default 60 seconds
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
   * Get USDC fee collections from Position Manager to an address
   */
  private async getUsdcFeeCollections(address: string, limit: number): Promise<FeeCollectionRecord[]> {
    const paddedPositionManager = this.padAddress(this.POSITION_MANAGER);
    const paddedAddress = this.padAddress(address);

    console.log(`Fetching USDC fee collections from Position Manager to ${address}...`);

    try {
      // Query ERC-20 Transfer events where:
      // - Contract is USDC
      // - topic1 (from) is Position Manager
      // - topic2 (to) is the user address
      const response = await (this.client as any).httpClient.get('/api/evm/log/v1', {
        address: TOKENS.usdc.contractAddress,
        topic0: this.TRANSFER_TOPIC,
        limit,
        page: 1,
      });

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch USDC fee collections');
      }

      const logs = response.data.data || [];
      console.log(`Received ${logs.length} USDC transfer logs from API`);

      // Filter client-side for Position Manager -> user address transfers
      const normalizedPM = this.POSITION_MANAGER.toLowerCase();
      const normalizedAddress = address.toLowerCase();

      const feeCollections: FeeCollectionRecord[] = logs
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

      console.log(`Filtered to ${feeCollections.length} USDC fee collections`);
      return feeCollections;
    } catch (error) {
      console.error('Error fetching USDC fee collections:', error);
      throw error;
    }
  }

  /**
   * Get native TAO fee collections from Position Manager to an address
   */
  private async getTaoFeeCollections(address: string, limit: number): Promise<FeeCollectionRecord[]> {
    console.log(`Fetching TAO fee collections from Position Manager to ${address}...`);

    try {
      // Query native transfers where from = Position Manager and to = user address
      const response = await (this.client as any).httpClient.get('/api/evm/transaction/v1', {
        from: this.POSITION_MANAGER,
        to: address,
        limit,
        page: 1,
      });

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch TAO fee collections');
      }

      const transactions = response.data.data || [];
      console.log(`Received ${transactions.length} TAO transactions from API`);

      const feeCollections: FeeCollectionRecord[] = transactions
        .filter((tx: any) => {
          // Only include transactions with non-zero value
          const value = BigInt(tx.value || '0');
          return value > 0n;
        })
        .map((tx: any) => {
          // Convert from wei (18 decimals) to TAO
          const rawAmount = tx.value || '0';
          const amount = this.parseAmount(rawAmount, 18);

          return {
            timestamp: tx.timestamp || '',
            token: 'TAO',
            amount,
            transactionHash: tx.hash || '',
            blockNumber: tx.block_number || 0,
          };
        });

      console.log(`Found ${feeCollections.length} TAO fee collections`);
      return feeCollections;
    } catch (error) {
      console.error('Error fetching TAO fee collections:', error);
      throw error;
    }
  }

  /**
   * Get all fee collections (TAO + USDC) for an address
   * @param address - The EVM address
   * @param limit - Maximum number of records per token (default 1000)
   */
  async getFeeCollections(address: string, limit: number = 1000): Promise<FeeCollectionRecord[]> {
    const cacheKey = `uniswap-fees-${address}-${limit}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for ${cacheKey}`);
      return cached;
    }

    console.log(`Cache miss for ${cacheKey}, fetching from API...`);

    try {
      // Fetch both TAO and USDC fee collections in parallel
      const [taoFees, usdcFees] = await Promise.all([
        this.getTaoFeeCollections(address, limit),
        this.getUsdcFeeCollections(address, limit),
      ]);

      // Combine and sort by timestamp (newest first)
      const allFees = [...taoFees, ...usdcFees].sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      console.log(`Total fee collections: ${allFees.length} (${taoFees.length} TAO + ${usdcFees.length} USDC)`);

      // Cache the result
      this.cache.set(cacheKey, allFees, this.cacheTTL);

      return allFees;
    } catch (error) {
      console.error('Error fetching fee collections:', error);
      throw new Error('Failed to fetch fee collections');
    }
  }
}
