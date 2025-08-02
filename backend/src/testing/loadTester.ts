import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * Rate Limiting Load Testing and Validation Tool
 * 
 * Comprehensive testing suite for validating rate limiting effectiveness:
 * - Load testing with configurable patterns
 * - DOS attack simulation
 * - Rate limit breach detection
 * - Performance benchmarking
 * - Cross-chain coordination testing
 * - Circuit breaker validation
 * - Concurrency and stress testing
 */

export interface LoadTestConfig {
  name: string;
  description: string;
  duration: number; // ms
  concurrency: number;
  requestsPerSecond: number;
  endpoints: string[];
  userTiers: ('free' | 'basic' | 'premium' | 'enterprise')[];
  patterns: {
    type: 'constant' | 'ramp_up' | 'spike' | 'burst' | 'random';
    parameters?: Record<string, any>;
  };
  validation: {
    expectBlocked: boolean;
    maxResponseTime: number;
    minSuccessRate: number;
  };
}

export interface TestResult {
  testId: string;
  config: LoadTestConfig;
  startTime: number;
  endTime: number;
  duration: number;
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    blockedRequests: number;
    errorRequests: number;
    timeoutRequests: number;
    avgResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    throughput: number;
    blockRate: number;
    successRate: number;
  };
  rateLimitingEffectiveness: {
    rateLimitsTriggered: number;
    circuitBreakersTriggered: number;
    dosProtectionActivated: boolean;
    crossChainCoordinationWorking: boolean;
  };
  performanceBreakdown: {
    byEndpoint: Record<string, any>;
    byTier: Record<string, any>;
    byTimeSlice: Array<{ timestamp: number; metrics: any }>;
  };
  validation: {
    passed: boolean;
    failures: string[];
    warnings: string[];
  };
  rawData: {
    requestLogs: any[];
    responseTimes: number[];
    errorTypes: Record<string, number>;
  };
}

export interface DOSTestScenario {
  name: string;
  description: string;
  attackVector: 'high_frequency' | 'slow_loris' | 'connection_flood' | 'large_payloads' | 'mixed';
  intensity: 'low' | 'medium' | 'high' | 'critical';
  duration: number;
  sources: {
    singleIP: boolean;
    multipleIPs: boolean;
    botnet: boolean;
    ipCount?: number;
  };
  expectedDefense: {
    rateLimitTriggered: boolean;
    ipBlocked: boolean;
    circuitBreakerActivated: boolean;
    alertsGenerated: boolean;
  };
}

export class RateLimitLoadTester extends EventEmitter {
  private activeTests: Map<string, any> = new Map();
  private testResults: Map<string, TestResult> = new Map();
  private isRunning = false;
  
  // Test configuration
  private config = {
    baseUrl: process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000',
    adminUrl: process.env.ADMIN_BASE_URL || 'http://localhost:8081',
    timeout: 30000, // 30 seconds
    retries: 3,
    collectMetrics: true,
    saveResults: true,
    resultsPath: './test-results'
  };

  constructor() {
    super();
    console.log('🧪 Rate Limit Load Tester initialized');
  }

