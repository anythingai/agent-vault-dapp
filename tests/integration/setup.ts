/**
 * Integration Testing Setup
 * Manages cross-chain testing environment with both Ethereum (Hardhat) and Bitcoin (regtest)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { ethers } from 'ethers';
import { BitcoinClient } from '../../backend/src/bitcoin/client.js';
import { regtestManager, RegtestSetup } from '../bitcoin/setup.js';
import { testConfig } from '../config.js';

export interface HardhatSetup {
  provider: ethers.JsonRpcProvider;
  accounts: ethers.Wallet[];
  contracts: {
    escrowFactory?: ethers.Contract;
    escrowSrc?: ethers.Contract;
    escrowDst?: ethers.Contract;
    mockERC20?: ethers.Contract;
  };
  cleanup: () => Promise<void>;
}

export interface CrossChainTestSetup {
  bitcoin: RegtestSetup;
  ethereum: HardhatSetup;
  cleanup: () => Promise<void>;
}

/**
 * Integration Test Environment Manager
 * Coordinates both Bitcoin regtest and Ethereum Hardhat networks
 */
export class IntegrationTestManager {
  private static instance: IntegrationTestManager;
  private currentSetup?: CrossChainTestSetup;
  private hardhatProcess?: ChildProcess;

  private constructor() {}

  static getInstance(): IntegrationTestManager {
    if (!IntegrationTestManager.instance) {
      IntegrationTestManager.instance = new IntegrationTestManager();
    }
    return IntegrationTestManager.instance;
  }

  /**
   * Start complete cross-chain testing environment
   */
  async startCrossChainEnvironment(): Promise<CrossChainTestSetup> {
    if (this.currentSetup) {
      console.log('Cross-chain environment already running');
      return this.currentSetup;
    }

    console.log('Starting cross-chain integration test environment...');

    // Start Bitcoin regtest
    const bitcoin = await regtestManager.startRegtestNode();
    console.log('✓ Bitcoin regtest node started');

    // Start Ethereum Hardhat network
    const ethereum = await this.startHardhatNetwork();
    console.log('✓ Ethereum Hardhat network started');

    // Deploy contracts
    await this.deployContracts(ethereum);
    console.log('✓ Smart contracts deployed');

    const setup: CrossChainTestSetup = {
      bitcoin,
      ethereum,
      cleanup: async () => await this.cleanup()
    };

    this.currentSetup = setup;
    return setup;
  }

  /**
   * Start Hardhat network programmatically
   */
  private async startHardhatNetwork(): Promise<HardhatSetup> {
    // Check if Hardhat is already running
    try {
      const response = await axios.post(testConfig.ethereum.rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'net_version',
        params: []
      });
      
      if (response.status === 200) {
        console.log('Hardhat network already running, connecting...');
        return await this.connectToHardhat();
      }
    } catch (error) {
      // Network not running, start it
    }

    // Start Hardhat network
    const contractsDir = path.join(process.cwd(), 'contracts');
    
    this.hardhatProcess = spawn('npx', ['hardhat', 'node', '--hostname', '127.0.0.1'], {
      cwd: contractsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    // Wait for network to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Hardhat network startup timeout'));
      }, 30000);

      this.hardhatProcess?.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('Hardhat:', output);
        
        if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.hardhatProcess?.stderr?.on('data', (data: Buffer) => {
        console.error('Hardhat Error:', data.toString());
      });

