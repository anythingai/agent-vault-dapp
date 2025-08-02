export interface SwapOrder {
  orderId: string;
  maker: string;
  makerAsset: {
    chainId: number;
    token: string; // address(0) for native tokens
    amount: string;
  };
  takerAsset: {
    chainId: number;
    token: string;
    amount: string;
  };
  secretHash: string; // 32-byte hex string
  timelock: number; // Unix timestamp
  signature: string;
  createdAt: number;
  expiresAt: number;
}

export interface CrossChainSwapState {
  orderId: string;
  status: SwapStatus;
  sourceChain: ChainInfo;
  destinationChain: ChainInfo;
  maker: string;
  resolver?: string;
  secretHash: string;
  secret?: string;
  amounts: {
    source: string;
    destination: string;
  };
  addresses: {
    sourceEscrow?: string;
    destinationEscrow?: string;
    htlcAddress?: string;
  };
  transactions: {
    sourceFunding?: TransactionInfo;
    destinationFunding?: TransactionInfo;
    sourceRedeem?: TransactionInfo;
    destinationRedeem?: TransactionInfo;
    sourceRefund?: TransactionInfo;
    destinationRefund?: TransactionInfo;
  };
  timelocks: {
    source: number;
    destination: number;
  };
  createdAt: number;
  updatedAt: number;
}

export enum SwapStatus {
  CREATED = 'created',
  AUCTION_STARTED = 'auction_started',
  RESOLVER_SELECTED = 'resolver_selected',
  SOURCE_FUNDED = 'source_funded',
  DESTINATION_FUNDED = 'destination_funded',
  BOTH_FUNDED = 'both_funded',
  SECRET_REVEALED = 'secret_revealed',
  PARTIALLY_REDEEMED = 'partially_redeemed',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
  FAILED = 'failed'
}

export interface ChainInfo {
  chainId: number;
  name: string;
  type: 'ethereum' | 'bitcoin';
  rpcUrl: string;
  confirmations: number;
}

export interface TransactionInfo {
  txid: string;
  blockHeight?: number;
  confirmations: number;
  timestamp: number;
  fee: string;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface ResolverInfo {
  address: string;
  btcAddress?: string;
  reputation: number;
  successRate: number;
  totalVolume: string;
  availableLiquidity: {
    [chainId: number]: {
      [token: string]: string;
    };
  };
  minimumOrderSize: string;
  maximumOrderSize: string;
  supportedPairs: Array<{
    sourceChain: number;
    sourceToken: string;
    destChain: number;
    destToken: string;
  }>;
  isActive: boolean;
}

export interface DutchAuctionParams {
  startingPrice: string;
  endingPrice: string;
  duration: number; // seconds
  priceFunction: 'linear' | 'exponential';
}

export interface AuctionBid {
  resolver: string;
  price: string;
  timestamp: number;
  expiresAt: number;
}

export interface PartialFillInfo {
  orderId: string;
  fillIndex: number;
  totalFills: number;
  amount: string;
  secretIndex: number;
  merkleProof: string[];
  resolver: string;
  status: SwapStatus;
}

export interface MerkleSecretTree {
  root: string;
  secrets: string[];
  hashes: string[];
  leaves: string[];
  proofs: string[][];
}

export interface EventLog {
  chainId: number;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  address: string;
  topics: string[];
  data: string;
  timestamp: number;
}

export interface SwapEvent {
  type: SwapEventType;
  orderId: string;
  chainId: number;
  data: any;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

export enum SwapEventType {
  ORDER_CREATED = 'order_created',
  AUCTION_STARTED = 'auction_started',
  BID_PLACED = 'bid_placed',
  RESOLVER_SELECTED = 'resolver_selected',
  ESCROW_CREATED = 'escrow_created',
  FUNDS_DEPOSITED = 'funds_deposited',
  SECRET_REVEALED = 'secret_revealed',
  FUNDS_REDEEMED = 'funds_redeemed',
  SWAP_COMPLETED = 'swap_completed',
  SWAP_REFUNDED = 'swap_refunded',
  SWAP_EXPIRED = 'swap_expired',
  ERROR_OCCURRED = 'error_occurred'
}

export interface ConfigOptions {
  ethereum: {
    rpcUrl: string;
    chainId: number;
    confirmations: number;
    contracts: {
      escrowFactory: string;
      limitOrderProtocol?: string;
    };
  };
  bitcoin: {
    network: 'mainnet' | 'testnet' | 'regtest';
    rpcUrl: string;
    rpcUser: string;
    rpcPassword: string;
    confirmations: number;
  };
  relayer: {
    port: number;
    secretKey: string;
    auctionDuration: number;
    maxPartialFills: number;
  };
  resolver: {
    port: number;
    privateKey: string;
    btcPrivateKey: string;
    minProfitMargin: number;
    maxOrderSize: string;
    strategies: ResolverStrategy[];
  };
}

export interface ResolverStrategy {
  name: string;
  enabled: boolean;
  params: {
    [key: string]: any;
  };
}

export interface NetworkFees {
  ethereum: {
    gasPrice: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  bitcoin: {
    feeRate: number; // sat/vbyte
  };
}

export interface SwapMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  totalVolume: {
    [chainId: number]: {
      [token: string]: string;
    };
  };
  averageCompletionTime: number;
  activeResolvers: number;
  currentLiquidity: {
    [chainId: number]: {
      [token: string]: string;
    };
  };
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  details: {
    [key: string]: any;
  };
}

// Error types
export class SwapError extends Error {
  constructor(
    message: string,
    public code: SwapErrorCode,
    public orderId?: string,
    public chainId?: number
  ) {
    super(message);
    this.name = 'SwapError';
  }
}

export enum SwapErrorCode {
  INVALID_ORDER = 'INVALID_ORDER',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  EXPIRED_ORDER = 'EXPIRED_ORDER',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  CHAIN_ERROR = 'CHAIN_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  INVALID_SECRET = 'INVALID_SECRET',
  RESOLVER_UNAVAILABLE = 'RESOLVER_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

// Utility types
export type ChainId = number;
export type Address = string;
export type Hash = string;
export type Signature = string;
export type Amount = string; // String representation of big numbers

// Constants
export const SUPPORTED_CHAINS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BITCOIN_MAINNET: 100, // Custom identifier for Bitcoin mainnet
  BITCOIN_TESTNET: 101, // Custom identifier for Bitcoin testnet
  BITCOIN_REGTEST: 102  // Custom identifier for Bitcoin regtest
} as const;

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export const DEFAULT_CONFIRMATIONS = {
  [SUPPORTED_CHAINS.ETHEREUM_MAINNET]: 3,
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: 1,
  [SUPPORTED_CHAINS.BITCOIN_MAINNET]: 3,
  [SUPPORTED_CHAINS.BITCOIN_TESTNET]: 1,
  [SUPPORTED_CHAINS.BITCOIN_REGTEST]: 1
} as const;

export const DEFAULT_TIMELOCK_DURATION = {
  SOURCE: 2 * 3600, // 2 hours
  DESTINATION: 1 * 3600 // 1 hour
} as const;

export const MINIMUM_AMOUNTS = {
  ETH: '0.001', // 0.001 ETH
  BTC: '0.00001' // 0.00001 BTC (1000 sats)
} as const;