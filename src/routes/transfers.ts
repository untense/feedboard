import { Router, Request, Response } from 'express';
import type { TransferHistoryClient } from '../services/transferHistory.js';

export function createTransferRouter(transferClient: TransferHistoryClient): Router {
  const router = Router();

  /**
   * Helper function to convert transfers to CSV format
   */
  function transfersToCSV(transfers: any[]): string {
    const csvHeader = 'timestamp,from,to,amount,extrinsicId,blockNumber\n';
    const csvRows = transfers.map(t =>
      `${t.timestamp},${t.from},${t.to},${t.amount},${t.extrinsicId || ''},${t.blockNumber || ''}`
    ).join('\n');
    return csvHeader + csvRows;
  }

  /**
   * GET /api/transfers/ss58/:address/in
   * Returns incoming transfers for an SS58 address in CSV format
   */
  router.get('/ss58/:address/in', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const transfers = await transferClient.getIncomingTransfers(address);

      const csv = transfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /ss58/:address/in endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching incoming transfers');
    }
  });

  /**
   * GET /api/transfers/ss58/:address/out
   * Returns outgoing transfers for an SS58 address in CSV format
   */
  router.get('/ss58/:address/out', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const transfers = await transferClient.getOutgoingTransfers(address);

      const csv = transfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /ss58/:address/out endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching outgoing transfers');
    }
  });

  /**
   * GET /api/transfers/evm/:address/in
   * Returns incoming transfers for an EVM H160 address in CSV format
   */
  router.get('/evm/:address/in', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const transfers = await transferClient.getIncomingTransfers(address);

      const csv = transfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /evm/:address/in endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching incoming transfers');
    }
  });

  /**
   * GET /api/transfers/evm/:address/out
   * Returns outgoing transfers for an EVM H160 address in CSV format
   */
  router.get('/evm/:address/out', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const transfers = await transferClient.getOutgoingTransfers(address);

      const csv = transfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /evm/:address/out endpoint:', error);
      res.status(500).type('text/plain').send('Error fetching outgoing transfers');
    }
  });

  return router;
}
