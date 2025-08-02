import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  DutchAuctionParams,
  AuctionBid,
  ResolverInfo,
  SwapError,
  SwapErrorCode,
  Amount,
  Address,
  Hash
} from '../shared/types.js';

export interface AuctionConfig {
  defaultDuration: number; // seconds
  minBidIncrement: string; // minimum price improvement
  maxConcurrentAuctions: number;
  reserveRatio: number; // minimum price as ratio of starting price
  bidTimeoutWindow: number; // seconds to accept bids after auction end
}

export interface ActiveAuction {
  orderId: string;
  params: DutchAuctionParams;
  startTime: number;
  endTime: number;
  currentPrice: string;
  bestBid?: AuctionBid;
  bids: AuctionBid[];
  status: 'active' | 'ended' | 'settled' | 'cancelled';
  reservePrice: string;
}

export interface AuctionResult {
  orderId: string;
  winningBid?: AuctionBid;
  finalPrice: string;
  participantCount: number;
  duration: number;
}

export type AuctionEventHandler = {
  auctionStarted?: (auction: ActiveAuction) => void;
  bidPlaced?: (auction: ActiveAuction, bid: AuctionBid) => void;
  auctionEnded?: (auction: ActiveAuction) => void;
  auctionSettled?: (result: AuctionResult) => void;
  auctionCancelled?: (orderId: string, reason: string) => void;
};

/**
 * Dutch Auction Engine - Implements the Dutch auction mechanism for resolver selection
 * Supports linear and exponential price decay functions with multiple simultaneous auctions
 */
