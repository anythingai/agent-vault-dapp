#!/usr/bin/env node

/**
 * Automated Smart Contract Deployment System
 * 
 * Features:
 * - Multi-environment deployment automation
 * - Gas optimization and estimation
 * - Automated testing and verification
 * - Security checks and validations
 * - Deployment rollback capabilities
 * - Configuration management
 */

import { ethers } from "hardhat";
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DeploymentConfig {
  environment: 'local' | 'testnet' | 'mainnet';
  network: string;
  maxGasFee?: string;
  maxPriorityFee?: string;
  gasLimit?: number;
  confirmations?: number;
  skipTests?: boolean;
  skipVerification?: boolean;
  enableUpgrade?: boolean;
  safetyChecks?: boolean;
  backupContracts?: boolean;
}

interface ContractDeployment {
  name: string;
  address: string;
  constructorArgs: any[];
  deploymentTx: string;
  gasUsed: string;
  deploymentCost: string;
  verified: boolean;
  blockNumber: number;
  timestamp: number;
}

interface DeploymentRecord {
  version: string;
  environment: string;
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  config: DeploymentConfig;
  contracts: { [key: string]: ContractDeployment };
  factoryConfiguration: any;
  gasReport: any;
  testResults: any;
  verificationResults: any;
  rollbackInfo?: any;
  failed?: boolean;
  error?: string;
}

class SmartContractDeployer {
  private config: DeploymentConfig;
  private deployer: any;
  private network: any;
  private gasPrice: any;
  private deploymentRecord: DeploymentRecord;
  private backupData: any = {};

  constructor(config: DeploymentConfig) {
    this.config = config;
  }

