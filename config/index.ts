import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

// Type definitions for configuration
export type Environment = 'development' | 'staging' | 'production';
export type EthereumNetwork = 'mainnet' | 'sepolia' | 'hardhat' | 'localhost';
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface BaseConfig {
  // Environment settings
  nodeEnv: Environment;
  logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  appName: string;
  appVersion: string;
  
  // Security settings
  secrets: {
    ethPrivateKey?: string;
    ethRelayerPrivateKey?: string; 
    ethResolverPrivateKey?: string;
    btcPrivateKey?: string;
    btcResolverPrivateKey?: string;
    relayerSecretKey?: string;
    resolverSecretKey?: string;
    apiSecretKey?: string;
    jwtSecret?: string;
    sessionSecret?: string;
  };
  
  // Feature flags
  features: {
    crossChainSwaps: boolean;
    auctionSystem: boolean;
    riskManagement: boolean;
    advancedMonitoring: boolean;
    batchOperations: boolean;
    flashLoans: boolean;
  };
  
  // Operational settings
  operational: {
    healthCheckEnabled: boolean;
    healthCheckInterval: number;
    healthCheckTimeout: number;
    metricsEnabled: boolean;
    metricsPort: number;
    maintenanceMode: boolean;
    circuitBreakerEnabled: boolean;
  };
  
  // Performance settings
  performance: {
    maxMemoryUsage: number;
    httpTimeout: number;
    rpcTimeout: number;
    dbQueryTimeout: number;
    maxConcurrentRequests: number;
    maxConcurrentRpcCalls: number;
    maxQueueSize: number;
  };
}

// Load and validate base configuration
function loadBaseConfig(): BaseConfig {
  return {
    nodeEnv: (process.env.NODE_ENV || 'development') as Environment,
    logLevel: (process.env.LOG_LEVEL || 'info') as BaseConfig['logLevel'],
    appName: process.env.APP_NAME || '1inch-fusion-cross-chain',
    appVersion: process.env.APP_VERSION || '1.0.0',
    
    secrets: {
      ethPrivateKey: process.env.ETH_PRIVATE_KEY,
      ethRelayerPrivateKey: process.env.ETH_RELAYER_PRIVATE_KEY,
      ethResolverPrivateKey: process.env.ETH_RESOLVER_PRIVATE_KEY,
      btcPrivateKey: process.env.BTC_PRIVATE_KEY,
      btcResolverPrivateKey: process.env.BTC_RESOLVER_PRIVATE_KEY,
      relayerSecretKey: process.env.RELAYER_SECRET_KEY,
      resolverSecretKey: process.env.RESOLVER_SECRET_KEY,
      apiSecretKey: process.env.API_SECRET_KEY,
      jwtSecret: process.env.JWT_SECRET,
      sessionSecret: process.env.SESSION_SECRET,
    },
    
    features: {
      crossChainSwaps: process.env.FEATURE_CROSS_CHAIN_SWAPS !== 'false',
      auctionSystem: process.env.FEATURE_AUCTION_SYSTEM !== 'false',
      riskManagement: process.env.FEATURE_RISK_MANAGEMENT !== 'false',
      advancedMonitoring: process.env.FEATURE_ADVANCED_MONITORING !== 'false',
      batchOperations: process.env.FEATURE_BATCH_OPERATIONS === 'true',
      flashLoans: process.env.FEATURE_FLASH_LOANS === 'true',
    },
    
    operational: {
      healthCheckEnabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
      healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
      metricsEnabled: process.env.METRICS_ENABLED !== 'false',
      metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
      maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
      circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    },
    
    performance: {
      maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE || '1024'),
      httpTimeout: parseInt(process.env.HTTP_TIMEOUT || '30000'),
      rpcTimeout: parseInt(process.env.RPC_TIMEOUT || '10000'),
      dbQueryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000'),
      maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '100'),
      maxConcurrentRpcCalls: parseInt(process.env.MAX_CONCURRENT_RPC_CALLS || '50'),
      maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '1000'),
    },
  };
}

// Environment-specific configuration loading
function loadEnvironmentConfig(environment: string): any {
  try {
    const configModule = require(`./environments/${environment}`);
    return configModule.default || configModule;
  } catch (error) {
    console.warn(`Could not load environment config for ${environment}, using defaults`);
    return {};
  }
}

// Validation functions
export function validateRequiredSecrets(config: any, requiredSecrets: string[]): void {
  const missingSecrets = requiredSecrets.filter(secret => {
    const secretValue = getNestedProperty(config, secret);
    return !secretValue || secretValue === '';
  });
  
  if (missingSecrets.length > 0) {
    throw new Error(`Missing required secrets: ${missingSecrets.join(', ')}`);
  }
}

export function validateNetworkConsistency(config: any): void {
  // Validate Ethereum network consistency
  if (config.ethereum?.network && config.ethereum?.chainId) {
    const networkChainMap: Record<string, number> = {
      mainnet: 1,
      sepolia: 11155111,
      hardhat: 31337,
      localhost: 31337,
    };
    
    const expectedChainId = networkChainMap[config.ethereum.network];
    if (expectedChainId && config.ethereum.chainId !== expectedChainId) {
      throw new Error(`Ethereum network ${config.ethereum.network} should use chain ID ${expectedChainId}, got ${config.ethereum.chainId}`);
    }
  }
  
  // Validate Bitcoin network consistency
  if (config.bitcoin?.network && config.bitcoin?.rpcPort) {
    const networkPortMap: Record<string, number> = {
      mainnet: 8332,
      testnet: 18332,
      regtest: 18443,
    };
    
    const expectedPort = networkPortMap[config.bitcoin.network];
    if (expectedPort && config.bitcoin.rpcPort !== expectedPort) {
      console.warn(`Bitcoin network ${config.bitcoin.network} typically uses port ${expectedPort}, got ${config.bitcoin.rpcPort}`);
    }
  }
}

