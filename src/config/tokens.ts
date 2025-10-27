/**
 * Token registry for Bittensor EVM chain
 * Maps currency symbols to contract addresses and metadata
 */

export interface TokenInfo {
  symbol: string;
  name: string;
  contractAddress: string | null; // null for native TAO
  decimals: number;
}

export const TOKENS: Record<string, TokenInfo> = {
  tao: {
    symbol: 'TAO',
    name: 'Bittensor',
    contractAddress: null, // Native token, no contract
    decimals: 9,
  },
  usdc: {
    symbol: 'USDC',
    name: 'USD Coin',
    contractAddress: '0xB833E8137FEDf80de7E908dc6fea43a029142F20',
    decimals: 6,
  },
};

/**
 * Get token info by symbol (case-insensitive)
 */
export function getTokenBySymbol(symbol: string): TokenInfo | null {
  const key = symbol.toLowerCase();
  return TOKENS[key] || null;
}

/**
 * Get all supported token symbols
 */
export function getSupportedTokens(): string[] {
  return Object.keys(TOKENS).map(k => TOKENS[k].symbol);
}
