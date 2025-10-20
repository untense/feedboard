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

export interface TransferRecord {
  from: string;
  to: string;
  amount: string;
  extrinsicId: string;
  blockNumber: number;
  timestamp: string;
}

export interface TransferResponse {
  success: boolean;
  data: {
    pagination: {
      current_page: number;
      per_page: number;
      total_items: number;
      total_pages: number;
      next_page: number | null;
      prev_page: number | null;
    };
    data: TransferRecord[];
  };
}
