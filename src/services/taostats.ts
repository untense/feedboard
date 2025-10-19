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

      const result = await response.json() as any;

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
   * Returns daily closing prices starting from August 2025
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

      // August 1, 2025 00:00:00 UTC in Unix timestamp
      const timestampStart = 1753981200;
      const limit = 200; // API max is 200
      const allData: any[] = [];

      // Get first page to determine total pages needed
      const firstResponse = await fetch(
        `${this.apiUrl}/api/price/history/v1?asset=TAO&timestamp_start=${timestampStart}&page=1&limit=${limit}`,
        {
          headers: {
            'Authorization': this.apiKey,
            'accept': 'application/json',
          },
        }
      );

      if (!firstResponse.ok) {
        throw new Error(`Taostats API error: ${firstResponse.status} ${firstResponse.statusText}`);
      }

      const firstResult = await firstResponse.json() as any;
      allData.push(...firstResult.data);

      const totalPages = firstResult.pagination?.total_pages || 1;
      console.log(`Fetching ${totalPages} pages of data from August 2025...`);

      // Fetch remaining pages with rate limit consideration
      // Rate limit: 5 calls/minute = 1 call every 12 seconds to be safe
      for (let page = 2; page <= totalPages; page++) {
        // Wait 12 seconds between requests to respect rate limit
        await new Promise(resolve => setTimeout(resolve, 12000));

        const response = await fetch(
          `${this.apiUrl}/api/price/history/v1?asset=TAO&timestamp_start=${timestampStart}&page=${page}&limit=${limit}`,
          {
            headers: {
              'Authorization': this.apiKey,
              'accept': 'application/json',
            },
          }
        );

        if (!response.ok) {
          console.warn(`Failed to fetch page ${page}, stopping pagination`);
          break;
        }

        const pageResult = await response.json() as any;
        if (!pageResult.data || pageResult.data.length === 0) break;

        allData.push(...pageResult.data);
        console.log(`Fetched page ${page}/${totalPages}`);
      }

      // Group by day - keep only the latest record for each day
      const dailyPrices = new Map<string, HistoricalPriceData>();

      allData.forEach((item: any) => {
        const timestamp = new Date(item.last_updated || item.created_at);
        const dateStr = timestamp.toISOString().split('T')[0];

        const currentData = {
          date: dateStr,
          price: parseFloat(item.price),
          volume: item.volume_24h ? parseFloat(item.volume_24h) : undefined,
        };

        // Keep the record with the latest timestamp for each day
        const existing = dailyPrices.get(dateStr);
        if (!existing || timestamp > new Date(existing.date + 'T23:59:59Z')) {
          dailyPrices.set(dateStr, currentData);
        }
      });

      // Convert to array and sort by date (oldest first)
      const historicalData = Array.from(dailyPrices.values())
        .sort((a, b) => a.date.localeCompare(b.date));

      // Cache the result
      this.cache.set(cacheKey, historicalData, this.cacheTTL);
      console.log(`Fetched ${historicalData.length} daily records from ${historicalData[0]?.date} to ${historicalData[historicalData.length - 1]?.date}`);
      return historicalData;
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      throw new Error('Failed to fetch historical TAO prices');
    }
  }
}
