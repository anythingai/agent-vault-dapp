import { SecretsManager, SecretConfig } from './index.js';
import crypto from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Key Rotation System
 * 
 * Provides automated key rotation capabilities for secrets management:
 * - Scheduled key rotation
 * - Emergency key rotation
 * - Key versioning and rollback
 * - Migration utilities
 */

export interface KeyRotationConfig {
  enabled: boolean;
  schedule: string; // Cron-like schedule
  retentionPeriod: number; // Days to keep old keys
  notificationWebhook?: string;
  emergencyContacts: string[];
  backupLocation: string;
}

export interface KeyVersion {
  version: number;
  key: string;
  createdAt: number;
  activatedAt?: number;
  deactivatedAt?: number;
  status: 'active' | 'inactive' | 'revoked';
}

export interface RotationLog {
  timestamp: number;
  version: number;
  action: 'created' | 'activated' | 'deactivated' | 'revoked';
  reason: string;
  success: boolean;
  error?: string;
}

export class KeyRotationManager {
  private config: KeyRotationConfig;
  private secretsManager: SecretsManager;
  private keyVersions: Map<string, KeyVersion[]> = new Map();
  private rotationLogs: RotationLog[] = [];

  constructor(config: KeyRotationConfig, secretsManager: SecretsManager) {
    this.config = config;
    this.secretsManager = secretsManager;
    this.loadExistingKeys();
    
    if (config.enabled) {
      this.scheduleRotation();
    }
    
    console.log(`🔄 Key Rotation Manager initialized (enabled: ${config.enabled})`);
  }

  /**
   * Perform manual key rotation
   */
  async rotateKeys(reason: string = 'Manual rotation'): Promise<void> {
    console.log('🔄 Starting key rotation...');
    
    try {
      // Get list of secrets to rotate
      const secretsToRotate = this.getSecretsForRotation();
      
      for (const secretName of secretsToRotate) {
        await this.rotateSecretKey(secretName, reason);
      }
      
      // Update rotation schedule
      this.logRotation(0, 'created', reason, true);
      
      // Send notifications
      await this.sendRotationNotification(true, reason);
      
      console.log('✅ Key rotation completed successfully');
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Key rotation failed:', error);
      
      this.logRotation(0, 'created', reason, false, errorMsg);
      await this.sendRotationNotification(false, reason, errorMsg);
      
      throw error;
    }
  }

  /**
   * Perform emergency key rotation
   */
  async emergencyRotation(reason: string): Promise<void> {
    console.log('🚨 Starting emergency key rotation...');
    
    // Mark current keys as revoked
    await this.revokeCurrentKeys();
    
    // Perform immediate rotation
    await this.rotateKeys(`EMERGENCY: ${reason}`);
    
    // Send emergency notifications
    await this.sendEmergencyNotification(reason);
    
    console.log('🚨 Emergency key rotation completed');
  }

  /**
   * Create new key version
   */
  async createKeyVersion(secretName: string): Promise<KeyVersion> {
    const existingVersions = this.keyVersions.get(secretName) || [];
    const newVersion = existingVersions.length + 1;
    
    const newKey: KeyVersion = {
      version: newVersion,
      key: this.generateSecureKey(),
      createdAt: Date.now(),
      status: 'inactive'
    };
    
    existingVersions.push(newKey);
    this.keyVersions.set(secretName, existingVersions);
    
    // Save to backup location
    await this.backupKeyVersion(secretName, newKey);
    
    console.log(`🔑 Created new key version ${newVersion} for ${secretName}`);
    return newKey;
  }

  /**
   * Activate key version
   */
  async activateKeyVersion(secretName: string, version: number): Promise<void> {
    const versions = this.keyVersions.get(secretName);
    if (!versions) {
      throw new Error(`No key versions found for ${secretName}`);
    }
    
    const keyVersion = versions.find(v => v.version === version);
    if (!keyVersion) {
      throw new Error(`Key version ${version} not found for ${secretName}`);
    }
    
    // Deactivate current active key
    const currentActive = versions.find(v => v.status === 'active');
    if (currentActive) {
      currentActive.status = 'inactive';
      currentActive.deactivatedAt = Date.now();
    }
    
    // Activate new key
    keyVersion.status = 'active';
    keyVersion.activatedAt = Date.now();
    
    // Update the secret in secrets manager
    await this.secretsManager.setSecret(secretName, keyVersion.key);
    
    this.logRotation(version, 'activated', 'Manual activation', true);
    console.log(`✅ Activated key version ${version} for ${secretName}`);
  }

