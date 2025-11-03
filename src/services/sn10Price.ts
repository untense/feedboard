import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';

export class SN10PriceClient {
  private cache: Cache<string>;
  private cacheTTL: number;
  private readonly TAOSTATS_API_URL = 'https://taostats.io/api/dtao/dtaoSubnets';

  constructor(config: TaostatsConfig, cacheTTL: number = 30000) {
    this.cache = new Cache<string>();
    this.cacheTTL = cacheTTL; // 30 seconds default
  }

  /**
   * Get SN10/TAO price from Taostats API
   * Returns price as a string (TAO per SN10)
   */
  async getSN10Price(): Promise<string> {
    const cacheKey = 'sn10-price';

    // Check cache first
    const cachedPrice = this.cache.get(cacheKey);
    if (cachedPrice) {
      console.log('Cache hit for SN10 price:', cachedPrice);
      return cachedPrice;
    }

    console.log('Cache miss for SN10 price, fetching from Taostats API...');

    try {
      const response = await fetch(`${this.TAOSTATS_API_URL}?netuid=10`);

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        throw new Error('No subnet data returned from Taostats API');
      }

      const subnetData = data.data[0];
      const price = subnetData.price;

      if (!price) {
        throw new Error('No price field in subnet data');
      }

      // Convert to string with reasonable precision
      const priceString = parseFloat(price).toFixed(9);
      console.log(`SN10/TAO price from Taostats: ${priceString}`);

      // Cache the result
      this.cache.set(cacheKey, priceString, this.cacheTTL);

      return priceString;
    } catch (error) {
      console.error('Error fetching SN10 price:', error);
      throw error;
    }
  }
}
