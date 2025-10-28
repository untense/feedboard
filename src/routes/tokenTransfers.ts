import { Router, Request, Response } from 'express';
import type { TokenTransferClient } from '../services/tokenTransfers.js';
import { getTokenBySymbol } from '../config/tokens.js';

export function createTokenTransferRouter(tokenTransferClient: TokenTransferClient): Router {
  const router = Router();

  /**
   * Helper function to convert token transfers to CSV format
   */
  function tokenTransfersToCSV(transfers: any[]): string {
    const csvHeader = 'timestamp,from,to,amount,token,tokenContract,transactionHash,blockNumber\n';
    const csvRows = transfers.map(t =>
      `${t.timestamp},${t.from},${t.to},${t.amount},${t.token},${t.tokenContract},${t.transactionHash},${t.blockNumber}`
    ).join('\n');
    return csvHeader + csvRows;
  }

  /**
   * GET /api/token-transfers/evm/:tokenSymbol/:address/in
   * Returns incoming token transfers for an EVM address in CSV format
   * @param tokenSymbol - Token symbol (e.g., "usdc", "wtao")
   */
  router.get('/evm/:tokenSymbol/:address/in', async (req: Request, res: Response) => {
    try {
      const { tokenSymbol, address } = req.params;

      // Look up token by symbol
      const token = getTokenBySymbol(tokenSymbol);
      if (!token) {
        res.status(400).type('text/plain').send(`Unknown token symbol: ${tokenSymbol}. Supported tokens: usdc`);
        return;
      }

      if (!token.contractAddress) {
        res.status(400).type('text/plain').send(`Token ${tokenSymbol} is a native token and does not have ERC-20 transfers. Use /api/transfers endpoints instead.`);
        return;
      }

      const transfers = await tokenTransferClient.getIncomingEvmTokenTransfers(address, token.contractAddress);

      const csv = tokenTransfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /evm/:tokenSymbol/:address/in endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';
      res.status(500).type('text/plain').send(`Error fetching token transfers: ${errorMessage}\nDetails: ${JSON.stringify(errorDetails)}`);
    }
  });

  /**
   * GET /api/token-transfers/evm/:tokenSymbol/:address/out
   * Returns outgoing token transfers for an EVM address in CSV format
   * @param tokenSymbol - Token symbol (e.g., "usdc", "wtao")
   */
  router.get('/evm/:tokenSymbol/:address/out', async (req: Request, res: Response) => {
    try {
      const { tokenSymbol, address } = req.params;

      // Look up token by symbol
      const token = getTokenBySymbol(tokenSymbol);
      if (!token) {
        res.status(400).type('text/plain').send(`Unknown token symbol: ${tokenSymbol}. Supported tokens: usdc`);
        return;
      }

      if (!token.contractAddress) {
        res.status(400).type('text/plain').send(`Token ${tokenSymbol} is a native token and does not have ERC-20 transfers. Use /api/transfers endpoints instead.`);
        return;
      }

      const transfers = await tokenTransferClient.getOutgoingEvmTokenTransfers(address, token.contractAddress);

      const csv = tokenTransfersToCSV(transfers);

      // Return as plain text so it displays in browser
      res.type('text/plain');
      res.send(csv);
    } catch (error) {
      console.error('Error in /evm/:tokenSymbol/:address/out endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetails = (error as any).response || (error as any).statusCode || '';
      res.status(500).type('text/plain').send(`Error fetching token transfers: ${errorMessage}\nDetails: ${JSON.stringify(errorDetails)}`);
    }
  });

  /**
   * GET /api/token-transfers/ss58/:tokenId/:address/in
   * Returns incoming token transfers for an SS58 address in CSV format
   * NOTE: SS58 token transfers not yet implemented - placeholder for future enhancement
   */
  router.get('/ss58/:tokenId/:address/in', async (req: Request, res: Response) => {
    res.status(501).type('text/plain').send('SS58 token transfers not yet implemented. Only EVM token transfers are currently supported.');
  });

  /**
   * GET /api/token-transfers/ss58/:tokenId/:address/out
   * Returns outgoing token transfers for an SS58 address in CSV format
   * NOTE: SS58 token transfers not yet implemented - placeholder for future enhancement
   */
  router.get('/ss58/:tokenId/:address/out', async (req: Request, res: Response) => {
    res.status(501).type('text/plain').send('SS58 token transfers not yet implemented. Only EVM token transfers are currently supported.');
  });

  return router;
}
