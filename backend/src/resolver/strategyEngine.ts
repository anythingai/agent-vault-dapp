import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  ResolverStrategy,
  SwapError,
  SwapErrorCode,
  Amount,
  Address,
  ChainId,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS
} from '../shared/types.js';

export interface MarketData {
  chainId: ChainId;
  token: Address;
  price: string; // USD price
  liquidity: string; // Available liquidity
  spread: number; // Bid-ask spread as percentage
  volatility: number; // Price volatility
  lastUpdated: number;
}

export interface ProfitabilityAnalysis {
  orderId: string;
  strategy: string;
  expectedProfit: string; // In USD
  profitMargin: number; // As percentage
  riskScore: number; // 0-100 scale
  confidence: number; // 0-1 scale
  gasEstimate: {
    ethereum: string;
    bitcoin: string;
  };
  netProfit: string; // After gas costs
  breakEvenPrice: string;
  recommendation: 'accept' | 'reject' | 'monitor';
  reasoning: string[];
}

export interface StrategyConfig {
  name: string;
  enabled: boolean;
  weight: number; // Strategy weight in ensemble decisions
  params: {
    minProfitMargin: number; // Minimum profit margin %
    maxRiskScore: number; // Maximum acceptable risk score
    confidenceThreshold: number; // Minimum confidence level
    gasBuffer: number; // Gas cost buffer multiplier
    [key: string]: any;
  };
}

export interface StrategyEngineConfig {
  strategies: StrategyConfig[];
  marketDataSources: string[];
  defaultGasEstimates: {
    ethereum: {
      escrowCreation: string;
      escrowRedeem: string;
      escrowRefund: string;
    };
    bitcoin: {
      htlcFunding: string;
      htlcRedeem: string;
      htlcRefund: string;
    };
  };
  updateInterval: number; // Market data update interval in ms
  maxAnalysisTime: number; // Max time for analysis in ms
}

export type StrategyEventHandler = {
  analysisCompleted?: (analysis: ProfitabilityAnalysis) => void;
  marketDataUpdated?: (data: MarketData[]) => void;
  strategyEnabled?: (strategyName: string) => void;
  strategyDisabled?: (strategyName: string, reason: string) => void;
  errorOccurred?: (error: Error, context: string) => void;
};

/**
 * Strategy Engine - Implements different trading strategies for order evaluation
 * Supports multiple strategies: market making, arbitrage, risk assessment
 */
