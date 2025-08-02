import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import crypto from 'crypto';

/**
 * Secrets Management System
 * 
 * Provides secure handling of sensitive configuration data including:
 * - Environment-based secret loading
 * - Encryption/decryption of stored secrets
 * - Key rotation procedures
 * - Audit logging of secret access
 * - Vault-style secret management for production
 */

export type SecretProvider = 'env' | 'file' | 'vault' | 'aws' | 'azure' | 'gcp';
export type Environment = 'development' | 'staging' | 'production';

export interface SecretConfig {
  provider: SecretProvider;
  environment: Environment;
  encryptionKey?: string;
  vaultConfig?: VaultConfig;
  cloudConfig?: CloudSecretConfig;
  auditLogging: boolean;
  keyRotationEnabled: boolean;
  keyRotationInterval: number; // days
}

export interface VaultConfig {
  url: string;
  token?: string;
  namespace?: string;
  mountPath: string;
  roleId?: string;
  secretId?: string;
}

export interface CloudSecretConfig {
  // AWS Secrets Manager
  aws?: {
    region: string;
    secretsPrefix: string;
    roleArn?: string;
  };
  
  // Azure Key Vault
  azure?: {
    keyVaultName: string;
    tenantId: string;
    clientId: string;
    clientSecret?: string;
  };
  
  // Google Secret Manager
  gcp?: {
    projectId: string;
    keyFilePath?: string;
    secretPrefix: string;
  };
}

export interface SecretMetadata {
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  rotatedAt?: number;
  expiresAt?: number;
  source: SecretProvider;
  encrypted: boolean;
}

export interface SecretEntry {
  value: string;
  metadata: SecretMetadata;
}

export interface AuditEntry {
  timestamp: number;
  action: 'read' | 'write' | 'rotate' | 'delete';
  secretName: string;
  source: string;
  user?: string;
  success: boolean;
  error?: string;
}

/**
 * Main Secrets Manager class
 */
export class SecretsManager {
  private config: SecretConfig;
  private secretsCache: Map<string, SecretEntry> = new Map();
  private auditLog: AuditEntry[] = [];
  private encryptionKey: Buffer;

  constructor(config: SecretConfig) {
    this.config = config;
    this.encryptionKey = this.initializeEncryptionKey();
    
    if (this.config.auditLogging) {
      this.initializeAuditLogging();
    }
    
    console.log(`🔐 Secrets Manager initialized (${config.provider}/${config.environment})`);
  }

  /**
   * Get a secret value by name
   */
  async getSecret(name: string): Promise<string | undefined> {
    try {
      // Check cache first
      const cached = this.secretsCache.get(name);
      if (cached && !this.isExpired(cached.metadata)) {
        this.auditLog.push(this.createAuditEntry('read', name, 'cache', true));
        return cached.value;
      }

      let secretValue: string | undefined;

      switch (this.config.provider) {
        case 'env':
          secretValue = await this.getEnvironmentSecret(name);
          break;
        case 'file':
          secretValue = await this.getFileSecret(name);
          break;
        case 'vault':
          secretValue = await this.getVaultSecret(name);
          break;
        case 'aws':
          secretValue = await this.getAWSSecret(name);
          break;
        case 'azure':
          secretValue = await this.getAzureSecret(name);
          break;
        case 'gcp':
          secretValue = await this.getGCPSecret(name);
          break;
        default:
          throw new Error(`Unsupported secret provider: ${this.config.provider}`);
      }

      if (secretValue) {
        // Cache the secret
        this.cacheSecret(name, secretValue);
        this.auditLog.push(this.createAuditEntry('read', name, this.config.provider, true));
      } else {
        this.auditLog.push(this.createAuditEntry('read', name, this.config.provider, false, 'Secret not found'));
      }

      return secretValue;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.auditLog.push(this.createAuditEntry('read', name, this.config.provider, false, errorMsg));
      console.error(`Failed to get secret '${name}':`, error);
      
      if (this.config.environment === 'production') {
        throw error;
      }
      
      return undefined;
    }
  }

