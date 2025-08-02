import { rateLimitMonitor } from './rateLimitMonitor';
import { dashboard } from './dashboard';
import { metricsAggregator } from './metricsAggregator';

/**
 * Rate Limiting Monitoring System Integration
 * 
 * This module integrates all monitoring components:
 * - Rate Limit Monitor: Core monitoring and alerting engine
 * - Dashboard: REST API for visualization and management
 * - Metrics Aggregator: Collects metrics from all sources
 * 
 * Provides a unified interface to start, stop, and manage
 * the complete monitoring infrastructure.
 */

export interface MonitoringConfig {
  rateLimitMonitor: {
    enabled: boolean;
    autoResponseEnabled: boolean;
  };
  dashboard: {
    enabled: boolean;
    port: number;
    enableAuth: boolean;
  };
  metricsAggregator: {
    enabled: boolean;
    collectionInterval: number;
    sources: string[];
  };
  integrations: {
    slack?: {
      webhookUrl: string;
    };
    email?: {
      smtpHost: string;
      smtpPort: number;
      username: string;
      password: string;
    };
  };
}

export class MonitoringSystem {
  private config: MonitoringConfig;
  private isRunning = false;

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      rateLimitMonitor: {
        enabled: true,
        autoResponseEnabled: process.env.AUTO_RESPONSE_ENABLED === 'true'
      },
      dashboard: {
        enabled: true,
        port: parseInt(process.env.DASHBOARD_PORT || '8080'),
        enableAuth: process.env.DASHBOARD_AUTH_ENABLED === 'true'
      },
      metricsAggregator: {
        enabled: true,
        collectionInterval: 10000,
        sources: ['contract', 'relayer', 'resolver', 'api', 'frontend', 'nginx', 'crossChain']
      },
      integrations: {
        slack: process.env.SLACK_WEBHOOK_URL ? {
          webhookUrl: process.env.SLACK_WEBHOOK_URL
        } : undefined,
        email: (process.env.SMTP_HOST && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD) ? {
          smtpHost: process.env.SMTP_HOST,
          smtpPort: parseInt(process.env.SMTP_PORT || '587'),
          username: process.env.SMTP_USERNAME,
          password: process.env.SMTP_PASSWORD
        } : undefined
      },
      ...config
    };
    
    console.log('🔧 Monitoring System initialized with configuration:');
    console.log(`   Rate Limit Monitor: ${this.config.rateLimitMonitor.enabled ? 'enabled' : 'disabled'}`);
    console.log(`   Dashboard API: ${this.config.dashboard.enabled ? `enabled on port ${this.config.dashboard.port}` : 'disabled'}`);
    console.log(`   Metrics Aggregator: ${this.config.metricsAggregator.enabled ? 'enabled' : 'disabled'}`);
    console.log(`   Auto Response: ${this.config.rateLimitMonitor.autoResponseEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Start the complete monitoring system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Monitoring system already running');
      return;
    }

    console.log('🚀 Starting Rate Limiting Monitoring System...');
    
    try {
      // Start metrics aggregation first (provides data)
      if (this.config.metricsAggregator.enabled) {
        await metricsAggregator.start();
        this.setupMetricsIntegration();
      }
      
      // Start dashboard API
      if (this.config.dashboard.enabled) {
        await dashboard.start();
        this.setupDashboardIntegration();
      }
      
      // Rate limit monitor is always initialized, just ensure it's connected
      this.setupMonitoringIntegration();
      
      this.isRunning = true;
      
      console.log('✅ Monitoring system started successfully');
      console.log('📊 System status:');
      console.log(`   - Monitoring: Active`);
      console.log(`   - Dashboard: http://localhost:${this.config.dashboard.port}/api/dashboard`);
      console.log(`   - Metrics: Collecting from ${this.config.metricsAggregator.sources.length} sources`);
      
      // Emit initial system health check
      this.performSystemHealthCheck();
      
    } catch (error) {
      console.error('❌ Failed to start monitoring system:', error);
      throw error;
    }
  }

  /**
   * Stop the monitoring system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('⏹️ Stopping Rate Limiting Monitoring System...');
    
    try {
      // Stop components in reverse order
      if (this.config.dashboard.enabled) {
        await dashboard.stop();
      }
      
      if (this.config.metricsAggregator.enabled) {
        await metricsAggregator.stop();
      }
      
      this.isRunning = false;
      console.log('✅ Monitoring system stopped');
      
    } catch (error) {
      console.error('❌ Error stopping monitoring system:', error);
      throw error;
    }
  }

  /**
   * Get system status
   */
  getStatus(): {
    running: boolean;
    components: {
      rateLimitMonitor: any;
      dashboard: { running: boolean; port?: number };
      metricsAggregator: any;
    };
    health: 'healthy' | 'degraded' | 'critical';
  } {
    const monitorStats = rateLimitMonitor.getMonitoringStats();
    const aggregatorStatus = metricsAggregator.getStatus();
    
    // Determine overall health
    let health: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (!this.isRunning || !aggregatorStatus.running) {
      health = 'critical';
    } else if (monitorStats.activeAlerts > 0) {
      health = 'degraded';
    }
    
    return {
      running: this.isRunning,
      components: {
        rateLimitMonitor: monitorStats,
        dashboard: {
          running: this.config.dashboard.enabled,
          port: this.config.dashboard.port
        },
        metricsAggregator: aggregatorStatus
      },
      health
    };
  }

  /**
   * Setup integration between metrics aggregator and monitor
   */
  private setupMetricsIntegration(): void {
    // Forward aggregated metrics to monitor
    metricsAggregator.on('metricsCollected', (data) => {
      console.log(`📊 Collected ${data.count} metrics from ${data.sourceId}`);
    });
    
    metricsAggregator.on('batchProcessed', (data) => {
      console.log(`📈 Processed ${data.count} metrics`);
    });
    
    metricsAggregator.on('collectionError', (data) => {
      console.error(`📊 Metrics collection error from ${data.sourceId}:`, data.error);
      
      // Create a security event for monitoring failures
      rateLimitMonitor.recordSecurityEvent({
        source: 'monitoring',
        type: 'suspicious_pattern',
        severity: 'medium',
        details: {
          violationType: 'metrics_collection_failure',
          endpoint: data.sourceId
        }
      });
    });
  }

  /**
   * Setup integration between dashboard and monitor
   */
  private setupDashboardIntegration(): void {
    // Forward monitoring events to dashboard for real-time updates
    rateLimitMonitor.on('alertTriggered', (alert) => {
      console.log(`🚨 Alert triggered: ${alert.ruleName} (${alert.severity})`);
    });
    
    rateLimitMonitor.on('securityEvent', (event) => {
      console.log(`🛡️ Security event: ${event.type} (${event.severity}) from ${event.source}`);
    });
    
    // Handle dashboard administrative actions
    dashboard.on('blockIP', (data) => {
      console.log(`🚫 IP block requested: ${data.ip} for ${data.duration}ms`);
      // Would integrate with infrastructure to actually block IP
    });
    
    dashboard.on('updateRateLimit', (data) => {
      console.log(`⚡ Rate limit update requested: ${data.ruleId}`);
      // Would integrate with rate limiting system to update limits
    });
  }

  /**
   * Setup general monitoring integration
   */
  private setupMonitoringIntegration(): void {
    // System-wide monitoring events
    rateLimitMonitor.on('healthCheck', (stats) => {
      if (stats.activeAlertsCount > 10) {
        console.warn(`⚠️ High alert volume: ${stats.activeAlertsCount} active alerts`);
      }
    });
    
    rateLimitMonitor.on('circuitBreakerTriggered', (data) => {
      console.warn(`🔌 Circuit breaker triggered: ${data.service} - ${data.reason}`);
    });
    
    rateLimitMonitor.on('autoResponseExecuted', (data) => {
      console.log(`🤖 Auto-response executed: ${data.action.type} for ${data.alert.ruleName}`);
    });
  }

  /**
   * Perform system health check
   */
  private performSystemHealthCheck(): void {
    const status = this.getStatus();
    
    console.log('🏥 System Health Check:');
    console.log(`   Overall Health: ${status.health.toUpperCase()}`);
    console.log(`   Rate Limit Monitor: ${status.components.rateLimitMonitor.metricsCollected} metrics, ${status.components.rateLimitMonitor.activeAlerts} alerts`);
    console.log(`   Metrics Aggregator: ${status.components.metricsAggregator.pendingMetrics} pending`);
    console.log(`   Dashboard API: ${status.components.dashboard.running ? 'Running' : 'Stopped'}`);
    
    // Schedule next health check
    setTimeout(() => {
      if (this.isRunning) {
        this.performSystemHealthCheck();
      }
    }, 60000); // Every minute
  }

  /**
   * Record a custom metric
   */
  recordMetric(source: string, type: string, value: number, tags: Record<string, string> = {}): void {
    rateLimitMonitor.recordMetric({
      source,
      type,
      value,
      tags
    });
  }

  /**
   * Record a security event
   */
  async recordSecurityEvent(
    source: string, 
    type: 'rate_limit_violation' | 'dos_attack' | 'suspicious_pattern' | 'circuit_breaker_trip' | 'security_breach',
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: Record<string, any>
  ): Promise<void> {
    await rateLimitMonitor.recordSecurityEvent({
      source,
      type,
      severity,
      details
    });
  }

  /**
   * Get dashboard data
   */
  getDashboardData() {
    return rateLimitMonitor.getDashboardData();
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return rateLimitMonitor.getActiveAlerts();
  }

  /**
   * Get security events
   */
  getSecurityEvents(severity?: string, limit = 100) {
    return rateLimitMonitor.getSecurityEvents(severity, limit);
  }
}

// Create and export singleton instance
export const monitoringSystem = new MonitoringSystem();

// Export individual components for direct access if needed
export {
  rateLimitMonitor,
  dashboard,
  metricsAggregator
};

// Export types
export * from './rateLimitMonitor';
export * from './dashboard';
export * from './metricsAggregator';

export default monitoringSystem;