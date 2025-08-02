import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * Cross-Chain Coordinated Rate Limiting Service
 * 
 * Provides sophisticated rate limiting across multiple blockchain networks:
 * - Coordinated limits between Ethereum and Bitcoin operations
 * - Resource pool management for blockchain interactions
 * - Queue management for pending cross-chain operations
 * - Failure rate monitoring and circuit breaking
 * - Chain-specific cooling periods and backpressure
 * - Economic incentives alignment
 */

export interface ChainConfig {
  chainId: string;
  name: string;
  type: 'ethereum' | 'bitcoin';
  rpcEndpoints: string[];
  maxConcurrentOps: number;
  maxQueueSize: number;
  avgBlockTime: number; // seconds
  confirmationsRequired: number;
  gasLimitPerBlock?: number;
  feeEstimationEndpoint?: string;
}

export interface CrossChainLimits {
  // Global cross-chain limits
  maxCrossChainOpsPerUser: number;
  maxCrossChainOpsGlobal: number;
  crossChainWindowMs: number;
  
  // Chain-specific limits
  chainSpecificLimits: Record<string, {
    maxOperations: number;
    windowMs: number;
    cooldownMs: number;
    maxConcurrent: number;
    queueTimeout: number;
  }>;
  
  // Operation-specific limits
  operationLimits: Record<string, {
    maxPerWindow: number;
    windowMs: number;
    minInterval: number;
    maxConcurrent: number;
  }>;
  
  // Economic limits
  economicLimits: {
    maxValuePerOperation: string; // in wei/sats
    maxValuePerWindow: string;
    maxValuePerUser: string;
    windowMs: number;
  };
}

export interface ResourcePool {
  chainId: string;
  totalCapacity: number;
  availableCapacity: number;
  reservedCapacity: number;
  activeOperations: Map<string, CrossChainOperation>;
  queuedOperations: CrossChainOperation[];
  lastRebalance: number;
  utilizationRate: number;
}

export interface CrossChainOperation {
  id: string;
  userId: string;
  type: 'escrow_create' | 'escrow_redeem' | 'escrow_refund' | 'swap_initiate' | 'swap_complete';
  sourceChain: string;
  destinationChain: string;
  value: string;
  gasEstimate?: number;
  priority: number;
  createdAt: number;
  estimatedDuration: number;
  retryCount: number;
  maxRetries: number;
  cooldownUntil?: number;
  dependencies: string[]; // Operation IDs this depends on
  metadata: Record<string, any>;
}

export interface UserLimits {
  userId: string;
  crossChainOperations: {
    operations: CrossChainOperation[];
    totalValue: bigint;
    windowStart: number;
  };
  chainOperations: Record<string, {
    operations: number[];
    lastOperation: number;
    cooldownUntil: number;
    violations: number;
  }>;
  economicLimits: {
    totalSpent: bigint;
    windowStart: number;
    dailySpent: bigint;
    dailyStart: number;
  };
}

export interface CircuitBreaker {
  chainId: string;
  isOpen: boolean;
  failureCount: number;
  successCount: number;
  lastFailure: number;
  lastSuccess: number;
  openedAt: number;
  failureThreshold: number;
  recoveryTime: number;
  halfOpenMaxRequests: number;
  currentHalfOpenRequests: number;
}

export class CrossChainRateLimitService extends EventEmitter {
  private chainConfigs: Map<string, ChainConfig> = new Map();
  private resourcePools: Map<string, ResourcePool> = new Map();
  private userLimits: Map<string, UserLimits> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private crossChainLimits: CrossChainLimits;
  
  // Coordination state
  private globalOperationCount = 0;
  private operationDependencies: Map<string, Set<string>> = new Map();
  private coordinationLocks: Map<string, number> = new Map(); // userId -> timestamp
  
  // Monitoring
  private stats = {
    totalOperations: 0,
    blockedOperations: 0,
    queuedOperations: 0,
    failedOperations: 0,
    crossChainViolations: 0,
    circuitBreakerTrips: 0
  };