  /**
   * Set a secret value
   */
  async setSecret(name: string, value: string, metadata?: Partial<SecretMetadata>): Promise<void> {
    try {
      switch (this.config.provider) {
        case 'file':
          await this.setFileSecret(name, value, metadata);
          break;
        case 'vault':
          await this.setVaultSecret(name, value);
          break;
        case 'aws':
          await this.setAWSSecret(name, value);
          break;
        case 'azure':
          await this.setAzureSecret(name, value);
          break;
        case 'gcp':
          await this.setGCPSecret(name, value);
          break;
        default:
          throw new Error(`Setting secrets not supported for provider: ${this.config.provider}`);
      }

      // Update cache
      this.cacheSecret(name, value, metadata);
      this.auditLog.push(this.createAuditEntry('write', name, this.config.provider, true));
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.auditLog.push(this.createAuditEntry('write', name, this.config.provider, false, errorMsg));
      throw error;
    }
  }

  /**
   * Rotate a secret (generate new value)
   */
  async rotateSecret(name: string, generator?: () => string): Promise<string> {
    try {
      const newValue = generator ? generator() : this.generateSecureSecret();
      await this.setSecret(name, newValue, { rotatedAt: Date.now() });
      
      this.auditLog.push(this.createAuditEntry('rotate', name, this.config.provider, true));
      console.log(`🔄 Secret '${name}' rotated successfully`);
      
      return newValue;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.auditLog.push(this.createAuditEntry('rotate', name, this.config.provider, false, errorMsg));
      throw error;
    }
  }

