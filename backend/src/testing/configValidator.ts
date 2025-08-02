import { EventEmitter } from 'events';

/**
 * Configuration Validation Tool for Rate Limiting System
 * 
 * Validates all rate limiting configurations:
 * - Policy configuration validation
 * - Tier limit validation
 * - Cross-chain coordination settings
 * - Infrastructure configuration
 * - Security policy validation
 * - Performance constraint validation
 */

export interface ValidationRule {
  name: string;
  description: string;
  category: 'policy' | 'security' | 'performance' | 'infrastructure' | 'crosschain';
  severity: 'error' | 'warning' | 'info';
  validate: (config: any) => ValidationResult;
}

export interface ValidationResult {
  passed: boolean;
  message: string;
  details?: any;
  suggestions?: string[];
}

export interface ValidationReport {
  configType: string;
  timestamp: number;
  totalRules: number;
  passed: number;
  warnings: number;
  errors: number;
  results: ValidationResult[];
  score: number; // 0-100
  recommendations: string[];
}

export interface ConfigurationSet {
  rateLimitingPolicies: any;
  tierLimits: any;
  crossChainSettings: any;
  infrastructureConfig: any;
  securityPolicies: any;
  performanceConstraints: any;
}

export class RateLimitConfigValidator extends EventEmitter {
  private validationRules: Map<string, ValidationRule[]> = new Map();
  private validationReports: Map<string, ValidationReport> = new Map();
  private isValidating = false;

  constructor() {
    super();
    this.initializeValidationRules();
    console.log('🔍 Rate Limit Configuration Validator initialized');
  }

  /**
   * Validate complete configuration set
   */
  async validateCompleteConfiguration(configSet: ConfigurationSet): Promise<{
    overallScore: number;
    criticalIssues: number;
    reports: Map<string, ValidationReport>;
    summary: {
      totalRules: number;
      totalPassed: number;
      totalWarnings: number;
      totalErrors: number;
      configurationHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    };
  }> {
    console.log('🔍 Starting complete configuration validation...');
    
    this.isValidating = true;
    this.validationReports.clear();
    
    try {
      const validationPromises = [
        this.validateConfiguration('rateLimitingPolicies', configSet.rateLimitingPolicies),
        this.validateConfiguration('tierLimits', configSet.tierLimits),
        this.validateConfiguration('crossChainSettings', configSet.crossChainSettings),
        this.validateConfiguration('infrastructureConfig', configSet.infrastructureConfig),
        this.validateConfiguration('securityPolicies', configSet.securityPolicies),
        this.validateConfiguration('performanceConstraints', configSet.performanceConstraints)
      ];
      
      const reports = await Promise.all(validationPromises);
      
      // Calculate overall metrics
      let totalRules = 0;
      let totalPassed = 0;
      let totalWarnings = 0;
      let totalErrors = 0;
      let totalScore = 0;
      
      reports.forEach(report => {
        this.validationReports.set(report.configType, report);
        totalRules += report.totalRules;
        totalPassed += report.passed;
        totalWarnings += report.warnings;
        totalErrors += report.errors;
        totalScore += report.score;
      });
      
      const overallScore = totalScore / reports.length;
      const criticalIssues = totalErrors;
      
      const configurationHealth = this.determineConfigurationHealth(overallScore, criticalIssues);
      
      const summary = {
        totalRules,
        totalPassed,
        totalWarnings,
        totalErrors,
        configurationHealth
      };
      
      console.log('\n📊 Configuration Validation Summary:');
      console.log(`   Overall Score: ${overallScore.toFixed(1)}/100`);
      console.log(`   Total Rules Checked: ${totalRules}`);
      console.log(`   Passed: ${totalPassed} (${((totalPassed / totalRules) * 100).toFixed(1)}%)`);
      console.log(`   Warnings: ${totalWarnings}`);
      console.log(`   Errors: ${totalErrors}`);
      console.log(`   Health Status: ${configurationHealth.toUpperCase()}`);
      
      if (criticalIssues > 0) {
        console.log(`\n⚠️  Critical Issues Found: ${criticalIssues}`);
        console.log('   These must be resolved before production deployment!');
      }
      
      return {
        overallScore,
        criticalIssues,
        reports: this.validationReports,
        summary
      };
      
    } finally {
      this.isValidating = false;
    }
  }