  /**
   * Rollback to previous key version
   */
  async rollbackKey(secretName: string, targetVersion?: number): Promise<void> {
    const versions = this.keyVersions.get(secretName);
    if (!versions) {
      throw new Error(`No key versions found for ${secretName}`);
    }
    
    let rollbackTarget: KeyVersion;
    
    if (targetVersion) {
      const target = versions.find(v => v.version === targetVersion);
      if (!target) {
        throw new Error(`Key version ${targetVersion} not found`);
      }
      rollbackTarget = target;
    } else {
      // Find the most recent inactive version
      const inactive = versions
        .filter(v => v.status === 'inactive')
        .sort((a, b) => b.version - a.version)[0];
      
      if (!inactive) {
        throw new Error('No inactive key versions available for rollback');
      }
      
      rollbackTarget = inactive;
    }
    
    await this.activateKeyVersion(secretName, rollbackTarget.version);
    
    console.log(`🔙 Rolled back ${secretName} to version ${rollbackTarget.version}`);
  }

  /**
   * Get key version history
   */
  getKeyHistory(secretName: string): KeyVersion[] {
    return this.keyVersions.get(secretName) || [];
  }

  /**
   * Get rotation logs
   */
  getRotationLogs(limit?: number): RotationLog[] {
    return limit ? this.rotationLogs.slice(-limit) : [...this.rotationLogs];
  }

  /**
   * Clean up old key versions
   */
  async cleanupOldKeys(): Promise<void> {
    const retentionMs = this.config.retentionPeriod * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;
    
    for (const [secretName, versions] of this.keyVersions.entries()) {
      const oldVersions = versions.filter(v => 
        v.status !== 'active' && 
        v.createdAt < cutoffTime
      );
      
      for (const oldVersion of oldVersions) {
        oldVersion.status = 'revoked';
        console.log(`🗑️  Revoked old key version ${oldVersion.version} for ${secretName}`);
      }
      
      // Remove revoked versions older than retention period
      const filteredVersions = versions.filter(v => 
        v.status === 'active' || v.createdAt >= cutoffTime
      );
      
      this.keyVersions.set(secretName, filteredVersions);
    }
    
    console.log('🧹 Key cleanup completed');
  }

  // Private methods

  private loadExistingKeys(): void {
    const backupPath = join(this.config.backupLocation, 'key-versions.json');
    
    if (existsSync(backupPath)) {
      try {
        const data = readFileSync(backupPath, 'utf8');
        const keyData = JSON.parse(data);
        
        for (const [secretName, versions] of Object.entries(keyData)) {
          this.keyVersions.set(secretName, versions as KeyVersion[]);
        }
        
        console.log('📂 Loaded existing key versions from backup');
      } catch (error) {
        console.error('Failed to load existing key versions:', error);
      }
    }
  }

  private async rotateSecretKey(secretName: string, reason: string): Promise<void> {
    try {
      // Create new key version
      const newKeyVersion = await this.createKeyVersion(secretName);
      
      // Test the new key (if possible)
      await this.testNewKey(secretName, newKeyVersion.key);
      
      // Activate the new key
      await this.activateKeyVersion(secretName, newKeyVersion.version);
      
      console.log(`🔄 Rotated key for ${secretName} (version ${newKeyVersion.version})`);
      
    } catch (error) {
      console.error(`Failed to rotate key for ${secretName}:`, error);
      throw error;
    }
  }

  private async testNewKey(secretName: string, newKey: string): Promise<void> {
    // This would contain secret-specific validation logic
    // For now, just basic validation
    if (!newKey || newKey.length < 16) {
      throw new Error(`Generated key for ${secretName} does not meet minimum requirements`);
    }
  }

  private async revokeCurrentKeys(): Promise<void> {
    for (const [secretName, versions] of this.keyVersions.entries()) {
      const activeVersion = versions.find(v => v.status === 'active');
      if (activeVersion) {
        activeVersion.status = 'revoked';
        activeVersion.deactivatedAt = Date.now();
        
        this.logRotation(activeVersion.version, 'revoked', 'Emergency revocation', true);
      }
    }
  }

