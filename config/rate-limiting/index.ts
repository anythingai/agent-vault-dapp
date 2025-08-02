import { createHash } from 'crypto';
import { EventEmitter } from 'events';

/**
 * Comprehensive Rate Limiting Configuration System
 * 
 * Provides multi-layered rate limiting with:
 * - Per-IP, per-user, and global limits
 * - Sliding window and token bucket algorithms
 * - Circuit breaker patterns
 * - Cross-chain coordination
 * - Real-time monitoring and alerting
 */

export type RateLimitAlgorithm = 'sliding_window' | 'token_bucket' | 'fixed_window' | 'adaptive';
export type RateLimitScope = 'global' | 'per_ip' | 'per_user' | 'per_api_key' | 'per_chain' | 'per_operation';
export type RateLimitTier = 'free' | 'basic' | 'premium' | 'enterprise' | 'admin';

export interface RateLimitRule {
  name: string;
  scope: RateLimitScope;
  algorithm: RateLimitAlgorithm;
  windowMs: number;
  maxRequests: number;
  burstLimit?: number;
  refillRate?: number;
  blockDuration?: number;
  skipSuccessful?: boolean;
  skipFailed?: boolean;
  keyGenerator?: (req: any) => string;
  skip?: (req: any) => boolean;
  onLimitReached?: (req: any, rateLimitInfo: RateLimitInfo) => void;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

export interface RateLimitTierConfig {
  tier: RateLimitTier;
  rules: Record<string, RateLimitRule>;
  dailyQuota?: number;
  monthlyQuota?: number;
  concurrentConnections?: number;
  priority: number;
}

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  minimumRequests: number;
  errorPercentageThreshold: number;
}

export interface AdaptiveRateLimitConfig {
  enabled: boolean;
  baseLine: number;
  maxMultiplier: number;
  adjustmentFactor: number;
  loadThresholds: {
    cpu: number;
    memory: number;
    responseTime: number;
  };
}

export interface CrossChainRateLimitConfig {
  enabled: boolean;
  coordinationMode: 'centralized' | 'distributed';
  maxCrossChainOps: number;
  crossChainWindowMs: number;
  chainSpecificLimits: Record<string, {
    maxOperations: number;
    windowMs: number;
    cooldownMs: number;
  }>;
}

export interface RateLimitMonitoringConfig {
  enabled: boolean;
  metricsRetention: number;
  alertThresholds: {
    globalRateExceeded: number;
    consecutiveBlocks: number;
    errorRateSpike: number;
    suspiciousPatterns: number;
  };
  realTimeTracking: boolean;
  exportMetrics: boolean;
}

export interface RateLimitConfig {
  enabled: boolean;
  defaultTier: RateLimitTier;
  
  // Core rate limiting rules
  tiers: Record<RateLimitTier, RateLimitTierConfig>;
  
  // Advanced features
  circuitBreakers: CircuitBreakerConfig[];
  adaptiveRateLimit: AdaptiveRateLimitConfig;
  crossChainRateLimit: CrossChainRateLimitConfig;
  
  // Storage and persistence
  storage: {
    type: 'memory' | 'redis' | 'database';
    connectionString?: string;
    keyPrefix: string;
    ttl: number;
  };
  
  // Monitoring and alerting
  monitoring: RateLimitMonitoringConfig;
  
  // Security features
  security: {
    ipWhitelist: string[];
    ipBlacklist: string[];
    countryBlacklist: string[];
    suspiciousPatternDetection: boolean;
    autoBlacklistEnabled: boolean;
    autoBlacklistThreshold: number;
  };
  
  // DOS protection specific
  dosProtection: {
    enabled: boolean;
    maxConcurrentRequests: number;
    slowLorisProtection: boolean;
    slowLorisTimeout: number;
    requestSizeLimit: string;
    headerCountLimit: number;
    urlLengthLimit: number;
    userAgentRequired: boolean;
  };
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  blocked: boolean;
  algorithm: RateLimitAlgorithm;
}

export interface RateLimitViolation {
  timestamp: number;
  key: string;
  rule: string;
  tier: RateLimitTier;
  requestInfo: {
    ip: string;
    userAgent?: string;
    endpoint: string;
    method: string;
  };
  rateLimitInfo: RateLimitInfo;
  action: 'blocked' | 'throttled' | 'logged';
}

/**
 * Advanced Rate Limiter Implementation
 */