  constructor(config: {
    chains: ChainConfig[];
    limits: CrossChainLimits;
  }) {
    super();
    
    this.crossChainLimits = config.limits;
    
    // Initialize chain configurations
    for (const chainConfig of config.chains) {
      this.chainConfigs.set(chainConfig.chainId, chainConfig);
      this.initializeResourcePool(chainConfig);
      this.initializeCircuitBreaker(chainConfig);
    }
    
    // Start background tasks
    this.startRebalancingTask();
    this.startQueueProcessor();
    this.startCleanupTasks();
    
    console.log('🔗 Cross-Chain Rate Limiting Service initialized');
  }

  /**
   * Request permission for a cross-chain operation
   */
  async requestOperation(operation: Partial<CrossChainOperation>): Promise<{
    allowed: boolean;
    reason?: string;
    estimatedDelay?: number;
    operationId?: string;
  }> {
    const operationId = this.generateOperationId();
    const fullOperation: CrossChainOperation = {
      id: operationId,
      userId: operation.userId!,
      type: operation.type!,
      sourceChain: operation.sourceChain!,
      destinationChain: operation.destinationChain!,
      value: operation.value!,
      gasEstimate: operation.gasEstimate,
      priority: operation.priority || 0,
      createdAt: Date.now(),
      estimatedDuration: this.estimateOperationDuration(operation),
      retryCount: 0,
      maxRetries: 3,
      dependencies: operation.dependencies || [],
      metadata: operation.metadata || {}
    };

    this.stats.totalOperations++;

    try {
      // Check circuit breakers
      const circuitCheck = this.checkCircuitBreakers(fullOperation);
      if (!circuitCheck.allowed) {
        return circuitCheck;
      }

      // Check cross-chain limits
      const crossChainCheck = await this.checkCrossChainLimits(fullOperation);
      if (!crossChainCheck.allowed) {
        this.stats.crossChainViolations++;
        return crossChainCheck;
      }

      // Check resource availability
      const resourceCheck = await this.checkResourceAvailability(fullOperation);
      if (!resourceCheck.allowed) {
        // Queue the operation if resources are unavailable
        return this.queueOperation(fullOperation);
      }

      // Check operation dependencies
      const dependencyCheck = this.checkOperationDependencies(fullOperation);
      if (!dependencyCheck.allowed) {
        return this.queueOperation(fullOperation);
      }

      // Reserve resources and approve operation
      await this.reserveResources(fullOperation);
      this.recordUserOperation(fullOperation);
      
      this.emit('operationApproved', fullOperation);
      
      return {
        allowed: true,
        operationId: fullOperation.id
      };

    } catch (error) {
      console.error('Error processing operation request:', error);
      this.stats.failedOperations++;
      return {
        allowed: false,
        reason: 'Internal error processing request'
      };
    }
  }

  /**
   * Complete an operation and free resources
   */
  async completeOperation(
    operationId: string, 
    success: boolean, 
    metadata?: Record<string, any>
  ): Promise<void> {
    // Find the operation in resource pools
    let operation: CrossChainOperation | undefined;
    let resourcePool: ResourcePool | undefined;

    for (const pool of this.resourcePools.values()) {
      if (pool.activeOperations.has(operationId)) {
        operation = pool.activeOperations.get(operationId);
        resourcePool = pool;
        break;
      }
    }

    if (!operation || !resourcePool) {
      console.warn(`Operation ${operationId} not found in active operations`);
      return;
    }

    try {
      // Update circuit breaker
      const circuitBreaker = this.circuitBreakers.get(operation.sourceChain);
      if (circuitBreaker) {
        if (success) {
          this.recordCircuitBreakerSuccess(circuitBreaker);
        } else {
          this.recordCircuitBreakerFailure(circuitBreaker);
        }
      }

      // Free resources
      this.freeResources(operation, resourcePool);
      
      // Update operation dependencies
      this.resolveOperationDependencies(operationId);
      
      // Update user limits on completion
      this.updateUserOperationCompletion(operation, success);

      this.emit('operationCompleted', {
        operation,
        success,
        metadata
      });

      console.log(`Operation ${operationId} completed (success: ${success})`);

    } catch (error) {
      console.error('Error completing operation:', error);
    }
  }

