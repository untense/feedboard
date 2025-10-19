# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Feedboard is a lightweight time-series application for accessing the Taostats.io API. It provides HTTP endpoints for cryptocurrency (TAO) price data.

## Technology Stack

- **Package Manager**: Yarn
- **Language**: TypeScript
- **Build Tool**: Vite
- **Deployment**: Railway

## API Endpoints (Planned)

The application should expose the following HTTP endpoints:

1. **Historical Price Data**: Complete daily historical price of TAO in CSV format
2. **Current Price**: Current price of TAO in plain text format

## Development Commands

Note: This project is in early stages. Standard Vite + TypeScript commands will apply once initialized:

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn test` - Run tests
- `yarn preview` - Preview production build

## Architecture Notes

- The application integrates with the Taostats.io API as its data source
- Endpoints should return lightweight responses (CSV and plain text) for easy consumption
- Time-series data handling will be a core component
