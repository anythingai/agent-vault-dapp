import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  ChainId,
  Address,
  Amount,
  TransactionInfo,
  SwapError,
  SwapErrorCode,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS
} from '../shared/types.js';

import BitcoinClient from '../bitcoin/client.js';

export interface LiquidityBalance {
  chainId: ChainId;
  token: Address;
  available: Amount;
  reserved: Amount;
  total: Amount;
  lastUpdated: number;
  pendingTransactions: TransactionInfo[];
}

export interface LiquidityReservation {
  reservationId: string;
  orderId: string;
  chainId: ChainId;
  token: Address;
  amount: Amount;
  expiresAt: number;
  status: 'active' | 'expired' | 'released' | 'consumed';
  createdAt: number;
}

export interface RebalanceTarget {
  chainId: ChainId;
  token: Address;
  targetRatio: number; // Percentage of total liquidity (0-1)
  minAmount: Amount;
  maxAmount: Amount;
}

export interface RebalanceStrategy {
  name: string;
  enabled: boolean;
  triggerThreshold: number; // Deviation from target before rebalancing
  maxRebalanceAmount: Amount; // Maximum amount to rebalance in single operation
  cooldownPeriod: number; // Seconds between rebalance operations
  gasCostThreshold: Amount; // Maximum gas cost for rebalancing
}

export interface LiquidityManagerConfig {
  chains: {
    ethereum: {
      rpcUrl: string;
      chainId: ChainId;
      privateKey: string;
      tokens: Address[];
      confirmations: number;
    };
    bitcoin: {
      rpcUrl: string;
      rpcUser: string;
      rpcPassword: string;
      network: 'mainnet' | 'testnet' | 'regtest';
      privateKey: string;
      confirmations: number;
    };
  };
  rebalanceTargets: RebalanceTarget[];
  rebalanceStrategies: RebalanceStrategy[];
  reservationTimeout: number; // Default reservation timeout in seconds
  balanceUpdateInterval: number; // Balance check interval in ms
  minLiquidityThreshold: Amount; // Minimum liquidity before alerts
}

export interface LiquidityMetrics {
  totalLiquidity: {
    [chainId: string]: {
      [token: string]: Amount;
    };
  };
  availableLiquidity: {
    [chainId: string]: {
      [token: string]: Amount;
    };
  };
  reservedLiquidity: {
    [chainId: string]: {
      [token: string]: Amount;
    };
  };
  utilizationRate: number; // Percentage of liquidity currently reserved
  activeReservations: number;
  rebalanceOperations: number;
  lastRebalance: number;
}

export type LiquidityEventHandler = {
  balanceUpdated?: (balance: LiquidityBalance) => void;
  reservationCreated?: (reservation: LiquidityReservation) => void;
  reservationExpired?: (reservation: LiquidityReservation) => void;
  rebalanceStarted?: (source: ChainId, destination: ChainId, amount: Amount) => void;
  rebalanceCompleted?: (source: ChainId, destination: ChainId, txHash: string) => void;
  lowLiquidityAlert?: (chainId: ChainId, token: Address, available: Amount) => void;
  errorOccurred?: (error: Error, context: string) => void;
};

/**
 * Liquidity Manager - Manages available liquidity across chains
 * Handles balance tracking, reservations, and rebalancing strategies
 */
export class LiquidityManager {
  private config: LiquidityManagerConfig;
  private balances: Map<string, LiquidityBalance> = new Map();
  private reservations: Map<string, LiquidityReservation> = new Map();
  private bitcoinClient: BitcoinClient | null = null;
  private eventHandlers: LiquidityEventHandler = {};
  
  private balanceUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private reservationCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null;
  
  private lastRebalanceTime: Map<string, number> = new Map();
  private isShuttingDown: boolean = false;
  
  private metrics: LiquidityMetrics = {
    totalLiquidity: {},
    availableLiquidity: {},
    reservedLiquidity: {},
    utilizationRate: 0,
    activeReservations: 0,
    rebalanceOperations: 0,
    lastRebalance: 0
  };

