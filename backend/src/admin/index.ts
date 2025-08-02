import { configManager } from '../config/configManager';
import { adminInterface } from './adminInterface';
import { monitoringSystem } from '../monitoring/index';

/**
 * Administrative System Integration
 * 
 * This module integrates all administrative components:
 * - Configuration Manager: Policy and system configuration management
 * - Admin Interface: Web-based administrative interface
 * - Monitoring Integration: Real-time system monitoring and alerts
 * 
 * Provides a unified interface to start, stop, and manage
 * the complete administrative infrastructure.
 */

export interface AdminSystemConfig {
  configManager: {
    enabled: boolean;
    configPath?: string;
    autoSave: boolean;
    backupInterval: number; // ms
  };
  adminInterface: {
    enabled: boolean;
    port: number;
    enableAuth: boolean;
    sessionTimeout: number;
  };
  monitoring: {
    enableIntegration: boolean;
    alertsEnabled: boolean;
    metricsEnabled: boolean;
  };
}

export class AdminSystem {
  private config: AdminSystemConfig;
  private isRunning = false;
  private backupInterval?: NodeJS.Timeout;

  constructor(config: Partial<AdminSystemConfig> = {}) {
    this.config = {
      configManager: {
        enabled: true,
        autoSave: true,
        backupInterval: 4 * 60 * 60 * 1000, // 4 hours
        ...config.configManager
      },
      adminInterface: {
        enabled: true,
        port: parseInt(process.env.ADMIN_PORT || '8081'),
        enableAuth: process.env.ADMIN_AUTH_ENABLED !== 'false',
        sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
        ...config.adminInterface
      },
      monitoring: {
        enableIntegration: true,
        alertsEnabled: true,
        metricsEnabled: true,
        ...config.monitoring
      }
    };
    
    console.log('🔧 Admin System initialized with configuration:');
    console.log(`   Configuration Manager: ${this.config.configManager.enabled ? 'enabled' : 'disabled'}`);
    console.log(`   Admin Interface: ${this.config.adminInterface.enabled ? `enabled on port ${this.config.adminInterface.port}` : 'disabled'}`);
    console.log(`   Monitoring Integration: ${this.config.monitoring.enableIntegration ? 'enabled' : 'disabled'}`);
  }

  /**
   * Start the complete administrative system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Admin system already running');
      return;
    }

    console.log('🚀 Starting Administrative System...');
    
    try {
      // Initialize configuration manager first
      if (this.config.configManager.enabled) {
        await configManager.loadConfiguration();
        this.setupConfigurationIntegration();
        
        if (this.config.configManager.autoSave) {
          this.startAutomaticBackups();
        }
      }
      
      // Start admin interface
      if (this.config.adminInterface.enabled) {
        await adminInterface.start();
        this.setupAdminIntegration();
      }
      
      // Setup monitoring integration
      if (this.config.monitoring.enableIntegration) {
        this.setupMonitoringIntegration();
      }
      
      this.isRunning = true;
      
      console.log('✅ Administrative system started successfully');
      console.log('🔧 Available interfaces:');
      
      if (this.config.adminInterface.enabled) {
        console.log(`   - Admin Dashboard: http://localhost:${this.config.adminInterface.port}/admin`);
        console.log(`   - Admin API: http://localhost:${this.config.adminInterface.port}/admin/api/`);
      }
      
      if (this.config.configManager.enabled) {
        const status = configManager.getStatus();
        console.log(`   - Configuration: ${status.stats.policies} policies, ${status.stats.tiers} tiers`);
      }
      
      // Log initial system health
      await this.logSystemHealth();
      
    } catch (error) {
      console.error('❌ Failed to start administrative system:', error);
      throw error;
    }
  }

  /**
   * Stop the administrative system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('⏹️ Stopping Administrative System...');
    
    try {
      // Stop automatic backups
      if (this.backupInterval) {
        clearInterval(this.backupInterval);
      }
      
      // Save final configuration
      if (this.config.configManager.enabled) {
        await configManager.saveConfiguration();
      }
      
      // Stop admin interface
      if (this.config.adminInterface.enabled) {
        await adminInterface.stop();
      }
      
      this.isRunning = false;
      console.log('✅ Administrative system stopped');
      
    } catch (error) {
      console.error('❌ Error stopping administrative system:', error);
      throw error;
    }
  }

  /**
   * Get system status
   */
  getStatus(): {
    running: boolean;
    components: {
      configManager: any;
      adminInterface: { running: boolean; port?: number };
      monitoring: { integrated: boolean };
    };
    health: 'healthy' | 'degraded' | 'critical';
    lastHealthCheck: number;
  } {
    const configStatus = this.config.configManager.enabled ? configManager.getStatus() : null;
    const monitoringStatus = this.config.monitoring.enableIntegration ? monitoringSystem.getStatus() : null;
    
    // Determine overall health
    let health: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (!this.isRunning) {
      health = 'critical';
    } else if (monitoringStatus && monitoringStatus.health !== 'healthy') {
      health = monitoringStatus.health;
    } else if (configStatus && !configStatus.loaded) {
      health = 'degraded';
    }
    
    return {
      running: this.isRunning,
      components: {
        configManager: configStatus,
        adminInterface: {
          running: this.config.adminInterface.enabled && this.isRunning,
          port: this.config.adminInterface.port
        },
        monitoring: {
          integrated: this.config.monitoring.enableIntegration
        }
      },
      health,
      lastHealthCheck: Date.now()
    };
  }

