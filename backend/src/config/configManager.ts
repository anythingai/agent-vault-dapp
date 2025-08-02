import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/**
 * Rate Limiting Configuration Management System
 * 
 * Features:
 * - Dynamic rate limit policy management
 * - User tier configuration and assignment
 * - Whitelist/blacklist management
 * - System-wide parameter control
 * - Configuration versioning and rollback
 * - Hot configuration reloading
 * - Backup and restore capabilities
 * - Audit logging for all changes
 */

export interface RateLimitPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'admin';
  limits: {
    requests: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
    concurrent: number;
    burstSize: number;
    queueSize: number;
  };
  restrictions: {
    maxRequestSize: number; // bytes
    allowedMethods: string[];
    blockedUserAgents: string[];
    geoRestrictions?: string[]; // country codes
  };
  penalties: {
    cooldownPeriod: number; // ms
    progressiveMultiplier: number;
    maxCooldown: number; // ms
    autoBlock: {
      enabled: boolean;
      threshold: number;
      duration: number; // ms
    };
  };
  crossChain: {
    enabled: boolean;
    coordinationWeight: number;
    maxChainOperations: number;
    economicLimits: {
      maxValuePerOperation: number; // USD equivalent
      maxDailyValue: number; // USD equivalent
    };
  };
  metadata: {
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    version: number;
  };
}

export interface UserTierConfig {
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'admin';
  displayName: string;
  description: string;
  policyId: string;
  pricing?: {
    monthly: number;
    annual: number;
  };
  features: string[];
  quotas: {
    apiCalls: number;
    swapVolume: number; // USD
    supportLevel: 'community' | 'standard' | 'priority' | 'dedicated';
  };
  upgradePath?: string; // Next tier
}

export interface WhitelistEntry {
  id: string;
  type: 'ip' | 'user' | 'api_key' | 'user_agent';
  value: string;
  reason: string;
  enabled: boolean;
  expiresAt?: number;
  createdBy: string;
  createdAt: number;
}

export interface BlacklistEntry {
  id: string;
  type: 'ip' | 'user' | 'api_key' | 'user_agent';
  value: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  expiresAt?: number;
  createdBy: string;
  createdAt: number;
  violationHistory?: {
    count: number;
    lastViolation: number;
    patterns: string[];
  };
}

export interface SystemConfig {
  global: {
    enabled: boolean;
    maintenanceMode: boolean;
    emergencyMode: boolean;
    defaultTier: string;
    maxConcurrentUsers: number;
    circuitBreaker: {
      enabled: boolean;
      failureThreshold: number;
      recoveryTime: number;
    };
  };
  security: {
    requireApiKey: boolean;
    requireAuth: boolean;
    allowAnonymous: boolean;
    encryptLogs: boolean;
    auditLevel: 'minimal' | 'standard' | 'detailed' | 'verbose';
  };
  performance: {
    cacheEnabled: boolean;
    cacheTTL: number;
    batchProcessing: boolean;
    batchSize: number;
    compression: boolean;
  };
  monitoring: {
    enableMetrics: boolean;
    enableAlerts: boolean;
    retentionDays: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      queueSize: number;
    };
  };
  integrations: {
    blockchain: {
      ethereum: {
        rpcUrl: string;
        gasLimit: number;
        maxGasPrice: number;
      };
      bitcoin: {
        rpcUrl: string;
        confirmations: number;
        dustThreshold: number;
      };
    };
    external: {
      priceOracle: string;
      exchangeRates: string;
      geoLocation: string;
    };
  };
}

export interface ConfigurationBackup {
  id: string;
  timestamp: number;
  version: string;
  createdBy: string;
  description: string;
  data: {
    policies: RateLimitPolicy[];
    tiers: UserTierConfig[];
    whitelist: WhitelistEntry[];
    blacklist: BlacklistEntry[];
    systemConfig: SystemConfig;
  };
  checksum: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: 'create' | 'update' | 'delete' | 'backup' | 'restore' | 'reload';
  resource: 'policy' | 'tier' | 'whitelist' | 'blacklist' | 'system' | 'backup';
  resourceId: string;
  userId: string;
  changes?: {
    before: any;
    after: any;
  };
  reason?: string;
  ipAddress: string;
  userAgent: string;
}

