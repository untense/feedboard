import { promises as fs } from 'fs';
import path from 'path';
import type { HistoricalPriceData } from '../types/index.js';

interface PaginationMetadata {
  page: number;
  oldestDate: string;
  newestDate: string;
  recordCount: number;
  timestamp: string;
}

interface CacheMetadata {
  lastUpdated: string;
  oldestDate: string | null;
  newestDate: string | null;
  totalRecords: number;
  pages: PaginationMetadata[];
  lastFetchedPage: number;
  reachedTargetDate: boolean; // Have we reached August 1, 2025?
}

export class PersistentCache {
  private cacheDir: string;
  private csvPath: string;
  private metadataPath: string;

  constructor(cacheDir: string = './data/cache') {
    this.cacheDir = cacheDir;
    this.csvPath = path.join(cacheDir, 'historical_prices.csv');
    this.metadataPath = path.join(cacheDir, 'metadata.json');
  }

  /**
   * Initialize cache directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create cache directory:', error);
      throw error;
    }
  }

  /**
   * Read metadata from disk
   */
  async readMetadata(): Promise<CacheMetadata | null> {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Write metadata to disk
   */
  async writeMetadata(metadata: CacheMetadata): Promise<void> {
    await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * Read cached CSV data
   */
  async readCSV(): Promise<string | null> {
    try {
      return await fs.readFile(this.csvPath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Parse CSV to get array of price data
   */
  async readPriceData(): Promise<HistoricalPriceData[]> {
    const csv = await this.readCSV();
    if (!csv) return [];

    const lines = csv.trim().split('\n');
    if (lines.length <= 1) return []; // Only header or empty

    return lines.slice(1).map(line => {
      const [date, price, volume] = line.split(',');
      return {
        date,
        price: parseFloat(price),
        volume: volume ? parseFloat(volume) : undefined,
      };
    });
  }

  /**
   * Write price data to CSV file
   */
  async writePriceData(data: HistoricalPriceData[]): Promise<void> {
    // Sort by date (oldest first)
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    // Generate CSV content
    const header = 'date,price,volume';
    const rows = sorted.map(item =>
      `${item.date},${item.price},${item.volume || ''}`
    );
    const csv = [header, ...rows].join('\n');

    await fs.writeFile(this.csvPath, csv, 'utf-8');
  }

  /**
   * Merge new price data with existing data (avoiding duplicates)
   */
  async mergePriceData(newData: HistoricalPriceData[]): Promise<HistoricalPriceData[]> {
    const existing = await this.readPriceData();

    // Create a map of existing data by date
    const dataMap = new Map<string, HistoricalPriceData>();
    existing.forEach(item => dataMap.set(item.date, item));

    // Add/update with new data
    newData.forEach(item => {
      const existingItem = dataMap.get(item.date);
      // Keep the record with higher price (likely the closing price)
      if (!existingItem || item.price > existingItem.price) {
        dataMap.set(item.date, item);
      }
    });

    return Array.from(dataMap.values());
  }

  /**
   * Update cache with new page data
   */
  async updateWithPageData(
    pageNumber: number,
    pageData: HistoricalPriceData[],
    reachedTarget: boolean = false
  ): Promise<void> {
    if (pageData.length === 0) return;

    // Merge with existing data
    const mergedData = await this.mergePriceData(pageData);

    // Write merged data to CSV
    await this.writePriceData(mergedData);

    // Update metadata
    const metadata = await this.readMetadata() || {
      lastUpdated: new Date().toISOString(),
      oldestDate: null,
      newestDate: null,
      totalRecords: 0,
      pages: [],
      lastFetchedPage: 0,
      reachedTargetDate: false,
    };

    // Update page metadata
    const sortedPage = [...pageData].sort((a, b) => a.date.localeCompare(b.date));
    const pageMetadata: PaginationMetadata = {
      page: pageNumber,
      oldestDate: sortedPage[0].date,
      newestDate: sortedPage[sortedPage.length - 1].date,
      recordCount: pageData.length,
      timestamp: new Date().toISOString(),
    };

    // Remove existing page metadata if present
    metadata.pages = metadata.pages.filter(p => p.page !== pageNumber);
    metadata.pages.push(pageMetadata);
    metadata.pages.sort((a, b) => a.page - b.page);

    // Update overall metadata
    const sorted = [...mergedData].sort((a, b) => a.date.localeCompare(b.date));
    metadata.oldestDate = sorted[0]?.date || null;
    metadata.newestDate = sorted[sorted.length - 1]?.date || null;
    metadata.totalRecords = mergedData.length;
    metadata.lastFetchedPage = Math.max(metadata.lastFetchedPage, pageNumber);
    metadata.lastUpdated = new Date().toISOString();
    metadata.reachedTargetDate = reachedTarget || metadata.reachedTargetDate;

    await this.writeMetadata(metadata);

    console.log(`Cache updated: Page ${pageNumber} with ${pageData.length} records`);
    console.log(`Total cache: ${metadata.totalRecords} records from ${metadata.oldestDate} to ${metadata.newestDate}`);
  }

  /**
   * Get the next page number to fetch
   */
  async getNextPageToFetch(): Promise<number> {
    const metadata = await this.readMetadata();
    if (!metadata) return 1; // Start from page 1
    if (metadata.reachedTargetDate) return -1; // All done
    return metadata.lastFetchedPage + 1;
  }

  /**
   * Check if we've reached the target date (August 1, 2025)
   */
  hasReachedTargetDate(oldestDate: string): boolean {
    return oldestDate <= '2025-08-01';
  }
}
