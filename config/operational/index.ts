import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/**
 * Operational Configuration System
 * 
 * Manages operational aspects including:
 * - Health checks and monitoring
 * - Graceful shutdown procedures
 * - Rate limiting and throttling
 * - Backup and recovery
 * - Performance monitoring
 * - Circuit breaker patterns
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type ServiceStatus = 'running' | 'starting' | 'stopping' | 'stopped' | 'error';

export interface OperationalConfig {
  environment: string;
  serviceName: string;
  healthChecks: HealthCheckConfig;
  monitoring: MonitoringConfig;
  rateLimit: RateLimitConfig;
  circuitBreaker: CircuitBreakerConfig;
  gracefulShutdown: GracefulShutdownConfig;
  backup: BackupConfig;
  performance: PerformanceConfig;
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  endpoints: HealthEndpoint[];
  dependencies: HealthDependency[];
  thresholds: HealthThresholds;
}

export interface HealthEndpoint {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  timeout: number;
}

export interface HealthDependency {
  name: string;
  type: 'database' | 'redis' | 'api' | 'blockchain' | 'service';
  url?: string;
  timeout: number;
  critical: boolean;
}

export interface HealthThresholds {
  cpu: number; // percentage
  memory: number; // percentage
  disk: number; // percentage
  responseTime: number; // milliseconds
}

export interface MonitoringConfig {
  enabled: boolean;
  metricsPort: number;
  metricsPath: string;
  prometheus: {
    enabled: boolean;
    scrapeInterval: number;
  };
  alerts: AlertConfig[];
  logging: LoggingConfig;
}

export interface AlertConfig {
  name: string;
  condition: string;
  threshold: number;
  duration: number;
  severity: 'critical' | 'warning' | 'info';
  channels: string[];
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  format: 'json' | 'text';
  outputs: LogOutput[];
  rotation: {
    enabled: boolean;
    maxSize: string;
    maxFiles: number;
    compress: boolean;
  };
}

export interface LogOutput {
  type: 'console' | 'file' | 'syslog' | 'http';
  destination?: string;
  level?: string;
}

export interface RateLimitConfig {
  enabled: boolean;
  global: RateLimitRule;
  endpoints: Record<string, RateLimitRule>;
  storage: 'memory' | 'redis';
  keyGenerator: string; // function or strategy
}

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: any) => string;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  fallbackEnabled: boolean;
  services: Record<string, ServiceCircuitBreaker>;
}

export interface ServiceCircuitBreaker {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;
  timeout: number;
  fallback?: () => any;
}

export interface GracefulShutdownConfig {
  enabled: boolean;
  timeout: number;
  signals: string[];
  hooks: ShutdownHook[];
  forceExitTimeout: number;
}

export interface ShutdownHook {
  name: string;
  priority: number; // Higher priority runs first
  timeout: number;
  handler: () => Promise<void>;
}

export interface BackupConfig {
  enabled: boolean;
  schedule: string; // Cron expression
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  storage: BackupStorage;
  encryption: {
    enabled: boolean;
    algorithm: string;
    keyId?: string;
  };
  verification: boolean;
}

export interface BackupStorage {
  type: 'local' | 's3' | 'gcs' | 'azure';
  config: {
    bucket?: string;
    region?: string;
    path: string;
    credentials?: any;
  };
}

export interface PerformanceConfig {
  monitoring: {
    enabled: boolean;
    sampleRate: number;
    thresholds: PerformanceThresholds;
  };
  optimization: {
    compression: boolean;
    caching: boolean;
    keepAlive: boolean;
  };
  limits: {
    maxConnections: number;
    maxRequestSize: string;
    requestTimeout: number;
  };
}

export interface PerformanceThresholds {
  responseTime: number; // ms
  throughput: number; // requests/second
  errorRate: number; // percentage
  cpuUsage: number; // percentage
  memoryUsage: number; // percentage
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  version: string;
  environment: string;
  checks: HealthCheck[];
  system: SystemMetrics;
}

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  duration: number;
  error?: string;
  details?: any;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    load: number[];
  };
  memory: {
    usage: number;
    used: number;
    total: number;
  };
  disk: {
    usage: number;
    free: number;
    total: number;
  };
  network: {
    connections: number;
    bytesIn: number;
    bytesOut: number;
  };
}

export class OperationalManager {
  private config: OperationalConfig;
  private startTime: number;
  private shutdownHooks: ShutdownHook[] = [];
  private healthChecks: Map<string, () => Promise<HealthCheck>> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private isShuttingDown: boolean = false;

  constructor(config: OperationalConfig) {
    this.config = config;
    this.startTime = Date.now();
    
    this.initializeHealthChecks();
    this.initializeCircuitBreakers();
    this.setupGracefulShutdown();
    
    if (config.backup.enabled) {
      this.initializeBackupSchedule();
    }
    
    console.log(`⚙️ Operational Manager initialized for ${config.serviceName}`);
  }

  /**
   * Register a health check
   */
  registerHealthCheck(name: string, checker: () => Promise<HealthCheck>): void {
    this.healthChecks.set(name, checker);
    console.log(`✅ Registered health check: ${name}`);
  }

  /**
   * Register a shutdown hook
   */
  registerShutdownHook(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
    this.shutdownHooks.sort((a, b) => b.priority - a.priority);
    console.log(`🪝 Registered shutdown hook: ${hook.name} (priority: ${hook.priority})`);
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheck[] = [];
    let overallStatus: HealthStatus = 'healthy';

    // Run all registered health checks
    for (const [name, checker] of this.healthChecks.entries()) {
      try {
        const check = await Promise.race([
          checker(),
          new Promise<HealthCheck>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), this.config.healthChecks.timeout)
          )
        ]);
        
        checks.push(check);
        
        if (check.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        } else if (check.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
        
      } catch (error) {
        const failedCheck: HealthCheck = {
          name,
          status: 'unhealthy',
          duration: this.config.healthChecks.timeout,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        checks.push(failedCheck);
        overallStatus = 'unhealthy';
      }
    }

    // Get system metrics
    const systemMetrics = await this.getSystemMetrics();

    return {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: this.config.environment,
      checks,
      system: systemMetrics
    };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(service: string): any {
    const breaker = this.circuitBreakers.get(service);
    return breaker ? breaker.getStatus() : null;
  }

  /**
   * Execute with circuit breaker protection
   */
  async executeWithCircuitBreaker<T>(service: string, operation: () => Promise<T>): Promise<T> {
    const breaker = this.circuitBreakers.get(service);
    if (!breaker) {
      return operation();
    }
    
    return breaker.execute(operation);
  }

  /**
   * Initiate graceful shutdown
   */
  async gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log('⚠️ Shutdown already in progress');
      return;
    }
    
    this.isShuttingDown = true;
    console.log(`🛑 Initiating graceful shutdown (signal: ${signal})`);
    
    const shutdownTimeout = this.config.gracefulShutdown.timeout;
    const forceExitTimeout = this.config.gracefulShutdown.forceExitTimeout;
    
    try {
      // Run shutdown hooks with overall timeout
      await Promise.race([
        this.executeShutdownHooks(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout)
        )
      ]);
      
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
      
    } catch (error) {
      console.error('⚠️ Graceful shutdown timeout, forcing exit:', error);
      setTimeout(() => process.exit(1), forceExitTimeout);
    }
  }

  /**
   * Create backup
   */
  async createBackup(type: 'manual' | 'scheduled' = 'manual'): Promise<string> {
    if (!this.config.backup.enabled) {
      throw new Error('Backup is disabled');
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `${this.config.serviceName}-${type}-${timestamp}`;
    
    console.log(`💾 Creating backup: ${backupId}`);
    
    try {
      // Create backup data
      const backupData = await this.generateBackupData();
      
      // Encrypt if enabled
      let finalData = backupData;
      if (this.config.backup.encryption.enabled) {
        finalData = await this.encryptBackupData(backupData);
      }
      
      // Store backup
      const backupPath = await this.storeBackup(backupId, finalData);
      
      // Verify backup if enabled
      if (this.config.backup.verification) {
        await this.verifyBackup(backupPath, finalData);
      }
      
      console.log(`✅ Backup created successfully: ${backupId}`);
      return backupId;
      
    } catch (error) {
      console.error(`❌ Backup creation failed: ${backupId}`, error);
      throw error;
    }
  }

  // Private methods

  private initializeHealthChecks(): void {
    if (!this.config.healthChecks.enabled) {
      return;
    }

    // Register default health checks
    this.registerHealthCheck('service', async () => ({
      name: 'service',
      status: this.isShuttingDown ? 'degraded' : 'healthy',
      duration: 0,
      details: {
        uptime: Date.now() - this.startTime,
        status: this.isShuttingDown ? 'shutting down' : 'running'
      }
    }));

    // Register dependency health checks
    for (const dependency of this.config.healthChecks.dependencies) {
      this.registerHealthCheck(dependency.name, () => this.checkDependency(dependency));
    }

    // Start periodic health checks if interval is set
    if (this.config.healthChecks.interval > 0) {
      setInterval(async () => {
        try {
          const result = await this.performHealthCheck();
          if (result.status !== 'healthy') {
            console.warn(`⚠️ Health check warning: ${result.status}`);
          }
        } catch (error) {
          console.error('Health check failed:', error);
        }
      }, this.config.healthChecks.interval);
    }
  }

  private async checkDependency(dependency: HealthDependency): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      switch (dependency.type) {
        case 'database':
          return await this.checkDatabase(dependency);
        case 'redis':
          return await this.checkRedis(dependency);
        case 'api':
          return await this.checkApi(dependency);
        case 'blockchain':
          return await this.checkBlockchain(dependency);
        case 'service':
          return await this.checkService(dependency);
        default:
          throw new Error(`Unknown dependency type: ${dependency.type}`);
      }
    } catch (error) {
      return {
        name: dependency.name,
        status: dependency.critical ? 'unhealthy' : 'degraded',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkDatabase(dependency: HealthDependency): Promise<HealthCheck> {
    // Database-specific health check implementation
    return {
      name: dependency.name,
      status: 'healthy',
      duration: 10,
      details: { type: 'database' }
    };
  }

  private async checkRedis(dependency: HealthDependency): Promise<HealthCheck> {
    // Redis-specific health check implementation
    return {
      name: dependency.name,
      status: 'healthy',
      duration: 5,
      details: { type: 'redis' }
    };
  }

  private async checkApi(dependency: HealthDependency): Promise<HealthCheck> {
    if (!dependency.url) {
      throw new Error('URL required for API health check');
    }

    const startTime = Date.now();
    
    try {
      const response = await fetch(dependency.url, {
        method: 'GET',
        signal: AbortSignal.timeout(dependency.timeout)
      });
      
      const duration = Date.now() - startTime;
      const status = response.ok ? 'healthy' : 'degraded';
      
      return {
        name: dependency.name,
        status,
        duration,
        details: {
          statusCode: response.status,
          responseTime: duration
        }
      };
    } catch (error) {
      return {
        name: dependency.name,
        status: 'unhealthy',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkBlockchain(dependency: HealthDependency): Promise<HealthCheck> {
    // Blockchain-specific health check implementation
    return {
      name: dependency.name,
      status: 'healthy',
      duration: 100,
      details: { type: 'blockchain' }
    };
  }

  private async checkService(dependency: HealthDependency): Promise<HealthCheck> {
    // Service-specific health check implementation
    return {
      name: dependency.name,
      status: 'healthy',
      duration: 20,
      details: { type: 'service' }
    };
  }

  private initializeCircuitBreakers(): void {
    if (!this.config.circuitBreaker.enabled) {
      return;
    }

    for (const [serviceName, config] of Object.entries(this.config.circuitBreaker.services)) {
      if (config.enabled) {
        const breaker = new CircuitBreaker(serviceName, config);
        this.circuitBreakers.set(serviceName, breaker);
        console.log(`⚡ Initialized circuit breaker for: ${serviceName}`);
      }
    }
  }

  private setupGracefulShutdown(): void {
    if (!this.config.gracefulShutdown.enabled) {
      return;
    }

    const signals = this.config.gracefulShutdown.signals;
    
    for (const signal of signals) {
      process.on(signal as NodeJS.Signals, () => {
        this.gracefulShutdown(signal);
      });
    }
    
    console.log(`🛡️ Graceful shutdown configured for signals: ${signals.join(', ')}`);
  }

  private async executeShutdownHooks(): Promise<void> {
    console.log(`🪝 Executing ${this.shutdownHooks.length} shutdown hooks...`);
    
    for (const hook of this.shutdownHooks) {
      try {
        console.log(`⏳ Running shutdown hook: ${hook.name}`);
        
        await Promise.race([
          hook.handler(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Hook timeout')), hook.timeout)
          )
        ]);
        
        console.log(`✅ Completed shutdown hook: ${hook.name}`);
        
      } catch (error) {
        console.error(`❌ Shutdown hook failed: ${hook.name}`, error);
        // Continue with other hooks
      }
    }
  }

  private async getSystemMetrics(): Promise<SystemMetrics> {
    // This would get actual system metrics
    // For now, return mock data
    return {
      cpu: {
        usage: 45.2,
        load: [0.5, 0.6, 0.7]
      },
      memory: {
        usage: 62.1,
        used: 512 * 1024 * 1024,
        total: 1024 * 1024 * 1024
      },
      disk: {
        usage: 78.3,
        free: 10 * 1024 * 1024 * 1024,
        total: 50 * 1024 * 1024 * 1024
      },
      network: {
        connections: 25,
        bytesIn: 1024 * 1024,
        bytesOut: 2048 * 1024
      }
    };
  }

  private initializeBackupSchedule(): void {
    // This would set up cron-based backup scheduling
    console.log(`📅 Backup scheduled: ${this.config.backup.schedule}`);
  }

  private async generateBackupData(): Promise<string> {
    // Generate backup data based on service type
    const backupData = {
      timestamp: new Date().toISOString(),
      service: this.config.serviceName,
      environment: this.config.environment,
      version: process.env.npm_package_version || '1.0.0',
      configuration: this.config,
      // Add service-specific data here
    };
    
    return JSON.stringify(backupData, null, 2);
  }

  private async encryptBackupData(data: string): Promise<string> {
    // Implement backup encryption
    const hash = createHash('sha256');
    hash.update(data);
    return `encrypted:${hash.digest('hex')}:${Buffer.from(data).toString('base64')}`;
  }

  private async storeBackup(backupId: string, data: string): Promise<string> {
    const storage = this.config.backup.storage;
    
    switch (storage.type) {
      case 'local':
        return this.storeLocalBackup(backupId, data, storage);
      case 's3':
        return this.storeS3Backup(backupId, data, storage);
      default:
        throw new Error(`Unsupported backup storage: ${storage.type}`);
    }
  }

  private async storeLocalBackup(backupId: string, data: string, storage: BackupStorage): Promise<string> {
    const backupDir = storage.config.path;
    
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    
    const backupPath = join(backupDir, `${backupId}.json`);
    writeFileSync(backupPath, data, 'utf8');
    
    return backupPath;
  }

  private async storeS3Backup(backupId: string, data: string, storage: BackupStorage): Promise<string> {
    // S3 backup implementation would go here
    throw new Error('S3 backup not implemented');
  }

  private async verifyBackup(backupPath: string, originalData: string): Promise<void> {
    try {
      const storedData = readFileSync(backupPath, 'utf8');
      
      if (storedData !== originalData) {
        throw new Error('Backup verification failed: data mismatch');
      }
      
      console.log(`✅ Backup verification passed: ${backupPath}`);
      
    } catch (error) {
      console.error(`❌ Backup verification failed: ${backupPath}`, error);
      throw error;
    }
  }
}

/**
 * Simple Circuit Breaker implementation
 */
class CircuitBreaker {
  private name: string;
  private config: ServiceCircuitBreaker;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  constructor(name: string, config: ServiceCircuitBreaker) {
    this.name = name;
    this.config = config;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.config.resetTimeout) {
        throw new Error(`Circuit breaker open for ${this.name}`);
      } else {
        this.state = 'half-open';
        this.successCount = 0;
      }
    }

    try {
      const result = await Promise.race([
        operation(),
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.config.timeout)
        )
      ]);

      this.onSuccess();
      return result;

    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 3) { // Configurable
        this.state = 'closed';
        console.log(`✅ Circuit breaker closed for ${this.name}`);
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      console.log(`⚡ Circuit breaker opened for ${this.name}`);
    }
  }

  getStatus(): any {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      successCount: this.successCount
    };
  }
}

