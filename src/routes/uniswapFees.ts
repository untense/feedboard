import { Router, Request, Response } from 'express';
import { UniswapFeesClient } from '../services/uniswapFees.js';
import type { TaostatsConfig } from '../types/index.js';

export function createUniswapFeesRouter(config: TaostatsConfig): Router {
  const router = Router();
  const feesClient = new UniswapFeesClient(config, 3600000); // 1 hour cache TTL (historical data)

  // Initialize persistent cache
  feesClient.init().catch((error) => {
    console.error('Failed to initialize Uniswap fees client:', error);
  });

  /**
   * GET /api/uniswap/fees/:address
   * Get all Uniswap V3 fee collections (WTAO + USDC) for an EVM address, combined by transaction
   */
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Validate address format (basic check for 0x prefix and length)
      if (!address || !address.startsWith('0x') || address.length !== 42) {
        res.status(400).type('text/plain').send('Invalid EVM address format');
        return;
      }

      const feeCollections = await feesClient.getCombinedFeeCollections(address);

      // Return as CSV with combined amounts per transaction
      const csv = [
        'timestamp,wtaoAmount,usdcAmount,transactionHash,blockNumber',
        ...feeCollections.map((fee) =>
          [
            fee.timestamp,
            fee.wtaoAmount,
            fee.usdcAmount,
            fee.transactionHash,
            fee.blockNumber,
          ].join(',')
        ),
      ].join('\n');

      res.type('text/plain').send(csv);
    } catch (error) {
      console.error('Error fetching fee collections:', error);
      res.status(500).type('text/plain').send('Failed to fetch fee collections');
    }
  });

  return router;
}
