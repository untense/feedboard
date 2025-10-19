# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Feedboard is a lightweight time-series application for accessing the Taostats.io API. It provides HTTP endpoints for cryptocurrency (TAO) price data in CSV and plain text formats.

## Technology Stack

- **Package Manager**: Yarn
- **Language**: TypeScript
- **Runtime**: Node.js + tsx (development)
- **Web Framework**: Express.js
- **Deployment**: Railway (with Nixpacks)

## Development Commands

- `yarn dev` - Start development server with hot reload (uses tsx watch)
- `yarn build` - Build TypeScript project for production
- `yarn start` - Run production build
- `yarn test` - Run tests (not yet implemented)

## Project Structure

```
src/
├── index.ts           # Main application entry point with Express server
├── config.ts          # Configuration and environment variables
├── types/
│   └── index.ts       # TypeScript type definitions
├── services/
│   └── taostats.ts    # Taostats API client
└── routes/
    └── price.ts       # Price endpoints (current & historical)
```

## API Endpoints

The application exposes these HTTP endpoints:

- `GET /health` - Health check endpoint
- `GET /` - API information and endpoint list
- `GET /api/price/current` - Current TAO price (plain text)
- `GET /api/price/historical` - Historical TAO prices (CSV format)

## Architecture Notes

### Configuration
- Environment variables managed via `dotenv` in `src/config.ts`
- Required: `TAOSTATS_API_KEY` for production
- Optional: `PORT` (default 3000), `TAOSTATS_API_URL`

### Taostats API Integration
- Client implementation in `src/services/taostats.ts`
- Uses fetch API for HTTP requests
- Includes error handling and response normalization
- API endpoints are placeholders and may need adjustment based on actual Taostats API structure

### Response Formats
- Current price: Plain text number (e.g., "42.50")
- Historical prices: CSV with headers (date, price, volume)

### Module System
- Uses ES modules (`"type": "module"` in package.json)
- All imports require `.js` extension for TypeScript files

## Railway Deployment

- Configuration in `railway.json` and `nixpacks.toml`
- Nixpacks builder with Node.js 20 and Yarn
- Set `TAOSTATS_API_KEY` environment variable in Railway dashboard
