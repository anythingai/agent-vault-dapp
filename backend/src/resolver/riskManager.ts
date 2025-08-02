import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  ChainId,
  Address,
  Amount,
  SwapError,
  SwapErrorCode,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS
} from '../shared/types.js';

export interface RiskProfile {
  maxExposurePerChain: { [chainId: string]: Amount };
  maxExposurePerToken: { [token: string]: Amount };
  maxSingleOrderSize: Amount;
  maxDailyVolume: Amount;
  maxConcurrentOrders: number;
  allowedCounterparties: Address[];
  blockedCounterparties: Address[];
  minConfidenceScore: number; // 0-100
  maxRiskScore: number; // 0-100
}

export interface ExposureLimit {
  type: 'chain' | 'token' | 'counterparty' | 'daily_volume' | 'single_order';
  identifier: string; // chainId, token address, or counterparty address
  currentExposure: Amount;
  maxExposure: Amount;
  utilizationRate: number; // 0-1
  lastUpdated: number;
}

export interface RiskMetrics {
  totalExposure: Amount;
  chainExposures: { [chainId: string]: Amount };
  tokenExposures: { [token: string]: Amount };
  counterpartyExposures: { [address: string]: Amount };
  avgConfidenceScore: number;
  avgRiskScore: number;
  dailyVolume: Amount;
  concurrentOrders: number;
  rejectedOrders: number;
  riskScore: number; // Overall risk score 0-100
}

export interface CircuitBreaker {
  name: string;
  enabled: boolean;
  condition: {
    type: 'exposure_threshold' | 'volume_spike' | 'error_rate' | 'market_volatility' | 'confidence_drop';
    threshold: number;
    timeWindow: number; // seconds
  };
  action: {
    type: 'pause' | 'reduce_limits' | 'alert' | 'emergency_stop';
    duration: number; // seconds, 0 for manual reset
    params?: { [key: string]: any };
  };
  triggered: boolean;
  lastTriggered?: number;
  triggerCount: number;
}

export interface RiskAssessment {
  orderId: string;
  riskScore: number; // 0-100, higher = riskier
  confidenceScore: number; // 0-100, higher = more confident
  approved: boolean;
  rejectionReasons: string[];
  exposureImpact: {
    chain: number; // Impact on chain exposure (0-1)
    token: number; // Impact on token exposure (0-1)
    counterparty: number; // Impact on counterparty exposure (0-1)
    volume: number; // Impact on daily volume (0-1)
  };
  recommendations: string[];
  positionSize: Amount; // Recommended position size
  timestamp: number;
}

export interface RiskManagerConfig {
  riskProfile: RiskProfile;
  circuitBreakers: CircuitBreaker[];
  monitoring: {
    assessmentInterval: number; // ms between risk assessments
    metricsUpdateInterval: number; // ms between metrics updates
    alertThresholds: {
      highRisk: number; // Risk score threshold for alerts
      highExposure: number; // Exposure utilization threshold
      lowConfidence: number; // Confidence score threshold
    };
  };
  volatilityThresholds: {
    low: number; // 0-1 scale
    medium: number;
    high: number;
  };
  positionSizing: {
    baseSize: Amount; // Base position size
    maxSize: Amount; // Maximum position size
    confidenceMultiplier: number; // How confidence affects size
    riskDivisor: number; // How risk affects size
  };
}

export type RiskEventHandler = {
  riskAssessmentCompleted?: (assessment: RiskAssessment) => void;
  exposureLimitReached?: (limit: ExposureLimit) => void;
  circuitBreakerTriggered?: (breaker: CircuitBreaker, reason: string) => void;
  circuitBreakerReset?: (breaker: CircuitBreaker) => void;
  highRiskAlert?: (orderId: string, riskScore: number, reasons: string[]) => void;
  emergencyStop?: (reason: string) => void;
  riskMetricsUpdated?: (metrics: RiskMetrics) => void;
};

/**
 * Risk Manager - Implements comprehensive risk assessment and management
 * Handles exposure limits, position sizing, circuit breakers, and risk metrics
 */
