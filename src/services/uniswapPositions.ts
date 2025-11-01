import { JsonRpcProvider, Contract } from 'ethers';
import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { PersistentCache } from './persistentCache.js';

// Maximum value for uint128
const MAX_UINT128 = 2n ** 128n - 1n;

// Uniswap V3 NonfungiblePositionManager ABI (minimal - only needed functions)
const POSITION_MANAGER_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)'
];

// ERC-20 ABI for token info
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)'
];

// Uniswap V3 Pool ABI (minimal - for getting current tick)
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

// Uniswap V3 Factory ABI (minimal - for getting pool address)
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
];

export interface UniswapPosition {
  tokenId: string;
  nonce: string;
  operator: string;
  token0: string;
  token0Symbol: string;
  token0Decimals: number;
  token1: string;
  token1Symbol: string;
  token1Decimals: number;
  fee: number; // Fee tier (e.g., 3000 = 0.3%)
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string; // Uncollected fees in token0 (human-readable)
  tokensOwed1: string; // Uncollected fees in token1 (human-readable)
  token0Amount?: string; // Approximate token0 amount (calculated from liquidity)
  token1Amount?: string; // Approximate token1 amount (calculated from liquidity)
}

export class UniswapPositionsClient {
  private provider: JsonRpcProvider;
  private positionManager: Contract;
  private cache: Cache<UniswapPosition[]>;
  private persistentCache: PersistentCache;
  private tokenInfoCache: Map<string, { symbol: string; decimals: number; name: string }> = new Map();
  private cacheTTL: number;
  private updateInterval: number;
  private updateTimer: NodeJS.Timeout | null = null;
  private trackedAddresses: Set<string> = new Set();
  private isFetchingInBackground: Map<string, boolean> = new Map();