  /**
   * Delete a secret
   */
  async deleteSecret(name: string): Promise<void> {
    try {
      // Remove from cache
      this.secretsCache.delete(name);
      
      // Delete from storage (implementation depends on provider)
      // For now, we'll just handle file-based secrets
      if (this.config.provider === 'file') {
        const secretPath = this.getSecretFilePath(name);
        if (existsSync(secretPath)) {
          writeFileSync(secretPath, ''); // Overwrite with empty content
        }
      }
      
      this.auditLog.push(this.createAuditEntry('delete', name, this.config.provider, true));
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.auditLog.push(this.createAuditEntry('delete', name, this.config.provider, false, errorMsg));
      throw error;
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit?: number): AuditEntry[] {
    return limit ? this.auditLog.slice(-limit) : [...this.auditLog];
  }

  /**
   * Encrypt a value
   */
  encrypt(value: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value
   */
  decrypt(encryptedValue: string): string {
    const parts = encryptedValue.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted value format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // Private methods

  private initializeEncryptionKey(): Buffer {
    let key = this.config.encryptionKey;
    
    if (!key) {
      // Try to get from environment
      key = process.env.SECRETS_ENCRYPTION_KEY;
    }
    
    if (!key) {
      // Generate a new key (not recommended for production)
      const keyBuffer = crypto.randomBytes(32);
      key = keyBuffer.toString('hex');
      if (this.config.environment === 'production') {
        throw new Error('Encryption key must be provided in production');
      }
      console.warn('⚠️  Using generated encryption key - not suitable for production');
      return keyBuffer;
    }
    
    // Ensure key is exactly 32 bytes for AES-256
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes (64 hex characters) for AES-256');
    }
    
    return keyBuffer;
  }

  private initializeAuditLogging(): void {
    // Set up audit log persistence if needed
    if (this.config.environment !== 'development') {
      setInterval(() => {
        this.persistAuditLog();
      }, 60000); // Persist every minute
    }
  }

  private async getEnvironmentSecret(name: string): Promise<string | undefined> {
    // Try different environment variable formats
    const variants = [
      name,
      name.toUpperCase(),
      name.replace(/([A-Z])/g, '_$1').toUpperCase(),
      `SECRET_${name.toUpperCase()}`,
      `${this.config.environment.toUpperCase()}_${name.toUpperCase()}`
    ];
    
    for (const variant of variants) {
      const value = process.env[variant];
      if (value) {
        return value;
      }
    }
    
    return undefined;
  }

  private async getFileSecret(name: string): Promise<string | undefined> {
    const secretPath = this.getSecretFilePath(name);
    
    if (!existsSync(secretPath)) {
      return undefined;
    }
    
    try {
      const content = readFileSync(secretPath, 'utf8').trim();
      
      // Check if it's encrypted
      if (content.includes(':')) {
        return this.decrypt(content);
      }
      
      return content;
      
    } catch (error) {
      console.error(`Failed to read secret file '${secretPath}':`, error);
      return undefined;
    }
  }

  private async setFileSecret(name: string, value: string, metadata?: Partial<SecretMetadata>): Promise<void> {
    const secretPath = this.getSecretFilePath(name);
    const secretDir = dirname(secretPath);
    
    // Ensure directory exists
    if (!existsSync(secretDir)) {
      mkdirSync(secretDir, { recursive: true });
    }
    
    // Encrypt the value
    const encryptedValue = this.encrypt(value);
    
    // Write to file with restricted permissions
    writeFileSync(secretPath, encryptedValue, { mode: 0o600 });
  }

  private async getVaultSecret(name: string): Promise<string | undefined> {
    if (!this.config.vaultConfig) {
      throw new Error('Vault configuration not provided');
    }
    
    // This would integrate with HashiCorp Vault API
    // For now, return undefined as it requires actual Vault setup
    console.warn('Vault integration not implemented');
    return undefined;
  }

  private async setVaultSecret(name: string, value: string): Promise<void> {
    // Vault integration implementation
    console.warn('Vault integration not implemented');
    throw new Error('Vault integration not implemented');
  }

  private async getAWSSecret(name: string): Promise<string | undefined> {
    // AWS Secrets Manager integration
    console.warn('AWS Secrets Manager integration not implemented');
    return undefined;
  }

  private async setAWSSecret(name: string, value: string): Promise<void> {
    // AWS Secrets Manager integration
    console.warn('AWS Secrets Manager integration not implemented');
    throw new Error('AWS Secrets Manager integration not implemented');
  }

  private async getAzureSecret(name: string): Promise<string | undefined> {
    // Azure Key Vault integration
    console.warn('Azure Key Vault integration not implemented');
    return undefined;
  }

  private async setAzureSecret(name: string, value: string): Promise<void> {
    // Azure Key Vault integration
    console.warn('Azure Key Vault integration not implemented');
    throw new Error('Azure Key Vault integration not implemented');
  }

  private async getGCPSecret(name: string): Promise<string | undefined> {
    // Google Secret Manager integration
    console.warn('Google Secret Manager integration not implemented');
    return undefined;
  }

  private async setGCPSecret(name: string, value: string): Promise<void> {
    // Google Secret Manager integration
    console.warn('Google Secret Manager integration not implemented');
    throw new Error('Google Secret Manager integration not implemented');
  }

  private cacheSecret(name: string, value: string, metadata?: Partial<SecretMetadata>): void {
    const entry: SecretEntry = {
      value,
      metadata: {
        name,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: this.config.provider,
        encrypted: false,
        ...metadata
      }
    };
    
    this.secretsCache.set(name, entry);
  }

  private isExpired(metadata: SecretMetadata): boolean {
    if (!metadata.expiresAt) {
      return false;
    }
    return Date.now() > metadata.expiresAt;
  }

  private getSecretFilePath(name: string): string {
    const secretsDir = join(process.cwd(), 'secrets', this.config.environment);
    return join(secretsDir, `${name}.secret`);
  }

  private generateSecureSecret(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private createAuditEntry(
    action: AuditEntry['action'],
    secretName: string,
    source: string,
    success: boolean,
    error?: string
  ): AuditEntry {
    return {
      timestamp: Date.now(),
      action,
      secretName,
      source,
      success,
      error
    };
  }

  private persistAuditLog(): void {
    if (this.auditLog.length === 0) {
      return;
    }
    
    const auditDir = join(process.cwd(), 'logs', 'audit');
    if (!existsSync(auditDir)) {
      mkdirSync(auditDir, { recursive: true });
    }
    
    const auditFile = join(auditDir, `secrets-audit-${new Date().toISOString().split('T')[0]}.json`);
    const existingAudit = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, 'utf8')) : [];
    
    const updatedAudit = [...existingAudit, ...this.auditLog];
    writeFileSync(auditFile, JSON.stringify(updatedAudit, null, 2));
    
    // Clear in-memory audit log
    this.auditLog = [];
  }
}

/**
 * Factory function to create secrets manager
 */
export function createSecretsManager(overrides: Partial<SecretConfig> = {}): SecretsManager {
  const defaultConfig: SecretConfig = {
    provider: (process.env.SECRETS_PROVIDER as SecretProvider) || 'env',
    environment: (process.env.NODE_ENV as Environment) || 'development',
    encryptionKey: process.env.SECRETS_ENCRYPTION_KEY,
    auditLogging: process.env.SECRETS_AUDIT_LOGGING === 'true',
    keyRotationEnabled: process.env.SECRETS_KEY_ROTATION_ENABLED === 'true',
    keyRotationInterval: parseInt(process.env.SECRETS_KEY_ROTATION_INTERVAL || '30')
  };
  
  const config = { ...defaultConfig, ...overrides };
  
  // Add provider-specific configuration
  if (config.provider === 'vault') {
    config.vaultConfig = {
      url: process.env.VAULT_ADDR || 'http://localhost:8200',
      token: process.env.VAULT_TOKEN,
      namespace: process.env.VAULT_NAMESPACE,
      mountPath: process.env.VAULT_MOUNT_PATH || 'secret',
      roleId: process.env.VAULT_ROLE_ID,
      secretId: process.env.VAULT_SECRET_ID
    };
  }
  
  if (config.provider === 'aws') {
    config.cloudConfig = {
      aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        secretsPrefix: process.env.AWS_SECRETS_PREFIX || 'fusion/',
        roleArn: process.env.AWS_ROLE_ARN
      }
    };
  }
  