      this.hardhatProcess?.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Wait additional time for full initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    return await this.connectToHardhat();
  }

  /**
   * Connect to existing Hardhat network
   */
  private async connectToHardhat(): Promise<HardhatSetup> {
    const provider = new ethers.JsonRpcProvider(testConfig.ethereum.rpcUrl);
    
    // Create test accounts
    const accounts = testConfig.ethereum.accounts.map(privateKey => 
      new ethers.Wallet(privateKey, provider)
    );

    // Verify connection
    const network = await provider.getNetwork();
    console.log(`Connected to Ethereum network: ${network.name} (chainId: ${network.chainId})`);

    const setup: HardhatSetup = {
      provider,
      accounts,
      contracts: {},
      cleanup: async () => {
        if (this.hardhatProcess) {
          this.hardhatProcess.kill('SIGTERM');
          this.hardhatProcess = undefined;
        }
      }
    };

    return setup;
  }

  /**
   * Deploy smart contracts to Hardhat network
   */
  private async deployContracts(ethereum: HardhatSetup): Promise<void> {
    const { provider, accounts } = ethereum;
    const deployer = accounts[0];

    try {
      // Read contract artifacts
      const contractsDir = path.join(process.cwd(), 'contracts');
      
      // Deploy MockERC20 for testing
      const mockERC20Artifact = JSON.parse(
        await fs.readFile(
          path.join(contractsDir, 'artifacts', 'contracts', 'mocks', 'MockERC20.sol', 'MockERC20.json'),
          'utf8'
        )
      );

      const MockERC20 = new ethers.ContractFactory(
        mockERC20Artifact.abi,
        mockERC20Artifact.bytecode,
        deployer
      );

      const mockERC20 = await MockERC20.deploy(
        'Test Token',
        'TEST',
        ethers.parseEther('1000000') // 1M tokens
      );
      await mockERC20.waitForDeployment();

      console.log(`MockERC20 deployed at: ${await mockERC20.getAddress()}`);

      // Deploy EscrowFactory
      const escrowFactoryArtifact = JSON.parse(
        await fs.readFile(
          path.join(contractsDir, 'artifacts', 'contracts', 'EscrowFactory.sol', 'EscrowFactory.json'),
          'utf8'
        )
      );

      const EscrowFactory = new ethers.ContractFactory(
        escrowFactoryArtifact.abi,
        escrowFactoryArtifact.bytecode,
        deployer
      );

      const escrowFactory = await EscrowFactory.deploy();
      await escrowFactory.waitForDeployment();

      console.log(`EscrowFactory deployed at: ${await escrowFactory.getAddress()}`);

      // Store deployed contracts
      ethereum.contracts = {
        escrowFactory,
        mockERC20
      };

    } catch (error) {
      console.warn('Contract deployment failed (continuing without contracts):', error);
      // Continue without contracts for basic Bitcoin testing
    }
  }

  /**
   * Get current setup
   */
  getCurrentSetup(): CrossChainTestSetup | undefined {
    return this.currentSetup;
  }

  /**
   * Clean up all resources
   */
  private async cleanup(): Promise<void> {
    if (this.currentSetup) {
      // Cleanup Bitcoin
      await this.currentSetup.bitcoin.cleanup();
      
      // Cleanup Ethereum
      await this.currentSetup.ethereum.cleanup();
      
      this.currentSetup = undefined;
    }

    console.log('Cross-chain environment cleaned up');
  }

  /**
   * Stop cross-chain environment
   */
  async stopCrossChainEnvironment(): Promise<void> {
    await this.cleanup();
  }
}

/**
 * Cross-chain test utilities
 */
export class CrossChainTestUtils {
  /**
   * Create test swap order
   */
  static createTestSwapOrder(
    maker: string,
    makerAsset: { chainId: number; token: string; amount: string },
    takerAsset: { chainId: number; token: string; amount: string },
    secretHash: string,
    timelock: number
  ) {
    return {
      orderId: `test-order-${Date.now()}`,
      maker,
      makerAsset,
      takerAsset,
      secretHash,
      timelock,
      signature: '0x' + '0'.repeat(130), // Mock signature
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    };
  }