export class AuctionEngine {
  private config: AuctionConfig;
  private activeAuctions: Map<string, ActiveAuction> = new Map();
  private eventHandlers: AuctionEventHandler = {};
  private priceUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private auctionCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AuctionConfig) {
    this.config = config;
    this.initializeTimers();
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: AuctionEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof AuctionEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Start a new Dutch auction for a swap order
   */
  async startAuction(
    order: CrossChainSwapState,
    auctionParams?: Partial<DutchAuctionParams>
  ): Promise<ActiveAuction> {
    // Check if auction already exists for this order
    if (this.activeAuctions.has(order.orderId)) {
      throw new SwapError(
        'Auction already exists for this order',
        SwapErrorCode.INVALID_ORDER,
        order.orderId
      );
    }

    // Check concurrent auction limit
    if (this.activeAuctions.size >= this.config.maxConcurrentAuctions) {
      throw new SwapError(
        'Maximum concurrent auctions reached',
        SwapErrorCode.RESOLVER_UNAVAILABLE,
        order.orderId
      );
    }

    // Create auction parameters
    const params = this.createAuctionParams(order, auctionParams);
    
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + params.duration;
    
    // Calculate reserve price (minimum acceptable price)
    const startingPriceBN = BigInt(params.startingPrice);
    const reservePrice = (startingPriceBN * BigInt(Math.floor(this.config.reserveRatio * 1000)) / BigInt(1000)).toString();

    const auction: ActiveAuction = {
      orderId: order.orderId,
      params,
      startTime: now,
      endTime,
      currentPrice: params.startingPrice,
      bids: [],
      status: 'active',
      reservePrice
    };

    // Store the auction
    this.activeAuctions.set(order.orderId, auction);

    // Emit event
    this.emit('auctionStarted', auction);

    return auction;
  }

  /**
   * Place a bid in an active auction
   */
  async placeBid(
    orderId: string,
    resolver: Address,
    bidPrice: Amount,
    expiresAt?: number
  ): Promise<AuctionBid> {
    const auction = this.activeAuctions.get(orderId);
    if (!auction) {
      throw new SwapError(
        'Auction not found',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    if (auction.status !== 'active') {
      throw new SwapError(
        'Auction is not active',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    const now = Math.floor(Date.now() / 1000);
    
    // Allow bids during auction or within timeout window after end
    const isInBidWindow = now <= auction.endTime || 
                         (now <= auction.endTime + this.config.bidTimeoutWindow);
    
    if (!isInBidWindow) {
      throw new SwapError(
        'Bid window has closed',
        SwapErrorCode.TIMEOUT,
        orderId
      );
    }

    // Validate bid price
    const bidPriceBN = BigInt(bidPrice);
    const currentPriceBN = BigInt(auction.currentPrice);
    const reservePriceBN = BigInt(auction.reservePrice);

    if (bidPriceBN < reservePriceBN) {
      throw new SwapError(
        'Bid below reserve price',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // For Dutch auctions, bid must be at or above current price
    if (bidPriceBN < currentPriceBN) {
      throw new SwapError(
        'Bid below current price',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // Check minimum increment if there's an existing best bid
    if (auction.bestBid) {
      const bestBidPriceBN = BigInt(auction.bestBid.price);
      const minIncrementBN = BigInt(this.config.minBidIncrement);
      
      if (bidPriceBN <= bestBidPriceBN + minIncrementBN) {
        throw new SwapError(
          `Bid must be at least ${this.config.minBidIncrement} higher than current best bid`,
          SwapErrorCode.INVALID_ORDER,
          orderId
        );
      }
    }

    // Create the bid
    const bid: AuctionBid = {
      resolver,
      price: bidPrice,
      timestamp: now,
      expiresAt: expiresAt || (now + 300) // Default 5 minute expiry
    };

    // Add to auction
    auction.bids.push(bid);
    auction.bestBid = bid;

    // If auction was already ended, we can settle it immediately
    if (now > auction.endTime) {
      await this.settleAuction(orderId);
    }

    // Emit event
    this.emit('bidPlaced', auction, bid);

    return bid;
  }

  /**
   * Get current price for an active auction
   */
  getCurrentPrice(orderId: string): string {
    const auction = this.activeAuctions.get(orderId);
    if (!auction) {
      throw new SwapError('Auction not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    if (auction.status !== 'active') {
      return auction.currentPrice;
    }

    const now = Math.floor(Date.now() / 1000);
    const elapsedTime = now - auction.startTime;
    const totalDuration = auction.params.duration;

    if (elapsedTime >= totalDuration) {
      return auction.params.endingPrice;
    }

    const startPriceBN = BigInt(auction.params.startingPrice);
    const endPriceBN = BigInt(auction.params.endingPrice);
    
    let currentPrice: bigint;

    if (auction.params.priceFunction === 'linear') {
      // Linear decay: price = startPrice - (startPrice - endPrice) * (elapsed / duration)
      const priceRange = startPriceBN - endPriceBN;
      const priceDecay = priceRange * BigInt(elapsedTime) / BigInt(totalDuration);
      currentPrice = startPriceBN - priceDecay;
    } else {
      // Exponential decay: price = endPrice + (startPrice - endPrice) * e^(-k*t)
      // Using approximation for exponential function
      const decayFactor = this.calculateExponentialDecay(elapsedTime, totalDuration);
      const priceRange = startPriceBN - endPriceBN;
      const remainingValue = priceRange * BigInt(Math.floor(decayFactor * 1000)) / BigInt(1000);
      currentPrice = endPriceBN + remainingValue;
    }

    // Ensure price doesn't go below reserve price
    const reservePriceBN = BigInt(auction.reservePrice);
    if (currentPrice < reservePriceBN) {
      currentPrice = reservePriceBN;
    }

    // Update the auction's current price
    auction.currentPrice = currentPrice.toString();

    return auction.currentPrice;
  }

  /**
   * Settle an auction and determine the winner
   */
  async settleAuction(orderId: string): Promise<AuctionResult> {
    const auction = this.activeAuctions.get(orderId);
    if (!auction) {
      throw new SwapError('Auction not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    if (auction.status === 'settled') {
      throw new SwapError('Auction already settled', SwapErrorCode.INVALID_ORDER, orderId);
    }

    const now = Math.floor(Date.now() / 1000);
    
    // Mark auction as ended if it's still active
    if (auction.status === 'active') {
      auction.status = 'ended';
      this.emit('auctionEnded', auction);
    }

    // Filter valid bids (not expired)
    const validBids = auction.bids.filter(bid => now <= bid.expiresAt);
    
    let winningBid: AuctionBid | undefined;
    let finalPrice = auction.currentPrice;

    if (validBids.length > 0) {
      // Find the best valid bid (highest price)
      winningBid = validBids.reduce((best, current) => 
        BigInt(current.price) > BigInt(best.price) ? current : best
      );
      finalPrice = winningBid.price;
    }

    // Create auction result
    const result: AuctionResult = {
      orderId,
      winningBid,
      finalPrice,
      participantCount: new Set(auction.bids.map(b => b.resolver)).size,
      duration: now - auction.startTime
    };

    // Mark auction as settled
    auction.status = 'settled';
    auction.bestBid = winningBid;

    // Emit event
    this.emit('auctionSettled', result);

    return result;
  }

  /**
   * Cancel an active auction
   */
  async cancelAuction(orderId: string, reason: string): Promise<void> {
    const auction = this.activeAuctions.get(orderId);
    if (!auction) {
      throw new SwapError('Auction not found', SwapErrorCode.INVALID_ORDER, orderId);
    }

    if (auction.status === 'settled') {
      throw new SwapError('Cannot cancel settled auction', SwapErrorCode.INVALID_ORDER, orderId);
    }

    auction.status = 'cancelled';
    this.emit('auctionCancelled', orderId, reason);
  }

  /**
   * Get auction by order ID
   */
  getAuction(orderId: string): ActiveAuction | null {
    return this.activeAuctions.get(orderId) || null;
  }

  /**
   * Get all active auctions
   */
  getActiveAuctions(): ActiveAuction[] {
    return Array.from(this.activeAuctions.values())
      .filter(auction => auction.status === 'active');
  }

  /**
   * Get auction statistics
   */
  getAuctionStats() {
    const all = Array.from(this.activeAuctions.values());
    return {
      total: all.length,
      active: all.filter(a => a.status === 'active').length,
      ended: all.filter(a => a.status === 'ended').length,
      settled: all.filter(a => a.status === 'settled').length,
      cancelled: all.filter(a => a.status === 'cancelled').length
    };
  }

  /**
   * Create default auction parameters for an order
   */
  private createAuctionParams(
    order: CrossChainSwapState,
    overrides?: Partial<DutchAuctionParams>
  ): DutchAuctionParams {
    // Default starting price is 110% of the expected rate (to account for resolver profit)
    const expectedRate = this.calculateExpectedRate(order);
    const startingPrice = (BigInt(expectedRate) * BigInt(110) / BigInt(100)).toString();
    
    // Default ending price is 101% of expected rate (minimum viable profit)
    const endingPrice = (BigInt(expectedRate) * BigInt(101) / BigInt(100)).toString();

    return {
      startingPrice: overrides?.startingPrice || startingPrice,
      endingPrice: overrides?.endingPrice || endingPrice,
      duration: overrides?.duration || this.config.defaultDuration,
      priceFunction: overrides?.priceFunction || 'linear'
    };
  }

  /**
   * Calculate expected market rate for a swap
   */
  private calculateExpectedRate(order: CrossChainSwapState): string {
    // Simplified rate calculation - in production this would use
    // real market data from DEXs, oracles, etc.
    const sourceAmount = BigInt(order.amounts.source);
    const destAmount = BigInt(order.amounts.destination);
    
    // Basic rate calculation with some market premium
    const baseRate = destAmount * BigInt(10000) / sourceAmount; // 4 decimal precision
    const marketRate = baseRate * BigInt(102) / BigInt(100); // 2% market premium
    
    return (marketRate * sourceAmount / BigInt(10000)).toString();
  }

  /**
   * Calculate exponential decay factor
   */
  private calculateExponentialDecay(elapsedTime: number, totalDuration: number): number {
    // Use decay constant k = 3 for reasonable exponential curve
    const k = 3;
    const t = elapsedTime / totalDuration;
    return Math.exp(-k * t);
  }

  /**
   * Initialize timers for price updates and cleanup
   */
  private initializeTimers(): void {
    // Update prices every 10 seconds
    this.priceUpdateTimer = setInterval(() => {
      this.updateAuctionPrices();
    }, 10000);

    // Cleanup settled auctions every minute
    this.auctionCleanupTimer = setInterval(() => {
      this.cleanupAuctions();
    }, 60000);
  }

  /**
   * Update current prices for all active auctions
   */
  private updateAuctionPrices(): void {
    for (const auction of this.activeAuctions.values()) {
      if (auction.status === 'active') {
        try {
          this.getCurrentPrice(auction.orderId);
          
          // Check if auction should end
          const now = Math.floor(Date.now() / 1000);
          if (now >= auction.endTime) {
            auction.status = 'ended';
            this.emit('auctionEnded', auction);
          }
        } catch (error) {
          console.error(`Error updating price for auction ${auction.orderId}:`, error);
        }
      }
    }
  }

  /**
   * Clean up old settled and cancelled auctions
   */
  private cleanupAuctions(): void {
    const now = Math.floor(Date.now() / 1000);
    const cleanupThreshold = 3600; // 1 hour

    for (const [orderId, auction] of this.activeAuctions.entries()) {
      const isOld = (now - auction.endTime) > cleanupThreshold;
      const isFinalized = auction.status === 'settled' || auction.status === 'cancelled';
      
      if (isOld && isFinalized) {
        this.activeAuctions.delete(orderId);
      }
    }
  }

  /**
   * Shutdown the auction engine
   */
  shutdown(): void {
    if (this.priceUpdateTimer) {
      clearInterval(this.priceUpdateTimer);
      this.priceUpdateTimer = null;
    }

    if (this.auctionCleanupTimer) {
      clearInterval(this.auctionCleanupTimer);
      this.auctionCleanupTimer = null;
    }

    // Cancel all active auctions
    for (const auction of this.activeAuctions.values()) {
      if (auction.status === 'active') {
        auction.status = 'cancelled';
      }
    }
  }
}

export default AuctionEngine;