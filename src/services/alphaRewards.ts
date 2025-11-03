import { JsonRpcProvider, Contract } from 'ethers';
import { blake2b } from 'blakejs';
import type { TaostatsConfig } from '../types/index.js';
import { PersistentCache } from './persistentCache.js';

export interface AlphaRewardRecord {
  timestamp: string;
  netuid: number;
  amount: string; // Human-readable amount
  claimedAmount?: string; // Amount claimed (if different from available)
  isClaimed: boolean;
}

export class AlphaRewardsClient {
  private provider: JsonRpcProvider;
  private stakingPrecompile: Contract;
  private persistentCache: PersistentCache;
  private isFetchingInBackground: Map<string, boolean> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  // Bittensor EVM RPC endpoint
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  // Staking precompile contract address
  private readonly STAKING_PRECOMPILE = '0x0000000000000000000000000000000000000805';

  // TaoFi subnet ID
  private readonly TAOFI_NETUID = 10;

  // TaoFi subnet 10 hotkey (from API)
  private readonly TAOFI_HOTKEY = '0xacf34e305f1474e4817a66352af736fe6b0bcf5cdfeef18c441e24645c742339';

  // Staking precompile ABI (minimal - only needed functions)
  private readonly STAKING_ABI = [
    'function getStake(bytes32 hotkey, bytes32 coldkey, uint256 netuid) external view returns (uint256)',
    'function getTotalAlphaStaked(bytes32 hotkey, uint256 netuid) external view returns (uint256)',
    'function getTotalColdkeyStake(bytes32 coldkey) external view returns (uint256)',
  ];

  constructor(config: TaostatsConfig) {
    // Create provider with static network config to avoid detection timeout
    const network = {
      chainId: 945, // Bittensor EVM chain ID
      name: 'bittensor-evm',
    };
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL, network, {
      staticNetwork: true,
      batchMaxCount: 1,
    });

    this.stakingPrecompile = new Contract(
      this.STAKING_PRECOMPILE,
      this.STAKING_ABI,
      this.provider
    );