  /**
   * Validate specific configuration type
   */
  async validateConfiguration(configType: string, config: any): Promise<ValidationReport> {
    const rules = this.validationRules.get(configType) || [];
    const results: ValidationResult[] = [];
    const recommendations: string[] = [];
    
    let passed = 0;
    let warnings = 0;
    let errors = 0;
    
    console.log(`\n🔍 Validating ${configType} configuration...`);
    
    for (const rule of rules) {
      try {
        const result = rule.validate(config);
        results.push({
          ...result,
          message: `[${rule.severity.toUpperCase()}] ${rule.name}: ${result.message}`
        });
        
        if (result.passed) {
          passed++;
          console.log(`   ✅ ${rule.name}`);
        } else {
          if (rule.severity === 'error') {
            errors++;
            console.log(`   ❌ ${rule.name}: ${result.message}`);
          } else if (rule.severity === 'warning') {
            warnings++;
            console.log(`   ⚠️  ${rule.name}: ${result.message}`);
          }
          
          if (result.suggestions) {
            recommendations.push(...result.suggestions);
          }
        }
        
      } catch (error) {
        errors++;
        results.push({
          passed: false,
          message: `[ERROR] ${rule.name}: Validation failed - ${error instanceof Error ? error.message : String(error)}`
        });
        console.log(`   💥 ${rule.name}: Validation crashed`);
      }
    }
    
    const score = this.calculateScore(passed, warnings, errors, rules.length);
    
    const report: ValidationReport = {
      configType,
      timestamp: Date.now(),
      totalRules: rules.length,
      passed,
      warnings,
      errors,
      results,
      score,
      recommendations: Array.from(new Set(recommendations)) // Remove duplicates
    };
    
    console.log(`   📊 ${configType} Score: ${score.toFixed(1)}/100 (${passed}/${rules.length} passed)`);
    
    return report;
  }

  /**
   * Initialize validation rules for different configuration types
   */
  private initializeValidationRules(): void {
    // Rate Limiting Policies Validation Rules
    this.validationRules.set('rateLimitingPolicies', [
      {
        name: 'requiredPoliciesExist',
        description: 'Check that all required rate limiting policies are defined',
        category: 'policy',
        severity: 'error',
        validate: (config) => {
          const required = ['sliding_window', 'token_bucket', 'fixed_window', 'adaptive'];
          const missing = required.filter(policy => !config || !config.algorithms || !config.algorithms[policy]);
          
          if (missing.length > 0) {
            return {
              passed: false,
              message: `Missing required policies: ${missing.join(', ')}`,
              suggestions: [`Add missing policies: ${missing.join(', ')}`]
            };
          }
          
          return { passed: true, message: 'All required policies are defined' };
        }
      },
      {
        name: 'validTimeWindows',
        description: 'Check that time windows are within reasonable ranges',
        category: 'policy',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.timeWindows) {
            return { passed: false, message: 'Time windows configuration is missing' };
          }
          
          const windows = config.timeWindows;
          const issues = [];
          
          if (windows.minute && (windows.minute < 1000 || windows.minute > 120000)) {
            issues.push('Minute window should be between 1-120 seconds');
          }
          
          if (windows.hour && (windows.hour < 60000 || windows.hour > 7200000)) {
            issues.push('Hour window should be between 1-120 minutes');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Review time window configurations for optimal performance']
            };
          }
          
          return { passed: true, message: 'Time windows are within reasonable ranges' };
        }
      },
      {
        name: 'rateLimitValues',
        description: 'Check that rate limit values are reasonable and progressive',
        category: 'policy',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.defaultLimits) {
            return { passed: false, message: 'Default limits configuration is missing' };
          }
          
          const limits = config.defaultLimits;
          const issues = [];
          
