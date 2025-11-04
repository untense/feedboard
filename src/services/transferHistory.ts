import { TaoStatsClient } from '@taostats/sdk';
import type { TransferRecord, TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { PersistentCache } from './persistentCache.js';

export class TransferHistoryClient {
  private client: TaoStatsClient;
  private cache: Cache<TransferRecord[]>;
  private persistentCache: PersistentCache;
  private cacheTTL: number; // Cache TTL in milliseconds
  private isFetchingInBackground: Map<string, boolean> = new Map();

  constructor(config: TaostatsConfig, cacheTTL: number = 3600000) {
    this.client = new TaoStatsClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });
    this.cache = new Cache();
    this.persistentCache = new PersistentCache();
    this.cacheTTL = cacheTTL; // Default 1 hour
  }

  /**
   * Initialize the client (must be called before use)
   */
  async init(): Promise<void> {
    await this.persistentCache.init();
    console.log('✓ Transfer history client initialized with persistent cache');
  }

  /**
   * Start background updates for tracked addresses
   */
  startBackgroundUpdates(addresses: string[], direction: 'in' | 'out' | 'all' = 'all', limit: number = 1000): void {
    console.log(`Starting background transfer updates for ${addresses.length} addresses...`);

    // Start background fetch for each address
    for (const address of addresses) {
      const cacheKey = `${address}_${direction}_${limit}`;

      // Check if cache exists
      this.persistentCache.readTransfers(address, direction, limit).then((cachedData) => {
        if (!cachedData) {
          console.log(`No transfers cache for ${cacheKey}, starting background fetch...`);
          this.fetchAndCacheTransfersInBackground(address, direction, limit);
        } else {
          console.log(`Transfers cache exists for ${cacheKey} (${cachedData.recordCount} records, last updated: ${cachedData.lastUpdated})`);

          // Check if cache is stale (older than 1 hour)
          const cacheAge = Date.now() - new Date(cachedData.lastUpdated).getTime();
          if (cacheAge > this.cacheTTL) {
            console.log(`Transfers cache is stale (${Math.round(cacheAge / 3600000)}h old), triggering background update...`);
            this.fetchAndCacheTransfersInBackground(address, direction, limit);
          }
        }
      }).catch((error) => {
        console.error(`Error checking transfers cache for ${cacheKey}:`, error);
      });
    }
  }

  /**
   * Check if an address is an EVM H160 address (starts with 0x)
   */
  private isEvmAddress(address: string): boolean {
    return address.toLowerCase().startsWith('0x');
  }


  /**
   * Get transfer history for a given address (SS58 or EVM)
   * Returns cached data immediately, triggers background fetch if cache is missing/stale
   * @param address - The SS58 or EVM address
   * @param direction - Filter by 'in' (incoming), 'out' (outgoing), or 'all'
   * @param limit - Maximum number of records to return (default 1000)
   */
  async getTransfers(
    address: string,
    direction: 'in' | 'out' | 'all' = 'all',
    limit: number = 1000
  ): Promise<TransferRecord[]> {
    const cacheKey = `${address}_${direction}_${limit}`;

    // Check persistent cache first
    const cachedData = await this.persistentCache.readTransfers(address, direction, limit);

    if (cachedData && cachedData.transfers) {
      console.log(`Persistent cache hit for transfers ${cacheKey} (${cachedData.recordCount} records)`);

      // Trigger background update if cache is stale
      const cacheAge = Date.now() - new Date(cachedData.lastUpdated).getTime();
      if (cacheAge > this.cacheTTL && !this.isFetchingInBackground.get(cacheKey)) {
        console.log(`Transfers cache is ${Math.round(cacheAge / 1000)}s old, triggering background update...`);
        this.fetchAndCacheTransfersInBackground(address, direction, limit);
      }

      return cachedData.transfers;
    }

    // No cache exists - check if background fetch is already running
    if (this.isFetchingInBackground.get(cacheKey)) {
      console.log(`Background fetch in progress for transfers ${cacheKey}, returning empty...`);
      return [];
    }

    // No cache and no fetch running - start background fetch and return empty
    console.log(`No transfers cache for ${cacheKey}, starting background fetch...`);
    this.fetchAndCacheTransfersInBackground(address, direction, limit);
    return [];
  }

  /**
   * Fetch transfers from API (used for both sync and background fetching)
   */
  private async fetchTransfers(
    address: string,
    direction: 'in' | 'out' | 'all' = 'all',
    limit: number = 1000
  ): Promise<TransferRecord[]> {
    console.log(`Fetching transfers from API for ${address} (${direction}, limit ${limit})...`);

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

        // Fetch regular transfers
        const response = await this.client.accounts.getTransfers({
          address,
          limit,
          page: 1,
        });

        if (!response.success || !response.data) {
          throw new Error('Failed to fetch transfers');
        }

        transfers = response.data.data || [];
        console.log(`SS58 API returned ${transfers.length} regular transfers`);

        // Also fetch delegation transfers (alpha token swaps, etc.)
        try {
          const delegationResponse = await (this.client as any).httpClient.get('/api/delegation/v1', {
            nominator: address,
            is_transfer: true,
            limit,
            page: 1,
          });

          if (delegationResponse.success && delegationResponse.data?.data) {
            const delegationTransfers = delegationResponse.data.data.map((dt: any) => ({
              from: dt.transfer_address?.ss58 || dt.transfer_address?.hex || '',
              to: dt.nominator?.ss58 || dt.nominator?.hex || address,
              amount: dt.amount || '0',
              extrinsic_id: dt.extrinsic_id || '',
              block_number: dt.block_number || 0,
              timestamp: dt.timestamp || '',
            }));

            console.log(`Fetched ${delegationTransfers.length} delegation transfers`);
            transfers = [...transfers, ...delegationTransfers];
          }
        } catch (error) {
          console.error('Error fetching delegation transfers (continuing with regular transfers):', error);
        }

        // Sort all transfers by timestamp (descending - newest first) or block number if timestamp is missing
        transfers.sort((a: any, b: any) => {
          const aTime = a.timestamp || a.created_at || a.time || '';
          const bTime = b.timestamp || b.created_at || b.time || '';

          if (aTime && bTime) {
            return new Date(bTime).getTime() - new Date(aTime).getTime();
          }

          // Fallback to block number if timestamps are missing
          const aBlock = a.block_number || a.blockNumber || a.block || 0;
          const bBlock = b.block_number || b.blockNumber || b.block || 0;
          return bBlock - aBlock;
        });

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

        // Convert amount from raw units to TAO
        const rawAmount = t.amount || '0';
        let amountInTao: string;

        if (this.isEvmAddress(address)) {
          // EVM uses 18 decimals (wei) - need to divide by 10^18
          const divisor = BigInt(10 ** 18);
          const bigAmount = BigInt(rawAmount);
          const wholePart = bigAmount / divisor;
          const fractionalPart = bigAmount % divisor;

          // Convert to string with 18 decimal places
          const fractionalStr = fractionalPart.toString().padStart(18, '0');
          // Trim to 9 significant decimals (TAO precision)
          const trimmedFractional = fractionalStr.substring(0, 9);
          amountInTao = wholePart.toString() + '.' + trimmedFractional;
          // Clean up trailing zeros
          amountInTao = parseFloat(amountInTao).toString();
        } else {
          // SS58 uses 9 decimals (rao)
          amountInTao = (Number(rawAmount) / 1e9).toString();
        }

        return {
          from: String(from),
          to: String(to),
          amount: amountInTao,
          extrinsicId: t.extrinsic_id || t.extrinsicId || t.transaction_hash || t.hash || '',
          blockNumber: t.block_number || t.blockNumber || t.block || 0,
          timestamp: t.timestamp || t.created_at || t.time || '',
        };
      });

      // Cache to persistent storage
      await this.persistentCache.writeTransfers(address, direction, limit, normalizedTransfers);
      console.log(`Cached ${normalizedTransfers.length} transfers to persistent storage for ${address} (${direction})`);

      return normalizedTransfers;
    } catch (error) {
      console.error('Error fetching transfers:', error);
      throw new Error('Failed to fetch transfer history');
    }
  }

  /**
   * Fetch and cache transfers in background (non-blocking)
   */
  private fetchAndCacheTransfersInBackground(address: string, direction: 'in' | 'out' | 'all', limit: number): void {
    const cacheKey = `${address}_${direction}_${limit}`;

    if (this.isFetchingInBackground.get(cacheKey)) {
      return; // Already fetching
    }

    this.isFetchingInBackground.set(cacheKey, true);
    console.log(`Starting background transfers fetch for ${cacheKey}...`);

    this.fetchTransfers(address, direction, limit)
      .then(() => {
        console.log(`Background transfers fetch complete for ${cacheKey}`);
      })
      .catch((error) => {
        console.error(`Background transfers fetch error for ${cacheKey}:`, error);
      })
      .finally(() => {
        this.isFetchingInBackground.set(cacheKey, false);
      });
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
