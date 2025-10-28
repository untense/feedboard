import { Router, Request, Response } from 'express';
import { UniswapFeesClient } from '../services/uniswapFees.js';
import type { TaostatsConfig } from '../types/index.js';

export function createUniswapFeesRouter(config: TaostatsConfig): Router {
  const router = Router();
  const feesClient = new UniswapFeesClient(config, 60000); // 60s cache TTL

  /**
   * GET /api/uniswap/fees/:address
   * Get all Uniswap V3 fee collections (TAO + USDC) for an EVM address
   */
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Validate address format (basic check for 0x prefix and length)
      if (!address || !address.startsWith('0x') || address.length !== 42) {
        res.status(400).type('text/plain').send('Invalid EVM address format');
        return;
      }

      const feeCollections = await feesClient.getFeeCollections(address);

      // Return as CSV
      const csv = [
        'timestamp,token,amount,transactionHash,blockNumber',
        ...feeCollections.map((fee) =>
          [
            fee.timestamp,
            fee.token,
            fee.amount,
            fee.transactionHash,
            fee.blockNumber,
          ].join(',')
        ),
      ].join('\n');

      res.type('text/csv').send(csv);
    } catch (error) {
      console.error('Error fetching fee collections:', error);
      res.status(500).type('text/plain').send('Failed to fetch fee collections');
    }
  });

  return router;
}
