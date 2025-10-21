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
      let transfers: any[] = [];

      // Use different endpoints for EVM vs SS58 addresses
      if (this.isEvmAddress(address)) {
        console.log(`Fetching EVM transactions for ${address}`);
        // EVM addresses use the transaction endpoint
        // Try filtering by address parameter (may filter by from OR to)
        const response = await (this.client as any).httpClient.get('/api/evm/transaction/v1', {
          address,
          limit,
          page: 1,
        });

        if (!response.success || !response.data) {
          throw new Error('Failed to fetch EVM transactions');
        }

        const transactions = response.data.data || [];
        console.log(`Received ${transactions.length} EVM transactions from API`);

        // Convert transactions to transfer records and filter by direction
        const normalizedAddress = address.toLowerCase();
        transfers = transactions
          .filter((tx: any) => {
            const from = (tx.from || '').toLowerCase();
            const to = (tx.to || '').toLowerCase();

            if (direction === 'in') {
              return to === normalizedAddress;
            } else if (direction === 'out') {
              return from === normalizedAddress;
            } else {
              return from === normalizedAddress || to === normalizedAddress;
            }
          })
          .map((tx: any) => ({
            from: tx.from || '',
            to: tx.to || '',
            amount: tx.value || '0',
            extrinsicId: tx.hash || '',
            blockNumber: tx.block_number || 0,
            timestamp: tx.timestamp || '',
          }));

        console.log(`Filtered to ${transfers.length} transfers for ${address}`);
      } else {
        console.log(`Fetching SS58 transfers for ${address}`);
        // Use SDK method for SS58 addresses
        const response = await this.client.accounts.getTransfers({
          address,
          limit,
          page: 1,
        });

        if (!response.success || !response.data) {
          throw new Error('Failed to fetch transfers');
        }

        transfers = response.data.data || [];
        console.log(`SS58 API returned ${transfers.length} total transfers, filtering for direction: ${direction}`);
        if (transfers.length > 0) {
          console.log(`First transfer keys:`, Object.keys(transfers[0]));
          console.log(`First transfer sample:`, JSON.stringify(transfers[0]).substring(0, 200));
        }
      }

      // Filter by direction (for SS58 addresses, EVM already filtered by topics)
      if (!this.isEvmAddress(address)) {
        if (direction === 'in') {
          transfers = transfers.filter((t: any) => {
            // Handle both string addresses (EVM) and object addresses (SS58)
            const to = typeof t.to === 'object' ? (t.to?.ss58 || t.to?.hex || '') : (t.to || '');
            return String(to).toLowerCase() === address.toLowerCase();
          });
        } else if (direction === 'out') {
          transfers = transfers.filter((t: any) => {
            // Handle both string addresses (EVM) and object addresses (SS58)
            const from = typeof t.from === 'object' ? (t.from?.ss58 || t.from?.hex || '') : (t.from || '');
            return String(from).toLowerCase() === address.toLowerCase();
          });
        }
      }

      // Normalize to our TransferRecord type
      const normalizedTransfers: TransferRecord[] = transfers.map((t: any) => {
        // Extract address strings from object format if needed
        const from = typeof t.from === 'object' ? (t.from?.ss58 || t.from?.hex || '') : (t.from || '');
        const to = typeof t.to === 'object' ? (t.to?.ss58 || t.to?.hex || '') : (t.to || '');

        return {
          from: String(from),
          to: String(to),
          amount: t.amount || '0',
          extrinsicId: t.extrinsic_id || t.extrinsicId || t.transaction_hash || t.hash || '',
          blockNumber: t.block_number || t.blockNumber || t.block || 0,
          timestamp: t.timestamp || t.created_at || t.time || '',
        };
      });

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
