import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  PartialFillInfo,
  SwapError,
  SwapErrorCode,
  ResolverInfo,
  Amount,
  Hash,
  Address,
  ChainId,
  SUPPORTED_CHAINS,
  DEFAULT_TIMELOCK_DURATION,
  MINIMUM_AMOUNTS
} from '../shared/types.js';
import { SecretManager } from '../shared/secrets.js';

export interface OrderManagerConfig {
  maxPartialFills: number;
  defaultAuctionDuration: number;
  maxOrderLifetime: number;
  cleanupInterval: number;
  enablePartialFills: boolean;
}

export interface OrderBook {
  orders: Map<string, CrossChainSwapState>;
  ordersByMaker: Map<Address, Set<string>>;
  ordersByResolver: Map<Address, Set<string>>;
  ordersByStatus: Map<SwapStatus, Set<string>>;
  ordersByExpiry: Map<number, Set<string>>; // Unix timestamp -> order IDs
}

export interface OrderValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export type OrderManagerEventHandler = {
  orderCreated?: (state: CrossChainSwapState) => void;
  orderUpdated?: (state: CrossChainSwapState, previousState: CrossChainSwapState) => void;
  orderExpired?: (state: CrossChainSwapState) => void;
  partialFillCreated?: (fill: PartialFillInfo) => void;
};

/**
 * Order Manager - Handles swap order creation, validation, storage, and lifecycle management
 * Core component of the relayer service that maintains the order book and tracks swap states
 */
export class OrderManager {
  private orderBook: OrderBook;
  private config: OrderManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: OrderManagerEventHandler = {};
  private metrics: {
    totalOrders: number;
    activeOrders: number;
    completedOrders: number;
    failedOrders: number;
    expiredOrders: number;
  };

