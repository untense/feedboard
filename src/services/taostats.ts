import type { TaoPrice, HistoricalPriceData, TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';
import { PersistentCache } from './persistentCache.js';

export class TaostatsClient {
  private apiKey: string;
  private apiUrl: string;
  private cache: Cache<TaoPrice | HistoricalPriceData[]>;
  private persistentCache: PersistentCache;
  private cacheTTL: number; // Cache TTL in milliseconds
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 22000; // 22 seconds between requests (12s minimum + 10s cushion for 5 calls/minute rate limit)
  private isFetchingInBackground: boolean = false;

  constructor(config: TaostatsConfig, cacheTTL: number = 30000) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
    this.cache = new Cache();
    this.persistentCache = new PersistentCache();
    this.cacheTTL = cacheTTL; // Default 30 seconds
  }

  /**
   * Initialize the client (must be called before use)
   */
  async init(): Promise<void> {
    await this.persistentCache.init();
    // Start background fetch process
    this.startBackgroundFetch();
  }

  /**
   * Enforce rate limiting by waiting if needed before making an API request
   * Taostats API rate limit: 5 calls/minute = 1 call every 12 seconds
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`Rate limiting: waiting ${Math.round(waitTime / 1000)}s before next API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
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
      await this.enforceRateLimit();

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
   * Fetch historical TAO price data - returns cached CSV data immediately
   * Background process continuously fetches missing data
   */
  async getHistoricalPrices(): Promise<HistoricalPriceData[]> {
    try {
      // Return cached data from disk
      const cachedData = await this.persistentCache.readPriceData();
      if (cachedData.length > 0) {
        console.log(`Serving ${cachedData.length} cached records`);
        return cachedData;
      }

      // If no cache exists, fetch first page synchronously
      console.log('No cache found, fetching initial data...');
      await this.fetchAndCachePage(1);
      return await this.persistentCache.readPriceData();
    } catch (error) {
      console.error('Error reading historical prices:', error);
      throw new Error('Failed to fetch historical TAO prices');
    }
  }

  /**
   * Fetch a single page and cache it
   */
  private async fetchAndCachePage(page: number): Promise<boolean> {
    try {
      await this.enforceRateLimit();

      const limit = 200; // API max is 200
      console.log(`Fetching page ${page}...`);

      const response = await fetch(
        `${this.apiUrl}/api/price/history/v1?asset=TAO&page=${page}&limit=${limit}`,
        {
          headers: {
            'Authorization': this.apiKey,
            'accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.warn(`Failed to fetch page ${page}: ${response.status} ${response.statusText}`);
        return false;
      }

      const pageResult = await response.json() as any;
      if (!pageResult.data || pageResult.data.length === 0) {
        console.log(`Page ${page} has no data`);
        return false;
      }

      // August 1, 2025 00:00:00 UTC - cutoff date for historical data
      const cutoffDate = new Date('2025-08-01T00:00:00Z');

      // Group by day - keep only the latest record for each day
      const dailyPrices = new Map<string, HistoricalPriceData>();

      let reachedTarget = false;
      for (const item of pageResult.data) {
        const timestamp = new Date(item.last_updated || item.created_at);
        const dateStr = timestamp.toISOString().split('T')[0];

        // Check if we've reached the target date
        if (timestamp < cutoffDate) {
          reachedTarget = true;
          continue; // Skip records before August 2025
        }

        const currentData = {
          date: dateStr,
          price: parseFloat(item.price),
          volume: item.volume_24h ? parseFloat(item.volume_24h) : undefined,
        };

        // Keep the record with the highest price (likely the closing price)
        const existing = dailyPrices.get(dateStr);
        if (!existing || currentData.price > existing.price) {
          dailyPrices.set(dateStr, currentData);
        }
      }

      const pageData = Array.from(dailyPrices.values());
      await this.persistentCache.updateWithPageData(page, pageData, reachedTarget);

      return !reachedTarget; // Continue if we haven't reached target
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      return false;
    }
  }

  /**
   * Start background fetch process to fill in missing data
   */
  private startBackgroundFetch(): void {
    // Run background fetch after a short delay
    setTimeout(() => this.backgroundFetchLoop(), 5000);
  }

  /**
   * Background loop that continuously fetches missing pages
   */
  private async backgroundFetchLoop(): Promise<void> {
    if (this.isFetchingInBackground) return;

    this.isFetchingInBackground = true;

    try {
      while (true) {
        const nextPage = await this.persistentCache.getNextPageToFetch();

        if (nextPage === -1) {
          console.log('Background fetch complete: Reached target date (August 1, 2025)');
          break;
        }

        console.log(`Background fetch: Starting page ${nextPage}`);
        const shouldContinue = await this.fetchAndCachePage(nextPage);

        if (!shouldContinue) {
          console.log('Background fetch complete: Reached target date');
          // Mark as complete in metadata
          const metadata = await this.persistentCache.readMetadata();
          if (metadata) {
            metadata.reachedTargetDate = true;
            await this.persistentCache.writeMetadata(metadata);
          }
          break;
        }
      }
    } catch (error) {
      console.error('Background fetch error:', error);
    } finally {
      this.isFetchingInBackground = false;
    }
  }
}