export function validateEnvironmentVariables(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check required environment variables based on NODE_ENV
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (nodeEnv === 'production') {
    const requiredProductionVars = [
      'ETH_PRIVATE_KEY',
      'BTC_PRIVATE_KEY',
      'JWT_SECRET',
      'SESSION_SECRET',
      'API_SECRET_KEY',
      'DB_HOST',
      'DB_USERNAME',
      'DB_PASSWORD',
    ];
    
    requiredProductionVars.forEach(varName => {
      if (!process.env[varName]) {
        errors.push(`Missing required production environment variable: ${varName}`);
      }
    });
  }
  
  // Validate RPC URLs format
  const rpcUrls = ['ETH_RPC_URL', 'BTC_RPC_URL'];
  rpcUrls.forEach(urlVar => {
    const url = process.env[urlVar];
    if (url && !isValidUrl(url)) {
      errors.push(`Invalid URL format for ${urlVar}: ${url}`);
    }
  });
  
  // Validate numeric values
  const numericVars = [
    'ETH_CHAIN_ID',
    'ETH_CONFIRMATIONS_REQUIRED',
    'BTC_CONFIRMATIONS_REQUIRED',
    'RELAYER_PORT',
    'RESOLVER_PORT',
    'FRONTEND_PORT',
  ];
  
  numericVars.forEach(varName => {
    const value = process.env[varName];
    if (value && isNaN(Number(value))) {
      errors.push(`${varName} must be a valid number, got: ${value}`);
    }
  });
  
  // Validate private keys format (basic check)
  const privateKeys = ['ETH_PRIVATE_KEY', 'ETH_RELAYER_PRIVATE_KEY', 'ETH_RESOLVER_PRIVATE_KEY'];
  privateKeys.forEach(keyVar => {
    const key = process.env[keyVar];
    if (key && !isValidEthPrivateKey(key)) {
      errors.push(`${keyVar} must be a valid Ethereum private key format`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Utility functions
function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function isValidEthPrivateKey(key: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(key);
}

// Deep merge utility function
function mergeDeep(target: any, source: any): any {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = mergeDeep(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// Configuration loader with error handling
export function loadConfiguration() {
  try {
    // Validate environment variables first
    const envValidation = validateEnvironmentVariables();
    if (!envValidation.isValid) {
      console.error('Environment validation failed:');
      envValidation.errors.forEach(error => console.error(`  - ${error}`));
      
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Configuration validation failed in production');
      } else {
        console.warn('Configuration validation failed, continuing with warnings in development');
      }
    }
    
    // Load base configuration
    const baseConfig = loadBaseConfig();
    
    // Load environment-specific overrides
    const envConfig = loadEnvironmentConfig(baseConfig.nodeEnv);
    
    // Merge configurations
    const fullConfig = mergeDeep(baseConfig, envConfig);
    
    // Validate network consistency
    try {
      validateNetworkConsistency(fullConfig);
    } catch (error) {
      console.warn('Network consistency validation warning:', error.message);
    }
    
    console.log(`✅ Configuration loaded successfully for environment: ${baseConfig.nodeEnv}`);
    
    return fullConfig;
    
  } catch (error) {
    console.error('❌ Failed to load configuration:', error);
    
    // In development, return a minimal working config
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️  Using fallback development configuration');
      return getDefaultDevelopmentConfig();
    }
    
    throw error;
  }
}

// Fallback development configuration
function getDefaultDevelopmentConfig() {
  return {
    nodeEnv: 'development' as Environment,
    logLevel: 'info' as const,
    appName: '1inch-fusion-cross-chain',
    appVersion: '1.0.0',
    
    secrets: {},
    features: {
      crossChainSwaps: true,
      auctionSystem: true,
      riskManagement: true,
      advancedMonitoring: true,
      batchOperations: false,
      flashLoans: false,
    },
    
    operational: {
      healthCheckEnabled: true,
      healthCheckInterval: 30000,
      healthCheckTimeout: 5000,
      metricsEnabled: true,
      metricsPort: 9090,
      maintenanceMode: false,
      circuitBreakerEnabled: false,
    },
    
    performance: {
      maxMemoryUsage: 1024,
      httpTimeout: 30000,
      rpcTimeout: 10000,
      dbQueryTimeout: 5000,
      maxConcurrentRequests: 100,
      maxConcurrentRpcCalls: 50,
      maxQueueSize: 1000,
    },
    
    // Default development services configuration
    services: {
      relayer: { port: 3001, host: 'localhost' },
      resolver: { port: 3002, host: 'localhost' },
      frontend: { port: 3000, host: 'localhost' }
    },
    
    // Default network configuration
    ethereum: {
      network: 'hardhat',
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      confirmationsRequired: 1
    },
    
    bitcoin: {
      network: 'regtest',
      rpcUrl: 'http://localhost:18443',
      confirmationsRequired: 1
    }
  };
}

// Configuration validation for services
export function validateServiceConfig(config: any, serviceName: string): void {
  const requiredFields: Record<string, string[]> = {
    relayer: ['services.relayer.port'],
    resolver: ['services.resolver.port'],
    frontend: ['services.frontend.port'],
    contracts: ['ethereum.network', 'ethereum.rpcUrl']
  };
  
  const required = requiredFields[serviceName];
  if (required) {
    validateRequiredSecrets(config, required);
  }
}

// Export the configuration
let config: any;

try {
  config = loadConfiguration();
} catch (error) {
  console.error('Critical configuration error:', error);
  process.exit(1);
}

export { config };
export default config;