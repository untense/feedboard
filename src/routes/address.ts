import type { Request, Response, NextFunction } from 'express';
import { AddressConverter } from '../services/addressConverter.js';

export function createAddressRoutes() {
  const converter = new AddressConverter();

  /**
   * GET /api/address/convert/:address
   * Convert between SS58 and hex address formats
   */
  async function convertAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const { address } = req.params;

      if (!address) {
        res.status(400).json({ error: 'Address parameter is required' });
        return;
      }

      const result = converter.convert(address);

      // Return as plain text CSV format
      const csv = `input,inputFormat,ss58,hex\n${result.input},${result.inputFormat},${result.ss58},${result.hex}`;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(csv);
    } catch (error) {
      console.error('Error in convertAddress route:', error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        next(error);
      }
    }
  }

  return {
    convertAddress
  };
}