  /**
   * Perform administrative action
   */
  async executeAdminAction(
    action: string,
    params: any,
    userId: string = 'system'
  ): Promise<any> {
    if (!this.isRunning) {
      throw new Error('Administrative system is not running');
    }
    
    switch (action) {
      case 'create_policy':
        return await configManager.setPolicy(params, userId);
        
      case 'update_policy':
        return await configManager.setPolicy(params, userId);
        
      case 'delete_policy':
        return await configManager.deletePolicy(params.id, userId, params.reason);
        
      case 'add_whitelist':
        return await configManager.addToWhitelist(params, userId);
        
      case 'add_blacklist':
        return await configManager.addToBlacklist(params, userId);
        
      case 'update_system_config':
        return await configManager.updateSystemConfig(params, userId, params.reason);
        
      case 'create_backup':
        return await configManager.createBackup(params.description || 'Manual backup', userId);
        
      case 'restore_backup':
        return await configManager.restoreBackup(params.backupId, userId);
        
      case 'system_health_check':
        return this.getStatus();
        
      default:
        throw new Error(`Unknown administrative action: ${action}`);
    }
  }

  /**
   * Setup configuration management integration
   */
  private setupConfigurationIntegration(): void {
    // Listen for configuration changes
    configManager.on('policyChanged', (event) => {
      console.log(`📋 Policy ${event.action}: ${event.policy.name} (${event.policy.tier})`);
      
      // Record metric for monitoring
      if (this.config.monitoring.metricsEnabled) {
        monitoringSystem.recordMetric('admin', 'policy_change', 1, {
          action: event.action,
          policyId: event.policy.id,
          tier: event.policy.tier
        });
      }
    });
    
    configManager.on('tierChanged', (event) => {
      console.log(`🏆 Tier ${event.action}: ${event.tier.tier}`);
      
      if (this.config.monitoring.metricsEnabled) {
        monitoringSystem.recordMetric('admin', 'tier_change', 1, {
          action: event.action,
          tier: event.tier.tier
        });
      }
    });
    
    configManager.on('systemConfigChanged', (event) => {
      console.log('⚙️ System configuration updated');
      
      if (this.config.monitoring.metricsEnabled) {
        monitoringSystem.recordMetric('admin', 'config_change', 1, {
          component: 'system'
        });
      }
    });
    
    configManager.on('backupCreated', (backup) => {
      console.log(`💾 Configuration backup created: ${backup.id}`);
      
      if (this.config.monitoring.metricsEnabled) {
        monitoringSystem.recordMetric('admin', 'backup_created', 1, {
          backupId: backup.id
        });
      }
    });
    
    configManager.on('auditLogged', (entry) => {
      // Log high-priority audit events
      if (['delete', 'restore'].includes(entry.action)) {
        console.log(`📋 Audit: ${entry.action} on ${entry.resource} by ${entry.userId}`);
      }
    });
  }

  /**
   * Setup admin interface integration
   */
  private setupAdminIntegration(): void {
    // Listen for admin interface events
    adminInterface.on('userLogin', (event) => {
      console.log(`👤 Admin login: ${event.user} from ${event.ip}`);
      
      if (this.config.monitoring.metricsEnabled) {
        monitoringSystem.recordMetric('admin', 'user_login', 1, {
          username: event.user,
          ip: event.ip
        });
      }
    });
    
    // Setup admin-initiated monitoring actions
    adminInterface.on('monitoringAction', (action) => {
      console.log(`📊 Admin monitoring action: ${action.type}`);
    });
  }