export class RateLimiter extends EventEmitter {
  private config: RateLimitConfig;
  private storage: Map<string, any> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private adaptiveMultipliers: Map<string, number> = new Map();
  private crossChainCoordinator: CrossChainCoordinator;
  private metricsCollector: RateLimitMetricsCollector;
  private suspiciousActivityDetector: SuspiciousActivityDetector;

  constructor(config: RateLimitConfig) {
    super();
    this.config = config;
    
    // Initialize components
    this.initializeCircuitBreakers();
    this.crossChainCoordinator = new CrossChainCoordinator(config.crossChainRateLimit);
    this.metricsCollector = new RateLimitMetricsCollector(config.monitoring);
    this.suspiciousActivityDetector = new SuspiciousActivityDetector(config.security);
    
    console.log('🛡️ Advanced Rate Limiter initialized');
  }

  /**
   * Check if request should be rate limited
   */
  async checkRateLimit(
    key: string, 
    rule: RateLimitRule, 
    tier: RateLimitTier = this.config.defaultTier,
    requestInfo?: any
  ): Promise<RateLimitInfo> {
    
    // Check if request should be skipped
    if (rule.skip && requestInfo && rule.skip(requestInfo)) {
      return this.createPassInfo(rule);
    }

    // Check IP whitelist/blacklist
    if (requestInfo?.ip && !this.checkIPAllowed(requestInfo.ip)) {
      return this.createBlockedInfo(rule, 'IP blocked');
    }

    // Check circuit breaker
    const breakerKey = `${rule.name}_${tier}`;
    if (this.circuitBreakers.has(breakerKey)) {
      const breaker = this.circuitBreakers.get(breakerKey)!;
      if (breaker.isOpen()) {
        return this.createBlockedInfo(rule, 'Circuit breaker open');
      }
    }

    // Generate storage key
    const storageKey = this.generateStorageKey(key, rule, tier);
    
    // Apply rate limiting algorithm
    let rateLimitInfo: RateLimitInfo;
    
    switch (rule.algorithm) {
      case 'sliding_window':
        rateLimitInfo = await this.applySlidingWindow(storageKey, rule, tier);
        break;
      case 'token_bucket':
        rateLimitInfo = await this.applyTokenBucket(storageKey, rule, tier);
        break;
      case 'fixed_window':
        rateLimitInfo = await this.applyFixedWindow(storageKey, rule, tier);
        break;
      case 'adaptive':
        rateLimitInfo = await this.applyAdaptiveRateLimit(storageKey, rule, tier);
        break;
      default:
        rateLimitInfo = await this.applySlidingWindow(storageKey, rule, tier);
    }

    // Record metrics and check for suspicious activity
    this.recordRateLimitCheck(key, rule, tier, rateLimitInfo, requestInfo);
    
    // Check for suspicious patterns
    if (this.config.security.suspiciousPatternDetection && requestInfo) {
      this.suspiciousActivityDetector.analyze(requestInfo, rateLimitInfo);
    }

    // Handle rate limit violation
    if (rateLimitInfo.blocked) {
      await this.handleRateLimitViolation(key, rule, tier, rateLimitInfo, requestInfo);
    }

    return rateLimitInfo;
  }

  /**
   * Cross-chain rate limiting check
   */
  async checkCrossChainRateLimit(
    operation: string,
    sourceChain: string,
    destChain: string,
    userKey: string
  ): Promise<boolean> {
    if (!this.config.crossChainRateLimit.enabled) {
      return true;
    }

    return this.crossChainCoordinator.checkRateLimit(
      operation,
      sourceChain,
      destChain,
      userKey
    );
  }

  /**
   * Sliding window rate limiting
   */
  private async applySlidingWindow(
    key: string, 
    rule: RateLimitRule, 
    tier: RateLimitTier
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = now - rule.windowMs;
    
    // Get existing requests in window
    let requestTimes: number[] = this.storage.get(key) || [];
    
    // Remove expired requests
    requestTimes = requestTimes.filter(time => time > windowStart);
    
    // Check if limit exceeded
    const currentCount = requestTimes.length;
    const limit = this.getAdjustedLimit(rule.maxRequests, tier);
    
    if (currentCount >= limit) {
      const oldestRequest = Math.min(...requestTimes);
      const resetTime = oldestRequest + rule.windowMs;
      
      return {
        limit,
        current: currentCount,
        remaining: 0,
        resetTime,
        retryAfter: Math.ceil((resetTime - now) / 1000),
        blocked: true,
        algorithm: 'sliding_window'
      };
    }

    // Add current request
    requestTimes.push(now);
    this.storage.set(key, requestTimes);
    
    return {
      limit,
      current: currentCount + 1,
      remaining: limit - currentCount - 1,
      resetTime: now + rule.windowMs,
      blocked: false,
      algorithm: 'sliding_window'
    };
  }