export class StrategyEngine {
  private config: StrategyEngineConfig;
  private strategies: Map<string, Strategy> = new Map();
  private marketData: Map<string, MarketData> = new Map();
  private eventHandlers: StrategyEventHandler = {};
  private marketDataTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: StrategyEngineConfig) {
    this.config = config;
    this.initializeStrategies();
    this.startMarketDataUpdates();
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: StrategyEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof StrategyEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Analyze order profitability using all enabled strategies
   */
  async analyzeOrder(order: CrossChainSwapState): Promise<ProfitabilityAnalysis> {
    const startTime = Date.now();

    try {
      // Get market data for the relevant tokens
      const sourceMarketData = this.getMarketData(order.sourceChain.chainId, order.amounts.source);
      const destMarketData = this.getMarketData(order.destinationChain.chainId, order.amounts.destination);

      const analyses: ProfitabilityAnalysis[] = [];

      // Run all enabled strategies
      for (const strategy of this.strategies.values()) {
        if (!strategy.isEnabled()) continue;

        try {
          const analysis = await strategy.analyze(order, sourceMarketData, destMarketData);
          analyses.push(analysis);
        } catch (error) {
          console.warn(`Strategy ${strategy.getName()} analysis failed:`, error);
          this.emit('errorOccurred', error, `strategy_${strategy.getName()}`);
        }
      }

      if (analyses.length === 0) {
        throw new SwapError(
          'No strategies available for analysis',
          SwapErrorCode.RESOLVER_UNAVAILABLE,
          order.orderId
        );
      }

      // Combine results using weighted average
      const combinedAnalysis = this.combineAnalyses(analyses, order);

      // Check analysis timeout
      const analysisTime = Date.now() - startTime;
      if (analysisTime > this.config.maxAnalysisTime) {
        console.warn(`Analysis took ${analysisTime}ms, exceeding limit of ${this.config.maxAnalysisTime}ms`);
      }

      this.emit('analysisCompleted', combinedAnalysis);
      return combinedAnalysis;

    } catch (error) {
      this.emit('errorOccurred', error, 'order_analysis');
      throw error;
    }
  }

  /**
   * Get current market data for a token
   */
  getMarketData(chainId: ChainId, token: Address): MarketData | null {
    const key = `${chainId}:${token.toLowerCase()}`;
    return this.marketData.get(key) || null;
  }

  /**
   * Update market data for a token
   */
  updateMarketData(data: MarketData): void {
    const key = `${data.chainId}:${data.token.toLowerCase()}`;
    this.marketData.set(key, data);
  }

  /**
   * Get strategy by name
   */
  getStrategy(name: string): Strategy | null {
    return this.strategies.get(name) || null;
  }

  /**
   * Enable strategy
   */
  enableStrategy(name: string): void {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.enable();
      this.emit('strategyEnabled', name);
    }
  }

  /**
   * Disable strategy
   */
  disableStrategy(name: string, reason: string = 'Manual disable'): void {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.disable();
      this.emit('strategyDisabled', name, reason);
    }
  }

  /**
   * Get strategy metrics
   */
  getStrategyMetrics(): any {
    const metrics: any = {};
    
    for (const [name, strategy] of this.strategies.entries()) {
      metrics[name] = strategy.getMetrics();
    }

    return {
      strategies: metrics,
      marketDataEntries: this.marketData.size,
      lastMarketUpdate: this.getLastMarketUpdateTime()
    };
  }

  /**
   * Initialize strategies based on configuration
   */
  private initializeStrategies(): void {
    for (const config of this.config.strategies) {
      let strategy: Strategy;

      switch (config.name.toLowerCase()) {
        case 'marketmaking':
          strategy = new MarketMakingStrategy(config);
          break;
        case 'arbitrage':
          strategy = new ArbitrageStrategy(config);
          break;
        case 'riskaverse':
          strategy = new RiskAverseStrategy(config);
          break;
        default:
          console.warn(`Unknown strategy: ${config.name}`);
          continue;
      }

      this.strategies.set(config.name, strategy);
      console.log(`Initialized strategy: ${config.name} (enabled: ${config.enabled})`);
    }
  }

  /**
   * Start periodic market data updates
   */
  private startMarketDataUpdates(): void {
    if (this.config.updateInterval > 0) {
      this.marketDataTimer = setInterval(() => {
        this.updateAllMarketData();
      }, this.config.updateInterval);
    }
  }

  /**
   * Update market data for all tracked tokens
   */
  private async updateAllMarketData(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      // Mock market data updates - in production this would fetch from real sources
      const updates: MarketData[] = [];

      // ETH data
      updates.push({
        chainId: SUPPORTED_CHAINS.ETHEREUM_MAINNET,
        token: NATIVE_TOKEN_ADDRESS,
        price: this.getMockPrice('ETH'),
        liquidity: '100000000000000000000000', // 100,000 ETH
        spread: 0.001, // 0.1%
        volatility: 0.02, // 2%
        lastUpdated: Math.floor(Date.now() / 1000)
      });

      // BTC data
      updates.push({
        chainId: SUPPORTED_CHAINS.BITCOIN_MAINNET,
        token: NATIVE_TOKEN_ADDRESS,
        price: this.getMockPrice('BTC'),
        liquidity: '10000000000', // 100 BTC in sats
        spread: 0.001, // 0.1%
        volatility: 0.03, // 3%
        lastUpdated: Math.floor(Date.now() / 1000)
      });

      // Update internal storage
      for (const data of updates) {
        this.updateMarketData(data);
      }

      this.emit('marketDataUpdated', updates);

    } catch (error) {
      console.error('Error updating market data:', error);
      this.emit('errorOccurred', error, 'market_data_update');
    }
  }

  /**
   * Combine multiple strategy analyses into a single result
   */
  private combineAnalyses(analyses: ProfitabilityAnalysis[], order: CrossChainSwapState): ProfitabilityAnalysis {
    const totalWeight = this.config.strategies
      .filter(s => s.enabled)
      .reduce((sum, s) => sum + s.weight, 0);

    let weightedProfit = 0;
    let weightedMargin = 0;
    let weightedRisk = 0;
    let weightedConfidence = 0;
    let allReasons: string[] = [];

    // Calculate weighted averages
    for (const analysis of analyses) {
      const strategyConfig = this.config.strategies.find(s => s.name === analysis.strategy);
      const weight = strategyConfig?.weight || 1;
      const normalizedWeight = weight / totalWeight;

      weightedProfit += parseFloat(analysis.expectedProfit) * normalizedWeight;
      weightedMargin += analysis.profitMargin * normalizedWeight;
      weightedRisk += analysis.riskScore * normalizedWeight;
      weightedConfidence += analysis.confidence * normalizedWeight;
      allReasons.push(...analysis.reasoning);
    }

    // Calculate net profit after gas costs
    const totalGasCost = this.calculateTotalGasCost(order);
    const netProfit = weightedProfit - parseFloat(totalGasCost);

    // Determine recommendation
    const recommendation = this.determineRecommendation(
      weightedMargin,
      weightedRisk,
      weightedConfidence,
      netProfit
    );

    return {
      orderId: order.orderId,
      strategy: 'ensemble',
      expectedProfit: weightedProfit.toFixed(2),
      profitMargin: weightedMargin,
      riskScore: weightedRisk,
      confidence: weightedConfidence,
      gasEstimate: {
        ethereum: this.estimateEthereumGas(order).toString(),
        bitcoin: this.estimateBitcoinGas(order).toString()
      },
      netProfit: netProfit.toFixed(2),
      breakEvenPrice: this.calculateBreakEvenPrice(order, totalGasCost),
      recommendation,
      reasoning: [...new Set(allReasons)] // Remove duplicates
    };
  }

  /**
   * Calculate total gas cost for the swap
   */
  private calculateTotalGasCost(order: CrossChainSwapState): string {
    const ethGas = this.estimateEthereumGas(order);
    const btcGas = this.estimateBitcoinGas(order);
    
    // Convert to USD (mock conversion)
    const ethPrice = parseFloat(this.getMockPrice('ETH'));
    const btcPrice = parseFloat(this.getMockPrice('BTC'));
    
    const ethCostUSD = (ethGas / 1e18) * ethPrice;
    const btcCostUSD = (btcGas / 1e8) * btcPrice;
    
    return (ethCostUSD + btcCostUSD).toString();
  }

  /**
   * Estimate Ethereum gas costs
   */
  private estimateEthereumGas(order: CrossChainSwapState): number {
    const gasPrice = 20e9; // 20 Gwei
    const escrowGas = parseInt(this.config.defaultGasEstimates.ethereum.escrowCreation);
    const redeemGas = parseInt(this.config.defaultGasEstimates.ethereum.escrowRedeem);
    
    return (escrowGas + redeemGas) * gasPrice;
  }

  /**
   * Estimate Bitcoin gas costs
   */
  private estimateBitcoinGas(order: CrossChainSwapState): number {
    const feeRate = 10; // sat/byte
    const htlcSize = 200; // bytes
    const redeemSize = 150; // bytes
    
    return (htlcSize + redeemSize) * feeRate;
  }

  /**
   * Calculate break-even price
   */
  private calculateBreakEvenPrice(order: CrossChainSwapState, totalGasCost: string): string {
    const sourceAmount = parseFloat(order.amounts.source);
    const destAmount = parseFloat(order.amounts.destination);
    const gasCost = parseFloat(totalGasCost);
    
    const breakEvenRate = (destAmount + gasCost) / sourceAmount;
    return breakEvenRate.toString();
  }

  /**
   * Determine recommendation based on metrics
   */
  private determineRecommendation(
    margin: number,
    risk: number,
    confidence: number,
    netProfit: number
  ): 'accept' | 'reject' | 'monitor' {
    // Check minimum thresholds
    const minMargin = Math.min(...this.config.strategies.map(s => s.params.minProfitMargin));
    const maxRisk = Math.max(...this.config.strategies.map(s => s.params.maxRiskScore));
    const minConfidence = Math.min(...this.config.strategies.map(s => s.params.confidenceThreshold));

    if (netProfit <= 0) return 'reject';
    if (margin < minMargin) return 'reject';
    if (risk > maxRisk) return 'reject';
    if (confidence < minConfidence) return 'monitor';

    return 'accept';
  }

  /**
   * Get mock price for testing
   */
  private getMockPrice(symbol: string): string {
    const basePrice = symbol === 'ETH' ? 2000 : 45000;
    const variation = (Math.random() - 0.5) * 0.02; // ±1% variation
    return (basePrice * (1 + variation)).toFixed(2);
  }

  /**
   * Get last market update time
   */
  private getLastMarketUpdateTime(): number {
    let latest = 0;
    for (const data of this.marketData.values()) {
      latest = Math.max(latest, data.lastUpdated);
    }
    return latest;
  }

  /**
   * Shutdown the strategy engine
   */
  shutdown(): void {
    console.log('Shutting down strategy engine...');
    this.isShuttingDown = true;
    
    if (this.marketDataTimer) {
      clearInterval(this.marketDataTimer);
      this.marketDataTimer = null;
    }

    // Disable all strategies
    for (const strategy of this.strategies.values()) {
      strategy.disable();
    }

    console.log('Strategy engine shutdown complete');
  }
}