  private getSecretsForRotation(): string[] {
    // Return list of secrets that should be rotated
    // This could be based on age, usage patterns, or configuration
    return Array.from(this.keyVersions.keys());
  }

  private generateSecureKey(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private async backupKeyVersion(secretName: string, keyVersion: KeyVersion): Promise<void> {
    const backupData = Object.fromEntries(this.keyVersions.entries());
    const backupPath = join(this.config.backupLocation, 'key-versions.json');
    
    try {
      writeFileSync(backupPath, JSON.stringify(backupData, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error('Failed to backup key version:', error);
    }
  }

  private logRotation(version: number, action: RotationLog['action'], reason: string, success: boolean, error?: string): void {
    const logEntry: RotationLog = {
      timestamp: Date.now(),
      version,
      action,
      reason,
      success,
      error
    };
    
    this.rotationLogs.push(logEntry);
    
    // Persist rotation logs
    this.persistRotationLogs();
  }

  private persistRotationLogs(): void {
    const logsPath = join(this.config.backupLocation, 'rotation-logs.json');
    
    try {
      writeFileSync(logsPath, JSON.stringify(this.rotationLogs, null, 2));
    } catch (error) {
      console.error('Failed to persist rotation logs:', error);
    }
  }

  private scheduleRotation(): void {
    // This would implement cron-like scheduling
    // For now, just set up a basic interval
    const intervalMs = 24 * 60 * 60 * 1000; // Daily check
    
    setInterval(async () => {
      try {
        await this.checkRotationSchedule();
      } catch (error) {
        console.error('Scheduled rotation check failed:', error);
      }
    }, intervalMs);
  }

  private async checkRotationSchedule(): Promise<void> {
    // Check if any keys need rotation based on age or schedule
    // This is a simplified implementation
    for (const [secretName, versions] of this.keyVersions.entries()) {
      const activeVersion = versions.find(v => v.status === 'active');
      if (activeVersion) {
        const keyAgeMs = Date.now() - activeVersion.activatedAt!;
        const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        if (keyAgeMs > maxAgeMs) {
          console.log(`🔄 Key for ${secretName} is due for rotation (age: ${Math.floor(keyAgeMs / (24 * 60 * 60 * 1000))} days)`);
          await this.rotateSecretKey(secretName, 'Scheduled rotation');
        }
      }
    }
  }

  private async sendRotationNotification(success: boolean, reason: string, error?: string): Promise<void> {
    if (!this.config.notificationWebhook) {
      return;
    }
    
    const message = {
      type: 'key_rotation',
      success,
      reason,
      timestamp: Date.now(),
      error
    };
    
    try {
      // Send webhook notification
      const response = await fetch(this.config.notificationWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      
      if (!response.ok) {
        console.error('Failed to send rotation notification:', response.statusText);
      }
    } catch (error) {
      console.error('Error sending rotation notification:', error);
    }
  }

  private async sendEmergencyNotification(reason: string): Promise<void> {
    // Send emergency notifications to all configured contacts
    for (const contact of this.config.emergencyContacts) {
      try {
        // This would send emergency notifications via email, SMS, etc.
        console.log(`🚨 Emergency notification sent to ${contact}: ${reason}`);
      } catch (error) {
        console.error(`Failed to send emergency notification to ${contact}:`, error);
      }
    }
  }
}

/**
 * Factory function to create key rotation manager
 */
export function createKeyRotationManager(
  secretsManager: SecretsManager,
  overrides: Partial<KeyRotationConfig> = {}
): KeyRotationManager {
  const defaultConfig: KeyRotationConfig = {
    enabled: process.env.KEY_ROTATION_ENABLED === 'true',
    schedule: process.env.KEY_ROTATION_SCHEDULE || '0 2 * * 0', // Weekly on Sunday at 2 AM
    retentionPeriod: parseInt(process.env.KEY_RETENTION_PERIOD || '90'),
    notificationWebhook: process.env.KEY_ROTATION_WEBHOOK,
    emergencyContacts: (process.env.EMERGENCY_CONTACTS || '').split(',').filter(Boolean),
    backupLocation: process.env.KEY_BACKUP_LOCATION || join(process.cwd(), 'backups', 'keys')
  };
  
  const config = { ...defaultConfig, ...overrides };
  
  return new KeyRotationManager(config, secretsManager);
}

export default KeyRotationManager;