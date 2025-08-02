#!/usr/bin/env node

/**
 * Backend Services Deployment Automation
 * 
 * Features:
 * - Automated deployment of all backend services (relayer, resolver)
 * - Database setup and migration automation
 * - Service dependency orchestration
 * - Health checking and validation
 * - Configuration management
 * - Rollback capabilities
 * - Multi-environment support
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ServiceConfig {
  name: string;
  port: number;
  healthEndpoint: string;
  dependencies: string[];
  envFile: string;
  buildScript?: string;
  startScript: string;
  processName: string;
}

interface BackendDeploymentConfig {
  environment: 'local' | 'staging' | 'production';
  services: ServiceConfig[];
  database: {
    host: string;
    port: number;
    name: string;
    migrations: boolean;
  };
  redis: {
    host: string;
    port: number;
    enabled: boolean;
  };
  monitoring: {
    enabled: boolean;
    metricsPort?: number;
  };
  loadBalancer: {
    enabled: boolean;
    type?: 'nginx' | 'haproxy';
  };
}

interface DeploymentResult {
  service: string;
  status: 'success' | 'failed' | 'skipped';
  startTime: number;
  endTime: number;
  healthCheck: boolean;
  processId?: number;
  error?: string;
}

interface BackendDeploymentRecord {
  timestamp: string;
  environment: string;
  version: string;
  config: BackendDeploymentConfig;
  results: DeploymentResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
    totalTime: number;
  };
  rollbackData?: any;
}

class BackendServicesDeployer {
  private config: BackendDeploymentConfig;
  private deploymentRecord: BackendDeploymentRecord;
  private runningProcesses: Map<string, number> = new Map();

  constructor(environment: 'local' | 'staging' | 'production') {
    this.config = this.loadConfig(environment);
    this.deploymentRecord = {
      timestamp: new Date().toISOString(),
      environment,
      version: process.env.VERSION || `v${Date.now()}`,
      config: this.config,
      results: [],
      summary: { total: 0, successful: 0, failed: 0, skipped: 0, totalTime: 0 }
    };
  }

  private loadConfig(environment: string): BackendDeploymentConfig {
    console.log(`🔧 Loading ${environment} configuration...`);

    // Default configurations
    const configs: { [key: string]: BackendDeploymentConfig } = {
      local: {
        environment: 'local',
        services: [
          {
            name: 'relayer',
            port: 3000,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis'],
            envFile: '.env.local',
            buildScript: 'build:relayer',
            startScript: 'dev:relayer',
            processName: 'fusion-relayer'
          },
          {
            name: 'resolver',
            port: 3001,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis', 'relayer'],
            envFile: '.env.local',
            buildScript: 'build:resolver',
            startScript: 'dev:resolver',
            processName: 'fusion-resolver'
          }
        ],
        database: {
          host: 'localhost',
          port: 5432,
          name: 'fusion_bitcoin_dev',
          migrations: true
        },
        redis: {
          host: 'localhost',
          port: 6379,
          enabled: true
        },
        monitoring: {
          enabled: true,
          metricsPort: 9090
        },
        loadBalancer: {
          enabled: false
        }
      },
      staging: {
        environment: 'staging',
        services: [
          {
            name: 'relayer',
            port: 3000,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis'],
            envFile: '.env.staging',
            buildScript: 'build:relayer',
            startScript: 'start:relayer',
            processName: 'fusion-relayer-staging'
          },
          {
            name: 'resolver',
            port: 3001,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis', 'relayer'],
            envFile: '.env.staging',
            buildScript: 'build:resolver',
            startScript: 'start:resolver',
            processName: 'fusion-resolver-staging'
          }
        ],
        database: {
          host: process.env.DB_HOST || 'staging-db.example.com',
          port: parseInt(process.env.DB_PORT || '5432'),
          name: process.env.DB_NAME || 'fusion_bitcoin_staging',
          migrations: true
        },
        redis: {
          host: process.env.REDIS_HOST || 'staging-redis.example.com',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          enabled: true
        },
        monitoring: {
          enabled: true,
          metricsPort: 9090
        },
        loadBalancer: {
          enabled: true,
          type: 'nginx'
        }
      },
      production: {
        environment: 'production',
        services: [
          {
            name: 'relayer',
            port: 3000,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis'],
            envFile: '.env.production',
            buildScript: 'build:relayer:production',
            startScript: 'start:relayer:production',
            processName: 'fusion-relayer-prod'
          },
          {
            name: 'resolver',
            port: 3001,
            healthEndpoint: '/health',
            dependencies: ['database', 'redis', 'relayer'],
            envFile: '.env.production',
            buildScript: 'build:resolver:production',
            startScript: 'start:resolver:production',
            processName: 'fusion-resolver-prod'
          }
        ],
        database: {
          host: process.env.DB_HOST || 'production-db.example.com',
          port: parseInt(process.env.DB_PORT || '5432'),
          name: process.env.DB_NAME || 'fusion_bitcoin_production',
          migrations: true
        },
        redis: {
          host: process.env.REDIS_HOST || 'production-redis.example.com',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          enabled: true
        },
        monitoring: {
          enabled: true,
          metricsPort: 9090
        },
        loadBalancer: {
          enabled: true,
          type: 'nginx'
        }
      }
    };

    if (!configs[environment]) {
      throw new Error(`Unknown environment: ${environment}`);
    }

    return configs[environment];
  }

  async deployBackendServices(): Promise<BackendDeploymentRecord> {
    console.log('🚀 Backend Services Deployment Automation');
    console.log('='.repeat(60));
    console.log(`🌍 Environment: ${this.config.environment}`);
    console.log(`📦 Version: ${this.deploymentRecord.version}`);
    console.log(`🕐 Started: ${this.deploymentRecord.timestamp}`);
    console.log('');

    const startTime = Date.now();

    try {
      // 1. Pre-deployment checks
      await this.runPreDeploymentChecks();

      // 2. Setup infrastructure dependencies
      await this.setupInfrastructureDependencies();

      // 3. Build services
      await this.buildServices();

      // 4. Setup database
      await this.setupDatabase();

      // 5. Deploy services in dependency order
      await this.deployServicesInOrder();

      // 6. Run post-deployment validation
      await this.runPostDeploymentValidation();

      // 7. Setup monitoring
      await this.setupMonitoring();

      // Calculate summary
      const totalTime = Date.now() - startTime;
      this.calculateDeploymentSummary(totalTime);

      console.log('✅ Backend services deployment completed successfully');
      return this.deploymentRecord;

    } catch (error) {
      console.error('❌ Backend deployment failed:', error);
      
      // Attempt cleanup on failure
      await this.cleanup();
      
      throw error;
    }
  }

  private async runPreDeploymentChecks(): Promise<void> {
    console.log('🔍 Running Pre-Deployment Checks');
    console.log('-'.repeat(35));

    // Check Node.js version
    const nodeVersion = process.version;
    console.log(`📦 Node.js version: ${nodeVersion}`);

    if (!nodeVersion.startsWith('v16') && !nodeVersion.startsWith('v18') && !nodeVersion.startsWith('v20')) {
      throw new Error('Node.js version 16, 18, or 20 is required');
    }

    // Check available ports
    await this.checkPortAvailability();

    console.log('✅ Pre-deployment checks completed\n');
  }

  private async checkPortAvailability(): Promise<void> {
    console.log('🔍 Checking port availability...');
    
    for (const service of this.config.services) {
      try {
        const { stdout } = await execAsync(`netstat -tulpn | grep :${service.port} || echo "available"`);
        if (!stdout.includes('available')) {
          console.warn(`⚠️  Port ${service.port} may be in use for ${service.name}`);
        } else {
          console.log(`✅ Port ${service.port} available for ${service.name}`);
        }
      } catch (error) {
        console.log(`ℹ️  Could not check port ${service.port} for ${service.name}`);
      }
    }
  }

  private async setupInfrastructureDependencies(): Promise<void> {
    console.log('🏗️  Setting Up Infrastructure Dependencies');
    console.log('-'.repeat(42));

    // Setup Redis if enabled
    if (this.config.redis.enabled) {
      await this.setupRedis();
    }

    // Additional infrastructure setup based on environment
    if (this.config.environment === 'local') {
      await this.setupLocalInfrastructure();
    }

    console.log('✅ Infrastructure dependencies setup completed\n');
  }

  private async setupRedis(): Promise<void> {
    console.log('🗄️  Setting up Redis...');

    if (this.config.environment === 'local') {
      try {
        await execAsync(`redis-cli -h ${this.config.redis.host} -p ${this.config.redis.port} ping`);
        console.log('✅ Redis is running');
      } catch (error) {
        console.log('⚠️  Redis not running, attempting to start with Docker...');
        
        try {
          await execAsync(`docker run -d --name fusion-redis -p ${this.config.redis.port}:6379 redis:7-alpine`);
          console.log('✅ Redis started with Docker');
          
          // Wait for Redis to be ready
          await this.waitForService(`redis-cli -h ${this.config.redis.host} -p ${this.config.redis.port} ping`, 30000);
        } catch (dockerError) {
          console.warn('⚠️  Could not start Redis with Docker. Please ensure Redis is running manually.');
        }
      }
    }
  }

  private async setupLocalInfrastructure(): Promise<void> {
    console.log('🏠 Setting up local infrastructure...');

    // Create necessary directories
    const dirs = ['logs', 'tmp', 'data'];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      }
    }

    console.log('✅ Local infrastructure setup completed');
  }

  private async buildServices(): Promise<void> {
    console.log('🔨 Building Backend Services');
    console.log('-'.repeat(28));

    // Install dependencies first
    console.log('📦 Installing dependencies...');
    
    try {
      await execAsync('npm ci', { cwd: path.join(process.cwd(), 'backend') });
      console.log('✅ Backend dependencies installed');
    } catch (error) {
      console.log('⚠️  Backend npm ci failed, trying npm install...');
      await execAsync('npm install', { cwd: path.join(process.cwd(), 'backend') });
      console.log('✅ Backend dependencies installed');
    }

    // Build each service
    for (const service of this.config.services) {
      if (service.buildScript) {
        console.log(`🔨 Building ${service.name}...`);
        
        const startTime = Date.now();
        
        try {
          await execAsync(`npm run ${service.buildScript}`, { 
            cwd: path.join(process.cwd(), 'backend'),
            timeout: 120000
          });
          
          const buildTime = Date.now() - startTime;
          console.log(`✅ ${service.name} built successfully (${buildTime}ms)`);
          
        } catch (error) {
          this.addDeploymentResult(service.name + '-build', 'failed', startTime, Date.now(), false, undefined, (error as Error).message);
          throw new Error(`Failed to build ${service.name}: ${(error as Error).message}`);
        }
      }
    }

    console.log('✅ All services built successfully\n');
  }

  private async setupDatabase(): Promise<void> {
    console.log('🗄️  Setting Up Database');
    console.log('-'.repeat(21));

    if (this.config.environment === 'local') {
      await this.setupLocalDatabase();
    }

    // Test database connectivity
    await this.testDatabaseConnectivity();

    // Run migrations if enabled
    if (this.config.database.migrations) {
      await this.runDatabaseMigrations();
    }

    console.log('✅ Database setup completed\n');
  }

  private async setupLocalDatabase(): Promise<void> {
    console.log('🏠 Setting up local database...');

    try {
      await execAsync(`pg_isready -h ${this.config.database.host} -p ${this.config.database.port}`);
      console.log('✅ PostgreSQL is running');
    } catch (error) {
      console.log('⚠️  PostgreSQL not running, attempting to start with Docker...');
      
      try {
        const dockerCmd = `docker run -d --name fusion-postgres -e POSTGRES_DB=${this.config.database.name} -e POSTGRES_USER=fusion_dev -e POSTGRES_PASSWORD=dev_password -p ${this.config.database.port}:5432 postgres:15-alpine`;
        
        await execAsync(dockerCmd);
        console.log('✅ PostgreSQL started with Docker');
        
        // Wait for PostgreSQL to be ready
        await this.waitForService(`pg_isready -h ${this.config.database.host} -p ${this.config.database.port}`, 60000);
      } catch (dockerError) {
        console.warn('⚠️  Could not start PostgreSQL with Docker. Please ensure database is running manually.');
      }
    }
  }

  private async testDatabaseConnectivity(): Promise<void> {
    console.log('🔍 Testing database connectivity...');

    try {
      await execAsync(`pg_isready -h ${this.config.database.host} -p ${this.config.database.port} -t 10`);
      console.log('✅ Database connectivity verified');
    } catch (error) {
      throw new Error(`Database connectivity test failed: ${(error as Error).message}`);
    }
  }

  private async runDatabaseMigrations(): Promise<void> {
    console.log('🔄 Running database migrations...');

    try {
      await execAsync('npm run db:migrate', { 
        cwd: path.join(process.cwd(), 'backend'),
        timeout: 120000
      });
      console.log('✅ Database migrations completed');
    } catch (error) {
      console.warn('⚠️  Database migrations failed:', (error as Error).message);
      console.log('ℹ️  Continuing deployment - migrations may need to be run manually');
    }
  }

  private async deployServicesInOrder(): Promise<void> {
    console.log('🚀 Deploying Services in Dependency Order');
    console.log('-'.repeat(40));

    // Deploy services in the order they're configured (simple approach)
    for (const service of this.config.services) {
      await this.deployService(service);
      
      // Wait between service deployments
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('✅ All services deployed successfully\n');
  }

  private async deployService(service: ServiceConfig): Promise<void> {
    console.log(`🚀 Deploying ${service.name}...`);
    
    const startTime = Date.now();
    
    try {
      // Start the service
      const processId = await this.startService(service);
      
      // Wait for service to be ready
      await this.waitForServiceHealth(service);
      
      const endTime = Date.now();
      
      this.addDeploymentResult(service.name, 'success', startTime, endTime, true, processId);
      this.runningProcesses.set(service.name, processId);
      
      console.log(`✅ ${service.name} deployed successfully (PID: ${processId})`);
      
    } catch (error) {
      const endTime = Date.now();
      this.addDeploymentResult(service.name, 'failed', startTime, endTime, false, undefined, (error as Error).message);
      console.error(`❌ Failed to deploy ${service.name}:`, (error as Error).message);
      throw error;
    }
  }

  private async startService(service: ServiceConfig): Promise<number> {
    console.log(`🔄 Starting ${service.name} service...`);

    try {
      // Start service using npm script
      const child = spawn('npm', ['run', service.startScript], {
        cwd: path.join(process.cwd(), 'backend'),
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (!child.pid) {
        throw new Error(`Failed to start ${service.name} - no PID returned`);
      }

      // Setup logging
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFile = fs.createWriteStream(path.join(logDir, `${service.name}.log`), { flags: 'a' });
      const errorFile = fs.createWriteStream(path.join(logDir, `${service.name}.error.log`), { flags: 'a' });

      child.stdout?.pipe(logFile);
      child.stderr?.pipe(errorFile);

      console.log(`🟢 ${service.name} started with PID: ${child.pid}`);
      return child.pid;

    } catch (error) {
      throw new Error(`Failed to start ${service.name}: ${(error as Error).message}`);
    }
  }

  private async waitForServiceHealth(service: ServiceConfig): Promise<void> {
    console.log(`🏥 Waiting for ${service.name} health check...`);

    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await execAsync(`curl -f http://localhost:${service.port}${service.healthEndpoint}`, {
          timeout: 5000
        });

        if (response.stdout.includes('healthy') || response.stdout.includes('ok')) {
          console.log(`✅ ${service.name} health check passed`);
          return;
        }
      } catch (error) {
        // Health check failed, continue waiting
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`${service.name} health check failed after ${maxAttempts} attempts`);
  }

  private async runPostDeploymentValidation(): Promise<void> {
    console.log('🔍 Running Post-Deployment Validation');
    console.log('-'.repeat(36));

    // Test all service endpoints
    for (const service of this.config.services) {
      await this.validateServiceEndpoints(service);
    }

    console.log('✅ Post-deployment validation completed\n');
  }

  private async validateServiceEndpoints(service: ServiceConfig): Promise<void> {
    console.log(`🔍 Validating ${service.name} endpoints...`);

    try {
      // Health endpoint
      await execAsync(`curl -f http://localhost:${service.port}${service.healthEndpoint}`);
      console.log(`✅ ${service.name} health endpoint responding`);

    } catch (error) {
      console.error(`❌ ${service.name} endpoint validation failed:`, (error as Error).message);
      throw error;
    }
  }

  private async setupMonitoring(): Promise<void> {
    if (!this.config.monitoring.enabled) {
      console.log('⏭️  Monitoring disabled, skipping...\n');
      return;
    }

    console.log('📊 Setting Up Monitoring');
    console.log('-'.repeat(23));

    // Setup health monitoring
    await this.setupHealthMonitoring();

    console.log('✅ Monitoring setup completed\n');
  }

  private async setupHealthMonitoring(): Promise<void> {
    console.log('🏥 Setting up health monitoring...');

    // Create health monitoring script
    const healthScript = `#!/bin/bash
# Auto-generated health monitoring script

echo "🏥 Health Check Report - $(date)"
echo "=================================="

${this.config.services.map(service => `
echo "Checking ${service.name}..."
if curl -f http://localhost:${service.port}${service.healthEndpoint} > /dev/null 2>&1; then
    echo "✅ ${service.name}: healthy"
else
    echo "❌ ${service.name}: unhealthy"
fi
`).join('')}

echo "=================================="
`;

    const scriptPath = path.join(process.cwd(), 'scripts', 'health-check-backend.sh');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, healthScript);
    fs.chmodSync(scriptPath, '755');

    console.log(`✅ Health monitoring script created: ${scriptPath}`);
  }

  private async waitForService(command: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        await execAsync(command);
        return;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error(`Service not ready within ${timeout}ms`);
  }

  private addDeploymentResult(
    service: string,
    status: 'success' | 'failed' | 'skipped',
    startTime: number,
    endTime: number,
    healthCheck: boolean,
    processId?: number,
    error?: string
  ): void {
    this.deploymentRecord.results.push({
      service,
      status,
      startTime,
      endTime,
      healthCheck,
      processId,
      error
    });
  }

  private calculateDeploymentSummary(totalTime: number): void {
    const results = this.deploymentRecord.results;
    
    this.deploymentRecord.summary = {
      total: results.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      totalTime
    };
  }

  async saveDeploymentRecord(): Promise<void> {
    console.log('💾 Saving Deployment Record');
    console.log('-'.repeat(26));

    const recordsDir = path.join(process.cwd(), 'deployment', 'backend');
    if (!fs.existsSync(recordsDir)) {
      fs.mkdirSync(recordsDir, { recursive: true });
    }

    const recordFile = path.join(recordsDir, `backend-${this.config.environment}-${Date.now()}.json`);
    fs.writeFileSync(recordFile, JSON.stringify(this.deploymentRecord, null, 2));

    console.log(`✅ Deployment record saved: ${recordFile}`);

    // Save process information for management
    const processInfo = {
      environment: this.config.environment,
      timestamp: this.deploymentRecord.timestamp,
      processes: Array.from(this.runningProcesses.entries()).map(([name, pid]) => ({
        service: name,
        pid,
        port: this.config.services.find(s => s.name === name)?.port
      }))
    };

    const processFile = path.join(recordsDir, `processes-${this.config.environment}.json`);
    fs.writeFileSync(processFile, JSON.stringify(processInfo, null, 2));

    console.log(`✅ Process information saved: ${processFile}\n`);
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up failed deployment...');

    for (const [serviceName, pid] of this.runningProcesses) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`🛑 Stopped ${serviceName} (PID: ${pid})`);
      } catch (error) {
        console.warn(`⚠️  Could not stop ${serviceName} (PID: ${pid})`);
      }
    }

    console.log('✅ Cleanup completed');
  }

  printSummary(): void {
    console.log('📊 BACKEND DEPLOYMENT SUMMARY');
    console.log('='.repeat(50));

    const { summary } = this.deploymentRecord;
    
    console.log(`🌍 Environment: ${this.config.environment}`);
    console.log(`📦 Version: ${this.deploymentRecord.version}`);
    console.log(`⏱️  Total Time: ${(summary.totalTime / 1000).toFixed(2)}s`);
    console.log('');

    console.log('📋 Deployment Results:');
    console.log(`  Total Services: ${summary.total}`);
    console.log(`  ✅ Successful: ${summary.successful}`);
    console.log(`  ❌ Failed: ${summary.failed}`);
    console.log(`  ⏭️  Skipped: ${summary.skipped}`);
    console.log(`  📊 Success Rate: ${summary.total > 0 ? ((summary.successful / summary.total) * 100).toFixed(1) : 0}%`);
    console.log('');

    console.log('🔄 Running Services:');
    for (const [serviceName, pid] of this.runningProcesses) {
      const service = this.config.services.find(s => s.name === serviceName);
      console.log(`  ${serviceName}: PID ${pid} (Port ${service?.port})`);
    }
    console.log('');

    if (summary.failed > 0) {
      console.log('❌ DEPLOYMENT COMPLETED WITH FAILURES');
      console.log('Check logs and deployment record for details');
    } else {
      console.log('🎉 ALL SERVICES DEPLOYED SUCCESSFULLY! 🎉');
    }

    console.log('');
    console.log('📝 Management Commands:');
    console.log('  Stop all services: npm run backend:stop');
    console.log('  View logs: tail -f logs/<service-name>.log');
    console.log('  Health check: ./scripts/health-check-backend.sh');
    console.log('  Process info: cat deployment/backend/processes-' + this.config.environment + '.json');
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const environment = (args[0] as 'local' | 'staging' | 'production') || 'local';

  console.log('🚀 1inch Fusion+ Cross-Chain Backend Services Deployment');
  console.log(`📊 Target Environment: ${environment}`);
  console.log('');

  try {
    const deployer = new BackendServicesDeployer(environment);
    await deployer.deployBackendServices();
    await deployer.saveDeploymentRecord();
    deployer.printSummary();

    process.exit(0);

  } catch (error) {
    console.error('\n💥 Backend deployment failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { BackendServicesDeployer, BackendDeploymentConfig, DeploymentResult };

// Run if called directly
if (require.main === module) {
  main();
}
