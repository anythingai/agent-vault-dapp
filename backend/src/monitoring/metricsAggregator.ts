import { EventEmitter } from 'events';
import { rateLimitMonitor, MetricData } from './rateLimitMonitor';

/**
 * Metrics Aggregation Service
 * 
 * Collects metrics from all rate limiting components:
 * - Smart contract events and gas usage
 * - Backend service performance and rate limiting
 * - API endpoint metrics and violations
 * - Frontend protection metrics
 * - Infrastructure-level metrics from Nginx
 * - Cross-chain operation coordination
 * 
 * Aggregates and forwards metrics to the monitoring system
 */

export interface MetricSource {
  name: string;
  enabled: boolean;
  interval: number; // Collection interval in ms
  lastCollection: number;
  config: Record<string, any>;
}

export interface AggregatedMetric {
  timestamp: number;
  source: string;
  type: string;
  value: number;
  tags: Record<string, string>;
  aggregation?: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  };
}

export interface MetricsConfig {
  enabled: boolean;
  collectionInterval: number; // Default collection interval
  batchSize: number; // Number of metrics to batch before sending
  retryAttempts: number;
  sources: Record<string, MetricSource>;
}

export class MetricsAggregator extends EventEmitter {
  private config: MetricsConfig;
  private collectors: Map<string, NodeJS.Timeout> = new Map();
  private metricsBatch: MetricData[] = [];
  private isRunning = false;

  constructor(config: Partial<MetricsConfig> = {}) {
    super();
    
    this.config = {
      enabled: true,
      collectionInterval: 10000, // 10 seconds
      batchSize: 50,
      retryAttempts: 3,
      sources: {
        contract: {
          name: 'Smart Contract',
          enabled: true,
          interval: 30000, // 30 seconds
          lastCollection: 0,
          config: {
            web3Provider: process.env.WEB3_PROVIDER_URL,
            contractAddress: process.env.ESCROW_CONTRACT_ADDRESS
          }
        },
        relayer: {
          name: 'Relayer Service',
          enabled: true,
          interval: 5000, // 5 seconds
          lastCollection: 0,
          config: {}
        },
        resolver: {
          name: 'Resolver Service',
          enabled: true,
          interval: 5000, // 5 seconds
          lastCollection: 0,
          config: {}
        },
        api: {
          name: 'API Endpoints',
          enabled: true,
          interval: 5000, // 5 seconds
          lastCollection: 0,
          config: {}
        },
        frontend: {
          name: 'Frontend Protection',
          enabled: true,
          interval: 15000, // 15 seconds
          lastCollection: 0,
          config: {}
        },
        nginx: {
          name: 'Nginx Infrastructure',
          enabled: true,
          interval: 10000, // 10 seconds
          lastCollection: 0,
          config: {
            logPath: '/var/log/nginx/access.log',
            statusUrl: 'http://localhost/nginx_status'
          }
        },
        crossChain: {
          name: 'Cross-Chain Coordination',
          enabled: true,
          interval: 10000, // 10 seconds
          lastCollection: 0,
          config: {}
        }
      },
      ...config
    };
    
    console.log('📈 Metrics Aggregator initialized');
  }

  /**
   * Start metric collection from all sources
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Metrics Aggregator already running');
      return;
    }

    if (!this.config.enabled) {
      console.log('⚠️ Metrics collection disabled in configuration');
      return;
    }

    this.isRunning = true;
    
    // Start collectors for each enabled source
    for (const [sourceId, source] of Object.entries(this.config.sources)) {
      if (source.enabled) {
        await this.startSourceCollector(sourceId, source);
      }
    }
    
    // Start batch processing
    this.startBatchProcessor();
    
    console.log('🚀 Metrics Aggregator started');
    this.emit('started');
  }

  /**
   * Stop metric collection
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Stop all collectors
    for (const [sourceId, timer] of this.collectors.entries()) {
      clearInterval(timer);
      console.log(`📊 Stopped collector for ${sourceId}`);
    }
    this.collectors.clear();
    
    // Process any remaining metrics
    if (this.metricsBatch.length > 0) {
      await this.processBatch();
    }
    
    console.log('⏹️ Metrics Aggregator stopped');
    this.emit('stopped');
  }

  /**
   * Start collector for a specific source
   */
  private async startSourceCollector(sourceId: string, source: MetricSource): Promise<void> {
    const collectFn = async () => {
      try {
        const metrics = await this.collectFromSource(sourceId, source);
        
        if (metrics.length > 0) {
          this.metricsBatch.push(...metrics);
          source.lastCollection = Date.now();
          
          this.emit('metricsCollected', { sourceId, count: metrics.length });
          
          // Process batch if it's getting large
          if (this.metricsBatch.length >= this.config.batchSize) {
            await this.processBatch();
          }
        }
      } catch (error) {
        console.error(`Error collecting metrics from ${sourceId}:`, error);
        this.emit('collectionError', { sourceId, error });
      }
    };
    
    // Initial collection
    await collectFn();
    
    // Set up periodic collection
    const timer = setInterval(collectFn, source.interval);
    this.collectors.set(sourceId, timer);
    
    console.log(`📊 Started collector for ${source.name} (${source.interval}ms interval)`);
  }

