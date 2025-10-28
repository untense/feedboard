import express, { Request, Response } from 'express';
import { config } from './config.js';
import { TaostatsClient } from './services/taostats.js';
import { TransferHistoryClient } from './services/transferHistory.js';
import { BalanceClient } from './services/balance.js';
import { TokenTransferClient } from './services/tokenTransfers.js';
import { TokenBalanceClient } from './services/tokenBalance.js';
import { PersistentCache } from './services/persistentCache.js';
import { createPriceRouter } from './routes/price.js';
import { createTransferRouter } from './routes/transfers.js';
import { createBalanceRouter } from './routes/balance.js';
import { createTokenTransferRouter } from './routes/tokenTransfers.js';
import { createUniswapPositionsRoutes } from './routes/uniswapPositions.js';
import { createUniswapFeesRouter } from './routes/uniswapFees.js';
import { createAddressRoutes } from './routes/address.js';

const app = express();

// Middleware
app.use(express.json());

// Initialize shared persistent cache
const persistentCache = new PersistentCache();
await persistentCache.init();
console.log('✓ Persistent cache initialized');

// Initialize Taostats client with caching
const taostatsClient = new TaostatsClient(config.taostats, config.taostats.cacheTTL);

// Initialize the client (sets up persistent cache and background fetch)
await taostatsClient.init();
console.log('✓ Taostats client initialized with persistent cache');

// Initialize Transfer History client
const transferClient = new TransferHistoryClient(config.taostats, 60000); // 60s cache TTL
console.log('✓ Transfer history client initialized');

// Initialize Balance client with persistent cache and hourly updates
const balanceClient = new BalanceClient(config.taostats, persistentCache, 3600000); // 1 hour update interval
await balanceClient.init();
console.log('✓ Balance client initialized with persistent cache and hourly updates');

// Initialize Token Balance client with persistent cache and hourly updates
const tokenBalanceClient = new TokenBalanceClient(config.taostats, persistentCache, 3600000); // 1 hour update interval
await tokenBalanceClient.init();
console.log('✓ Token balance client initialized with persistent cache and hourly updates');

// Initialize Token Transfer client
const tokenTransferClient = new TokenTransferClient(config.taostats, 60000); // 60s cache TTL
console.log('✓ Token transfer client initialized');

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/price', createPriceRouter(taostatsClient));
app.use('/api/transfers', createTransferRouter(transferClient));
app.use('/api/balance', createBalanceRouter(balanceClient, tokenBalanceClient));
app.use('/api/token-transfers', createTokenTransferRouter(tokenTransferClient));

// Initialize Uniswap positions client with background updates
const uniswapPositionsRoutes = createUniswapPositionsRoutes(config.taostats);
await uniswapPositionsRoutes.client.init();
console.log('✓ Uniswap positions client initialized with background updates');

app.get('/api/uniswap/positions/:address', uniswapPositionsRoutes.getPositions);

// Uniswap fee collections route
app.use('/api/uniswap/fees', createUniswapFeesRouter(config.taostats));

// Address conversion route
const addressRoutes = createAddressRoutes();
app.get('/api/address/convert/:address', addressRoutes.convertAddress);

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
      balanceEVM: '/api/balance/evm/:currency/:address (currency: tao, usdc, etc.)',
      tokenTransfersEVMIn: '/api/token-transfers/evm/:tokenSymbol/:address/in (tokenSymbol: usdc, etc.)',
      tokenTransfersEVMOut: '/api/token-transfers/evm/:tokenSymbol/:address/out (tokenSymbol: usdc, etc.)',
      tokenTransfersSS58In: '/api/token-transfers/ss58/:tokenId/:address/in (not yet implemented)',
      tokenTransfersSS58Out: '/api/token-transfers/ss58/:tokenId/:address/out (not yet implemented)',
      uniswapPositions: '/api/uniswap/positions/:address',
      uniswapFees: '/api/uniswap/fees/:address',
      addressConvert: '/api/address/convert/:address',
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
