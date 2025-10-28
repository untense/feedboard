import { JsonRpcProvider, Contract } from 'ethers';
import type { TaostatsConfig } from '../types/index.js';

// Uniswap V3 NonfungiblePositionManager ABI (minimal - only needed functions)
const POSITION_MANAGER_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)'
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

  // TaoFi Uniswap V3 NonfungiblePositionManager on Bittensor EVM
  private readonly POSITION_MANAGER_ADDRESS = '0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25';
  private readonly EVM_RPC_URL = 'https://evm.chain.opentensor.ai';

  constructor(config: TaostatsConfig) {
    this.provider = new JsonRpcProvider(this.EVM_RPC_URL);
    this.positionManager = new Contract(
      this.POSITION_MANAGER_ADDRESS,
      POSITION_MANAGER_ABI,
      this.provider
    );
  }

  /**
   * Get token information (symbol, decimals, name)
   */
  private async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; decimals: number; name: string }> {
    try {
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name()
      ]);
      return { symbol, decimals: Number(decimals), name };
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
      const positions: UniswapPosition[] = [];
      for (const tokenId of tokenIds) {
        try {
          const position = await this.positionManager.positions(tokenId);

          // Position returns a struct with named fields
          const [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity,
                 feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1] = position;

          // Get token info
          const [token0Info, token1Info] = await Promise.all([
            this.getTokenInfo(token0),
            this.getTokenInfo(token1)
          ]);

          // Convert tokens owed to human-readable format
          const tokensOwed0Readable = (Number(tokensOwed0) / Math.pow(10, token0Info.decimals)).toString();
          const tokensOwed1Readable = (Number(tokensOwed1) / Math.pow(10, token1Info.decimals)).toString();

          positions.push({
            tokenId: tokenId.toString(),
            nonce: nonce.toString(),
            operator,
            token0,
            token0Symbol: token0Info.symbol,
            token0Decimals: token0Info.decimals,
            token1,
            token1Symbol: token1Info.symbol,
            token1Decimals: token1Info.decimals,
            fee: Number(fee),
            tickLower: Number(tickLower),
            tickUpper: Number(tickUpper),
            liquidity: liquidity.toString(),
            tokensOwed0: tokensOwed0Readable,
            tokensOwed1: tokensOwed1Readable,
          });

          console.log(`Position ${tokenId}: ${token0Info.symbol}/${token1Info.symbol} (${Number(fee)/10000}% fee), Liquidity: ${liquidity.toString()}`);
        } catch (error) {
          console.error(`Error fetching position details for token ID ${tokenId}:`, error);
        }
      }

      return positions;
    } catch (error) {
      console.error(`Error fetching Uniswap positions for ${address}:`, error);
      throw error;
    }
  }
}
