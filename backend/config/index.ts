import dotenv from 'dotenv';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
dotenv.config();

// Type definitions
export type Environment = 'development' | 'staging' | 'production' | 'test';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface DatabaseConfig {
  type: 'postgresql' | 'mysql' | 'sqlite';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean | object;
  pool: {
    min: number;
    max: number;
    acquireTimeoutMs: number;
    idleTimeoutMs: number;
    createTimeoutMs: number;
  };
  readReplica?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
}

export interface RedisConfig {
  url: string;
  host: string;
  port: number;
  password?: string;
  db: number;
  ttl: number;
  sentinel?: {
    enabled: boolean;
    hosts: string[];
    name: string;
  };
}

export interface EthereumConfig {
  network: string;
  rpcUrl: string;
  rpcUrls: string[];
  chainId: number;
  confirmationsRequired: number;
  gasPrice: {
    standard: string;
    fast: string;
    rapid: string;
  };
  gasLimitBuffer: number;
  contracts: {
    escrowFactory?: string;
    escrowSrcImplementation?: string;
    escrowDstImplementation?: string;
    limitOrderProtocol?: string;
  };
}

export interface BitcoinConfig {
  network: 'mainnet' | 'testnet' | 'regtest';
  rpcUrl: string;
  rpcHost: string;
  rpcPort: number;
  rpcUser: string;
  rpcPassword: string;
  confirmationsRequired: number;
  feeRate: {
    standard: number;
    fast: number;
    rapid: number;
  };
}

export interface ServiceConfig {
  relayer: {
    port: number;
    host: string;
    baseUrl: string;
    maxConcurrentAuctions: number;
    auctionTimeout: number;
  };
  resolver: {
    port: number;
    host: string;
    baseUrl: string;
    maxConcurrentSwaps: number;
    swapTimeout: number;
    secretRevealDelay: number;
  };
}

export interface SecurityConfig {
  httpsEnabled: boolean;
  tls?: {
    certPath: string;
    keyPath: string;
    caPath: string;
  };
  cors: {
    enabled: boolean;
    origins: string[];
    credentials: boolean;
    maxAge: number;
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
    skipSuccessful: boolean;
  };
  jwt: {
    expiresIn: string;
    refreshExpiresIn: string;
  };
  bcryptRounds: number;
}

export interface MonitoringConfig {
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
  };
  metrics: {
    enabled: boolean;
    port: number;
    path: string;
    prometheusEnabled: boolean;
  };
  logging: {
    level: LogLevel;
    format: 'json' | 'text';
    filePath: string;
    maxSize: string;
    maxFiles: number;
    compress: boolean;
  };
  tracing: {
    jaegerEnabled: boolean;
    agentHost: string;
    agentPort: number;
    serviceName: string;
  };
  errorTracking: {
    sentryDsn?: string;
    environment: string;
    sampleRate: number;
  };
}

export interface BusinessConfig {
  auction: {
    timeout: number;
    minBidIncrement: string;
    reserveTimeout: number;
  };
  swap: {
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  risk: {
    enabled: boolean;
    maxSingleOrderSize: string;
    maxDailyVolume: string;
    minProfitMargin: number;
    maxSlippage: number;
  };
  liquidity: {
    reserveRatio: number;
    rebalanceThreshold: number;
    minThreshold: string;
  };
}

export interface OperationalConfig {
  gracefulShutdownTimeout: number;
  processTitle: string;
  maxMemoryUsage: number;
  memoryCheckInterval: number;
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    timeout: number;
    resetTimeout: number;
  };
  backup: {
    enabled: boolean;
    interval: number;
    retentionDays: number;
    s3Bucket?: string;
    s3Region?: string;
  };
}

export interface FeatureFlags {
  crossChainSwaps: boolean;
  auctionSystem: boolean;
  riskManagement: boolean;
  batchOperations: boolean;
  flashLoans: boolean;
  mevProtection: boolean;
  dynamicFees: boolean;
  multiHopSwaps: boolean;
  limitOrders: boolean;
}

export interface BackendConfig {
  environment: Environment;
  serviceName: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  ethereum: EthereumConfig;
  bitcoin: BitcoinConfig;
  services: ServiceConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
  business: BusinessConfig;
  operational: OperationalConfig;
  features: FeatureFlags;
  secrets: {
    ethRelayerPrivateKey?: string;
    ethResolverPrivateKey?: string;
    btcRelayerPrivateKey?: string;
    btcResolverPrivateKey?: string;
    relayerSecretKey?: string;
    resolverSecretKey?: string;
    apiSecretKey?: string;
    sessionSecret?: string;
    serviceToServiceSecret?: string;
  };
}

// Configuration loader
class ConfigLoader {
  private config: BackendConfig;