  /**
   * Setup monitoring system integration
   */
  private setupMonitoringIntegration(): void {
    // Import rateLimitMonitor directly for event handling
    const { rateLimitMonitor } = require('../monitoring/index');
    
    // Listen for monitoring events that should trigger admin actions
    rateLimitMonitor.on('alertTriggered', (alert: any) => {
      if (alert.severity === 'critical') {
        console.log(`🚨 Critical alert triggered: ${alert.ruleName}`);
        
        // Could trigger automatic administrative actions here
        // For example, temporarily blocking IPs, adjusting rate limits, etc.
      }
    });
    
    rateLimitMonitor.on('securityEvent', async (event: any) => {
      if (event.severity === 'critical' && event.details.ip) {
        console.log(`🛡️ Security event: ${event.type} from ${event.details.ip}`);
        
        // Auto-add to blacklist for critical security events
        try {
          await configManager.addToBlacklist({
            type: 'ip',
            value: event.details.ip,
            reason: `Automatic blacklist due to ${event.type}`,
            severity: 'high',
            enabled: true,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
            createdBy: 'system'
          }, 'monitoring-system');
          
          console.log(`🚫 Auto-blacklisted IP: ${event.details.ip}`);
        } catch (error) {
          console.error('Failed to auto-blacklist IP:', error);
        }
      }
    });
  }

  /**
   * Start automatic configuration backups
   */
  private startAutomaticBackups(): void {
    this.backupInterval = setInterval(async () => {
      try {
        const backup = await configManager.createBackup('Automatic backup', 'system');
        console.log(`💾 Automatic backup created: ${backup.id}`);
      } catch (error) {
        console.error('❌ Failed to create automatic backup:', error);
      }
    }, this.config.configManager.backupInterval);
    
    console.log(`⏰ Automatic backups enabled (every ${this.config.configManager.backupInterval / 1000 / 60} minutes)`);
  }

  /**
   * Log system health status
   */
  private async logSystemHealth(): Promise<void> {
    const status = this.getStatus();
    
    console.log(`🏥 System Health Check:`);
    console.log(`   Overall Health: ${status.health.toUpperCase()}`);
    console.log(`   Components: ${Object.entries(status.components).map(([name, comp]) => 
      `${name}=${comp.running || comp.loaded || comp.integrated ? 'OK' : 'FAIL'}`
    ).join(', ')}`);
    
    if (this.config.monitoring.metricsEnabled) {
      monitoringSystem.recordMetric('admin', 'health_check', 1, {
        health: status.health,
        running: status.running ? '1' : '0'
      });
    }
  }

  /**
   * Public API methods for external integration
   */
  
  // Configuration management
  async createPolicy(policy: any, userId: string): Promise<any> {
    return await this.executeAdminAction('create_policy', policy, userId);
  }
  
  async updatePolicy(policy: any, userId: string): Promise<any> {
    return await this.executeAdminAction('update_policy', policy, userId);
  }
  
  async deletePolicy(policyId: string, userId: string, reason?: string): Promise<any> {
    return await this.executeAdminAction('delete_policy', { id: policyId, reason }, userId);
  }
  
  // Whitelist/blacklist management
  async addToWhitelist(entry: any, userId: string): Promise<any> {
    return await this.executeAdminAction('add_whitelist', entry, userId);
  }
  
  async addToBlacklist(entry: any, userId: string): Promise<any> {
    return await this.executeAdminAction('add_blacklist', entry, userId);
  }
  
  // System configuration
  async updateSystemConfig(config: any, userId: string, reason?: string): Promise<any> {
    return await this.executeAdminAction('update_system_config', { ...config, reason }, userId);
  }
  
  // Backup and restore
  async createBackup(description: string, userId: string): Promise<any> {
    return await this.executeAdminAction('create_backup', { description }, userId);
  }
  
  async restoreBackup(backupId: string, userId: string): Promise<any> {
    return await this.executeAdminAction('restore_backup', { backupId }, userId);
  }
  
  // Status and monitoring
  getSystemStatus() {
    return this.getStatus();
  }
  
  getConfigurationStatus() {
    return configManager.getStatus();
  }
  
  getMonitoringStatus() {
    return monitoringSystem.getStatus();
  }
  
  // Audit and logging
  getAuditLog(limit = 100) {
    return configManager.getAuditLog(limit);
  }
}

// Create and export singleton instance
export const adminSystem = new AdminSystem();

// Export individual components for direct access if needed
export {
  configManager,
  adminInterface
};

// Export types
export * from '../config/configManager';
export * from './adminInterface';

export default adminSystem;