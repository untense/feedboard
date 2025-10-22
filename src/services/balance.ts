import { TaoStatsClient } from '@taostats/sdk';
import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { blake2AsU8a, encodeAddress } from '@polkadot/util-crypto';
import { hexToU8a } from '@polkadot/util';

export class BalanceClient {
  private client: TaoStatsClient;
  private cache: Cache<string>;
  private cacheTTL: number;

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
   * @param address - The SS58 or EVM address
   * @returns Balance in TAO as a string
   */
  async getBalance(address: string): Promise<string> {
    const cacheKey = `balance-${address}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for ${cacheKey}`);
      return cached;
    }

    console.log(`Cache miss for ${cacheKey}, fetching from API...`);

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
        this.cache.set(cacheKey, '0', this.cacheTTL);
        return '0';
      }

      const balanceRao = accountData.balance_free || '0';
      // Convert from rao to TAO (1 TAO = 1e9 rao)
      const balanceTao = (parseFloat(balanceRao) / 1e9).toString();
      console.log(`Balance for ${address}: ${balanceTao} TAO (${balanceRao} rao)`);

      // Cache the result
      this.cache.set(cacheKey, balanceTao, this.cacheTTL);

      return balanceTao;
    } catch (error) {
      console.error('Error fetching balance:', error);
      throw new Error('Failed to fetch balance');
    }
  }
}