  /**
   * Token bucket rate limiting
   */
  private async applyTokenBucket(
    key: string, 
    rule: RateLimitRule, 
    tier: RateLimitTier
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    const bucket = this.storage.get(key) || {
      tokens: rule.maxRequests,
      lastRefill: now
    };
    
    // Refill tokens based on time elapsed
    const timePassed = now - bucket.lastRefill;
    const refillRate = rule.refillRate || rule.maxRequests / (rule.windowMs / 1000);
    const tokensToAdd = Math.floor((timePassed / 1000) * refillRate);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(rule.maxRequests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
    
    const limit = this.getAdjustedLimit(rule.maxRequests, tier);
    
    if (bucket.tokens < 1) {
      const timeToNextToken = (1000 / refillRate) - (timePassed % (1000 / refillRate));
      
      return {
        limit,
        current: 0,
        remaining: 0,
        resetTime: now + timeToNextToken,
        retryAfter: Math.ceil(timeToNextToken / 1000),
        blocked: true,
        algorithm: 'token_bucket'
      };
    }
    
    // Consume token
    bucket.tokens -= 1;
    this.storage.set(key, bucket);
    
    return {
      limit,
      current: limit - bucket.tokens,
      remaining: bucket.tokens,
      resetTime: now + (bucket.tokens * (1000 / refillRate)),
      blocked: false,
      algorithm: 'token_bucket'
    };
  }

  /**
   * Fixed window rate limiting
   */
  private async applyFixedWindow(
    key: string, 
    rule: RateLimitRule, 
    tier: RateLimitTier
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
    const windowKey = `${key}:${windowStart}`;
    
    const currentCount = this.storage.get(windowKey) || 0;
    const limit = this.getAdjustedLimit(rule.maxRequests, tier);
    
    if (currentCount >= limit) {
      const resetTime = windowStart + rule.windowMs;
      
      return {
        limit,
        current: currentCount,
        remaining: 0,
        resetTime,
        retryAfter: Math.ceil((resetTime - now) / 1000),
        blocked: true,
        algorithm: 'fixed_window'
      };
    }
    
    this.storage.set(windowKey, currentCount + 1);
    
    // Clean up old windows
    setTimeout(() => this.storage.delete(windowKey), rule.windowMs + 1000);
    
    return {
      limit,
      current: currentCount + 1,
      remaining: limit - currentCount - 1,
      resetTime: windowStart + rule.windowMs,
      blocked: false,
      algorithm: 'fixed_window'
    };
  }

  /**
   * Adaptive rate limiting based on system load
   */
  private async applyAdaptiveRateLimit(
    key: string, 
    rule: RateLimitRule, 
    tier: RateLimitTier
  ): Promise<RateLimitInfo> {
    if (!this.config.adaptiveRateLimit.enabled) {
      return this.applySlidingWindow(key, rule, tier);
    }

    // Get current system load multiplier
    const loadMultiplier = this.getLoadMultiplier();
    const adjustedRule = { 
      ...rule, 
      maxRequests: Math.floor(rule.maxRequests * loadMultiplier) 
    };
    
    return this.applySlidingWindow(key, adjustedRule, tier);
  }

  /**
   * Generate storage key for rate limiting
   */
  private generateStorageKey(key: string, rule: RateLimitRule, tier: RateLimitTier): string {
    const hash = createHash('sha256')
      .update(`${key}:${rule.name}:${tier}`)
      .digest('hex')
      .substring(0, 16);
    
    return `${this.config.storage.keyPrefix}:${rule.scope}:${hash}`;
  }

  /**
   * Get adjusted limit based on tier
   */
  private getAdjustedLimit(baseLimit: number, tier: RateLimitTier): number {
    const tierMultipliers: Record<RateLimitTier, number> = {
      free: 0.5,
      basic: 1.0,
      premium: 2.0,
      enterprise: 5.0,
      admin: 10.0
    };
    
    return Math.floor(baseLimit * tierMultipliers[tier]);
  }

  /**
   * Check if IP is allowed
   */
  private checkIPAllowed(ip: string): boolean {
    const { ipWhitelist, ipBlacklist } = this.config.security;
    
    if (ipWhitelist.length > 0 && !ipWhitelist.includes(ip)) {
      return false;
    }
    
    if (ipBlacklist.includes(ip)) {
      return false;
    }
    
    return true;
  }

  /**
   * Get current system load multiplier for adaptive rate limiting
   */
  private getLoadMultiplier(): number {
    // This would integrate with actual system monitoring
    // For now, return a mock implementation
    const baseLine = this.config.adaptiveRateLimit.baseLine;
    const maxMultiplier = this.config.adaptiveRateLimit.maxMultiplier;
    
    // Mock system load (in production, get from actual metrics)
    const systemLoad = 0.7; // 70% load
    
    if (systemLoad <= 0.5) return maxMultiplier;
    if (systemLoad >= 0.9) return 0.1;
    
    return Math.max(0.1, maxMultiplier - (systemLoad - 0.5) * 2);
  }

  /**
   * Initialize circuit breakers
   */
  private initializeCircuitBreakers(): void {
    this.config.circuitBreakers.forEach(config => {
      const breaker = new CircuitBreaker(config);
      this.circuitBreakers.set(config.name, breaker);
    });
  }

  /**
   * Handle rate limit violation
   */
  private async handleRateLimitViolation(
    key: string,
    rule: RateLimitRule,
    tier: RateLimitTier,
    rateLimitInfo: RateLimitInfo,
    requestInfo?: any
  ): Promise<void> {
    const violation: RateLimitViolation = {
      timestamp: Date.now(),
      key,
      rule: rule.name,
      tier,
      requestInfo: {
        ip: requestInfo?.ip || 'unknown',
        userAgent: requestInfo?.userAgent,
        endpoint: requestInfo?.endpoint || 'unknown',
        method: requestInfo?.method || 'unknown'
      },
      rateLimitInfo,
      action: 'blocked'
    };

    // Record violation
    this.metricsCollector.recordViolation(violation);
    
    // Emit event
    this.emit('rateLimitViolation', violation);
    
    // Check for auto-blacklist
    if (this.config.security.autoBlacklistEnabled) {
      await this.checkAutoBlacklist(requestInfo?.ip, violation);
    }

    // Execute custom handler
    if (rule.onLimitReached) {
      rule.onLimitReached(requestInfo, rateLimitInfo);
    }
  }

  /**
   * Check if IP should be auto-blacklisted
   */
  private async checkAutoBlacklist(ip: string, violation: RateLimitViolation): Promise<void> {
    if (!ip) return;
    
    const recentViolations = this.metricsCollector.getRecentViolationsByIP(ip, 300000); // 5 minutes
    
    if (recentViolations >= this.config.security.autoBlacklistThreshold) {
      this.config.security.ipBlacklist.push(ip);
      this.emit('ipAutoBlacklisted', { ip, violations: recentViolations });
      
      console.log(`🚫 IP ${ip} auto-blacklisted after ${recentViolations} violations`);
    }
  }

  /**
   * Record rate limit check for metrics
   */
  private recordRateLimitCheck(
    key: string,
    rule: RateLimitRule,
    tier: RateLimitTier,
    rateLimitInfo: RateLimitInfo,
    requestInfo?: any
  ): void {
    this.metricsCollector.recordCheck({
      key,
      rule: rule.name,
      tier,
      rateLimitInfo,
      requestInfo,
      timestamp: Date.now()
    });
  }

  /**
   * Create pass-through rate limit info
   */
  private createPassInfo(rule: RateLimitRule): RateLimitInfo {
    return {
      limit: rule.maxRequests,
      current: 0,
      remaining: rule.maxRequests,
      resetTime: Date.now() + rule.windowMs,
      blocked: false,
      algorithm: rule.algorithm
    };
  }

  /**
   * Create blocked rate limit info
   */
  private createBlockedInfo(rule: RateLimitRule, reason: string): RateLimitInfo {
    return {
      limit: rule.maxRequests,
      current: rule.maxRequests,
      remaining: 0,
      resetTime: Date.now() + (rule.blockDuration || rule.windowMs),
      retryAfter: Math.ceil((rule.blockDuration || rule.windowMs) / 1000),
      blocked: true,
      algorithm: rule.algorithm
    };
  }

  /**
   * Get rate limiting metrics
   */
  getMetrics(): any {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Reset rate limits for a key
   */
  async resetRateLimit(key: string, rule?: string): Promise<void> {
    if (rule) {
      const storageKey = this.generateStorageKey(key, { name: rule } as RateLimitRule, this.config.defaultTier);
      this.storage.delete(storageKey);
    } else {
      // Clear all rate limits for key
      for (const [storageKey] of this.storage) {
        if (storageKey.includes(key)) {
          this.storage.delete(storageKey);
        }
      }
    }
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }
}

/**
 * Circuit Breaker Implementation
 */
class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private requestCount = 0;
  private successCount = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = 'half-open';
        this.requestCount = 0;
        this.successCount = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.successCount++;
    this.requestCount++;
    
    if (this.state === 'half-open' && this.successCount >= this.config.minimumRequests) {
      this.state = 'closed';
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.requestCount++;
    this.lastFailureTime = Date.now();
    
    if (this.requestCount >= this.config.minimumRequests) {
      const errorPercentage = (this.failureCount / this.requestCount) * 100;
      if (errorPercentage >= this.config.errorPercentageThreshold) {
        this.state = 'open';
      }
    }
  }
}

/**
 * Cross-Chain Rate Limiting Coordinator
 */
class CrossChainCoordinator {
  private config: CrossChainRateLimitConfig;
  private operationCounts: Map<string, number[]> = new Map();

