export default {
  // Production environment configuration
  ethereum: {
    network: 'mainnet',
    rpcUrl: process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/' + process.env.INFURA_PROJECT_ID,
    rpcUrls: (process.env.ETH_RPC_URLS || '').split(',').filter(Boolean),
    chainId: 1,
    confirmationsRequired: parseInt(process.env.ETH_CONFIRMATIONS_REQUIRED || '3'),
    gasPrice: {
      standard: process.env.ETH_GAS_PRICE_STANDARD || '20000000000',
      fast: process.env.ETH_GAS_PRICE_FAST || '50000000000',
      rapid: process.env.ETH_GAS_PRICE_RAPID || '100000000000'
    },
    gasPriceMultiplier: parseFloat(process.env.ETH_GAS_PRICE_MULTIPLIER || '1.2'),
    gasLimit: {
      escrowCreation: process.env.ETH_GAS_LIMIT_ESCROW_CREATION || '300000',
      escrowRedeem: process.env.ETH_GAS_LIMIT_ESCROW_REDEEM || '150000',
      escrowRefund: process.env.ETH_GAS_LIMIT_ESCROW_REFUND || '120000'
    },
    contracts: {
      escrowFactory: process.env.ESCROW_FACTORY_ADDRESS,
      escrowSrcImplementation: process.env.ESCROW_SRC_IMPLEMENTATION_ADDRESS,
      escrowDstImplementation: process.env.ESCROW_DST_IMPLEMENTATION_ADDRESS,
      limitOrderProtocol: process.env.LIMIT_ORDER_PROTOCOL_ADDRESS
    }
  },
  
  bitcoin: {
    network: 'mainnet',
    rpcUrl: process.env.BTC_RPC_URL,
    rpcHost: process.env.BTC_RPC_HOST,
    rpcPort: parseInt(process.env.BTC_RPC_PORT || '8332'),
    rpcUser: process.env.BTC_RPC_USER,
    rpcPassword: process.env.BTC_RPC_PASSWORD,
    confirmationsRequired: parseInt(process.env.BTC_CONFIRMATIONS_REQUIRED || '6'),
    feeRate: {
      standard: parseInt(process.env.BTC_FEE_RATE_STANDARD || '20'),
      fast: parseInt(process.env.BTC_FEE_RATE_FAST || '40'),
      rapid: parseInt(process.env.BTC_FEE_RATE_RAPID || '80')
    }
  },
  
  services: {
    relayer: {
      port: parseInt(process.env.RELAYER_PORT || '3001'),
      host: process.env.RELAYER_HOST || '0.0.0.0',
      enableCors: process.env.RELAYER_ENABLE_CORS === 'true',
      corsOrigins: (process.env.RELAYER_CORS_ORIGINS || '').split(',').filter(Boolean),
      rateLimitEnabled: true,
      rateLimitWindowMs: parseInt(process.env.RELAYER_RATE_LIMIT_WINDOW_MS || '900000'),
      rateLimitMaxRequests: parseInt(process.env.RELAYER_RATE_LIMIT_MAX_REQUESTS || '100'),
      maxConcurrentAuctions: parseInt(process.env.RELAYER_MAX_CONCURRENT_AUCTIONS || '50'),
      auctionTimeout: parseInt(process.env.RELAYER_AUCTION_TIMEOUT || '30000')
    },
    
    resolver: {
      port: parseInt(process.env.RESOLVER_PORT || '3002'),
      host: process.env.RESOLVER_HOST || '0.0.0.0',
      maxConcurrentSwaps: parseInt(process.env.RESOLVER_MAX_CONCURRENT_SWAPS || '10'),
      swapTimeout: parseInt(process.env.RESOLVER_SWAP_TIMEOUT || '300000'),
      secretRevealDelay: parseInt(process.env.RESOLVER_SECRET_REVEAL_DELAY || '60000'),
      gracefulShutdownTimeout: parseInt(process.env.RESOLVER_GRACEFUL_SHUTDOWN_TIMEOUT || '30000')
    },
    
    frontend: {
      port: parseInt(process.env.FRONTEND_PORT || '3000'),
      host: process.env.FRONTEND_HOST || '0.0.0.0',
      apiUrl: process.env.FRONTEND_API_URL,
      buildMode: process.env.FRONTEND_BUILD_MODE || 'production'
    }
  },
  
  database: {
    type: process.env.DB_TYPE || 'postgresql',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL_MODE === 'require' ? { rejectUnauthorized: false } : false,
    synchronize: false,  // Never true in production
    logging: ['error'],  // Minimal logging in production
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '5'),
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      acquireTimeoutMs: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '30000'),
      idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000')
    }
  },
  
  redis: {
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    ttl: parseInt(process.env.REDIS_TTL || '3600'),
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3
  },
  
  security: {
    httpsEnabled: process.env.HTTPS_ENABLED === 'true',
    tlsCertPath: process.env.TLS_CERT_PATH,
    tlsKeyPath: process.env.TLS_KEY_PATH,
    tlsCaPath: process.env.TLS_CA_PATH,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-Key',
    apiRateLimitEnabled: process.env.API_RATE_LIMIT_ENABLED !== 'false',
    corsEnabled: process.env.API_CORS_ENABLED === 'true',
    helmetEnabled: process.env.API_HELMET_ENABLED !== 'false',
    trustedProxies: process.env.TRUSTED_PROXIES?.split(',') || [],
    secureHeaders: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  },
  
  monitoring: {
    healthCheckEnabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
    metricsPath: process.env.METRICS_PATH || '/metrics',
    prometheusEnabled: process.env.PROMETHEUS_ENABLED === 'true',
    logFormat: process.env.LOG_FORMAT || 'json',
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE_PATH || './logs/production.log',
    logMaxSize: process.env.LOG_MAX_SIZE || '100m',
    logMaxFiles: parseInt(process.env.LOG_MAX_FILES || '10'),
    logCompress: process.env.LOG_COMPRESS === 'true',
    sentryDsn: process.env.SENTRY_DSN,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || 'production',
    sentryTracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1')
  },
  
  operational: {
    backupEnabled: process.env.BACKUP_ENABLED === 'true',
    backupInterval: parseInt(process.env.BACKUP_INTERVAL || '3600000'),
    backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '90'),
    backupS3Bucket: process.env.BACKUP_S3_BUCKET,
    backupS3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    circuitBreakerFailureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
    circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000'),
    circuitBreakerResetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '300000'),
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
    maintenanceMessage: process.env.MAINTENANCE_MESSAGE || 'System is under maintenance',
    gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000'),
    processTitle: process.env.PROCESS_TITLE || 'fusion-cross-chain'
  },
  
  performance: {
    maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE || '2048'),
    memoryMonitoringEnabled: process.env.MEMORY_MONITORING_ENABLED === 'true',
    httpTimeout: parseInt(process.env.HTTP_TIMEOUT || '30000'),
    rpcTimeout: parseInt(process.env.RPC_TIMEOUT || '10000'),
    dbQueryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000'),
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '100'),
    maxConcurrentRpcCalls: parseInt(process.env.MAX_CONCURRENT_RPC_CALLS || '50'),
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '1000'),
    compressionEnabled: true,
    keepAliveTimeout: 5000,
    headersTimeout: 60000
  },
  
  external: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
      apiUrl: process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/api',
      rateLimitPerSecond: 5
    },
    alchemy: {
      apiKey: process.env.ALCHEMY_API_KEY,
      webhook: {
        id: process.env.ALCHEMY_WEBHOOK_ID,
        signingKey: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
      }
    },
    infura: {
      projectId: process.env.INFURA_PROJECT_ID,
      projectSecret: process.env.INFURA_PROJECT_SECRET
    },
    quicknode: {
      endpoint: process.env.QUICKNODE_ENDPOINT,
      apiKey: process.env.QUICKNODE_API_KEY
    },
    chainlink: {
      apiKey: process.env.CHAINLINK_API_KEY
    },
    coingecko: {
      apiKey: process.env.COINGECKO_API_KEY,
      rateLimitPerMinute: 10
    },
    binance: {
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET
    }
  },
  
  alerts: {
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || '#alerts',
      username: process.env.SLACK_USERNAME || 'FusionBot'
    },
    pagerduty: {
      integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY
    },
    email: {
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      },
      from: process.env.EMAIL_FROM || 'alerts@fusion-cross-chain.com',
      to: process.env.ALERT_EMAIL_RECIPIENTS?.split(',') || []
    }
  }
};