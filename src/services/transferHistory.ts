import { TaoStatsClient } from '@taostats/sdk';
import type { TransferRecord, TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';

export class TransferHistoryClient {
  private client: TaoStatsClient;
  private cache: Cache<TransferRecord[]>;
  private cacheTTL: number; // Cache TTL in milliseconds

  constructor(config: TaostatsConfig, cacheTTL: number = 60000) {
    this.client = new TaoStatsClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });
    this.cache = new Cache();
    this.cacheTTL = cacheTTL; // Default 60 seconds
  }

  /**
   * Check if an address is an EVM H160 address (starts with 0x)
   */
  private isEvmAddress(address: string): boolean {
    return address.toLowerCase().startsWith('0x');
  }

  /**
   * Get transfer history for a given address (SS58 or EVM)
   * @param address - The SS58 or EVM address
   * @param direction - Filter by 'in' (incoming), 'out' (outgoing), or 'all'
   * @param limit - Maximum number of records to return (default 1000)
   */
  async getTransfers(
    address: string,
    direction: 'in' | 'out' | 'all' = 'all',
    limit: number = 1000
  ): Promise<TransferRecord[]> {
    const cacheKey = `transfers-${address}-${direction}-${limit}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for ${cacheKey}`);
      return cached;
    }

    console.log(`Cache miss for ${cacheKey}, fetching from API...`);

    try {
      let response: any;

      // Use different endpoints for EVM vs SS58 addresses
      if (this.isEvmAddress(address)) {
        console.log(`Fetching EVM transfers for ${address}`);
        // Use httpClient directly for EVM endpoint
        response = await (this.client as any).httpClient.get('/api/evm/transaction/v1', {
          address,
          limit,
          page: 1,
        });
      } else {
        console.log(`Fetching SS58 transfers for ${address}`);
        // Use SDK method for SS58 addresses
        response = await this.client.accounts.getTransfers({
          address,
          limit,
          page: 1,
        });
      }

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch transfers');
      }

      let transfers = response.data.data || [];

      // Filter by direction
      if (direction === 'in') {
        transfers = transfers.filter((t: any) =>
          t.to?.toLowerCase() === address.toLowerCase()
        );
      } else if (direction === 'out') {
        transfers = transfers.filter((t: any) =>
          t.from?.toLowerCase() === address.toLowerCase()
        );
      }

      // Normalize to our TransferRecord type
      const normalizedTransfers: TransferRecord[] = transfers.map((t: any) => ({
        from: t.from || '',
        to: t.to || '',
        amount: t.amount || '0',
        extrinsicId: t.extrinsic_id || t.extrinsicId || t.hash || '',
        blockNumber: t.block_number || t.blockNumber || t.block || 0,
        timestamp: t.timestamp || t.created_at || t.time || '',
      }));

      // Cache the result
      this.cache.set(cacheKey, normalizedTransfers, this.cacheTTL);
      console.log(`Cached ${normalizedTransfers.length} transfers for ${cacheKey}`);

      return normalizedTransfers;
    } catch (error) {
      console.error('Error fetching transfers:', error);
      throw new Error('Failed to fetch transfer history');
    }
  }

  /**
   * Get incoming transfers for an address
   */
  async getIncomingTransfers(address: string, limit: number = 1000): Promise<TransferRecord[]> {
    return this.getTransfers(address, 'in', limit);
  }

  /**
   * Get outgoing transfers for an address
   */
  async getOutgoingTransfers(address: string, limit: number = 1000): Promise<TransferRecord[]> {
    return this.getTransfers(address, 'out', limit);
  }
}
