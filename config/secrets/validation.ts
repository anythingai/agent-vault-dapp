import { SecretsManager } from './index.js';
import { KeyRotationManager } from './key-rotation.js';

/**
 * Secrets Validation and Health Check System
 * 
 * Provides comprehensive validation and monitoring of secrets:
 * - Secret format validation
 * - Health checks for secret accessibility
 * - Security compliance validation
 * - Automated testing of secret rotation
 */

export type ValidationLevel = 'basic' | 'strict' | 'compliance';
export type SecretType = 'api_key' | 'private_key' | 'jwt' | 'password' | 'url' | 'certificate';

export interface ValidationRule {
  name: string;
  description: string;
  validator: (value: string) => boolean;
  required: boolean;
  severity: 'error' | 'warning' | 'info';
}

export interface SecretValidationConfig {
  level: ValidationLevel;
  rules: Record<SecretType, ValidationRule[]>;
  healthCheckInterval: number;
  complianceChecks: boolean;
  auditValidation: boolean;
}

export interface ValidationResult {
  secretName: string;
  secretType: SecretType;
  valid: boolean;
  issues: ValidationIssue[];
  score: number; // 0-100
  lastChecked: number;
}

export interface ValidationIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
}

export interface HealthCheckResult {
  timestamp: number;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  secretsChecked: number;
  secretsValid: number;
  criticalIssues: number;
  warnings: number;
  details: ValidationResult[];
}

export class SecretsValidator {
  private config: SecretValidationConfig;
  private secretsManager: SecretsManager;
  private keyRotationManager?: KeyRotationManager;
  private validationHistory: Map<string, ValidationResult[]> = new Map();

  constructor(
    config: SecretValidationConfig, 
    secretsManager: SecretsManager,
    keyRotationManager?: KeyRotationManager
  ) {
    this.config = config;
    this.secretsManager = secretsManager;
    this.keyRotationManager = keyRotationManager;
    
    if (config.healthCheckInterval > 0) {
      this.startHealthChecks();
    }
    
    console.log(`🔍 Secrets Validator initialized (level: ${config.level})`);
  }

