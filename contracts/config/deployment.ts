import { ethers } from 'hardhat';
import { getNetworkConfig, getDeploymentConfig } from './networks';

export interface DeploymentParams {
  networkName: string;
  deployer: string;
  gasPrice?: string;
  gasLimit?: string;
  verify: boolean;
  dryRun: boolean;
  skipExisting: boolean;
}

export interface ContractDeploymentInfo {
  name: string;
  address: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  deployedAt: number;
  constructorArgs: any[];
  verified: boolean;
}

export interface DeploymentResult {
  networkName: string;
  chainId: number;
  deployer: string;
  timestamp: number;
  contracts: Record<string, ContractDeploymentInfo>;
  totalGasUsed: string;
  estimatedCost: string;
  successful: boolean;
  error?: string;
}

export class DeploymentManager {
  private networkName: string;
  private deployer: any;
  private params: DeploymentParams;
  private deploymentResult: DeploymentResult;

  constructor(params: DeploymentParams) {
    this.params = params;
    this.networkName = params.networkName;
    this.deploymentResult = {
      networkName: params.networkName,
      chainId: 0,
      deployer: params.deployer,
      timestamp: Date.now(),
      contracts: {},
      totalGasUsed: '0',
      estimatedCost: '0',
      successful: false
    };
  }

  async initialize(): Promise<void> {
    const networkConfig = getNetworkConfig(this.networkName);
    this.deploymentResult.chainId = networkConfig.chainId;
    
    // Get deployer signer
    const signers = await ethers.getSigners();
    this.deployer = signers[0];
    
    if (!this.deployer) {
      throw new Error('No deployer account available');
    }

    console.log(`🚀 Initializing deployment on ${this.networkName} (${networkConfig.chainId})`);
    console.log(`📍 Deployer address: ${this.deployer.address}`);
    
    // Check deployer balance
    const balance = await this.deployer.provider.getBalance(this.deployer.address);
    console.log(`💰 Deployer balance: ${ethers.formatEther(balance)} ETH`);
    
    if (balance === 0n) {
      throw new Error('Deployer account has no ETH balance');
    }
  }

  async deployContract(
    contractName: string,
    constructorArgs: any[] = [],
    libraries: Record<string, string> = {}
  ): Promise<ContractDeploymentInfo> {
    console.log(`\n📦 Deploying ${contractName}...`);
    
    if (this.params.skipExisting && await this.isContractDeployed(contractName)) {
      console.log(`⏭️  Skipping ${contractName} - already deployed`);
      return this.getExistingContractInfo(contractName);
    }

    try {
      // Get contract factory
      const ContractFactory = await ethers.getContractFactory(
        contractName,
        {
          libraries,
          signer: this.deployer
        }
      );

      // Estimate deployment gas
      const deploymentData = ContractFactory.getDeployTransaction(...constructorArgs);
      const estimatedGas = await this.deployer.provider.estimateGas(deploymentData);
      
      console.log(`⛽ Estimated gas: ${estimatedGas.toString()}`);

      // Perform dry run if requested
      if (this.params.dryRun) {
        console.log(`🧪 Dry run completed for ${contractName}`);
        return {
          name: contractName,
          address: '0x0000000000000000000000000000000000000000',
          txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockNumber: 0,
          gasUsed: estimatedGas.toString(),
          deployedAt: Date.now(),
          constructorArgs,
          verified: false
        };
      }

      // Deploy contract
      const deploymentOptions: any = {
        gasLimit: this.params.gasLimit || estimatedGas.toString()
      };

      if (this.params.gasPrice) {
        deploymentOptions.gasPrice = this.params.gasPrice;
      }

      const contract = await ContractFactory.deploy(...constructorArgs, deploymentOptions);
      const deploymentTx = await contract.deploymentTransaction();

      if (!deploymentTx) {
        throw new Error(`Failed to get deployment transaction for ${contractName}`);
      }

      console.log(`📋 Transaction hash: ${deploymentTx.hash}`);
      console.log(`⏳ Waiting for confirmation...`);

      // Wait for deployment confirmation
      const receipt = await deploymentTx.wait();
      const contractAddress = await contract.getAddress();

      if (!receipt) {
        throw new Error(`Deployment transaction failed for ${contractName}`);
      }

      const contractInfo: ContractDeploymentInfo = {
        name: contractName,
        address: contractAddress,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        deployedAt: Date.now(),
        constructorArgs,
        verified: false
      };

      console.log(`✅ ${contractName} deployed at: ${contractAddress}`);
      console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

      // Add to deployment result
      this.deploymentResult.contracts[contractName] = contractInfo;
      
      // Update total gas used
      const currentGas = BigInt(this.deploymentResult.totalGasUsed);
      const newGas = currentGas + receipt.gasUsed;
      this.deploymentResult.totalGasUsed = newGas.toString();

      // Verify contract if enabled
      if (this.params.verify && this.networkName !== 'hardhat') {
        await this.verifyContract(contractInfo);
      }

      return contractInfo;

    } catch (error) {
      console.error(`❌ Failed to deploy ${contractName}:`, error);
      this.deploymentResult.successful = false;
      this.deploymentResult.error = (error as Error).message;
      throw error;
    }
  }

