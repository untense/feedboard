import { Router, Request, Response } from 'express';
import type { AlphaRewardsClient } from '../services/alphaRewards.js';

export function createAlphaRewardsRouter(alphaRewardsClient: AlphaRewardsClient): Router {
  const router = Router();

  /**
   * GET /api/alpha-rewards/:address
   * Returns alpha token rewards for an EVM address
   */
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Validate address format (basic check for EVM address)
      if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
        res.status(400).json({
          error: 'Invalid address format',
          message: 'Address must be a valid EVM address (0x...)',
        });
        return;
      }

      const rewards = await alphaRewardsClient.getAlphaRewards(address);

      // Return as JSON
      res.json({
        success: true,
        address,
        rewards: {
          timestamp: rewards.timestamp,
          netuid: rewards.netuid,
          amount: rewards.amount,
          isClaimed: rewards.isClaimed,
        },
      });
    } catch (error) {
      console.error('Error in /alpha-rewards/:address endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';

      res.status(500).json({
        success: false,
        error: 'Failed to fetch alpha rewards',
        message: errorMessage,
        details: errorDetails,
      });
    }
  });

  return router;
}
