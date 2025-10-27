# Feedboard

Lightweight application for Bittensor liquidity position observation and management.

## Features

HTTP endpoints for:

- Complete daily historical price of TAO in CSV format
- The current price of TAO in plain text format
- History of token transers in, for a given Bittensor SS58 account
- History of token transers out, for a given Bittensor SS58 account
- History of token transers in, for a given Bittensor EVM H160 account
- History of token transers out, for a given Bittensor EVM H160 account

Balances in TAO
- Current balance of an SS58 account
- Current balance of an EVM H160 account

## Data freshness

Data is not realtime. It is cached to file, and updated periodically.
 
## Architecture

- Yarn package manager
- Typescript
- Railway for deployment