  /**
   * Wait for cross-chain confirmation
   */
  static async waitForCrossChainConfirmation(
    setup: CrossChainTestSetup,
    bitcoinTxId: string,
    ethereumTxHash: string,
    timeoutMs: number = 60000
  ): Promise<{ bitcoinConfirmed: boolean; ethereumConfirmed: boolean }> {
    const startTime = Date.now();
    
    let bitcoinConfirmed = false;
    let ethereumConfirmed = false;

    while (Date.now() - startTime < timeoutMs && (!bitcoinConfirmed || !ethereumConfirmed)) {
      // Check Bitcoin confirmation
      if (!bitcoinConfirmed) {
        try {
          const btcTx = await setup.bitcoin.client.getTransaction(bitcoinTxId);
          if (btcTx.confirmations >= 1) {
            bitcoinConfirmed = true;
            console.log(`✓ Bitcoin transaction confirmed: ${bitcoinTxId}`);
          }
        } catch (error) {
          // Transaction not found yet
        }
      }

      // Check Ethereum confirmation
      if (!ethereumConfirmed) {
        try {
          const ethTx = await setup.ethereum.provider.getTransactionReceipt(ethereumTxHash);
          if (ethTx && ethTx.blockNumber) {
            ethereumConfirmed = true;
            console.log(`✓ Ethereum transaction confirmed: ${ethereumTxHash}`);
          }
        } catch (error) {
          // Transaction not found yet
        }
      }

      if (!bitcoinConfirmed || !ethereumConfirmed) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return { bitcoinConfirmed, ethereumConfirmed };
  }

  /**
   * Fund test accounts on both chains
   */
  static async fundTestAccounts(setup: CrossChainTestSetup): Promise<void> {
    // Fund Bitcoin accounts (already done in Bitcoin setup)
    console.log('Bitcoin test accounts already funded');

    // Fund Ethereum accounts with ETH and test tokens
    const { accounts, contracts } = setup.ethereum;
    
    if (contracts.mockERC20) {
      // Transfer test tokens to accounts
      for (let i = 1; i < accounts.length; i++) {
        const transferTx = await contracts.mockERC20.transfer(
          accounts[i].address,
          ethers.parseEther('10000') // 10K test tokens
        );
        await transferTx.wait();
        console.log(`✓ Funded ${accounts[i].address} with test tokens`);
      }
    }

    console.log('Test accounts funded on both chains');
  }

  /**
   * Generate cross-chain test data
   */
  static generateCrossChainTestData() {
    const secrets = [];
    const keyPairs = [];

    // Generate deterministic test data
    for (let i = 0; i < 5; i++) {
      const secret = require('crypto').randomBytes(32);
      const hash = require('crypto').createHash('sha256').update(secret).digest();
      secrets.push({ secret, hash });

      // Generate key pairs for different purposes
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      keyPairs.push(ECPair.makeRandom());
    }

    return {
      secrets,
      keyPairs,
      amounts: {
        small: { btc: 10000, eth: ethers.parseEther('0.01') },
        medium: { btc: 100000, eth: ethers.parseEther('0.1') },
        large: { btc: 1000000, eth: ethers.parseEther('1.0') }
      },
      timelocks: {
        short: 10,
        medium: 50,
        long: 144
      }
    };
  }

  /**
   * Monitor cross-chain swap progress
   */
  static async monitorSwapProgress(
    setup: CrossChainTestSetup,
    orderId: string,
    secretHash: Buffer,
    onUpdate?: (status: string, data: any) => void
  ): Promise<{
    bitcoinFunded: boolean;
    ethereumFunded: boolean;
    secretRevealed: boolean;
    completed: boolean;
  }> {
    const status = {
      bitcoinFunded: false,
      ethereumFunded: false,
      secretRevealed: false,
      completed: false
    };

    // This would integrate with actual relayer/resolver services
    // For now, we'll simulate monitoring
    console.log(`Monitoring swap progress for order: ${orderId}`);
    
    onUpdate?.('monitoring_started', { orderId });

    return status;
  }

  /**
   * Simulate network delays and failures
   */
  static async simulateNetworkConditions(
    condition: 'slow' | 'intermittent' | 'partition',
    durationMs: number = 5000
  ): Promise<void> {
    console.log(`Simulating network condition: ${condition} for ${durationMs}ms`);
    
    switch (condition) {
      case 'slow':
        // Slow down operations by adding delays
        await new Promise(resolve => setTimeout(resolve, durationMs / 2));
        break;
      
      case 'intermittent':
        // Simulate intermittent failures
        if (Math.random() < 0.3) {
          throw new Error('Simulated network failure');
        }
        break;
      
      case 'partition':
        // Simulate network partition
        await new Promise(resolve => setTimeout(resolve, durationMs));
        break;
    }
  }
}

// Export singleton instance
export const integrationManager = IntegrationTestManager.getInstance();
export default IntegrationTestManager;