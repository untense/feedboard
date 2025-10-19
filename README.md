# Feedboard

Lightweight time-series application for accessing the Taostats.io API in different ways.

## Features

HTTP endpoints for:

- The complete daily historical price of TAO in CSV format
- The current price of TAO in plain text format

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
- **Runtime**: Node.js
- **Build Tool**: Vite
- **Web Framework**: Express.js
- **Deployment**: Railway

## License

MIT