export class ConfigurationManager extends EventEmitter {
  private configPath: string;
  private policies: Map<string, RateLimitPolicy> = new Map();
  private tiers: Map<string, UserTierConfig> = new Map();
  private whitelist: Map<string, WhitelistEntry> = new Map();
  private blacklist: Map<string, BlacklistEntry> = new Map();
  private systemConfig: SystemConfig;
  private auditLog: AuditLogEntry[] = [];
  private backups: Map<string, ConfigurationBackup> = new Map();
  
  // Hot reload state
  private isLoaded = false;
  private watchEnabled = true;
  private configVersion = 0;

  constructor(configPath = './config/rate-limiting') {
    super();
    this.configPath = configPath;
    
    // Initialize default system configuration
    this.systemConfig = this.getDefaultSystemConfig();
    
    console.log('🔧 Configuration Manager initialized');
  }

  /**
   * Load all configuration from files
   */
  async loadConfiguration(): Promise<void> {
    try {
      await this.ensureConfigDirectory();
      
      // Load each configuration type
      await Promise.all([
        this.loadPolicies(),
        this.loadTiers(),
        this.loadWhitelist(),
        this.loadBlacklist(),
        this.loadSystemConfig(),
        this.loadAuditLog(),
        this.loadBackups()
      ]);
      
      this.isLoaded = true;
      this.configVersion++;
      
      console.log('📂 Configuration loaded successfully');
      console.log(`   Policies: ${this.policies.size}`);
      console.log(`   Tiers: ${this.tiers.size}`);
      console.log(`   Whitelist: ${this.whitelist.size}`);
      console.log(`   Blacklist: ${this.blacklist.size}`);
      
      this.emit('configurationLoaded', {
        version: this.configVersion,
        policies: this.policies.size,
        tiers: this.tiers.size,
        whitelist: this.whitelist.size,
        blacklist: this.blacklist.size
      });
      
    } catch (error) {
      console.error('❌ Failed to load configuration:', error);
      throw error;
    }
  }

