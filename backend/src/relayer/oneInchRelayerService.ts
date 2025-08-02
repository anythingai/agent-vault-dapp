import { ethers } from 'ethers';
import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  SwapEvent,
  SwapEventType,
  ConfigOptions,
  SwapError,
  SwapErrorCode,
  Address,
  Hash
} from '../shared/types.js';

import {
  OneInchOrder,
  OneInchCrossChainOrder,
  OneInchConfig,
  OneInchFillParams,
  CrossChainFillArgs,
  OneInchFillResult,
  MakerTraits,
  TakerTraits,
  TraitsHelper
} from '../shared/oneinch-types.js';

import { OneInchIntegrationService } from '../services/oneInchIntegration.js';
import { RelayerService, RelayerServiceConfig } from './index.js';
import OrderManager from './orderManager.js';

export interface OneInchRelayerConfig extends RelayerServiceConfig {
  oneInch: OneInchConfig;
  ethereum: {
    rpcUrl: string;
    chainId: number;
    privateKey?: string; // For relayer operations
    gasPrice?: string;
    gasLimit?: number;
  };
}

/**
 * Enhanced Relayer Service with 1inch Limit Order Protocol Integration
 * Extends the base RelayerService to use 1inch fillOrder instead of custom escrows
 */
export class OneInchRelayerService extends RelayerService {
  private oneInchService: OneInchIntegrationService;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;
  private oneInchConfig: OneInchConfig;
  
  // Track 1inch orders and their relationship to swap orders
  private swapToOneInchOrders: Map<string, OneInchCrossChainOrder> = new Map();
  private oneInchToSwapOrders: Map<Hash, string> = new Map();

  constructor(config: OneInchRelayerConfig) {
    super(config);
    
    this.oneInchConfig = config.oneInch;
    
    // Initialize Ethereum provider
    this.provider = new ethers.JsonRpcProvider(config.ethereum.rpcUrl);
    
    // Initialize signer if private key provided
    if (config.ethereum.privateKey) {
      this.signer = new ethers.Wallet(config.ethereum.privateKey, this.provider);
      this.initializeSignerInfo();
    }
    
    // Initialize 1inch integration service
    this.oneInchService = new OneInchIntegrationService(this.provider, this.oneInchConfig);
    
    console.log('OneInchRelayerService initialized with:');
    console.log('- 1inch LimitOrderProtocol:', config.oneInch.limitOrderProtocol);
    console.log('- EscrowFactory:', config.oneInch.escrowFactory);
    console.log('- Chain ID:', config.oneInch.chainId);
  }

  /**
   * Initialize signer information asynchronously
   */
  private async initializeSignerInfo(): Promise<void> {
    if (this.signer) {
      try {
        const signerAddress = await this.signer.getAddress();
        console.log('1inch Relayer initialized with signer:', signerAddress);
      } catch (error) {
        console.warn('Could not get signer address:', error);
      }
    }
  }

  /**
   * Create swap order with 1inch integration
   * Overrides the base implementation to use 1inch Order format
   */
  async createOrder(orderData: SwapOrder): Promise<CrossChainSwapState> {
    try {
      // Create the base swap state first
      const swapState = await super.createOrder(orderData);
      
      // Convert to 1inch order format
      const conversionResult = this.oneInchService.convertSwapOrderToOneInch(
        orderData,
        orderData.maker // Use maker as receiver by default
      );
      
      // Calculate order hash
      const orderHash = await this.oneInchService.calculateOrderHash(conversionResult.oneInchOrder);
      conversionResult.oneInchOrder.orderHash = orderHash;
      
      // Store the mapping
      this.swapToOneInchOrders.set(orderData.orderId, conversionResult.oneInchOrder);
      this.oneInchToSwapOrders.set(orderHash, orderData.orderId);
      
      console.log(`1inch order created for swap ${orderData.orderId}:`);
      console.log(`- Order hash: ${orderHash}`);
      console.log(`- Maker: ${conversionResult.oneInchOrder.maker}`);
      console.log(`- Making amount: ${conversionResult.oneInchOrder.makingAmount}`);
      console.log(`- Taking amount: ${conversionResult.oneInchOrder.takingAmount}`);
      
      return swapState;
      
    } catch (error) {
      console.error('Error creating 1inch order:', error);
      throw error;
    }
  }

