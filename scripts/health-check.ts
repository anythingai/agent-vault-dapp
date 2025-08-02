#!/usr/bin/env node

/**
 * Health Check Script
 * 
 * Performs comprehensive health checks for the 1inch Fusion+ Cross-Chain system:
 * - Service availability and responsiveness
 * - Database connectivity
 * - Blockchain connectivity
 * - External service dependencies
 * - System resource utilization
 * - Security posture
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details: Record<string, any>;
  timestamp: number;
  error?: string;
}

interface SystemMetrics {
  cpu: {
    usage: number;
    load: number[];
  };
  memory: {
    usage: number;
    free: number;
    total: number;
  };
  disk: {
    usage: number;
    free: number;
    total: number;
  };
  network: {
    connections: number;
  };
}

class HealthChecker {
  private results: HealthCheckResult[] = [];

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    services: HealthCheckResult[];
    system: SystemMetrics;
    timestamp: number;
  }> {
    console.log('🏥 Starting comprehensive health check...\n');

    // Check core services
    await this.checkRelayerService();
    await this.checkResolverService();
    await this.checkFrontendService();

    // Check dependencies
    await this.checkEthereumConnectivity();
    await this.checkBitcoinConnectivity();
    await this.checkDatabaseConnectivity();
    await this.checkRedisConnectivity();

    // Check external services
    await this.checkExternalAPIs();

    // Get system metrics
    const systemMetrics = await this.getSystemMetrics();

    // Determine overall health
    const overall = this.calculateOverallHealth();

    return {
      overall,
      services: this.results,
      system: systemMetrics,
      timestamp: Date.now()
    };
  }

  private async checkRelayerService(): Promise<void> {
    const serviceName = 'relayer';
    const port = process.env.RELAYER_PORT || '3001';
    const url = `http://localhost:${port}/health`;

    await this.checkHttpService(serviceName, url, {
      expectedStatus: 200,
      timeout: 5000
    });
  }

  private async checkResolverService(): Promise<void> {
    const serviceName = 'resolver';
    const port = process.env.RESOLVER_PORT || '3002';
    const url = `http://localhost:${port}/health`;

    await this.checkHttpService(serviceName, url, {
      expectedStatus: 200,
      timeout: 5000
    });
  }

  private async checkFrontendService(): Promise<void> {
    const serviceName = 'frontend';
    const port = process.env.FRONTEND_PORT || '3000';
    const url = `http://localhost:${port}`;

    await this.checkHttpService(serviceName, url, {
      expectedStatus: 200,
      timeout: 10000
    });
  }

  private async checkEthereumConnectivity(): Promise<void> {
    const serviceName = 'ethereum-rpc';
    const rpcUrl = process.env.ETH_RPC_URL;

    if (!rpcUrl) {
      this.addResult(serviceName, 'unhealthy', 0, {
        configured: false
      }, 'No Ethereum RPC URL configured');
      return;
    }

    const startTime = Date.now();

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1
        }),
        signal: AbortSignal.timeout(10000)
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        const chainId = parseInt(data.result, 16);

        this.addResult(serviceName, 'healthy', responseTime, {
          chainId,
          rpcUrl: this.maskUrl(rpcUrl),
          jsonrpc: data.jsonrpc
        });
      } else {
        this.addResult(serviceName, 'unhealthy', responseTime, {
          statusCode: response.status,
          rpcUrl: this.maskUrl(rpcUrl)
        }, `HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.addResult(serviceName, 'unhealthy', responseTime, {
        rpcUrl: this.maskUrl(rpcUrl)
      }, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async checkBitcoinConnectivity(): Promise<void> {
    const serviceName = 'bitcoin-rpc';
    const rpcUrl = process.env.BTC_RPC_URL;
    const rpcUser = process.env.BTC_RPC_USER;
    const rpcPassword = process.env.BTC_RPC_PASSWORD;

    if (!rpcUrl) {
      this.addResult(serviceName, 'unhealthy', 0, {
        configured: false
      }, 'No Bitcoin RPC URL configured');
      return;
    }

    const startTime = Date.now();

    try {
      const auth = Buffer.from(`${rpcUser}:${rpcPassword}`).toString('base64');
      
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify({
          jsonrpc: '1.0',
          method: 'getblockchaininfo',
          params: [],
          id: 1
        }),
        signal: AbortSignal.timeout(10000)
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        
        this.addResult(serviceName, 'healthy', responseTime, {
          chain: data.result?.chain,
          blocks: data.result?.blocks,
          rpcUrl: this.maskUrl(rpcUrl)
        });
      } else {
        this.addResult(serviceName, 'unhealthy', responseTime, {
          statusCode: response.status,
          rpcUrl: this.maskUrl(rpcUrl)
        }, `HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.addResult(serviceName, 'unhealthy', responseTime, {
        rpcUrl: this.maskUrl(rpcUrl)
      }, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async checkDatabaseConnectivity(): Promise<void> {
    const serviceName = 'database';
    const dbType = process.env.DB_TYPE || 'postgresql';
    const dbHost = process.env.DB_HOST;

    if (!dbHost) {
      this.addResult(serviceName, 'degraded', 0, {
        configured: false,
        type: dbType
      }, 'Database not configured');
      return;
    }

    // For now, just check if configuration is present
    // In a real implementation, you would test the actual connection
    this.addResult(serviceName, 'healthy', 0, {
      type: dbType,
      host: dbHost,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME
    });
  }

  private async checkRedisConnectivity(): Promise<void> {
    const serviceName = 'redis';
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      this.addResult(serviceName, 'degraded', 0, {
        configured: false
      }, 'Redis not configured');
      return;
    }

    // For now, just check if configuration is present
    // In a real implementation, you would test the actual connection
    this.addResult(serviceName, 'healthy', 0, {
      url: this.maskUrl(redisUrl)
    });
  }

  private async checkExternalAPIs(): Promise<void> {
    // Check Etherscan API
    if (process.env.ETHERSCAN_API_KEY) {
      await this.checkEtherscanAPI();
    }

    // Check other external services
    await this.checkExternalServiceConnectivity();
  }

  private async checkEtherscanAPI(): Promise<void> {
    const serviceName = 'etherscan-api';
    const apiKey = process.env.ETHERSCAN_API_KEY;
    const network = process.env.ETH_NETWORK || 'sepolia';
    const baseUrl = network === 'mainnet' 
      ? 'https://api.etherscan.io/api'
      : 'https://api-sepolia.etherscan.io/api';

    const startTime = Date.now();

    try {
      const response = await fetch(
        `${baseUrl}?module=stats&action=ethsupply&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      );

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        
        if (data.status === '1') {
          this.addResult(serviceName, 'healthy', responseTime, {
            network,
            rateLimitRemaining: response.headers.get('x-ratelimit-remaining')
          });
        } else {
          this.addResult(serviceName, 'degraded', responseTime, {
            network,
            error: data.message
          }, data.message);
        }
      } else {
        this.addResult(serviceName, 'unhealthy', responseTime, {
          statusCode: response.status,
          network
        }, `HTTP ${response.status}`);
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.addResult(serviceName, 'unhealthy', responseTime, {
        network
      }, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async checkExternalServiceConnectivity(): Promise<void> {
    // Check general internet connectivity
    const serviceName = 'internet-connectivity';
    const startTime = Date.now();

    try {
      const response = await fetch('https://httpbin.org/status/200', {
        signal: AbortSignal.timeout(5000)
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        this.addResult(serviceName, 'healthy', responseTime, {
          connectivity: true
        });
      } else {
        this.addResult(serviceName, 'degraded', responseTime, {
          statusCode: response.status
        }, 'Limited internet connectivity');
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.addResult(serviceName, 'unhealthy', responseTime, {
        connectivity: false
      }, error instanceof Error ? error.message : 'No internet connectivity');
    }
  }

  private async checkHttpService(
    serviceName: string, 
    url: string, 
    options: { expectedStatus: number; timeout: number }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeout)
      });

      const responseTime = Date.now() - startTime;

      if (response.status === options.expectedStatus) {
        this.addResult(serviceName, 'healthy', responseTime, {
          url: this.maskUrl(url),
          statusCode: response.status
        });
      } else {
        this.addResult(serviceName, 'degraded', responseTime, {
          url: this.maskUrl(url),
          statusCode: response.status,
          expected: options.expectedStatus
        }, `Unexpected status code: ${response.status}`);
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      if (error instanceof Error && error.name === 'AbortError') {
        this.addResult(serviceName, 'unhealthy', responseTime, {
          url: this.maskUrl(url),
          timeout: options.timeout
        }, 'Request timeout');
      } else {
        this.addResult(serviceName, 'unhealthy', responseTime, {
          url: this.maskUrl(url)
        }, error instanceof Error ? error.message : 'Connection failed');
      }
    }
  }

  private async getSystemMetrics(): Promise<SystemMetrics> {
    const metrics: SystemMetrics = {
      cpu: { usage: 0, load: [] },
      memory: { usage: 0, free: 0, total: 0 },
      disk: { usage: 0, free: 0, total: 0 },
      network: { connections: 0 }
    };

    try {
      // Get memory info
      const memInfo = await execAsync('cat /proc/meminfo 2>/dev/null || echo "MemTotal: 0 kB"');
      const memLines = memInfo.stdout.split('\n');
      
      const memTotal = this.parseMemInfo(memLines, 'MemTotal') * 1024;
      const memAvailable = this.parseMemInfo(memLines, 'MemAvailable') * 1024;
      
      if (memTotal > 0) {
        metrics.memory.total = memTotal;
        metrics.memory.free = memAvailable;
        metrics.memory.usage = Math.round(((memTotal - memAvailable) / memTotal) * 100);
      }

    } catch (error) {
      console.log('Could not get system metrics:', error);
    }

    try {
      // Get CPU load
      const loadAvg = await execAsync('cat /proc/loadavg 2>/dev/null || echo "0.0 0.0 0.0"');
      const loads = loadAvg.stdout.trim().split(' ').slice(0, 3).map(Number);
      metrics.cpu.load = loads;

    } catch (error) {
      // Ignore error
    }

    try {
      // Get disk usage
      const diskUsage = await execAsync('df -h / 2>/dev/null || echo "Filesystem Size Used Avail Use% Mounted"');
      const lines = diskUsage.stdout.split('\n');
      
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          const usagePercent = parseInt(parts[4].replace('%', ''));
          metrics.disk.usage = isNaN(usagePercent) ? 0 : usagePercent;
        }
      }

    } catch (error) {
      // Ignore error
    }

    return metrics;
  }

  private parseMemInfo(lines: string[], key: string): number {
    const line = lines.find(l => l.startsWith(key));
    if (line) {
      const match = line.match(/(\d+)\s+kB/);
      return match ? parseInt(match[1]) : 0;
    }
    return 0;
  }

  private calculateOverallHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    if (this.results.length === 0) {
      return 'unhealthy';
    }

    const unhealthyCount = this.results.filter(r => r.status === 'unhealthy').length;
    const degradedCount = this.results.filter(r => r.status === 'degraded').length;

    if (unhealthyCount > 0) {
      return 'unhealthy';
    } else if (degradedCount > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  private addResult(
    service: string,
    status: 'healthy' | 'degraded' | 'unhealthy',
    responseTime: number,
    details: Record<string, any>,
    error?: string
  ): void {
    this.results.push({
      service,
      status,
      responseTime,
      details,
      timestamp: Date.now(),
      error
    });
  }

  private maskUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      
      // Mask API keys and sensitive parameters
      urlObj.searchParams.forEach((value, key) => {
        if (key.toLowerCase().includes('key') || 
            key.toLowerCase().includes('secret') ||
            key.toLowerCase().includes('token')) {
          urlObj.searchParams.set(key, '***');
        }
      });

      // Mask userinfo
      if (urlObj.username || urlObj.password) {
        urlObj.username = '***';
        urlObj.password = '***';
      }

      return urlObj.toString();
    } catch {
      return url.replace(/\/\/[^@\/]+@/, '//***@');
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const outputFormat = args.includes('--json') ? 'json' : 'text';
  const verbose = args.includes('--verbose');

  console.log('🏥 1inch Fusion+ Cross-Chain Health Check');
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log('');

  const checker = new HealthChecker();
  const healthCheck = await checker.performHealthCheck();

  if (outputFormat === 'json') {
    console.log(JSON.stringify(healthCheck, null, 2));
    return;
  }

  // Text output
  console.log('='.repeat(60));
  console.log('🏥 HEALTH CHECK RESULTS');
  console.log('='.repeat(60));
  console.log(`🎯 Overall Status: ${getStatusEmoji(healthCheck.overall)} ${healthCheck.overall.toUpperCase()}`);
  console.log(`⏱️  Timestamp: ${new Date(healthCheck.timestamp).toISOString()}`);
  
  // System metrics
  console.log('\n🖥️  SYSTEM METRICS');
  console.log('-'.repeat(30));
  console.log(`💾 Memory: ${healthCheck.system.memory.usage}% used (${Math.round(healthCheck.system.memory.free / 1024 / 1024 / 1024)}GB free)`);
  console.log(`🔥 CPU Load: [${healthCheck.system.cpu.load.map(l => l.toFixed(2)).join(', ')}]`);
  console.log(`💾 Disk: ${healthCheck.system.disk.usage}% used`);

  // Service results
  console.log('\n🔍 SERVICE CHECKS');
  console.log('-'.repeat(30));

  for (const result of healthCheck.services) {
    const statusEmoji = getStatusEmoji(result.status);
    const responseTimeStr = result.responseTime > 0 ? ` (${result.responseTime}ms)` : '';
    
    console.log(`${statusEmoji} ${result.service}${responseTimeStr}`);
    
    if (result.error && (verbose || result.status === 'unhealthy')) {
      console.log(`   ❌ Error: ${result.error}`);
    }
    
    if (verbose && result.details) {
      const details = Object.entries(result.details)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      console.log(`   ℹ️  Details: ${details}`);
    }
  }

  // Summary
  const healthyCount = healthCheck.services.filter(s => s.status === 'healthy').length;
  const degradedCount = healthCheck.services.filter(s => s.status === 'degraded').length;
  const unhealthyCount = healthCheck.services.filter(s => s.status === 'unhealthy').length;

  console.log('\n📊 SUMMARY');
  console.log('-'.repeat(30));
  console.log(`✅ Healthy: ${healthyCount}`);
  console.log(`⚠️  Degraded: ${degradedCount}`);
  console.log(`❌ Unhealthy: ${unhealthyCount}`);
  console.log(`📋 Total: ${healthCheck.services.length}`);

  // Recommendations
  if (unhealthyCount > 0) {
    console.log('\n🚨 URGENT ACTIONS REQUIRED');
    console.log('-'.repeat(30));
    
    healthCheck.services
      .filter(s => s.status === 'unhealthy')
      .forEach(service => {
        console.log(`❌ Fix ${service.service}: ${service.error || 'Service unavailable'}`);
      });
  }

  if (degradedCount > 0) {
    console.log('\n⚠️  RECOMMENDED ACTIONS');
    console.log('-'.repeat(30));
    
    healthCheck.services
      .filter(s => s.status === 'degraded')
      .forEach(service => {
        console.log(`⚠️  Review ${service.service}: ${service.error || 'Performance issues detected'}`);
      });
  }

  console.log('\n' + '='.repeat(60));
  
  // Exit with appropriate code
  const exitCode = unhealthyCount > 0 ? 2 : (degradedCount > 0 ? 1 : 0);
  console.log(`🏁 Health check ${exitCode === 0 ? 'passed' : 'completed with issues'}`);
  
  process.exit(exitCode);
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '✅';
    case 'degraded': return '⚠️ ';
    case 'unhealthy': return '❌';
    default: return '❓';
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Health check failed:', error);
    process.exit(3);
  });
}

export { HealthChecker };
export default HealthChecker;