  constructor() {
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  private loadConfiguration(): BackendConfig {
    const env = (process.env.NODE_ENV || 'development') as Environment;
    
    return {
      environment: env,
      serviceName: process.env.SERVICE_NAME || 'fusion-backend',
      
      database: this.loadDatabaseConfig(),
      redis: this.loadRedisConfig(),
      ethereum: this.loadEthereumConfig(),
      bitcoin: this.loadBitcoinConfig(),
      services: this.loadServiceConfig(),
      security: this.loadSecurityConfig(),
      monitoring: this.loadMonitoringConfig(),
      business: this.loadBusinessConfig(),
      operational: this.loadOperationalConfig(),
      features: this.loadFeatureFlags(),
      secrets: this.loadSecrets()
    };
  }

  private loadDatabaseConfig(): DatabaseConfig {
    return {
      type: (process.env.DB_TYPE || 'postgresql') as DatabaseConfig['type'],
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fusion_backend',
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL_MODE === 'require',
      pool: {
        min: parseInt(process.env.DB_POOL_MIN || '2'),
        max: parseInt(process.env.DB_POOL_MAX || '20'),
        acquireTimeoutMs: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '30000'),
        idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000'),
        createTimeoutMs: parseInt(process.env.DB_POOL_CREATE_TIMEOUT || '30000')
      },
      readReplica: process.env.DB_READ_HOST ? {
        host: process.env.DB_READ_HOST,
        port: parseInt(process.env.DB_READ_PORT || '5432'),
        username: process.env.DB_READ_USERNAME || '',
        password: process.env.DB_READ_PASSWORD || ''
      } : undefined
    };
  }

  private loadRedisConfig(): RedisConfig {
    return {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      ttl: parseInt(process.env.REDIS_TTL || '3600'),
      sentinel: process.env.REDIS_SENTINEL_ENABLED === 'true' ? {
        enabled: true,
        hosts: (process.env.REDIS_SENTINEL_HOSTS || '').split(',').filter(Boolean),
        name: process.env.REDIS_SENTINEL_NAME || 'mymaster'
      } : undefined
    };
  }

  private loadEthereumConfig(): EthereumConfig {
    return {
      network: process.env.ETH_NETWORK || 'sepolia',
      rpcUrl: process.env.ETH_RPC_URL || 'https://rpc.sepolia.org',
      rpcUrls: (process.env.ETH_RPC_URLS || process.env.ETH_RPC_URL || 'https://rpc.sepolia.org').split(','),
      chainId: parseInt(process.env.ETH_CHAIN_ID || '11155111'),
      confirmationsRequired: parseInt(process.env.ETH_CONFIRMATIONS_REQUIRED || '2'),
      gasPrice: {
        standard: process.env.ETH_GAS_PRICE_STANDARD || '20000000000',
        fast: process.env.ETH_GAS_PRICE_FAST || '50000000000',
        rapid: process.env.ETH_GAS_PRICE_RAPID || '100000000000'
      },
      gasLimitBuffer: parseFloat(process.env.ETH_GAS_LIMIT_BUFFER || '1.2'),
      contracts: {
        escrowFactory: process.env.ESCROW_FACTORY_ADDRESS,
        escrowSrcImplementation: process.env.ESCROW_SRC_IMPLEMENTATION_ADDRESS,
        escrowDstImplementation: process.env.ESCROW_DST_IMPLEMENTATION_ADDRESS,
        limitOrderProtocol: process.env.LIMIT_ORDER_PROTOCOL_ADDRESS
      }
    };
  }

  private loadBitcoinConfig(): BitcoinConfig {
    return {
      network: (process.env.BTC_NETWORK || 'testnet') as BitcoinConfig['network'],
      rpcUrl: process.env.BTC_RPC_URL || 'http://localhost:18332',
      rpcHost: process.env.BTC_RPC_HOST || 'localhost',
      rpcPort: parseInt(process.env.BTC_RPC_PORT || '18332'),
      rpcUser: process.env.BTC_RPC_USER || 'bitcoin',
      rpcPassword: process.env.BTC_RPC_PASSWORD || 'password',
      confirmationsRequired: parseInt(process.env.BTC_CONFIRMATIONS_REQUIRED || '3'),
      feeRate: {
        standard: parseInt(process.env.BTC_FEE_RATE_STANDARD || '10'),
        fast: parseInt(process.env.BTC_FEE_RATE_FAST || '20'),
        rapid: parseInt(process.env.BTC_FEE_RATE_RAPID || '50')
      }
    };
  }