/**
 * Abstract base strategy class
 */
abstract class Strategy {
  protected config: StrategyConfig;
  protected metrics = {
    totalAnalyses: 0,
    successfulAnalyses: 0,
    averageAnalysisTime: 0,
    lastAnalysisTime: 0
  };

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  abstract analyze(
    order: CrossChainSwapState,
    sourceMarketData: MarketData | null,
    destMarketData: MarketData | null
  ): Promise<ProfitabilityAnalysis>;

  getName(): string {
    return this.config.name;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  enable(): void {
    this.config.enabled = true;
  }

  disable(): void {
    this.config.enabled = false;
  }

  getMetrics(): any {
    return { ...this.metrics };
  }

  protected updateMetrics(analysisTime: number, success: boolean): void {
    this.metrics.totalAnalyses++;
    if (success) this.metrics.successfulAnalyses++;
    this.metrics.averageAnalysisTime = 
      (this.metrics.averageAnalysisTime * (this.metrics.totalAnalyses - 1) + analysisTime) / this.metrics.totalAnalyses;
    this.metrics.lastAnalysisTime = Date.now();
  }
}

/**
 * Market Making Strategy - Focuses on providing liquidity and earning spreads
 */
class MarketMakingStrategy extends Strategy {
  async analyze(
    order: CrossChainSwapState,
    sourceMarketData: MarketData | null,
    destMarketData: MarketData | null
  ): Promise<ProfitabilityAnalysis> {
    const startTime = Date.now();

    try {
      const reasoning: string[] = [];
      
      // Check if we have sufficient market data
      if (!sourceMarketData || !destMarketData) {
        reasoning.push('Insufficient market data for analysis');
        throw new Error('Missing market data');
      }

      // Calculate expected profit based on spreads
      const sourcePrice = parseFloat(sourceMarketData.price);
      const destPrice = parseFloat(destMarketData.price);
      const sourceAmount = parseFloat(order.amounts.source);
      const destAmount = parseFloat(order.amounts.destination);

      // Market making profit comes from bid-ask spreads
      const avgSpread = (sourceMarketData.spread + destMarketData.spread) / 2;
      const spreadProfit = (sourceAmount * sourcePrice) * avgSpread;
      
      // Consider price difference arbitrage
      const priceRatio = destPrice / sourcePrice;
      const orderRatio = destAmount / sourceAmount;
      const arbitrageProfit = Math.max(0, (orderRatio - priceRatio) * sourceAmount * sourcePrice);

      const totalProfit = spreadProfit + arbitrageProfit;
      const profitMargin = (totalProfit / (sourceAmount * sourcePrice)) * 100;

      // Risk assessment for market making
      const avgVolatility = (sourceMarketData.volatility + destMarketData.volatility) / 2;
      const liquidityRisk = this.calculateLiquidityRisk(sourceMarketData, destMarketData);
      const riskScore = (avgVolatility * 50) + (liquidityRisk * 30) + 20; // Base risk

      // Confidence based on market data freshness and liquidity
      const dataAge = Math.max(
        Date.now() / 1000 - sourceMarketData.lastUpdated,
        Date.now() / 1000 - destMarketData.lastUpdated
      );
      const confidence = Math.max(0.1, 1 - (dataAge / 300) - (avgVolatility * 2)); // Decay over 5 minutes

      reasoning.push(`Market making spread profit: $${spreadProfit.toFixed(2)}`);
      reasoning.push(`Arbitrage opportunity: $${arbitrageProfit.toFixed(2)}`);
      reasoning.push(`Average market volatility: ${(avgVolatility * 100).toFixed(2)}%`);

      const analysis: ProfitabilityAnalysis = {
        orderId: order.orderId,
        strategy: 'MarketMaking',
        expectedProfit: totalProfit.toFixed(2),
        profitMargin,
        riskScore: Math.min(100, riskScore),
        confidence: Math.max(0, Math.min(1, confidence)),
        gasEstimate: {
          ethereum: '0',
          bitcoin: '0'
        },
        netProfit: totalProfit.toFixed(2),
        breakEvenPrice: (destAmount / sourceAmount).toString(),
        recommendation: profitMargin > this.config.params.minProfitMargin ? 'accept' : 'reject',
        reasoning
      };

      this.updateMetrics(Date.now() - startTime, true);
      return analysis;

    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private calculateLiquidityRisk(source: MarketData, dest: MarketData): number {
    const sourceLiquidity = parseFloat(source.liquidity);
    const destLiquidity = parseFloat(dest.liquidity);
    
    // Higher liquidity = lower risk (inverted scale 0-1)
    const sourceRisk = Math.min(1, 1000000 / sourceLiquidity);
    const destRisk = Math.min(1, 1000000 / destLiquidity);
    
    return (sourceRisk + destRisk) / 2;
  }
}

/**
 * Arbitrage Strategy - Focuses on price differences between chains
 */
class ArbitrageStrategy extends Strategy {
  async analyze(
    order: CrossChainSwapState,
    sourceMarketData: MarketData | null,
    destMarketData: MarketData | null
  ): Promise<ProfitabilityAnalysis> {
    const startTime = Date.now();

    try {
      const reasoning: string[] = [];
      
      if (!sourceMarketData || !destMarketData) {
        reasoning.push('Insufficient market data for arbitrage analysis');
        throw new Error('Missing market data');
      }

      const sourcePrice = parseFloat(sourceMarketData.price);
      const destPrice = parseFloat(destMarketData.price);
      const sourceAmount = parseFloat(order.amounts.source);
      const destAmount = parseFloat(order.amounts.destination);

      // Calculate arbitrage profit
      const marketRatio = destPrice / sourcePrice;
      const orderRatio = destAmount / sourceAmount;
      const arbitrageSpread = orderRatio - marketRatio;
      const arbitrageProfit = arbitrageSpread * sourceAmount * sourcePrice;

      const profitMargin = (arbitrageProfit / (sourceAmount * sourcePrice)) * 100;

      // Risk assessment for arbitrage
      const priceVolatility = Math.abs(arbitrageSpread) * 100;
      const executionRisk = this.calculateExecutionRisk(order);
      const riskScore = priceVolatility + executionRisk;

      // Confidence based on arbitrage opportunity size and stability
      const opportunitySize = Math.abs(arbitrageSpread);
      const confidence = Math.min(1, opportunitySize * 10); // Scale opportunity to confidence

      reasoning.push(`Market price ratio: ${marketRatio.toFixed(6)}`);
      reasoning.push(`Order price ratio: ${orderRatio.toFixed(6)}`);
      reasoning.push(`Arbitrage spread: ${(arbitrageSpread * 100).toFixed(4)}%`);
      
      if (arbitrageProfit > 0) {
        reasoning.push('Positive arbitrage opportunity detected');
      } else {
        reasoning.push('No arbitrage opportunity - market prices unfavorable');
      }

      const analysis: ProfitabilityAnalysis = {
        orderId: order.orderId,
        strategy: 'Arbitrage',
        expectedProfit: Math.max(0, arbitrageProfit).toFixed(2),
        profitMargin: Math.max(0, profitMargin),
        riskScore: Math.min(100, riskScore),
        confidence: Math.max(0, Math.min(1, confidence)),
        gasEstimate: {
          ethereum: '0',
          bitcoin: '0'
        },
        netProfit: Math.max(0, arbitrageProfit).toFixed(2),
        breakEvenPrice: (destAmount / sourceAmount).toString(),
        recommendation: arbitrageProfit > 0 && profitMargin > this.config.params.minProfitMargin ? 'accept' : 'reject',
        reasoning
      };

      this.updateMetrics(Date.now() - startTime, true);
      return analysis;

    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private calculateExecutionRisk(order: CrossChainSwapState): number {
    // Risk increases with time to expiration and cross-chain complexity
    const timeToExpiry = order.timelocks.source - Math.floor(Date.now() / 1000);
    const timeRisk = Math.max(0, (3600 - timeToExpiry) / 3600 * 30); // 30 points max for time risk
    
    // Cross-chain risk is inherent
    const crossChainRisk = 20;
    
    return timeRisk + crossChainRisk;
  }
}

/**
 * Risk Averse Strategy - Conservative approach with strict risk controls
 */
class RiskAverseStrategy extends Strategy {
  async analyze(
    order: CrossChainSwapState,
    sourceMarketData: MarketData | null,
    destMarketData: MarketData | null
  ): Promise<ProfitabilityAnalysis> {
    const startTime = Date.now();

    try {
      const reasoning: string[] = [];
      
      if (!sourceMarketData || !destMarketData) {
        reasoning.push('Insufficient market data - high risk');
        throw new Error('Missing market data');
      }

      const sourcePrice = parseFloat(sourceMarketData.price);
      const destPrice = parseFloat(destMarketData.price);
      const sourceAmount = parseFloat(order.amounts.source);
      const destAmount = parseFloat(order.amounts.destination);

      // Conservative profit calculation with risk buffers
      const baseProfit = (destAmount * destPrice) - (sourceAmount * sourcePrice);
      const riskBuffer = baseProfit * 0.2; // 20% risk buffer
      const conservativeProfit = Math.max(0, baseProfit - riskBuffer);
      
      const profitMargin = conservativeProfit > 0 ? (conservativeProfit / (sourceAmount * sourcePrice)) * 100 : 0;

      // Comprehensive risk assessment
      const volatilityRisk = this.assessVolatilityRisk(sourceMarketData, destMarketData);
      const liquidityRisk = this.assessLiquidityRisk(sourceMarketData, destMarketData, sourceAmount, destAmount);
      const timeRisk = this.assessTimeRisk(order);
      const counterpartyRisk = 25; // Base counterparty risk
      
      const totalRisk = volatilityRisk + liquidityRisk + timeRisk + counterpartyRisk;

      // Conservative confidence calculation
      const dataQuality = this.assessDataQuality(sourceMarketData, destMarketData);
      const marketStability = this.assessMarketStability(sourceMarketData, destMarketData);
      const confidence = Math.min(dataQuality, marketStability) * 0.8; // Cap at 80% for conservative approach

      reasoning.push(`Base profit: $${baseProfit.toFixed(2)}`);
      reasoning.push(`Risk buffer applied: $${riskBuffer.toFixed(2)}`);
      reasoning.push(`Conservative profit estimate: $${conservativeProfit.toFixed(2)}`);
      reasoning.push(`Total risk score: ${totalRisk.toFixed(1)}/100`);
      reasoning.push('Risk-averse strategy prioritizes capital preservation');

      const analysis: ProfitabilityAnalysis = {
        orderId: order.orderId,
        strategy: 'RiskAverse',
        expectedProfit: conservativeProfit.toFixed(2),
        profitMargin,
        riskScore: Math.min(100, totalRisk),
        confidence: Math.max(0, Math.min(1, confidence)),
        gasEstimate: {
          ethereum: '0',
          bitcoin: '0'
        },
        netProfit: conservativeProfit.toFixed(2),
        breakEvenPrice: ((destAmount * destPrice + riskBuffer) / sourceAmount).toString(),
        recommendation: conservativeProfit > 0 && totalRisk < this.config.params.maxRiskScore && profitMargin > this.config.params.minProfitMargin ? 'accept' : 'reject',
        reasoning
      };

      this.updateMetrics(Date.now() - startTime, true);
      return analysis;

    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private assessVolatilityRisk(source: MarketData, dest: MarketData): number {
    const maxVolatility = Math.max(source.volatility, dest.volatility);
    return Math.min(40, maxVolatility * 100 * 2); // Cap at 40 points
  }

  private assessLiquidityRisk(source: MarketData, dest: MarketData, sourceAmount: number, destAmount: number): number {
    const sourceLiquidityRatio = sourceAmount / parseFloat(source.liquidity);
    const destLiquidityRatio = destAmount / parseFloat(dest.liquidity);
    const maxRatio = Math.max(sourceLiquidityRatio, destLiquidityRatio);
    
    return Math.min(30, maxRatio * 1000); // Cap at 30 points
  }

  private assessTimeRisk(order: CrossChainSwapState): number {
    const timeToExpiry = order.timelocks.source - Math.floor(Date.now() / 1000);
    const minSafeTime = 7200; // 2 hours minimum
    
    if (timeToExpiry < minSafeTime) {
      return 30; // High time risk
    }
    
    return Math.max(5, (minSafeTime * 2 - timeToExpiry) / minSafeTime * 15); // Scale from 5-15 points
  }

  private assessDataQuality(source: MarketData, dest: MarketData): number {
    const now = Date.now() / 1000;
    const maxAge = 60; // 1 minute max for good quality
    
    const sourceAge = now - source.lastUpdated;
    const destAge = now - dest.lastUpdated;
    const maxDataAge = Math.max(sourceAge, destAge);
    
    return Math.max(0.1, 1 - (maxDataAge / maxAge));
  }

  private assessMarketStability(source: MarketData, dest: MarketData): number {
    // Market stability based on spreads and volatility
    const avgSpread = (source.spread + dest.spread) / 2;
    const avgVolatility = (source.volatility + dest.volatility) / 2;
    
    const spreadStability = Math.max(0.1, 1 - (avgSpread * 10)); // Penalize wide spreads
    const volatilityStability = Math.max(0.1, 1 - (avgVolatility * 5)); // Penalize high volatility
    
    return Math.min(spreadStability, volatilityStability);
  }
}

export default StrategyEngine;