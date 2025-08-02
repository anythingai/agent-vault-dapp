import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";

import { HardhatUserConfig } from "hardhat/config";
import { networks, deploymentConfigs, getGasConfig, validateNetworkConfig } from "./config/networks";

// Validate environment variables
function validateEnvironment() {
  const requiredForProduction = [
    'ETH_PRIVATE_KEY',
    'ETHERSCAN_API_KEY'
  ];
  
  const currentNetwork = process.env.HARDHAT_NETWORK || 'hardhat';
  
  if (currentNetwork === 'mainnet') {
    const missing = requiredForProduction.filter(env => !process.env[env]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables for mainnet: ${missing.join(', ')}`);
    }
  }
  
  // Validate current network configuration
  try {
    validateNetworkConfig(currentNetwork);
  } catch (error) {
    console.warn(`Network validation warning: ${(error as Error).message}`);
  }
}

// Validate environment on startup
validateEnvironment();

// Get current network for gas configuration
const currentNetwork = process.env.HARDHAT_NETWORK || 'hardhat';
const gasConfig = getGasConfig(currentNetwork);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      ...gasConfig,
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true,
      metadata: {
        // Do not include the metadata hash for deterministic bytecode
        bytecodeHash: process.env.NODE_ENV === 'production' ? 'none' : 'ipfs'
      },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode",
            "evm.deployedBytecode",
            "evm.methodIdentifiers",
            "metadata"
          ]
        }
      }
    }
  },

  networks: {
    // Configure all networks from our networks config
    ...Object.fromEntries(
      Object.entries(networks).map(([name, config]) => [
        name,
        {
          url: config.url,
          accounts: config.accounts,
          chainId: config.chainId,
          gas: config.gas,
          gasPrice: config.gasPrice,
          gasMultiplier: config.gasMultiplier,
          timeout: config.timeout,
          httpHeaders: config.httpHeaders,
          // Hardhat specific options
          saveDeployments: true,
          tags: [name === 'mainnet' ? 'production' : 'testnet']
        }
      ])
    )
  },

  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      goerli: process.env.ETHERSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
      arbitrumOne: process.env.ARBISCAN_API_KEY || '',
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || ''
    },
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api-sepolia.etherscan.io/api",
          browserURL: "https://sepolia.etherscan.io"
        }
      }
    ]
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },

  typechain: {
    outDir: "types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
    discriminateTypes: true
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    gasPrice: 20,
    outputFile: process.env.GAS_REPORTER_OUTPUT || undefined,
    noColors: process.env.CI === 'true',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: 'ETH',
    gasPriceApi: 'https://api.etherscan.io/api?module=proxy&action=eth_gasPrice',
    maxMethodDiff: 10,
    maxDeploymentDiff: 10,
    excludeContracts: ['Mock', 'Test']
  },

  mocha: {
    timeout: parseInt(process.env.TEST_TIMEOUT || '60000'),
    reporter: process.env.MOCHA_REPORTER || 'spec',
    reporterOptions: {
      output: process.env.MOCHA_REPORTER_OUTPUT
    }
  }
};

// Add network-specific configuration overrides
if (process.env.NODE_ENV === 'development' || currentNetwork === 'hardhat') {
  // Development-specific settings
  config.mocha!.timeout = 120000; // Longer timeout for development
  
  // Configure hardhat network properly (no url property allowed)
  config.networks!.hardhat = {
    chainId: 1337,
    forking: process.env.FORK_URL ? {
      url: process.env.FORK_URL,
      blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined,
      enabled: process.env.FORK_ENABLED === 'true'
    } : undefined,
    mining: {
      auto: process.env.HARDHAT_MINING_AUTO !== 'false',
      interval: process.env.HARDHAT_MINING_INTERVAL ? parseInt(process.env.HARDHAT_MINING_INTERVAL) : 0
    },
    accounts: {
      count: parseInt(process.env.HARDHAT_ACCOUNTS_COUNT || '20'),
      accountsBalance: process.env.HARDHAT_ACCOUNTS_BALANCE || '10000000000000000000000' // 10000 ETH
    }
  };
}

// Export task configuration
export const deploymentTasks = {
  'deploy:full': 'Deploy all contracts with full setup',
  'deploy:factory': 'Deploy only the EscrowFactory contract',
  'deploy:implementations': 'Deploy only the implementation contracts',
  'verify:all': 'Verify all deployed contracts',
  'setup:factory': 'Initialize factory with implementations',
  'upgrade:implementations': 'Upgrade implementation contracts'
};

// Add custom Hardhat tasks (commented out until tasks are implemented)
// import "./tasks/deploy";
// import "./tasks/verify";
// import "./tasks/upgrade";
// import "./tasks/utils";

export default config;