  if (config.provider === 'azure') {
    config.cloudConfig = {
      azure: {
        keyVaultName: process.env.AZURE_KEY_VAULT_NAME || '',
        tenantId: process.env.AZURE_TENANT_ID || '',
        clientId: process.env.AZURE_CLIENT_ID || '',
        clientSecret: process.env.AZURE_CLIENT_SECRET
      }
    };
  }
  
  if (config.provider === 'gcp') {
    config.cloudConfig = {
      gcp: {
        projectId: process.env.GCP_PROJECT_ID || '',
        keyFilePath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        secretPrefix: process.env.GCP_SECRET_PREFIX || 'fusion-'
      }
    };
  }
  
  return new SecretsManager(config);
}

// Utility functions for common secret operations
export async function getRequiredSecret(secretsManager: SecretsManager, name: string): Promise<string> {
  const value = await secretsManager.getSecret(name);
  if (!value) {
    throw new Error(`Required secret '${name}' is not available`);
  }
  return value;
}

export async function getOptionalSecret(secretsManager: SecretsManager, name: string, defaultValue: string): Promise<string> {
  const value = await secretsManager.getSecret(name);
  return value || defaultValue;
}

export function validateSecretFormat(secret: string, format: 'hex' | 'base64' | 'jwt' | 'url'): boolean {
  switch (format) {
    case 'hex':
      return /^[0-9a-fA-F]+$/.test(secret);
    case 'base64':
      return /^[A-Za-z0-9+/]*={0,2}$/.test(secret);
    case 'jwt':
      return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(secret);
    case 'url':
      try {
        new URL(secret);
        return true;
      } catch {
        return false;
      }
    default:
      return true;
  }
}

export default SecretsManager;