  /**
   * Execute order fill using 1inch fillOrder
   * This is called by resolvers to fill orders
   */
  async fillOrderWith1inch(
    orderId: string,
    resolverAddress: Address,
    bitcoinAddress?: string
  ): Promise<OneInchFillResult> {
    const oneInchOrder = this.swapToOneInchOrders.get(orderId);
    if (!oneInchOrder) {
      throw new SwapError('1inch order not found for swap', SwapErrorCode.INVALID_ORDER, orderId);
    }

    const swapOrder = this.getOrder(orderId);
    if (!swapOrder) {
      throw new SwapError('Swap order not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    if (!this.signer) {
      throw new SwapError('No signer available for filling orders', SwapErrorCode.RESOLVER_UNAVAILABLE, orderId);
    }

    try {
      // Prepare cross-chain arguments
      const crossChainArgs: CrossChainFillArgs = {
        secretHash: oneInchOrder.secretHash,
        timelock: oneInchOrder.timelock,
        bitcoinAddress: bitcoinAddress || ethers.ZeroAddress
      };

      // We need the maker's signature for the order
      // In a real implementation, this would come from the frontend/user
      // For now, we'll simulate this step
      console.log('Note: In production, maker signature would be provided by the user');
      
      // Create mock signature components for demonstration
      // In reality, these would come from the user's EIP-712 signature
      const mockSignature = {
        r: ethers.randomBytes(32),
        s: ethers.randomBytes(32),
        v: 27
      };

      // Prepare fill parameters
      const fillParams = this.oneInchService.prepareFillParams(
        oneInchOrder,
        {
          r: ethers.hexlify(mockSignature.r),
          s: ethers.hexlify(mockSignature.s),
          v: mockSignature.v
        },
        oneInchOrder.takingAmount,
        '0x0' // Basic taker traits
      );

      // Execute fillOrder on the 1inch contract
      console.log(`Filling 1inch order ${oneInchOrder.orderHash} as resolver ${resolverAddress}`);
      
      const fillResult = await this.oneInchService.fillOrder(
        fillParams,
        this.signer,
        crossChainArgs
      );

      // Update swap order status
      await (this as any).updateOrder(orderId, {
        status: SwapStatus.SOURCE_FUNDED,
        resolver: resolverAddress,
        addresses: {
          ...swapOrder.addresses,
          sourceEscrow: fillResult.escrowAddress
        },
        transactions: {
          ...swapOrder.transactions,
          sourceFunding: {
            txid: fillResult.transactionHash,
            confirmations: 0,
            timestamp: Math.floor(Date.now() / 1000),
            fee: '0',
            status: 'pending'
          }
        }
      });

      console.log(`✅ 1inch order filled successfully:`);
      console.log(`- Transaction: ${fillResult.transactionHash}`);
      console.log(`- Escrow created: ${fillResult.escrowAddress}`);
      console.log(`- Making amount: ${fillResult.makingAmount}`);
      console.log(`- Taking amount: ${fillResult.takingAmount}`);

      return fillResult;

    } catch (error) {
      console.error(`Error filling 1inch order for ${orderId}:`, error);
      
      // Update order status to failed
      await (this as any).updateOrder(orderId, {
        status: SwapStatus.FAILED
      });
      
      throw error;
    }
  }

  /**
   * Get 1inch order for a swap order ID
   */
  getOneInchOrder(orderId: string): OneInchCrossChainOrder | null {
    return this.swapToOneInchOrders.get(orderId) || null;
  }

  /**
   * Get swap order ID from 1inch order hash
   */
  getSwapOrderId(oneInchOrderHash: Hash): string | null {
    return this.oneInchToSwapOrders.get(oneInchOrderHash) || null;
  }

  /**
   * Sign order for a user (this would normally be done on the frontend)
   * Included here for testing and integration purposes
   */
  async signOrderForUser(
    orderId: string,
    userSigner: ethers.Signer
  ): Promise<{ r: string; s: string; v: number; signature: string }> {
    const oneInchOrder = this.swapToOneInchOrders.get(orderId);
    if (!oneInchOrder) {
      throw new SwapError('1inch order not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    return await this.oneInchService.signOrder(oneInchOrder, userSigner);
  }

  /**
   * Enhanced start auction that includes 1inch order details
   */
  async startAuction(orderId: string, auctionParams?: any): Promise<any> {
    const oneInchOrder = this.swapToOneInchOrders.get(orderId);
    if (!oneInchOrder) {
      console.warn(`No 1inch order found for ${orderId}, proceeding with standard auction`);
      return await super.startAuction(orderId, auctionParams);
    }

    // Include 1inch order information in auction parameters
    const enhancedParams = {
      ...auctionParams,
      oneInchOrder: {
        orderHash: oneInchOrder.orderHash,
        maker: oneInchOrder.maker,
        makerAsset: oneInchOrder.makerAsset,
        takerAsset: oneInchOrder.takerAsset,
        makingAmount: oneInchOrder.makingAmount,
        takingAmount: oneInchOrder.takingAmount
      }
    };

    return await super.startAuction(orderId, enhancedParams);
  }

  /**
   * Check if 1inch order has been processed
   */
  async isOneInchOrderProcessed(orderId: string): Promise<boolean> {
    const oneInchOrder = this.swapToOneInchOrders.get(orderId);
    if (!oneInchOrder || !oneInchOrder.orderHash) {
      return false;
    }

    return await this.oneInchService.isOrderProcessed(oneInchOrder.orderHash);
  }

  /**
   * Get escrow address for 1inch order
   */
  async getEscrowForOneInchOrder(orderId: string): Promise<Address | null> {
    const oneInchOrder = this.swapToOneInchOrders.get(orderId);
    if (!oneInchOrder || !oneInchOrder.orderHash) {
      return null;
    }

    return await this.oneInchService.getEscrowForOrder(oneInchOrder.orderHash);
  }

  /**
   * Enhanced status that includes 1inch integration details
   */
  getStatus(): any {
    const baseStatus = super.getStatus();
    
    return {
      ...baseStatus,
      oneInchIntegration: {
        status: 'active',
        config: this.oneInchConfig,
        trackedOrders: {
          total: this.swapToOneInchOrders.size,
          swapToOneInch: this.swapToOneInchOrders.size,
          oneInchToSwap: this.oneInchToSwapOrders.size
        },
        provider: {
          connected: !!this.provider,
          chainId: this.oneInchConfig.chainId
        },
        signer: {
          available: !!this.signer,
          address: this.signer ? 'configured' : null
        }
      }
    };
  }

  /**
   * Get detailed 1inch integration metrics
   */
  getOneInchMetrics(): any {
    return {
      totalOneInchOrders: this.swapToOneInchOrders.size,
      activeOneInchOrders: Array.from(this.swapToOneInchOrders.values()).length,
      config: this.oneInchConfig,
      integrationStatus: 'active'
    };
  }
}

/**
 * Factory function to create OneInchRelayerService with default configuration
 */
export function createOneInchRelayerService(
  overrides: Partial<OneInchRelayerConfig> = {}
): OneInchRelayerService {
  // Base configuration from parent factory
  const defaultConfig: OneInchRelayerConfig = {
    port: 3001,
    cors: {
      origin: ['*'],
      credentials: false
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      maxRequests: 1000
    },
    auth: {
      enabled: false
    },
    websocket: {
      enabled: true,
      pingInterval: 30000,
      maxConnections: 100
    },
    orderManager: {
      maxPartialFills: 10,
      defaultAuctionDuration: 300,
      maxOrderLifetime: 86400,
      cleanupInterval: 300000,
      enablePartialFills: true
    },
    auctionEngine: {
      defaultDuration: 300,
      minBidIncrement: '1000000000000000',
      maxConcurrentAuctions: 100,
      reserveRatio: 0.9,
      bidTimeoutWindow: 60
    },
    eventMonitor: {
      ethereum: {
        rpcUrl: 'https://sepolia.infura.io/v3/YOUR_API_KEY',
        chainId: 11155111,
        contracts: {
          escrowFactory: '0x0000000000000000000000000000000000000000'
        },
        confirmations: 1,
        pollInterval: 12000
      },
      bitcoin: {
        rpcUrl: 'http://localhost:8332',
        rpcUser: 'user',
        rpcPassword: 'pass',
        network: 'testnet',
        confirmations: 1,
        pollInterval: 60000
      },
      retryConfig: {
        maxRetries: 3,
        retryDelay: 5000,
        backoffMultiplier: 2
      }
    },
    secretCoordinator: {
      secretRevealDelay: 60,
      maxSecretAge: 86400,
      partialFillTimeout: 300,
      encryptionKey: 'default-encryption-key'
    },
    
    // 1inch specific configuration
    oneInch: {
      limitOrderProtocol: '0x0000000000000000000000000000000000000000', // Will be set from deployment
      escrowFactory: '0x0000000000000000000000000000000000000000',     // Will be set from deployment  
      weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',              // WETH on Sepolia
      domainSeparator: '0x0000000000000000000000000000000000000000000000000000000000000000',
      chainId: 11155111 // Sepolia
    },
    
    // Ethereum configuration
    ethereum: {
      rpcUrl: 'https://sepolia.infura.io/v3/YOUR_API_KEY',
      chainId: 11155111,
      gasPrice: '20000000000', // 20 gwei
      gasLimit: 500000
    }
  };

  const config = { ...defaultConfig, ...overrides };
  
  // Validate required 1inch configuration
  if (!config.oneInch.limitOrderProtocol || config.oneInch.limitOrderProtocol === '0x0000000000000000000000000000000000000000') {
    console.warn('⚠️  1inch LimitOrderProtocol address not configured. Please update after deployment.');
  }

  return new OneInchRelayerService(config);
}

export default OneInchRelayerService;