  constructor(config: CrossChainRateLimitConfig) {
    this.config = config;
  }

  async checkRateLimit(
    operation: string,
    sourceChain: string,
    destChain: string,
    userKey: string
  ): Promise<boolean> {
    const key = `${userKey}:${operation}:${sourceChain}:${destChain}`;
    const now = Date.now();
    const windowStart = now - this.config.crossChainWindowMs;
    
    // Get and filter recent operations
    let operations = this.operationCounts.get(key) || [];
    operations = operations.filter(time => time > windowStart);
    
    // Check global cross-chain limit
    if (operations.length >= this.config.maxCrossChainOps) {
      return false;
    }
    
    // Check chain-specific limits
    const chainLimits = this.config.chainSpecificLimits[sourceChain];
    if (chainLimits) {
      const chainKey = `${userKey}:${sourceChain}`;
      let chainOps = this.operationCounts.get(chainKey) || [];
      chainOps = chainOps.filter(time => time > (now - chainLimits.windowMs));
      
      if (chainOps.length >= chainLimits.maxOperations) {
        return false;
      }
      
      chainOps.push(now);
      this.operationCounts.set(chainKey, chainOps);
    }
    
    // Record operation
    operations.push(now);
    this.operationCounts.set(key, operations);
    
    return true;
  }
}

/**
 * Rate Limiting Metrics Collector
 */
class RateLimitMetricsCollector {
  private config: RateLimitMonitoringConfig;
  private violations: RateLimitViolation[] = [];
  private checks: any[] = [];
  private ipViolations: Map<string, number[]> = new Map();

