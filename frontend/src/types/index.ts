// Frontend types mirroring backend shared types
export interface SwapOrder {
  orderId: string;
  maker: string;
  makerAsset: {
    chainId: number;
    token: string;
    amount: string;
  };
  takerAsset: {
    chainId: number;
    token: string;
    amount: string;
  };
  secretHash: string;
  timelock: number;
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

export interface AuctionBid {
  resolver: string;
  price: string;
  timestamp: number;
  expiresAt: number;
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

export interface NetworkFees {
  ethereum: {
    gasPrice: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  bitcoin: {
    feeRate: number;
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

// Frontend-specific types
export interface WalletState {
  isConnected: boolean;
  address?: string;
  chainId?: number;
  balance?: string;
  isConnecting: boolean;
  error?: string;
}

export interface SwapFormData {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  fromChain: number;
  toChain: number;
  bitcoinAddress: string;
  slippage: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  chainId: number;
}

// Constants
export const SUPPORTED_CHAINS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BITCOIN_MAINNET: 100,
  BITCOIN_TESTNET: 101,
  BITCOIN_REGTEST: 102
} as const;

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export const DEFAULT_CONFIRMATIONS = {
  [SUPPORTED_CHAINS.ETHEREUM_MAINNET]: 3,
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: 1,
  [SUPPORTED_CHAINS.BITCOIN_MAINNET]: 3,
  [SUPPORTED_CHAINS.BITCOIN_TESTNET]: 1,
  [SUPPORTED_CHAINS.BITCOIN_REGTEST]: 1
} as const;

export const MINIMUM_AMOUNTS = {
  ETH: '0.001',
  BTC: '0.00001'
} as const;

// Error types
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
  NETWORK_ERROR = 'NETWORK_ERROR',
  WALLET_ERROR = 'WALLET_ERROR',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE'
}

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