  // TaoFi Uniswap V3 NonfungiblePositionManager on Bittensor EVM
  private readonly POSITION_MANAGER_ADDRESS = '0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25';
  private readonly FACTORY_ADDRESS = '0x20D0Cdf9004bf56BCa52A25C9288AAd0EbB97D59'; // TaoFi Uniswap V3 Factory
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  constructor(config: TaostatsConfig, cacheTTL: number = 3600000, updateInterval: number = 3600000) {
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL);
    this.positionManager = new Contract(
      this.POSITION_MANAGER_ADDRESS,
      POSITION_MANAGER_ABI,
      this.provider
    );
    this.cache = new Cache<UniswapPosition[]>();
    this.persistentCache = new PersistentCache();
    this.cacheTTL = cacheTTL; // 1 hour default (positions don't change as frequently)
    this.updateInterval = updateInterval; // 1 hour default
  }

  /**
   * Initialize the client and start background updates
   */
  async init(): Promise<void> {
    await this.persistentCache.init();
    console.log('✓ Uniswap positions client initialized with persistent cache');
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
   * Get current tick from a Uniswap V3 pool
   */
  private async getCurrentTick(token0: string, token1: string, fee: number): Promise<number | null> {
    try {
      // Get pool address from factory
      const factory = new Contract(this.FACTORY_ADDRESS, FACTORY_ABI, this.provider);
      const poolAddress = await factory.getPool(token0, token1, fee);

      if (poolAddress === '0x0000000000000000000000000000000000000000') {
        return null; // Pool doesn't exist
      }

      // Get current tick from pool
      const pool = new Contract(poolAddress, POOL_ABI, this.provider);
      const slot0 = await pool.slot0();
      return Number(slot0[1]); // tick is the second element
    } catch (error) {
      console.error(`Error getting current tick for pool ${token0}/${token1}:`, error);
      return null;
    }
  }

  /**
   * Calculate token amounts from liquidity and tick range
   */
  private calculateTokenAmounts(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    currentTick: number,
    decimals0: number,
    decimals1: number
  ): { amount0: string; amount1: string } {
    if (liquidity === 0n) {
      return { amount0: '0', amount1: '0' };
    }

    const Q96 = 2n ** 96n;

    // Calculate sqrt prices from ticks
    const sqrtPriceLower = this.getSqrtRatioAtTick(tickLower);
    const sqrtPriceUpper = this.getSqrtRatioAtTick(tickUpper);
    const sqrtPriceCurrent = this.getSqrtRatioAtTick(currentTick);

    let amount0 = 0n;
    let amount1 = 0n;

    if (currentTick < tickLower) {
      // All liquidity in token0
      amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceLower)) / (sqrtPriceUpper * sqrtPriceLower);
    } else if (currentTick >= tickUpper) {
      // All liquidity in token1
      amount1 = (liquidity * (sqrtPriceUpper - sqrtPriceLower)) / Q96;
    } else {
      // Liquidity is split between both tokens
      amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceCurrent)) / (sqrtPriceUpper * sqrtPriceCurrent);
      amount1 = (liquidity * (sqrtPriceCurrent - sqrtPriceLower)) / Q96;
    }

    // Convert to human-readable format
    const amount0Readable = (Number(amount0) / Math.pow(10, decimals0)).toFixed(6);
    const amount1Readable = (Number(amount1) / Math.pow(10, decimals1)).toFixed(6);

    return {
      amount0: amount0Readable,
      amount1: amount1Readable
    };
  }

  /**
   * Get sqrtPriceX96 from tick
   */
  private getSqrtRatioAtTick(tick: number): bigint {
    const absTick = Math.abs(tick);

    // Constants for tick to sqrt price calculation
    let ratio = (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

    if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
    if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
    if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
    if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
    if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
    if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
    if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
    if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
    if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
    if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
    if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
    if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
    if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
    if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
    if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
    if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
    if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
    if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
    if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

    if (tick > 0) ratio = (1n << 256n) / ratio;

    // Downcast to 160 bits (sqrtPriceX96)
    return ratio >> 32n;
  }

  /**
   * Get token information (symbol, decimals, name) with caching
   */
  private async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; decimals: number; name: string }> {
    // Check in-memory cache first
    const cached = this.tokenInfoCache.get(tokenAddress);
    if (cached) {
      return cached;
    }

    try {
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name()
      ]);
      const tokenInfo = { symbol, decimals: Number(decimals), name };

      // Cache token info (tokens don't change, so cache indefinitely)
      this.tokenInfoCache.set(tokenAddress, tokenInfo);

      return tokenInfo;
    } catch (error) {
      console.error(`Error fetching token info for ${tokenAddress}:`, error);
      return { symbol: 'UNKNOWN', decimals: 18, name: 'Unknown Token' };
    }
  }

  /**
   * Start background updates for tracked addresses
   */
  startBackgroundUpdates(addresses: string[]): void {
    console.log(`Starting background Uniswap positions updates for ${addresses.length} addresses...`);

    // Start background fetch for each address
    for (const address of addresses) {
      const normalizedAddress = address.toLowerCase();
      this.trackedAddresses.add(normalizedAddress);

      // Check if cache exists
      this.persistentCache.readUniswapPositions(normalizedAddress).then((cachedData) => {
        if (!cachedData) {
          console.log(`No positions cache for ${normalizedAddress}, starting background fetch...`);
          this.fetchAndCachePositionsInBackground(normalizedAddress);
        } else {
          console.log(`Positions cache exists for ${normalizedAddress} (${cachedData.recordCount} records, last updated: ${cachedData.lastUpdated})`);

          // Check if cache is stale (older than 1 hour)
          const cacheAge = Date.now() - new Date(cachedData.lastUpdated).getTime();
          if (cacheAge > this.cacheTTL) {
            console.log(`Positions cache is stale (${Math.round(cacheAge / 3600000)}h old), triggering background update...`);
            this.fetchAndCachePositionsInBackground(normalizedAddress);
          }
        }
      }).catch((error) => {
        console.error(`Error checking positions cache for ${normalizedAddress}:`, error);
      });
    }
  }

  /**
   * Get all Uniswap V3 positions for an address
   * Returns cached data immediately, triggers background fetch if cache is missing/stale
   * @param address - EVM address
   * @returns Array of position details
   */
  async getPositions(address: string): Promise<UniswapPosition[]> {
    const normalizedAddress = address.toLowerCase();

    // Check persistent cache first
    const cachedData = await this.persistentCache.readUniswapPositions(normalizedAddress);

    if (cachedData && cachedData.positions) {
      console.log(`Persistent cache hit for positions ${normalizedAddress} (${cachedData.recordCount} records)`);

      // Trigger background update if cache is stale
      const cacheAge = Date.now() - new Date(cachedData.lastUpdated).getTime();
      if (cacheAge > this.cacheTTL && !this.isFetchingInBackground.get(normalizedAddress)) {
        console.log(`Positions cache is ${Math.round(cacheAge / 1000)}s old, triggering background update...`);
        this.fetchAndCachePositionsInBackground(normalizedAddress);
      }

      return cachedData.positions;
    }

    // No cache exists - check if background fetch is already running
    if (this.isFetchingInBackground.get(normalizedAddress)) {
      console.log(`Background fetch in progress for positions ${normalizedAddress}, returning empty...`);
      return [];
    }

    // No cache and no fetch running - start background fetch and return empty
    console.log(`No positions cache for ${normalizedAddress}, starting background fetch...`);
    this.fetchAndCachePositionsInBackground(normalizedAddress);
    return [];
  }

  /**
   * Fetch positions from blockchain (used for both sync and background fetching)
   */
  private async fetchPositions(address: string): Promise<UniswapPosition[]> {
    console.log(`Cache miss for Uniswap positions: ${address}, fetching from blockchain...`);

    try {
      console.log(`Fetching Uniswap V3 positions for ${address}`);

      // Get number of NFTs owned by this address
      const balance = await this.positionManager.balanceOf(address);
      const balanceNum = Number(balance);

      console.log(`Address owns ${balanceNum} Uniswap V3 position NFTs`);

      if (balanceNum === 0) {
        return [];
      }

      // Get all token IDs
      const tokenIds: bigint[] = [];
      for (let i = 0; i < balanceNum; i++) {
        const tokenId = await this.positionManager.tokenOfOwnerByIndex(address, i);
        tokenIds.push(tokenId);
      }

      console.log(`Token IDs: ${tokenIds.join(', ')}`);

      // Get position details for each token ID
      const positionData: Array<{
        tokenId: bigint;
        nonce: bigint;
        operator: string;
        token0: string;
        token1: string;
        fee: bigint;
        tickLower: bigint;
        tickUpper: bigint;
        liquidity: bigint;
        tokensOwed0: bigint;
        tokensOwed1: bigint;
      }> = [];

      // First pass: fetch all position data and uncollected fees
      for (const tokenId of tokenIds) {
        try {
          const position = await this.positionManager.positions(tokenId);
          const [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity,
                 feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1] = position;

          let actualTokensOwed0 = tokensOwed0;
          let actualTokensOwed1 = tokensOwed1;

          // For positions with liquidity, use staticCall to get actual uncollected fees
          if (liquidity > 0n) {
            try {
              const collectParams = {
                tokenId: tokenId,
                recipient: address, // Use the owner's address as recipient for the static call
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128
              };
              const fees = await this.positionManager.collect.staticCall(collectParams);
              actualTokensOwed0 = fees[0];
              actualTokensOwed1 = fees[1];
              console.log(`Position ${tokenId}: Uncollected fees - token0: ${actualTokensOwed0}, token1: ${actualTokensOwed1}`);
            } catch (error) {
              console.error(`Error fetching fees for token ID ${tokenId}:`, error);
              // Fall back to tokensOwed from position struct
            }
          }

          positionData.push({
            tokenId,
            nonce,
            operator,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity,
            tokensOwed0: actualTokensOwed0,
            tokensOwed1: actualTokensOwed1
          });
        } catch (error) {
          console.error(`Error fetching position details for token ID ${tokenId}:`, error);
        }
      }

      // Collect unique token addresses (only for positions with liquidity > 0)
      const uniqueTokens = new Set<string>();
      for (const pos of positionData) {
        if (pos.liquidity > 0n) {
          uniqueTokens.add(pos.token0);
          uniqueTokens.add(pos.token1);
        }
      }

      console.log(`Fetching token info for ${uniqueTokens.size} unique tokens (skipping tokens from 0-liquidity positions)`);

      // Fetch token info for unique tokens in parallel
      const tokenInfoPromises = Array.from(uniqueTokens).map(async (tokenAddress) => {
        const info = await this.getTokenInfo(tokenAddress);
        return { address: tokenAddress, info };
      });
      const tokenInfoResults = await Promise.all(tokenInfoPromises);
      const tokenInfoMap = new Map(tokenInfoResults.map(r => [r.address, r.info]));

      // Collect unique pools and fetch current ticks
      const uniquePools = new Map<string, { token0: string; token1: string; fee: number }>();
      for (const pos of positionData) {
        if (pos.liquidity > 0n) {
          const poolKey = `${pos.token0}-${pos.token1}-${pos.fee}`;
          if (!uniquePools.has(poolKey)) {
            uniquePools.set(poolKey, { token0: pos.token0, token1: pos.token1, fee: Number(pos.fee) });
          }
        }
      }

      console.log(`Fetching current ticks for ${uniquePools.size} unique pools`);

      // Fetch current ticks for all unique pools
      const poolTickPromises = Array.from(uniquePools.entries()).map(async ([poolKey, pool]) => {
        const currentTick = await this.getCurrentTick(pool.token0, pool.token1, pool.fee);
        return { poolKey, currentTick };
      });
      const poolTickResults = await Promise.all(poolTickPromises);
      const poolTickMap = new Map(poolTickResults.map(r => [r.poolKey, r.currentTick]));

      // Second pass: build final position objects with calculated token amounts
      const positions: UniswapPosition[] = [];
      for (const pos of positionData) {
        // For 0-liquidity positions, use placeholder or empty values to avoid fetching token info
        let token0Info, token1Info;
        if (pos.liquidity > 0n) {
          token0Info = tokenInfoMap.get(pos.token0) || { symbol: 'UNKNOWN', decimals: 18, name: 'Unknown' };
          token1Info = tokenInfoMap.get(pos.token1) || { symbol: 'UNKNOWN', decimals: 18, name: 'Unknown' };
        } else {
          // For 0-liquidity positions, use cached info if available, otherwise use empty values
          token0Info = this.tokenInfoCache.get(pos.token0) || { symbol: '', decimals: 18, name: '' };
          token1Info = this.tokenInfoCache.get(pos.token1) || { symbol: '', decimals: 18, name: '' };
        }

        // Convert tokens owed to human-readable format
        const tokensOwed0Readable = (Number(pos.tokensOwed0) / Math.pow(10, token0Info.decimals)).toString();
        const tokensOwed1Readable = (Number(pos.tokensOwed1) / Math.pow(10, token1Info.decimals)).toString();

        // Calculate token amounts from liquidity
        let token0Amount = '0';
        let token1Amount = '0';
        if (pos.liquidity > 0n) {
          const poolKey = `${pos.token0}-${pos.token1}-${pos.fee}`;
          const currentTick = poolTickMap.get(poolKey);
          if (currentTick !== null && currentTick !== undefined) {
            const amounts = this.calculateTokenAmounts(
              pos.liquidity,
              Number(pos.tickLower),
              Number(pos.tickUpper),
              currentTick,
              token0Info.decimals,
              token1Info.decimals
            );
            token0Amount = amounts.amount0;
            token1Amount = amounts.amount1;
          }
        }

        positions.push({
          tokenId: pos.tokenId.toString(),
          nonce: pos.nonce.toString(),
          operator: pos.operator,
          token0: pos.token0,
          token0Symbol: token0Info.symbol,
          token0Decimals: token0Info.decimals,
          token1: pos.token1,
          token1Symbol: token1Info.symbol,
          token1Decimals: token1Info.decimals,
          fee: Number(pos.fee),
          tickLower: Number(pos.tickLower),
          tickUpper: Number(pos.tickUpper),
          liquidity: pos.liquidity.toString(),
          tokensOwed0: tokensOwed0Readable,
          tokensOwed1: tokensOwed1Readable,
          token0Amount,
          token1Amount,
        });

        const liquidityDesc = pos.liquidity > 0n ? `${token0Amount} ${token0Info.symbol} + ${token1Amount} ${token1Info.symbol}` : '0 (closed)';
        console.log(`Position ${pos.tokenId}: ${token0Info.symbol}/${token1Info.symbol} (${Number(pos.fee)/10000}% fee), Liquidity: ${liquidityDesc}`);
      }

      // Cache to persistent storage
      await this.persistentCache.writeUniswapPositions(address, positions);
      console.log(`Cached ${positions.length} positions to persistent storage for ${address}`);

      return positions;
    } catch (error) {
      console.error(`Error fetching Uniswap positions for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Fetch and cache positions in background (non-blocking)
   */
  private fetchAndCachePositionsInBackground(address: string): void {
    if (this.isFetchingInBackground.get(address)) {
      return; // Already fetching
    }

    this.isFetchingInBackground.set(address, true);
    console.log(`Starting background positions fetch for ${address}...`);

    this.fetchPositions(address)
      .then(() => {
        console.log(`Background positions fetch complete for ${address}`);
      })
      .catch((error) => {
        console.error(`Background positions fetch error for ${address}:`, error);
      })
      .finally(() => {
        this.isFetchingInBackground.set(address, false);
      });
  }

}