  /**
   * Collect metrics from a specific source
   */
  private async collectFromSource(sourceId: string, source: MetricSource): Promise<MetricData[]> {
    switch (sourceId) {
      case 'contract':
        return await this.collectContractMetrics(source);
      case 'relayer':
        return await this.collectRelayerMetrics(source);
      case 'resolver':
        return await this.collectResolverMetrics(source);
      case 'api':
        return await this.collectAPIMetrics(source);
      case 'frontend':
        return await this.collectFrontendMetrics(source);
      case 'nginx':
        return await this.collectNginxMetrics(source);
      case 'crossChain':
        return await this.collectCrossChainMetrics(source);
      default:
        console.warn(`Unknown source: ${sourceId}`);
        return [];
    }
  }

  /**
   * Collect smart contract metrics
   */
  private async collectContractMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      // In a real implementation, this would connect to the blockchain
      // and query contract events, gas usage, etc.
      
      // Simulated metrics for this example
      metrics.push({
        timestamp: Date.now(),
        source: 'contract',
        type: 'rate_limit_violations',
        value: Math.floor(Math.random() * 10),
        tags: { contract: 'EscrowFactory', network: 'ethereum' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'contract',
        type: 'gas_used',
        value: Math.floor(Math.random() * 100000) + 50000,
        tags: { contract: 'EscrowFactory', operation: 'createEscrow' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'contract',
        type: 'user_cooldowns',
        value: Math.floor(Math.random() * 50),
        tags: { contract: 'EscrowFactory', status: 'active' }
      });
      
    } catch (error) {
      console.error('Error collecting contract metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect relayer service metrics
   */
  private async collectRelayerMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      // Would integrate with actual relayer service monitoring
      
      metrics.push({
        timestamp: Date.now(),
        source: 'relayer',
        type: 'requests_processed',
        value: Math.floor(Math.random() * 100) + 50,
        tags: { service: 'relayer', status: 'success' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'relayer',
        type: 'rate_limit_violations',
        value: Math.floor(Math.random() * 5),
        tags: { service: 'relayer', tier: 'basic' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'relayer',
        type: 'response_time',
        value: Math.floor(Math.random() * 500) + 100,
        tags: { service: 'relayer', endpoint: '/relay' }
      });
      
    } catch (error) {
      console.error('Error collecting relayer metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect resolver service metrics
   */
  private async collectResolverMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      metrics.push({
        timestamp: Date.now(),
        source: 'resolver',
        type: 'resolutions_processed',
        value: Math.floor(Math.random() * 50) + 25,
        tags: { service: 'resolver', chain: 'bitcoin' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'resolver',
        type: 'queue_size',
        value: Math.floor(Math.random() * 20),
        tags: { service: 'resolver', priority: 'high' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'resolver',
        type: 'circuit_breaker_trips',
        value: Math.floor(Math.random() * 2),
        tags: { service: 'resolver', reason: 'timeout' }
      });
      
    } catch (error) {
      console.error('Error collecting resolver metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect API endpoint metrics
   */
  private async collectAPIMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      const endpoints = ['/api/swap', '/api/quote', '/api/status', '/api/history'];
      
      for (const endpoint of endpoints) {
        metrics.push({
          timestamp: Date.now(),
          source: 'api',
          type: 'requests',
          value: Math.floor(Math.random() * 200) + 100,
          tags: { endpoint, method: 'POST' }
        });
        
        metrics.push({
          timestamp: Date.now(),
          source: 'api',
          type: 'blocked_requests',
          value: Math.floor(Math.random() * 10),
          tags: { endpoint, reason: 'rate_limit' }
        });
      }
      
    } catch (error) {
      console.error('Error collecting API metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect frontend protection metrics
   */
  private async collectFrontendMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      metrics.push({
        timestamp: Date.now(),
        source: 'frontend',
        type: 'requests_throttled',
        value: Math.floor(Math.random() * 20),
        tags: { component: 'protection', reason: 'high_frequency' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'frontend',
        type: 'captcha_challenges',
        value: Math.floor(Math.random() * 15),
        tags: { component: 'protection', status: 'presented' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'frontend',
        type: 'queue_size',
        value: Math.floor(Math.random() * 50),
        tags: { component: 'protection', priority: 'normal' }
      });
      
    } catch (error) {
      console.error('Error collecting frontend metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect Nginx infrastructure metrics
   */
  private async collectNginxMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      // In real implementation, would parse Nginx logs and status page
      
      metrics.push({
        timestamp: Date.now(),
        source: 'nginx',
        type: 'requests',
        value: Math.floor(Math.random() * 1000) + 500,
        tags: { server: 'proxy', status: '200' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'nginx',
        type: 'blocked_requests',
        value: Math.floor(Math.random() * 50),
        tags: { server: 'proxy', reason: 'rate_limit' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'nginx',
        type: 'connections',
        value: Math.floor(Math.random() * 100) + 50,
        tags: { server: 'proxy', status: 'active' }
      });
      
    } catch (error) {
      console.error('Error collecting Nginx metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Collect cross-chain coordination metrics
   */
  private async collectCrossChainMetrics(source: MetricSource): Promise<MetricData[]> {
    const metrics: MetricData[] = [];
    
    try {
      metrics.push({
        timestamp: Date.now(),
        source: 'cross-chain',
        type: 'operations_coordinated',
        value: Math.floor(Math.random() * 30) + 10,
        tags: { from: 'ethereum', to: 'bitcoin' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'cross-chain',
        type: 'resource_pool_usage',
        value: Math.floor(Math.random() * 80) + 20,
        tags: { pool: 'ethereum', unit: 'percentage' }
      });
      
      metrics.push({
        timestamp: Date.now(),
        source: 'cross-chain',
        type: 'coordination_delays',
        value: Math.floor(Math.random() * 5000) + 1000,
        tags: { type: 'dependency_wait', unit: 'ms' }
      });
      
    } catch (error) {
      console.error('Error collecting cross-chain metrics:', error);
    }
    
    return metrics;
  }

  /**
   * Start batch processing timer
   */
  private startBatchProcessor(): void {
    const processBatch = async () => {
      if (this.metricsBatch.length > 0) {
        await this.processBatch();
      }
    };
    
    // Process batches every 5 seconds or when batch is full
    setInterval(processBatch, 5000);
  }

  /**
   * Process accumulated metrics batch
   */
  private async processBatch(): Promise<void> {
    if (this.metricsBatch.length === 0) {
      return;
    }
    
    const batch = [...this.metricsBatch];
    this.metricsBatch = [];
    
    try {
      // Send metrics to monitoring system
      for (const metric of batch) {
        rateLimitMonitor.recordMetric(metric);
      }
      
      console.log(`📊 Processed metrics batch: ${batch.length} metrics`);
      this.emit('batchProcessed', { count: batch.length });
      
    } catch (error) {
      console.error('Error processing metrics batch:', error);
      
      // Re-add failed metrics for retry (with limit)
      if (batch.length < this.config.batchSize * 3) { // Prevent infinite growth
        this.metricsBatch.unshift(...batch);
      }
      
      this.emit('batchError', { error, count: batch.length });
    }
  }

  /**
   * Get aggregator status and statistics
   */
  getStatus(): {
    running: boolean;
    sources: Record<string, { enabled: boolean; lastCollection: number; interval: number }>;
    pendingMetrics: number;
    stats: {
      totalCollected: number;
      totalProcessed: number;
      errors: number;
    };
  } {
    const sources: Record<string, any> = {};
    
    for (const [sourceId, source] of Object.entries(this.config.sources)) {
      sources[sourceId] = {
        enabled: source.enabled,
        lastCollection: source.lastCollection,
        interval: source.interval,
        timeSinceLastCollection: source.lastCollection > 0 ? Date.now() - source.lastCollection : null
      };
    }
    
    return {
      running: this.isRunning,
      sources,
      pendingMetrics: this.metricsBatch.length,
      stats: {
        totalCollected: this.listenerCount('metricsCollected'),
        totalProcessed: this.listenerCount('batchProcessed'),
        errors: this.listenerCount('collectionError') + this.listenerCount('batchError')
      }
    };
  }

  /**
   * Enable/disable a specific metrics source
   */
  configureSource(sourceId: string, config: Partial<MetricSource>): void {
    if (!this.config.sources[sourceId]) {
      throw new Error(`Unknown metrics source: ${sourceId}`);
    }
    
    const source = this.config.sources[sourceId];
    const wasEnabled = source.enabled;
    
    Object.assign(source, config);
    
    // Restart collector if needed
    if (this.isRunning) {
      if (wasEnabled && !source.enabled) {
        // Disable source
        const timer = this.collectors.get(sourceId);
        if (timer) {
          clearInterval(timer);
          this.collectors.delete(sourceId);
          console.log(`📊 Disabled collector for ${sourceId}`);
        }
      } else if (!wasEnabled && source.enabled) {
        // Enable source
        this.startSourceCollector(sourceId, source).catch(error => {
          console.error(`Failed to start collector for ${sourceId}:`, error);
        });
      }
    }
    
    this.emit('sourceConfigured', { sourceId, config });
  }

  /**
   * Manually trigger collection from a specific source
   */
  async collectNow(sourceId: string): Promise<MetricData[]> {
    const source = this.config.sources[sourceId];
    if (!source) {
      throw new Error(`Unknown metrics source: ${sourceId}`);
    }
    
    if (!source.enabled) {
      throw new Error(`Metrics source ${sourceId} is disabled`);
    }
    
    const metrics = await this.collectFromSource(sourceId, source);
    
    if (metrics.length > 0) {
      this.metricsBatch.push(...metrics);
      source.lastCollection = Date.now();
    }
    
    return metrics;
  }
}

// Export singleton instance
export const metricsAggregator = new MetricsAggregator();

export default metricsAggregator;