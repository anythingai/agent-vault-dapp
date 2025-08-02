import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  ConfigOptions,
  HealthCheck,
  SwapError,
  SwapErrorCode,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS
} from '../shared/types.js';

import StrategyEngine, { 
  StrategyEngineConfig, 
  ProfitabilityAnalysis,
  MarketData 
} from './strategyEngine.js';

import LiquidityManager, { 
  LiquidityManagerConfig,
  LiquidityBalance,
  LiquidityReservation,
  LiquidityMetrics 
} from './liquidityManager.js';

import AuctionParticipant, { 
  AuctionParticipantConfig,
  AuctionInfo,
  AuctionParticipation,
  AuctionMetrics 
} from './auctionParticipant.js';

import SwapExecutor, { 
  SwapExecutorConfig,
  SwapExecution,
  SwapExecutorMetrics 
} from './swapExecutor.js';

import RiskManager, { 
  RiskManagerConfig,
  RiskAssessment,
  RiskMetrics,
  ExposureLimit 
} from './riskManager.js';

export interface ResolverServiceConfig {
  service: {
    port: number;
    resolverAddress: string;
    btcAddress?: string;
    relayerUrl: string;
    enableHealthCheck: boolean;
    enableMetrics: boolean;
    gracefulShutdownTimeout: number; // ms
  };
  strategyEngine: StrategyEngineConfig;
  liquidityManager: LiquidityManagerConfig;
  auctionParticipant: AuctionParticipantConfig;
  swapExecutor: SwapExecutorConfig;
  riskManager: RiskManagerConfig;
}

export interface ResolverMetrics {
  uptime: number;
  totalOrders: number;
  successfulSwaps: number;
  failedSwaps: number;
  activeSwaps: number;
  totalProfit: string; // In USD
  successRate: number; // Percentage
  averageExecutionTime: number; // Seconds
  
  // Component metrics
  strategy: {
    totalAnalyses: number;
    averageAnalysisTime: number;
  };
  liquidity: LiquidityMetrics;
  auction: AuctionMetrics;
  execution: SwapExecutorMetrics;
  risk: RiskMetrics;
}

export interface ResolverStatus {
  service: string;
  status: 'initializing' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'error';
  version: string;
  uptime: number;
  components: {
    strategyEngine: 'online' | 'offline' | 'error';
    liquidityManager: 'online' | 'offline' | 'error';
    auctionParticipant: 'online' | 'offline' | 'error';
    swapExecutor: 'online' | 'offline' | 'error';
    riskManager: 'online' | 'offline' | 'error';
  };
  metrics: ResolverMetrics;
  lastError?: {
    timestamp: number;
    message: string;
    component: string;
  };
}

/**
 * Main Resolver Service - Orchestrates all resolver components
 * Provides a unified interface for cross-chain swap resolution
 */
export class ResolverService {
  private config: ResolverServiceConfig;
  
  // Core components
  private strategyEngine!: StrategyEngine;
  private liquidityManager!: LiquidityManager;
  private auctionParticipant!: AuctionParticipant;
  private swapExecutor!: SwapExecutor;
  private riskManager!: RiskManager;
  
  // Service state
  private status: ResolverStatus['status'] = 'initializing';
  private startTime: number = Date.now();
  private isShuttingDown: boolean = false;
  
  // Metrics and monitoring
  private metrics: ResolverMetrics = {
    uptime: 0,
    totalOrders: 0,
    successfulSwaps: 0,
    failedSwaps: 0,
    activeSwaps: 0,
    totalProfit: '0',
    successRate: 0,
    averageExecutionTime: 0,
    strategy: { totalAnalyses: 0, averageAnalysisTime: 0 },
    liquidity: {} as LiquidityMetrics,
    auction: {} as AuctionMetrics,
    execution: {} as SwapExecutorMetrics,
    risk: {} as RiskMetrics
  };
  
  // Active swaps tracking
  private activeSwaps: Map<string, SwapExecution> = new Map();
  private completedSwaps: Map<string, SwapExecution> = new Map();

  constructor(config: ResolverServiceConfig) {
    this.config = config;
    
    console.log('Initializing ResolverService...');
    console.log(`- Resolver Address: ${config.service.resolverAddress}`);
    console.log(`- Relayer URL: ${config.service.relayerUrl}`);
    console.log(`- Port: ${config.service.port}`);
    
    // Initialize components
    this.initializeComponents();
    
    // Setup component event handlers
    this.setupEventHandlers();
    
    console.log('ResolverService initialization complete');
  }

