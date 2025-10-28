import type { Request, Response, NextFunction } from 'express';
import { UniswapPositionsClient } from '../services/uniswapPositions.js';
import type { TaostatsConfig } from '../types/index.js';

export function createUniswapPositionsRoutes(config: TaostatsConfig) {
  const client = new UniswapPositionsClient(config);

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

      res.json({
        address,
        positionCount: positions.length,
        positions
      });
    } catch (error) {
      console.error('Error in getPositions route:', error);
      next(error);
    }
  }

  return {
    getPositions
  };
}
