# Feedboard

Lightweight time-series application for accessing the Taostats.io API in different ways.

## Features

HTTP endpoints for:

- **Price Data**: Current and historical TAO prices in CSV and plain text formats
- **Wallet Balances**: Get TAO balance for SS58 (native) and EVM addresses
- **Transfer History**: View incoming/outgoing TAO transfers for both address types
- **Token Transfers**: Track ERC-20 token transfers (like USDC) on Bittensor EVM chain

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

Get the TAO balance for a wallet address (supports both SS58 native addresses and EVM H160 addresses).

**SS58 Address:**
```
GET /api/balance/ss58/:address
```

**EVM Address:**
```
GET /api/balance/evm/:address
```

**Response:** Plain text balance in TAO
```
123.456789
```

**Example:**
```bash
# SS58 address
curl http://localhost:3000/api/balance/ss58/5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ

# EVM address (automatically converted to SS58 mirror)
curl http://localhost:3000/api/balance/evm/0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8
```

**Features:**
- Persistent cache with hourly background updates
- Automatic EVM-to-SS58 mirror address conversion
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

## Testing

Run the comprehensive test suite:
```bash
./test-all.sh
```

This tests all 13 endpoints including health check, price data, balances, transfers, and token transfers.

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
- **Blockchain Utils**: @polkadot/util-crypto (EVM-to-SS58 conversion)
- **Deployment**: Railway (Nixpacks)

## License

MIT
