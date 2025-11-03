import { Router, Request, Response } from 'express';
import type { AlphaRewardsClient } from '../services/alphaRewards.js';

export function createAlphaRewardsRouter(alphaRewardsClient: AlphaRewardsClient): Router {
  const router = Router();

  /**
   * GET /api/alpha-rewards/:address
   * Returns unclaimed alpha token reward amount for an EVM address in plain text
   */
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Validate address format (basic check for EVM address)
      if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
        res.status(400).type('text/plain').send('Error: Invalid address format. Address must be a valid EVM address (0x...)');
        return;
      }

      const rewards = await alphaRewardsClient.getAlphaRewards(address);

      // Return unclaimed amount as plain text
      // If already claimed, return "0"
      const unclaimedAmount = rewards.isClaimed ? '0' : rewards.amount;

      res.type('text/plain');
      res.send(unclaimedAmount);
    } catch (error) {
      console.error('Error in /alpha-rewards/:address endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      res.status(500).type('text/plain').send(`Error fetching alpha rewards: ${errorMessage}`);
    }
  });

  return router;
}
