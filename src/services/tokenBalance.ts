import { JsonRpcProvider, Contract } from 'ethers';
import type { TaostatsConfig } from '../types/index.js';
import { PersistentCache } from './persistentCache.js';
import { getTokenBySymbol, type TokenInfo } from '../config/tokens.js';

// ERC-20 ABI (minimal - only balanceOf function)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)'
];

export class TokenBalanceClient {
  private provider: JsonRpcProvider;
  private persistentCache: PersistentCache;
  private updateInterval: number;
  private updateTimer: NodeJS.Timeout | null = null;
  private trackedBalances: Map<string, string> = new Map(); // key: "symbol:address"

  // Bittensor EVM RPC endpoint
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  constructor(
    config: TaostatsConfig,
    persistentCache: PersistentCache,
    updateInterval: number = 3600000 // Default 1 hour
  ) {
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL);
    this.persistentCache = persistentCache;
    this.updateInterval = updateInterval;
  }

  /**
   * Initialize the token balance client and start background updates
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
   * Get token balance for an EVM address
   * @param symbol - Token symbol (e.g., 'USDC')
   * @param address - EVM address
   * @returns Balance as a string
   */
  async getTokenBalance(symbol: string, address: string): Promise<string> {
    const token = getTokenBySymbol(symbol);
    if (!token) {
      throw new Error(`Unsupported token: ${symbol}`);
    }

    const cacheKey = `${symbol.toLowerCase()}:${address.toLowerCase()}`;

    // Track this balance for background updates
    this.trackedBalances.set(cacheKey, symbol);

    // Check persistent cache first
    const cached = await this.persistentCache.readTokenBalance(cacheKey);
    if (cached) {
      console.log(`Token balance cache hit for ${cacheKey}: ${cached.balance} (cached at ${cached.timestamp})`);

      // Trigger background update if cache is old (but don't wait for it)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      if (cacheAge > this.updateInterval) {
        console.log(`Token balance cache is stale (${Math.round(cacheAge / 1000)}s old), triggering background update`);
        this.fetchAndCacheTokenBalance(symbol, address, token).catch(err =>
          console.error(`Background token balance update failed for ${cacheKey}:`, err)
        );
      }

      return cached.balance;
    }

    // No cached value, fetch immediately
    console.log(`Token balance cache miss for ${cacheKey}, fetching from RPC...`);
    return await this.fetchAndCacheTokenBalance(symbol, address, token);
  }

  /**
   * Fetch token balance from blockchain via RPC and cache it
   */
  private async fetchAndCacheTokenBalance(symbol: string, address: string, token: TokenInfo): Promise<string> {
    try {
      if (!token.contractAddress) {
        throw new Error(`Token ${symbol} does not have a contract address (might be native token)`);
      }

      // Create contract instance
      const contract = new Contract(token.contractAddress, ERC20_ABI, this.provider);

      // Call balanceOf function
      const balanceRaw = await contract.balanceOf(address);

      // Convert from token's smallest unit to human-readable format
      const balance = (Number(balanceRaw) / Math.pow(10, token.decimals)).toString();

      console.log(`Token balance for ${symbol} at ${address}: ${balance} (${balanceRaw.toString()} raw)`);

      // Cache the result
      const cacheKey = `${symbol.toLowerCase()}:${address.toLowerCase()}`;
      await this.persistentCache.writeTokenBalance(cacheKey, balance);

      return balance;
    } catch (error) {
      console.error(`Error fetching token balance for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Background update loop - refreshes all tracked token balances periodically
   */
  private async tokenBalanceUpdateLoop(): Promise<void> {
    if (this.trackedBalances.size === 0) {
      console.log('No token balances to update');
      return;
    }

    console.log(`Updating token balances for ${this.trackedBalances.size} tracked addresses...`);

    for (const [cacheKey, symbol] of this.trackedBalances.entries()) {
      try {
        const address = cacheKey.split(':')[1];
        const token = getTokenBySymbol(symbol);
        if (token) {
          await this.fetchAndCacheTokenBalance(symbol, address, token);
          // Wait 1.5 seconds between requests to respect rate limit
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (error) {
        console.error(`Failed to update token balance for ${cacheKey}:`, error);
      }
    }

    console.log('Token balance update loop complete');
  }

  /**
   * Start background updates
   */
  private startBackgroundUpdates(): void {
    const runUpdate = async () => {
      try {
        await this.tokenBalanceUpdateLoop();
      } catch (error) {
        console.error('Token balance update error:', error);
      }

      // Schedule next update
      this.updateTimer = setTimeout(runUpdate, this.updateInterval);
    };

    // Start the loop
    runUpdate();
  }
}