  private loadServiceConfig(): ServiceConfig {
    return {
      relayer: {
        port: parseInt(process.env.RELAYER_PORT || '3001'),
        host: process.env.RELAYER_HOST || '0.0.0.0',
        baseUrl: process.env.RELAYER_BASE_URL || 'http://localhost:3001',
        maxConcurrentAuctions: parseInt(process.env.MAX_CONCURRENT_AUCTIONS || '50'),
        auctionTimeout: parseInt(process.env.AUCTION_TIMEOUT || '30000')
      },
      resolver: {
        port: parseInt(process.env.RESOLVER_PORT || '3002'),
        host: process.env.RESOLVER_HOST || '0.0.0.0',
        baseUrl: process.env.RESOLVER_BASE_URL || 'http://localhost:3002',
        maxConcurrentSwaps: parseInt(process.env.MAX_CONCURRENT_SWAPS || '10'),
        swapTimeout: parseInt(process.env.SWAP_TIMEOUT || '300000'),
        secretRevealDelay: parseInt(process.env.SECRET_REVEAL_DELAY || '60000')
      }
    };
  }

  private loadSecurityConfig(): SecurityConfig {
    return {
      httpsEnabled: process.env.HTTPS_ENABLED === 'true',
      tls: process.env.TLS_CERT_PATH ? {
        certPath: process.env.TLS_CERT_PATH,
        keyPath: process.env.TLS_KEY_PATH || '',
        caPath: process.env.TLS_CA_PATH || ''
      } : undefined,
      cors: {
        enabled: process.env.CORS_ENABLED !== 'false',
        origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
        credentials: process.env.CORS_CREDENTIALS === 'true',
        maxAge: parseInt(process.env.CORS_MAX_AGE || '86400')
      },
      rateLimit: {
        enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
        skipSuccessful: process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true'
      },
      jwt: {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
      },
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12')
    };
  }

