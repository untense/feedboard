import { Router, Request, Response } from 'express';
import type { SN10PriceClient } from '../services/sn10Price.js';

export function createSN10PriceRouter(sn10PriceClient: SN10PriceClient): Router {
  const router = Router();

  /**
   * GET /api/sn10/price
   * Returns current SN10/TAO price from Taostats API as plain text
   */
  router.get('/price', async (req: Request, res: Response) => {
    try {
      const price = await sn10PriceClient.getSN10Price();

      res.type('text/plain');
      res.send(price);
    } catch (error) {
      console.error('Error in /sn10/price endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      res.status(500).type('text/plain').send(`Error fetching SN10 price: ${errorMessage}`);
    }
  });

  return router;
}