export class RiskManager {
  private config: RiskManagerConfig;
  private eventHandlers: RiskEventHandler = {};
  
  private exposureLimits: Map<string, ExposureLimit> = new Map();
  private activeOrders: Map<string, CrossChainSwapState> = new Map();
  private dailyVolume: Map<string, Amount> = new Map(); // date -> volume
  private riskAssessments: Map<string, RiskAssessment> = new Map();
  
  private monitoringTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private isEmergencyStopped: boolean = false;
  
  private metrics: RiskMetrics = {
    totalExposure: '0',
    chainExposures: {},
    tokenExposures: {},
    counterpartyExposures: {},
    avgConfidenceScore: 0,
    avgRiskScore: 0,
    dailyVolume: '0',
    concurrentOrders: 0,
    rejectedOrders: 0,
    riskScore: 0
  };

  constructor(config: RiskManagerConfig) {
    this.config = config;
    this.initializeExposureLimits();
    
    console.log('RiskManager initialized with:');
    console.log(`- Circuit breakers: ${config.circuitBreakers.length}`);
    console.log(`- Max concurrent orders: ${config.riskProfile.maxConcurrentOrders}`);
    console.log(`- Max single order size: ${config.riskProfile.maxSingleOrderSize}`);
    console.log(`- Risk profile configured for ${Object.keys(config.riskProfile.maxExposurePerChain).length} chains`);
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: RiskEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof RiskEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Start risk monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Risk manager already running');
      return;
    }
    
    console.log('Starting risk manager...');
    this.isRunning = true;
    
    // Start monitoring timers
    this.startMonitoring();
    
    // Initial metrics calculation
    this.updateMetrics();
    