  constructor(config: OrderManagerConfig) {
    this.config = config;
    this.orderBook = {
      orders: new Map(),
      ordersByMaker: new Map(),
      ordersByResolver: new Map(),
      ordersByStatus: new Map(),
      ordersByExpiry: new Map()
    };
    this.metrics = {
      totalOrders: 0,
      activeOrders: 0,
      completedOrders: 0,
      failedOrders: 0,
      expiredOrders: 0
    };

    this.initializeCleanupTimer();
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: OrderManagerEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof OrderManagerEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Create and validate a new swap order
   */
  async createOrder(order: SwapOrder): Promise<CrossChainSwapState> {
    // Validate the order
    const validation = await this.validateOrder(order);
    if (!validation.isValid) {
      throw new SwapError(
        `Invalid order: ${validation.errors.join(', ')}`,
        SwapErrorCode.INVALID_ORDER,
        order.orderId
      );
    }

    // Check if order already exists
    if (this.orderBook.orders.has(order.orderId)) {
      throw new SwapError(
        'Order already exists',
        SwapErrorCode.INVALID_ORDER,
        order.orderId
      );
    }

    // Determine chain information
    const sourceChain = this.getChainInfo(order.makerAsset.chainId);
    const destinationChain = this.getChainInfo(order.takerAsset.chainId);

    // Calculate timelocks
    const now = Math.floor(Date.now() / 1000);
    const sourceTimelock = now + DEFAULT_TIMELOCK_DURATION.SOURCE;
    const destinationTimelock = now + DEFAULT_TIMELOCK_DURATION.DESTINATION;

    // Create the cross-chain swap state
    const swapState: CrossChainSwapState = {
      orderId: order.orderId,
      status: SwapStatus.CREATED,
      sourceChain,
      destinationChain,
      maker: order.maker,
      secretHash: order.secretHash,
      amounts: {
        source: order.makerAsset.amount,
        destination: order.takerAsset.amount
      },
      addresses: {},
      transactions: {},
      timelocks: {
        source: sourceTimelock,
        destination: destinationTimelock
      },
      createdAt: now,
      updatedAt: now
    };

    // Store the order
    this.addOrderToBook(swapState);
    this.updateMetrics();

    // Emit event
    this.emit('orderCreated', swapState);

    return swapState;
  }

  /**
   * Update an existing order's status and state
   */
  async updateOrder(
    orderId: string,
    updates: Partial<CrossChainSwapState>
  ): Promise<CrossChainSwapState> {
    const existingState = this.orderBook.orders.get(orderId);
    if (!existingState) {
      throw new SwapError(
        'Order not found',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // Remove from status-based indexes before updating
    if (updates.status && updates.status !== existingState.status) {
      this.removeOrderFromStatusIndex(orderId, existingState.status);
    }

    // Update the state
    const updatedState: CrossChainSwapState = {
      ...existingState,
      ...updates,
      updatedAt: Math.floor(Date.now() / 1000)
    };

    // Update in storage
    this.orderBook.orders.set(orderId, updatedState);

    // Update indexes if status changed
    if (updates.status && updates.status !== existingState.status) {
      this.addOrderToStatusIndex(orderId, updates.status);
    }

    // Update resolver index if resolver changed
    if (updates.resolver && updates.resolver !== existingState.resolver) {
      if (existingState.resolver) {
        this.removeOrderFromResolverIndex(orderId, existingState.resolver);
      }
      this.addOrderToResolverIndex(orderId, updates.resolver);
    }

    this.updateMetrics();

    // Emit event
    this.emit('orderUpdated', updatedState, existingState);

    return updatedState;
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): CrossChainSwapState | null {
    return this.orderBook.orders.get(orderId) || null;
  }

  /**
   * Get orders by maker address
   */
  getOrdersByMaker(maker: Address): CrossChainSwapState[] {
    const orderIds = this.orderBook.ordersByMaker.get(maker) || new Set();
    return Array.from(orderIds)
      .map(id => this.orderBook.orders.get(id))
      .filter((order): order is CrossChainSwapState => order !== undefined);
  }

  /**
   * Get orders by resolver address
   */
  getOrdersByResolver(resolver: Address): CrossChainSwapState[] {
    const orderIds = this.orderBook.ordersByResolver.get(resolver) || new Set();
    return Array.from(orderIds)
      .map(id => this.orderBook.orders.get(id))
      .filter((order): order is CrossChainSwapState => order !== undefined);
  }

  /**
   * Get orders by status
   */
  getOrdersByStatus(status: SwapStatus): CrossChainSwapState[] {
    const orderIds = this.orderBook.ordersByStatus.get(status) || new Set();
    return Array.from(orderIds)
      .map(id => this.orderBook.orders.get(id))
      .filter((order): order is CrossChainSwapState => order !== undefined);
  }

  /**
   * Get active orders (not completed, failed, expired, or refunded)
   */
  getActiveOrders(): CrossChainSwapState[] {
    const inactiveStatuses = [
      SwapStatus.COMPLETED,
      SwapStatus.FAILED,
      SwapStatus.EXPIRED,
      SwapStatus.REFUNDED
    ];
    
    return Array.from(this.orderBook.orders.values())
      .filter(order => !inactiveStatuses.includes(order.status));
  }

  /**
   * Get orders expiring soon
   */
  getOrdersExpiringSoon(withinSeconds: number = 3600): CrossChainSwapState[] {
    const now = Math.floor(Date.now() / 1000);
    const threshold = now + withinSeconds;
    
    return this.getActiveOrders().filter(order => {
      const earliestTimelock = Math.min(
        order.timelocks.source,
        order.timelocks.destination
      );
      return earliestTimelock <= threshold;
    });
  }

  /**
   * Mark order as expired
   */
  async expireOrder(orderId: string): Promise<void> {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new SwapError('Order not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    if (order.status === SwapStatus.COMPLETED || 
        order.status === SwapStatus.EXPIRED ||
        order.status === SwapStatus.REFUNDED) {
      return; // Already in final state
    }

    await this.updateOrder(orderId, { status: SwapStatus.EXPIRED });
    this.emit('orderExpired', order);
  }

  /**
   * Create partial fill for an order
   */
  async createPartialFill(
    orderId: string,
    fillAmount: Amount,
    resolver: Address
  ): Promise<PartialFillInfo> {
    if (!this.config.enablePartialFills) {
      throw new SwapError(
        'Partial fills not enabled',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    const order = this.getOrder(orderId);
    if (!order) {
      throw new SwapError('Order not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    // Validate partial fill
    const totalAmount = BigInt(order.amounts.source);
    const fillAmountBN = BigInt(fillAmount);
    
    if (fillAmountBN > totalAmount) {
      throw new SwapError(
        'Fill amount exceeds order amount',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // Generate partial fill structure if not exists
    if (!order.secretHash.includes('merkle:')) {
      // For simplicity, we'll use a basic approach here
      // In production, this would involve proper Merkle tree coordination
      const partialFill: PartialFillInfo = {
        orderId,
        fillIndex: 0,
        totalFills: 1,
        amount: fillAmount,
        secretIndex: 0,
        merkleProof: [],
        resolver,
        status: SwapStatus.CREATED
      };

      this.emit('partialFillCreated', partialFill);
      return partialFill;
    }

    throw new SwapError(
      'Partial fill creation not implemented for Merkle orders',
      SwapErrorCode.INVALID_ORDER,
      orderId
    );
  }

  /**
   * Validate a swap order
   */
  private async validateOrder(order: SwapOrder): Promise<OrderValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!order.orderId) {
      errors.push('Order ID is required');
    }

    if (!order.maker) {
      errors.push('Maker address is required');
    }

    if (!order.secretHash || order.secretHash.length !== 66) {
      errors.push('Invalid secret hash format');
    }

    // Validate maker asset
    if (!order.makerAsset.amount || BigInt(order.makerAsset.amount) <= 0) {
      errors.push('Maker asset amount must be positive');
    }

    if (!this.isSupportedChain(order.makerAsset.chainId)) {
      errors.push(`Unsupported maker chain: ${order.makerAsset.chainId}`);
    }

    // Validate taker asset
    if (!order.takerAsset.amount || BigInt(order.takerAsset.amount) <= 0) {
      errors.push('Taker asset amount must be positive');
    }

    if (!this.isSupportedChain(order.takerAsset.chainId)) {
      errors.push(`Unsupported taker chain: ${order.takerAsset.chainId}`);
    }

    // Validate cross-chain requirement
    if (order.makerAsset.chainId === order.takerAsset.chainId) {
      errors.push('Cross-chain swaps require different chains');
    }

    // Validate timelock
    const now = Math.floor(Date.now() / 1000);
    if (order.timelock <= now) {
      errors.push('Timelock must be in the future');
    }

    if (order.timelock > now + this.config.maxOrderLifetime) {
      warnings.push('Order lifetime exceeds recommended maximum');
    }

    // Validate minimum amounts
    const makerAmountBN = BigInt(order.makerAsset.amount);
    const takerAmountBN = BigInt(order.takerAsset.amount);

    if (this.isETHChain(order.makerAsset.chainId)) {
      const minETH = BigInt(MINIMUM_AMOUNTS.ETH);
      if (makerAmountBN < minETH) {
        errors.push(`Maker amount below minimum: ${MINIMUM_AMOUNTS.ETH} ETH`);
      }
    }

    if (this.isBTCChain(order.makerAsset.chainId)) {
      const minBTC = BigInt(MINIMUM_AMOUNTS.BTC);
      if (makerAmountBN < minBTC) {
        errors.push(`Maker amount below minimum: ${MINIMUM_AMOUNTS.BTC} BTC`);
      }
    }

    // Validate expiry
    if (order.expiresAt <= now) {
      errors.push('Order has already expired');
    }

    // Validate signature (simplified - would need proper signature verification)
    if (!order.signature || order.signature.length < 130) {
      warnings.push('Invalid signature format');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Add order to the order book and indexes
   */
  private addOrderToBook(state: CrossChainSwapState): void {
    this.orderBook.orders.set(state.orderId, state);
    
    // Add to maker index
    this.addOrderToMakerIndex(state.orderId, state.maker);
    
    // Add to status index
    this.addOrderToStatusIndex(state.orderId, state.status);
    
    // Add to expiry index
    const expiryTime = Math.min(state.timelocks.source, state.timelocks.destination);
    this.addOrderToExpiryIndex(state.orderId, expiryTime);
  }

  private addOrderToMakerIndex(orderId: string, maker: Address): void {
    if (!this.orderBook.ordersByMaker.has(maker)) {
      this.orderBook.ordersByMaker.set(maker, new Set());
    }
    this.orderBook.ordersByMaker.get(maker)!.add(orderId);
  }

  private addOrderToResolverIndex(orderId: string, resolver: Address): void {
    if (!this.orderBook.ordersByResolver.has(resolver)) {
      this.orderBook.ordersByResolver.set(resolver, new Set());
    }
    this.orderBook.ordersByResolver.get(resolver)!.add(orderId);
  }

  private removeOrderFromResolverIndex(orderId: string, resolver: Address): void {
    const orders = this.orderBook.ordersByResolver.get(resolver);
    if (orders) {
      orders.delete(orderId);
      if (orders.size === 0) {
        this.orderBook.ordersByResolver.delete(resolver);
      }
    }
  }

  private addOrderToStatusIndex(orderId: string, status: SwapStatus): void {
    if (!this.orderBook.ordersByStatus.has(status)) {
      this.orderBook.ordersByStatus.set(status, new Set());
    }
    this.orderBook.ordersByStatus.get(status)!.add(orderId);
  }

  private removeOrderFromStatusIndex(orderId: string, status: SwapStatus): void {
    const orders = this.orderBook.ordersByStatus.get(status);
    if (orders) {
      orders.delete(orderId);
      if (orders.size === 0) {
        this.orderBook.ordersByStatus.delete(status);
      }
    }
  }

  private addOrderToExpiryIndex(orderId: string, expiryTime: number): void {
    if (!this.orderBook.ordersByExpiry.has(expiryTime)) {
      this.orderBook.ordersByExpiry.set(expiryTime, new Set());
    }
    this.orderBook.ordersByExpiry.get(expiryTime)!.add(orderId);
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.metrics.totalOrders = this.orderBook.orders.size;
    this.metrics.activeOrders = this.getActiveOrders().length;
    this.metrics.completedOrders = this.getOrdersByStatus(SwapStatus.COMPLETED).length;
    this.metrics.failedOrders = this.getOrdersByStatus(SwapStatus.FAILED).length;
    this.metrics.expiredOrders = this.getOrdersByStatus(SwapStatus.EXPIRED).length;
  }

  /**
   * Initialize cleanup timer for expired orders
   */
  private initializeCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredOrders();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up expired orders
   */
  private async cleanupExpiredOrders(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const expiredOrders: string[] = [];

    // Check orders by expiry time
    for (const [expiryTime, orderIds] of this.orderBook.ordersByExpiry.entries()) {
      if (expiryTime <= now) {
        expiredOrders.push(...Array.from(orderIds));
      }
    }

    // Process expired orders
    for (const orderId of expiredOrders) {
      try {
        await this.expireOrder(orderId);
      } catch (error) {
        console.error(`Error expiring order ${orderId}:`, error);
      }
    }

    if (expiredOrders.length > 0) {
      console.log(`Cleaned up ${expiredOrders.length} expired orders`);
    }
  }

  /**
   * Helper methods for chain validation
   */
  private isSupportedChain(chainId: ChainId): boolean {
    const supportedChainIds = Object.values(SUPPORTED_CHAINS) as ChainId[];
    return supportedChainIds.includes(chainId);
  }

  private isETHChain(chainId: ChainId): boolean {
    return chainId === SUPPORTED_CHAINS.ETHEREUM_MAINNET || 
           chainId === SUPPORTED_CHAINS.ETHEREUM_SEPOLIA;
  }

  private isBTCChain(chainId: ChainId): boolean {
    return chainId === SUPPORTED_CHAINS.BITCOIN_MAINNET ||
           chainId === SUPPORTED_CHAINS.BITCOIN_TESTNET ||
           chainId === SUPPORTED_CHAINS.BITCOIN_REGTEST;
  }

  private getChainInfo(chainId: ChainId) {
    const chainNames: { [key: number]: { name: string; type: 'ethereum' | 'bitcoin' } } = {
      [SUPPORTED_CHAINS.ETHEREUM_MAINNET]: { name: 'Ethereum Mainnet', type: 'ethereum' },
      [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: { name: 'Ethereum Sepolia', type: 'ethereum' },
      [SUPPORTED_CHAINS.BITCOIN_MAINNET]: { name: 'Bitcoin Mainnet', type: 'bitcoin' },
      [SUPPORTED_CHAINS.BITCOIN_TESTNET]: { name: 'Bitcoin Testnet', type: 'bitcoin' },
      [SUPPORTED_CHAINS.BITCOIN_REGTEST]: { name: 'Bitcoin Regtest', type: 'bitcoin' }
    };

    const chainInfo = chainNames[chainId];
    if (!chainInfo) {
      throw new SwapError(`Unsupported chain ID: ${chainId}`, SwapErrorCode.CHAIN_ERROR);
    }

    return {
      chainId,
      name: chainInfo.name,
      type: chainInfo.type,
      rpcUrl: '', // Will be set by config
      confirmations: 1 // Will be set by config
    };
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Shutdown the order manager
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export default OrderManager;