  /**
   * Initialize all core components
   */
  private initializeComponents(): void {
    try {
      // Initialize Strategy Engine
      this.strategyEngine = new StrategyEngine(this.config.strategyEngine);
      console.log('✓ Strategy Engine initialized');
      
      // Initialize Liquidity Manager
      this.liquidityManager = new LiquidityManager(this.config.liquidityManager);
      console.log('✓ Liquidity Manager initialized');
      
      // Initialize Swap Executor
      this.swapExecutor = new SwapExecutor(this.config.swapExecutor, this.liquidityManager);
      console.log('✓ Swap Executor initialized');
      
      // Initialize Auction Participant
      this.auctionParticipant = new AuctionParticipant(
        this.config.auctionParticipant,
        this.strategyEngine,
        this.liquidityManager
      );
      console.log('✓ Auction Participant initialized');
      
      // Initialize Risk Manager
      this.riskManager = new RiskManager(this.config.riskManager);
      console.log('✓ Risk Manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize components:', error);
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Setup event handlers for all components
   */
  private setupEventHandlers(): void {
    // Strategy Engine events
    this.strategyEngine.setEventHandlers({
      analysisCompleted: (analysis: ProfitabilityAnalysis) => {
        this.metrics.strategy.totalAnalyses++;
        console.log(`Strategy analysis completed for order ${analysis.orderId}: ${analysis.recommendation}`);
      },
      
      errorOccurred: (error: Error, context: string) => {
        console.error(`Strategy Engine error in ${context}:`, error);
        this.updateLastError('strategyEngine', error.message);
      }
    });

    // Liquidity Manager events
    this.liquidityManager.setEventHandlers({
      balanceUpdated: (balance: LiquidityBalance) => {
        console.log(`Balance updated for ${balance.chainId}:${balance.token} - Available: ${balance.available}`);
      },
      
      reservationCreated: (reservation: LiquidityReservation) => {
        console.log(`Liquidity reserved: ${reservation.amount} for order ${reservation.orderId}`);
      },
      
      lowLiquidityAlert: (chainId, token, available) => {
        console.warn(`Low liquidity alert: Chain ${chainId}, Token ${token}, Available: ${available}`);
      },
      
      errorOccurred: (error: Error, context: string) => {
        console.error(`Liquidity Manager error in ${context}:`, error);
        this.updateLastError('liquidityManager', error.message);
      }
    });

    // Auction Participant events
    this.auctionParticipant.setEventHandlers({
      auctionDiscovered: (auction: AuctionInfo) => {
        console.log(`New auction discovered: ${auction.orderId} - Current price: ${auction.currentPrice}`);
      },
      
      bidPlaced: (participation: AuctionParticipation, bid) => {
        console.log(`Bid placed: ${bid.price} for auction ${participation.auctionId}`);
      },
      
      auctionWon: (participation: AuctionParticipation, winningBid) => {
        console.log(`🎉 Won auction ${participation.auctionId} with bid ${winningBid.price}`);
        this.handleAuctionWon(participation);
      },
      
      auctionLost: (participation: AuctionParticipation) => {
        console.log(`Lost auction ${participation.auctionId}`);
      },
      
      errorOccurred: (error: Error, context: string, auctionId?: string) => {
        console.error(`Auction Participant error in ${context}${auctionId ? ` (${auctionId})` : ''}:`, error);
        this.updateLastError('auctionParticipant', error.message);
      }
    });

    // Swap Executor events
    this.swapExecutor.setEventHandlers({
      executionStarted: (execution: SwapExecution) => {
        this.activeSwaps.set(execution.orderId, execution);
        this.metrics.activeSwaps++;
        console.log(`Swap execution started for order ${execution.orderId}`);
      },
      
      transactionSubmitted: (execution: SwapExecution, tx) => {
        console.log(`Transaction submitted: ${tx.txHash} for order ${execution.orderId}`);
      },
      
      transactionConfirmed: (execution: SwapExecution, tx) => {
        console.log(`Transaction confirmed: ${tx.txHash} (${tx.confirmations}/${tx.requiredConfirmations})`);
      },
      
      secretRevealed: (execution: SwapExecution, secret: string) => {
        console.log(`Secret revealed for order ${execution.orderId}`);
      },
      
      executionCompleted: (execution: SwapExecution) => {
        this.handleSwapCompleted(execution);
      },
      
      executionFailed: (execution: SwapExecution, error) => {
        this.handleSwapFailed(execution, error);
      }
    });

    // Risk Manager events
    this.riskManager.setEventHandlers({
      riskAssessmentCompleted: (assessment: RiskAssessment) => {
        console.log(`Risk assessment completed for ${assessment.orderId}: ${assessment.approved ? 'APPROVED' : 'REJECTED'} (Risk: ${assessment.riskScore}, Confidence: ${assessment.confidenceScore})`);
      },
      
      exposureLimitReached: (limit: ExposureLimit) => {
        console.warn(`Exposure limit reached: ${limit.type} ${limit.identifier} - ${(limit.utilizationRate * 100).toFixed(1)}% utilized`);
      },
      
      circuitBreakerTriggered: (breaker, reason) => {
        console.error(`🚨 Circuit breaker triggered: ${breaker.name} - ${reason}`);
      },
      
      emergencyStop: (reason: string) => {
        console.error(`🛑 EMERGENCY STOP: ${reason}`);
        this.status = 'error';
      },
      
      highRiskAlert: (orderId: string, riskScore: number, reasons: string[]) => {
        console.warn(`High risk order detected: ${orderId} (Score: ${riskScore}) - ${reasons.join(', ')}`);
      }
    });
  }

  /**
   * Start the resolver service
   */
  async start(): Promise<void> {
    try {
      console.log('Starting ResolverService...');
      this.status = 'initializing';
      
      // Start core components
      console.log('Starting core components...');
      
      // Start components that have async initialization
      await this.swapExecutor.start();
      await this.auctionParticipant.start();
      await this.riskManager.start();
      
      // Update initial state
      try {
        await this.liquidityManager.updateAllBalances();
      } catch (error) {
        console.warn('Initial liquidity update failed:', error);
      }
      
      this.status = 'running';
      this.startTime = Date.now();
      
      console.log('🚀 ResolverService started successfully!');
      console.log('Components status:');
      console.log('  - Strategy Engine: ✓ Online');
      console.log('  - Liquidity Manager: ✓ Online');
      console.log('  - Auction Participant: ✓ Online');
      console.log('  - Swap Executor: ✓ Online');
      console.log('  - Risk Manager: ✓ Online');
      
      // Start metrics collection
      this.startMetricsCollection();
      
    } catch (error) {
      console.error('Failed to start ResolverService:', error);
      this.status = 'error';
      this.updateLastError('service', (error as Error).message);
      throw error;
    }
  }

  /**
   * Stop the resolver service gracefully
   */
  async stop(): Promise<void> {
    console.log('Stopping ResolverService...');
    this.isShuttingDown = true;
    this.status = 'stopping';
    
    const timeout = this.config.service.gracefulShutdownTimeout;
    const shutdownPromise = this.performGracefulShutdown();
    
    try {
      // Wait for graceful shutdown or timeout
      await Promise.race([
        shutdownPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Shutdown timeout')), timeout)
        )
      ]);
      
      console.log('✓ ResolverService stopped gracefully');
      
    } catch (error) {
      console.warn('Graceful shutdown timeout, forcing stop...');
      await this.forceStop();
    }
    
    this.status = 'stopped';
  }

  /**
   * Perform graceful shutdown
   */
  private async performGracefulShutdown(): Promise<void> {
    // Stop accepting new work
    console.log('Stopping auction participation...');
    await this.auctionParticipant.stop();
    
    // Wait for active swaps to complete
    console.log(`Waiting for ${this.activeSwaps.size} active swaps to complete...`);
    const maxWait = 60000; // 1 minute
    const start = Date.now();
    
    while (this.activeSwaps.size > 0 && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Stop remaining components
    console.log('Stopping remaining components...');
    await Promise.all([
      this.swapExecutor.stop(),
      this.riskManager.stop()
    ]);
    
    // Stop components with optional shutdown methods
    try {
      this.liquidityManager.shutdown();
    } catch (error) {
      console.warn('Error shutting down liquidity manager:', error);
    }
    
    try {
      this.strategyEngine.shutdown();
    } catch (error) {
      console.warn('Error shutting down strategy engine:', error);
    }
  }

  /**
   * Force stop all components
   */
  private async forceStop(): Promise<void> {
    // Cancel all active swaps
    for (const [orderId, execution] of this.activeSwaps.entries()) {
      try {
        await this.swapExecutor.cancelExecution?.(orderId);
      } catch (error) {
        console.warn(`Error cancelling execution ${orderId}:`, error);
      }
    }
    
    // Force stop all components
    this.strategyEngine.shutdown?.();
    this.liquidityManager.shutdown?.();
    this.auctionParticipant.stop?.();
    this.swapExecutor.stop?.();
    this.riskManager.stop?.();
  }

  /**
   * Handle auction won - start swap execution
   */
  private async handleAuctionWon(participation: AuctionParticipation): Promise<void> {
    try {
      const order = participation.profitabilityAnalysis?.orderId;
      if (!order || !participation.reservationId) {
        throw new Error('Missing order information or reservation');
      }
      
      // Get the full order details (in production, fetch from relayer)
      const mockOrder: CrossChainSwapState = {
        orderId: order,
        status: SwapStatus.RESOLVER_SELECTED,
        sourceChain: { chainId: 1, name: 'Ethereum', type: 'ethereum', rpcUrl: '', confirmations: 3 },
        destinationChain: { chainId: 100, name: 'Bitcoin', type: 'bitcoin', rpcUrl: '', confirmations: 1 },
        maker: 'mock_maker_address',
        resolver: this.config.service.resolverAddress,
        secretHash: 'mock_secret_hash',
        amounts: { source: '1000000000000000000', destination: '10000000' },
        addresses: {},
        transactions: {},
        timelocks: { source: Math.floor(Date.now() / 1000) + 7200, destination: Math.floor(Date.now() / 1000) + 3600 },
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000)
      };
      
      // Generate secret for execution
      const secret = this.generateSecret();
      
      // Start swap execution
      await this.swapExecutor.executeSwap(mockOrder, participation.reservationId, secret);
      
      this.metrics.totalOrders++;
      
    } catch (error) {
      console.error('Error handling auction won:', error);
      this.updateLastError('service', (error as Error).message);
    }
  }

  /**
   * Handle completed swap
   */
  private handleSwapCompleted(execution: SwapExecution): void {
    this.activeSwaps.delete(execution.orderId);
    this.completedSwaps.set(execution.orderId, execution);
    
    this.metrics.successfulSwaps++;
    this.metrics.activeSwaps = this.activeSwaps.size;
    
    // Calculate profit (simplified)
    const profit = this.calculateSwapProfit(execution);
    const currentProfit = parseFloat(this.metrics.totalProfit);
    this.metrics.totalProfit = (currentProfit + profit).toString();
    
    console.log(`✅ Swap completed successfully: ${execution.orderId} (Profit: $${profit.toFixed(2)})`);
  }

  /**
   * Handle failed swap
   */
  private handleSwapFailed(execution: SwapExecution, error: any): void {
    this.activeSwaps.delete(execution.orderId);
    
    this.metrics.failedSwaps++;
    this.metrics.activeSwaps = this.activeSwaps.size;
    
    console.error(`❌ Swap failed: ${execution.orderId} - ${error.error}`);
  }

  /**
   * Get service health status
   */
  getHealth(): HealthCheck {
    return {
      service: 'resolver',
      status: this.status === 'running' ? 'healthy' : 
              this.status === 'error' ? 'unhealthy' : 'degraded',
      timestamp: Math.floor(Date.now() / 1000),
      details: {
        uptime: Date.now() - this.startTime,
        components: this.getComponentStatus(),
        metrics: this.getMetrics()
      }
    };
  }

  /**
   * Get comprehensive service status
   */
  getStatus(): ResolverStatus {
    return {
      service: 'resolver',
      status: this.status,
      version: '1.0.0',
      uptime: Date.now() - this.startTime,
      components: this.getComponentStatus(),
      metrics: this.getMetrics(),
      lastError: this.metrics as any
    };
  }

  /**
   * Get service metrics
   */
  getMetrics(): ResolverMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get component status
   */
  private getComponentStatus(): ResolverStatus['components'] {
    return {
      strategyEngine: this.isComponentHealthy('strategyEngine') ? 'online' : 'error',
      liquidityManager: this.isComponentHealthy('liquidityManager') ? 'online' : 'error',
      auctionParticipant: this.isComponentHealthy('auctionParticipant') ? 'online' : 'error',
      swapExecutor: this.isComponentHealthy('swapExecutor') ? 'online' : 'error',
      riskManager: this.isComponentHealthy('riskManager') ? 'online' : 'error'
    };
  }

  /**
   * Check if a component is healthy
   */
  private isComponentHealthy(component: string): boolean {
    // In a real implementation, this would check component-specific health
    return this.status === 'running';
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      if (!this.isShuttingDown) {
        this.updateMetrics();
      }
    }, 30000); // Update every 30 seconds
  }

  /**
   * Update service metrics
   */
  private updateMetrics(): void {
    this.metrics.uptime = Date.now() - this.startTime;
    this.metrics.activeSwaps = this.activeSwaps.size;
    
    // Update success rate
    const totalSwaps = this.metrics.successfulSwaps + this.metrics.failedSwaps;
    this.metrics.successRate = totalSwaps > 0 
      ? (this.metrics.successfulSwaps / totalSwaps) * 100 
      : 0;
    
    // Update component metrics
    try {
      this.metrics.strategy = this.strategyEngine.getStrategyMetrics?.() || this.metrics.strategy;
    } catch (error) {
      // Strategy metrics not available
    }
    
    this.metrics.liquidity = this.liquidityManager.getMetrics();
    this.metrics.auction = this.auctionParticipant.getMetrics();
    this.metrics.execution = this.swapExecutor.getMetrics();
    this.metrics.risk = this.riskManager.getMetrics();
    
    // Calculate average execution time
    if (this.completedSwaps.size > 0) {
      const totalTime = Array.from(this.completedSwaps.values())
        .reduce((sum, exec) => sum + (exec.lastActivity - exec.executionStarted), 0);
      this.metrics.averageExecutionTime = totalTime / this.completedSwaps.size;
    }
  }

  /**
   * Update last error information
   */
  private updateLastError(component: string, message: string): void {
    (this.metrics as any).lastError = {
      timestamp: Math.floor(Date.now() / 1000),
      message,
      component
    };
  }

  /**
   * Generate secret for swap execution
   */
  private generateSecret(): string {
    // In production, this would be a proper cryptographic secret
    return Math.random().toString(36).substring(2, 34);
  }

  /**
   * Calculate profit from a completed swap
   */
  private calculateSwapProfit(execution: SwapExecution): number {
    // Simplified profit calculation
    // In production, this would consider actual market prices and execution costs
    const baseProfit = parseFloat(execution.order.amounts.destination) * 0.001; // 0.1% profit
    return baseProfit;
  }
}

