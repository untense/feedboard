import type { Request, Response, NextFunction } from 'express';
import { UniswapPositionsClient } from '../services/uniswapPositions.js';
import type { TaostatsConfig } from '../types/index.js';

export function createUniswapPositionsRoutes(config: TaostatsConfig) {
  const client = new UniswapPositionsClient(config, 3600000); // 1 hour cache TTL

  // Initialize persistent cache and start background updates
  client.init().then(() => {
    // Pre-fetch positions for known addresses in background
    const trackedAddresses = [
      '0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8', // Add your tracked addresses here
    ];
    client.startBackgroundUpdates(trackedAddresses);
  }).catch((error) => {
    console.error('Failed to initialize Uniswap positions client:', error);
  });

  /**
   * GET /api/uniswap/positions/:address
   * Get all Uniswap V3 positions for an EVM address
   */
  async function getPositions(req: Request, res: Response, next: NextFunction) {
    try {
      const { address } = req.params;

      if (!address) {
        res.status(400).json({ error: 'Address parameter is required' });
        return;
      }

      // Validate EVM address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        res.status(400).json({ error: 'Invalid EVM address format' });
        return;
      }

      const positions = await client.getPositions(address);

      // Convert to CSV format
      const csvHeader = 'tokenId,operator,token0,token0Symbol,token0Decimals,token1,token1Symbol,token1Decimals,fee,tickLower,tickUpper,token0Amount,token1Amount,tokensOwed0,tokensOwed1\n';
      const csvRows = positions.map(p =>
        `${p.tokenId},${p.operator},${p.token0},${p.token0Symbol},${p.token0Decimals},${p.token1},${p.token1Symbol},${p.token1Decimals},${p.fee},${p.tickLower},${p.tickUpper},${p.token0Amount || '0'},${p.token1Amount || '0'},${p.tokensOwed0},${p.tokensOwed1}`
      ).join('\n');

      const csv = csvHeader + csvRows;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(csv);
    } catch (error) {
      console.error('Error in getPositions route:', error);
      next(error);
    }
  }

  return {
    client,
    getPositions
  };
}