  /**
   * Save all configuration to files
   */
  async saveConfiguration(): Promise<void> {
    try {
      await Promise.all([
        this.savePolicies(),
        this.saveTiers(),
        this.saveWhitelist(),
        this.saveBlacklist(),
        this.saveSystemConfig(),
        this.saveAuditLog()
      ]);
      
      console.log('💾 Configuration saved successfully');
      this.emit('configurationSaved', { version: this.configVersion });
      
    } catch (error) {
      console.error('❌ Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Create or update a rate limiting policy
   */
  async setPolicy(policy: Partial<RateLimitPolicy>, userId: string, reason?: string): Promise<RateLimitPolicy> {
    const existingPolicy = policy.id ? this.policies.get(policy.id) : null;
    
    const fullPolicy: RateLimitPolicy = {
      id: policy.id || this.generateId(),
      name: policy.name || 'New Policy',
      description: policy.description || '',
      enabled: policy.enabled ?? true,
      tier: policy.tier || 'basic',
      limits: {
        requests: {
          perSecond: policy.limits?.requests?.perSecond || 10,
          perMinute: policy.limits?.requests?.perMinute || 600,
          perHour: policy.limits?.requests?.perHour || 36000,
          perDay: policy.limits?.requests?.perDay || 864000
        },
        concurrent: policy.limits?.concurrent || 5,
        burstSize: policy.limits?.burstSize || 20,
        queueSize: policy.limits?.queueSize || 100
      },
      restrictions: {
        maxRequestSize: policy.restrictions?.maxRequestSize || 1024 * 1024, // 1MB
        allowedMethods: policy.restrictions?.allowedMethods || ['GET', 'POST'],
        blockedUserAgents: policy.restrictions?.blockedUserAgents || [],
        geoRestrictions: policy.restrictions?.geoRestrictions
      },
      penalties: {
        cooldownPeriod: policy.penalties?.cooldownPeriod || 60000, // 1 minute
        progressiveMultiplier: policy.penalties?.progressiveMultiplier || 2,
        maxCooldown: policy.penalties?.maxCooldown || 3600000, // 1 hour
        autoBlock: {
          enabled: policy.penalties?.autoBlock?.enabled ?? false,
          threshold: policy.penalties?.autoBlock?.threshold || 10,
          duration: policy.penalties?.autoBlock?.duration || 86400000 // 24 hours
        }
      },
      crossChain: {
        enabled: policy.crossChain?.enabled ?? true,
        coordinationWeight: policy.crossChain?.coordinationWeight || 1,
        maxChainOperations: policy.crossChain?.maxChainOperations || 100,
        economicLimits: {
          maxValuePerOperation: policy.crossChain?.economicLimits?.maxValuePerOperation || 10000,
          maxDailyValue: policy.crossChain?.economicLimits?.maxDailyValue || 100000
        }
      },
      metadata: {
        createdAt: existingPolicy?.metadata.createdAt || Date.now(),
        updatedAt: Date.now(),
        createdBy: existingPolicy?.metadata.createdBy || userId,
        version: (existingPolicy?.metadata.version || 0) + 1
      },
      ...policy
    };
    
    this.policies.set(fullPolicy.id, fullPolicy);
    
    // Log the change
    await this.logAudit({
      action: existingPolicy ? 'update' : 'create',
      resource: 'policy',
      resourceId: fullPolicy.id,
      userId,
      changes: existingPolicy ? { before: existingPolicy, after: fullPolicy } : undefined,
      reason,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.savePolicies();
    
    this.emit('policyChanged', {
      action: existingPolicy ? 'updated' : 'created',
      policy: fullPolicy,
      previous: existingPolicy
    });
    
    return fullPolicy;
  }

  /**
   * Delete a rate limiting policy
   */
  async deletePolicy(policyId: string, userId: string, reason?: string): Promise<boolean> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }
    
    // Check if policy is in use by any tier
    const usedByTier = Array.from(this.tiers.values()).some(tier => tier.policyId === policyId);
    if (usedByTier) {
      throw new Error(`Cannot delete policy ${policyId}: still in use by user tiers`);
    }
    
    this.policies.delete(policyId);
    
    await this.logAudit({
      action: 'delete',
      resource: 'policy',
      resourceId: policyId,
      userId,
      changes: { before: policy, after: null },
      reason,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.savePolicies();
    
    this.emit('policyChanged', {
      action: 'deleted',
      policy,
      previous: policy
    });
    
    return true;
  }

  /**
   * Get a specific policy
   */
  getPolicy(policyId: string): RateLimitPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): RateLimitPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get policies by tier
   */
  getPoliciesByTier(tier: string): RateLimitPolicy[] {
    return Array.from(this.policies.values()).filter(policy => policy.tier === tier);
  }

  /**
   * Create or update a user tier
   */
  async setTier(tier: UserTierConfig, userId: string, reason?: string): Promise<UserTierConfig> {
    const existingTier = this.tiers.get(tier.tier);
    
    // Validate that the policy exists
    if (!this.policies.has(tier.policyId)) {
      throw new Error(`Policy not found: ${tier.policyId}`);
    }
    
    this.tiers.set(tier.tier, tier);
    
    await this.logAudit({
      action: existingTier ? 'update' : 'create',
      resource: 'tier',
      resourceId: tier.tier,
      userId,
      changes: existingTier ? { before: existingTier, after: tier } : undefined,
      reason,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveTiers();
    
    this.emit('tierChanged', {
      action: existingTier ? 'updated' : 'created',
      tier,
      previous: existingTier
    });
    
    return tier;
  }

  /**
   * Get all tiers
   */
  getAllTiers(): UserTierConfig[] {
    return Array.from(this.tiers.values());
  }

  /**
   * Add to whitelist
   */
  async addToWhitelist(entry: Omit<WhitelistEntry, 'id' | 'createdAt'>, userId: string): Promise<WhitelistEntry> {
    const whitelistEntry: WhitelistEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: Date.now()
    };
    
    this.whitelist.set(whitelistEntry.id, whitelistEntry);
    
    await this.logAudit({
      action: 'create',
      resource: 'whitelist',
      resourceId: whitelistEntry.id,
      userId,
      reason: `Added ${entry.type}: ${entry.value}`,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveWhitelist();
    
    this.emit('whitelistChanged', {
      action: 'added',
      entry: whitelistEntry
    });
    
    return whitelistEntry;
  }

  /**
   * Remove from whitelist
   */
  async removeFromWhitelist(entryId: string, userId: string): Promise<boolean> {
    const entry = this.whitelist.get(entryId);
    if (!entry) {
      return false;
    }
    
    this.whitelist.delete(entryId);
    
    await this.logAudit({
      action: 'delete',
      resource: 'whitelist',
      resourceId: entryId,
      userId,
      changes: { before: entry, after: null },
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveWhitelist();
    
    this.emit('whitelistChanged', {
      action: 'removed',
      entry
    });
    
    return true;
  }

  /**
   * Add to blacklist
   */
  async addToBlacklist(entry: Omit<BlacklistEntry, 'id' | 'createdAt'>, userId: string): Promise<BlacklistEntry> {
    const blacklistEntry: BlacklistEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: Date.now()
    };
    
    this.blacklist.set(blacklistEntry.id, blacklistEntry);
    
    await this.logAudit({
      action: 'create',
      resource: 'blacklist',
      resourceId: blacklistEntry.id,
      userId,
      reason: `Added ${entry.type}: ${entry.value}`,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveBlacklist();
    
    this.emit('blacklistChanged', {
      action: 'added',
      entry: blacklistEntry
    });
    
    return blacklistEntry;
  }

  /**
   * Check if value is whitelisted
   */
  isWhitelisted(type: string, value: string): WhitelistEntry | null {
    for (const entry of this.whitelist.values()) {
      if (entry.enabled && entry.type === type && entry.value === value) {
        if (!entry.expiresAt || entry.expiresAt > Date.now()) {
          return entry;
        }
      }
    }
    return null;
  }

  /**
   * Check if value is blacklisted
   */
  isBlacklisted(type: string, value: string): BlacklistEntry | null {
    for (const entry of this.blacklist.values()) {
      if (entry.enabled && entry.type === type && entry.value === value) {
        if (!entry.expiresAt || entry.expiresAt > Date.now()) {
          return entry;
        }
      }
    }
    return null;
  }

  /**
   * Update system configuration
   */
  async updateSystemConfig(config: Partial<SystemConfig>, userId: string, reason?: string): Promise<SystemConfig> {
    const previousConfig = { ...this.systemConfig };
    
    // Deep merge configuration
    this.systemConfig = this.deepMerge(this.systemConfig, config);
    
    await this.logAudit({
      action: 'update',
      resource: 'system',
      resourceId: 'system-config',
      userId,
      changes: { before: previousConfig, after: this.systemConfig },
      reason,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveSystemConfig();
    
    this.emit('systemConfigChanged', {
      previous: previousConfig,
      current: this.systemConfig
    });
    
    return this.systemConfig;
  }

  /**
   * Create configuration backup
   */
  async createBackup(description: string, userId: string): Promise<ConfigurationBackup> {
    const backup: ConfigurationBackup = {
      id: this.generateId(),
      timestamp: Date.now(),
      version: this.configVersion.toString(),
      createdBy: userId,
      description,
      data: {
        policies: Array.from(this.policies.values()),
        tiers: Array.from(this.tiers.values()),
        whitelist: Array.from(this.whitelist.values()),
        blacklist: Array.from(this.blacklist.values()),
        systemConfig: { ...this.systemConfig }
      },
      checksum: ''
    };
    
    // Generate checksum
    backup.checksum = this.calculateChecksum(backup.data);
    
    this.backups.set(backup.id, backup);
    
    await this.logAudit({
      action: 'backup',
      resource: 'backup',
      resourceId: backup.id,
      userId,
      reason: description,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    await this.saveBackup(backup);
    
    this.emit('backupCreated', backup);
    
    return backup;
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupId: string, userId: string): Promise<void> {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    // Verify checksum
    const calculatedChecksum = this.calculateChecksum(backup.data);
    if (calculatedChecksum !== backup.checksum) {
      throw new Error('Backup integrity check failed: checksum mismatch');
    }
    
    // Create current backup before restore
    await this.createBackup(`Pre-restore backup before restoring ${backupId}`, userId);
    
    // Restore data
    this.policies.clear();
    backup.data.policies.forEach(policy => this.policies.set(policy.id, policy));
    
    this.tiers.clear();
    backup.data.tiers.forEach(tier => this.tiers.set(tier.tier, tier));
    
    this.whitelist.clear();
    backup.data.whitelist.forEach(entry => this.whitelist.set(entry.id, entry));
    
    this.blacklist.clear();
    backup.data.blacklist.forEach(entry => this.blacklist.set(entry.id, entry));
    
    this.systemConfig = { ...backup.data.systemConfig };
    
    await this.saveConfiguration();
    
    await this.logAudit({
      action: 'restore',
      resource: 'backup',
      resourceId: backupId,
      userId,
      reason: `Restored from backup: ${backup.description}`,
      ipAddress: 'system',
      userAgent: 'config-manager'
    });
    
    this.emit('backupRestored', {
      backup,
      timestamp: Date.now()
    });
  }

  /**
   * Get system status and statistics
   */
  getStatus(): {
    loaded: boolean;
    version: number;
    stats: {
      policies: number;
      tiers: number;
      whitelist: number;
      blacklist: number;
      auditEntries: number;
      backups: number;
    };
    systemConfig: SystemConfig;
  } {
    return {
      loaded: this.isLoaded,
      version: this.configVersion,
      stats: {
        policies: this.policies.size,
        tiers: this.tiers.size,
        whitelist: this.whitelist.size,
        blacklist: this.blacklist.size,
        auditEntries: this.auditLog.length,
        backups: this.backups.size
      },
      systemConfig: this.systemConfig
    };
  }

  /**
   * Get audit log
   */
  getAuditLog(limit = 100): AuditLogEntry[] {
    return this.auditLog
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Initialize default system configuration
   */
  private getDefaultSystemConfig(): SystemConfig {
    return {
      global: {
        enabled: true,
        maintenanceMode: false,
        emergencyMode: false,
        defaultTier: 'free',
        maxConcurrentUsers: 10000,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 10,
          recoveryTime: 60000
        }
      },
      security: {
        requireApiKey: true,
        requireAuth: false,
        allowAnonymous: true,
        encryptLogs: false,
        auditLevel: 'standard'
      },
      performance: {
        cacheEnabled: true,
        cacheTTL: 300000, // 5 minutes
        batchProcessing: true,
        batchSize: 100,
        compression: true
      },
      monitoring: {
        enableMetrics: true,
        enableAlerts: true,
        retentionDays: 30,
        alertThresholds: {
          errorRate: 5, // 5%
          responseTime: 1000, // 1 second
          queueSize: 1000
        }
      },
      integrations: {
        blockchain: {
          ethereum: {
            rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://mainnet.infura.io/v3/your-key',
            gasLimit: 500000,
            maxGasPrice: 50000000000 // 50 gwei
          },
          bitcoin: {
            rpcUrl: process.env.BITCOIN_RPC_URL || 'https://bitcoin-node.com',
            confirmations: 6,
            dustThreshold: 546
          }
        },
        external: {
          priceOracle: 'https://api.coingecko.com/api/v3',
          exchangeRates: 'https://api.exchangerate-api.com/v4/latest/USD',
          geoLocation: 'https://ipapi.co'
        }
      }
    };
  }

  /**
   * File operations
   */
  private async ensureConfigDirectory(): Promise<void> {
    if (!existsSync(this.configPath)) {
      await mkdir(this.configPath, { recursive: true });
    }
  }

  private async loadPolicies(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'policies.json'), 'utf-8');
      const policies = JSON.parse(data);
      this.policies.clear();
      policies.forEach((policy: RateLimitPolicy) => this.policies.set(policy.id, policy));
    } catch (error) {
      // File doesn't exist or is invalid, start with empty policies
      console.log('📝 No existing policies found, starting fresh');
    }
  }

  private async savePolicies(): Promise<void> {
    const data = JSON.stringify(Array.from(this.policies.values()), null, 2);
    await writeFile(join(this.configPath, 'policies.json'), data);
  }

  private async loadTiers(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'tiers.json'), 'utf-8');
      const tiers = JSON.parse(data);
      this.tiers.clear();
      tiers.forEach((tier: UserTierConfig) => this.tiers.set(tier.tier, tier));
    } catch (error) {
      // Initialize with default tiers if none exist
      await this.initializeDefaultTiers();
    }
  }

  private async saveTiers(): Promise<void> {
    const data = JSON.stringify(Array.from(this.tiers.values()), null, 2);
    await writeFile(join(this.configPath, 'tiers.json'), data);
  }

  private async loadWhitelist(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'whitelist.json'), 'utf-8');
      const entries = JSON.parse(data);
      this.whitelist.clear();
      entries.forEach((entry: WhitelistEntry) => this.whitelist.set(entry.id, entry));
    } catch (error) {
      console.log('📝 No existing whitelist found');
    }
  }

  private async saveWhitelist(): Promise<void> {
    const data = JSON.stringify(Array.from(this.whitelist.values()), null, 2);
    await writeFile(join(this.configPath, 'whitelist.json'), data);
  }

  private async loadBlacklist(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'blacklist.json'), 'utf-8');
      const entries = JSON.parse(data);
      this.blacklist.clear();
      entries.forEach((entry: BlacklistEntry) => this.blacklist.set(entry.id, entry));
    } catch (error) {
      console.log('📝 No existing blacklist found');
    }
  }

  private async saveBlacklist(): Promise<void> {
    const data = JSON.stringify(Array.from(this.blacklist.values()), null, 2);
    await writeFile(join(this.configPath, 'blacklist.json'), data);
  }

  private async loadSystemConfig(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'system.json'), 'utf-8');
      this.systemConfig = { ...this.systemConfig, ...JSON.parse(data) };
    } catch (error) {
      console.log('📝 No existing system config found, using defaults');
    }
  }

  private async saveSystemConfig(): Promise<void> {
    const data = JSON.stringify(this.systemConfig, null, 2);
    await writeFile(join(this.configPath, 'system.json'), data);
  }

  private async loadAuditLog(): Promise<void> {
    try {
      const data = await readFile(join(this.configPath, 'audit.json'), 'utf-8');
      this.auditLog = JSON.parse(data);
    } catch (error) {
      this.auditLog = [];
    }
  }

  private async saveAuditLog(): Promise<void> {
    // Keep only last 10000 entries to prevent file from growing too large
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
    
    const data = JSON.stringify(this.auditLog, null, 2);
    await writeFile(join(this.configPath, 'audit.json'), data);
  }

  private async loadBackups(): Promise<void> {
    // Implementation would load backup metadata
    // Actual backup files would be stored separately
    this.backups.clear();
  }

  private async saveBackup(backup: ConfigurationBackup): Promise<void> {
    const fileName = `backup-${backup.id}.json`;
    const data = JSON.stringify(backup, null, 2);
    await writeFile(join(this.configPath, fileName), data);
  }

  private async initializeDefaultTiers(): Promise<void> {
    // Create default policies first
    const defaultPolicies = this.getDefaultPolicies();
    for (const policy of defaultPolicies) {
      this.policies.set(policy.id, policy);
    }
    await this.savePolicies();

    // Create default tiers
    const defaultTiers = this.getDefaultTiers();
    for (const tier of defaultTiers) {
      this.tiers.set(tier.tier, tier);
    }
    await this.saveTiers();
  }

  private getDefaultPolicies(): RateLimitPolicy[] {
    const baseMetadata = {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'system',
      version: 1
    };

    return [
      {
        id: 'policy-free',
        name: 'Free Tier Policy',
        description: 'Basic rate limiting for free users',
        enabled: true,
        tier: 'free',
        limits: {
          requests: { perSecond: 2, perMinute: 60, perHour: 1000, perDay: 10000 },
          concurrent: 2,
          burstSize: 5,
          queueSize: 10
        },
        restrictions: {
          maxRequestSize: 512 * 1024,
          allowedMethods: ['GET', 'POST'],
          blockedUserAgents: [],
          geoRestrictions: []
        },
        penalties: {
          cooldownPeriod: 300000, // 5 minutes
          progressiveMultiplier: 2,
          maxCooldown: 1800000, // 30 minutes
          autoBlock: { enabled: false, threshold: 10, duration: 3600000 }
        },
        crossChain: {
          enabled: true,
          coordinationWeight: 0.5,
          maxChainOperations: 10,
          economicLimits: { maxValuePerOperation: 100, maxDailyValue: 1000 }
        },
        metadata: baseMetadata
      },
      // Add more default policies for other tiers...
    ];
  }

  private getDefaultTiers(): UserTierConfig[] {
    return [
      {
        tier: 'free',
        displayName: 'Free',
        description: 'Basic access with limited features',
        policyId: 'policy-free',
        features: ['Basic API access', 'Community support'],
        quotas: {
          apiCalls: 10000,
          swapVolume: 1000,
          supportLevel: 'community'
        },
        upgradePath: 'basic'
      },
      // Add more default tiers...
    ];
  }

  /**
   * Helper methods
   */
  private generateId(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .substring(0, 12);
  }

  private async logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now()
    };
    
    this.auditLog.push(auditEntry);
    await this.saveAuditLog();
    
    this.emit('auditLogged', auditEntry);
  }

  private calculateChecksum(data: any): string {
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}

// Export singleton instance
export const configManager = new ConfigurationManager();

export default configManager;