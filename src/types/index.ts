export interface TaoPrice {
  price: number;
  timestamp: string;
}

export interface HistoricalPriceData {
  date: string;
  price: number;
  volume?: number;
}

export interface TaostatsConfig {
  apiKey: string;
  apiUrl: string;
}