    this.persistentCache = new PersistentCache();
  }

  /**
   * Initialize the client (must be called before use)
   */
  async init(): Promise<void> {
    await this.persistentCache.init();
    console.log('✓ Alpha rewards client initialized with persistent cache');
  }

  /**
   * Start smart background updates - checks actively from UTC+0 until rewards found
   */
  startBackgroundUpdates(addresses: string[]): void {
    console.log(`Starting smart alpha rewards checking for ${addresses.length} addresses...`);

    // Initial check for all addresses
    for (const address of addresses) {
      this.checkAndUpdateRewards(address);
    }

    // Set up periodic checking with smart timing
    this.checkInterval = setInterval(() => {
      this.smartPeriodicCheck(addresses);
    }, 15 * 60 * 1000); // Check every 15 minutes
  }

  /**
   * Smart periodic check - only checks actively after UTC+0
   */
  private async smartPeriodicCheck(addresses: string[]): Promise<void> {
    const now = new Date();
    const utcHour = now.getUTCHours();

    // Only check actively from UTC+0 to UTC+6 (rewards typically appear within this window)
    if (utcHour >= 0 && utcHour < 6) {
      console.log(`Smart check active (UTC ${utcHour}:00) - checking for new rewards...`);
      for (const address of addresses) {
        await this.checkAndUpdateRewards(address);
        // Small delay between addresses
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      console.log(`Smart check idle (UTC ${utcHour}:00) - outside active window`);
    }
  }

  /**
   * Check and update rewards for an address
   */
  private async checkAndUpdateRewards(address: string): Promise<void> {
    try {
      const current = await this.getAlphaRewards(address);
      console.log(`Alpha rewards for ${address}: ${current.amount} (claimed: ${current.isClaimed})`);
    } catch (error) {
      console.error(`Error checking alpha rewards for ${address}:`, error);
    }
  }

  /**
   * Derive coldkey from EVM address using TaoFi's algorithm
   * Coldkey = Blake2b-256("evm:" + address_bytes)
   */
  private evmAddressToColdkey(address: string): string {
    // Normalize address (lowercase, remove 0x)
    const normalizedAddr = address.toLowerCase().replace('0x', '');

    // Create input: "evm:" prefix + address bytes
    const prefix = Buffer.from('evm:', 'utf8');
    const addrBytes = Buffer.from(normalizedAddr, 'hex');
    const input = Buffer.concat([prefix, addrBytes]);

    // Hash with Blake2b-256 (32 byte output)
    const hash = blake2b(input, undefined, 32);

    return '0x' + Buffer.from(hash).toString('hex');
  }

  /**
   * Get alpha rewards for an EVM address
   * Returns cached data immediately, updates in background if needed
   */
  async getAlphaRewards(address: string): Promise<AlphaRewardRecord> {
    const normalizedAddress = address.toLowerCase();

    // Check persistent cache first
    const cachedData = await this.persistentCache.readAlphaRewards(normalizedAddress);

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    if (cachedData && cachedData.lastCheckedDate === today && cachedData.rewards) {
      console.log(`Persistent cache hit for alpha rewards ${normalizedAddress}`);

      // If not claimed yet, trigger background check during active hours
      if (!cachedData.rewards.isClaimed) {
        const utcHour = new Date().getUTCHours();
        if (utcHour >= 0 && utcHour < 6 && !this.isFetchingInBackground.get(normalizedAddress)) {
          console.log('Unclaimed rewards detected during active window, triggering background check...');
          this.fetchAndCacheRewardsInBackground(normalizedAddress);
        }
      }

      return cachedData.rewards;
    }

    // No cache for today - check if background fetch is already running
    if (this.isFetchingInBackground.get(normalizedAddress)) {
      console.log(`Background fetch in progress for alpha rewards ${normalizedAddress}...`);
      // Return last known data or default
      return cachedData?.rewards || {
        timestamp: new Date().toISOString(),
        netuid: this.TAOFI_NETUID,
        amount: '0',
        isClaimed: false,
      };
    }

    // Fetch synchronously for first request of the day
    console.log(`No cache for today, fetching alpha rewards for ${normalizedAddress}...`);
    this.isFetchingInBackground.set(normalizedAddress, true);
    try {
      const rewards = await this.fetchAlphaRewards(normalizedAddress);
      return rewards;
    } finally {
      this.isFetchingInBackground.set(normalizedAddress, false);
    }
  }

  /**
   * Fetch alpha rewards from the staking precompile
   */
  private async fetchAlphaRewards(address: string): Promise<AlphaRewardRecord> {
    console.log(`Fetching alpha rewards from staking precompile for ${address}...`);

    try {
      // Derive coldkey from EVM address using Blake2b hash
      const coldkey = this.evmAddressToColdkey(address);

      console.log(`Derived coldkey: ${coldkey}`);

      // Query stake amount for subnet 10 (TaoFi)
      const stakeAmount = await this.stakingPrecompile.getStake(
        this.TAOFI_HOTKEY,
        coldkey,
        this.TAOFI_NETUID
      );

      // Convert from raw amount (9 decimals for alpha tokens, like TAO rao)
      const amountInAlpha = Number(stakeAmount) / 1e9;

      // Get previous day's amount to detect if rewards were claimed
      const cachedData = await this.persistentCache.readAlphaRewards(address);
      const previousAmount = cachedData?.rewards ? parseFloat(cachedData.rewards.amount) : 0;

      // Mark as claimed only if:
      // 1. Amount is very small (< 1 SN10) - likely claimed or no rewards
      // 2. Amount dropped significantly from previous (> 90% drop) - indicates claim happened
      // Otherwise, small variations are normal and should show as unclaimed
      const isClaimed = amountInAlpha < 1 || (previousAmount > 0 && amountInAlpha < previousAmount * 0.1);

      const rewards: AlphaRewardRecord = {
        timestamp: new Date().toISOString(),
        netuid: this.TAOFI_NETUID,
        amount: amountInAlpha.toString(),
        isClaimed,
      };

      // Cache to persistent storage
      await this.persistentCache.writeAlphaRewards(address, rewards);
      console.log(`Cached alpha rewards: ${amountInAlpha} (claimed: ${isClaimed})`);

      return rewards;
    } catch (error) {
      console.error(`Error fetching alpha rewards for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Fetch and cache rewards in background (non-blocking)
   */
  private fetchAndCacheRewardsInBackground(address: string): void {
    if (this.isFetchingInBackground.get(address)) {
      return; // Already fetching
    }

    this.isFetchingInBackground.set(address, true);
    console.log(`Starting background alpha rewards fetch for ${address}...`);

    this.fetchAlphaRewards(address)
      .then(() => {
        console.log(`Background alpha rewards fetch complete for ${address}`);
      })
      .catch((error) => {
        console.error(`Background alpha rewards fetch error for ${address}:`, error);
      })
      .finally(() => {
        this.isFetchingInBackground.set(address, false);
      });
  }

  /**
   * Stop background updates (cleanup)
   */
  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
