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

      // Return just the converted address as plain text
      // If input was SS58, return hex. If input was hex, return SS58.
      const converted = result.inputFormat === 'ss58' ? result.hex : result.ss58;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(converted);
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