  /**
   * Check cross-chain operation limits
   */
  private async checkCrossChainLimits(operation: CrossChainOperation): Promise<{
    allowed: boolean;
    reason?: string;
    estimatedDelay?: number;
  }> {
    const userId = operation.userId;
    const userLimits = this.getUserLimits(userId);
    const now = Date.now();

    // Check global cross-chain limits
    if (this.globalOperationCount >= this.crossChainLimits.maxCrossChainOpsGlobal) {
      return {
        allowed: false,
        reason: 'Global cross-chain operation limit exceeded'
      };
    }

    // Check user cross-chain limits
    const userCrossChainOps = userLimits.crossChainOperations;
    const windowStart = now - this.crossChainLimits.crossChainWindowMs;
    
    // Clean old operations
    userCrossChainOps.operations = userCrossChainOps.operations.filter(
      op => op.createdAt > windowStart
    );

    if (userCrossChainOps.operations.length >= this.crossChainLimits.maxCrossChainOpsPerUser) {
      const oldestOp = Math.min(...userCrossChainOps.operations.map(op => op.createdAt));
      const estimatedDelay = oldestOp + this.crossChainLimits.crossChainWindowMs - now;
      
      return {
        allowed: false,
        reason: 'User cross-chain operation limit exceeded',
        estimatedDelay
      };
    }

    // Check chain-specific limits
    const chainLimits = this.crossChainLimits.chainSpecificLimits[operation.sourceChain];
    if (chainLimits) {
      const chainOps = userLimits.chainOperations[operation.sourceChain];
      if (chainOps) {
        const chainWindowStart = now - chainLimits.windowMs;
        chainOps.operations = chainOps.operations.filter(time => time > chainWindowStart);

        if (chainOps.operations.length >= chainLimits.maxOperations) {
          return {
            allowed: false,
            reason: `Chain ${operation.sourceChain} operation limit exceeded`
          };
        }

        // Check cooldown period
        if (now < chainOps.cooldownUntil) {
          return {
            allowed: false,
            reason: 'Chain operation in cooldown period',
            estimatedDelay: chainOps.cooldownUntil - now
          };
        }
      }
    }

    // Check operation-specific limits
    const opLimits = this.crossChainLimits.operationLimits[operation.type];
    if (opLimits) {
      const recentOps = userCrossChainOps.operations.filter(
        op => op.type === operation.type && op.createdAt > (now - opLimits.windowMs)
      );

      if (recentOps.length >= opLimits.maxPerWindow) {
        return {
          allowed: false,
          reason: `Operation type ${operation.type} limit exceeded`
        };
      }

      // Check minimum interval
      const lastOpTime = Math.max(...recentOps.map(op => op.createdAt), 0);
      if (now - lastOpTime < opLimits.minInterval) {
        return {
          allowed: false,
          reason: 'Minimum operation interval not met',
          estimatedDelay: opLimits.minInterval - (now - lastOpTime)
        };
      }
    }

    // Check economic limits
    const value = BigInt(operation.value);
    const economicLimits = this.crossChainLimits.economicLimits;
    const userEconomic = userLimits.economicLimits;

    // Reset window if needed
    if (now - userEconomic.windowStart > economicLimits.windowMs) {
      userEconomic.totalSpent = BigInt(0);
      userEconomic.windowStart = now;
    }

    // Check single operation limit
    if (value > BigInt(economicLimits.maxValuePerOperation)) {
      return {
        allowed: false,
        reason: 'Operation value exceeds maximum allowed'
      };
    }

    // Check window limit
    if (userEconomic.totalSpent + value > BigInt(economicLimits.maxValuePerWindow)) {
      return {
        allowed: false,
        reason: 'Window value limit would be exceeded'
      };
    }

    // Check user total limit
    if (userEconomic.totalSpent + value > BigInt(economicLimits.maxValuePerUser)) {
      return {
        allowed: false,
        reason: 'User total value limit would be exceeded'
      };
    }

    return { allowed: true };
  }

  /**
   * Check circuit breakers
   */
  private checkCircuitBreakers(operation: CrossChainOperation): {
    allowed: boolean;
    reason?: string;
  } {
    const sourceBreaker = this.circuitBreakers.get(operation.sourceChain);
    const destBreaker = this.circuitBreakers.get(operation.destinationChain);

    if (sourceBreaker?.isOpen) {
      // Check if recovery time has passed
      const now = Date.now();
      if (now - sourceBreaker.openedAt >= sourceBreaker.recoveryTime) {
        // Try half-open state
        if (sourceBreaker.currentHalfOpenRequests < sourceBreaker.halfOpenMaxRequests) {
          sourceBreaker.currentHalfOpenRequests++;
          return { allowed: true };
        }
      }
      
      return {
        allowed: false,
        reason: `Source chain ${operation.sourceChain} circuit breaker is open`
      };
    }

    if (destBreaker?.isOpen) {
      const now = Date.now();
      if (now - destBreaker.openedAt >= destBreaker.recoveryTime) {
        if (destBreaker.currentHalfOpenRequests < destBreaker.halfOpenMaxRequests) {
          destBreaker.currentHalfOpenRequests++;
          return { allowed: true };
        }
      }
      
      return {
        allowed: false,
        reason: `Destination chain ${operation.destinationChain} circuit breaker is open`
      };
    }

    return { allowed: true };
  }

