import { TaoStatsClient } from '@taostats/sdk';
import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { TOKENS, type TokenInfo } from '../config/tokens.js';

export interface TokenTransferRecord {
  from: string;
  to: string;
  amount: string;
  token: string;
  tokenContract: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: string;
}

export class TokenTransferClient {
  private client: TaoStatsClient;
  private cache: Cache<TokenTransferRecord[]>;
  private cacheTTL: number;

  // ERC-20 Transfer event signature
  private readonly TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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
   * Pad address to 32 bytes (64 hex chars) for topic filtering
   */
  private padAddress(address: string): string {
    // Remove 0x prefix if present
    const addr = address.toLowerCase().replace('0x', '');
    // Pad to 64 characters (32 bytes)
    return '0x' + addr.padStart(64, '0');
  }

  /**
   * Get token info by contract address (case-insensitive)
   */
  private getTokenByContract(contractAddress: string): TokenInfo | null {
    const normalizedAddress = contractAddress.toLowerCase();
    for (const token of Object.values(TOKENS)) {
      if (token.contractAddress?.toLowerCase() === normalizedAddress) {
        return token;
      }
    }
    return null;
  }

  /**
   * Parse transfer amount from log data (hex string to decimal) and convert to human-readable format
   */
  private parseAmount(hexAmount: string, decimals: number): string {
    const rawAmount = BigInt(hexAmount);
    const divisor = BigInt(10 ** decimals);
    const wholePart = rawAmount / divisor;
    const fractionalPart = rawAmount % divisor;

    // Convert to string with proper decimal places
    const result = wholePart.toString() + '.' + fractionalPart.toString().padStart(decimals, '0');

    // Clean up trailing zeros
    return parseFloat(result).toString();
  }

  /**
   * Extract address from padded topic
   */
  private extractAddress(paddedTopic: string): string {
    // Remove 0x and padding, keep last 40 characters (20 bytes)
    return '0x' + paddedTopic.slice(-40);
  }

  /**
   * Get EVM token transfers for a given address and token contract
   * @param address - The EVM address
   * @param tokenContract - The token contract address (e.g., USDC)
   * @param direction - Filter by 'in' (incoming), 'out' (outgoing), or 'all'
   * @param limit - Maximum number of records to return (default 1000)
   */
  async getEvmTokenTransfers(
    address: string,
    tokenContract: string,
    direction: 'in' | 'out' | 'all' = 'all',
    limit: number = 1000
  ): Promise<TokenTransferRecord[]> {
    const cacheKey = `evm-token-${tokenContract}-${address}-${direction}-${limit}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for ${cacheKey}`);
      return cached;
    }

    console.log(`Cache miss for ${cacheKey}, fetching from API...`);

    try {
      // Pad the address for topic filtering
      const paddedAddress = this.padAddress(address);

      // Query EVM logs with Transfer event topic and address filter
      const params: any = {
        address: tokenContract,
        topic0: this.TRANSFER_TOPIC,
        limit,
        page: 1,
      };

      // Add topic filters based on direction
      if (direction === 'in') {
        // topic2 is the 'to' address for Transfer events
        params.topic2 = paddedAddress;
      } else if (direction === 'out') {
        // topic1 is the 'from' address for Transfer events
        params.topic1 = paddedAddress;
      }

      const response = await (this.client as any).httpClient.get('/api/evm/log/v1', params);

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch EVM token transfers');
      }

      const logs = response.data.data || [];
      console.log(`Received ${logs.length} EVM token transfer logs from API`);

      // Look up token info to get decimals and symbol
      const tokenInfo = this.getTokenByContract(tokenContract);
      const decimals = tokenInfo?.decimals ?? 18; // Default to 18 decimals if unknown
      const tokenSymbol = tokenInfo?.symbol ?? 'UNKNOWN';

      console.log(`Token info for ${tokenContract}: ${tokenSymbol} (${decimals} decimals)`);

      // Parse logs into transfer records
      let transfers: TokenTransferRecord[] = logs
        .map((log: any) => {
          try {
            // Extract addresses from topics
            const from = this.extractAddress(log.topic1 || '');
            const to = this.extractAddress(log.topic2 || '');

            // Parse amount from data field and convert to human-readable format
            const amount = this.parseAmount(log.data || '0x0', decimals);

            return {
              from,
              to,
              amount,
              token: tokenSymbol,
              tokenContract: log.address || tokenContract,
              transactionHash: log.transaction_hash || '',
              blockNumber: log.block_number || 0,
              timestamp: log.timestamp || log.created_at || '',
            };
          } catch (error) {
            console.error('Error parsing log:', error, log);
            return null;
          }
        })
        .filter((t: any) => t !== null);

      // Additional client-side filtering if needed (for 'all' direction)
      if (direction === 'all') {
        const normalizedAddress = address.toLowerCase();
        transfers = transfers.filter(
          (t) =>
            t.from.toLowerCase() === normalizedAddress ||
            t.to.toLowerCase() === normalizedAddress
        );
      }

      console.log(`Parsed ${transfers.length} token transfers for ${address}`);

      // Cache the result
      this.cache.set(cacheKey, transfers, this.cacheTTL);

      return transfers;
    } catch (error) {
      console.error('Error fetching EVM token transfers:', error);
      throw error;
    }
  }

  /**
   * Get incoming EVM token transfers
   */
  async getIncomingEvmTokenTransfers(
    address: string,
    tokenContract: string,
    limit: number = 1000
  ): Promise<TokenTransferRecord[]> {
    return this.getEvmTokenTransfers(address, tokenContract, 'in', limit);
  }

  /**
   * Get outgoing EVM token transfers
   */
  async getOutgoingEvmTokenTransfers(
    address: string,
    tokenContract: string,
    limit: number = 1000
  ): Promise<TokenTransferRecord[]> {
    return this.getEvmTokenTransfers(address, tokenContract, 'out', limit);
  }
}
