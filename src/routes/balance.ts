import { Router, Request, Response } from 'express';
import type { BalanceClient } from '../services/balance.js';
import type { TokenBalanceClient } from '../services/tokenBalance.js';
import { getSupportedTokens } from '../config/tokens.js';

export function createBalanceRouter(
  balanceClient: BalanceClient,
  tokenBalanceClient: TokenBalanceClient
): Router {
  const router = Router();

  /**
   * GET /api/balance/ss58/:address
   * Returns native TAO balance for an SS58 address in plain text
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
   * GET /api/balance/evm/:currency/:address
   * Returns balance for an EVM H160 address in plain text
   * - currency: 'tao' for native TAO, 'usdc' for USDC token, etc.
   * - address: EVM H160 address
   */
  router.get('/evm/:currency/:address', async (req: Request, res: Response) => {
    try {
      const { currency, address } = req.params;
      const currencyLower = currency.toLowerCase();

      // For native TAO, use the BalanceClient (converts EVM to SS58 mirror)
      if (currencyLower === 'tao') {
        const balance = await balanceClient.getBalance(address);
        res.type('text/plain');
        res.send(balance);
        return;
      }

      // For tokens (USDC, etc.), use the TokenBalanceClient
      const balance = await tokenBalanceClient.getTokenBalance(currencyLower, address);
      res.type('text/plain');
      res.send(balance);
    } catch (error) {
      console.error(`Error in /evm/:currency/:address endpoint:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';

      // Check if it's an unsupported token error
      if (errorMessage.includes('Unsupported token')) {
        const supported = getSupportedTokens();
        res.status(400).type('text/plain').send(
          `${errorMessage}\nSupported currencies: ${supported.join(', ')}`
        );
        return;
      }

      res.status(500).type('text/plain').send(`Error fetching balance: ${errorMessage}\nDetails: ${JSON.stringify(errorDetails)}`);
    }
  });

  return router;
}
