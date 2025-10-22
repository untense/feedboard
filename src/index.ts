import express, { Request, Response } from 'express';
import { config } from './config.js';
import { TaostatsClient } from './services/taostats.js';
import { TransferHistoryClient } from './services/transferHistory.js';
import { BalanceClient } from './services/balance.js';
import { createPriceRouter } from './routes/price.js';
import { createTransferRouter } from './routes/transfers.js';
import { createBalanceRouter } from './routes/balance.js';

const app = express();

// Middleware
app.use(express.json());

// Initialize Taostats client with caching
const taostatsClient = new TaostatsClient(config.taostats, config.taostats.cacheTTL);

// Initialize the client (sets up persistent cache and background fetch)
await taostatsClient.init();
console.log('✓ Taostats client initialized with persistent cache');

// Initialize Transfer History client
const transferClient = new TransferHistoryClient(config.taostats, 60000); // 60s cache TTL
console.log('✓ Transfer history client initialized');

// Initialize Balance client
const balanceClient = new BalanceClient(config.taostats, 60000); // 60s cache TTL
console.log('✓ Balance client initialized');

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/price', createPriceRouter(taostatsClient));
app.use('/api/transfers', createTransferRouter(transferClient));
app.use('/api/balance', createBalanceRouter(balanceClient));

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Feedboard',
    description: 'Lightweight application for Bittensor liquidity position observation and management',
    endpoints: {
      health: '/health',
      currentPrice: '/api/price/current',
      historicalPrices: '/api/price/historical',
      transfersSS58In: '/api/transfers/ss58/:address/in',
      transfersSS58Out: '/api/transfers/ss58/:address/out',
      transfersEVMIn: '/api/transfers/evm/:address/in',
      transfersEVMOut: '/api/transfers/evm/:address/out',
      balanceSS58: '/api/balance/ss58/:address',
      balanceEVM: '/api/balance/evm/:address',
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
