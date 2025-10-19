import { Router, Request, Response } from 'express';
import type { TaostatsClient } from '../services/taostats.js';

export function createPriceRouter(taostatsClient: TaostatsClient): Router {
  const router = Router();

  /**
   * GET /api/price/current
   * Returns the current TAO price in plain text format
   */
  router.get('/current', async (_req: Request, res: Response) => {
    try {
      const priceData = await taostatsClient.getCurrentPrice();

      // Return plain text format
      res.type('text/plain');
      res.send(`${priceData.price}`);
    } catch (error) {
      console.error('Error in /current endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching current price');
    }
  });

  /**
   * GET /api/price/historical
   * Returns complete daily historical price of TAO in CSV format
   */
  router.get('/historical', async (_req: Request, res: Response) => {
    try {
      const historicalData = await taostatsClient.getHistoricalPrices();

      // Convert to CSV format
      const csvHeader = 'date,price,volume\n';
      const csvRows = historicalData.map(item =>
        `${item.date},${item.price},${item.volume || ''}`
      ).join('\n');

      const csv = csvHeader + csvRows;

      // Return CSV format
      res.type('text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="tao-historical-prices.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error in /historical endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching historical prices');
    }
  });

  return router;
}