  /**
   * Check resource availability
   */
  private async checkResourceAvailability(operation: CrossChainOperation): Promise<{
    allowed: boolean;
    reason?: string;
    estimatedDelay?: number;
  }> {
    const sourcePool = this.resourcePools.get(operation.sourceChain);
    const destPool = this.resourcePools.get(operation.destinationChain);

    if (!sourcePool || !destPool) {
      return {
        allowed: false,
        reason: 'Chain resource pool not found'
      };
    }

    // Estimate resource requirements
    const estimatedSourceCost = this.estimateResourceCost(operation, 'source');
    const estimatedDestCost = this.estimateResourceCost(operation, 'destination');

    // Check source chain capacity
    if (sourcePool.availableCapacity < estimatedSourceCost) {
      const estimatedDelay = this.estimateResourceAvailabilityDelay(sourcePool, estimatedSourceCost);
      return {
        allowed: false,
        reason: 'Insufficient source chain capacity',
        estimatedDelay
      };
    }

    // Check destination chain capacity
    if (destPool.availableCapacity < estimatedDestCost) {
      const estimatedDelay = this.estimateResourceAvailabilityDelay(destPool, estimatedDestCost);
      return {
        allowed: false,
        reason: 'Insufficient destination chain capacity',
        estimatedDelay
      };
    }

    // Check concurrent operation limits
    if (sourcePool.activeOperations.size >= this.chainConfigs.get(operation.sourceChain)!.maxConcurrentOps) {
      return {
        allowed: false,
        reason: 'Source chain concurrent operation limit reached'
      };
    }

    if (destPool.activeOperations.size >= this.chainConfigs.get(operation.destinationChain)!.maxConcurrentOps) {
      return {
        allowed: false,
        reason: 'Destination chain concurrent operation limit reached'
      };
    }

    return { allowed: true };
  }

  /**
   * Queue operation for later processing
   */
  private queueOperation(operation: CrossChainOperation): {
    allowed: boolean;
    reason: string;
    estimatedDelay: number;
  } {
    const sourcePool = this.resourcePools.get(operation.sourceChain);
    if (!sourcePool) {
      return {
        allowed: false,
        reason: 'Source chain not configured',
        estimatedDelay: 0
      };
    }

    // Check queue size limits
    const maxQueueSize = this.chainConfigs.get(operation.sourceChain)!.maxQueueSize;
    if (sourcePool.queuedOperations.length >= maxQueueSize) {
      this.stats.blockedOperations++;
      return {
        allowed: false,
        reason: 'Queue is full',
        estimatedDelay: 0
      };
    }

    // Insert into priority queue
    const insertIndex = this.findQueueInsertionPoint(sourcePool.queuedOperations, operation);
    sourcePool.queuedOperations.splice(insertIndex, 0, operation);
    
    this.stats.queuedOperations++;
    
    // Estimate delay based on queue position and average processing time
    const averageProcessingTime = this.calculateAverageProcessingTime(operation.sourceChain);
    const estimatedDelay = insertIndex * averageProcessingTime;

    this.emit('operationQueued', {
      operation,
      queuePosition: insertIndex,
      estimatedDelay
    });

    return {
      allowed: true, // Queued counts as allowed
      reason: 'Operation queued due to resource constraints',
      estimatedDelay
    };
  }

