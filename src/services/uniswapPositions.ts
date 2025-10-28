import { JsonRpcProvider, Contract } from 'ethers';
import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';

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
  private tokenInfoCache: Map<string, { symbol: string; decimals: number; name: string }> = new Map();
  private cacheTTL: number;

  // TaoFi Uniswap V3 NonfungiblePositionManager on Bittensor EVM
  private readonly POSITION_MANAGER_ADDRESS = '0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25';
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  constructor(config: TaostatsConfig, cacheTTL: number = 300000) {
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL);
    this.positionManager = new Contract(
      this.POSITION_MANAGER_ADDRESS,
      POSITION_MANAGER_ABI,
      this.provider
    );
    this.cache = new Cache<UniswapPosition[]>();
    this.cacheTTL = cacheTTL; // 5 minutes default
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
   * Get all Uniswap V3 positions for an address
   * @param address - EVM address
   * @returns Array of position details
   */
  async getPositions(address: string): Promise<UniswapPosition[]> {
    const cacheKey = `uniswap-positions-${address.toLowerCase()}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for Uniswap positions: ${address}`);
      return cached;
    }

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

      // Second pass: build final position objects
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
        });

        const liquidityDesc = pos.liquidity > 0n ? pos.liquidity.toString() : '0 (closed)';
        console.log(`Position ${pos.tokenId}: ${token0Info.symbol}/${token1Info.symbol} (${Number(pos.fee)/10000}% fee), Liquidity: ${liquidityDesc}`);
      }

      // Cache the results
      this.cache.set(cacheKey, positions, this.cacheTTL);
      console.log(`Cached ${positions.length} positions for ${address} (TTL: ${this.cacheTTL}ms)`);

      return positions;
    } catch (error) {
      console.error(`Error fetching Uniswap positions for ${address}:`, error);
      throw error;
    }
  }
}
