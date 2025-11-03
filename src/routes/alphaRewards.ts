import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import type { AlphaRewardsClient } from '../services/alphaRewards.js';

export function createAlphaRewardsRouter(alphaRewardsClient: AlphaRewardsClient): Router {
  const router = Router();

  /**
   * DELETE /api/alpha-rewards/:address/cache
   * Clears the cached rewards data for an address
   */
  router.delete('/:address/cache', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;

      // Validate address format
      if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
        res.status(400).type('text/plain').send('Error: Invalid address format');
        return;
      }

      const normalizedAddress = address.toLowerCase();
      const cacheDir = path.join('./data/cache/alpha_rewards');
      const cacheFile = path.join(cacheDir, `${normalizedAddress}.json`);

      try {
        await fs.unlink(cacheFile);
        res.type('text/plain').send(`Cache cleared for ${address}`);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          res.type('text/plain').send(`No cache found for ${address}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).type('text/plain').send(`Error clearing cache: ${errorMessage}`);
    }
  });

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