  /**
   * Reserve resources for operation
   */
  private async reserveResources(operation: CrossChainOperation): Promise<void> {
    const sourcePool = this.resourcePools.get(operation.sourceChain)!;
    const destPool = this.resourcePools.get(operation.destinationChain)!;

    const sourceCost = this.estimateResourceCost(operation, 'source');
    const destCost = this.estimateResourceCost(operation, 'destination');

    // Reserve capacity
    sourcePool.availableCapacity -= sourceCost;
    sourcePool.reservedCapacity += sourceCost;
    sourcePool.activeOperations.set(operation.id, operation);

    destPool.availableCapacity -= destCost;
    destPool.reservedCapacity += destCost;
    destPool.activeOperations.set(operation.id, operation);

    // Update global counter
    this.globalOperationCount++;
  }

  /**
   * Free resources after operation completion
   */
  private freeResources(operation: CrossChainOperation, pool: ResourcePool): void {
    const cost = this.estimateResourceCost(operation, 'source');
    
    pool.reservedCapacity -= cost;
    pool.availableCapacity += cost;
    pool.activeOperations.delete(operation.id);
    
    this.globalOperationCount--;
  }

  /**
   * Initialize resource pool for a chain
   */
  private initializeResourcePool(chainConfig: ChainConfig): void {
    const pool: ResourcePool = {
      chainId: chainConfig.chainId,
      totalCapacity: chainConfig.maxConcurrentOps * 100, // Arbitrary capacity units
      availableCapacity: chainConfig.maxConcurrentOps * 100,
      reservedCapacity: 0,
      activeOperations: new Map(),
      queuedOperations: [],
      lastRebalance: Date.now(),
      utilizationRate: 0
    };

    this.resourcePools.set(chainConfig.chainId, pool);
  }

  /**
   * Initialize circuit breaker for a chain
   */
  private initializeCircuitBreaker(chainConfig: ChainConfig): void {
    const breaker: CircuitBreaker = {
      chainId: chainConfig.chainId,
      isOpen: false,
      failureCount: 0,
      successCount: 0,
      lastFailure: 0,
      lastSuccess: 0,
      openedAt: 0,
      failureThreshold: 10,
      recoveryTime: 60000, // 1 minute
      halfOpenMaxRequests: 3,
      currentHalfOpenRequests: 0
    };

    this.circuitBreakers.set(chainConfig.chainId, breaker);
  }

  /**
   * Helper methods
   */
  private generateOperationId(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .substring(0, 16);
  }

  private estimateOperationDuration(operation: Partial<CrossChainOperation>): number {
    const sourceChain = this.chainConfigs.get(operation.sourceChain!);
    const destChain = this.chainConfigs.get(operation.destinationChain!);
    
    if (!sourceChain || !destChain) return 300000; // 5 minutes default
    
    // Estimate based on block times and confirmations
    const sourceTime = sourceChain.avgBlockTime * sourceChain.confirmationsRequired * 1000;
    const destTime = destChain.avgBlockTime * destChain.confirmationsRequired * 1000;
    
    return sourceTime + destTime + 60000; // Add 1 minute processing time
  }

  private getUserLimits(userId: string): UserLimits {
    let userLimits = this.userLimits.get(userId);
    
    if (!userLimits) {
      userLimits = {
        userId,
        crossChainOperations: {
          operations: [],
          totalValue: BigInt(0),
          windowStart: Date.now()
        },
        chainOperations: {},
        economicLimits: {
          totalSpent: BigInt(0),
          windowStart: Date.now(),
          dailySpent: BigInt(0),
          dailyStart: Date.now()
        }
      };
      
      this.userLimits.set(userId, userLimits);
    }
    
    return userLimits;
  }

  private recordUserOperation(operation: CrossChainOperation): void {
    const userLimits = this.getUserLimits(operation.userId);
    const now = Date.now();
    
    // Record cross-chain operation
    userLimits.crossChainOperations.operations.push(operation);
    userLimits.crossChainOperations.totalValue += BigInt(operation.value);
    
    // Record chain-specific operation
    if (!userLimits.chainOperations[operation.sourceChain]) {
      userLimits.chainOperations[operation.sourceChain] = {
        operations: [],
        lastOperation: 0,
        cooldownUntil: 0,
        violations: 0
      };
    }
    
    const chainOps = userLimits.chainOperations[operation.sourceChain];
    chainOps.operations.push(now);
    chainOps.lastOperation = now;
    
    // Update economic limits
    userLimits.economicLimits.totalSpent += BigInt(operation.value);
    userLimits.economicLimits.dailySpent += BigInt(operation.value);
  }