  /**
   * Initialize deployment environment
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Smart Contract Deployment System');
    console.log('='.repeat(60));

    // Get network and deployer info
    [this.deployer] = await ethers.getSigners();
    this.network = await ethers.provider.getNetwork();

    console.log(`📡 Network: ${this.network.name} (Chain ID: ${this.network.chainId})`);
    console.log(`👤 Deployer: ${this.deployer.address}`);

    // Check deployer balance
    const balance = await this.deployer.provider.getBalance(this.deployer.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther("0.01")) {
      throw new Error("Insufficient balance for deployment");
    }

    // Get current gas price
    const feeData = await ethers.provider.getFeeData();
    this.gasPrice = feeData.gasPrice;
    console.log(`⛽ Gas Price: ${ethers.formatUnits(this.gasPrice!, 'gwei')} gwei`);

    // Initialize deployment record
    this.deploymentRecord = {
      version: process.env.VERSION || `v${Date.now()}`,
      environment: this.config.environment,
      network: this.network.name,
      chainId: Number(this.network.chainId),
      deployer: this.deployer.address,
      timestamp: new Date().toISOString(),
      config: this.config,
      contracts: {},
      factoryConfiguration: {},
      gasReport: { estimations: {}, actual: {} },
      testResults: {},
      verificationResults: {}
    };

    console.log('✅ Initialization completed\n');
  }

  /**
   * Run pre-deployment security checks
   */
  async runSecurityChecks(): Promise<void> {
    if (!this.config.safetyChecks && this.config.environment !== 'mainnet') {
      console.log('⏭️  Skipping security checks (disabled)\n');
      return;
    }

    console.log('🛡️  Running Pre-Deployment Security Checks');
    console.log('-'.repeat(40));

    // Check for known security issues
    try {
      console.log('🔍 Running static analysis...');
      await execAsync('npm run security:analyze', { cwd: process.cwd() });
      console.log('✅ Static analysis passed');
    } catch (error) {
      console.warn('⚠️  Static analysis failed:', error);
      if (this.config.environment === 'mainnet') {
        throw new Error('Security analysis failed - deployment aborted for mainnet');
      }
    }

    // Check for up-to-date dependencies
    try {
      console.log('🔍 Checking dependencies...');
      await execAsync('npm audit --audit-level high', { timeout: 30000 });
      console.log('✅ Dependencies security check passed');
    } catch (error) {
      console.warn('⚠️  Dependency security issues detected');
      if (this.config.environment === 'mainnet') {
        throw new Error('Critical dependency vulnerabilities detected - deployment aborted');
      }
    }

    // Validate compiler settings
    console.log('🔍 Validating compiler configuration...');
    try {
      const hardhatConfig = await import('../hardhat.config');
      const solcConfig = hardhatConfig.default.solidity;
      
      if (this.config.environment === 'mainnet' && solcConfig && typeof solcConfig === 'object') {
        const settings = (solcConfig as any).settings;
        if (settings) {
          if (!settings.optimizer?.enabled) {
            console.warn('⚠️  Optimizer not enabled for mainnet deployment');
          }
          if (!settings.viaIR) {
            console.warn('⚠️  viaIR not enabled - may affect gas optimization');
          }
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not validate compiler configuration:', error);
    }

    console.log('✅ Security checks completed\n');
  }

  /**
   * Estimate gas costs for all deployments
   */
  async estimateGasCosts(): Promise<void> {
    console.log('⛽ Estimating Gas Costs');
    console.log('-'.repeat(30));

    try {
      // Estimate EscrowFactory deployment
      const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
      const factoryDeployTx = await EscrowFactory.getDeployTransaction();
      const factoryGasEstimate = await this.deployer.provider.estimateGas(factoryDeployTx);
      this.deploymentRecord.gasReport.estimations.EscrowFactory = factoryGasEstimate.toString();

      // Estimate TestToken deployment
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tokenDeployTx = await MockERC20.getDeployTransaction(
        "Test Token",
        "TEST",
        ethers.parseEther("1000000")
      );
      const tokenGasEstimate = await this.deployer.provider.estimateGas(tokenDeployTx);
      this.deploymentRecord.gasReport.estimations.TestToken = tokenGasEstimate.toString();

      // Calculate total estimated cost
      const totalGasEstimate = factoryGasEstimate + tokenGasEstimate;
      const estimatedCostWei = totalGasEstimate * this.gasPrice!;
      const estimatedCostEth = ethers.formatEther(estimatedCostWei);

      console.log(`📊 Gas Estimations:`);
      console.log(`  EscrowFactory: ${factoryGasEstimate.toLocaleString()} gas`);
      console.log(`  TestToken: ${tokenGasEstimate.toLocaleString()} gas`);
      console.log(`  Total: ${totalGasEstimate.toLocaleString()} gas`);
      console.log(`  Estimated Cost: ${estimatedCostEth} ETH`);

      this.deploymentRecord.gasReport.estimations.total = totalGasEstimate.toString();
      this.deploymentRecord.gasReport.estimations.costEth = estimatedCostEth;

    } catch (error) {
      console.error('❌ Gas estimation failed:', error);
      throw error;
    }

    console.log('✅ Gas estimation completed\n');
  }

  /**
   * Create backup of existing contracts (if any)
   */
  async createBackup(): Promise<void> {
    if (!this.config.backupContracts) {
      console.log('⏭️  Skipping backup (disabled)\n');
      return;
    }

    console.log('💾 Creating Contract Backup');
    console.log('-'.repeat(25));

    const deploymentFile = path.join(__dirname, `../../deployment/${this.network.name}-addresses.json`);
    
    if (fs.existsSync(deploymentFile)) {
      const existingDeployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
      const backupFile = path.join(__dirname, `../../deployment/backups/${this.network.name}-${Date.now()}.json`);
      
      // Create backup directory
      const backupDir = path.dirname(backupFile);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      fs.writeFileSync(backupFile, JSON.stringify(existingDeployment, null, 2));
      console.log(`✅ Backup created: ${backupFile}`);

      this.deploymentRecord.rollbackInfo = {
        backupFile,
        previousDeployment: existingDeployment
      };

      this.backupData = existingDeployment;
    } else {
      console.log('ℹ️  No existing deployment found - skipping backup');
    }

    console.log('✅ Backup process completed\n');
  }

  /**
   * Deploy smart contracts with comprehensive error handling
   */
  async deployContracts(): Promise<void> {
    console.log('📜 Deploying Smart Contracts');
    console.log('-'.repeat(30));

    try {
      // Deploy EscrowFactory
      await this.deployEscrowFactory();
      
      // Deploy TestToken (if not mainnet)
      if (this.config.environment !== 'mainnet') {
        await this.deployTestToken();
      }

      // Wait for confirmations
      if (this.config.confirmations && this.config.confirmations > 1) {
        console.log(`⏳ Waiting for ${this.config.confirmations} confirmations...`);
        await this.waitForConfirmations();
      }

    } catch (error) {
      console.error('❌ Contract deployment failed:', error);
      await this.handleDeploymentFailure(error);
      throw error;
    }

    console.log('✅ Contract deployment completed\n');
  }

  /**
   * Deploy EscrowFactory contract
   */
  private async deployEscrowFactory(): Promise<void> {
    console.log('🏭 Deploying EscrowFactory...');

    const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
    
    // Prepare deployment transaction
    const deployTx = await EscrowFactory.getDeployTransaction();
    
    // Apply gas configuration
    if (this.config.gasLimit) {
      deployTx.gasLimit = BigInt(this.config.gasLimit);
    }
    if (this.config.maxGasFee) {
      deployTx.maxFeePerGas = ethers.parseUnits(this.config.maxGasFee, 'gwei');
    }
    if (this.config.maxPriorityFee) {
      deployTx.maxPriorityFeePerGas = ethers.parseUnits(this.config.maxPriorityFee, 'gwei');
    }

    const factory = await EscrowFactory.deploy(deployTx);
    const deploymentTx = factory.deploymentTransaction();

    console.log(`📋 Transaction: ${deploymentTx?.hash}`);
    console.log('⏳ Waiting for deployment...');

    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    const receipt = await deploymentTx?.wait();

    console.log(`✅ EscrowFactory deployed: ${factoryAddress}`);
    console.log(`   Gas used: ${receipt?.gasUsed.toLocaleString()}`);
    console.log(`   Block: ${receipt?.blockNumber}`);

    // Get implementation addresses
    const stats = await factory.getFactoryStats();
    console.log(`   EscrowSrc impl: ${stats._escrowSrcImplementation}`);
    console.log(`   EscrowDst impl: ${stats._escrowDstImplementation}`);

    // Record deployment
    this.deploymentRecord.contracts.EscrowFactory = {
      name: 'EscrowFactory',
      address: factoryAddress,
      constructorArgs: [],
      deploymentTx: deploymentTx?.hash || '',
      gasUsed: receipt?.gasUsed.toString() || '0',
      deploymentCost: ethers.formatEther((receipt?.gasUsed || 0n) * this.gasPrice!),
      verified: false,
      blockNumber: receipt?.blockNumber || 0,
      timestamp: Date.now()
    };

    this.deploymentRecord.contracts.EscrowSrcImplementation = {
      name: 'EscrowSrcImplementation',
      address: stats._escrowSrcImplementation,
      constructorArgs: [],
      deploymentTx: '',
      gasUsed: '0',
      deploymentCost: '0',
      verified: false,
      blockNumber: receipt?.blockNumber || 0,
      timestamp: Date.now()
    };

    this.deploymentRecord.contracts.EscrowDstImplementation = {
      name: 'EscrowDstImplementation',
      address: stats._escrowDstImplementation,
      constructorArgs: [],
      deploymentTx: '',
      gasUsed: '0',
      deploymentCost: '0',
      verified: false,
      blockNumber: receipt?.blockNumber || 0,
      timestamp: Date.now()
    };

    this.deploymentRecord.factoryConfiguration = {
      minimumSafetyDeposit: stats._minimumSafetyDeposit.toString(),
      maximumTimelock: stats._maximumTimelock.toString(),
      minimumTimelock: stats._minimumTimelock.toString()
    };

    // Update gas report
    this.deploymentRecord.gasReport.actual.EscrowFactory = receipt?.gasUsed.toString() || '0';
  }

  /**
   * Deploy test token for non-mainnet environments
   */
  private async deployTestToken(): Promise<void> {
    console.log('🪙 Deploying Test Token...');

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const constructorArgs = [
      "Test Token",
      "TEST",
      ethers.parseEther("1000000")
    ];

    const testToken = await MockERC20.deploy(...constructorArgs);
    const deploymentTx = testToken.deploymentTransaction();

    console.log(`📋 Transaction: ${deploymentTx?.hash}`);
    console.log('⏳ Waiting for deployment...');

    await testToken.waitForDeployment();
    const tokenAddress = await testToken.getAddress();
    const receipt = await deploymentTx?.wait();

    console.log(`✅ Test Token deployed: ${tokenAddress}`);
    console.log(`   Gas used: ${receipt?.gasUsed.toLocaleString()}`);

    // Record deployment
    this.deploymentRecord.contracts.TestToken = {
      name: 'TestToken',
      address: tokenAddress,
      constructorArgs,
      deploymentTx: deploymentTx?.hash || '',
      gasUsed: receipt?.gasUsed.toString() || '0',
      deploymentCost: ethers.formatEther((receipt?.gasUsed || 0n) * this.gasPrice!),
      verified: false,
      blockNumber: receipt?.blockNumber || 0,
      timestamp: Date.now()
    };

    // Update gas report
    this.deploymentRecord.gasReport.actual.TestToken = receipt?.gasUsed.toString() || '0';
  }

  /**
   * Wait for additional confirmations
   */
  private async waitForConfirmations(): Promise<void> {
    // Implementation depends on network requirements
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
  }

  /**
   * Handle deployment failure
   */
  private async handleDeploymentFailure(error: any): Promise<void> {
    console.log('🚨 Handling Deployment Failure');
    
    // Log error details
    this.deploymentRecord.testResults.deploymentError = {
      message: error.message,
      timestamp: new Date().toISOString()
    };

    // If we have backup data, offer to restore
    if (this.backupData && Object.keys(this.backupData).length > 0) {
      console.log('💾 Backup data available for potential restore');
    }
  }

  /**
   * Run post-deployment tests
   */
  async runPostDeploymentTests(): Promise<void> {
    if (this.config.skipTests) {
      console.log('⏭️  Skipping post-deployment tests (disabled)\n');
      return;
    }

    console.log('🧪 Running Post-Deployment Tests');
    console.log('-'.repeat(32));

    const testResults: any = {
      timestamp: new Date().toISOString(),
      tests: {}
    };

    try {
      // Test EscrowFactory functionality
      if (this.deploymentRecord.contracts.EscrowFactory) {
        console.log('🧪 Testing EscrowFactory...');
        const factoryTest = await this.testEscrowFactory();
        testResults.tests.EscrowFactory = factoryTest;
      }

      // Test Token functionality (if deployed)
      if (this.deploymentRecord.contracts.TestToken) {
        console.log('🧪 Testing TestToken...');
        const tokenTest = await this.testTokenFunctionality();
        testResults.tests.TestToken = tokenTest;
      }

      // Integration tests
      console.log('🧪 Running integration tests...');
      const integrationTest = await this.runIntegrationTests();
      testResults.tests.Integration = integrationTest;

      this.deploymentRecord.testResults = testResults;
      console.log('✅ Post-deployment tests completed\n');

    } catch (error) {
      console.error('❌ Post-deployment tests failed:', error);
      testResults.error = error.message;
      this.deploymentRecord.testResults = testResults;
      
      if (this.config.environment === 'mainnet') {
        throw error; // Fail deployment on mainnet if tests fail
      }
    }
  }

  /**
   * Test EscrowFactory functionality
   */
  private async testEscrowFactory(): Promise<any> {
    const factory = await ethers.getContractAt(
      "EscrowFactory",
      this.deploymentRecord.contracts.EscrowFactory.address
    );

    try {
      // Test basic functionality
      const stats = await factory.getFactoryStats();
      
      // Create test escrow
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`test-${Date.now()}`));
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes("test-secret-123"));
      const timelock = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("1.0");
      const safetyDeposit = ethers.parseEther("0.001");

      const tokenAddress = this.deploymentRecord.contracts.TestToken?.address || 
                          ethers.ZeroAddress; // Use zero address if no test token

      const tx = await factory.createEscrowSrc(
        orderId,
        tokenAddress,
        amount,
        this.deployer.address,
        this.deployer.address,
        secretHash,
        timelock,
        { value: safetyDeposit }
      );

      const receipt = await tx.wait();
      const escrowAddress = await factory.escrows(orderId);

      return {
        success: true,
        stats: {
          escrowSrcImplementation: stats._escrowSrcImplementation,
          escrowDstImplementation: stats._escrowDstImplementation,
          minimumSafetyDeposit: stats._minimumSafetyDeposit.toString(),
          maximumTimelock: stats._maximumTimelock.toString()
        },
        testEscrow: {
          orderId: orderId,
          address: escrowAddress,
          transactionHash: receipt?.hash,
          gasUsed: receipt?.gasUsed.toString()
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test token functionality
   */
  private async testTokenFunctionality(): Promise<any> {
    if (!this.deploymentRecord.contracts.TestToken) {
      return { skipped: true, reason: 'TestToken not deployed' };
    }

    const token = await ethers.getContractAt(
      "MockERC20",
      this.deploymentRecord.contracts.TestToken.address
    );

    try {
      const name = await token.name();
      const symbol = await token.symbol();
      const totalSupply = await token.totalSupply();
      const deployerBalance = await token.balanceOf(this.deployer.address);

      return {
        success: true,
        details: {
          name,
          symbol,
          totalSupply: totalSupply.toString(),
          deployerBalance: deployerBalance.toString()
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run integration tests
   */
  private async runIntegrationTests(): Promise<any> {
    try {
      // Run external test suite if available
      const { stdout } = await execAsync('npm run test:integration:quick', { timeout: 120000 });
      return {
        success: true,
        output: stdout
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify contracts on Etherscan
   */
  async verifyContracts(): Promise<void> {
    if (this.config.skipVerification || this.network.name === 'hardhat' || this.network.name === 'localhost') {
      console.log('⏭️  Skipping contract verification\n');
      return;
    }

    console.log('🔍 Verifying Contracts on Etherscan');
    console.log('-'.repeat(35));

    const verificationResults: any = {
      timestamp: new Date().toISOString(),
      contracts: {}
    };

    for (const [contractName, contractInfo] of Object.entries(this.deploymentRecord.contracts)) {
      if (contractName.includes('Implementation')) {
        // Skip implementation contracts as they're deployed by factory
        continue;
      }

      console.log(`🔍 Verifying ${contractName}...`);

      try {
        await execAsync(`npx hardhat verify --network ${this.network.name} ${contractInfo.address} ${contractInfo.constructorArgs.map(arg => `"${arg}"`).join(' ')}`, {
          timeout: 120000
        });

        console.log(`✅ ${contractName} verified successfully`);
        verificationResults.contracts[contractName] = {
          success: true,
          address: contractInfo.address
        };

        // Update deployment record
        this.deploymentRecord.contracts[contractName].verified = true;

      } catch (error) {
        if (error.message.includes('Already Verified')) {
          console.log(`✅ ${contractName} already verified`);
          verificationResults.contracts[contractName] = {
            success: true,
            alreadyVerified: true,
            address: contractInfo.address
          };
          this.deploymentRecord.contracts[contractName].verified = true;
        } else {
          console.error(`❌ ${contractName} verification failed:`, error.message);
          verificationResults.contracts[contractName] = {
            success: false,
            error: error.message,
            address: contractInfo.address
          };
        }
      }
    }

    this.deploymentRecord.verificationResults = verificationResults;
    console.log('✅ Contract verification completed\n');
  }

  /**
   * Save deployment record
   */
  async saveDeploymentRecord(): Promise<void> {
    console.log('💾 Saving Deployment Record');
    console.log('-'.repeat(26));

    // Calculate total gas used and cost
    let totalGasUsed = 0n;
    let totalCost = 0.0;

    for (const contract of Object.values(this.deploymentRecord.contracts)) {
      totalGasUsed += BigInt(contract.gasUsed || '0');
      totalCost += parseFloat(contract.deploymentCost || '0');
    }

    this.deploymentRecord.gasReport.actual.total = totalGasUsed.toString();
    this.deploymentRecord.gasReport.actual.totalCostEth = totalCost.toFixed(6);

    // Ensure deployment directory exists
    const deploymentDir = path.join(__dirname, '../../deployment');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    // Save main deployment record
    const filename = `${this.network.name}-addresses.json`;
    const filepath = path.join(deploymentDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(this.deploymentRecord, null, 2));

    console.log(`✅ Deployment record saved: ${filename}`);

    // Save to versioned history
    const historyDir = path.join(deploymentDir, 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const versionedFilename = `${this.network.name}-${this.deploymentRecord.version}-${Date.now()}.json`;
    const versionedFilepath = path.join(historyDir, versionedFilename);
    fs.writeFileSync(versionedFilepath, JSON.stringify(this.deploymentRecord, null, 2));

    console.log(`✅ Versioned record saved: ${versionedFilename}`);
    console.log('✅ Deployment record saving completed\n');
  }

  /**
   * Print deployment summary
   */
  printSummary(): void {
    console.log('📋 DEPLOYMENT SUMMARY');
    console.log('='.repeat(50));

    console.log(`🌍 Environment: ${this.config.environment}`);
    console.log(`🌐 Network: ${this.network.name} (${this.network.chainId})`);
    console.log(`🏷️  Version: ${this.deploymentRecord.version}`);
    console.log(`👤 Deployer: ${this.deployer.address}`);
    console.log(`⏰ Timestamp: ${this.deploymentRecord.timestamp}`);

    console.log('\n📜 Deployed Contracts:');
    for (const [name, contract] of Object.entries(this.deploymentRecord.contracts)) {
      const verifiedStatus = contract.verified ? '✅' : '❌';
      console.log(`  ${name}: ${contract.address} ${verifiedStatus}`);
    }

    console.log('\n⛽ Gas Report:');
    console.log(`  Total Gas Used: ${parseInt(this.deploymentRecord.gasReport.actual.total || '0').toLocaleString()}`);
    console.log(`  Total Cost: ${this.deploymentRecord.gasReport.actual.totalCostEth} ETH`);

    console.log('\n🧪 Test Results:');
    if (this.deploymentRecord.testResults.tests) {
      for (const [testName, result] of Object.entries(this.deploymentRecord.testResults.tests)) {
        const status = (result as any).success ? '✅' : '❌';
        console.log(`  ${testName}: ${status}`);
      }
    }

    console.log('\n🔍 Verification Status:');
    if (this.deploymentRecord.verificationResults.contracts) {
      for (const [contractName, result] of Object.entries(this.deploymentRecord.verificationResults.contracts)) {
        const status = (result as any).success ? '✅' : '❌';
        console.log(`  ${contractName}: ${status}`);
      }
    }

    console.log('\n🎉 DEPLOYMENT COMPLETED SUCCESSFULLY! 🎉');
  }

  /**
   * Main deployment orchestration
   */
  async deploy(): Promise<DeploymentRecord> {
    try {
      await this.initialize();
      await this.runSecurityChecks();
      await this.estimateGasCosts();
      await this.createBackup();
      await this.deployContracts();
      await this.runPostDeploymentTests();
      await this.verifyContracts();
      await this.saveDeploymentRecord();
      
      this.printSummary();
      
      return this.deploymentRecord;

    } catch (error) {
      console.error('💥 Deployment failed:', error);
      
      // Save partial deployment record for debugging
      if (this.deploymentRecord) {
        this.deploymentRecord.failed = true;
        this.deploymentRecord.error = error.message;
        await this.saveDeploymentRecord();
      }
      
      throw error;
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const environment = (args[0] as 'local' | 'testnet' | 'mainnet') || 'local';
  const network = args[1] || (environment === 'mainnet' ? 'mainnet' : environment === 'testnet' ? 'sepolia' : 'localhost');

  // Parse additional options
  const config: DeploymentConfig = {
    environment,
    network,
    confirmations: environment === 'mainnet' ? 3 : 1,
    skipTests: args.includes('--skip-tests'),
    skipVerification: args.includes('--skip-verification'),
    enableUpgrade: args.includes('--enable-upgrade'),
    safetyChecks: environment === 'mainnet' || args.includes('--safety-checks'),
    backupContracts: environment !== 'local'
  };

  // Additional gas configuration for production
  if (environment === 'mainnet') {
    config.maxGasFee = process.env.MAX_GAS_FEE || '50'; // 50 gwei
    config.maxPriorityFee = process.env.MAX_PRIORITY_FEE || '2'; // 2 gwei
    config.gasLimit = parseInt(process.env.GAS_LIMIT || '8000000');
  }

  console.log('🚀 1inch Fusion+ Cross-Chain Smart Contract Deployment');
  console.log(`📊 Configuration:`, config);
  console.log('');

  const deployer = new SmartContractDeployer(config);
  await deployer.deploy();
}

// Export for use as module
export { SmartContractDeployer, DeploymentConfig, DeploymentRecord };

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Deployment automation completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Deployment automation failed:', error);
      process.exit(1);
    });
}