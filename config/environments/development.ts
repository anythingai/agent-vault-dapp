export default {
  // Development-specific overrides
  ethereum: {
    network: 'hardhat',
    rpcUrl: 'http://localhost:8545',
    rpcUrls: ['http://localhost:8545'],
    chainId: 31337,
    confirmationsRequired: 1,
    gasPrice: {
      standard: '10000000000',  // 10 gwei
      fast: '20000000000',      // 20 gwei  
      rapid: '30000000000'      // 30 gwei
    },
    gasLimit: {
      escrowCreation: '300000',
      escrowRedeem: '150000',
      escrowRefund: '120000'
    }
  },
  
  bitcoin: {
    network: 'regtest',
    rpcUrl: 'http://localhost:18443',
    rpcHost: 'localhost',
    rpcPort: 18443,
    rpcUser: 'user',
    rpcPassword: 'password',
    confirmationsRequired: 1,
    feeRate: {
      standard: 1,   // sat/vB
      fast: 2,       // sat/vB
      rapid: 5       // sat/vB  
    }
  },
  
  services: {
    relayer: {
      port: 3001,
      host: 'localhost',
      enableCors: true,
      corsOrigins: ['http://localhost:3000'],
      rateLimitEnabled: false,
      maxConcurrentAuctions: 10,
      auctionTimeout: 30000
    },
    
    resolver: {
      port: 3002,
      host: 'localhost',
      maxConcurrentSwaps: 5,
      swapTimeout: 300000,
      secretRevealDelay: 5000,  // Shorter delay for development
      gracefulShutdownTimeout: 10000
    },
    
    frontend: {
      port: 3000,
      host: 'localhost',
      apiUrl: 'http://localhost:3001',
      buildMode: 'development'
    }
  },
  
  database: {
    type: 'sqlite',
    filename: './data/development.db',
    synchronize: true,
    logging: true,
    pool: {
      min: 1,
      max: 5,
      acquireTimeoutMs: 10000,
      idleTimeoutMs: 30000
    }
  },
  
  redis: {
    url: 'redis://localhost:6379',
    db: 1,
    ttl: 1800  // 30 minutes
  },
  
  security: {
    httpsEnabled: false,
    jwtExpiresIn: '24h',
    bcryptRounds: 8,  // Lower for faster development
    apiRateLimitEnabled: false,
    corsEnabled: true,
    helmetEnabled: false
  },
  
  monitoring: {
    healthCheckInterval: 60000,     // 1 minute
    metricsEnabled: true,
    prometheusEnabled: false,
    logFormat: 'text',
    logFile: './logs/development.log'
  },
  
  operational: {
    backupEnabled: false,
    circuitBreakerEnabled: false,
    maintenanceMode: false
  },
  
  development: {
    enableDebugEndpoints: true,
    mockBitcoinRpc: false,
    skipValidations: false,
    fastConfirmations: true
  }
};