  private updateUserOperationCompletion(operation: CrossChainOperation, success: boolean): void {
    if (!success) {
      const userLimits = this.getUserLimits(operation.userId);
      const chainOps = userLimits.chainOperations[operation.sourceChain];
      
      if (chainOps) {
        chainOps.violations++;
        // Apply cooldown for failed operations
        const cooldownMs = Math.min(chainOps.violations * 30000, 300000); // Max 5 minutes
        chainOps.cooldownUntil = Date.now() + cooldownMs;
      }
    }
  }

  private estimateResourceCost(operation: CrossChainOperation, type: 'source' | 'destination'): number {
    // Simplified resource cost calculation
    const baseValue = parseFloat(operation.value) / 1e18; // Convert to ETH/BTC equivalent
    const baseCost = Math.max(baseValue * 10, 10); // Minimum 10 units
    
    // Higher cost for complex operations
    const operationMultiplier = {
      'escrow_create': 1.0,
      'escrow_redeem': 1.5,
      'escrow_refund': 1.2,
      'swap_initiate': 2.0,
      'swap_complete': 1.8
    }[operation.type] || 1.0;
    
    return Math.floor(baseCost * operationMultiplier);
  }

  private estimateResourceAvailabilityDelay(pool: ResourcePool, requiredCapacity: number): number {
    // Estimate when enough capacity will be available
    const avgOperationTime = this.calculateAverageProcessingTime(pool.chainId);
    const activeOps = pool.activeOperations.size;
    
    if (activeOps === 0) return 0;
    
    // Rough estimate based on current utilization
    return Math.floor((requiredCapacity / pool.totalCapacity) * avgOperationTime * activeOps);
  }

  private calculateAverageProcessingTime(chainId: string): number {
    // This would typically analyze historical data
    // For now, use chain-specific estimates
    const chainConfig = this.chainConfigs.get(chainId);
    if (!chainConfig) return 300000; // 5 minutes default
    
    return chainConfig.avgBlockTime * chainConfig.confirmationsRequired * 1000 + 60000;
  }

