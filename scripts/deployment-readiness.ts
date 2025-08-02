#!/usr/bin/env node

/**
 * Deployment Readiness Script
 * 
 * Comprehensive deployment readiness assessment for production environments:
 * - Environment configuration validation
 * - Security compliance checks
 * - Performance requirements verification
 * - Infrastructure readiness assessment
 * - Dependency verification
 * - Rollback plan validation
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

interface DeploymentCheck {
  category: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  details?: any;
  recommendation?: string;
}

interface DeploymentAssessment {
  environment: string;
  timestamp: number;
  overallStatus: 'ready' | 'not-ready' | 'ready-with-warnings';
  readinessScore: number; // 0-100
  checks: DeploymentCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    critical: number;
  };
  blockers: DeploymentCheck[];
  recommendations: string[];
}

class DeploymentReadinessChecker {
  private environment: string;
  private checks: DeploymentCheck[] = [];

  constructor(environment: string = process.env.NODE_ENV || 'production') {
    this.environment = environment;
  }

  /**
   * Perform comprehensive deployment readiness assessment
   */
  async assessDeploymentReadiness(): Promise<DeploymentAssessment> {
    console.log(`🚀 Assessing deployment readiness for ${this.environment} environment...\n`);

    // Environment-specific checks
    if (this.environment === 'production') {
      await this.performProductionChecks();
    } else if (this.environment === 'staging') {
      await this.performStagingChecks();
    } else {
      await this.performDevelopmentChecks();
    }

    // Common checks for all environments
    await this.performCommonChecks();

    // Generate assessment
    return this.generateAssessment();
  }

  private async performProductionChecks(): Promise<void> {
    console.log('🎯 Running production-specific checks...');

    // Security checks
    await this.checkProductionSecurityRequirements();
    await this.checkSSLCertificates();
    await this.checkSecretsConfiguration();

    // Performance checks
    await this.checkPerformanceOptimizations();
    await this.checkResourceLimits();

    // Monitoring checks
    await this.checkMonitoringSetup();
    await this.checkAlertingConfiguration();

    // Backup and recovery
    await this.checkBackupConfiguration();
    await this.checkDisasterRecoveryPlan();

    // Compliance checks
    await this.checkComplianceRequirements();
  }

  private async performStagingChecks(): Promise<void> {
    console.log('🧪 Running staging-specific checks...');

    // Environment similarity
    await this.checkProductionSimilarity();
    await this.checkTestDataConfiguration();
    await this.checkStagingSecurityBaseline();
  }

  private async performDevelopmentChecks(): Promise<void> {
    console.log('🛠️ Running development-specific checks...');

    // Development setup
    await this.checkDevelopmentDependencies();
    await this.checkLocalServices();
    await this.checkTestConfiguration();
  }

  private async performCommonChecks(): Promise<void> {
    console.log('🔧 Running common deployment checks...');

    // Configuration validation
    await this.checkEnvironmentVariables();
    await this.checkConfigurationFiles();

    // Dependencies
    await this.checkDependenciesInstalled();
    await this.checkDependencyVersions();

    // Build artifacts
    await this.checkBuildArtifacts();
    await this.checkContractArtifacts();

    // Network connectivity
    await this.checkNetworkConnectivity();
    await this.checkExternalDependencies();

    // Database readiness
    await this.checkDatabaseConfiguration();
    await this.checkDatabaseMigrations();

    // Service configuration
    await this.checkServiceConfiguration();
    await this.checkPortConfiguration();
  }

  // Production-specific checks

  private async checkProductionSecurityRequirements(): Promise<void> {
    const requiredSecrets = [
      'ETH_PRIVATE_KEY',
      'BTC_PRIVATE_KEY',
      'JWT_SECRET',
      'SESSION_SECRET',
      'API_SECRET_KEY',
      'SECRETS_ENCRYPTION_KEY'
    ];

    let missingSecrets = 0;
    for (const secret of requiredSecrets) {
      if (!process.env[secret]) {
        missingSecrets++;
        this.addCheck('security', 'production-secrets', 'fail', 'critical',
          `Missing required production secret: ${secret}`,
          undefined,
          'Set the required secret in environment variables or secrets manager'
        );
      }
    }

    if (missingSecrets === 0) {
      this.addCheck('security', 'production-secrets', 'pass', 'high',
        'All required production secrets are configured'
      );
    }

    // Check for insecure defaults
    const insecureDefaults = [
      { key: 'JWT_SECRET', insecureValues: ['secret', 'default', 'changeme'] },
      { key: 'SESSION_SECRET', insecureValues: ['secret', 'default', 'changeme'] },
      { key: 'DB_PASSWORD', insecureValues: ['password', '123456', 'admin'] }
    ];

    for (const check of insecureDefaults) {
      const value = process.env[check.key];
      if (value && check.insecureValues.some(insecure => 
        value.toLowerCase().includes(insecure.toLowerCase()))) {
        this.addCheck('security', 'insecure-defaults', 'fail', 'high',
          `Insecure default value detected for ${check.key}`,
          undefined,
          'Use a strong, randomly generated value'
        );
      }
    }
  }

  private async checkSSLCertificates(): Promise<void> {
    const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
    const certPath = process.env.TLS_CERT_PATH;
    const keyPath = process.env.TLS_KEY_PATH;

    if (!httpsEnabled) {
      this.addCheck('security', 'ssl-configuration', 'fail', 'critical',
        'HTTPS is not enabled for production deployment',
        { httpsEnabled },
        'Enable HTTPS by setting HTTPS_ENABLED=true and providing SSL certificates'
      );
      return;
    }

    if (!certPath || !keyPath) {
      this.addCheck('security', 'ssl-certificates', 'fail', 'critical',
        'SSL certificate paths not configured',
        { certPath, keyPath },
        'Provide paths to SSL certificate and key files'
      );
      return;
    }

    // Check if certificate files exist
    const certExists = existsSync(certPath);
    const keyExists = existsSync(keyPath);

    if (!certExists || !keyExists) {
      this.addCheck('security', 'ssl-files', 'fail', 'critical',
        'SSL certificate files not found',
        { certExists, keyExists, certPath, keyPath },
        'Ensure SSL certificate and key files are present at specified paths'
      );
    } else {
      // Check certificate expiration (basic check)
      try {
        const certContent = readFileSync(certPath, 'utf8');
        if (certContent.includes('-----BEGIN CERTIFICATE-----')) {
          this.addCheck('security', 'ssl-files', 'pass', 'high',
            'SSL certificate files are present and valid format'
          );
        } else {
          this.addCheck('security', 'ssl-files', 'warn', 'medium',
            'SSL certificate file format could not be verified'
          );
        }
      } catch (error) {
        this.addCheck('security', 'ssl-files', 'fail', 'high',
          'Failed to read SSL certificate file',
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Check file permissions and certificate validity'
        );
      }
    }
  }

  private async checkSecretsConfiguration(): Promise<void> {
    const secretsProvider = process.env.SECRETS_PROVIDER || 'env';
    const auditLogging = process.env.SECRETS_AUDIT_LOGGING === 'true';

    if (secretsProvider === 'env' && this.environment === 'production') {
      this.addCheck('security', 'secrets-provider', 'warn', 'medium',
        'Using environment variables for secrets in production',
        { provider: secretsProvider },
        'Consider using a dedicated secrets management system like Vault or cloud provider secrets'
      );
    } else {
      this.addCheck('security', 'secrets-provider', 'pass', 'medium',
        `Secrets provider configured: ${secretsProvider}`
      );
    }

    if (!auditLogging) {
      this.addCheck('security', 'secrets-audit', 'warn', 'medium',
        'Secrets audit logging is disabled',
        { auditLogging },
        'Enable secrets audit logging for compliance and security monitoring'
      );
    }
  }

  private async checkPerformanceOptimizations(): Promise<void> {
    const compressionEnabled = process.env.COMPRESSION_ENABLED !== 'false';
    const cachingEnabled = process.env.CACHING_ENABLED !== 'false';

    if (!compressionEnabled) {
      this.addCheck('performance', 'compression', 'warn', 'medium',
        'Response compression is disabled',
        { compressionEnabled },
        'Enable compression to reduce bandwidth usage and improve response times'
      );
    }

    if (!cachingEnabled) {
      this.addCheck('performance', 'caching', 'warn', 'medium',
        'Caching is disabled',
        { cachingEnabled },
        'Enable caching to improve application performance'
      );
    }

    if (compressionEnabled && cachingEnabled) {
      this.addCheck('performance', 'optimizations', 'pass', 'low',
        'Performance optimizations are enabled'
      );
    }
  }

  private async checkResourceLimits(): Promise<void> {
    const maxMemory = parseInt(process.env.MAX_MEMORY_USAGE || '0');
    const maxConnections = parseInt(process.env.MAX_CONNECTIONS || '0');

    if (maxMemory === 0) {
      this.addCheck('performance', 'memory-limits', 'warn', 'medium',
        'Memory limits not configured',
        { maxMemory },
        'Set MAX_MEMORY_USAGE to prevent memory exhaustion'
      );
    }

    if (maxConnections === 0) {
      this.addCheck('performance', 'connection-limits', 'warn', 'medium',
        'Connection limits not configured',
        { maxConnections },
        'Set MAX_CONNECTIONS to prevent connection exhaustion'
      );
    }
  }

  private async checkMonitoringSetup(): Promise<void> {
    const metricsEnabled = process.env.METRICS_ENABLED !== 'false';
    const healthCheckEnabled = process.env.HEALTH_CHECK_ENABLED !== 'false';
    const sentryDsn = process.env.SENTRY_DSN;

    if (!metricsEnabled) {
      this.addCheck('monitoring', 'metrics', 'fail', 'high',
        'Metrics collection is disabled',
        { metricsEnabled },
        'Enable metrics collection for production monitoring'
      );
    }

    if (!healthCheckEnabled) {
      this.addCheck('monitoring', 'health-checks', 'fail', 'high',
        'Health checks are disabled',
        { healthCheckEnabled },
        'Enable health checks for service monitoring'
      );
    }

    if (!sentryDsn) {
      this.addCheck('monitoring', 'error-tracking', 'warn', 'medium',
        'Error tracking not configured',
        { sentryDsn: !!sentryDsn },
        'Configure Sentry or another error tracking service'
      );
    }

    if (metricsEnabled && healthCheckEnabled) {
      this.addCheck('monitoring', 'setup', 'pass', 'medium',
        'Basic monitoring is configured'
      );
    }
  }

  private async checkAlertingConfiguration(): Promise<void> {
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    const emailRecipients = process.env.ALERT_EMAIL_RECIPIENTS;

    if (!slackWebhook && !emailRecipients) {
      this.addCheck('monitoring', 'alerting', 'warn', 'medium',
        'No alerting channels configured',
        { slackWebhook: !!slackWebhook, emailRecipients: !!emailRecipients },
        'Configure Slack webhook or email recipients for alerts'
      );
    } else {
      this.addCheck('monitoring', 'alerting', 'pass', 'medium',
        'Alerting channels configured'
      );
    }
  }

  private async checkBackupConfiguration(): Promise<void> {
    const backupEnabled = process.env.BACKUP_ENABLED === 'true';
    const backupLocation = process.env.BACKUP_S3_BUCKET || process.env.BACKUP_PATH;

    if (!backupEnabled) {
      this.addCheck('backup', 'enabled', 'warn', 'medium',
        'Automated backups are disabled',
        { backupEnabled },
        'Enable automated backups for data protection'
      );
    } else if (!backupLocation) {
      this.addCheck('backup', 'location', 'fail', 'high',
        'Backup location not configured',
        { backupLocation },
        'Configure backup storage location (S3 bucket or local path)'
      );
    } else {
      this.addCheck('backup', 'configuration', 'pass', 'medium',
        'Backup configuration is complete'
      );
    }
  }

  private async checkDisasterRecoveryPlan(): Promise<void> {
    // Check for disaster recovery documentation
    const drPlanExists = existsSync(join(process.cwd(), 'docs', 'disaster-recovery.md'));
    
    if (!drPlanExists) {
      this.addCheck('backup', 'disaster-recovery', 'warn', 'medium',
        'Disaster recovery plan not found',
        { planExists: drPlanExists },
        'Create and maintain a disaster recovery plan document'
      );
    } else {
      this.addCheck('backup', 'disaster-recovery', 'pass', 'medium',
        'Disaster recovery plan documentation found'
      );
    }
  }

  private async checkComplianceRequirements(): Promise<void> {
    const auditLogging = process.env.AUDIT_ENABLED === 'true';
    const dataEncryption = process.env.ENCRYPTION_AT_REST_ENABLED === 'true';
    const accessControls = process.env.AUTHORIZATION_ENABLED === 'true';

    if (!auditLogging) {
      this.addCheck('compliance', 'audit-logging', 'warn', 'medium',
        'Audit logging is disabled',
        { auditLogging },
        'Enable audit logging for compliance requirements'
      );
    }

    if (!dataEncryption) {
      this.addCheck('compliance', 'data-encryption', 'warn', 'high',
        'Data encryption at rest is disabled',
        { dataEncryption },
        'Enable data encryption for sensitive information protection'
      );
    }

    if (!accessControls) {
      this.addCheck('compliance', 'access-controls', 'fail', 'high',
        'Access controls are disabled',
        { accessControls },
        'Enable authorization and access control mechanisms'
      );
    }
  }

  // Common checks

  private async checkEnvironmentVariables(): Promise<void> {
    const envFile = `.env.${this.environment}`;
    const envPath = join(process.cwd(), envFile);

    if (!existsSync(envPath)) {
      this.addCheck('configuration', 'environment-file', 'warn', 'low',
        `Environment file ${envFile} not found`,
        { envPath },
        `Create ${envFile} with environment-specific configurations`
      );
    }

    // Check for NODE_ENV consistency
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv !== this.environment) {
      this.addCheck('configuration', 'node-env', 'warn', 'medium',
        `NODE_ENV (${nodeEnv}) doesn't match target environment (${this.environment})`,
        { nodeEnv, targetEnv: this.environment },
        'Ensure NODE_ENV matches the deployment environment'
      );
    }
  }

  private async checkConfigurationFiles(): Promise<void> {
    const configFiles = [
      'config/index.ts',
      'config/environments/production.ts'
    ];

    for (const file of configFiles) {
      const filePath = join(process.cwd(), file);
      if (existsSync(filePath)) {
        this.addCheck('configuration', 'config-files', 'pass', 'low',
          `Configuration file exists: ${file}`
        );
      } else {
        this.addCheck('configuration', 'config-files', 'warn', 'medium',
          `Configuration file missing: ${file}`,
          { filePath },
          'Ensure all required configuration files are present'
        );
      }
    }
  }

  private async checkDependenciesInstalled(): Promise<void> {
    const nodeModulesExists = existsSync(join(process.cwd(), 'node_modules'));

    if (!nodeModulesExists) {
      this.addCheck('dependencies', 'installation', 'fail', 'critical',
        'Dependencies not installed',
        { nodeModulesExists },
        'Run npm install or yarn install to install dependencies'
      );
      return;
    }

    try {
      // Check package-lock.json exists
      const packageLockExists = existsSync(join(process.cwd(), 'package-lock.json'));
      const yarnLockExists = existsSync(join(process.cwd(), 'yarn.lock'));

      if (!packageLockExists && !yarnLockExists) {
        this.addCheck('dependencies', 'lockfile', 'warn', 'medium',
          'No lock file found (package-lock.json or yarn.lock)',
          { packageLockExists, yarnLockExists },
          'Use a lock file to ensure consistent dependency versions'
        );
      } else {
        this.addCheck('dependencies', 'installation', 'pass', 'medium',
          'Dependencies are installed with lock file'
        );
      }

    } catch (error) {
      this.addCheck('dependencies', 'installation', 'fail', 'high',
        'Failed to verify dependency installation',
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Check dependency installation and resolve any issues'
      );
    }
  }

  private async checkDependencyVersions(): Promise<void> {
    try {
      // Check for security vulnerabilities
      const { stdout } = await execAsync('npm audit --audit-level moderate --json', { 
        timeout: 30000 
      });
      
      const auditResult = JSON.parse(stdout);
      const vulnerabilities = auditResult.metadata?.vulnerabilities || {};
      const totalVulns = Object.values(vulnerabilities).reduce((sum: number, count: any) => sum + count, 0);

      if (totalVulns > 0) {
        const critical = vulnerabilities.critical || 0;
        const high = vulnerabilities.high || 0;
        
        const severity = critical > 0 ? 'critical' : (high > 0 ? 'high' : 'medium');
        
        this.addCheck('dependencies', 'security', 'fail', severity,
          `Found ${totalVulns} security vulnerabilities in dependencies`,
          { vulnerabilities },
          'Run npm audit fix to resolve security vulnerabilities'
        );
      } else {
        this.addCheck('dependencies', 'security', 'pass', 'medium',
          'No security vulnerabilities found in dependencies'
        );
      }

    } catch (error) {
      this.addCheck('dependencies', 'security', 'warn', 'low',
        'Could not run security audit',
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Ensure npm is available and run npm audit manually'
      );
    }
  }

  private async checkBuildArtifacts(): Promise<void> {
    // Check for TypeScript compilation
    try {
      await execAsync('npx tsc --noEmit', { timeout: 60000 });
      this.addCheck('build', 'typescript', 'pass', 'medium',
        'TypeScript compilation successful'
      );
    } catch (error) {
      this.addCheck('build', 'typescript', 'fail', 'high',
        'TypeScript compilation failed',
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Fix TypeScript compilation errors before deployment'
      );
    }

    // Check for frontend build artifacts
    const frontendDistExists = existsSync(join(process.cwd(), 'frontend', 'dist'));
    if (existsSync(join(process.cwd(), 'frontend'))) {
      if (frontendDistExists) {
        this.addCheck('build', 'frontend', 'pass', 'medium',
          'Frontend build artifacts found'
        );
      } else {
        this.addCheck('build', 'frontend', 'warn', 'medium',
          'Frontend build artifacts not found',
          { distExists: frontendDistExists },
          'Run frontend build process (npm run build)'
        );
      }
    }
  }

  private async checkContractArtifacts(): Promise<void> {
    const contractsDir = join(process.cwd(), 'contracts');
    if (!existsSync(contractsDir)) {
      this.addCheck('contracts', 'directory', 'skip', 'low',
        'Contracts directory not found, skipping contract checks'
      );
      return;
    }

    const artifactsExists = existsSync(join(contractsDir, 'artifacts'));
    if (artifactsExists) {
      this.addCheck('contracts', 'compilation', 'pass', 'medium',
        'Contract artifacts found'
      );
    } else {
      this.addCheck('contracts', 'compilation', 'warn', 'medium',
        'Contract artifacts not found',
        { artifactsExists },
        'Compile contracts using: cd contracts && npm run build'
      );
    }

    // Check for deployment addresses
    const deploymentExists = existsSync(join(process.cwd(), 'deployment'));
    if (deploymentExists) {
      this.addCheck('contracts', 'deployment', 'pass', 'medium',
        'Contract deployment records found'
      );
    } else {
      this.addCheck('contracts', 'deployment', 'warn', 'medium',
        'No contract deployment records found',
        { deploymentExists },
        'Deploy contracts to target network before deploying services'
      );
    }
  }

  private async checkNetworkConnectivity(): Promise<void> {
    const ethRpcUrl = process.env.ETH_RPC_URL;
    const btcRpcUrl = process.env.BTC_RPC_URL;

    // Test Ethereum connectivity
    if (ethRpcUrl) {
      try {
        const response = await fetch(ethRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          this.addCheck('connectivity', 'ethereum', 'pass', 'high',
            'Ethereum RPC connectivity successful'
          );
        } else {
          this.addCheck('connectivity', 'ethereum', 'fail', 'high',
            'Ethereum RPC connectivity failed',
            { status: response.status },
            'Check Ethereum RPC URL and network connectivity'
          );
        }
      } catch (error) {
        this.addCheck('connectivity', 'ethereum', 'fail', 'high',
          'Ethereum RPC connection error',
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Verify Ethereum RPC URL and network access'
        );
      }
    } else {
      this.addCheck('connectivity', 'ethereum', 'warn', 'high',
        'Ethereum RPC URL not configured',
        { ethRpcUrl },
        'Configure ETH_RPC_URL environment variable'
      );
    }

    // Test Bitcoin connectivity (if configured)
    if (btcRpcUrl) {
      this.addCheck('connectivity', 'bitcoin', 'skip', 'medium',
        'Bitcoin RPC connectivity test not implemented'
      );
    }
  }

  private async checkExternalDependencies(): Promise<void> {
    const etherscanKey = process.env.ETHERSCAN_API_KEY;
    
    if (etherscanKey) {
      try {
        const response = await fetch(
          `https://api.etherscan.io/api?module=stats&action=ethsupply&apikey=${etherscanKey}`,
          { signal: AbortSignal.timeout(10000) }
        );

        if (response.ok) {
          this.addCheck('external', 'etherscan', 'pass', 'medium',
            'Etherscan API connectivity successful'
          );
        } else {
          this.addCheck('external', 'etherscan', 'warn', 'medium',
            'Etherscan API connectivity issues',
            { status: response.status },
            'Check Etherscan API key and rate limits'
          );
        }
      } catch (error) {
        this.addCheck('external', 'etherscan', 'warn', 'medium',
          'Etherscan API connection failed',
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Verify Etherscan API key and network connectivity'
        );
      }
    }
  }

  private async checkDatabaseConfiguration(): Promise<void> {
    const dbType = process.env.DB_TYPE;
    const dbHost = process.env.DB_HOST;
    const dbName = process.env.DB_NAME;
    const dbPassword = process.env.DB_PASSWORD;

    if (!dbType) {
      this.addCheck('database', 'configuration', 'warn', 'medium',
        'Database type not configured',
        { dbType },
        'Configure DB_TYPE environment variable'
      );
      return;
    }

    if (!dbHost || !dbName) {
      this.addCheck('database', 'configuration', 'fail', 'high',
        'Database connection details incomplete',
        { dbHost: !!dbHost, dbName: !!dbName },
        'Configure DB_HOST and DB_NAME environment variables'
      );
      return;
    }

    if (!dbPassword && this.environment === 'production') {
      this.addCheck('database', 'security', 'fail', 'critical',
        'Database password not configured for production',
        { passwordConfigured: !!dbPassword },
        'Set DB_PASSWORD environment variable for production'
      );
    } else {
      this.addCheck('database', 'configuration', 'pass', 'medium',
        'Database configuration appears complete'
      );
    }
  }

  private async checkDatabaseMigrations(): Promise<void> {
    // This would check if database migrations are up to date
    // For now, just check if migration files exist
    const migrationsDir = join(process.cwd(), 'migrations');
    if (existsSync(migrationsDir)) {
      this.addCheck('database', 'migrations', 'pass', 'medium',
        'Database migrations directory found'
      );
    } else {
      this.addCheck('database', 'migrations', 'skip', 'low',
        'No database migrations directory found'
      );
    }
  }

  private async checkServiceConfiguration(): Promise<void> {
    const relayerPort = process.env.RELAYER_PORT;
    const resolverPort = process.env.RESOLVER_PORT;
    const frontendPort = process.env.FRONTEND_PORT;

    if (!relayerPort || !resolverPort) {
      this.addCheck('services', 'ports', 'fail', 'high',
        'Service ports not configured',
        { relayerPort: !!relayerPort, resolverPort: !!resolverPort },
        'Configure RELAYER_PORT and RESOLVER_PORT environment variables'
      );
    } else {
      this.addCheck('services', 'ports', 'pass', 'medium',
        'Service ports configured'
      );
    }
  }

  private async checkPortConfiguration(): Promise<void> {
    const ports = [
      process.env.RELAYER_PORT,
      process.env.RESOLVER_PORT,
      process.env.FRONTEND_PORT,
      process.env.METRICS_PORT
    ].filter(Boolean);

    const uniquePorts = new Set(ports);
    
    if (ports.length !== uniquePorts.size) {
      this.addCheck('services', 'port-conflicts', 'fail', 'high',
        'Port conflicts detected',
        { ports },
        'Ensure all services use unique port numbers'
      );
    } else {
      this.addCheck('services', 'port-conflicts', 'pass', 'medium',
        'No port conflicts detected'
      );
    }
  }

  // Development-specific checks

  private async checkDevelopmentDependencies(): Promise<void> {
    try {
      await execAsync('which node', { timeout: 5000 });
      this.addCheck('development', 'node', 'pass', 'high', 'Node.js is available');
    } catch (error) {
      this.addCheck('development', 'node', 'fail', 'critical', 'Node.js not found');
    }

    try {
      await execAsync('which npm', { timeout: 5000 });
      this.addCheck('development', 'npm', 'pass', 'high', 'npm is available');
    } catch (error) {
      this.addCheck('development', 'npm', 'fail', 'critical', 'npm not found');
    }
  }

  private async checkLocalServices(): Promise<void> {
    // Check if local blockchain nodes are running (for development)
    this.addCheck('development', 'local-services', 'skip', 'low',
      'Local service checks not implemented'
    );
  }

  private async checkTestConfiguration(): Promise<void> {
    const testConfigExists = existsSync(join(process.cwd(), 'tests', 'config.ts'));
    
    if (testConfigExists) {
      this.addCheck('development', 'test-config', 'pass', 'medium',
        'Test configuration found'
      );
    } else {
      this.addCheck('development', 'test-config', 'warn', 'low',
        'Test configuration not found'
      );
    }
  }

  // Staging-specific checks

  private async checkProductionSimilarity(): Promise<void> {
    this.addCheck('staging', 'prod-similarity', 'skip', 'medium',
      'Production similarity check not implemented'
    );
  }

  private async checkTestDataConfiguration(): Promise<void> {
    const testDataEnabled = process.env.USE_TEST_DATA === 'true';
    
    if (testDataEnabled) {
      this.addCheck('staging', 'test-data', 'pass', 'low',
        'Test data configuration enabled for staging'
      );
    } else {
      this.addCheck('staging', 'test-data', 'warn', 'low',
        'Test data configuration not explicitly set'
      );
    }
  }

  private async checkStagingSecurityBaseline(): Promise<void> {
    const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
    
    if (httpsEnabled) {
      this.addCheck('staging', 'security', 'pass', 'medium',
        'HTTPS enabled for staging environment'
      );
    } else {
      this.addCheck('staging', 'security', 'warn', 'medium',
        'HTTPS not enabled for staging environment'
      );
    }
  }

  // Helper methods

  private addCheck(
    category: string,
    name: string,
    status: 'pass' | 'fail' | 'warn' | 'skip',
    severity: 'critical' | 'high' | 'medium' | 'low',
    message: string,
    details?: any,
    recommendation?: string
  ): void {
    this.checks.push({
      category,
      name,
      status,
      severity,
      message,
      details,
      recommendation
    });
  }

  private generateAssessment(): DeploymentAssessment {
    const total = this.checks.length;
    const passed = this.checks.filter(c => c.status === 'pass').length;
    const failed = this.checks.filter(c => c.status === 'fail').length;
    const warnings = this.checks.filter(c => c.status === 'warn').length;
    const critical = this.checks.filter(c => c.severity === 'critical').length;

    const blockers = this.checks.filter(c => 
      c.status === 'fail' && (c.severity === 'critical' || c.severity === 'high')
    );

    const recommendations = this.checks
      .filter(c => c.recommendation && c.status !== 'pass')
      .map(c => c.recommendation!);

    const readinessScore = total > 0 ? Math.round((passed / total) * 100) : 0;

    let overallStatus: 'ready' | 'not-ready' | 'ready-with-warnings';
    if (blockers.length > 0) {
      overallStatus = 'not-ready';
    } else if (failed > 0 || warnings > 0) {
      overallStatus = 'ready-with-warnings';
    } else {
      overallStatus = 'ready';
    }

    return {
      environment: this.environment,
      timestamp: Date.now(),
      overallStatus,
      readinessScore,
      checks: this.checks,
      summary: {
        total,
        passed,
        failed,
        warnings,
        critical
      },
      blockers,
      recommendations: Array.from(new Set(recommendations))
    };
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const environment = args[0] || process.env.NODE_ENV || 'production';
  const outputFormat = args.includes('--json') ? 'json' : 'text';
  const verbose = args.includes('--verbose');

  console.log('🚀 1inch Fusion+ Cross-Chain Deployment Readiness Assessment');
  console.log(`🎯 Target Environment: ${environment}`);
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log('');

  const checker = new DeploymentReadinessChecker(environment);
  const assessment = await checker.assessDeploymentReadiness();

  if (outputFormat === 'json') {
    console.log(JSON.stringify(assessment, null, 2));
    return;
  }

  // Text output
  console.log('='.repeat(80));
  console.log('🚀 DEPLOYMENT READINESS ASSESSMENT');
  console.log('='.repeat(80));
  console.log(`🎯 Environment: ${assessment.environment}`);
  console.log(`📊 Overall Status: ${getStatusEmoji(assessment.overallStatus)} ${assessment.overallStatus.toUpperCase()}`);
  console.log(`📈 Readiness Score: ${assessment.readinessScore}%`);
  console.log(`⏱️  Timestamp: ${new Date(assessment.timestamp).toISOString()}`);

  // Summary
  console.log('\n📊 SUMMARY');
  console.log('-'.repeat(40));
  console.log(`📋 Total Checks: ${assessment.summary.total}`);
  console.log(`✅ Passed: ${assessment.summary.passed}`);
  console.log(`❌ Failed: ${assessment.summary.failed}`);
  console.log(`⚠️  Warnings: ${assessment.summary.warnings}`);
  console.log(`🚨 Critical: ${assessment.summary.critical}`);

  // Blockers
  if (assessment.blockers.length > 0) {
    console.log('\n🚨 DEPLOYMENT BLOCKERS');
    console.log('-'.repeat(40));
    
    assessment.blockers.forEach(blocker => {
      console.log(`❌ [${blocker.category}] ${blocker.message}`);
      if (blocker.recommendation) {
        console.log(`   💡 ${blocker.recommendation}`);
      }
    });
  }

  // Detailed results (if verbose or there are issues)
  if (verbose || assessment.summary.failed > 0 || assessment.summary.warnings > 0) {
    console.log('\n🔍 DETAILED RESULTS');
    console.log('-'.repeat(40));

    const categories = Array.from(new Set(assessment.checks.map(c => c.category)));
    
    categories.forEach(category => {
      const categoryChecks = assessment.checks.filter(c => c.category === category);
      console.log(`\n📁 ${category.toUpperCase()}`);
      
      categoryChecks.forEach(check => {
        const statusEmoji = getCheckStatusEmoji(check.status);
        console.log(`  ${statusEmoji} ${check.name}: ${check.message}`);
        
        if (check.recommendation && check.status !== 'pass') {
          console.log(`     💡 ${check.recommendation}`);
        }
      });
    });
  }

  // Recommendations
  if (assessment.recommendations.length > 0) {
    console.log('\n💡 RECOMMENDATIONS');
    console.log('-'.repeat(40));
    
    assessment.recommendations.slice(0, 10).forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });

    if (assessment.recommendations.length > 10) {
      console.log(`... and ${assessment.recommendations.length - 10} more`);
    }
  }

  console.log('\n' + '='.repeat(80));

  // Final verdict
  if (assessment.overallStatus === 'ready') {
    console.log('✅ READY FOR DEPLOYMENT!');
    console.log('All checks passed. The system is ready for deployment.');
  } else if (assessment.overallStatus === 'ready-with-warnings') {
    console.log('⚠️  READY WITH WARNINGS');
    console.log('Deployment is possible but address warnings for optimal operation.');
  } else {
    console.log('🚨 NOT READY FOR DEPLOYMENT');
    console.log('Critical issues must be resolved before deployment.');
  }

  // Exit with appropriate code
  const exitCode = assessment.overallStatus === 'not-ready' ? 1 : 0;
  process.exit(exitCode);
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'ready': return '✅';
    case 'ready-with-warnings': return '⚠️ ';
    case 'not-ready': return '❌';
    default: return '❓';
  }
}

function getCheckStatusEmoji(status: string): string {
  switch (status) {
    case 'pass': return '✅';
    case 'fail': return '❌';
    case 'warn': return '⚠️ ';
    case 'skip': return '⏭️ ';
    default: return '❓';
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Deployment readiness assessment failed:', error);
    process.exit(2);
  });
}

export { DeploymentReadinessChecker };
export default DeploymentReadinessChecker;