  constructor(config: RateLimitMonitoringConfig) {
    this.config = config;
    
    if (config.enabled) {
      this.startCleanupTask();
    }
  }

  recordViolation(violation: RateLimitViolation): void {
    this.violations.push(violation);
    
    // Track IP violations
    const ip = violation.requestInfo.ip;
    if (ip !== 'unknown') {
      const ipViols = this.ipViolations.get(ip) || [];
      ipViols.push(violation.timestamp);
      this.ipViolations.set(ip, ipViols);
    }
    
    // Clean old violations
    this.cleanOldData();
  }

  recordCheck(checkData: any): void {
    this.checks.push(checkData);
    this.cleanOldData();
  }

  getRecentViolationsByIP(ip: string, windowMs: number): number {
    const now = Date.now();
    const violations = this.ipViolations.get(ip) || [];
    return violations.filter(time => time > (now - windowMs)).length;
  }

  getMetrics(): any {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const lastHour = now - 60 * 60 * 1000;
    
    const recentViolations = this.violations.filter(v => v.timestamp > last24h);
    const recentChecks = this.checks.filter(c => c.timestamp > last24h);
    
    return {
      violations: {
        total: this.violations.length,
        last24h: recentViolations.length,
        lastHour: this.violations.filter(v => v.timestamp > lastHour).length,
        byTier: this.groupBy(recentViolations, 'tier'),
        byRule: this.groupBy(recentViolations, 'rule')
      },
      checks: {
        total: this.checks.length,
        last24h: recentChecks.length,
        lastHour: this.checks.filter(c => c.timestamp > lastHour).length
      },
      topOffendingIPs: this.getTopOffendingIPs(10)
    };
  }

