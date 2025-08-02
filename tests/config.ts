import { BitcoinRPCConfig } from '../backend/src/bitcoin/client.js';

export interface TestConfig {
  bitcoin: {
    regtest: BitcoinRPCConfig;
    testnet: BitcoinRPCConfig;
  };
  ethereum: {
    rpcUrl: string;
    chainId: number;
    accounts: string[];
  };
  testing: {
    timeout: number;
    retries: number;
    blockTime: number; // milliseconds
    confirmations: number;
  };
  performance: {
    maxConcurrentSwaps: number;
    loadTestDuration: number; // seconds
    memoryThreshold: number; // MB
  };
}

export const testConfig: TestConfig = {
  bitcoin: {
    regtest: {
      host: process.env.BITCOIN_REGTEST_HOST || 'localhost',
      port: parseInt(process.env.BITCOIN_REGTEST_PORT || '18443'),
      username: process.env.BITCOIN_REGTEST_USER || 'test',
      password: process.env.BITCOIN_REGTEST_PASS || 'test',
      network: 'regtest'
    },
    testnet: {
      host: process.env.BITCOIN_TESTNET_HOST || 'localhost',
      port: parseInt(process.env.BITCOIN_TESTNET_PORT || '18332'),
      username: process.env.BITCOIN_TESTNET_USER || 'test',
      password: process.env.BITCOIN_TESTNET_PASS || 'test',
      network: 'testnet'
    }
  },
  ethereum: {
    rpcUrl: process.env.ETH_RPC_URL || 'http://localhost:8545',
    chainId: parseInt(process.env.ETH_CHAIN_ID || '31337'),
    accounts: [
      // Test accounts - in production these would be loaded from environment
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Account 0
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Account 1
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'  // Account 2
    ]
  },
  testing: {
    timeout: 30000, // 30 seconds
    retries: 3,
    blockTime: 1000, // 1 second in regtest
    confirmations: 1
  },
  performance: {
    maxConcurrentSwaps: 10,
    loadTestDuration: 60, // 1 minute
    memoryThreshold: 512 // 512 MB
  }
};

export const DUST_THRESHOLD = 546; // satoshis
export const MIN_RELAY_FEE = 1; // sat/vbyte
export const DEFAULT_FEE_RATE = 10; // sat/vbyte

// Test wallet configurations
export interface TestWallet {
  privateKey: string;
  publicKey: Buffer;
  address: string;
  name: string;
}

export const TEST_WALLETS = {
  ALICE: 'alice_test_wallet',
  BOB: 'bob_test_wallet',
  CHARLIE: 'charlie_test_wallet',
  RESOLVER: 'resolver_test_wallet'
};

// Common test parameters
export const TEST_AMOUNTS = {
  SMALL: 10000, // 0.0001 BTC
  MEDIUM: 100000, // 0.001 BTC
  LARGE: 1000000 // 0.01 BTC
};

export const TEST_TIMELOCKS = {
  SHORT: 10, // 10 blocks
  MEDIUM: 50, // 50 blocks
  LONG: 144 // ~1 day in mainnet blocks
};