  constructor(config: LiquidityManagerConfig) {
    this.config = config;
    this.initializeBitcoinClient();
    this.startPeriodicTasks();
    
    console.log('LiquidityManager initialized with:');
    console.log(`- Ethereum chain: ${config.chains.ethereum.chainId}`);
    console.log(`- Bitcoin network: ${config.chains.bitcoin.network}`);
    console.log(`- Rebalance targets: ${config.rebalanceTargets.length}`);
    console.log(`- Rebalance strategies: ${config.rebalanceStrategies.length}`);
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: LiquidityEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof LiquidityEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Initialize Bitcoin client
   */
  private initializeBitcoinClient(): void {
    try {
      this.bitcoinClient = new BitcoinClient({
        host: new URL(this.config.chains.bitcoin.rpcUrl).hostname,
        port: parseInt(new URL(this.config.chains.bitcoin.rpcUrl).port) || 8332,
        username: this.config.chains.bitcoin.rpcUser,
        password: this.config.chains.bitcoin.rpcPassword,
        network: this.config.chains.bitcoin.network
      });
      console.log('Bitcoin client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Bitcoin client:', error);
      this.emit('errorOccurred', error, 'bitcoin_client_init');
    }
  }

  /**
   * Get available liquidity for a specific token on a chain
   */
  async getAvailableLiquidity(chainId: ChainId, token: Address): Promise<Amount> {
    const key = this.getBalanceKey(chainId, token);
    const balance = this.balances.get(key);
    
    if (!balance) {
      await this.updateBalance(chainId, token);
      const updatedBalance = this.balances.get(key);
      return updatedBalance?.available || '0';
    }
    
    return balance.available;
  }

  /**
   * Check if sufficient liquidity is available for an order
   */
  async checkLiquidityAvailability(order: CrossChainSwapState): Promise<{
    available: boolean;
    sourceAvailable: Amount;
    destinationAvailable: Amount;
    deficit?: {
      source?: Amount;
      destination?: Amount;
    };
  }> {
    const sourceToken = this.getTokenFromOrder(order.sourceChain.chainId, order);
    const destToken = this.getTokenFromOrder(order.destinationChain.chainId, order);
    
    const sourceAvailable = await this.getAvailableLiquidity(order.sourceChain.chainId, sourceToken);
    const destAvailable = await this.getAvailableLiquidity(order.destinationChain.chainId, destToken);
    
    const sourceNeeded = order.amounts.source;
    const destNeeded = order.amounts.destination;
    
    const sourceEnough = BigInt(sourceAvailable) >= BigInt(sourceNeeded);
    const destEnough = BigInt(destAvailable) >= BigInt(destNeeded);
    
    const result = {
      available: sourceEnough && destEnough,
      sourceAvailable,
      destinationAvailable: destAvailable
    } as any;
    
    if (!sourceEnough || !destEnough) {
      result.deficit = {};
      if (!sourceEnough) {
        result.deficit.source = (BigInt(sourceNeeded) - BigInt(sourceAvailable)).toString();
      }
      if (!destEnough) {
        result.deficit.destination = (BigInt(destNeeded) - BigInt(destAvailable)).toString();
      }
    }
    
    return result;
  }

  /**
   * Reserve liquidity for a pending order
   */
  async reserveLiquidity(
    orderId: string,
    chainId: ChainId,
    token: Address,
    amount: Amount,
    expiresAt?: number
  ): Promise<LiquidityReservation> {
    const availableLiquidity = await this.getAvailableLiquidity(chainId, token);
    
    if (BigInt(availableLiquidity) < BigInt(amount)) {
      throw new SwapError(
        'Insufficient liquidity available for reservation',
        SwapErrorCode.INSUFFICIENT_LIQUIDITY,
        orderId,
        chainId
      );
    }
    
    const reservationId = this.generateReservationId();
    const reservation: LiquidityReservation = {
      reservationId,
      orderId,
      chainId,
      token,
      amount,
      expiresAt: expiresAt || (Math.floor(Date.now() / 1000) + this.config.reservationTimeout),
      status: 'active',
      createdAt: Math.floor(Date.now() / 1000)
    };
    
    // Store reservation
    this.reservations.set(reservationId, reservation);
    
    // Update available balance
    await this.updateReservedBalance(chainId, token, amount, 'reserve');
    
    this.emit('reservationCreated', reservation);
    return reservation;
  }

  /**
   * Release a liquidity reservation
   */
  async releaseLiquidity(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new SwapError('Reservation not found', SwapErrorCode.INVALID_ORDER);
    }
    
    if (reservation.status !== 'active') {
      return; // Already processed
    }
    
    reservation.status = 'released';
    
    // Update available balance
    await this.updateReservedBalance(
      reservation.chainId,
      reservation.token,
      reservation.amount,
      'release'
    );
    
    this.reservations.delete(reservationId);
  }

  /**
   * Consume a liquidity reservation (when order is executed)
   */
  async consumeLiquidity(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new SwapError('Reservation not found', SwapErrorCode.INVALID_ORDER);
    }
    