    console.log('Risk manager started successfully');
  }

  /**
   * Stop risk monitoring
   */
  async stop(): Promise<void> {
    console.log('Stopping risk manager...');
    this.isRunning = false;
    
    // Clear timers
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    console.log('Risk manager stopped');
  }

  /**
   * Assess risk for a swap order
   */
  async assessOrderRisk(order: CrossChainSwapState, confidenceScore?: number): Promise<RiskAssessment> {
    // Check if emergency stopped
    if (this.isEmergencyStopped) {
      return this.createRejectedAssessment(order.orderId, ['System in emergency stop mode']);
    }
    
    const rejectionReasons: string[] = [];
    const recommendations: string[] = [];
    let riskScore = 0;
    const confidence = confidenceScore || 50; // Default confidence
    
    // 1. Check basic order validation
    const basicValidation = this.validateBasicOrder(order);
    if (!basicValidation.valid) {
      rejectionReasons.push(...basicValidation.reasons);
      riskScore += 30;
    }
    
    // 2. Check exposure limits
    const exposureCheck = await this.checkExposureLimits(order);
    if (!exposureCheck.allowed) {
      rejectionReasons.push(...exposureCheck.reasons);
      riskScore += 25;
    }
    
    // 3. Check counterparty risk
    const counterpartyRisk = this.assessCounterpartyRisk(order);
    riskScore += counterpartyRisk.score;
    if (!counterpartyRisk.approved) {
      rejectionReasons.push(...counterpartyRisk.reasons);
    }
    recommendations.push(...counterpartyRisk.recommendations);
    
    // 4. Check market conditions
    const marketRisk = await this.assessMarketRisk(order);
    riskScore += marketRisk.score;
    recommendations.push(...marketRisk.recommendations);
    
    // 5. Check technical risks
    const technicalRisk = this.assessTechnicalRisk(order);
    riskScore += technicalRisk.score;
    recommendations.push(...technicalRisk.recommendations);
    
    // 6. Calculate position size
    const positionSize = this.calculatePositionSize(order, confidence, riskScore);
    
    // 7. Final approval decision
    const approved = this.makeApprovalDecision(riskScore, confidence, rejectionReasons.length === 0);
    
    const assessment: RiskAssessment = {
      orderId: order.orderId,
      riskScore: Math.min(100, riskScore),
      confidenceScore: confidence,
      approved,
      rejectionReasons,
      exposureImpact: exposureCheck.impact,
      recommendations,
      positionSize,
      timestamp: Math.floor(Date.now() / 1000)
    };
    
    // Store assessment
    this.riskAssessments.set(order.orderId, assessment);
    
    // Update metrics
    if (!approved) {
      this.metrics.rejectedOrders++;
    }
    
    // Emit events
    this.emit('riskAssessmentCompleted', assessment);
    
    if (riskScore > this.config.monitoring.alertThresholds.highRisk) {
      this.emit('highRiskAlert', order.orderId, riskScore, rejectionReasons);
    }
    
    // Check circuit breakers
    await this.checkCircuitBreakers(assessment);
    
    return assessment;
  }

  /**
   * Update order status and adjust risk exposure
   */
  async updateOrderStatus(orderId: string, order: CrossChainSwapState): Promise<void> {
    const wasActive = this.activeOrders.has(orderId);
    const isActive = [SwapStatus.AUCTION_STARTED, SwapStatus.RESOLVER_SELECTED, SwapStatus.SOURCE_FUNDED, SwapStatus.DESTINATION_FUNDED, SwapStatus.BOTH_FUNDED].includes(order.status);
    
    if (isActive && !wasActive) {
      // Order became active
      this.activeOrders.set(orderId, order);
      await this.addExposure(order);
    } else if (!isActive && wasActive) {
      // Order completed/failed
      const oldOrder = this.activeOrders.get(orderId);
      this.activeOrders.delete(orderId);
      if (oldOrder) {
        await this.removeExposure(oldOrder);
      }
    } else if (isActive && wasActive) {
      // Order updated
      this.activeOrders.set(orderId, order);
    }
    
    // Update daily volume
    if (order.status === SwapStatus.COMPLETED) {
      this.updateDailyVolume(order);
    }
    
    this.updateMetrics();
  }

  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get exposure limits
   */
  getExposureLimits(): ExposureLimit[] {
    return Array.from(this.exposureLimits.values());
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakers(): CircuitBreaker[] {
    return [...this.config.circuitBreakers];
  }

  /**
   * Manually trigger emergency stop
   */
  emergencyStop(reason: string): void {
    console.log(`Emergency stop triggered: ${reason}`);
    this.isEmergencyStopped = true;
    
    // Trigger all emergency stop circuit breakers
    for (const breaker of this.config.circuitBreakers) {
      if (breaker.action.type === 'emergency_stop') {
        this.triggerCircuitBreaker(breaker, reason);
      }
    }
    
    this.emit('emergencyStop', reason);
  }

  /**
   * Reset emergency stop
   */
  resetEmergencyStop(): void {
    console.log('Resetting emergency stop');
    this.isEmergencyStopped = false;
    
    // Reset relevant circuit breakers
    for (const breaker of this.config.circuitBreakers) {
      if (breaker.action.type === 'emergency_stop' && breaker.triggered) {
        this.resetCircuitBreaker(breaker);
      }
    }
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(breaker: CircuitBreaker): void {
    breaker.triggered = false;
    console.log(`Circuit breaker reset: ${breaker.name}`);
    this.emit('circuitBreakerReset', breaker);
  }

  /**
   * Initialize exposure limits
   */
  private initializeExposureLimits(): void {
    // Chain exposure limits
    for (const [chainId, maxExposure] of Object.entries(this.config.riskProfile.maxExposurePerChain)) {
      this.exposureLimits.set(`chain_${chainId}`, {
        type: 'chain',
        identifier: chainId,
        currentExposure: '0',
        maxExposure,
        utilizationRate: 0,
        lastUpdated: Math.floor(Date.now() / 1000)
      });
    }
    
    // Token exposure limits
    for (const [token, maxExposure] of Object.entries(this.config.riskProfile.maxExposurePerToken)) {
      this.exposureLimits.set(`token_${token}`, {
        type: 'token',
        identifier: token,
        currentExposure: '0',
        maxExposure,
        utilizationRate: 0,
        lastUpdated: Math.floor(Date.now() / 1000)
      });
    }
  }

  /**
   * Validate basic order requirements
   */
  private validateBasicOrder(order: CrossChainSwapState): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    // Check if order size exceeds maximum
    const sourceAmount = BigInt(order.amounts.source);
    const maxSingleOrder = BigInt(this.config.riskProfile.maxSingleOrderSize);
    
    if (sourceAmount > maxSingleOrder) {
      reasons.push(`Order size ${order.amounts.source} exceeds maximum ${this.config.riskProfile.maxSingleOrderSize}`);
    }
    
    // Check concurrent order limit
    if (this.activeOrders.size >= this.config.riskProfile.maxConcurrentOrders) {
      reasons.push(`Maximum concurrent orders reached (${this.config.riskProfile.maxConcurrentOrders})`);
    }
    
    // Check blocked counterparties
    if (this.config.riskProfile.blockedCounterparties.includes(order.maker)) {
      reasons.push(`Counterparty ${order.maker} is blocked`);
    }
    
    // Check allowed counterparties (if allowlist is configured)
    if (this.config.riskProfile.allowedCounterparties.length > 0 && 
        !this.config.riskProfile.allowedCounterparties.includes(order.maker)) {
      reasons.push(`Counterparty ${order.maker} is not on allowlist`);
    }
    
    return { valid: reasons.length === 0, reasons };
  }

  /**
   * Check exposure limits for an order
   */
  private async checkExposureLimits(order: CrossChainSwapState): Promise<{
    allowed: boolean;
    reasons: string[];
    impact: { chain: number; token: number; counterparty: number; volume: number };
  }> {
    const reasons: string[] = [];
    const impact = { chain: 0, token: 0, counterparty: 0, volume: 0 };
    
    const orderValue = BigInt(order.amounts.source);
    
    // Check chain exposure
    const chainLimit = this.exposureLimits.get(`chain_${order.sourceChain.chainId}`);
    if (chainLimit) {
      const newExposure = BigInt(chainLimit.currentExposure) + orderValue;
      const maxExposure = BigInt(chainLimit.maxExposure);
      
      if (newExposure > maxExposure) {
        reasons.push(`Chain ${order.sourceChain.chainId} exposure limit exceeded`);
      }
      
      impact.chain = Number(newExposure * BigInt(100) / maxExposure) / 100;
    }
    
    // Check token exposure (simplified - assume native token)
    const tokenLimit = this.exposureLimits.get(`token_${NATIVE_TOKEN_ADDRESS}`);
    if (tokenLimit) {
      const newExposure = BigInt(tokenLimit.currentExposure) + orderValue;
      const maxExposure = BigInt(tokenLimit.maxExposure);
      
      if (newExposure > maxExposure) {
        reasons.push(`Token exposure limit exceeded`);
      }
      
      impact.token = Number(newExposure * BigInt(100) / maxExposure) / 100;
    }
    
    // Check daily volume
    const today = new Date().toISOString().split('T')[0];
    const currentVolume = BigInt(this.dailyVolume.get(today) || '0');
    const newVolume = currentVolume + orderValue;
    const maxDailyVolume = BigInt(this.config.riskProfile.maxDailyVolume);
    
    if (newVolume > maxDailyVolume) {
      reasons.push('Daily volume limit exceeded');
    }
    
    impact.volume = Number(newVolume * BigInt(100) / maxDailyVolume) / 100;
    
    return { allowed: reasons.length === 0, reasons, impact };
  }

  /**
   * Assess counterparty risk
   */
  private assessCounterpartyRisk(order: CrossChainSwapState): {
    score: number;
    approved: boolean;
    reasons: string[];
    recommendations: string[];
  } {
    const reasons: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    
    // Check if counterparty is known
    const counterpartyExposure = this.metrics.counterpartyExposures[order.maker] || '0';
    const exposure = BigInt(counterpartyExposure);
    
    if (exposure === BigInt(0)) {
      // New counterparty - higher risk
      score += 10;
      recommendations.push('First interaction with this counterparty - proceed with caution');
    } else {
      // Known counterparty - lower risk based on history
      score += 5;
      recommendations.push('Known counterparty with previous interactions');
    }
    
    // Check address format and validity (simplified)
    if (!this.isValidAddress(order.maker)) {
      reasons.push('Invalid counterparty address format');
      score += 25;
    }
    
    return {
      score,
      approved: reasons.length === 0,
      reasons,
      recommendations
    };
  }

  /**
   * Assess market risk
   */
  private async assessMarketRisk(order: CrossChainSwapState): Promise<{
    score: number;
    recommendations: string[];
  }> {
    const recommendations: string[] = [];
    let score = 0;
    
    // Check cross-chain bridge risk
    const bridgeRisk = this.assessBridgeRisk(order.sourceChain.chainId, order.destinationChain.chainId);
    score += bridgeRisk.score;
    recommendations.push(...bridgeRisk.recommendations);
    
    // Check time-based risk (approaching expiry)
    const timeRisk = this.assessTimeRisk(order);
    score += timeRisk.score;
    recommendations.push(...timeRisk.recommendations);
    
    // Mock market volatility assessment
    const volatility = Math.random() * 0.1; // 0-10% volatility
    if (volatility > this.config.volatilityThresholds.high) {
      score += 15;
      recommendations.push('High market volatility detected - increased risk');
    } else if (volatility > this.config.volatilityThresholds.medium) {
      score += 8;
      recommendations.push('Medium market volatility');
    } else {
      score += 3;
      recommendations.push('Low market volatility');
    }
    
    return { score, recommendations };
  }

  /**
   * Assess technical risk
   */
  private assessTechnicalRisk(order: CrossChainSwapState): {
    score: number;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let score = 0;
    
    // Network congestion risk (mock)
    const congestionRisk = Math.random() * 20; // 0-20 risk points
    score += congestionRisk;
    
    if (congestionRisk > 15) {
      recommendations.push('High network congestion - consider delaying execution');
    } else if (congestionRisk > 10) {
      recommendations.push('Moderate network congestion detected');
    }
    
    // Gas price volatility (mock)
    const gasPriceRisk = Math.random() * 10; // 0-10 risk points
    score += gasPriceRisk;
    
    if (gasPriceRisk > 7) {
      recommendations.push('High gas price volatility - execution costs may vary');
    }
    
    return { score, recommendations };
  }

  /**
   * Calculate recommended position size
   */
  private calculatePositionSize(order: CrossChainSwapState, confidence: number, riskScore: number): Amount {
    const baseSize = BigInt(this.config.positionSizing.baseSize);
    const maxSize = BigInt(this.config.positionSizing.maxSize);
    const orderSize = BigInt(order.amounts.source);
    
    // Adjust size based on confidence (0-100 -> 0.5-1.5 multiplier)
    const confidenceMultiplier = 0.5 + (confidence / 100);
    
    // Adjust size based on risk (0-100 -> 1.0-0.1 divisor)
    const riskDivisor = Math.max(0.1, 1 - (riskScore / 100) * 0.9);
    
    // Calculate recommended size
    const adjustedSize = BigInt(Math.floor(Number(baseSize) * confidenceMultiplier * riskDivisor));
    
    // Cap at maximum size and order size
    const recommendedSize = adjustedSize > maxSize ? maxSize : adjustedSize;
    const finalSize = recommendedSize > orderSize ? orderSize : recommendedSize;
    
    return finalSize.toString();
  }

  /**
   * Make final approval decision
   */
  private makeApprovalDecision(riskScore: number, confidence: number, noRejectionReasons: boolean): boolean {
    if (!noRejectionReasons) {
      return false;
    }
    
    if (riskScore > this.config.riskProfile.maxRiskScore) {
      return false;
    }
    
    if (confidence < this.config.riskProfile.minConfidenceScore) {
      return false;
    }
    
    return true;
  }

  /**
   * Create rejected assessment
   */
  private createRejectedAssessment(orderId: string, reasons: string[]): RiskAssessment {
    return {
      orderId,
      riskScore: 100,
      confidenceScore: 0,
      approved: false,
      rejectionReasons: reasons,
      exposureImpact: { chain: 0, token: 0, counterparty: 0, volume: 0 },
      recommendations: ['Order rejected due to risk assessment'],
      positionSize: '0',
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Add exposure for an active order
   */
  private async addExposure(order: CrossChainSwapState): Promise<void> {
    const amount = BigInt(order.amounts.source);
    
    // Add chain exposure
    const chainKey = `chain_${order.sourceChain.chainId}`;
    const chainLimit = this.exposureLimits.get(chainKey);
    if (chainLimit) {
      const newExposure = BigInt(chainLimit.currentExposure) + amount;
      chainLimit.currentExposure = newExposure.toString();
      chainLimit.utilizationRate = Number(newExposure * BigInt(100) / BigInt(chainLimit.maxExposure)) / 100;
      chainLimit.lastUpdated = Math.floor(Date.now() / 1000);
      
      // Check if limit reached
      if (chainLimit.utilizationRate >= this.config.monitoring.alertThresholds.highExposure) {
        this.emit('exposureLimitReached', chainLimit);
      }
    }
    
    // Add token exposure
    const tokenKey = `token_${NATIVE_TOKEN_ADDRESS}`;
    const tokenLimit = this.exposureLimits.get(tokenKey);
    if (tokenLimit) {
      const newExposure = BigInt(tokenLimit.currentExposure) + amount;
      tokenLimit.currentExposure = newExposure.toString();
      tokenLimit.utilizationRate = Number(newExposure * BigInt(100) / BigInt(tokenLimit.maxExposure)) / 100;
      tokenLimit.lastUpdated = Math.floor(Date.now() / 1000);
      
      if (tokenLimit.utilizationRate >= this.config.monitoring.alertThresholds.highExposure) {
        this.emit('exposureLimitReached', tokenLimit);
      }
    }
  }

  /**
   * Remove exposure for a completed order
   */
  private async removeExposure(order: CrossChainSwapState): Promise<void> {
    const amount = BigInt(order.amounts.source);
    
    // Remove chain exposure
    const chainKey = `chain_${order.sourceChain.chainId}`;
    const chainLimit = this.exposureLimits.get(chainKey);
    if (chainLimit) {
      const newExposure = BigInt(chainLimit.currentExposure) - amount;
      chainLimit.currentExposure = newExposure > 0n ? newExposure.toString() : '0';
      chainLimit.utilizationRate = Number(newExposure * BigInt(100) / BigInt(chainLimit.maxExposure)) / 100;
      chainLimit.lastUpdated = Math.floor(Date.now() / 1000);
    }
    
    // Remove token exposure
    const tokenKey = `token_${NATIVE_TOKEN_ADDRESS}`;
    const tokenLimit = this.exposureLimits.get(tokenKey);
    if (tokenLimit) {
      const newExposure = BigInt(tokenLimit.currentExposure) - amount;
      tokenLimit.currentExposure = newExposure > 0n ? newExposure.toString() : '0';
      tokenLimit.utilizationRate = Number(newExposure * BigInt(100) / BigInt(tokenLimit.maxExposure)) / 100;
      tokenLimit.lastUpdated = Math.floor(Date.now() / 1000);
    }
  }

  /**
   * Update daily volume
   */
  private updateDailyVolume(order: CrossChainSwapState): void {
    const today = new Date().toISOString().split('T')[0];
    const currentVolume = BigInt(this.dailyVolume.get(today) || '0');
    const newVolume = currentVolume + BigInt(order.amounts.source);
    this.dailyVolume.set(today, newVolume.toString());
  }

  /**
   * Check circuit breakers
   */
  private async checkCircuitBreakers(assessment: RiskAssessment): Promise<void> {
    for (const breaker of this.config.circuitBreakers) {
      if (!breaker.enabled || breaker.triggered) continue;
      
      let shouldTrigger = false;
      let reason = '';
      
      switch (breaker.condition.type) {
        case 'exposure_threshold':
          const totalUtilization = this.calculateTotalExposureUtilization();
          if (totalUtilization > breaker.condition.threshold) {
            shouldTrigger = true;
            reason = `Total exposure utilization ${(totalUtilization * 100).toFixed(1)}% exceeds threshold ${(breaker.condition.threshold * 100).toFixed(1)}%`;
          }
          break;
          
        case 'error_rate':
          const errorRate = this.calculateErrorRate();
          if (errorRate > breaker.condition.threshold) {
            shouldTrigger = true;
            reason = `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(breaker.condition.threshold * 100).toFixed(1)}%`;
          }
          break;
          
        case 'confidence_drop':
          if (assessment.confidenceScore < breaker.condition.threshold) {
            shouldTrigger = true;
            reason = `Confidence score ${assessment.confidenceScore} below threshold ${breaker.condition.threshold}`;
          }
          break;
      }
      
      if (shouldTrigger) {
        this.triggerCircuitBreaker(breaker, reason);
      }
    }
  }

  /**
   * Trigger circuit breaker
   */
  private triggerCircuitBreaker(breaker: CircuitBreaker, reason: string): void {
    breaker.triggered = true;
    breaker.lastTriggered = Math.floor(Date.now() / 1000);
    breaker.triggerCount++;
    
    console.log(`Circuit breaker triggered: ${breaker.name} - ${reason}`);
    
    // Execute breaker action
    switch (breaker.action.type) {
      case 'emergency_stop':
        this.isEmergencyStopped = true;
        break;
      case 'pause':
        // Temporary pause - auto-reset after duration
        if (breaker.action.duration > 0) {
          setTimeout(() => {
            this.resetCircuitBreaker(breaker);
          }, breaker.action.duration * 1000);
        }
        break;
      case 'reduce_limits':
        this.reduceLimits(breaker.action.params?.reductionFactor || 0.5);
        break;
    }
    
    this.emit('circuitBreakerTriggered', breaker, reason);
  }

  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      this.monitorRiskConditions();
    }, this.config.monitoring.assessmentInterval);
    
    this.metricsTimer = setInterval(() => {
      this.updateMetrics();
    }, this.config.monitoring.metricsUpdateInterval);
  }

  /**
   * Monitor risk conditions
   */
  private monitorRiskConditions(): void {
    // Check for time-based circuit breaker resets
    for (const breaker of this.config.circuitBreakers) {
      if (breaker.triggered && breaker.action.duration > 0 && breaker.lastTriggered) {
        const elapsed = Math.floor(Date.now() / 1000) - breaker.lastTriggered;
        if (elapsed > breaker.action.duration) {
          this.resetCircuitBreaker(breaker);
        }
      }
    }
  }

  /**
   * Update risk metrics
   */
  private updateMetrics(): void {
    let totalExposure = BigInt(0);
    const chainExposures: { [chainId: string]: Amount } = {};
    const tokenExposures: { [token: string]: Amount } = {};
    
    // Calculate exposures
    for (const limit of this.exposureLimits.values()) {
      if (limit.type === 'chain') {
        chainExposures[limit.identifier] = limit.currentExposure;
        totalExposure += BigInt(limit.currentExposure);
      } else if (limit.type === 'token') {
        tokenExposures[limit.identifier] = limit.currentExposure;
      }
    }
    
    // Calculate counterparty exposures
    const counterpartyExposures: { [address: string]: Amount } = {};
    for (const order of this.activeOrders.values()) {
      const current = BigInt(counterpartyExposures[order.maker] || '0');
      counterpartyExposures[order.maker] = (current + BigInt(order.amounts.source)).toString();
    }
    
    // Calculate average scores
    const assessments = Array.from(this.riskAssessments.values());
    const avgConfidenceScore = assessments.length > 0
      ? assessments.reduce((sum, a) => sum + a.confidenceScore, 0) / assessments.length
      : 0;
    const avgRiskScore = assessments.length > 0
      ? assessments.reduce((sum, a) => sum + a.riskScore, 0) / assessments.length
      : 0;
    
    // Calculate daily volume
    const today = new Date().toISOString().split('T')[0];
    const dailyVolume = this.dailyVolume.get(today) || '0';
    
    // Calculate overall risk score
    const overallRiskScore = this.calculateOverallRiskScore(totalExposure, avgRiskScore);
    
    this.metrics = {
      totalExposure: totalExposure.toString(),
      chainExposures,
      tokenExposures,
      counterpartyExposures,
      avgConfidenceScore,
      avgRiskScore,
      dailyVolume,
      concurrentOrders: this.activeOrders.size,
      rejectedOrders: this.metrics.rejectedOrders,
      riskScore: overallRiskScore
    };
    
    this.emit('riskMetricsUpdated', this.metrics);
  }

  /**
   * Helper methods
   */
  private calculateTotalExposureUtilization(): number {
    let totalCurrent = BigInt(0);
    let totalMax = BigInt(0);
    
    for (const limit of this.exposureLimits.values()) {
      if (limit.type === 'chain') {
        totalCurrent += BigInt(limit.currentExposure);
        totalMax += BigInt(limit.maxExposure);
      }
    }
    
    return totalMax > 0n ? Number(totalCurrent * BigInt(100) / totalMax) / 100 : 0;
  }

  private calculateErrorRate(): number {
    // Simplified error rate calculation
    const totalAssessments = this.riskAssessments.size;
    const rejectedCount = this.metrics.rejectedOrders;
    return totalAssessments > 0 ? rejectedCount / totalAssessments : 0;
  }

  private calculateOverallRiskScore(totalExposure: bigint, avgRiskScore: number): number {
    const exposureWeight = 0.4;
    const riskWeight = 0.6;
    
    // Normalize exposure to 0-100 scale
    const maxTotalExposure = Object.values(this.config.riskProfile.maxExposurePerChain)
      .reduce((sum, max) => sum + BigInt(max), BigInt(0));
    
    const exposureScore = maxTotalExposure > 0n 
      ? Number(totalExposure * BigInt(100) / maxTotalExposure)
      : 0;
    
    return Math.min(100, exposureScore * exposureWeight + avgRiskScore * riskWeight);
  }

  private assessBridgeRisk(sourceChain: ChainId, destChain: ChainId): { score: number; recommendations: string[] } {
    const recommendations: string[] = [];
    let score = 5; // Base bridge risk
    
    // Higher risk for Bitcoin bridges
    if (this.isBitcoinChain(sourceChain) || this.isBitcoinChain(destChain)) {
      score += 10;
      recommendations.push('Bitcoin bridge involves additional settlement time risk');
    }
    
    return { score, recommendations };
  }

  private assessTimeRisk(order: CrossChainSwapState): { score: number; recommendations: string[] } {
    const recommendations: string[] = [];
    let score = 0;
    
    const now = Math.floor(Date.now() / 1000);
    const timeToExpiry = order.timelocks.source - now;
    
    if (timeToExpiry < 3600) { // Less than 1 hour
      score += 20;
      recommendations.push('Order expires within 1 hour - high time pressure risk');
    } else if (timeToExpiry < 7200) { // Less than 2 hours
      score += 10;
      recommendations.push('Order expires within 2 hours - moderate time pressure');
    } else {
      score += 2;
      recommendations.push('Sufficient time until expiry');
    }
    
    return { score, recommendations };
  }

  private isBitcoinChain(chainId: ChainId): boolean {
    return [
      SUPPORTED_CHAINS.BITCOIN_MAINNET,
      SUPPORTED_CHAINS.BITCOIN_TESTNET,
      SUPPORTED_CHAINS.BITCOIN_REGTEST
    ].includes(chainId as any);
  }

  private isValidAddress(address: string): boolean {
    // Simplified address validation
    return address.length > 10 && (address.startsWith('0x') || address.length < 100);
  }

  private reduceLimits(factor: number): void {
    for (const limit of this.exposureLimits.values()) {
      const newMax = BigInt(Math.floor(Number(BigInt(limit.maxExposure)) * factor));
      limit.maxExposure = newMax.toString();
      limit.utilizationRate = Number(BigInt(limit.currentExposure) * BigInt(100) / newMax) / 100;
    }
    
    console.log(`Reduced exposure limits by factor ${factor}`);
  }
}

export default RiskManager;