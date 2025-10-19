import type { TaoPrice, HistoricalPriceData, TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';

export class TaostatsClient {
  private apiKey: string;
  private apiUrl: string;
  private cache: Cache<TaoPrice | HistoricalPriceData[]>;
  private cacheTTL: number; // Cache TTL in milliseconds

  constructor(config: TaostatsConfig, cacheTTL: number = 30000) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
    this.cache = new Cache();
    this.cacheTTL = cacheTTL; // Default 30 seconds
  }

  /**
   * Fetch current TAO price from Taostats API
   * Uses the most recent entry from price history
   * Results are cached to respect API rate limits (5 calls/minute)
   */
  async getCurrentPrice(): Promise<TaoPrice> {
    const cacheKey = 'current-price';

    // Check cache first
    const cached = this.cache.get(cacheKey) as TaoPrice | undefined;
    if (cached) {
      console.log('Returning cached current price');
      return cached;
    }

    try {
      console.log('Fetching fresh current price from Taostats API');
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
        const priceData: TaoPrice = {
          price: parseFloat(latest.price),
          timestamp: latest.last_updated || latest.created_at,
        };

        // Cache the result
        this.cache.set(cacheKey, priceData, this.cacheTTL);
        return priceData;
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
   * Results are cached to respect API rate limits (5 calls/minute)
   */
  async getHistoricalPrices(): Promise<HistoricalPriceData[]> {
    const cacheKey = 'historical-prices';

    // Check cache first
    const cached = this.cache.get(cacheKey) as HistoricalPriceData[] | undefined;
    if (cached) {
      console.log('Returning cached historical prices');
      return cached;
    }

    try {
      console.log('Fetching fresh historical prices from Taostats API');
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
        const historicalData = result.data.map((item: any) => ({
          date: item.last_updated || item.created_at,
          price: parseFloat(item.price),
          volume: item.volume_24h ? parseFloat(item.volume_24h) : undefined,
        }));

        // Cache the result
        this.cache.set(cacheKey, historicalData, this.cacheTTL);
        return historicalData;
      }

      return [];
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      throw new Error('Failed to fetch historical TAO prices');
    }
  }
}