  private groupBy(array: any[], key: string): Record<string, number> {
    return array.reduce((acc, item) => {
      const value = item[key];
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  private getTopOffendingIPs(limit: number): Array<{ ip: string; violations: number }> {
    const ipCounts: Record<string, number> = {};
    
    this.violations.forEach(v => {
      const ip = v.requestInfo.ip;
      if (ip !== 'unknown') {
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }
    });
    
    return Object.entries(ipCounts)
      .map(([ip, violations]) => ({ ip, violations }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, limit);
  }

  private cleanOldData(): void {
    const cutoff = Date.now() - this.config.metricsRetention;
    
    this.violations = this.violations.filter(v => v.timestamp > cutoff);
    this.checks = this.checks.filter(c => c.timestamp > cutoff);
    
    // Clean IP violations
    for (const [ip, times] of this.ipViolations.entries()) {
      const filtered = times.filter(time => time > cutoff);
      if (filtered.length === 0) {
        this.ipViolations.delete(ip);
      } else {
        this.ipViolations.set(ip, filtered);
      }
    }
  }

  private startCleanupTask(): void {
    setInterval(() => {
      this.cleanOldData();
    }, 5 * 60 * 1000); // Clean every 5 minutes
  }
}

/**
 * Suspicious Activity Detector
 */
class SuspiciousActivityDetector {
  private securityConfig: RateLimitConfig['security'];
  private patterns: Map<string, any[]> = new Map();

  constructor(securityConfig: RateLimitConfig['security']) {
    this.securityConfig = securityConfig;
  }

  analyze(requestInfo: any, rateLimitInfo: RateLimitInfo): void {
    if (!this.securityConfig.suspiciousPatternDetection) {
      return;
    }

    // Analyze request patterns
    this.analyzeRequestPattern(requestInfo, rateLimitInfo);
    this.analyzeUserAgentPattern(requestInfo);
    this.analyzeTimingPattern(requestInfo);
  }

  private analyzeRequestPattern(requestInfo: any, rateLimitInfo: RateLimitInfo): void {
    // Implementation for request pattern analysis
    // This would detect various attack patterns
  }

  private analyzeUserAgentPattern(requestInfo: any): void {
    // Implementation for user agent pattern analysis
    // This would detect suspicious or automated user agents
  }

  private analyzeTimingPattern(requestInfo: any): void {
    // Implementation for timing pattern analysis
    // This would detect rapid-fire requests and other timing-based attacks
  }
}

/**
 * Factory function to create default rate limiting configuration
 */
export function createDefaultRateLimitConfig(): RateLimitConfig {
  return {
    enabled: process.env.RATE_LIMITING_ENABLED !== 'false',
    defaultTier: (process.env.DEFAULT_RATE_LIMIT_TIER as RateLimitTier) || 'basic',
    
    tiers: {
      free: {
        tier: 'free',
        priority: 1,
        rules: {
          global: {
            name: 'global_free',
            scope: 'global',
            algorithm: 'sliding_window',
            windowMs: 15 * 60 * 1000,
            maxRequests: 100,
            message: 'Rate limit exceeded for free tier'
          },
          api: {
            name: 'api_free',
            scope: 'per_ip',
            algorithm: 'sliding_window',
            windowMs: 60 * 1000,
            maxRequests: 20
          }
        },
        dailyQuota: 1000,
        concurrentConnections: 5
      },
      basic: {
        tier: 'basic',
        priority: 2,
        rules: {
          global: {
            name: 'global_basic',
            scope: 'global',
            algorithm: 'sliding_window',
            windowMs: 15 * 60 * 1000,
            maxRequests: 1000
          },
          api: {
            name: 'api_basic',
            scope: 'per_ip',
            algorithm: 'sliding_window',
            windowMs: 60 * 1000,
            maxRequests: 100
          }
        },
        dailyQuota: 10000,
        concurrentConnections: 20
      },
      premium: {
        tier: 'premium',
        priority: 3,
        rules: {
          global: {
            name: 'global_premium',
            scope: 'global',
            algorithm: 'token_bucket',
            windowMs: 15 * 60 * 1000,
            maxRequests: 5000,
            burstLimit: 100,
            refillRate: 10
          },
          api: {
            name: 'api_premium',
            scope: 'per_user',
            algorithm: 'token_bucket',
            windowMs: 60 * 1000,
            maxRequests: 500,
            burstLimit: 50
          }
        },
        dailyQuota: 100000,
        concurrentConnections: 100
      },
      enterprise: {
        tier: 'enterprise',
        priority: 4,
        rules: {
          global: {
            name: 'global_enterprise',
            scope: 'global',
            algorithm: 'adaptive',
            windowMs: 15 * 60 * 1000,
            maxRequests: 20000
          },
          api: {
            name: 'api_enterprise',
            scope: 'per_user',
            algorithm: 'adaptive',
            windowMs: 60 * 1000,
            maxRequests: 2000
          }
        },
        dailyQuota: 1000000,
        concurrentConnections: 500
      },
      admin: {
        tier: 'admin',
        priority: 5,
        rules: {
          global: {
            name: 'global_admin',
            scope: 'global',
            algorithm: 'sliding_window',
            windowMs: 15 * 60 * 1000,
            maxRequests: 100000
          },
          api: {
            name: 'api_admin',
            scope: 'per_user',
            algorithm: 'sliding_window',
            windowMs: 60 * 1000,
            maxRequests: 10000
          }
        },
        dailyQuota: 10000000,
        concurrentConnections: 1000
      }
    },

    circuitBreakers: [
      {
        name: 'global_circuit_breaker',
        failureThreshold: 10,
        recoveryTimeout: 30000,
        monitoringPeriod: 60000,
        minimumRequests: 20,
        errorPercentageThreshold: 50
      }
    ],

    adaptiveRateLimit: {
      enabled: process.env.ADAPTIVE_RATE_LIMITING === 'true',
      baseLine: 1.0,
      maxMultiplier: 2.0,
      adjustmentFactor: 0.1,
      loadThresholds: {
        cpu: 80,
        memory: 85,
        responseTime: 1000
      }
    },

    crossChainRateLimit: {
      enabled: process.env.CROSS_CHAIN_RATE_LIMITING === 'true',
      coordinationMode: 'centralized',
      maxCrossChainOps: 10,
      crossChainWindowMs: 5 * 60 * 1000,
      chainSpecificLimits: {
        '1': { maxOperations: 5, windowMs: 60000, cooldownMs: 10000 }, // Ethereum
        '100': { maxOperations: 20, windowMs: 300000, cooldownMs: 30000 } // Bitcoin
      }
    },

    storage: {
      type: (process.env.RATE_LIMIT_STORAGE as 'memory' | 'redis' | 'database') || 'memory',
      connectionString: process.env.RATE_LIMIT_STORAGE_URL,
      keyPrefix: 'rl',
      ttl: 24 * 60 * 60 // 24 hours
    },

    monitoring: {
      enabled: process.env.RATE_LIMIT_MONITORING === 'true',
      metricsRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
      alertThresholds: {
        globalRateExceeded: 10000,
        consecutiveBlocks: 5,
        errorRateSpike: 50,
        suspiciousPatterns: 10
      },
      realTimeTracking: true,
      exportMetrics: true
    },

    security: {
      ipWhitelist: (process.env.IP_WHITELIST || '').split(',').filter(Boolean),
      ipBlacklist: (process.env.IP_BLACKLIST || '').split(',').filter(Boolean),
      countryBlacklist: (process.env.COUNTRY_BLACKLIST || '').split(',').filter(Boolean),
      suspiciousPatternDetection: process.env.SUSPICIOUS_PATTERN_DETECTION === 'true',
      autoBlacklistEnabled: process.env.AUTO_BLACKLIST_ENABLED === 'true',
      autoBlacklistThreshold: parseInt(process.env.AUTO_BLACKLIST_THRESHOLD || '10')
    },

    dosProtection: {
      enabled: process.env.DOS_PROTECTION_ENABLED !== 'false',
      maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '1000'),
      slowLorisProtection: true,
      slowLorisTimeout: 10000,
      requestSizeLimit: process.env.REQUEST_SIZE_LIMIT || '1mb',
      headerCountLimit: 100,
      urlLengthLimit: 2048,
      userAgentRequired: true
    }
  };
}

export default RateLimiter;