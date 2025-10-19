import express, { Request, Response } from 'express';
import { config } from './config.js';
import { TaostatsClient } from './services/taostats.js';
import { createPriceRouter } from './routes/price.js';

const app = express();

// Middleware
app.use(express.json());

// Initialize Taostats client with caching
const taostatsClient = new TaostatsClient(config.taostats, config.taostats.cacheTTL);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/price', createPriceRouter(taostatsClient));

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Feedboard',
    description: 'Lightweight time-series application for accessing the Taostats.io API',
    endpoints: {
      health: '/health',
      currentPrice: '/api/price/current',
      historicalPrices: '/api/price/historical',
    },
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`🚀 Feedboard server running on port ${PORT}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Cache TTL: ${config.taostats.cacheTTL}ms`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Current price: http://localhost:${PORT}/api/price/current`);
  console.log(`   Historical prices: http://localhost:${PORT}/api/price/historical`);
});