  private loadMonitoringConfig(): MonitoringConfig {
    return {
      healthCheck: {
        enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
        interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
        timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000')
      },
      metrics: {
        enabled: process.env.METRICS_ENABLED !== 'false',
        port: parseInt(process.env.METRICS_PORT || '9090'),
        path: process.env.METRICS_PATH || '/metrics',
        prometheusEnabled: process.env.PROMETHEUS_ENABLED === 'true'
      },
      logging: {
        level: (process.env.LOG_LEVEL || 'info') as LogLevel,
        format: (process.env.LOG_FORMAT || 'json') as 'json' | 'text',
        filePath: process.env.LOG_FILE_PATH || './logs/backend.log',
        maxSize: process.env.LOG_MAX_SIZE || '100m',
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
        compress: process.env.LOG_COMPRESS === 'true'
      },
      tracing: {
        jaegerEnabled: process.env.JAEGER_ENABLED === 'true',
        agentHost: process.env.JAEGER_AGENT_HOST || 'localhost',
        agentPort: parseInt(process.env.JAEGER_AGENT_PORT || '6832'),
        serviceName: process.env.JAEGER_SERVICE_NAME || 'fusion-backend'
      },
      errorTracking: {
        sentryDsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || this.config?.environment || 'development',
        sampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE || '1.0')
      }
    };
  }

  private loadBusinessConfig(): BusinessConfig {
    return {
      auction: {
        timeout: parseInt(process.env.AUCTION_TIMEOUT || '30000'),
        minBidIncrement: process.env.AUCTION_MIN_BID_INCREMENT || '1000000000000000',
        reserveTimeout: parseInt(process.env.AUCTION_RESERVE_TIMEOUT || '300000')
      },
      swap: {
        timeout: parseInt(process.env.SWAP_TIMEOUT || '300000'),
        retryAttempts: parseInt(process.env.SWAP_RETRY_ATTEMPTS || '3'),
        retryDelay: parseInt(process.env.SWAP_RETRY_DELAY || '5000')
      },
      risk: {
        enabled: process.env.RISK_MANAGEMENT_ENABLED !== 'false',
        maxSingleOrderSize: process.env.MAX_SINGLE_ORDER_SIZE || '5000000000000000000',
        maxDailyVolume: process.env.MAX_DAILY_VOLUME || '50000000000000000000',
        minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN || '0.005'),
        maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.03')
      },
      liquidity: {
        reserveRatio: parseFloat(process.env.LIQUIDITY_RESERVE_RATIO || '0.1'),
        rebalanceThreshold: parseFloat(process.env.REBALANCE_THRESHOLD || '0.2'),
        minThreshold: process.env.MIN_LIQUIDITY_THRESHOLD || '100000000000000000'
      }
    };
  }

  private loadOperationalConfig(): OperationalConfig {
    return {
      gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000'),
      processTitle: process.env.PROCESS_TITLE || 'fusion-backend',
      maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE || '1024'),
      memoryCheckInterval: parseInt(process.env.MEMORY_CHECK_INTERVAL || '60000'),
      circuitBreaker: {
        enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
        timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000'),
        resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '300000')
      },
      backup: {
        enabled: process.env.BACKUP_ENABLED === 'true',
        interval: parseInt(process.env.BACKUP_INTERVAL || '3600000'),
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
        s3Bucket: process.env.BACKUP_S3_BUCKET,
        s3Region: process.env.BACKUP_S3_REGION || 'us-east-1'
      }
    };
  }

  private loadFeatureFlags(): FeatureFlags {
    return {
      crossChainSwaps: process.env.FEATURE_CROSS_CHAIN_SWAPS !== 'false',
      auctionSystem: process.env.FEATURE_AUCTION_SYSTEM !== 'false',
      riskManagement: process.env.FEATURE_RISK_MANAGEMENT !== 'false',
      batchOperations: process.env.FEATURE_BATCH_OPERATIONS === 'true',
      flashLoans: process.env.FEATURE_FLASH_LOANS === 'true',
      mevProtection: process.env.FEATURE_MEV_PROTECTION === 'true',
      dynamicFees: process.env.FEATURE_DYNAMIC_FEES !== 'false',
      multiHopSwaps: process.env.FEATURE_MULTI_HOP_SWAPS === 'true',
      limitOrders: process.env.FEATURE_LIMIT_ORDERS !== 'false'
    };
  }

  private loadSecrets(): BackendConfig['secrets'] {
    return {
      ethRelayerPrivateKey: process.env.ETH_RELAYER_PRIVATE_KEY,
      ethResolverPrivateKey: process.env.ETH_RESOLVER_PRIVATE_KEY,
      btcRelayerPrivateKey: process.env.BTC_RELAYER_PRIVATE_KEY,
      btcResolverPrivateKey: process.env.BTC_RESOLVER_PRIVATE_KEY,
      relayerSecretKey: process.env.RELAYER_SECRET_KEY,
      resolverSecretKey: process.env.RESOLVER_SECRET_KEY,
      apiSecretKey: process.env.API_SECRET_KEY,
      sessionSecret: process.env.SESSION_SECRET,
      serviceToServiceSecret: process.env.SERVICE_TO_SERVICE_SECRET
    };
  }

  private validateConfiguration(): void {
    const errors: string[] = [];

    // Validate production requirements
    if (this.config.environment === 'production') {
      const requiredSecrets = [
        'ethRelayerPrivateKey',
        'ethResolverPrivateKey',
        'btcRelayerPrivateKey',
        'btcResolverPrivateKey',
        'apiSecretKey',
        'sessionSecret'
      ];

      requiredSecrets.forEach(secret => {
        if (!this.config.secrets[secret as keyof BackendConfig['secrets']]) {
          errors.push(`Missing required secret: ${secret}`);
        }
      });

      if (!this.config.database.password) {
        errors.push('Database password is required in production');
      }
    }

    // Validate RPC URLs
    if (!this.isValidUrl(this.config.ethereum.rpcUrl)) {
      errors.push('Invalid Ethereum RPC URL');
    }

    if (!this.isValidUrl(this.config.bitcoin.rpcUrl)) {
      errors.push('Invalid Bitcoin RPC URL');
    }

    // Validate ports
    if (this.config.services.relayer.port === this.config.services.resolver.port) {
      errors.push('Relayer and Resolver cannot use the same port');
    }

    if (errors.length > 0) {
      if (this.config.environment === 'production') {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
      } else {
        console.warn('Configuration validation warnings:');
        errors.forEach(error => console.warn(`  - ${error}`));
      }
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  public getConfig(): BackendConfig {
    return this.config;
  }

  public updateConfig(updates: Partial<BackendConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfiguration();
  }
}

// Create and export configuration instance
const configLoader = new ConfigLoader();
export const config = configLoader.getConfig();

// Configuration utilities
export function getServiceConfig(serviceName: 'relayer' | 'resolver') {
  return config.services[serviceName];
}

export function isDevelopment(): boolean {
  return config.environment === 'development';
}

export function isProduction(): boolean {
  return config.environment === 'production';
}

export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return config.features[feature];
}

export function getSecret(secretName: keyof BackendConfig['secrets']): string | undefined {
  return config.secrets[secretName];
}

export function validateServiceConfiguration(serviceName: string): void {
  const requiredFields: Record<string, string[]> = {
    relayer: [
      'services.relayer.port',
      'ethereum.rpcUrl',
      'bitcoin.rpcUrl'
    ],
    resolver: [
      'services.resolver.port',
      'ethereum.rpcUrl',
      'bitcoin.rpcUrl'
    ]
  };

  const fields = requiredFields[serviceName];
  if (!fields) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const missing = fields.filter(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config as any);
    return !value;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required configuration for ${serviceName}: ${missing.join(', ')}`);
  }
}

export default config;