  async verifyContract(contractInfo: ContractDeploymentInfo): Promise<void> {
    try {
      console.log(`🔍 Verifying ${contractInfo.name}...`);
      
      // Wait a bit for Etherscan to index the transaction
      await new Promise(resolve => setTimeout(resolve, 10000));

      const { run } = await import('hardhat');
      
      await run('verify:verify', {
        address: contractInfo.address,
        constructorArguments: contractInfo.constructorArgs,
      });

      contractInfo.verified = true;
      console.log(`✅ ${contractInfo.name} verified on block explorer`);

    } catch (error) {
      console.warn(`⚠️  Verification failed for ${contractInfo.name}:`, error);
      contractInfo.verified = false;
    }
  }

  async deployEscrowSystem(): Promise<DeploymentResult> {
    try {
      await this.initialize();
      
      console.log('\n🏗️  Starting Escrow System deployment...\n');

      // 1. Deploy EscrowSrc implementation
      const escrowSrcInfo = await this.deployContract('EscrowSrc');

      // 2. Deploy EscrowDst implementation  
      const escrowDstInfo = await this.deployContract('EscrowDst');

      // 3. Deploy EscrowFactory with implementation addresses
      const escrowFactoryInfo = await this.deployContract('EscrowFactory', [
        escrowSrcInfo.address,
        escrowDstInfo.address
      ]);

      // 4. Deploy test token if on development network
      if (this.networkName === 'hardhat' || this.networkName === 'localhost') {
        await this.deployContract('MockERC20', [
          'Test Token',
          'TEST',
          ethers.parseEther('1000000')
        ]);
      }

      this.deploymentResult.successful = true;
      
      console.log('\n🎉 Deployment completed successfully!');
      this.printDeploymentSummary();
      
      // Save deployment result
      await this.saveDeploymentResult();

      return this.deploymentResult;

    } catch (error) {
      this.deploymentResult.successful = false;
      this.deploymentResult.error = (error as Error).message;
      console.error('\n❌ Deployment failed:', error);
      throw error;
    }
  }

  private async isContractDeployed(contractName: string): Promise<boolean> {
    // Check if contract is already deployed (implementation would check deployment records)
    return false;
  }

  private async getExistingContractInfo(contractName: string): Promise<ContractDeploymentInfo> {
    // Return existing contract info (implementation would load from deployment records)
    throw new Error('Not implemented');
  }

  private printDeploymentSummary(): void {
    console.log('\n📋 Deployment Summary');
    console.log('====================');
    console.log(`Network: ${this.deploymentResult.networkName} (${this.deploymentResult.chainId})`);
    console.log(`Deployer: ${this.deploymentResult.deployer}`);
    console.log(`Total Gas Used: ${this.deploymentResult.totalGasUsed}`);
    
    console.log('\n📍 Deployed Contracts:');
    Object.entries(this.deploymentResult.contracts).forEach(([name, info]) => {
      console.log(`  ${name}: ${info.address}`);
      console.log(`    Gas Used: ${info.gasUsed}`);
      console.log(`    Verified: ${info.verified ? '✅' : '❌'}`);
    });

    console.log('\n📝 Environment Variables:');
    console.log('Add these to your .env file:');
    Object.entries(this.deploymentResult.contracts).forEach(([name, info]) => {
      const envVarName = name.toUpperCase().replace(/([A-Z])/g, '_$1').replace(/^_/, '') + '_ADDRESS';
      console.log(`${envVarName}=${info.address}`);
    });
  }

  private async saveDeploymentResult(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Create deployment directory if it doesn't exist
      const deploymentDir = path.join(__dirname, '../../deployment');
      if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
      }

      // Save deployment result
      const fileName = `${this.networkName}-deployment-${Date.now()}.json`;
      const filePath = path.join(deploymentDir, fileName);
      
      fs.writeFileSync(filePath, JSON.stringify(this.deploymentResult, null, 2));
      console.log(`\n💾 Deployment result saved to: ${filePath}`);

      // Update latest deployment file
      const latestFilePath = path.join(deploymentDir, `${this.networkName}-latest.json`);
      fs.writeFileSync(latestFilePath, JSON.stringify(this.deploymentResult, null, 2));

    } catch (error) {
      console.warn('⚠️  Failed to save deployment result:', error);
    }
  }
}

// Deployment utilities
export function createDeploymentParams(networkName: string): DeploymentParams {
  const networkConfig = getNetworkConfig(networkName);
  
  return {
    networkName,
    deployer: process.env.ETH_PRIVATE_KEY || '',
    gasPrice: process.env.DEPLOYMENT_GAS_PRICE,
    gasLimit: process.env.DEPLOYMENT_GAS_LIMIT,
    verify: process.env.VERIFY_CONTRACTS === 'true',
    dryRun: process.env.DRY_RUN === 'true',
    skipExisting: process.env.SKIP_EXISTING === 'true'
  };
}

export function validateDeploymentEnvironment(networkName: string): void {
  const requiredEnvVars = ['ETH_PRIVATE_KEY'];
  
  if (networkName === 'mainnet') {
    requiredEnvVars.push('ETHERSCAN_API_KEY');
  }

  const missing = requiredEnvVars.filter(env => !process.env[env]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export default DeploymentManager;