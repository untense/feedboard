import { Router, Request, Response } from 'express';
import type { BalanceClient } from '../services/balance.js';

export function createBalanceRouter(balanceClient: BalanceClient): Router {
  const router = Router();

  /**
   * GET /api/balance/ss58/:address
   * Returns balance for an SS58 address in plain text (TAO)
   */
  router.get('/ss58/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const balance = await balanceClient.getBalance(address);

      // Return as plain text
      res.type('text/plain');
      res.send(balance);
    } catch (error) {
      console.error('Error in /ss58/:address endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';
      res.status(500).type('text/plain').send(`Error fetching balance: ${errorMessage}\nDetails: ${JSON.stringify(errorDetails)}`);
    }
  });

  /**
   * GET /api/balance/evm/:address
   * Returns balance for an EVM H160 address in plain text (TAO)
   * Converts EVM address to SS58 mirror and queries balance
   */
  router.get('/evm/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const balance = await balanceClient.getBalance(address);

      // Return as plain text
      res.type('text/plain');
      res.send(balance);
    } catch (error) {
      console.error('Error in /evm/:address endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';
      res.status(500).type('text/plain').send(`Error fetching balance: ${errorMessage}\nDetails: ${JSON.stringify(errorDetails)}`);
    }
  });

  return router;
}
