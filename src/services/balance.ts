import { TaoStatsClient } from '@taostats/sdk';
import type { TaostatsConfig } from '../types/index.js';
import { PersistentCache } from './persistentCache.js';
import { blake2AsU8a, encodeAddress } from '@polkadot/util-crypto';
import { hexToU8a } from '@polkadot/util';

export class BalanceClient {
  private client: TaoStatsClient;
  private persistentCache: PersistentCache;
  private updateInterval: number;
  private updateTimer: NodeJS.Timeout | null = null;
  private trackedAddresses: Set<string> = new Set();

  constructor(
    config: TaostatsConfig,
    persistentCache: PersistentCache,
    updateInterval: number = 3600000 // Default 1 hour
  ) {
    this.client = new TaoStatsClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });
    this.persistentCache = persistentCache;
    this.updateInterval = updateInterval;
  }

  /**
   * Initialize the balance client and start background updates
   */
  async init(): Promise<void> {
    // Start background update loop
    this.startBackgroundUpdates();
  }

  /**
   * Stop background updates (cleanup)
   */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Check if an address is an EVM H160 address (starts with 0x)
   */
  private isEvmAddress(address: string): boolean {
    return address.toLowerCase().startsWith('0x');
  }

  /**
   * Convert an EVM H160 address to its SS58 mirror address
   * Based on evm-bittensor implementation
   */
  private convertEvmToSS58(evmAddress: string): string {
    const prefix = 'evm:';
    const prefixBytes = new TextEncoder().encode(prefix);
    const addressBytes = hexToU8a(evmAddress.startsWith('0x') ? evmAddress : `0x${evmAddress}`);
    const combined = new Uint8Array(prefixBytes.length + addressBytes.length);

    // Concatenate prefix and Ethereum address
    combined.set(prefixBytes);
    combined.set(addressBytes, prefixBytes.length);

    // Hash the combined data (the public key)
    const hash = blake2AsU8a(combined);

    // Convert the hash to SS58 format (network ID 42 for Substrate/Bittensor)
    const ss58Address = encodeAddress(hash, 42);
    return ss58Address;
  }

  /**
   * Get balance for a given address (SS58 or EVM)
   * Returns cached value immediately if available, triggers background update
   * @param address - The SS58 or EVM address
   * @returns Balance in TAO as a string
   */
  async getBalance(address: string): Promise<string> {
    // Track this address for background updates
    this.trackedAddresses.add(address);

    // Check persistent cache first
    const cached = await this.persistentCache.readBalance(address);
    if (cached) {
      console.log(`Balance cache hit for ${address}: ${cached.balance} TAO (cached at ${cached.timestamp})`);

      // Trigger background update if cache is old (but don't wait for it)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > this.updateInterval) {
        console.log(`Cache is stale (${Math.round(cacheAge / 1000)}s old), triggering background update`);
        this.fetchAndCacheBalance(address).catch(err =>
          console.error(`Background balance update failed for ${address}:`, err)
        );
      }

      return cached.balance;
    }

    // No cached value, fetch immediately
    console.log(`Balance cache miss for ${address}, fetching from API...`);
    return await this.fetchAndCacheBalance(address);
  }

  /**
   * Fetch balance from API and cache it
   */
  private async fetchAndCacheBalance(address: string): Promise<string> {
    try {
      let queryAddress = address;

      // Convert EVM address to SS58 mirror if needed
      if (this.isEvmAddress(address)) {
        queryAddress = this.convertEvmToSS58(address);
        console.log(`Converted EVM address ${address} to SS58 mirror ${queryAddress}`);
      }

      // Fetch account data using SDK
      const response = await this.client.accounts.getAccount({
        address: queryAddress,
      });

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch account balance');
      }

      // Extract balance_free from the first result
      const accountData = Array.isArray(response.data.data) ? response.data.data[0] : response.data.data;

      if (!accountData) {
        // Account doesn't exist, return 0 balance
        console.log(`Account ${address} not found, returning 0 balance`);
        await this.persistentCache.writeBalance(address, '0');
        return '0';
      }

      const balanceRao = accountData.balance_free || '0';
      // Convert from rao to TAO (1 TAO = 1e9 rao)
      const balanceTao = (parseFloat(balanceRao) / 1e9).toString();
      console.log(`Balance for ${address}: ${balanceTao} TAO (${balanceRao} rao)`);

      // Cache the result
      await this.persistentCache.writeBalance(address, balanceTao);

      return balanceTao;
    } catch (error) {
      console.error('Error fetching balance:', error);
      throw error;
    }
  }

  /**
   * Background update loop - refreshes all tracked addresses periodically
   */
  private async balanceUpdateLoop(): Promise<void> {
    if (this.trackedAddresses.size === 0) {
      console.log('No addresses to update');
      return;
    }

    console.log(`Updating balances for ${this.trackedAddresses.size} tracked addresses...`);

    for (const address of this.trackedAddresses) {
      try {
        await this.fetchAndCacheBalance(address);
        // Wait 1.5 seconds between requests to respect rate limit (60 calls/min with safety margin)
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`Failed to update balance for ${address}:`, error);
      }
    }

    console.log('Balance update loop complete');
  }

  /**
   * Start background updates
   */
  private startBackgroundUpdates(): void {
    const runUpdate = async () => {
      try {
        await this.balanceUpdateLoop();
      } catch (error) {
        console.error('Balance update error:', error);
      }

      // Schedule next update
      this.updateTimer = setTimeout(runUpdate, this.updateInterval);
    };

    // Start the loop
    runUpdate();
  }
}