          // Check that limits are progressive (free < basic < premium < enterprise)
          const tiers = ['free', 'basic', 'premium', 'enterprise'];
          for (let i = 0; i < tiers.length - 1; i++) {
            const current = limits[tiers[i]]?.requestsPerMinute || 0;
            const next = limits[tiers[i + 1]]?.requestsPerMinute || 0;
            
            if (current >= next) {
              issues.push(`${tiers[i]} tier limit (${current}) should be less than ${tiers[i + 1]} tier limit (${next})`);
            }
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Ensure tier limits are progressive and logical']
            };
          }
          
          return { passed: true, message: 'Rate limit values are progressive and reasonable' };
        }
      }
    ]);

    // Tier Limits Validation Rules
    this.validationRules.set('tierLimits', [
      {
        name: 'allTiersDefined',
        description: 'Check that all required user tiers are defined',
        category: 'policy',
        severity: 'error',
        validate: (config) => {
          const required = ['free', 'basic', 'premium', 'enterprise', 'admin'];
          const missing = required.filter(tier => !config || !config.tiers || !config.tiers[tier]);
          
          if (missing.length > 0) {
            return {
              passed: false,
              message: `Missing tier definitions: ${missing.join(', ')}`,
              suggestions: [`Define missing tiers: ${missing.join(', ')}`]
            };
          }
          
          return { passed: true, message: 'All required tiers are defined' };
        }
      },
      {
        name: 'tierPrivilegesEscalation',
        description: 'Check that tier privileges escalate appropriately',
        category: 'security',
        severity: 'error',
        validate: (config) => {
          if (!config || !config.tiers) {
            return { passed: false, message: 'Tiers configuration is missing' };
          }
          
          const tierOrder = ['free', 'basic', 'premium', 'enterprise'];
          const issues = [];
          
          for (let i = 0; i < tierOrder.length - 1; i++) {
            const current = config.tiers[tierOrder[i]];
            const next = config.tiers[tierOrder[i + 1]];
            
            if (!current || !next) continue;
            
            // Check various limits escalate properly
            if (current.requestsPerMinute && next.requestsPerMinute && 
                current.requestsPerMinute >= next.requestsPerMinute) {
              issues.push(`${tierOrder[i]} requests/min should be less than ${tierOrder[i + 1]}`);
            }
            
            if (current.concurrentRequests && next.concurrentRequests && 
                current.concurrentRequests >= next.concurrentRequests) {
              issues.push(`${tierOrder[i]} concurrent requests should be less than ${tierOrder[i + 1]}`);
            }
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Fix tier privilege escalation to ensure proper hierarchy']
            };
          }
          
          return { passed: true, message: 'Tier privileges escalate appropriately' };
        }
      }
    ]);

    // Cross-Chain Settings Validation Rules
    this.validationRules.set('crossChainSettings', [
      {
        name: 'coordinationEndpointsValid',
        description: 'Check that cross-chain coordination endpoints are valid',
        category: 'crosschain',
        severity: 'error',
        validate: (config) => {
          if (!config || !config.coordination || !config.coordination.endpoints) {
            return {
              passed: false,
              message: 'Cross-chain coordination endpoints are missing',
              suggestions: ['Configure coordination endpoints for Ethereum and Bitcoin']
            };
          }
          
          const endpoints = config.coordination.endpoints;
          const issues = [];
          
          if (!endpoints.ethereum || !endpoints.ethereum.url) {
            issues.push('Ethereum coordination endpoint is missing');
          }
          
          if (!endpoints.bitcoin || !endpoints.bitcoin.url) {
            issues.push('Bitcoin coordination endpoint is missing');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Configure all required coordination endpoints']
            };
          }
          
          return { passed: true, message: 'Cross-chain coordination endpoints are valid' };
        }
      },
      {
        name: 'resourcePoolLimits',
        description: 'Check that resource pool limits are reasonable',
        category: 'performance',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.resourcePools) {
            return { passed: false, message: 'Resource pool configuration is missing' };
          }
          
          const pools = config.resourcePools;
          const issues = [];
          
          if (pools.ethereum && pools.ethereum.maxConcurrent > 1000) {
            issues.push('Ethereum pool max concurrent limit seems too high (>1000)');
          }
          
          if (pools.bitcoin && pools.bitcoin.maxConcurrent > 500) {
            issues.push('Bitcoin pool max concurrent limit seems too high (>500)');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Review resource pool limits for optimal performance']
            };
          }
          
          return { passed: true, message: 'Resource pool limits are reasonable' };
        }
      }
    ]);

    // Infrastructure Configuration Validation Rules
    this.validationRules.set('infrastructureConfig', [
      {
        name: 'proxyConfigurationValid',
        description: 'Check that proxy configuration is valid and secure',
        category: 'infrastructure',
        severity: 'error',
        validate: (config) => {
          if (!config || !config.proxy) {
            return {
              passed: false,
              message: 'Proxy configuration is missing',
              suggestions: ['Configure proxy settings for infrastructure protection']
            };
          }
          
          const proxy = config.proxy;
          const issues = [];
          
          if (!proxy.rateLimiting || !proxy.rateLimiting.enabled) {
            issues.push('Proxy rate limiting is not enabled');
          }
          
          if (!proxy.ddosProtection || !proxy.ddosProtection.enabled) {
            issues.push('Proxy DDoS protection is not enabled');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Enable all proxy protection mechanisms']
            };
          }
          
          return { passed: true, message: 'Proxy configuration is valid and secure' };
        }
      },
      {
        name: 'loadBalancerSettings',
        description: 'Check load balancer settings for optimal performance',
        category: 'performance',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.loadBalancer) {
            return { passed: false, message: 'Load balancer configuration is missing' };
          }
          
          const lb = config.loadBalancer;
          const issues = [];
          
          if (!lb.healthCheck || !lb.healthCheck.enabled) {
            issues.push('Load balancer health checks are not enabled');
          }
          
          if (lb.sessionAffinity && lb.sessionAffinity === 'ip_hash') {
            issues.push('IP hash session affinity may cause uneven load distribution');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Review load balancer settings for optimal distribution']
            };
          }
          
          return { passed: true, message: 'Load balancer settings are optimal' };
        }
      }
    ]);

    // Security Policies Validation Rules
    this.validationRules.set('securityPolicies', [
      {
        name: 'authenticationRequired',
        description: 'Check that proper authentication is required',
        category: 'security',
        severity: 'error',
        validate: (config) => {
          if (!config || !config.authentication) {
            return {
              passed: false,
              message: 'Authentication configuration is missing',
              suggestions: ['Configure authentication requirements for all endpoints']
            };
          }
          
          const auth = config.authentication;
          const issues = [];
          
          if (!auth.required) {
            issues.push('Authentication is not required');
          }
          
          if (!auth.tokenValidation || !auth.tokenValidation.enabled) {
            issues.push('Token validation is not enabled');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Enable proper authentication and token validation']
            };
          }
          
          return { passed: true, message: 'Authentication configuration is secure' };
        }
      },
      {
        name: 'ipWhitelistingConfigured',
        description: 'Check that IP whitelisting is properly configured',
        category: 'security',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.ipWhitelisting) {
            return {
              passed: false,
              message: 'IP whitelisting configuration is missing',
              suggestions: ['Consider implementing IP whitelisting for additional security']
            };
          }
          
          const whitelist = config.ipWhitelisting;
          
          if (whitelist.adminOnly && (!whitelist.adminIPs || whitelist.adminIPs.length === 0)) {
            return {
              passed: false,
              message: 'Admin-only IP whitelisting enabled but no admin IPs defined',
              suggestions: ['Define admin IP addresses for whitelist access']
            };
          }
          
          return { passed: true, message: 'IP whitelisting is properly configured' };
        }
      }
    ]);

    // Performance Constraints Validation Rules
    this.validationRules.set('performanceConstraints', [
      {
        name: 'memoryLimitsReasonable',
        description: 'Check that memory limits are reasonable for the system',
        category: 'performance',
        severity: 'warning',
        validate: (config) => {
          if (!config || !config.memory) {
            return { passed: false, message: 'Memory configuration is missing' };
          }
          
          const memory = config.memory;
          const issues = [];
          
          if (memory.maxUsageMB && memory.maxUsageMB < 256) {
            issues.push('Maximum memory usage seems too low (<256MB)');
          }
          
          if (memory.maxUsageMB && memory.maxUsageMB > 4096) {
            issues.push('Maximum memory usage seems too high (>4GB)');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Review memory limits based on expected system load']
            };
          }
          
          return { passed: true, message: 'Memory limits are reasonable' };
        }
      },
      {
        name: 'timeoutConfigured',
        description: 'Check that appropriate timeouts are configured',
        category: 'performance',
        severity: 'error',
        validate: (config) => {
          if (!config || !config.timeouts) {
            return {
              passed: false,
              message: 'Timeout configuration is missing',
              suggestions: ['Configure appropriate timeouts for all operations']
            };
          }
          
          const timeouts = config.timeouts;
          const issues = [];
          
          if (!timeouts.request || timeouts.request > 30000) {
            issues.push('Request timeout should be configured and <= 30 seconds');
          }
          
          if (!timeouts.database || timeouts.database > 10000) {
            issues.push('Database timeout should be configured and <= 10 seconds');
          }
          
          if (issues.length > 0) {
            return {
              passed: false,
              message: issues.join('; '),
              suggestions: ['Configure reasonable timeout values for all operations']
            };
          }
          
          return { passed: true, message: 'Timeouts are properly configured' };
        }
      }
    ]);
  }

  /**
   * Helper methods
   */
  
  private calculateScore(passed: number, warnings: number, errors: number, total: number): number {
    if (total === 0) return 100;
    
    // Base score from passed rules
    const baseScore = (passed / total) * 100;
    
    // Penalty for warnings and errors
    const warningPenalty = warnings * 5; // 5 points per warning
    const errorPenalty = errors * 15; // 15 points per error
    
    return Math.max(0, baseScore - warningPenalty - errorPenalty);
  }

  private determineConfigurationHealth(score: number, criticalIssues: number): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
    if (criticalIssues > 0) return 'critical';
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
  }

  /**
   * Generate example configuration for testing
   */
  generateExampleConfiguration(): ConfigurationSet {
    return {
      rateLimitingPolicies: {
        algorithms: {
          sliding_window: { enabled: true, windowSize: 60000 },
          token_bucket: { enabled: true, capacity: 100, refillRate: 1 },
          fixed_window: { enabled: true, windowSize: 60000 },
          adaptive: { enabled: true, adaptationFactor: 0.8 }
        },
        timeWindows: {
          minute: 60000,
          hour: 3600000,
          day: 86400000
        },
        defaultLimits: {
          free: { requestsPerMinute: 10, requestsPerHour: 100 },
          basic: { requestsPerMinute: 50, requestsPerHour: 1000 },
          premium: { requestsPerMinute: 200, requestsPerHour: 10000 },
          enterprise: { requestsPerMinute: 1000, requestsPerHour: 50000 }
        }
      },
      tierLimits: {
        tiers: {
          free: { requestsPerMinute: 10, concurrentRequests: 2, dailyLimit: 1000 },
          basic: { requestsPerMinute: 50, concurrentRequests: 5, dailyLimit: 10000 },
          premium: { requestsPerMinute: 200, concurrentRequests: 20, dailyLimit: 100000 },
          enterprise: { requestsPerMinute: 1000, concurrentRequests: 100, dailyLimit: 1000000 },
          admin: { requestsPerMinute: 10000, concurrentRequests: 1000, dailyLimit: 10000000 }
        }
      },
      crossChainSettings: {
        coordination: {
          endpoints: {
            ethereum: { url: 'https://eth-coordinator.example.com', timeout: 30000 },
            bitcoin: { url: 'https://btc-coordinator.example.com', timeout: 45000 }
          }
        },
        resourcePools: {
          ethereum: { maxConcurrent: 500, queueSize: 1000 },
          bitcoin: { maxConcurrent: 200, queueSize: 500 }
        }
      },
      infrastructureConfig: {
        proxy: {
          rateLimiting: { enabled: true, algorithm: 'sliding_window' },
          ddosProtection: { enabled: true, threshold: 1000 }
        },
        loadBalancer: {
          healthCheck: { enabled: true, interval: 30000 },
          sessionAffinity: 'least_connections'
        }
      },
      securityPolicies: {
        authentication: {
          required: true,
          tokenValidation: { enabled: true, algorithm: 'RS256' }
        },
        ipWhitelisting: {
          adminOnly: true,
          adminIPs: ['192.168.1.100', '10.0.0.50']
        }
      },
      performanceConstraints: {
        memory: {
          maxUsageMB: 1024,
          warningThresholdMB: 768
        },
        timeouts: {
          request: 30000,
          database: 5000,
          external: 10000
        }
      }
    };
  }

  /**
   * Get validation results and status
   */
  getValidationReports(): Map<string, ValidationReport> {
    return this.validationReports;
  }

  isValidationRunning(): boolean {
    return this.isValidating;
  }
}

// Export singleton instance
export const configValidator = new RateLimitConfigValidator();

export default configValidator;