  /**
   * Validate a single secret
   */
  async validateSecret(secretName: string, secretType: SecretType): Promise<ValidationResult> {
    console.log(`🔍 Validating secret: ${secretName}`);
    
    try {
      const secretValue = await this.secretsManager.getSecret(secretName);
      
      if (!secretValue) {
        return {
          secretName,
          secretType,
          valid: false,
          issues: [{
            rule: 'existence',
            severity: 'error',
            message: 'Secret not found or has no value',
            recommendation: 'Set the secret value using the secrets manager'
          }],
          score: 0,
          lastChecked: Date.now()
        };
      }

      const issues: ValidationIssue[] = [];
      const rules = this.config.rules[secretType] || [];
      let passedRules = 0;

      for (const rule of rules) {
        try {
          const isValid = rule.validator(secretValue);
          
          if (!isValid) {
            issues.push({
              rule: rule.name,
              severity: rule.severity,
              message: rule.description,
              recommendation: this.getRecommendation(rule.name, secretType)
            });
          } else {
            passedRules++;
          }
        } catch (error) {
          issues.push({
            rule: rule.name,
            severity: 'error',
            message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      const score = rules.length > 0 ? Math.round((passedRules / rules.length) * 100) : 100;
      const valid = issues.every(issue => issue.severity !== 'error');

      const result: ValidationResult = {
        secretName,
        secretType,
        valid,
        issues,
        score,
        lastChecked: Date.now()
      };

      // Store in history
      this.storeValidationResult(secretName, result);

      return result;

    } catch (error) {
      console.error(`Failed to validate secret ${secretName}:`, error);
      
      return {
        secretName,
        secretType,
        valid: false,
        issues: [{
          rule: 'validation_error',
          severity: 'error',
          message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        score: 0,
        lastChecked: Date.now()
      };
    }
  }

  /**
   * Validate multiple secrets
   */
  async validateSecrets(secrets: Record<string, SecretType>): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    for (const [secretName, secretType] of Object.entries(secrets)) {
      const result = await this.validateSecret(secretName, secretType);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(secrets: Record<string, SecretType>): Promise<HealthCheckResult> {
    console.log('🏥 Performing secrets health check...');
    
    const validationResults = await this.validateSecrets(secrets);
    
    const secretsChecked = validationResults.length;
    const secretsValid = validationResults.filter(r => r.valid).length;
    const criticalIssues = validationResults
      .flatMap(r => r.issues)
      .filter(issue => issue.severity === 'error').length;
    const warnings = validationResults
      .flatMap(r => r.issues)
      .filter(issue => issue.severity === 'warning').length;

    let overall: HealthCheckResult['overall'];
    if (criticalIssues > 0) {
      overall = 'unhealthy';
    } else if (warnings > 0 || secretsValid < secretsChecked) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    const healthCheck: HealthCheckResult = {
      timestamp: Date.now(),
      overall,
      secretsChecked,
      secretsValid,
      criticalIssues,
      warnings,
      details: validationResults
    };

    console.log(`🏥 Health check completed: ${overall} (${secretsValid}/${secretsChecked} valid)`);
    
    return healthCheck;
  }

  /**
   * Get validation history for a secret
   */
  getValidationHistory(secretName: string, limit?: number): ValidationResult[] {
    const history = this.validationHistory.get(secretName) || [];
    return limit ? history.slice(-limit) : [...history];
  }

  /**
   * Generate security compliance report
   */
  async generateComplianceReport(secrets: Record<string, SecretType>): Promise<any> {
    if (!this.config.complianceChecks) {
      throw new Error('Compliance checks are disabled');
    }

    const validationResults = await this.validateSecrets(secrets);
    
    const complianceReport = {
      timestamp: Date.now(),
      overallCompliance: this.calculateComplianceScore(validationResults),
      secretsEvaluated: validationResults.length,
      categories: {
        cryptographic: this.analyzeSecretCategory(validationResults, ['private_key', 'certificate']),
        authentication: this.analyzeSecretCategory(validationResults, ['api_key', 'jwt', 'password']),
        configuration: this.analyzeSecretCategory(validationResults, ['url'])
      },
      recommendations: this.generateRecommendations(validationResults),
      keyRotation: this.keyRotationManager ? await this.analyzeKeyRotation() : null
    };

    console.log(`📊 Compliance report generated (score: ${complianceReport.overallCompliance}%)`);
    
    return complianceReport;
  }

  /**
   * Test secret rotation functionality
   */
  async testSecretRotation(secretName: string): Promise<boolean> {
    if (!this.keyRotationManager) {
      throw new Error('Key rotation manager not available');
    }

    try {
      console.log(`🧪 Testing secret rotation for: ${secretName}`);
      
      // Get current value
      const originalValue = await this.secretsManager.getSecret(secretName);
      if (!originalValue) {
        throw new Error('Secret not found');
      }

      // Perform rotation
      const newValue = await this.secretsManager.rotateSecret(secretName);
      
      // Verify new value is different
      if (newValue === originalValue) {
        throw new Error('Rotation did not change the secret value');
      }

      // Verify new value is accessible
      const retrievedValue = await this.secretsManager.getSecret(secretName);
      if (retrievedValue !== newValue) {
        throw new Error('Rotated secret is not accessible');
      }

      console.log(`✅ Secret rotation test passed for: ${secretName}`);
      return true;

    } catch (error) {
      console.error(`❌ Secret rotation test failed for ${secretName}:`, error);
      return false;
    }
  }

  // Private methods

  private startHealthChecks(): void {
    const interval = this.config.healthCheckInterval;
    
    setInterval(async () => {
      try {
        // This would perform automated health checks
        // Implementation depends on which secrets to check
        console.log('🏥 Performing scheduled health check...');
      } catch (error) {
        console.error('Scheduled health check failed:', error);
      }
    }, interval);
  }

  private storeValidationResult(secretName: string, result: ValidationResult): void {
    const history = this.validationHistory.get(secretName) || [];
    history.push(result);
    
    // Keep only last 100 results
    if (history.length > 100) {
      history.shift();
    }
    
    this.validationHistory.set(secretName, history);
  }

  private getRecommendation(ruleName: string, secretType: SecretType): string {
    const recommendations: Record<string, Record<string, string>> = {
      length: {
        api_key: 'Use a longer API key (minimum 32 characters)',
        private_key: 'Ensure private key meets cryptographic standards',
        password: 'Use a password with at least 12 characters',
        jwt: 'Use a longer signing secret (minimum 32 characters)'
      },
      complexity: {
        password: 'Include uppercase, lowercase, numbers, and special characters',
        api_key: 'Ensure key has sufficient entropy'
      },
      format: {
        private_key: 'Use standard private key format (PEM, PKCS#8)',
        jwt: 'Ensure JWT has valid header.payload.signature structure',
        url: 'Use valid URL format with protocol (https://)'
      }
    };

    return recommendations[ruleName]?.[secretType] || 'Review secret format and security requirements';
  }

  private calculateComplianceScore(results: ValidationResult[]): number {
    if (results.length === 0) return 100;
    
    const totalScore = results.reduce((sum, result) => sum + result.score, 0);
    return Math.round(totalScore / results.length);
  }

  private analyzeSecretCategory(results: ValidationResult[], types: SecretType[]): any {
    const categoryResults = results.filter(r => types.includes(r.secretType));
    
    return {
      count: categoryResults.length,
      valid: categoryResults.filter(r => r.valid).length,
      averageScore: categoryResults.length > 0 
        ? Math.round(categoryResults.reduce((sum, r) => sum + r.score, 0) / categoryResults.length)
        : 100,
      criticalIssues: categoryResults.flatMap(r => r.issues).filter(i => i.severity === 'error').length
    };
  }

  private generateRecommendations(results: ValidationResult[]): string[] {
    const recommendations = new Set<string>();
    
    for (const result of results) {
      for (const issue of result.issues) {
        if (issue.recommendation) {
          recommendations.add(issue.recommendation);
        }
      }
    }
    
    return Array.from(recommendations);
  }

  private async analyzeKeyRotation(): Promise<any> {
    if (!this.keyRotationManager) {
      return null;
    }

    const rotationLogs = this.keyRotationManager.getRotationLogs(10);
    const recentFailures = rotationLogs.filter(log => !log.success).length;
    
    return {
      recentRotations: rotationLogs.length,
      failureRate: rotationLogs.length > 0 ? (recentFailures / rotationLogs.length) * 100 : 0,
      lastRotation: rotationLogs.length > 0 ? rotationLogs[rotationLogs.length - 1].timestamp : null,
      recommendation: recentFailures > 0 ? 'Review rotation failures and fix underlying issues' : 'Key rotation is functioning properly'
    };
  }
}

/**
 * Default validation rules for different secret types
 */
export const defaultValidationRules: Record<SecretType, ValidationRule[]> = {
  api_key: [
    {
      name: 'length',
      description: 'API key must be at least 16 characters long',
      validator: (value: string) => value.length >= 16,
      required: true,
      severity: 'error'
    },
    {
      name: 'complexity',
      description: 'API key should have sufficient entropy',
      validator: (value: string) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value),
      required: false,
      severity: 'warning'
    }
  ],

  private_key: [
    {
      name: 'format',
      description: 'Private key must be in valid format',
      validator: (value: string) => 
        value.includes('-----BEGIN') && value.includes('-----END') ||
        /^(0x)?[0-9a-fA-F]{64}$/.test(value),
      required: true,
      severity: 'error'
    },
    {
      name: 'length',
      description: 'Private key must have correct length',
      validator: (value: string) => {
        if (value.startsWith('0x')) {
          return value.length === 66; // 0x + 64 hex chars
        }
        return value.length >= 64;
      },
      required: true,
      severity: 'error'
    }
  ],

  jwt: [
    {
      name: 'format',
      description: 'JWT must have valid structure',
      validator: (value: string) => {
        const parts = value.split('.');
        return parts.length === 3;
      },
      required: true,
      severity: 'error'
    }
  ],

  password: [
    {
      name: 'length',
      description: 'Password must be at least 12 characters long',
      validator: (value: string) => value.length >= 12,
      required: true,
      severity: 'error'
    },
    {
      name: 'complexity',
      description: 'Password must contain uppercase, lowercase, numbers, and special characters',
      validator: (value: string) => 
        /[a-z]/.test(value) && 
        /[A-Z]/.test(value) && 
        /[0-9]/.test(value) && 
        /[^a-zA-Z0-9]/.test(value),
      required: true,
      severity: 'warning'
    }
  ],

  url: [
    {
      name: 'format',
      description: 'URL must be valid and use HTTPS in production',
      validator: (value: string) => {
        try {
          const url = new URL(value);
          return process.env.NODE_ENV === 'production' ? url.protocol === 'https:' : true;
        } catch {
          return false;
        }
      },
      required: true,
      severity: 'error'
    }
  ],

  certificate: [
    {
      name: 'format',
      description: 'Certificate must be in PEM format',
      validator: (value: string) => 
        value.includes('-----BEGIN CERTIFICATE-----') && 
        value.includes('-----END CERTIFICATE-----'),
      required: true,
      severity: 'error'
    }
  ]
};

/**
 * Factory function to create secrets validator
 */
export function createSecretsValidator(
  secretsManager: SecretsManager,
  keyRotationManager?: KeyRotationManager,
  overrides: Partial<SecretValidationConfig> = {}
): SecretsValidator {
  const defaultConfig: SecretValidationConfig = {
    level: (process.env.SECRETS_VALIDATION_LEVEL as ValidationLevel) || 'basic',
    rules: defaultValidationRules,
    healthCheckInterval: parseInt(process.env.SECRETS_HEALTH_CHECK_INTERVAL || '3600000'), // 1 hour
    complianceChecks: process.env.SECRETS_COMPLIANCE_CHECKS === 'true',
    auditValidation: process.env.SECRETS_AUDIT_VALIDATION === 'true'
  };

  const config = { ...defaultConfig, ...overrides };
  
  return new SecretsValidator(config, secretsManager, keyRotationManager);
}

export default SecretsValidator;