/**
 * Factory function to create ResolverService with default configuration
 */
export function createResolverService(overrides: Partial<ResolverServiceConfig> = {}): ResolverService {
  const defaultConfig: ResolverServiceConfig = {
    service: {
      port: 3002,
      resolverAddress: '0x742d35Cc6566C02B6b3f5bdAE9d8a3c23d5E7546',
      relayerUrl: 'http://localhost:3001',
      enableHealthCheck: true,
      enableMetrics: true,
      gracefulShutdownTimeout: 30000
    },
    strategyEngine: {
      strategies: [
        { name: 'marketmaking', enabled: true, weight: 1, params: { minProfitMargin: 0.5, maxRiskScore: 70, confidenceThreshold: 0.6, gasBuffer: 1.2 } },
        { name: 'arbitrage', enabled: true, weight: 1, params: { minProfitMargin: 1.0, maxRiskScore: 60, confidenceThreshold: 0.7, gasBuffer: 1.5 } },
        { name: 'riskaverse', enabled: true, weight: 0.5, params: { minProfitMargin: 2.0, maxRiskScore: 40, confidenceThreshold: 0.8, gasBuffer: 2.0 } }
      ],
      marketDataSources: ['mock'],
      defaultGasEstimates: {
        ethereum: { escrowCreation: '200000', escrowRedeem: '100000', escrowRefund: '80000' },
        bitcoin: { htlcFunding: '250', htlcRedeem: '150', htlcRefund: '150' }
      },
      updateInterval: 30000,
      maxAnalysisTime: 5000
    },
    liquidityManager: {
      chains: {
        ethereum: {
          rpcUrl: 'http://localhost:8545',
          chainId: 1,
          privateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
          tokens: [NATIVE_TOKEN_ADDRESS],
          confirmations: 3
        },
        bitcoin: {
          rpcUrl: 'http://localhost:8332',
          rpcUser: 'user',
          rpcPassword: 'pass',
          network: 'regtest',
          privateKey: 'cVpF924EspNh8KjYsfhgY96mmxvT6DgdWiTYMtMjuM74hJaU5psW',
          confirmations: 1
        }
      },
      rebalanceTargets: [],
      rebalanceStrategies: [],
      reservationTimeout: 3600,
      balanceUpdateInterval: 60000,
      minLiquidityThreshold: '100000000000000000'
    },
    auctionParticipant: {
      relayerUrl: 'http://localhost:3001',
      resolverAddress: '0x742d35Cc6566C02B6b3f5bdAE9d8a3c23d5E7546',
      bidTimeout: 30000,
      maxConcurrentAuctions: 50,
      biddingStrategies: [
        {
          name: 'aggressive',
          enabled: true,
          priority: 1,
          params: {
            maxBidPrice: '1000000000000000000',
            minProfitMargin: 0.5,
            aggressiveness: 0.8,
            reserveRatio: 0.95,
            timeStrategy: 'dynamic',
            riskTolerance: 70
          }
        }
      ],
      monitoring: {
        pollInterval: 5000,
        priceUpdateInterval: 2000,
        reconnectDelay: 5000
      },
      networking: {
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 10000
      }
    },
    swapExecutor: {
      ethereum: {
        rpcUrl: 'http://localhost:8545',
        chainId: 1,
        privateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
        gasLimit: {
          escrowCreation: '200000',
          escrowRedeem: '100000',
          escrowRefund: '80000'
        },
        gasPrice: {
          standard: '20000000000',
          fast: '50000000000',
          rapid: '100000000000'
        },
        confirmations: 3
      },
      bitcoin: {
        rpcUrl: 'http://localhost:8332',
        rpcUser: 'user',
        rpcPassword: 'pass',
        network: 'regtest',
        privateKey: 'cVpF924EspNh8KjYsfhgY96mmxvT6DgdWiTYMtMjuM74hJaU5psW',
        feeRate: { standard: 10, fast: 20, rapid: 50 },
        confirmations: 1
      },
      execution: {
        maxRetries: 3,
        retryDelay: 5000,
        retryBackoff: 1.5,
        transactionTimeout: 300000,
        secretRevealDelay: 60000,
        maxConcurrentExecutions: 10
      },
      monitoring: {
        pollInterval: 10000,
        confirmationThreshold: 1,
        staleTransactionTimeout: 600000
      }
    },
    riskManager: {
      riskProfile: {
        maxExposurePerChain: {
          '1': '10000000000000000000', // 10 ETH
          '100': '100000000' // 1 BTC in sats
        },
        maxExposurePerToken: {
          [NATIVE_TOKEN_ADDRESS]: '20000000000000000000' // 20 ETH equivalent
        },
        maxSingleOrderSize: '5000000000000000000', // 5 ETH
        maxDailyVolume: '50000000000000000000', // 50 ETH
        maxConcurrentOrders: 20,
        allowedCounterparties: [],
        blockedCounterparties: [],
        minConfidenceScore: 60,
        maxRiskScore: 80
      },
      circuitBreakers: [
        {
          name: 'high_exposure',
          enabled: true,
          condition: { type: 'exposure_threshold', threshold: 0.9, timeWindow: 300 },
          action: { type: 'pause', duration: 3600 },
          triggered: false,
          triggerCount: 0
        }
      ],
      monitoring: {
        assessmentInterval: 30000,
        metricsUpdateInterval: 60000,
        alertThresholds: { highRisk: 80, highExposure: 0.8, lowConfidence: 50 }
      },
      volatilityThresholds: { low: 0.02, medium: 0.05, high: 0.1 },
      positionSizing: {
        baseSize: '1000000000000000000', // 1 ETH
        maxSize: '5000000000000000000', // 5 ETH
        confidenceMultiplier: 1.5,
        riskDivisor: 2.0
      }
    }
  };

  // Deep merge configuration
  const config = mergeDeep(defaultConfig, overrides);
  
  return new ResolverService(config);
}

/**
 * Deep merge utility function
 */
function mergeDeep(target: any, source: any): any {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = mergeDeep(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

export default ResolverService;