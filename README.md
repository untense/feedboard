# Feedboard

Lightweight time-series application for accessing the Taostats.io API in different ways.

## Features

HTTP endpoints for:

- **Price Data**: Current and historical TAO prices in CSV and plain text formats
- **Wallet Balances**: Get TAO balance for SS58 (native) and EVM addresses
- **Transfer History**: View incoming/outgoing TAO transfers for both address types
- **Token Transfers**: Track ERC-20 token transfers (like USDC) on Bittensor EVM chain
- **Uniswap V3 Positions**: View all Uniswap V3 liquidity positions (NFTs) owned by an EVM address

## Prerequisites

- Node.js 20+
- Yarn package manager
- Taostats.io API key (get one at https://dash.taostats.io/)

## Setup

1. Clone the repository:
```bash
git clone git@github.com:untense/feedboard.git
cd feedboard
```

2. Install dependencies:
```bash
yarn install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Add your Taostats API key to the `.env` file:
```
TAOSTATS_API_KEY=your_api_key_here
```

## Development

Start the development server:
```bash
yarn dev
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health Check
```
GET /health
```
Returns server health status.

### Root
```
GET /
```
Returns API information and available endpoints.

### Current Price
```
GET /api/price/current
```
Returns the current price of TAO in plain text format.

**Response:** Plain text number
```
42.50
```

### Historical Prices
```
GET /api/price/historical
```
Returns complete daily historical price of TAO in CSV format.

**Response:** CSV file
```csv
date,price,volume
2024-01-01,35.20,1000000
2024-01-02,36.50,1200000
```

### Wallet Balance

Get wallet balances for both SS58 native addresses and EVM H160 addresses. Supports native TAO and ERC-20 tokens (USDC, etc.).

**SS58 Address (Native TAO only):**
```
GET /api/balance/ss58/:address
```

**EVM Address (TAO and tokens):**
```
GET /api/balance/evm/:currency/:address
```

**Parameters:**
- `currency`: Token symbol (`tao`, `usdc`, etc.)
- `address`: Wallet address (SS58 or EVM H160)

**Response:** Plain text balance in token's base unit
```
123.456789
```

**Examples:**
```bash
# SS58 address - native TAO balance
curl http://localhost:3000/api/balance/ss58/5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ

# EVM address - native TAO balance (via mirror address)
curl http://localhost:3000/api/balance/evm/tao/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8

# EVM address - USDC token balance (via ERC-20 contract)
curl http://localhost:3000/api/balance/evm/usdc/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8
```

**Supported Currencies:**
- `tao` - Native Bittensor token
- `usdc` - USD Coin (ERC-20)

**Features:**
- Persistent cache with hourly background updates
- TAO: Automatic EVM-to-SS58 mirror address conversion via Taostats API
- Tokens: Direct ERC-20 contract queries via Bittensor EVM RPC
- Returns `0` for non-existent accounts

### Transfer History

View incoming and outgoing TAO transfers for a wallet address.

**SS58 Transfers:**
```
GET /api/transfers/ss58/:address/in   # Incoming transfers
GET /api/transfers/ss58/:address/out  # Outgoing transfers
```

**EVM Transfers:**
```
GET /api/transfers/evm/:address/in    # Incoming transfers
GET /api/transfers/evm/:address/out   # Outgoing transfers
```

**Response:** CSV format
```csv
timestamp,from,to,amount,extrinsicId,blockNumber
2024-01-01T12:00:00Z,5ABC...,5XYZ...,10.5,12345-2,100000
```

**Example:**
```bash
# Get incoming TAO transfers for SS58 address
curl http://localhost:3000/api/transfers/ss58/5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ/in

# Get outgoing TAO transfers for EVM address
curl http://localhost:3000/api/transfers/evm/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8/out
```

### Token Transfers (EVM Only)

Track ERC-20 token transfers on the Bittensor EVM chain (e.g., USDC, wrapped tokens).

**EVM Token Transfers:**
```
GET /api/token-transfers/evm/:tokenContract/:address/in   # Incoming token transfers
GET /api/token-transfers/evm/:tokenContract/:address/out  # Outgoing token transfers
```

**Parameters:**
- `tokenContract`: The token contract address (e.g., USDC: `0xB833E8137FEDf80de7E908dc6fea43a029142F20`)
- `address`: The wallet address

**Response:** CSV format
```csv
timestamp,from,to,amount,token,tokenContract,transactionHash,blockNumber
2024-01-01T12:00:00Z,0xABC...,0xXYZ...,1000000,UNKNOWN,0xB833...,0x123...,100000
```

**Example:**
```bash
# Get incoming USDC transfers
curl http://localhost:3000/api/token-transfers/evm/0xB833E8137FEDf80de7E908dc6fea43a029142F20/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8/in

# Get outgoing USDC transfers
curl http://localhost:3000/api/token-transfers/evm/0xB833E8137FEDf80de7E908dc6fea43a029142F20/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8/out
```

**Note:** Token symbol shows as "UNKNOWN" currently. SS58 token transfers not yet implemented (returns HTTP 501).

### Uniswap V3 Positions (EVM Only)

View all Uniswap V3 liquidity positions (NFTs) owned by an EVM address on TaoFi's Uniswap V3 deployment.

**Endpoint:**
```
GET /api/uniswap/positions/:address  # Get all Uniswap V3 positions for an address
```

**Parameters:**
- `address`: EVM wallet address (0x...)

**Response:** CSV format with full position details
```csv
tokenId,operator,token0,token0Symbol,token0Decimals,token1,token1Symbol,token1Decimals,fee,tickLower,tickUpper,liquidity,tokensOwed0,tokensOwed1
1985,0x0000000000000000000000000000000000000000,0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81,WTAO,18,0xB833E8137FEDf80de7E908dc6fea43a029142F20,USDC,6,3000,-216840,-215820,19725191082182810,0,0
2000,0x0000000000000000000000000000000000000000,0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81,WTAO,18,0xB833E8137FEDf80de7E908dc6fea43a029142F20,USDC,6,3000,-217320,-216300,21257572936795013,0,0
```

**Columns:**
- `tokenId`: NFT token ID
- `operator`: Address authorized to manage this position
- `token0`/`token1`: Pool token contract addresses
- `token0Symbol`/`token1Symbol`: Token symbols (e.g., WTAO, USDC)
- `token0Decimals`/`token1Decimals`: Token decimal places
- `fee`: Fee tier in basis points (3000 = 0.3%)
- `tickLower`/`tickUpper`: Price range boundaries in tick space
- `liquidity`: Position liquidity amount
- `tokensOwed0`/`tokensOwed1`: Uncollected fees (human-readable)

**Example:**
```bash
curl http://localhost:3000/api/uniswap/positions/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8
```

**Note:** Queries TaoFi's Uniswap V3 NonfungiblePositionManager contract at `0x61EeA4770d7E15e7036f8632f4bcB33AF1Af1e25` on Bittensor EVM.

### Address Conversion

Convert between SS58 and H160 address formats. Auto-detects input format and returns the converted address.

**Endpoint:**
```
GET /api/address/convert/:address  # Convert between SS58 and H160 formats
```

**Parameters:**
- `address`: Either SS58 or H160 address format

**Response:** Plain text (just the converted address)
```
# Input: SS58 address → Output: H160 address
0x7ea38e1c99d2d92fdd1f389c95dde4030b9c58199c2b54009c08a81c6d3fc007

# Input: H160 address → Output: SS58 address
5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ
```

**Examples:**
```bash
# Convert SS58 to H160
curl http://localhost:3000/api/address/convert/5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ
# Returns: 0x7ea38e1c99d2d92fdd1f389c95dde4030b9c58199c2b54009c08a81c6d3fc007

# Convert H160 to SS58
curl http://localhost:3000/api/address/convert/0x7ea38e1c99d2d92fdd1f389c95dde4030b9c58199c2b54009c08a81c6d3fc007
# Returns: 5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ
```

## Testing

Run the comprehensive test suite:
```bash
./test-all.sh
```

This tests all 14 endpoints including health check, price data, balances (TAO and tokens), transfers, and token transfers.

## Caching and Rate Limiting

### API Rate Limits

The Taostats.io API has a rate limit of **60 calls per minute**. Feedboard implements intelligent caching and rate limiting to ensure:
- Fast response times for users
- Efficient use of API quota
- No rate limit errors

### Persistent File-Based Cache

All data is cached to disk in the `data/cache/` directory:

```
data/
└── cache/
    ├── current_price.json       # Latest TAO price
    ├── historical_prices.csv    # Daily historical prices
    ├── metadata.json            # Pagination and fetch state
    ├── balances.json            # Native TAO balances
    └── token_balances.json      # ERC-20 token balances (USDC, etc.)
```

**Benefits:**
- **Instant responses**: Cached data served immediately (typically <10ms)
- **Persistence**: Cache survives server restarts
- **Background updates**: Data refreshed automatically without blocking requests
- **Rate limit compliance**: Enforces 1.5-second delay between API calls

### Background Update Processes

The application runs several background processes to keep data fresh:

#### Current Price Updates
- Frequency: Every 1 minute
- Automatically updates `current_price.json`
- Users always get fresh price data instantly

#### Historical Price Backfill
- Runs continuously on startup to fetch missing data
- Fetches back to August 1, 2025
- After backfill completes, checks for new data twice per day (every 12 hours)
- Uses pagination to efficiently fetch 200 records per request

#### Balance Updates
- Frequency: Every 1 hour for tracked addresses
- Automatically tracks any address queried via the API
- Updates both native TAO and token balances (USDC, etc.) in background
- Native TAO: Updates via Taostats API
- Token balances: Updates via Bittensor EVM RPC (direct ERC-20 contract queries)
- Stale cache triggers immediate refresh on first request

### Rate Limiting Implementation

All API requests enforce a 1.5-second delay between calls:
- **Rate limit**: 60 calls/minute = 1 call/second
- **Safety margin**: 1.5s delay = 40 calls/minute actual rate
- **Buffer**: 33% headroom to prevent accidental rate limit violations

This ensures the application never exceeds the API rate limit, even with multiple concurrent users.

### Cache Configuration

Cache behavior can be configured via environment variables:

```bash
# Cache TTL for in-memory cache (default: 30 seconds)
CACHE_TTL=30000
```

The persistent cache has built-in TTLs:
- Current price: Refreshed every 1 minute
- Historical prices: Checked twice daily for new data
- Balances: Refreshed every 1 hour for tracked addresses
- Transfers: Cached for 60 seconds

## Building for Production

Build the application:
```bash
yarn build
```

Start the production server:
```bash
yarn start
```

## Deployment

This application is configured for deployment on Railway.

1. Push your code to GitHub
2. Connect your repository to Railway
3. Set the `TAOSTATS_API_KEY` environment variable in Railway
4. Deploy

Railway will automatically detect the configuration and deploy your application.

## Technology Stack

- **Package Manager**: Yarn
- **Language**: TypeScript
- **Runtime**: Node.js + tsx (development)
- **Web Framework**: Express.js
- **External APIs**: Taostats.io API, @taostats/sdk
- **Blockchain Utils**:
  - @polkadot/util-crypto (EVM-to-SS58 conversion)
  - ethers.js (ERC-20 token queries via Bittensor EVM RPC)
- **Deployment**: Railway (Nixpacks)

## License

MIT
