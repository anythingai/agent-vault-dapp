# 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin

A trustless atomic swap implementation between Ethereum and Bitcoin, extending the 1inch Fusion+ protocol to support cross-chain swaps with the world's largest cryptocurrency.

## Overview

This project implements bidirectional atomic swaps between Ethereum and Bitcoin using Hashed Timelock Contracts (HTLCs) on both chains. It preserves the full security guarantees of atomic swaps while providing a smooth user experience through the 1inch Fusion+ intent-based architecture.

## Architecture

- **Ethereum Smart Contracts**: Escrow contracts that hold tokens during swaps with hashlock and timelock enforcement
- **Bitcoin HTLC Scripts**: P2WSH scripts that lock BTC with the same hash and timeout constraints
- **Relayer Service**: Coordinates cross-chain swaps, manages orders, and handles secret revelation
- **Resolver Agents**: Execute swaps for profit by locking assets on both chains
- **User Interface**: Web UI for initiating and monitoring swaps

## Quick Start

### Prerequisites

- Node.js v18+
- Bitcoin Core (for testnet node)
- MetaMask wallet
- Sepolia ETH and Bitcoin testnet coins

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/1inch-bitcoin-fusion
cd 1inch-bitcoin-fusion

# Install dependencies
npm run install:all

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Running the Project

1. **Deploy Contracts** (Sepolia testnet):

```bash
cd contracts
npm run deploy:sepolia
```

2. **Start Bitcoin Node** (testnet):

```bash
bitcoind -testnet -daemon
```

3. **Start Backend Services**:

```bash
cd backend
npm run build
npm run relayer  # In one terminal
npm run resolver  # In another terminal
```

4. **Start Frontend**:

```bash
cd frontend
npm run dev
```

## Testing

```bash
# Run all tests
npm test

# Contract tests
cd contracts && npm test

# Backend tests  
cd backend && npm test

# Integration tests
npm run test:integration
```

## Demo

To run the demo:

```bash
npm run demo
```

This will execute a pre-configured atomic swap on testnets.

## Security

- All swaps are atomic - either both legs execute or both are refunded
- No trusted third parties or custodians
- Timelocks ensure funds can always be recovered
- Secret revelation is carefully timed to prevent theft

## License

MIT
