import { HardhatUserConfig } from 'hardhat/config';

export interface NetworkConfig {
  name: string;
  chainId: number;
  url: string;
  accounts: string[];
  gas?: number | 'auto';
  gasPrice?: number | 'auto';
  gasMultiplier?: number;
  timeout?: number;
  httpHeaders?: Record<string, string>;
  confirmations?: number;
  skipDryRun?: boolean;
  allowUnlimitedContractSize?: boolean;
}

export interface ContractDeploymentConfig {
  escrowFactory: {
    constructorArgs: any[];
    libraries?: Record<string, string>;
  };
  escrowImplementations: {
    constructorArgs: any[];
    libraries?: Record<string, string>;
  };
  verification?: {
    enabled: boolean;
    apiKey?: string;
    apiUrl?: string;
  };
}

// Network configurations
export const networks: Record<string, NetworkConfig> = {
  // Local development networks
  hardhat: {
    name: 'hardhat',
    chainId: 31337,
    url: 'http://localhost:8545',
    accounts: [],
    gas: 'auto',
    gasPrice: 'auto',
    allowUnlimitedContractSize: true,
    timeout: 60000,
    confirmations: 1
  },

  localhost: {
    name: 'localhost',
    chainId: 31337,
    url: 'http://localhost:8545',
    accounts: [],
    gas: 'auto',
    gasPrice: 'auto',
    timeout: 60000,
    confirmations: 1
  },

  // Ethereum Mainnet
  mainnet: {
    name: 'mainnet',
    chainId: 1,
    url: process.env.ETH_RPC_URL || `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: parseInt(process.env.ETH_GAS_LIMIT || '8000000'),
    gasPrice: parseInt(process.env.ETH_GAS_PRICE_STANDARD || '20000000000'), // 20 gwei
    gasMultiplier: parseFloat(process.env.ETH_GAS_PRICE_MULTIPLIER || '1.2'),
    timeout: parseInt(process.env.ETH_TIMEOUT || '300000'), // 5 minutes
    confirmations: parseInt(process.env.ETH_CONFIRMATIONS_REQUIRED || '3'),
    skipDryRun: false,
    httpHeaders: {
      'User-Agent': 'FusionCrossChain/1.0.0'
    }
  },

  // Ethereum Sepolia Testnet
  sepolia: {
    name: 'sepolia',
    chainId: 11155111,
    url: process.env.ETH_RPC_URL || 'https://rpc.sepolia.org',
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: parseInt(process.env.ETH_GAS_LIMIT || '6000000'),
    gasPrice: parseInt(process.env.ETH_GAS_PRICE_STANDARD || '20000000000'), // 20 gwei
    gasMultiplier: parseFloat(process.env.ETH_GAS_PRICE_MULTIPLIER || '1.2'),
    timeout: parseInt(process.env.ETH_TIMEOUT || '120000'), // 2 minutes
    confirmations: parseInt(process.env.ETH_CONFIRMATIONS_REQUIRED || '2'),
    skipDryRun: process.env.SKIP_DRY_RUN === 'true',
    httpHeaders: {
      'User-Agent': 'FusionCrossChain/1.0.0'
    }
  },

  // Ethereum Goerli Testnet (deprecated but kept for compatibility)
  goerli: {
    name: 'goerli',
    chainId: 5,
    url: process.env.ETH_RPC_URL || `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: parseInt(process.env.ETH_GAS_LIMIT || '6000000'),
    gasPrice: parseInt(process.env.ETH_GAS_PRICE_STANDARD || '20000000000'),
    timeout: 120000,
    confirmations: 2
  },

  // Polygon Mainnet
  polygon: {
    name: 'polygon',
    chainId: 137,
    url: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: 6000000,
    gasPrice: 30000000000, // 30 gwei
    timeout: 120000,
    confirmations: 3
  },

  // Arbitrum One
  arbitrum: {
    name: 'arbitrum',
    chainId: 42161,
    url: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: 'auto',
    gasPrice: 'auto',
    timeout: 120000,
    confirmations: 1
  },

  // Optimism
  optimism: {
    name: 'optimism',
    chainId: 10,
    url: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    accounts: process.env.ETH_PRIVATE_KEY ? [process.env.ETH_PRIVATE_KEY] : [],
    gas: 'auto',
    gasPrice: 'auto',
    timeout: 120000,
    confirmations: 1
  }
};