  /**
   * Run a comprehensive load test
   */
  async runLoadTest(config: LoadTestConfig): Promise<TestResult> {
    const testId = this.generateTestId();
    
    console.log(`🚀 Starting load test: ${config.name} (${testId})`);
    console.log(`   Duration: ${config.duration / 1000}s`);
    console.log(`   Concurrency: ${config.concurrency}`);
    console.log(`   RPS: ${config.requestsPerSecond}`);
    console.log(`   Endpoints: ${config.endpoints.join(', ')}`);
    
    const startTime = Date.now();
    
    const testResult: TestResult = {
      testId,
      config,
      startTime,
      endTime: 0,
      duration: 0,
      metrics: {
        totalRequests: 0,
        successfulRequests: 0,
        blockedRequests: 0,
        errorRequests: 0,
        timeoutRequests: 0,
        avgResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity,
        throughput: 0,
        blockRate: 0,
        successRate: 0
      },
      rateLimitingEffectiveness: {
        rateLimitsTriggered: 0,
        circuitBreakersTriggered: 0,
        dosProtectionActivated: false,
        crossChainCoordinationWorking: false
      },
      performanceBreakdown: {
        byEndpoint: {},
        byTier: {},
        byTimeSlice: []
      },
      validation: {
        passed: false,
        failures: [],
        warnings: []
      },
      rawData: {
        requestLogs: [],
        responseTimes: [],
        errorTypes: {}
      }
    };
    
    this.activeTests.set(testId, testResult);
    this.emit('testStarted', { testId, config });
    
    try {
      // Execute the load test based on pattern
      await this.executeLoadTestPattern(testResult);
      
      // Calculate final metrics
      this.calculateFinalMetrics(testResult);
      
      // Validate results
      this.validateTestResults(testResult);
      
      testResult.endTime = Date.now();
      testResult.duration = testResult.endTime - testResult.startTime;
      
      this.testResults.set(testId, testResult);
      
      console.log(`✅ Load test completed: ${config.name}`);
      console.log(`   Success Rate: ${testResult.metrics.successRate.toFixed(2)}%`);
      console.log(`   Block Rate: ${testResult.metrics.blockRate.toFixed(2)}%`);
      console.log(`   Avg Response Time: ${testResult.metrics.avgResponseTime.toFixed(2)}ms`);
      console.log(`   Validation: ${testResult.validation.passed ? 'PASSED' : 'FAILED'}`);
      
      this.emit('testCompleted', testResult);
      
      return testResult;
      
    } catch (error) {
      console.error(`❌ Load test failed: ${config.name}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      testResult.validation.failures.push(`Test execution failed: ${errorMessage}`);
      testResult.endTime = Date.now();
      testResult.duration = testResult.endTime - testResult.startTime;
      
      this.emit('testFailed', { testId, error });
      throw error;
      
    } finally {
      this.activeTests.delete(testId);
    }
  }

  /**
   * Run DOS attack simulation
   */
  async runDOSTest(scenario: DOSTestScenario): Promise<TestResult> {
    console.log(`🎯 Starting DOS test: ${scenario.name}`);
    console.log(`   Attack Vector: ${scenario.attackVector}`);
    console.log(`   Intensity: ${scenario.intensity}`);
    console.log(`   Duration: ${scenario.duration / 1000}s`);
    
    const config = this.createDOSTestConfig(scenario);
    const result = await this.runLoadTest(config);
    
    // Validate DOS-specific expectations
    this.validateDOSTestResult(result, scenario);
    
    return result;
  }

  /**
   * Run benchmark suite
   */
  async runBenchmarkSuite(): Promise<{
    summary: any;
    results: TestResult[];
  }> {
    console.log('📊 Starting comprehensive benchmark suite...');
    
    const benchmarkTests: LoadTestConfig[] = [
      {
        name: 'Baseline Performance',
        description: 'Normal load without rate limiting stress',
        duration: 60000, // 1 minute
        concurrency: 10,
        requestsPerSecond: 50,
        endpoints: ['/api/swap/quote', '/api/swap/execute', '/api/user/balance'],
        userTiers: ['basic'],
        patterns: { type: 'constant' as const },
        validation: {
          expectBlocked: false,
          maxResponseTime: 1000,
          minSuccessRate: 95
        }
      },
      {
        name: 'Rate Limit Stress Test',
        description: 'High load to trigger rate limiting',
        duration: 120000, // 2 minutes
        concurrency: 50,
        requestsPerSecond: 200,
        endpoints: ['/api/swap/quote'],
        userTiers: ['free', 'basic'],
        patterns: { type: 'constant' as const },
        validation: {
          expectBlocked: true,
          maxResponseTime: 2000,
          minSuccessRate: 70
        }
      },
      {
        name: 'Spike Load Test',
        description: 'Traffic spikes to test circuit breakers',
        duration: 180000, // 3 minutes
        concurrency: 100,
        requestsPerSecond: 500,
        endpoints: ['/api/swap/execute'],
        userTiers: ['premium', 'enterprise'],
        patterns: {
          type: 'spike' as const,
          parameters: { spikeMultiplier: 10, spikeDuration: 30000 }
        },
        validation: {
          expectBlocked: true,
          maxResponseTime: 5000,
          minSuccessRate: 60
        }
      },
      {
        name: 'Cross-Chain Coordination Test',
        description: 'Test cross-chain rate limiting coordination',
        duration: 240000, // 4 minutes
        concurrency: 25,
        requestsPerSecond: 100,
        endpoints: ['/api/swap/cross-chain'],
        userTiers: ['basic', 'premium'],
        patterns: { type: 'burst' as const },
        validation: {
          expectBlocked: true,
          maxResponseTime: 10000,
          minSuccessRate: 80
        }
      }
    ];
    
    const results: TestResult[] = [];
    
    for (const testConfig of benchmarkTests) {
      console.log(`\n🔬 Running: ${testConfig.name}`);
      
      try {
        const result = await this.runLoadTest(testConfig);
        results.push(result);
        
        // Wait between tests to allow system recovery
        console.log('⏳ Waiting for system recovery...');
        await this.wait(30000); // 30 seconds
        
      } catch (error) {
        console.error(`❌ Benchmark test failed: ${testConfig.name}`, error);
      }
    }
    
    const summary = this.generateBenchmarkSummary(results);
    
    console.log('\n📊 Benchmark Suite Summary:');
    console.log(`   Tests Run: ${results.length}`);
    console.log(`   Tests Passed: ${summary.passed}`);
    console.log(`   Tests Failed: ${summary.failed}`);
    console.log(`   Overall Success Rate: ${summary.overallSuccessRate.toFixed(2)}%`);
    console.log(`   Average Response Time: ${summary.avgResponseTime.toFixed(2)}ms`);
    
    return { summary, results };
  }

  /**
   * Execute load test pattern
   */
  private async executeLoadTestPattern(testResult: TestResult): Promise<void> {
    const { config } = testResult;
    const { patterns, duration, concurrency, requestsPerSecond } = config;
    
    const workers: Promise<void>[] = [];
    const requestQueue: Array<{ endpoint: string; tier: string; timestamp: number }> = [];
    
    // Generate request schedule based on pattern
    const schedule = this.generateRequestSchedule(config);
    
    // Create worker pool
    for (let i = 0; i < concurrency; i++) {
      workers.push(this.createWorker(i, schedule, testResult));
    }
    
    // Start metrics collection
    const metricsInterval = setInterval(() => {
      this.collectMetrics(testResult);
    }, 1000); // Every second
    
    try {
      // Wait for all workers to complete
      await Promise.all(workers);
    } finally {
      clearInterval(metricsInterval);
    }
  }

  /**
   * Create worker for concurrent request execution
   */
  private async createWorker(
    workerId: number, 
    schedule: Array<{ timestamp: number; endpoint: string; tier: string }>,
    testResult: TestResult
  ): Promise<void> {
    const workerSchedule = schedule.filter((_, index) => index % testResult.config.concurrency === workerId);
    
    for (const request of workerSchedule) {
      const delay = request.timestamp - Date.now();
      if (delay > 0) {
        await this.wait(delay);
      }
      
      try {
        const result = await this.executeRequest(request.endpoint, request.tier);
        this.recordRequestResult(testResult, result);
      } catch (error) {
        this.recordRequestError(testResult, error);
      }
    }
  }

  /**
   * Execute individual HTTP request
   */
  private async executeRequest(endpoint: string, tier: string): Promise<any> {
    const startTime = Date.now();
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `LoadTester/1.0`,
        'X-User-Tier': tier,
        'X-Test-Request': 'true'
      },
      body: JSON.stringify({
        test: true,
        timestamp: startTime,
        tier
      })
    };
    
    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, options);
      const responseTime = Date.now() - startTime;
      
      const result = {
        endpoint,
        tier,
        status: response.status,
        responseTime,
        blocked: response.status === 429,
        success: response.status >= 200 && response.status < 300,
        headers: this.convertHeadersToObject(response.headers),
        body: response.status !== 204 ? await response.text() : null,
        timestamp: startTime
      };
      
      return result;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        endpoint,
        tier,
        status: 0,
        responseTime,
        blocked: false,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: startTime
      };
    }
  }

  /**
   * Generate request schedule based on pattern
   */
  private generateRequestSchedule(config: LoadTestConfig): Array<{ timestamp: number; endpoint: string; tier: string }> {
    const { duration, requestsPerSecond, endpoints, userTiers, patterns } = config;
    const schedule: Array<{ timestamp: number; endpoint: string; tier: string }> = [];
    
    const startTime = Date.now();
    const totalRequests = Math.floor((duration / 1000) * requestsPerSecond);
    
    for (let i = 0; i < totalRequests; i++) {
      let timestamp: number;
      
      switch (patterns.type) {
        case 'constant':
          timestamp = startTime + (i * 1000 / requestsPerSecond);
          break;
          
        case 'ramp_up':
          const rampFactor = (i / totalRequests) * 2; // 0 to 2x
          timestamp = startTime + (i * 1000 / (requestsPerSecond * Math.max(rampFactor, 0.1)));
          break;
          
        case 'spike':
          const spikeDuration = patterns.parameters?.spikeDuration || 30000;
          const spikeMultiplier = patterns.parameters?.spikeMultiplier || 5;
          const spikeStartTime = startTime + (duration * 0.3); // Spike at 30% through test
          const baseTimestamp = startTime + (i * 1000 / requestsPerSecond);
          
          if (baseTimestamp >= spikeStartTime && baseTimestamp <= spikeStartTime + spikeDuration) {
            timestamp = startTime + (i * 1000 / (requestsPerSecond * spikeMultiplier));
          } else {
            timestamp = baseTimestamp;
          }
          break;
          
        case 'burst':
          const burstSize = patterns.parameters?.burstSize || 10;
          const burstInterval = patterns.parameters?.burstInterval || 5000;
          const burstIndex = Math.floor(i / burstSize);
          const withinBurst = i % burstSize;
          
          timestamp = startTime + (burstIndex * burstInterval) + (withinBurst * 100); // 100ms between burst requests
          break;
          
        case 'random':
          timestamp = startTime + Math.random() * duration;
          break;
          
        default:
          timestamp = startTime + (i * 1000 / requestsPerSecond);
      }
      
      schedule.push({
        timestamp: Math.floor(timestamp),
        endpoint: endpoints[Math.floor(Math.random() * endpoints.length)],
        tier: userTiers[Math.floor(Math.random() * userTiers.length)]
      });
    }
    
    return schedule.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Record successful request result
   */
  private recordRequestResult(testResult: TestResult, result: any): void {
    testResult.metrics.totalRequests++;
    
    if (result.success) {
      testResult.metrics.successfulRequests++;
    } else if (result.blocked) {
      testResult.metrics.blockedRequests++;
    } else {
      testResult.metrics.errorRequests++;
    }
    
    // Update response time metrics
    testResult.rawData.responseTimes.push(result.responseTime);
    testResult.metrics.maxResponseTime = Math.max(testResult.metrics.maxResponseTime, result.responseTime);
    testResult.metrics.minResponseTime = Math.min(testResult.metrics.minResponseTime, result.responseTime);
    
    // Record raw data
    testResult.rawData.requestLogs.push(result);
    
    // Update endpoint breakdown
    if (!testResult.performanceBreakdown.byEndpoint[result.endpoint]) {
      testResult.performanceBreakdown.byEndpoint[result.endpoint] = {
        requests: 0,
        successful: 0,
        blocked: 0,
        errors: 0,
        avgResponseTime: 0,
        responseTimes: []
      };
    }
    
    const endpointData = testResult.performanceBreakdown.byEndpoint[result.endpoint];
    endpointData.requests++;
    endpointData.responseTimes.push(result.responseTime);
    
    if (result.success) endpointData.successful++;
    else if (result.blocked) endpointData.blocked++;
    else endpointData.errors++;
    
    // Update tier breakdown
    if (!testResult.performanceBreakdown.byTier[result.tier]) {
      testResult.performanceBreakdown.byTier[result.tier] = {
        requests: 0,
        successful: 0,
        blocked: 0,
        errors: 0,
        avgResponseTime: 0,
        responseTimes: []
      };
    }
    
    const tierData = testResult.performanceBreakdown.byTier[result.tier];
    tierData.requests++;
    tierData.responseTimes.push(result.responseTime);
    
    if (result.success) tierData.successful++;
    else if (result.blocked) tierData.blocked++;
    else tierData.errors++;
  }

  /**
   * Record request error
   */
  private recordRequestError(testResult: TestResult, error: any): void {
    testResult.metrics.totalRequests++;
    testResult.metrics.errorRequests++;
    
    const errorType = error.code || error.name || 'Unknown';
    testResult.rawData.errorTypes[errorType] = (testResult.rawData.errorTypes[errorType] || 0) + 1;
    
    testResult.rawData.requestLogs.push({
      error: error.message,
      timestamp: Date.now(),
      success: false,
      blocked: false
    });
  }

  /**
   * Collect real-time metrics
   */
  private collectMetrics(testResult: TestResult): void {
    const timeSliceMetrics = {
      timestamp: Date.now(),
      metrics: {
        totalRequests: testResult.metrics.totalRequests,
        successfulRequests: testResult.metrics.successfulRequests,
        blockedRequests: testResult.metrics.blockedRequests,
        errorRequests: testResult.metrics.errorRequests,
        currentRPS: this.calculateCurrentRPS(testResult),
        avgResponseTime: this.calculateAvgResponseTime(testResult.rawData.responseTimes)
      }
    };
    
    testResult.performanceBreakdown.byTimeSlice.push(timeSliceMetrics);
    
    // Emit progress update
    this.emit('testProgress', {
      testId: testResult.testId,
      progress: this.calculateTestProgress(testResult),
      metrics: timeSliceMetrics.metrics
    });
  }

  /**
   * Calculate final metrics
   */
  private calculateFinalMetrics(testResult: TestResult): void {
    const { metrics } = testResult;
    
    // Calculate rates
    metrics.successRate = metrics.totalRequests > 0 ? 
      (metrics.successfulRequests / metrics.totalRequests) * 100 : 0;
    
    metrics.blockRate = metrics.totalRequests > 0 ? 
      (metrics.blockedRequests / metrics.totalRequests) * 100 : 0;
    
    // Calculate average response time
    metrics.avgResponseTime = this.calculateAvgResponseTime(testResult.rawData.responseTimes);
    
    // Calculate throughput
    const durationSeconds = testResult.duration / 1000;
    metrics.throughput = durationSeconds > 0 ? metrics.totalRequests / durationSeconds : 0;
    
    // Calculate endpoint breakdowns
    for (const endpointData of Object.values(testResult.performanceBreakdown.byEndpoint)) {
      (endpointData as any).avgResponseTime = this.calculateAvgResponseTime((endpointData as any).responseTimes);
    }
    
    // Calculate tier breakdowns
    for (const tierData of Object.values(testResult.performanceBreakdown.byTier)) {
      (tierData as any).avgResponseTime = this.calculateAvgResponseTime((tierData as any).responseTimes);
    }
    
    // Analyze rate limiting effectiveness
    this.analyzeRateLimitingEffectiveness(testResult);
  }

  /**
   * Validate test results against expectations
   */
  private validateTestResults(testResult: TestResult): void {
    const { config, metrics } = testResult;
    const { validation } = config;
    const failures: string[] = [];
    const warnings: string[] = [];
    
    // Check success rate
    if (metrics.successRate < validation.minSuccessRate) {
      failures.push(`Success rate ${metrics.successRate.toFixed(2)}% is below minimum ${validation.minSuccessRate}%`);
    }
    
    // Check response time
    if (metrics.avgResponseTime > validation.maxResponseTime) {
      failures.push(`Average response time ${metrics.avgResponseTime.toFixed(2)}ms exceeds maximum ${validation.maxResponseTime}ms`);
    }
    
    // Check blocking expectation
    if (validation.expectBlocked && metrics.blockRate < 5) {
      warnings.push(`Expected significant blocking but only ${metrics.blockRate.toFixed(2)}% of requests were blocked`);
    } else if (!validation.expectBlocked && metrics.blockRate > 10) {
      warnings.push(`Unexpected blocking: ${metrics.blockRate.toFixed(2)}% of requests were blocked`);
    }
    
    testResult.validation = {
      passed: failures.length === 0,
      failures,
      warnings
    };
  }

  /**
   * Create DOS test configuration from scenario
   */
  private createDOSTestConfig(scenario: DOSTestScenario): LoadTestConfig {
    const intensityMap = {
      low: { concurrency: 20, rps: 100 },
      medium: { concurrency: 50, rps: 300 },
      high: { concurrency: 100, rps: 1000 },
      critical: { concurrency: 200, rps: 2000 }
    };
    
    const intensity = intensityMap[scenario.intensity];
    
    return {
      name: scenario.name,
      description: scenario.description,
      duration: scenario.duration,
      concurrency: intensity.concurrency,
      requestsPerSecond: intensity.rps,
      endpoints: ['/api/swap/quote', '/api/swap/execute'],
      userTiers: ['free', 'basic'],
      patterns: {
        type: scenario.attackVector === 'slow_loris' ? 'constant' : 'burst'
      },
      validation: {
        expectBlocked: true,
        maxResponseTime: 10000,
        minSuccessRate: 20 // Expect high failure rate during DOS
      }
    };
  }

  /**
   * Helper methods
   */
  private generateTestId(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .substring(0, 12);
  }
  
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private calculateAvgResponseTime(responseTimes: number[]): number {
    return responseTimes.length > 0 ? 
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;
  }
  
  private calculateCurrentRPS(testResult: TestResult): number {
    const recentRequests = testResult.rawData.requestLogs.filter(
      log => Date.now() - log.timestamp < 1000
    );
    return recentRequests.length;
  }
  
  private calculateTestProgress(testResult: TestResult): number {
    const elapsed = Date.now() - testResult.startTime;
    return Math.min((elapsed / testResult.config.duration) * 100, 100);
  }
  
  private analyzeRateLimitingEffectiveness(testResult: TestResult): void {
    // Analyze logs for rate limiting patterns
    const rateLimitHeaders = testResult.rawData.requestLogs.filter(
      log => log.headers && (log.headers['x-ratelimit-remaining'] || log.headers['x-ratelimit-reset'])
    );
    
    testResult.rateLimitingEffectiveness.rateLimitsTriggered = rateLimitHeaders.length;
    
    // Check for circuit breaker responses
    const circuitBreakerResponses = testResult.rawData.requestLogs.filter(
      log => log.status === 503 || (log.headers && log.headers['x-circuit-breaker'] === 'open')
    );
    
    testResult.rateLimitingEffectiveness.circuitBreakersTriggered = circuitBreakerResponses.length;
    
    // Detect DOS protection activation
    testResult.rateLimitingEffectiveness.dosProtectionActivated = 
      testResult.metrics.blockRate > 50; // More than 50% blocked indicates DOS protection
    
    // Check cross-chain coordination (simplified)
    const crossChainRequests = testResult.rawData.requestLogs.filter(
      log => log.endpoint && log.endpoint.includes('cross-chain')
    );
    
    testResult.rateLimitingEffectiveness.crossChainCoordinationWorking = 
      crossChainRequests.length > 0 && crossChainRequests.some(req => req.blocked);
  }
  
  private validateDOSTestResult(result: TestResult, scenario: DOSTestScenario): void {
    const expectations = scenario.expectedDefense;
    
    // Check if expected defenses were activated
    if (expectations.rateLimitTriggered && result.rateLimitingEffectiveness.rateLimitsTriggered === 0) {
      result.validation.failures.push('Expected rate limiting to be triggered but none detected');
    }
    
    if (expectations.circuitBreakerActivated && result.rateLimitingEffectiveness.circuitBreakersTriggered === 0) {
      result.validation.failures.push('Expected circuit breaker activation but none detected');
    }
    
    if (expectations.alertsGenerated) {
      // Would check monitoring system for generated alerts
      result.validation.warnings.push('Alert generation validation not implemented');
    }
  }
  
  private generateBenchmarkSummary(results: TestResult[]): any {
    const passed = results.filter(r => r.validation.passed).length;
    const failed = results.length - passed;
    
    const overallSuccessRate = results.length > 0 ? 
      results.reduce((sum, r) => sum + r.metrics.successRate, 0) / results.length : 0;
    
    const avgResponseTime = results.length > 0 ?
      results.reduce((sum, r) => sum + r.metrics.avgResponseTime, 0) / results.length : 0;
    
    return {
      totalTests: results.length,
      passed,
      failed,
      overallSuccessRate,
      avgResponseTime,
      totalRequests: results.reduce((sum, r) => sum + r.metrics.totalRequests, 0),
      totalBlocked: results.reduce((sum, r) => sum + r.metrics.blockedRequests, 0)
    };
  }

  /**
   * Get test results
   */
  getTestResult(testId: string): TestResult | undefined {
    return this.testResults.get(testId);
  }
  
  getAllTestResults(): TestResult[] {
    return Array.from(this.testResults.values());
  }
  
  getActiveTests(): string[] {
    return Array.from(this.activeTests.keys());
  }

  /**
   * Helper method to convert Headers to object
   */
  private convertHeadersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
}

// Export singleton instance
export const loadTester = new RateLimitLoadTester();

export default loadTester;