    if (reservation.status !== 'active') {
      throw new SwapError('Reservation is not active', SwapErrorCode.INVALID_ORDER);
    }
    
    reservation.status = 'consumed';
    
    // Update total balance (consumption reduces both reserved and total)
    const key = this.getBalanceKey(reservation.chainId, reservation.token);
    const balance = this.balances.get(key);
    
    if (balance) {
      const newReserved = (BigInt(balance.reserved) - BigInt(reservation.amount)).toString();
      const newTotal = (BigInt(balance.total) - BigInt(reservation.amount)).toString();
      
      balance.reserved = newReserved;
      balance.total = newTotal;
      balance.lastUpdated = Math.floor(Date.now() / 1000);
      
      this.emit('balanceUpdated', balance);
    }
    
    this.reservations.delete(reservationId);
  }

  /**
   * Update balance for a specific token on a chain
   */
  async updateBalance(chainId: ChainId, token: Address): Promise<void> {
    try {
      let available = '0';
      let total = '0';
      
      if (this.isBitcoinChain(chainId)) {
        // Bitcoin balance update
        if (this.bitcoinClient) {
          const keyPair = this.bitcoinClient.generateKeyPair();
          const balance = await this.bitcoinClient.getAddressBalance(keyPair.address);
          available = balance.toString();
          total = balance.toString();
        }
      } else {
        // Ethereum balance update - simplified for this implementation
        // In production, this would use web3/ethers to get actual balances
        available = this.getMockBalance(chainId, token);
        total = available;
      }
      
      const key = this.getBalanceKey(chainId, token);
      const existingBalance = this.balances.get(key);
      const reserved = existingBalance?.reserved || '0';
      
      // Calculate available after reservations
      const actualAvailable = BigInt(total) >= BigInt(reserved) 
        ? (BigInt(total) - BigInt(reserved)).toString()
        : '0';
      
      const balance: LiquidityBalance = {
        chainId,
        token,
        available: actualAvailable,
        reserved,
        total,
        lastUpdated: Math.floor(Date.now() / 1000),
        pendingTransactions: existingBalance?.pendingTransactions || []
      };
      
      this.balances.set(key, balance);
      this.emit('balanceUpdated', balance);
      
      // Check for low liquidity
      const minThreshold = BigInt(this.config.minLiquidityThreshold);
      if (BigInt(actualAvailable) < minThreshold) {
        this.emit('lowLiquidityAlert', chainId, token, actualAvailable);
      }
      
    } catch (error) {
      console.error(`Error updating balance for ${chainId}:${token}:`, error);
      this.emit('errorOccurred', error, 'balance_update');
    }
  }

  /**
   * Update all balances
   */
  async updateAllBalances(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // Update Ethereum balances
    for (const token of this.config.chains.ethereum.tokens) {
      promises.push(this.updateBalance(this.config.chains.ethereum.chainId, token));
    }
    
    // Update Bitcoin balance
    if (this.isBitcoinSupported()) {
      promises.push(this.updateBalance(this.getBitcoinChainId(), NATIVE_TOKEN_ADDRESS));
    }
    
    await Promise.allSettled(promises);
    this.updateMetrics();
  }

  /**
   * Execute liquidity rebalancing
   */
  async rebalanceLiquidity(): Promise<void> {
    if (this.isShuttingDown) return;
    
    try {
      const enabledStrategies = this.config.rebalanceStrategies.filter(s => s.enabled);
      
      for (const strategy of enabledStrategies) {
        await this.executeRebalanceStrategy(strategy);
      }
      
    } catch (error) {
      console.error('Error during liquidity rebalancing:', error);
      this.emit('errorOccurred', error, 'liquidity_rebalancing');
    }
  }

  /**
   * Execute a specific rebalance strategy
   */
  private async executeRebalanceStrategy(strategy: RebalanceStrategy): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const lastRebalance = this.lastRebalanceTime.get(strategy.name) || 0;
    
    // Check cooldown period
    if (now - lastRebalance < strategy.cooldownPeriod) {
      return;
    }
    
    for (const target of this.config.rebalanceTargets) {
      const currentBalance = await this.getAvailableLiquidity(target.chainId, target.token);
      const totalLiquidity = this.calculateTotalLiquidity(target.token);
      
      const currentRatio = parseFloat(currentBalance) / parseFloat(totalLiquidity);
      const deviation = Math.abs(currentRatio - target.targetRatio);
      
      // Check if rebalancing is needed
      if (deviation > strategy.triggerThreshold) {
        await this.executeRebalance(target, strategy, currentRatio, totalLiquidity);
        this.lastRebalanceTime.set(strategy.name, now);
        this.metrics.rebalanceOperations++;
        this.metrics.lastRebalance = now;
      }
    }
  }

  /**
   * Execute actual rebalancing operation
   */
  private async executeRebalance(
    target: RebalanceTarget,
    strategy: RebalanceStrategy,
    currentRatio: number,
    totalLiquidity: string
  ): Promise<void> {
    try {
      const targetAmount = parseFloat(totalLiquidity) * target.targetRatio;
      const currentAmount = parseFloat(totalLiquidity) * currentRatio;
      const rebalanceAmount = Math.abs(targetAmount - currentAmount);
      
      // Cap rebalance amount
      const maxRebalance = parseFloat(strategy.maxRebalanceAmount);
      const actualRebalanceAmount = Math.min(rebalanceAmount, maxRebalance);
      
      if (currentRatio < target.targetRatio) {
        // Need to add liquidity to this chain
        await this.addLiquidity(target.chainId, target.token, actualRebalanceAmount.toString());
      } else {
        // Need to remove liquidity from this chain
        await this.removeLiquidity(target.chainId, target.token, actualRebalanceAmount.toString());
      }
      
    } catch (error) {
      console.error('Error executing rebalance:', error);
      this.emit('errorOccurred', error, 'rebalance_execution');
    }
  }

  /**
   * Add liquidity to a chain (simplified implementation)
   */
  private async addLiquidity(chainId: ChainId, token: Address, amount: string): Promise<void> {
    console.log(`Adding liquidity: ${amount} of ${token} to chain ${chainId}`);
    this.emit('rebalanceStarted', chainId, chainId, amount);
    
    // In production, this would involve actual cross-chain transfers
    // For now, we'll just update the balance
    setTimeout(() => {
      this.updateBalance(chainId, token);
      this.emit('rebalanceCompleted', chainId, chainId, 'mock_tx_hash');
    }, 5000);
  }

  /**
   * Remove liquidity from a chain (simplified implementation)
   */
  private async removeLiquidity(chainId: ChainId, token: Address, amount: string): Promise<void> {
    console.log(`Removing liquidity: ${amount} of ${token} from chain ${chainId}`);
    this.emit('rebalanceStarted', chainId, chainId, amount);
    
    // In production, this would involve actual transfers to other chains
    setTimeout(() => {
      this.updateBalance(chainId, token);
      this.emit('rebalanceCompleted', chainId, chainId, 'mock_tx_hash');
    }, 5000);
  }

  /**
   * Get liquidity metrics
   */
  getMetrics(): LiquidityMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get all active reservations
   */
  getActiveReservations(): LiquidityReservation[] {
    return Array.from(this.reservations.values())
      .filter(r => r.status === 'active');
  }

  /**
   * Get balances for all chains and tokens
   */
  getAllBalances(): LiquidityBalance[] {
    return Array.from(this.balances.values());
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Balance updates
    this.balanceUpdateTimer = setInterval(() => {
      this.updateAllBalances();
    }, this.config.balanceUpdateInterval);
    
    // Reservation cleanup
    this.reservationCleanupTimer = setInterval(() => {
      this.cleanupExpiredReservations();
    }, 60000); // Every minute
    
    // Rebalancing
    this.rebalanceTimer = setInterval(() => {
      this.rebalanceLiquidity();
    }, 300000); // Every 5 minutes
    
    // Initial balance update
    this.updateAllBalances();
  }

  /**
   * Clean up expired reservations
   */
  private cleanupExpiredReservations(): void {
    const now = Math.floor(Date.now() / 1000);
    
    for (const [id, reservation] of this.reservations.entries()) {
      if (reservation.status === 'active' && now > reservation.expiresAt) {
        reservation.status = 'expired';
        
        // Release the reserved liquidity
        this.updateReservedBalance(
          reservation.chainId,
          reservation.token,
          reservation.amount,
          'release'
        );
        
        this.emit('reservationExpired', reservation);
        this.reservations.delete(id);
      }
    }
  }

  /**
   * Update reserved balance
   */
  private async updateReservedBalance(
    chainId: ChainId,
    token: Address,
    amount: Amount,
    operation: 'reserve' | 'release'
  ): Promise<void> {
    const key = this.getBalanceKey(chainId, token);
    const balance = this.balances.get(key);
    
    if (balance) {
      const amountBN = BigInt(amount);
      let newReserved: bigint;
      
      if (operation === 'reserve') {
        newReserved = BigInt(balance.reserved) + amountBN;
      } else {
        newReserved = BigInt(balance.reserved) - amountBN;
        if (newReserved < 0n) newReserved = 0n;
      }
      
      balance.reserved = newReserved.toString();
      balance.available = (BigInt(balance.total) - newReserved).toString();
      balance.lastUpdated = Math.floor(Date.now() / 1000);
      
      this.emit('balanceUpdated', balance);
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    const totalLiq: any = {};
    const availableLiq: any = {};
    const reservedLiq: any = {};
    
    let totalReserved = 0n;
    let totalAvailable = 0n;
    
    for (const balance of this.balances.values()) {
      const chainKey = balance.chainId.toString();
      const token = balance.token;
      
      if (!totalLiq[chainKey]) {
        totalLiq[chainKey] = {};
        availableLiq[chainKey] = {};
        reservedLiq[chainKey] = {};
      }
      
      totalLiq[chainKey][token] = balance.total;
      availableLiq[chainKey][token] = balance.available;
      reservedLiq[chainKey][token] = balance.reserved;
      
      totalReserved += BigInt(balance.reserved);
      totalAvailable += BigInt(balance.available);
    }
    
    const totalLiquidity = totalReserved + totalAvailable;
    const utilizationRate = totalLiquidity > 0n 
      ? Number(totalReserved * 100n / totalLiquidity)
      : 0;
    
    this.metrics = {
      totalLiquidity: totalLiq,
      availableLiquidity: availableLiq,
      reservedLiquidity: reservedLiq,
      utilizationRate,
      activeReservations: this.getActiveReservations().length,
      rebalanceOperations: this.metrics.rebalanceOperations,
      lastRebalance: this.metrics.lastRebalance
    };
  }

  /**
   * Helper methods
   */
  private getBalanceKey(chainId: ChainId, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }

  private generateReservationId(): string {
    return `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getTokenFromOrder(chainId: ChainId, order: CrossChainSwapState): Address {
    // Simplified - in production would extract from order details
    return NATIVE_TOKEN_ADDRESS;
  }

  private isBitcoinChain(chainId: ChainId): boolean {
    return [
      SUPPORTED_CHAINS.BITCOIN_MAINNET,
      SUPPORTED_CHAINS.BITCOIN_TESTNET,
      SUPPORTED_CHAINS.BITCOIN_REGTEST
    ].includes(chainId as any);
  }

  private isBitcoinSupported(): boolean {
    return this.bitcoinClient !== null;
  }

  private getBitcoinChainId(): ChainId {
    switch (this.config.chains.bitcoin.network) {
      case 'mainnet': return SUPPORTED_CHAINS.BITCOIN_MAINNET;
      case 'testnet': return SUPPORTED_CHAINS.BITCOIN_TESTNET;
      case 'regtest': return SUPPORTED_CHAINS.BITCOIN_REGTEST;
      default: return SUPPORTED_CHAINS.BITCOIN_TESTNET;
    }
  }

  private getMockBalance(chainId: ChainId, token: Address): string {
    // Mock balance for testing - in production would use actual blockchain queries
    const baseAmount = token === NATIVE_TOKEN_ADDRESS ? '10000000000000000000' : '1000000000000000000000';
    const variation = Math.random() * 0.2 - 0.1; // ±10% variation
    const amount = BigInt(baseAmount);
    const variationAmount = amount * BigInt(Math.floor(variation * 100)) / BigInt(100);
    return (amount + variationAmount).toString();
  }

  private calculateTotalLiquidity(token: Address): string {
    let total = 0n;
    
    for (const balance of this.balances.values()) {
      if (balance.token.toLowerCase() === token.toLowerCase()) {
        total += BigInt(balance.total);
      }
    }
    
    return total.toString();
  }

  /**
   * Shutdown the liquidity manager
   */
  shutdown(): void {
    console.log('Shutting down liquidity manager...');
    this.isShuttingDown = true;
    
    // Clear timers
    if (this.balanceUpdateTimer) {
      clearInterval(this.balanceUpdateTimer);
      this.balanceUpdateTimer = null;
    }
    
    if (this.reservationCleanupTimer) {
      clearInterval(this.reservationCleanupTimer);
      this.reservationCleanupTimer = null;
    }
    
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = null;
    }
    
    // Release all active reservations
    for (const reservation of this.reservations.values()) {
      if (reservation.status === 'active') {
        reservation.status = 'released';
      }
    }
    
    console.log('Liquidity manager shutdown complete');
  }
}

export default LiquidityManager;