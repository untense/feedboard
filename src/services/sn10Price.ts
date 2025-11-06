import type { TaostatsConfig } from '../types/index.js';
import { Cache } from './cache.js';

export class SN10PriceClient {
  private cache: Cache<string>;
  private cacheTTL: number;
  private readonly TAOSTATS_API_URL = 'https://api.taostats.io/api/dtao/pool/latest/v1';
  private config: TaostatsConfig;

  constructor(config: TaostatsConfig, cacheTTL: number = 300000) {
    this.config = config;
    this.cache = new Cache<string>();
    this.cacheTTL = cacheTTL; // 5 minutes default (optimized for rate limits)
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
      const response = await fetch(`${this.TAOSTATS_API_URL}?netuid=10`, {
        headers: {
          'Authorization': this.config.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status}`);
      }

      const data: unknown = await response.json();

      // Type guard for API response (structure: { pagination: {...}, data: [...] })
      if (
        !data ||
        typeof data !== 'object' ||
        !('data' in data) ||
        !Array.isArray(data.data) ||
        data.data.length === 0
      ) {
        throw new Error('Invalid pool data returned from Taostats API');
      }

      const poolData = data.data[0];

      // Type guard for pool data
      if (
        !poolData ||
        typeof poolData !== 'object' ||
        !('price' in poolData)
      ) {
        throw new Error('No price field in pool data');
      }

      const price = poolData.price;

      if (!price) {
        throw new Error('Price is null or undefined');
      }

      // Convert to string with reasonable precision
      const priceString = parseFloat(String(price)).toFixed(9);
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
