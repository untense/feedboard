import type { TaoPrice, HistoricalPriceData, TaostatsConfig } from '../types/index.js';

export class TaostatsClient {
  private apiKey: string;
  private apiUrl: string;

  constructor(config: TaostatsConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
  }

  /**
   * Fetch current TAO price from Taostats API
   * Uses the most recent entry from price history
   */
  async getCurrentPrice(): Promise<TaoPrice> {
    try {
      const response = await fetch(
        `${this.apiUrl}/api/price/history/v1?asset=TAO&page=1&limit=1`,
        {
          headers: {
            'Authorization': this.apiKey,
            'accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // The API returns the most recent price as the first item
      if (result.data && result.data.length > 0) {
        const latest = result.data[0];
        return {
          price: parseFloat(latest.price),
          timestamp: latest.last_updated || latest.created_at,
        };
      }

      throw new Error('No price data available');
    } catch (error) {
      console.error('Error fetching current price:', error);
      throw new Error('Failed to fetch current TAO price');
    }
  }

  /**
   * Fetch historical TAO price data from Taostats API
   * Fetches all available historical price data (paginated)
   */
  async getHistoricalPrices(): Promise<HistoricalPriceData[]> {
    try {
      // For now, fetch a large batch. Could be enhanced to fetch all pages.
      const response = await fetch(
        `${this.apiUrl}/api/price/history/v1?asset=TAO&page=1&limit=1000`,
        {
          headers: {
            'Authorization': this.apiKey,
            'accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Map the API response to our interface
      if (result.data && Array.isArray(result.data)) {
        return result.data.map((item: any) => ({
          date: item.last_updated || item.created_at,
          price: parseFloat(item.price),
          volume: item.volume_24h ? parseFloat(item.volume_24h) : undefined,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      throw new Error('Failed to fetch historical TAO prices');
    }
  }
}