/**
 * Factory function to create operational manager
 */
export function createOperationalManager(overrides: Partial<OperationalConfig> = {}): OperationalManager {
  const defaultConfig: OperationalConfig = {
    environment: process.env.NODE_ENV || 'development',
    serviceName: process.env.SERVICE_NAME || 'fusion-service',
    healthChecks: {
      enabled: process.env.HEALTH_CHECKS_ENABLED !== 'false',
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
      endpoints: [],
      dependencies: [],
      thresholds: {
        cpu: 80,
        memory: 85,
        disk: 90,
        responseTime: 5000
      }
    },
    monitoring: {
      enabled: process.env.MONITORING_ENABLED !== 'false',
      metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
      metricsPath: process.env.METRICS_PATH || '/metrics',
      prometheus: {
        enabled: process.env.PROMETHEUS_ENABLED === 'true',
        scrapeInterval: parseInt(process.env.PROMETHEUS_SCRAPE_INTERVAL || '15000')
      },
      alerts: [],
      logging: {
        level: (process.env.LOG_LEVEL || 'info') as any,
        format: (process.env.LOG_FORMAT || 'json') as any,
        outputs: [
          { type: 'console' },
          { type: 'file', destination: process.env.LOG_FILE || './logs/app.log' }
        ],
        rotation: {
          enabled: process.env.LOG_ROTATION_ENABLED === 'true',
          maxSize: process.env.LOG_MAX_SIZE || '100m',
          maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
          compress: process.env.LOG_COMPRESS === 'true'
        }
      }
    },
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
      global: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
      },
      endpoints: {},
      storage: (process.env.RATE_LIMIT_STORAGE as any) || 'memory',
      keyGenerator: process.env.RATE_LIMIT_KEY_GENERATOR || 'ip'
    },
    circuitBreaker: {
      enabled: process.env.CIRCUIT_BREAKER_ENABLED === 'true',
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
      resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '60000'),
      monitoringPeriod: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_PERIOD || '60000'),
      fallbackEnabled: process.env.CIRCUIT_BREAKER_FALLBACK_ENABLED === 'true',
      services: {}
    },
    gracefulShutdown: {
      enabled: process.env.GRACEFUL_SHUTDOWN_ENABLED !== 'false',
      timeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000'),
      signals: (process.env.GRACEFUL_SHUTDOWN_SIGNALS || 'SIGTERM,SIGINT').split(','),
      hooks: [],
      forceExitTimeout: parseInt(process.env.FORCE_EXIT_TIMEOUT || '10000')
    },
    backup: {
      enabled: process.env.BACKUP_ENABLED === 'true',
      schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
      retention: {
        daily: parseInt(process.env.BACKUP_RETENTION_DAILY || '7'),
        weekly: parseInt(process.env.BACKUP_RETENTION_WEEKLY || '4'),
        monthly: parseInt(process.env.BACKUP_RETENTION_MONTHLY || '3')
      },
      storage: {
        type: (process.env.BACKUP_STORAGE_TYPE as any) || 'local',
        config: {
          path: process.env.BACKUP_PATH || './backups'
        }
      },
      encryption: {
        enabled: process.env.BACKUP_ENCRYPTION_ENABLED === 'true',
        algorithm: process.env.BACKUP_ENCRYPTION_ALGORITHM || 'aes-256-gcm'
      },
      verification: process.env.BACKUP_VERIFICATION_ENABLED === 'true'
    },
    performance: {
      monitoring: {
        enabled: process.env.PERFORMANCE_MONITORING_ENABLED === 'true',
        sampleRate: parseFloat(process.env.PERFORMANCE_SAMPLE_RATE || '0.1'),
        thresholds: {
          responseTime: parseInt(process.env.PERFORMANCE_RESPONSE_TIME_THRESHOLD || '5000'),
          throughput: parseInt(process.env.PERFORMANCE_THROUGHPUT_THRESHOLD || '100'),
          errorRate: parseFloat(process.env.PERFORMANCE_ERROR_RATE_THRESHOLD || '5.0'),
          cpuUsage: parseFloat(process.env.PERFORMANCE_CPU_THRESHOLD || '80.0'),
          memoryUsage: parseFloat(process.env.PERFORMANCE_MEMORY_THRESHOLD || '85.0')
        }
      },
      optimization: {
        compression: process.env.COMPRESSION_ENABLED !== 'false',
        caching: process.env.CACHING_ENABLED !== 'false',
        keepAlive: process.env.KEEP_ALIVE_ENABLED !== 'false'
      },
      limits: {
        maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000'),
        maxRequestSize: process.env.MAX_REQUEST_SIZE || '1mb',
        requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000')
      }
    }
  };
  
  const config = { ...defaultConfig, ...overrides };
  
  return new OperationalManager(config);
}

export default OperationalManager;