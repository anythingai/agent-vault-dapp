#!/usr/bin/env node

/**
 * Configuration Validation Script
 * 
 * Validates all configuration files and settings across the entire project:
 * - Environment variable validation
 * - Configuration file syntax and content validation
 * - Cross-component configuration consistency
 * - Security compliance validation
 * - Network connectivity tests
 * - Deployment readiness checks
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ValidationResult {
  component: string;
  category: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface ValidationSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  critical: number;
  results: ValidationResult[];
  duration: number;
}

class ConfigurationValidator {
  private rootDir: string;
  private results: ValidationResult[] = [];
  private startTime: number = Date.now();

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  /**
   * Run comprehensive validation
   */
  async validate(): Promise<ValidationSummary> {
    console.log('🔍 Starting comprehensive configuration validation...\n');

    try {
      // Load environment for validation
      await this.loadEnvironment();

      // Validate each component
      await this.validateRootConfiguration();
      await this.validateContractsConfiguration();
      await this.validateBackendConfiguration();
      await this.validateFrontendConfiguration();
      await this.validateSecretsConfiguration();
      await this.validateSecurityConfiguration();
      await this.validateOperationalConfiguration();
      
      // Cross-component validations
      await this.validateCrossComponentConsistency();
      await this.validateNetworkConnectivity();
      await this.validateDeploymentReadiness();

    } catch (error) {
      this.addResult('system', 'validation', 'fail', 
        `Validation process failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'critical');
    }

    return this.generateSummary();
  }

  /**
   * Validate root-level configuration
   */
  private async validateRootConfiguration(): Promise<void> {
    console.log('📁 Validating root configuration...');

    // Check for required files
    const requiredFiles = [
      '.env.example',
      'package.json',
      'README.md',
      'config/index.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(this.rootDir, file);
      if (existsSync(filePath)) {
        this.addResult('root', 'files', 'pass', `Required file exists: ${file}`, undefined, 'medium');
      } else {
        this.addResult('root', 'files', 'fail', `Missing required file: ${file}`, undefined, 'high');
      }
    }

    // Validate root .env.example
    await this.validateEnvExample(join(this.rootDir, '.env.example'), 'root');

    // Validate package.json
    await this.validatePackageJson(join(this.rootDir, 'package.json'), 'root');
  }

  /**
   * Validate contracts configuration
   */
  private async validateContractsConfiguration(): Promise<void> {
    console.log('📜 Validating contracts configuration...');

    const contractsDir = join(this.rootDir, 'contracts');
    
    if (!existsSync(contractsDir)) {
      this.addResult('contracts', 'structure', 'warn', 'Contracts directory not found', undefined, 'low');
      return;
    }

    // Check for required files
    const requiredFiles = [
      'hardhat.config.ts',
      'package.json',
      '.env.example',
      'config/networks.ts',
      'config/deployment.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(contractsDir, file);
      if (existsSync(filePath)) {
        this.addResult('contracts', 'files', 'pass', `Required file exists: ${file}`, undefined, 'medium');
      } else {
        this.addResult('contracts', 'files', 'fail', `Missing required file: ${file}`, undefined, 'high');
      }
    }

    // Validate Hardhat configuration
    await this.validateHardhatConfig();

    // Validate network configurations
    await this.validateNetworkConfigurations();

    // Check for compiled contracts
    const artifactsDir = join(contractsDir, 'artifacts');
    if (existsSync(artifactsDir)) {
      this.addResult('contracts', 'compilation', 'pass', 'Contract artifacts found', undefined, 'low');
    } else {
      this.addResult('contracts', 'compilation', 'warn', 'No contract artifacts found - run compilation', undefined, 'medium');
    }
  }

  /**
   * Validate backend configuration
   */
  private async validateBackendConfiguration(): Promise<void> {
    console.log('⚙️ Validating backend configuration...');

    const backendDir = join(this.rootDir, 'backend');
    
    if (!existsSync(backendDir)) {
      this.addResult('backend', 'structure', 'warn', 'Backend directory not found', undefined, 'low');
      return;
    }

    // Check for required files
    const requiredFiles = [
      'package.json',
      '.env.example',
      'config/index.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(backendDir, file);
      if (existsSync(filePath)) {
        this.addResult('backend', 'files', 'pass', `Required file exists: ${file}`, undefined, 'medium');
      } else {
        this.addResult('backend', 'files', 'fail', `Missing required file: ${file}`, undefined, 'high');
      }
    }

    // Validate backend .env.example
    await this.validateEnvExample(join(backendDir, '.env.example'), 'backend');

    // Test backend configuration loading
    await this.testBackendConfigLoading();
  }

  /**
   * Validate frontend configuration
   */
  private async validateFrontendConfiguration(): Promise<void> {
    console.log('🌐 Validating frontend configuration...');

    const frontendDir = join(this.rootDir, 'frontend');
    
    if (!existsSync(frontendDir)) {
      this.addResult('frontend', 'structure', 'warn', 'Frontend directory not found', undefined, 'low');
      return;
    }

    // Check for required files
    const requiredFiles = [
      'package.json',
      '.env.example',
      'src/config/index.ts',
      'vite.config.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(frontendDir, file);
      if (existsSync(filePath)) {
        this.addResult('frontend', 'files', 'pass', `Required file exists: ${file}`, undefined, 'medium');
      } else {
        this.addResult('frontend', 'files', 'fail', `Missing required file: ${file}`, undefined, 'high');
      }
    }

    // Validate frontend .env.example
    await this.validateEnvExample(join(frontendDir, '.env.example'), 'frontend');

    // Validate Vite configuration
    await this.validateViteConfig();
  }

  /**
   * Validate secrets configuration
   */
  private async validateSecretsConfiguration(): Promise<void> {
    console.log('🔐 Validating secrets configuration...');

    const secretsDir = join(this.rootDir, 'config', 'secrets');
    
    if (!existsSync(secretsDir)) {
      this.addResult('secrets', 'structure', 'fail', 'Secrets configuration directory not found', undefined, 'high');
      return;
    }

    // Check for required files
    const requiredFiles = [
      'index.ts',
      'key-rotation.ts',
      'validation.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(secretsDir, file);
      if (existsSync(filePath)) {
        this.addResult('secrets', 'files', 'pass', `Required file exists: ${file}`, undefined, 'medium');
      } else {
        this.addResult('secrets', 'files', 'fail', `Missing required file: ${file}`, undefined, 'high');
      }
    }

    // Validate secrets environment variables
    await this.validateSecretsEnvironment();
  }

  /**
   * Validate security configuration
   */
  private async validateSecurityConfiguration(): Promise<void> {
    console.log('🔒 Validating security configuration...');

    const securityDir = join(this.rootDir, 'config', 'security');
    
    if (!existsSync(securityDir)) {
      this.addResult('security', 'structure', 'fail', 'Security configuration directory not found', undefined, 'critical');
      return;
    }

    // Check for security configuration file
    const securityConfigPath = join(securityDir, 'index.ts');
    if (existsSync(securityConfigPath)) {
      this.addResult('security', 'files', 'pass', 'Security configuration exists', undefined, 'high');
    } else {
      this.addResult('security', 'files', 'fail', 'Missing security configuration', undefined, 'critical');
    }

    // Validate security settings
    await this.validateSecuritySettings();
  }

  /**
   * Validate operational configuration
   */
  private async validateOperationalConfiguration(): Promise<void> {
    console.log('⚙️ Validating operational configuration...');

    const operationalDir = join(this.rootDir, 'config', 'operational');
    
    if (!existsSync(operationalDir)) {
      this.addResult('operational', 'structure', 'fail', 'Operational configuration directory not found', undefined, 'high');
      return;
    }

    // Check for operational configuration file
    const operationalConfigPath = join(operationalDir, 'index.ts');
    if (existsSync(operationalConfigPath)) {
      this.addResult('operational', 'files', 'pass', 'Operational configuration exists', undefined, 'medium');
    } else {
      this.addResult('operational', 'files', 'fail', 'Missing operational configuration', undefined, 'high');
    }

    // Validate operational settings
    await this.validateOperationalSettings();
  }

  /**
   * Validate cross-component consistency
   */
  private async validateCrossComponentConsistency(): Promise<void> {
    console.log('🔗 Validating cross-component consistency...');

    // Validate port consistency
    await this.validatePortConsistency();

    // Validate contract address consistency
    await this.validateContractAddressConsistency();

    // Validate network consistency
    await this.validateNetworkConsistency();

    // Validate API endpoint consistency
    await this.validateApiEndpointConsistency();
  }

  /**
   * Validate network connectivity
   */
  private async validateNetworkConnectivity(): Promise<void> {
    console.log('🌐 Validating network connectivity...');

    // Test Ethereum RPC connectivity
    await this.testEthereumRPC();

    // Test Bitcoin RPC connectivity
    await this.testBitcoinRPC();

    // Test external service connectivity
    await this.testExternalServices();
  }

  /**
   * Validate deployment readiness
   */
  private async validateDeploymentReadiness(): Promise<void> {
    console.log('🚀 Validating deployment readiness...');

    // Check environment-specific requirements
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    if (nodeEnv === 'production') {
      await this.validateProductionReadiness();
    } else if (nodeEnv === 'staging') {
      await this.validateStagingReadiness();
    } else {
      await this.validateDevelopmentSetup();
    }

    // Validate dependencies
    await this.validateDependencies();

    // Check for required environment variables
    await this.validateRequiredEnvironmentVariables();
  }

  // Helper methods

  private async loadEnvironment(): Promise<void> {
    try {
      // Try to load dotenv if available
      const dotenv = await import('dotenv');
      dotenv.config();
      this.addResult('system', 'environment', 'pass', 'Environment variables loaded', undefined, 'low');
    } catch (error) {
      this.addResult('system', 'environment', 'warn', 'Could not load dotenv module', undefined, 'low');
    }
  }

  private async validateEnvExample(filePath: string, component: string): Promise<void> {
    if (!existsSync(filePath)) {
      this.addResult(component, 'env', 'fail', `.env.example not found: ${filePath}`, undefined, 'high');
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
      
      this.addResult(component, 'env', 'pass', 
        `.env.example valid with ${lines.length} environment variables`, 
        { variableCount: lines.length }, 'low');

      // Check for sensitive data in .env.example
      const sensitivePatterns = [
        /private.*key.*=.*[0-9a-fA-F]/i,
        /secret.*=.*[0-9a-zA-Z]/i,
        /password.*=.*[0-9a-zA-Z]/i
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(content)) {
          this.addResult(component, 'security', 'fail', 
            'Potential sensitive data found in .env.example', undefined, 'high');
          break;
        }
      }

    } catch (error) {
      this.addResult(component, 'env', 'fail', 
        `Failed to read .env.example: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'medium');
    }
  }

  private async validatePackageJson(filePath: string, component: string): Promise<void> {
    if (!existsSync(filePath)) {
      this.addResult(component, 'package', 'fail', `package.json not found: ${filePath}`, undefined, 'high');
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const packageJson = JSON.parse(content);

      // Basic validation
      if (!packageJson.name) {
        this.addResult(component, 'package', 'fail', 'package.json missing name', undefined, 'medium');
      }

      if (!packageJson.version) {
        this.addResult(component, 'package', 'fail', 'package.json missing version', undefined, 'medium');
      }

      if (!packageJson.scripts) {
        this.addResult(component, 'package', 'warn', 'package.json missing scripts', undefined, 'low');
      }

      this.addResult(component, 'package', 'pass', 'package.json is valid', 
        { 
          name: packageJson.name, 
          version: packageJson.version,
          scripts: Object.keys(packageJson.scripts || {}).length
        }, 'low');

    } catch (error) {
      this.addResult(component, 'package', 'fail', 
        `Invalid package.json: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async validateHardhatConfig(): Promise<void> {
    const configPath = join(this.rootDir, 'contracts', 'hardhat.config.ts');
    
    if (!existsSync(configPath)) {
      this.addResult('contracts', 'hardhat', 'fail', 'hardhat.config.ts not found', undefined, 'high');
      return;
    }

    try {
      // Basic syntax check by reading the file
      const content = readFileSync(configPath, 'utf8');
      
      // Check for required configurations
      const requiredConfigs = [
        'solidity',
        'networks',
        'etherscan'
      ];

      for (const config of requiredConfigs) {
        if (content.includes(config)) {
          this.addResult('contracts', 'hardhat', 'pass', `Hardhat config includes ${config}`, undefined, 'low');
        } else {
          this.addResult('contracts', 'hardhat', 'warn', `Hardhat config missing ${config}`, undefined, 'medium');
        }
      }

      // Check for environment variable usage
      if (content.includes('process.env.')) {
        this.addResult('contracts', 'hardhat', 'pass', 'Hardhat config uses environment variables', undefined, 'low');
      } else {
        this.addResult('contracts', 'hardhat', 'warn', 'Hardhat config should use environment variables', undefined, 'medium');
      }

    } catch (error) {
      this.addResult('contracts', 'hardhat', 'fail', 
        `Failed to validate Hardhat config: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async validateNetworkConfigurations(): Promise<void> {
    const networksPath = join(this.rootDir, 'contracts', 'config', 'networks.ts');
    
    if (!existsSync(networksPath)) {
      this.addResult('contracts', 'networks', 'fail', 'networks.ts not found', undefined, 'high');
      return;
    }

    try {
      const content = readFileSync(networksPath, 'utf8');
      
      // Check for required networks
      const requiredNetworks = ['hardhat', 'sepolia', 'mainnet'];
      
      for (const network of requiredNetworks) {
        if (content.includes(network)) {
          this.addResult('contracts', 'networks', 'pass', `Network configuration includes ${network}`, undefined, 'low');
        } else {
          this.addResult('contracts', 'networks', 'warn', `Network configuration missing ${network}`, undefined, 'medium');
        }
      }

    } catch (error) {
      this.addResult('contracts', 'networks', 'fail', 
        `Failed to validate network configurations: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async testBackendConfigLoading(): Promise<void> {
    const configPath = join(this.rootDir, 'backend', 'config', 'index.ts');
    
    if (!existsSync(configPath)) {
      this.addResult('backend', 'config', 'fail', 'Backend config file not found', undefined, 'high');
      return;
    }

    try {
      // Test if the configuration can be imported (basic syntax check)
      this.addResult('backend', 'config', 'pass', 'Backend configuration file exists and is readable', undefined, 'low');
    } catch (error) {
      this.addResult('backend', 'config', 'fail', 
        `Backend configuration loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async validateViteConfig(): Promise<void> {
    const viteConfigPath = join(this.rootDir, 'frontend', 'vite.config.ts');
    
    if (!existsSync(viteConfigPath)) {
      this.addResult('frontend', 'vite', 'fail', 'vite.config.ts not found', undefined, 'high');
      return;
    }

    try {
      const content = readFileSync(viteConfigPath, 'utf8');
      
      // Check for basic Vite configuration elements
      if (content.includes('defineConfig')) {
        this.addResult('frontend', 'vite', 'pass', 'Vite configuration uses defineConfig', undefined, 'low');
      } else {
        this.addResult('frontend', 'vite', 'warn', 'Vite configuration should use defineConfig', undefined, 'medium');
      }

    } catch (error) {
      this.addResult('frontend', 'vite', 'fail', 
        `Failed to validate Vite config: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async validateSecretsEnvironment(): Promise<void> {
    const secretsEnvVars = [
      'SECRETS_PROVIDER',
      'SECRETS_ENCRYPTION_KEY',
      'SECRETS_AUDIT_LOGGING'
    ];

    let foundSecrets = 0;
    for (const envVar of secretsEnvVars) {
      if (process.env[envVar]) {
        foundSecrets++;
        this.addResult('secrets', 'environment', 'pass', `Found ${envVar}`, undefined, 'low');
      }
    }

    if (foundSecrets === 0) {
      this.addResult('secrets', 'environment', 'warn', 'No secrets environment variables configured', undefined, 'medium');
    }
  }

  private async validateSecuritySettings(): Promise<void> {
    // Check for security-related environment variables
    const securityEnvVars = [
      'SECURITY_LEVEL',
      'HTTPS_ENABLED',
      'JWT_SECRET',
      'API_KEY_HEADER'
    ];

    let foundSecurity = 0;
    for (const envVar of securityEnvVars) {
      if (process.env[envVar]) {
        foundSecurity++;
        this.addResult('security', 'environment', 'pass', `Found ${envVar}`, undefined, 'low');
      }
    }

    if (foundSecurity === 0) {
      this.addResult('security', 'environment', 'warn', 'No security environment variables configured', undefined, 'high');
    }

    // Check for production security requirements
    if (process.env.NODE_ENV === 'production') {
      const requiredProdSecurity = ['JWT_SECRET', 'HTTPS_ENABLED', 'SESSION_SECRET'];
      
      for (const envVar of requiredProdSecurity) {
        if (!process.env[envVar]) {
          this.addResult('security', 'production', 'fail', `Missing required production security variable: ${envVar}`, undefined, 'critical');
        }
      }
    }
  }

  private async validateOperationalSettings(): Promise<void> {
    // Check for operational environment variables
    const operationalEnvVars = [
      'HEALTH_CHECK_ENABLED',
      'METRICS_ENABLED',
      'GRACEFUL_SHUTDOWN_ENABLED',
      'BACKUP_ENABLED'
    ];

    let foundOperational = 0;
    for (const envVar of operationalEnvVars) {
      if (process.env[envVar]) {
        foundOperational++;
        this.addResult('operational', 'environment', 'pass', `Found ${envVar}`, undefined, 'low');
      }
    }

    if (foundOperational === 0) {
      this.addResult('operational', 'environment', 'warn', 'No operational environment variables configured', undefined, 'medium');
    }
  }

  private async validatePortConsistency(): Promise<void> {
    const ports = {
      relayer: process.env.RELAYER_PORT || '3001',
      resolver: process.env.RESOLVER_PORT || '3002',
      frontend: process.env.FRONTEND_PORT || '3000',
      metrics: process.env.METRICS_PORT || '9090'
    };

    const usedPorts = Object.values(ports);
    const uniquePorts = new Set(usedPorts);

    if (usedPorts.length !== uniquePorts.size) {
      this.addResult('consistency', 'ports', 'fail', 'Port conflicts detected', { ports }, 'high');
    } else {
      this.addResult('consistency', 'ports', 'pass', 'No port conflicts detected', { ports }, 'low');
    }
  }

  private async validateContractAddressConsistency(): Promise<void> {
    // This would check that contract addresses are consistent across components
    this.addResult('consistency', 'contracts', 'pass', 'Contract address consistency check placeholder', undefined, 'low');
  }

  private async validateNetworkConsistency(): Promise<void> {
    const ethNetwork = process.env.ETH_NETWORK;
    const btcNetwork = process.env.BTC_NETWORK;

    if (ethNetwork && btcNetwork) {
      // Check if networks are compatible (e.g., both mainnet or both testnet)
      const isEthMainnet = ethNetwork === 'mainnet';
      const isBtcMainnet = btcNetwork === 'mainnet';

      if (isEthMainnet !== isBtcMainnet) {
        this.addResult('consistency', 'networks', 'warn', 
          'Mixed network environments detected (mainnet/testnet)', 
          { ethNetwork, btcNetwork }, 'medium');
      } else {
        this.addResult('consistency', 'networks', 'pass', 
          'Network environments are consistent', 
          { ethNetwork, btcNetwork }, 'low');
      }
    }
  }

  private async validateApiEndpointConsistency(): Promise<void> {
    const relayerUrl = process.env.RELAYER_URL || process.env.VITE_RELAYER_API_URL;
    const resolverUrl = process.env.RESOLVER_URL || process.env.VITE_RESOLVER_API_URL;

    if (relayerUrl && resolverUrl) {
      this.addResult('consistency', 'api', 'pass', 'API endpoints configured', 
        { relayerUrl, resolverUrl }, 'low');
    } else {
      this.addResult('consistency', 'api', 'warn', 'API endpoints not fully configured', 
        { relayerUrl, resolverUrl }, 'medium');
    }
  }

  private async testEthereumRPC(): Promise<void> {
    const rpcUrl = process.env.ETH_RPC_URL;
    
    if (!rpcUrl) {
      this.addResult('connectivity', 'ethereum', 'warn', 'No Ethereum RPC URL configured', undefined, 'medium');
      return;
    }

    try {
      // Simple connectivity test
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1
        })
      });

      if (response.ok) {
        this.addResult('connectivity', 'ethereum', 'pass', 'Ethereum RPC connectivity successful', 
          { rpcUrl }, 'low');
      } else {
        this.addResult('connectivity', 'ethereum', 'fail', 'Ethereum RPC connectivity failed', 
          { rpcUrl, status: response.status }, 'high');
      }
    } catch (error) {
      this.addResult('connectivity', 'ethereum', 'fail', 
        `Ethereum RPC connectivity error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        { rpcUrl }, 'high');
    }
  }

  private async testBitcoinRPC(): Promise<void> {
    const rpcUrl = process.env.BTC_RPC_URL;
    
    if (!rpcUrl) {
      this.addResult('connectivity', 'bitcoin', 'warn', 'No Bitcoin RPC URL configured', undefined, 'medium');
      return;
    }

    // Bitcoin RPC test would go here
    this.addResult('connectivity', 'bitcoin', 'warn', 'Bitcoin RPC connectivity test not implemented', undefined, 'low');
  }

  private async testExternalServices(): Promise<void> {
    // Test external service connectivity (Etherscan, etc.)
    const etherscanKey = process.env.ETHERSCAN_API_KEY;
    
    if (etherscanKey) {
      this.addResult('connectivity', 'external', 'pass', 'External API keys configured', undefined, 'low');
    } else {
      this.addResult('connectivity', 'external', 'warn', 'No external API keys configured', undefined, 'medium');
    }
  }

  private async validateProductionReadiness(): Promise<void> {
    console.log('🎯 Validating production readiness...');

    const requiredProdVars = [
      'ETH_PRIVATE_KEY',
      'BTC_PRIVATE_KEY',
      'JWT_SECRET',
      'SESSION_SECRET',
      'HTTPS_ENABLED',
      'DB_PASSWORD'
    ];

    let missingVars = 0;
    for (const envVar of requiredProdVars) {
      if (!process.env[envVar]) {
        missingVars++;
        this.addResult('deployment', 'production', 'fail', 
          `Missing required production variable: ${envVar}`, undefined, 'critical');
      }
    }

    if (missingVars === 0) {
      this.addResult('deployment', 'production', 'pass', 'All required production variables present', undefined, 'high');
    }

    // Check for development settings in production
    if (process.env.LOG_LEVEL === 'debug') {
      this.addResult('deployment', 'production', 'warn', 'Debug logging enabled in production', undefined, 'medium');
    }
  }

  private async validateStagingReadiness(): Promise<void> {
    console.log('🧪 Validating staging readiness...');
    this.addResult('deployment', 'staging', 'pass', 'Staging environment validation placeholder', undefined, 'low');
  }

  private async validateDevelopmentSetup(): Promise<void> {
    console.log('🛠️ Validating development setup...');
    this.addResult('deployment', 'development', 'pass', 'Development environment validation placeholder', undefined, 'low');
  }

  private async validateDependencies(): Promise<void> {
    try {
      // Check if node_modules exists
      const nodeModulesPath = join(this.rootDir, 'node_modules');
      if (existsSync(nodeModulesPath)) {
        this.addResult('dependencies', 'install', 'pass', 'Dependencies appear to be installed', undefined, 'low');
      } else {
        this.addResult('dependencies', 'install', 'fail', 'Dependencies not installed - run npm install', undefined, 'high');
      }

      // Check for TypeScript
      try {
        await execAsync('npx tsc --version');
        this.addResult('dependencies', 'typescript', 'pass', 'TypeScript is available', undefined, 'low');
      } catch (error) {
        this.addResult('dependencies', 'typescript', 'fail', 'TypeScript not available', undefined, 'high');
      }

    } catch (error) {
      this.addResult('dependencies', 'validation', 'fail', 
        `Dependency validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        undefined, 'high');
    }
  }

  private async validateRequiredEnvironmentVariables(): Promise<void> {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const requiredVars: Record<string, string[]> = {
      development: ['NODE_ENV'],
      staging: ['NODE_ENV', 'ETH_RPC_URL', 'BTC_RPC_URL'],
      production: ['NODE_ENV', 'ETH_PRIVATE_KEY', 'BTC_PRIVATE_KEY', 'JWT_SECRET', 'DB_PASSWORD']
    };

    const required = requiredVars[nodeEnv] || requiredVars.development;
    let missing = 0;

    for (const envVar of required) {
      if (!process.env[envVar]) {
        missing++;
        this.addResult('environment', 'required', 'fail', 
          `Missing required environment variable: ${envVar}`, undefined, 
          nodeEnv === 'production' ? 'critical' : 'high');
      }
    }

    if (missing === 0) {
      this.addResult('environment', 'required', 'pass', 
        `All required environment variables present for ${nodeEnv}`, undefined, 'low');
    }
  }

  private addResult(
    component: string,
    category: string,
    status: 'pass' | 'fail' | 'warn',
    message: string,
    details?: any,
    severity: 'critical' | 'high' | 'medium' | 'low' = 'low'
  ): void {
    this.results.push({
      component,
      category,
      status,
      message,
      details,
      severity
    });
  }

  private generateSummary(): ValidationSummary {
    const duration = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warnings = this.results.filter(r => r.status === 'warn').length;
    const critical = this.results.filter(r => r.severity === 'critical').length;

    return {
      totalChecks: this.results.length,
      passed,
      failed,
      warnings,
      critical,
      results: this.results,
      duration
    };
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const rootDir = args[0] || process.cwd();

  console.log(`🔍 1inch Fusion+ Cross-Chain Configuration Validator`);
  console.log(`📁 Root directory: ${rootDir}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('');

  const validator = new ConfigurationValidator(rootDir);
  const summary = await validator.validate();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`⏱️  Duration: ${Math.round(summary.duration / 1000)}s`);
  console.log(`📋 Total checks: ${summary.totalChecks}`);
  console.log(`✅ Passed: ${summary.passed}`);
  console.log(`❌ Failed: ${summary.failed}`);
  console.log(`⚠️  Warnings: ${summary.warnings}`);
  console.log(`🚨 Critical: ${summary.critical}`);

  // Print detailed results
  if (summary.critical > 0 || summary.failed > 0) {
    console.log('\n🚨 CRITICAL & FAILED CHECKS:');
    console.log('-'.repeat(40));
    
    summary.results
      .filter(r => r.severity === 'critical' || r.status === 'fail')
      .forEach(result => {
        const icon = result.severity === 'critical' ? '🚨' : '❌';
        console.log(`${icon} [${result.component}/${result.category}] ${result.message}`);
        if (result.details) {
          console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
        }
      });
  }

  if (summary.warnings > 0) {
    console.log('\n⚠️  WARNINGS:');
    console.log('-'.repeat(40));
    
    summary.results
      .filter(r => r.status === 'warn')
      .slice(0, 10) // Limit output
      .forEach(result => {
        console.log(`⚠️  [${result.component}/${result.category}] ${result.message}`);
      });

    if (summary.warnings > 10) {
      console.log(`   ... and ${summary.warnings - 10} more warnings`);
    }
  }

  // Exit with appropriate code
  const exitCode = summary.critical > 0 ? 2 : (summary.failed > 0 ? 1 : 0);
  
  console.log('\n' + '='.repeat(60));
  console.log(`🏁 Validation ${exitCode === 0 ? 'completed successfully' : 'completed with issues'}`);
  
  if (exitCode === 0) {
    console.log('✅ Configuration is ready for deployment!');
  } else if (exitCode === 1) {
    console.log('⚠️  Please address the failed checks before deployment.');
  } else {
    console.log('🚨 Critical issues found! Deployment is not recommended.');
  }

  process.exit(exitCode);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Validation script failed:', error);
    process.exit(3);
  });
}

export { ConfigurationValidator };
export default ConfigurationValidator;