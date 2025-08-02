export default {
  // Staging environment configuration
  ethereum: {
    network: 'sepolia',
    rpcUrl: process.env.ETH_RPC_URL || 'https://rpc.sepolia.org',
    rpcUrls: (process.env.ETH_RPC_URLS || 'https://rpc.sepolia.org').split(','),
    chainId: 11155111,
    confirmationsRequired: 2,
    gasPrice: {
      standard: process.env.ETH_GAS_PRICE_STANDARD || '20000000000',
      fast: process.env.ETH_GAS_PRICE_FAST || '50000000000',
      rapid: process.env.ETH_GAS_PRICE_RAPID || '100000000000'
    },
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
    network: 'testnet',
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
      maxConcurrentAuctions: parseInt(process.env.RELAYER_MAX_CONCURRENT_AUCTIONS || '25'),
      auctionTimeout: parseInt(process.env.RELAYER_AUCTION_TIMEOUT || '30000')
    },
    
    resolver: {
      port: parseInt(process.env.RESOLVER_PORT || '3002'),
      host: process.env.RESOLVER_HOST || '0.0.0.0',
      maxConcurrentSwaps: parseInt(process.env.RESOLVER_MAX_CONCURRENT_SWAPS || '8'),
      swapTimeout: parseInt(process.env.RESOLVER_SWAP_TIMEOUT || '300000'),
      secretRevealDelay: parseInt(process.env.RESOLVER_SECRET_REVEAL_DELAY || '60000'),
      gracefulShutdownTimeout: parseInt(process.env.RESOLVER_GRACEFUL_SHUTDOWN_TIMEOUT || '30000')
    },
    
    frontend: {
      port: parseInt(process.env.FRONTEND_PORT || '3000'),
      host: process.env.FRONTEND_HOST || '0.0.0.0',
      apiUrl: process.env.FRONTEND_API_URL || 'https://api-staging.example.com',
      buildMode: process.env.FRONTEND_BUILD_MODE || 'production'
    }
  },
  
  database: {
    type: process.env.DB_TYPE || 'postgresql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'fusion_cross_chain_staging',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL_MODE === 'require',
    synchronize: false,
    logging: ['error', 'warn'],
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '2'),
      max: parseInt(process.env.DB_POOL_MAX || '15'),
      acquireTimeoutMs: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '30000'),
      idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000')
    }
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    ttl: parseInt(process.env.REDIS_TTL || '3600')
  },
  
  security: {
    httpsEnabled: process.env.HTTPS_ENABLED === 'true',
    tlsCertPath: process.env.TLS_CERT_PATH,
    tlsKeyPath: process.env.TLS_KEY_PATH,
    tlsCaPath: process.env.TLS_CA_PATH,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    apiRateLimitEnabled: process.env.API_RATE_LIMIT_ENABLED === 'true',
    corsEnabled: process.env.API_CORS_ENABLED === 'true',
    helmetEnabled: process.env.API_HELMET_ENABLED === 'true'
  },
  
  monitoring: {
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    metricsEnabled: process.env.METRICS_ENABLED === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
    prometheusEnabled: process.env.PROMETHEUS_ENABLED === 'true',
    logFormat: process.env.LOG_FORMAT || 'json',
    logFile: process.env.LOG_FILE_PATH || './logs/staging.log',
    logMaxSize: process.env.LOG_MAX_SIZE || '100m',
    logMaxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
    sentryDsn: process.env.SENTRY_DSN,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || 'staging'
  },
  
  operational: {
    backupEnabled: process.env.BACKUP_ENABLED === 'true',
    backupInterval: parseInt(process.env.BACKUP_INTERVAL || '3600000'),
    backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
    backupS3Bucket: process.env.BACKUP_S3_BUCKET,
    backupS3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED === 'true',
    circuitBreakerFailureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
    circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000'),
    circuitBreakerResetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '300000'),
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
    maintenanceMessage: process.env.MAINTENANCE_MESSAGE || 'System is under maintenance'
  },
  
  external: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
      apiUrl: process.env.ETHERSCAN_API_URL || 'https://api-sepolia.etherscan.io/api'
    },
    alchemy: {
      apiKey: process.env.ALCHEMY_API_KEY
    },
    infura: {
      projectId: process.env.INFURA_PROJECT_ID,
      projectSecret: process.env.INFURA_PROJECT_SECRET
    },
    quicknode: {
      endpoint: process.env.QUICKNODE_ENDPOINT
    }
  }
};