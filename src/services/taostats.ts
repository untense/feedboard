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
   */
  async getCurrentPrice(): Promise<TaoPrice> {
    try {
      // TODO: Replace with actual Taostats API endpoint once confirmed
      const response = await fetch(`${this.apiUrl}/price/current`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Adapt response to our interface
      return {
        price: data.price || data.value || 0,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error fetching current price:', error);
      throw new Error('Failed to fetch current TAO price');
    }
  }

  /**
   * Fetch historical TAO price data from Taostats API
   */
  async getHistoricalPrices(): Promise<HistoricalPriceData[]> {
    try {
      // TODO: Replace with actual Taostats API endpoint once confirmed
      const response = await fetch(`${this.apiUrl}/price/historical`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Taostats API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Adapt response to our interface
      if (Array.isArray(data)) {
        return data.map(item => ({
          date: item.date || item.timestamp,
          price: item.price || item.value || 0,
          volume: item.volume,
        }));
      }

      if (data.prices && Array.isArray(data.prices)) {
        return data.prices.map((item: any) => ({
          date: item.date || item.timestamp,
          price: item.price || item.value || 0,
          volume: item.volume,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      throw new Error('Failed to fetch historical TAO prices');
    }
  }
}