  private findQueueInsertionPoint(queue: CrossChainOperation[], operation: CrossChainOperation): number {
    // Insert based on priority (higher priority first)
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].priority < operation.priority) {
        return i;
      }
    }
    return queue.length;
  }

  private checkOperationDependencies(operation: CrossChainOperation): { allowed: boolean } {
    // Check if all dependencies are resolved
    for (const depId of operation.dependencies) {
      if (this.operationDependencies.has(depId)) {
        return { allowed: false };
      }
    }
    
    // Add this operation to dependency tracking
    this.operationDependencies.set(operation.id, new Set());
    
    return { allowed: true };
  }

  private resolveOperationDependencies(operationId: string): void {
    this.operationDependencies.delete(operationId);
  }

  private recordCircuitBreakerSuccess(breaker: CircuitBreaker): void {
    breaker.successCount++;
    breaker.lastSuccess = Date.now();
    
    if (breaker.isOpen && breaker.currentHalfOpenRequests > 0) {
      // Successful request in half-open state
      if (breaker.successCount >= 3) {
        breaker.isOpen = false;
        breaker.failureCount = 0;
        breaker.currentHalfOpenRequests = 0;
        this.emit('circuitBreakerClosed', { chainId: breaker.chainId });
      }
    }
  }

  private recordCircuitBreakerFailure(breaker: CircuitBreaker): void {
    breaker.failureCount++;
    breaker.lastFailure = Date.now();
    
    if (!breaker.isOpen && breaker.failureCount >= breaker.failureThreshold) {
      breaker.isOpen = true;
      breaker.openedAt = Date.now();
      breaker.currentHalfOpenRequests = 0;
      this.stats.circuitBreakerTrips++;
      this.emit('circuitBreakerOpened', { 
        chainId: breaker.chainId, 
        failureCount: breaker.failureCount 
      });
    }
  }

  /**
   * Background tasks
   */
  private startRebalancingTask(): void {
    setInterval(() => {
      this.rebalanceResourcePools();
    }, 60000); // Every minute
  }

  private startQueueProcessor(): void {
    setInterval(() => {
      this.processQueues();
    }, 5000); // Every 5 seconds
  }

  private startCleanupTasks(): void {
    setInterval(() => {
      this.cleanupExpiredData();
    }, 300000); // Every 5 minutes
  }

  private rebalanceResourcePools(): void {
    for (const pool of this.resourcePools.values()) {
      // Calculate utilization rate
      pool.utilizationRate = pool.reservedCapacity / pool.totalCapacity;
      
      // Adjust capacity based on demand (simplified)
      if (pool.utilizationRate > 0.8 && pool.queuedOperations.length > 5) {
        // Could increase capacity or adjust limits
        this.emit('poolHighUtilization', { 
          chainId: pool.chainId, 
          utilization: pool.utilizationRate 
        });
      }
      
      pool.lastRebalance = Date.now();
    }
  }

  private async processQueues(): Promise<void> {
    for (const pool of this.resourcePools.values()) {
      while (pool.queuedOperations.length > 0) {
        const operation = pool.queuedOperations[0];
        
        // Check if operation can now be processed
        const resourceCheck = await this.checkResourceAvailability(operation);
        if (!resourceCheck.allowed) {
          break; // Wait for more resources
        }
        
        // Remove from queue and approve
        pool.queuedOperations.shift();
        this.stats.queuedOperations--;
        
        try {
          await this.reserveResources(operation);
          this.recordUserOperation(operation);
          
          this.emit('operationApproved', operation);
          this.emit('operationDequeuedAndApproved', operation);
          
        } catch (error) {
          console.error('Error processing queued operation:', error);
          this.stats.failedOperations++;
        }
      }
    }
  }

  private cleanupExpiredData(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up user limits
    for (const [userId, userLimits] of this.userLimits.entries()) {
      // Clean old cross-chain operations
      userLimits.crossChainOperations.operations = 
        userLimits.crossChainOperations.operations.filter(op => 
          now - op.createdAt < this.crossChainLimits.crossChainWindowMs
        );
      
      // Clean chain operations
      for (const chainOps of Object.values(userLimits.chainOperations)) {
        chainOps.operations = chainOps.operations.filter(time => 
          now - time < maxAge
        );
      }
      
      // Remove empty user limits
      const hasRecentActivity = 
        userLimits.crossChainOperations.operations.length > 0 ||
        Object.values(userLimits.chainOperations).some(ops => ops.operations.length > 0);
      
      if (!hasRecentActivity && now - userLimits.economicLimits.windowStart > maxAge) {
        this.userLimits.delete(userId);
      }
    }
  }

  /**
   * Public API methods
   */
  getStats(): any {
    return {
      ...this.stats,
      globalOperationCount: this.globalOperationCount,
      chainStats: Array.from(this.resourcePools.entries()).map(([chainId, pool]) => ({
        chainId,
        utilizationRate: pool.utilizationRate,
        activeOperations: pool.activeOperations.size,
        queuedOperations: pool.queuedOperations.length,
        availableCapacity: pool.availableCapacity,
        totalCapacity: pool.totalCapacity
      })),
      circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([chainId, breaker]) => ({
        chainId,
        isOpen: breaker.isOpen,
        failureCount: breaker.failureCount,
        successCount: breaker.successCount
      })),
      trackedUsers: this.userLimits.size
    };
  }

  getUserOperationHistory(userId: string): any {
    const userLimits = this.userLimits.get(userId);
    if (!userLimits) {
      return { operations: [], chains: {}, economic: null };
    }

    return {
      operations: userLimits.crossChainOperations.operations.map(op => ({
        id: op.id,
        type: op.type,
        sourceChain: op.sourceChain,
        destinationChain: op.destinationChain,
        value: op.value,
        createdAt: op.createdAt
      })),
      chains: userLimits.chainOperations,
      economic: {
        totalSpent: userLimits.economicLimits.totalSpent.toString(),
        dailySpent: userLimits.economicLimits.dailySpent.toString()
      }
    };
  }

  async pauseChain(chainId: string, reason: string): Promise<void> {
    const breaker = this.circuitBreakers.get(chainId);
    if (breaker) {
      breaker.isOpen = true;
      breaker.openedAt = Date.now();
      this.emit('chainPaused', { chainId, reason });
    }
  }

  async resumeChain(chainId: string): Promise<void> {
    const breaker = this.circuitBreakers.get(chainId);
    if (breaker) {
      breaker.isOpen = false;
      breaker.failureCount = 0;
      breaker.currentHalfOpenRequests = 0;
      this.emit('chainResumed', { chainId });
    }
  }
}

export default CrossChainRateLimitService;