// Contract deployment configurations by network
export const deploymentConfigs: Record<string, ContractDeploymentConfig> = {
  hardhat: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: false
    }
  },

  localhost: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: false
    }
  },

  sepolia: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: true,
      apiKey: process.env.ETHERSCAN_API_KEY,
      apiUrl: 'https://api-sepolia.etherscan.io/api'
    }
  },

  mainnet: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: true,
      apiKey: process.env.ETHERSCAN_API_KEY,
      apiUrl: 'https://api.etherscan.io/api'
    }
  },

  polygon: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: true,
      apiKey: process.env.POLYGONSCAN_API_KEY,
      apiUrl: 'https://api.polygonscan.com/api'
    }
  },

  arbitrum: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: true,
      apiKey: process.env.ARBISCAN_API_KEY,
      apiUrl: 'https://api.arbiscan.io/api'
    }
  },

  optimism: {
    escrowFactory: {
      constructorArgs: []
    },
    escrowImplementations: {
      constructorArgs: []
    },
    verification: {
      enabled: true,
      apiKey: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
      apiUrl: 'https://api-optimistic.etherscan.io/api'
    }
  }
};

// Gas optimization settings by network
export const gasConfigs = {
  mainnet: {
    optimizer: {
      enabled: true,
      runs: 200,
      details: {
        yul: true,
        constantOptimizer: true,
        cse: true,
        deduplicate: true,
        inliner: true,
        jumpdestRemover: true,
        orderLiterals: true,
        peephole: true,
        simpleCounterForLoopUncheckedIncrement: true,
        yulDetails: {
          optimizerSteps: "dhfoDgvulfnTUtnIf[xa[r]EscLMcCTUtTOntnfDIulLculVcul[j]Tpeulxa[rul]xa[r]cLgvifCTUca[r]LSsTOtfDnca[r]Iulc]jmul[jul]VcTOculjmul"
        }
      }
    },
    viaIR: true
  },

  testnet: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    viaIR: false
  },

  development: {
    optimizer: {
      enabled: false,
      runs: 200
    },
    viaIR: false
  }
};

// Contract size limits by network
export const contractSizeLimits = {
  mainnet: 24576, // 24KB Ethereum limit
  testnet: 24576,
  development: undefined // No limit for development
};

// Network-specific feature flags
export const networkFeatures = {
  mainnet: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: true
  },
  
  sepolia: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: true
  },
  
  polygon: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: false // Disabled due to gas costs
  },
  
  arbitrum: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: true
  },
  
  optimism: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: true
  },
  
  development: {
    flashLoans: true,
    batchOperations: true,
    advancedOrdering: true
  }
};

// Get network configuration
export function getNetworkConfig(networkName: string): NetworkConfig {
  const config = networks[networkName];
  if (!config) {
    throw new Error(`Network configuration not found: ${networkName}`);
  }
  return config;
}

// Get deployment configuration
export function getDeploymentConfig(networkName: string): ContractDeploymentConfig {
  const config = deploymentConfigs[networkName];
  if (!config) {
    throw new Error(`Deployment configuration not found: ${networkName}`);
  }
  return config;
}

// Get gas configuration based on network type
export function getGasConfig(networkName: string) {
  if (networkName === 'hardhat' || networkName === 'localhost') {
    return gasConfigs.development;
  } else if (networkName === 'mainnet') {
    return gasConfigs.mainnet;
  } else {
    return gasConfigs.testnet;
  }
}

// Validate network configuration
export function validateNetworkConfig(networkName: string): void {
  const config = networks[networkName];
  if (!config) {
    throw new Error(`Network ${networkName} not configured`);
  }
  
  if (!config.url) {
    throw new Error(`RPC URL not configured for network ${networkName}`);
  }
  
  if (networkName !== 'hardhat' && networkName !== 'localhost' && (!config.accounts || config.accounts.length === 0)) {
    throw new Error(`No accounts configured for network ${networkName}`);
  }
  
  // Validate required environment variables for production networks
  if (networkName === 'mainnet' && !process.env.ETH_PRIVATE_KEY) {
    throw new Error('ETH_PRIVATE_KEY required for mainnet deployment');
  }
  
  if (config.chainId === 1 && !process.env.ETHERSCAN_API_KEY) {
    console.warn('ETHERSCAN_API_KEY not set - contract verification will be skipped');
  }
}

export default { networks, deploymentConfigs, gasConfigs, contractSizeLimits, networkFeatures };