import { readFileSync, existsSync } from 'fs';
import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Security Configuration System
 * 
 * Manages security aspects including:
 * - HTTPS/TLS configuration
 * - CORS policies and security headers
 * - API authentication and authorization
 * - Input validation and sanitization
 * - Security monitoring and threat detection
 * - Access control and rate limiting
 * - Security audit logging
 */

export type SecurityLevel = 'basic' | 'enhanced' | 'strict' | 'paranoid';
export type AuthenticationMethod = 'jwt' | 'oauth' | 'api_key' | 'basic' | 'bearer';
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityConfig {
  level: SecurityLevel;
  environment: string;
  https: HttpsConfig;
  cors: CorsConfig;
  headers: SecurityHeadersConfig;
  authentication: AuthenticationConfig;
  authorization: AuthorizationConfig;
  validation: ValidationConfig;
  monitoring: SecurityMonitoringConfig;
  rateLimit: SecurityRateLimitConfig;
  audit: AuditConfig;
  encryption: EncryptionConfig;
  threatDetection: ThreatDetectionConfig;
}

export interface HttpsConfig {
  enabled: boolean;
  enforced: boolean;
  port: number;
  certificates: {
    cert: string;
    key: string;
    ca?: string;
    passphrase?: string;
  };
  protocols: string[];
  ciphers: string[];
  hsts: {
    enabled: boolean;
    maxAge: number;
    includeSubDomains: boolean;
    preload: boolean;
  };
  ocsp: {
    enabled: boolean;
    url?: string;
  };
}

export interface CorsConfig {
  enabled: boolean;
  origins: string[] | boolean;
  methods: string[];
  headers: string[];
  credentials: boolean;
  maxAge: number;
  preflightContinue: boolean;
  optionsSuccessStatus: number;
  dynamicOrigin?: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => void;
}

export interface SecurityHeadersConfig {
  contentSecurityPolicy: {
    enabled: boolean;
    directives: Record<string, string[]>;
    reportUri?: string;
    reportOnly: boolean;
  };
  frameOptions: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM' | false;
  contentTypeOptions: boolean;
  xssProtection: boolean | { mode?: string; report?: string };
  referrerPolicy: string;
  permissionsPolicy: Record<string, string[]>;
  expectCt: {
    enabled: boolean;
    maxAge: number;
    reportUri?: string;
    enforce: boolean;
  };
}

export interface AuthenticationConfig {
  methods: AuthenticationMethod[];
  jwt: {
    secret: string;
    algorithm: string;
    expiresIn: string;
    issuer: string;
    audience: string;
    clockTolerance: number;
    refreshTokenEnabled: boolean;
    refreshTokenExpiry: string;
  };
  apiKey: {
    headerName: string;
    queryName?: string;
    prefix?: string;
    length: number;
    algorithm: string;
  };
  oauth: {
    providers: OAuthProvider[];
    stateExpiry: number;
    pkceEnabled: boolean;
  };
  session: {
    enabled: boolean;
    secret: string;
    maxAge: number;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
  };
}

export interface OAuthProvider {
  name: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string[];
  callbackUrl: string;
}

export interface AuthorizationConfig {
  enabled: boolean;
  defaultPolicy: 'allow' | 'deny';
  roles: Role[];
  permissions: Permission[];
  resources: Resource[];
  policies: Policy[];
  hierarchical: boolean;
}

export interface Role {
  name: string;
  description: string;
  permissions: string[];
  inherits?: string[];
  metadata?: Record<string, any>;
}

export interface Permission {
  name: string;
  resource: string;
  actions: string[];
  conditions?: Record<string, any>;
}

export interface Resource {
  name: string;
  type: string;
  actions: string[];
  attributes?: Record<string, any>;
}

export interface Policy {
  name: string;
  effect: 'allow' | 'deny';
  subjects: string[];
  resources: string[];
  actions: string[];
  conditions?: Record<string, any>;
}

export interface ValidationConfig {
  enabled: boolean;
  sanitization: {
    enabled: boolean;
    xss: boolean;
    sql: boolean;
    html: boolean;
    scripts: boolean;
  };
  schemas: {
    strict: boolean;
    additionalProperties: boolean;
    coerceTypes: boolean;
  };
  limits: {
    maxRequestSize: string;
    maxFieldSize: string;
    maxFields: number;
    maxFiles: number;
    maxFileSize: string;
  };
  patterns: {
    email: RegExp;
    url: RegExp;
    phone: RegExp;
    alphanumeric: RegExp;
  };
}

export interface SecurityMonitoringConfig {
  enabled: boolean;
  realTime: boolean;
  logging: {
    level: 'info' | 'warn' | 'error';
    events: SecurityEventType[];
    destinations: LogDestination[];
  };
  alerts: {
    enabled: boolean;
    thresholds: AlertThreshold[];
    channels: AlertChannel[];
  };
  metrics: {
    enabled: boolean;
    retention: number;
    aggregation: string[];
  };
}

export type SecurityEventType = 
  | 'authentication_failure'
  | 'authorization_failure' 
  | 'suspicious_activity'
  | 'brute_force_attempt'
  | 'sql_injection_attempt'
  | 'xss_attempt'
  | 'rate_limit_exceeded'
  | 'invalid_token'
  | 'privilege_escalation'
  | 'data_breach_attempt';

export interface LogDestination {
  type: 'file' | 'database' | 'siem' | 'webhook';
  config: Record<string, any>;
}

export interface AlertThreshold {
  event: SecurityEventType;
  count: number;
  timeWindow: number;
  severity: ThreatLevel;
}

export interface AlertChannel {
  name: string;
  type: 'email' | 'sms' | 'webhook' | 'slack';
  config: Record<string, any>;
}

export interface SecurityRateLimitConfig {
  enabled: boolean;
  global: SecurityRateLimit;
  authentication: SecurityRateLimit;
  api: Record<string, SecurityRateLimit>;
  bruteForce: SecurityRateLimit;
  skipSuccessful: boolean;
  skipFailed: boolean;
  keyGenerator: (req: any) => string;
  whitelist: string[];
  blacklist: string[];
}

export interface SecurityRateLimit {
  windowMs: number;
  maxRequests: number;
  blockDuration: number;
  progressiveDelay: boolean;
}

export interface AuditConfig {
  enabled: boolean;
  events: AuditEventType[];
  storage: {
    type: 'file' | 'database' | 'cloud';
    retention: number;
    encryption: boolean;
    compression: boolean;
  };
  compliance: {
    pci: boolean;
    hipaa: boolean;
    gdpr: boolean;
    sox: boolean;
  };
  realTime: boolean;
}

export type AuditEventType =
  | 'user_login'
  | 'user_logout'
  | 'user_registration'
  | 'password_change'
  | 'permission_granted'
  | 'permission_denied'
  | 'data_access'
  | 'data_modification'
  | 'configuration_change'
  | 'system_access'
  | 'api_access'
  | 'file_access';

export interface EncryptionConfig {
  atRest: {
    enabled: boolean;
    algorithm: string;
    keySize: number;
    keyRotation: boolean;
    keyRotationInterval: number;
  };
  inTransit: {
    enforced: boolean;
    minTlsVersion: string;
    cipherSuites: string[];
    perfectForwardSecrecy: boolean;
  };
  database: {
    enabled: boolean;
    columns: string[];
    keyManagement: 'local' | 'vault' | 'cloud';
  };
}

export interface ThreatDetectionConfig {
  enabled: boolean;
  modules: ThreatDetectionModule[];
  behaviorAnalysis: {
    enabled: boolean;
    baselinePeriod: number;
    sensitivity: number;
  };
  ipReputation: {
    enabled: boolean;
    providers: string[];
    cacheTimeout: number;
  };
  anomalyDetection: {
    enabled: boolean;
    algorithms: string[];
    threshold: number;
  };
}

export interface ThreatDetectionModule {
  name: string;
  enabled: boolean;
  config: Record<string, any>;
  severity: ThreatLevel;
}

export interface SecurityEvent {
  id: string;
  timestamp: number;
  type: SecurityEventType;
  severity: ThreatLevel;
  source: {
    ip: string;
    userAgent?: string;
    userId?: string;
    sessionId?: string;
  };
  details: Record<string, any>;
  blocked: boolean;
  resolved: boolean;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  userId?: string;
  sessionId?: string;
  resource: string;
  action: string;
  result: 'success' | 'failure';
  details: Record<string, any>;
  ipAddress: string;
  userAgent?: string;
}

export class SecurityManager {
  private config: SecurityConfig;
  private securityEvents: SecurityEvent[] = [];
  private auditEvents: AuditEvent[] = [];
  private threatDetectors: Map<string, ThreatDetector> = new Map();
  private activeThreats: Map<string, SecurityEvent[]> = new Map();

  constructor(config: SecurityConfig) {
    this.config = config;
    this.initializeThreatDetectors();
    
    if (config.monitoring.enabled) {
      this.startSecurityMonitoring();
    }
    
    console.log(`🔒 Security Manager initialized (level: ${config.level})`);
  }

  /**
   * Validate authentication token
   */
  async validateAuth(token: string, method: AuthenticationMethod): Promise<any> {
    try {
      switch (method) {
        case 'jwt':
          return await this.validateJWT(token);
        case 'api_key':
          return await this.validateApiKey(token);
        case 'bearer':
          return await this.validateBearerToken(token);
        default:
          throw new Error(`Unsupported authentication method: ${method}`);
      }
    } catch (error) {
      await this.logSecurityEvent('authentication_failure', 'high', {
        method,
        token: token.substring(0, 10) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check authorization for resource access
   */
  async checkAuthorization(
    subject: string, 
    resource: string, 
    action: string, 
    context?: Record<string, any>
  ): Promise<boolean> {
    if (!this.config.authorization.enabled) {
      return this.config.authorization.defaultPolicy === 'allow';
    }

    try {
      const allowed = await this.evaluatePolicies(subject, resource, action, context);
      
      if (!allowed) {
        await this.logSecurityEvent('authorization_failure', 'medium', {
          subject,
          resource,
          action,
          context
        });
      }

      return allowed;
    } catch (error) {
      console.error('Authorization check failed:', error);
      return false;
    }
  }

  /**
   * Validate and sanitize input
   */
  validateInput(input: any, schema?: any): any {
    if (!this.config.validation.enabled) {
      return input;
    }

    let sanitized = input;

    // Apply sanitization
    if (this.config.validation.sanitization.enabled) {
      sanitized = this.sanitizeInput(sanitized);
    }

    // Apply schema validation if provided
    if (schema) {
      sanitized = this.validateSchema(sanitized, schema);
    }

    return sanitized;
  }

  /**
   * Check if request should be rate limited
   */
  async checkRateLimit(key: string, category: string = 'global'): Promise<boolean> {
    if (!this.config.rateLimit.enabled) {
      return false;
    }

    const limit = this.getRateLimitConfig(category);
    const isLimited = await this.evaluateRateLimit(key, limit);

    if (isLimited) {
      await this.logSecurityEvent('rate_limit_exceeded', 'medium', {
        key,
        category,
        limit
      });
    }

    return isLimited;
  }

  /**
   * Detect potential threats
   */
  async detectThreats(request: any): Promise<SecurityEvent[]> {
    const detectedThreats: SecurityEvent[] = [];

    if (!this.config.threatDetection.enabled) {
      return detectedThreats;
    }

    for (const [name, detector] of this.threatDetectors.entries()) {
      try {
        const threats = await detector.analyze(request);
        detectedThreats.push(...threats);
      } catch (error) {
        console.error(`Threat detector ${name} failed:`, error);
      }
    }

    // Process detected threats
    for (const threat of detectedThreats) {
      await this.processSecurityEvent(threat);
    }

    return detectedThreats;
  }

  /**
   * Log security event
   */
  async logSecurityEvent(
    type: SecurityEventType,
    severity: ThreatLevel,
    details: Record<string, any>,
    source?: any
  ): Promise<void> {
    const event: SecurityEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      type,
      severity,
      source: {
        ip: source?.ip || 'unknown',
        userAgent: source?.userAgent,
        userId: source?.userId,
        sessionId: source?.sessionId
      },
      details,
      blocked: false,
      resolved: false
    };

    this.securityEvents.push(event);
    
    // Trigger alerts if necessary
    await this.checkAlertThresholds(type);
    
    // Log to configured destinations
    await this.persistSecurityEvent(event);
    
    console.log(`🚨 Security event: ${type} (${severity}) - ${JSON.stringify(details)}`);
  }

  /**
   * Log audit event
   */
  async logAuditEvent(
    type: AuditEventType,
    userId: string | undefined,
    resource: string,
    action: string,
    result: 'success' | 'failure',
    details: Record<string, any>,
    request?: any
  ): Promise<void> {
    if (!this.config.audit.enabled) {
      return;
    }

    const event: AuditEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      type,
      userId,
      sessionId: request?.sessionId,
      resource,
      action,
      result,
      details,
      ipAddress: request?.ip || 'unknown',
      userAgent: request?.userAgent
    };

    this.auditEvents.push(event);
    await this.persistAuditEvent(event);
  }

  /**
   * Get security headers for HTTP responses
   */
  getSecurityHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    const headerConfig = this.config.headers;

    // Content Security Policy
    if (headerConfig.contentSecurityPolicy.enabled) {
      const csp = this.buildCSP(headerConfig.contentSecurityPolicy);
      headers['Content-Security-Policy'] = csp;
    }

    // X-Frame-Options
    if (headerConfig.frameOptions) {
      headers['X-Frame-Options'] = headerConfig.frameOptions;
    }

    // X-Content-Type-Options
    if (headerConfig.contentTypeOptions) {
      headers['X-Content-Type-Options'] = 'nosniff';
    }

    // X-XSS-Protection
    if (headerConfig.xssProtection) {
      headers['X-XSS-Protection'] = typeof headerConfig.xssProtection === 'boolean' 
        ? '1; mode=block' 
        : `1; mode=${headerConfig.xssProtection.mode || 'block'}`;
    }

    // Referrer-Policy
    if (headerConfig.referrerPolicy) {
      headers['Referrer-Policy'] = headerConfig.referrerPolicy;
    }

    // Strict-Transport-Security
    if (this.config.https.hsts.enabled) {
      const hsts = this.config.https.hsts;
      let hstsValue = `max-age=${hsts.maxAge}`;
      if (hsts.includeSubDomains) hstsValue += '; includeSubDomains';
      if (hsts.preload) hstsValue += '; preload';
      headers['Strict-Transport-Security'] = hstsValue;
    }

    return headers;
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(): any {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const recentEvents = this.securityEvents.filter(e => e.timestamp > last24h);

    return {
      totalEvents: this.securityEvents.length,
      recentEvents: recentEvents.length,
      eventsByType: this.groupEventsByType(recentEvents),
      eventsBySeverity: this.groupEventsBySeverity(recentEvents),
      activeThreats: this.activeThreats.size,
      auditEvents: this.auditEvents.length,
      threatDetectors: Array.from(this.threatDetectors.keys())
    };
  }

  // Private methods

  private async validateJWT(token: string): Promise<any> {
    // JWT validation implementation
    const config = this.config.authentication.jwt;
    
    // This is a simplified implementation
    // In production, use a proper JWT library
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Verify signature (simplified)
    const signature = createHmac('sha256', config.secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    if (signature !== parts[2]) {
      throw new Error('Invalid JWT signature');
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('JWT expired');
    }

    return payload;
  }

  private async validateApiKey(key: string): Promise<any> {
    const config = this.config.authentication.apiKey;
    
    if (config.prefix && !key.startsWith(config.prefix)) {
      throw new Error('Invalid API key format');
    }

    // In production, this would check against a database
    // For now, just validate format
    if (key.length < config.length) {
      throw new Error('API key too short');
    }

    return { type: 'api_key', key };
  }

  private async validateBearerToken(token: string): Promise<any> {
    if (!token.startsWith('Bearer ')) {
      throw new Error('Invalid bearer token format');
    }

    const actualToken = token.substring(7);
    return this.validateJWT(actualToken);
  }

  private async evaluatePolicies(
    subject: string,
    resource: string,
    action: string,
    context?: Record<string, any>
  ): Promise<boolean> {
    // Simplified policy evaluation
    // In production, this would be more sophisticated
    const policies = this.config.authorization.policies;
    
    for (const policy of policies) {
      if (this.matchesPolicy(policy, subject, resource, action)) {
        return policy.effect === 'allow';
      }
    }

    return this.config.authorization.defaultPolicy === 'allow';
  }

  private matchesPolicy(
    policy: Policy,
    subject: string,
    resource: string,
    action: string
  ): boolean {
    return policy.subjects.includes(subject) &&
           policy.resources.includes(resource) &&
           policy.actions.includes(action);
  }

  private sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      let sanitized = input;
      
      if (this.config.validation.sanitization.xss) {
        sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }
      
      if (this.config.validation.sanitization.sql) {
        sanitized = sanitized.replace(/('|("|;|--|\/\*))/g, '');
      }
      
      return sanitized;
    }
    
    return input;
  }

  private validateSchema(input: any, schema: any): any {
    // Schema validation implementation
    // In production, use a library like Joi or Ajv
    return input;
  }

  private getRateLimitConfig(category: string): SecurityRateLimit {
    const limits = this.config.rateLimit;
    
    switch (category) {
      case 'authentication':
        return limits.authentication;
      case 'api':
        return limits.api['default'] || limits.global;
      default:
        return limits.global;
    }
  }

  private async evaluateRateLimit(key: string, limit: SecurityRateLimit): Promise<boolean> {
    // Simplified rate limiting
    // In production, use Redis or similar
    return false; // Not limited
  }

  private initializeThreatDetectors(): void {
    if (!this.config.threatDetection.enabled) {
      return;
    }

    for (const module of this.config.threatDetection.modules) {
      if (module.enabled) {
        const detector = new ThreatDetector(module.name, module.config);
        this.threatDetectors.set(module.name, detector);
      }
    }
  }

  private startSecurityMonitoring(): void {
    setInterval(() => {
      this.performSecurityHealthCheck();
    }, 60000); // Every minute
  }

  private async performSecurityHealthCheck(): Promise<void> {
    // Perform periodic security checks
    const metrics = this.getSecurityMetrics();
    
    if (metrics.recentEvents > 100) {
      console.warn('⚠️ High security event volume detected');
    }
  }

  private async processSecurityEvent(event: SecurityEvent): Promise<void> {
    // Process security event based on severity
    if (event.severity === 'critical') {
      // Immediate action required
      await this.handleCriticalThreat(event);
    }
    
    this.securityEvents.push(event);
  }

  private async handleCriticalThreat(event: SecurityEvent): Promise<void> {
    console.error('🚨 CRITICAL SECURITY THREAT DETECTED:', event);
    
    // In production, this would:
    // - Block the source IP
    // - Send immediate alerts
    // - Escalate to security team
    // - Potentially shut down affected services
  }

  private async checkAlertThresholds(eventType: SecurityEventType): Promise<void> {
    const thresholds = this.config.monitoring.alerts.thresholds;
    
    for (const threshold of thresholds) {
      if (threshold.event === eventType) {
        const recentEvents = this.securityEvents.filter(e => 
          e.type === eventType && 
          e.timestamp > Date.now() - threshold.timeWindow
        );
        
        if (recentEvents.length >= threshold.count) {
          await this.sendAlert(threshold, recentEvents);
        }
      }
    }
  }

  private async sendAlert(threshold: AlertThreshold, events: SecurityEvent[]): Promise<void> {
    console.log(`🚨 Security alert triggered: ${threshold.event} (${threshold.severity})`);
    
    // In production, send to configured alert channels
  }

  private async persistSecurityEvent(event: SecurityEvent): Promise<void> {
    // Persist security event to configured destinations
    // For now, just log to console in development
    if (this.config.environment === 'development') {
      console.log('Security Event:', JSON.stringify(event, null, 2));
    }
  }

  private async persistAuditEvent(event: AuditEvent): Promise<void> {
    // Persist audit event
    if (this.config.environment === 'development') {
      console.log('Audit Event:', JSON.stringify(event, null, 2));
    }
  }

  private buildCSP(config: SecurityHeadersConfig['contentSecurityPolicy']): string {
    const directives = config.directives;
    const cspParts: string[] = [];
    
    for (const [directive, values] of Object.entries(directives)) {
      cspParts.push(`${directive} ${values.join(' ')}`);
    }
    
    return cspParts.join('; ');
  }

  private groupEventsByType(events: SecurityEvent[]): Record<string, number> {
    return events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private groupEventsBySeverity(events: SecurityEvent[]): Record<string, number> {
    return events.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private generateId(): string {
    return randomBytes(16).toString('hex');
  }
}

/**
 * Simple Threat Detector implementation
 */
class ThreatDetector {
  private name: string;
  private config: Record<string, any>;

  constructor(name: string, config: Record<string, any>) {
    this.name = name;
    this.config = config;
  }

  async analyze(request: any): Promise<SecurityEvent[]> {
    const threats: SecurityEvent[] = [];
    
    // Implement threat detection logic based on the detector type
    // This is a simplified implementation
    
    return threats;
  }
}

/**
 * Factory function to create security manager
 */
export function createSecurityManager(overrides: Partial<SecurityConfig> = {}): SecurityManager {
  const defaultConfig: SecurityConfig = {
    level: (process.env.SECURITY_LEVEL as SecurityLevel) || 'enhanced',
    environment: process.env.NODE_ENV || 'development',
    https: {
      enabled: process.env.HTTPS_ENABLED === 'true',
      enforced: process.env.HTTPS_ENFORCED === 'true',
      port: parseInt(process.env.HTTPS_PORT || '443'),
      certificates: {
        cert: process.env.TLS_CERT_PATH || '',
        key: process.env.TLS_KEY_PATH || '',
        ca: process.env.TLS_CA_PATH,
        passphrase: process.env.TLS_PASSPHRASE
      },
      protocols: (process.env.TLS_PROTOCOLS || 'TLSv1.2,TLSv1.3').split(','),
      ciphers: (process.env.TLS_CIPHERS || '').split(',').filter(Boolean),
      hsts: {
        enabled: process.env.HSTS_ENABLED === 'true',
        maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000'),
        includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
        preload: process.env.HSTS_PRELOAD === 'true'
      },
      ocsp: {
        enabled: process.env.OCSP_ENABLED === 'true',
        url: process.env.OCSP_URL
      }
    },
    cors: {
      enabled: process.env.CORS_ENABLED !== 'false',
      origins: process.env.CORS_ORIGINS?.split(',') || ['*'],
      methods: (process.env.CORS_METHODS || 'GET,POST,PUT,DELETE,OPTIONS').split(','),
      headers: (process.env.CORS_HEADERS || 'Content-Type,Authorization').split(','),
      credentials: process.env.CORS_CREDENTIALS === 'true',
      maxAge: parseInt(process.env.CORS_MAX_AGE || '86400'),
      preflightContinue: process.env.CORS_PREFLIGHT_CONTINUE === 'true',
      optionsSuccessStatus: parseInt(process.env.CORS_OPTIONS_STATUS || '204')
    },
    headers: {
      contentSecurityPolicy: {
        enabled: process.env.CSP_ENABLED === 'true',
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:']
        },
        reportUri: process.env.CSP_REPORT_URI,
        reportOnly: process.env.CSP_REPORT_ONLY === 'true'
      },
      frameOptions: (process.env.X_FRAME_OPTIONS as any) || 'SAMEORIGIN',
      contentTypeOptions: process.env.X_CONTENT_TYPE_OPTIONS !== 'false',
      xssProtection: process.env.X_XSS_PROTECTION !== 'false',
      referrerPolicy: process.env.REFERRER_POLICY || 'strict-origin-when-cross-origin',
      permissionsPolicy: {},
      expectCt: {
        enabled: process.env.EXPECT_CT_ENABLED === 'true',
        maxAge: parseInt(process.env.EXPECT_CT_MAX_AGE || '86400'),
        reportUri: process.env.EXPECT_CT_REPORT_URI,
        enforce: process.env.EXPECT_CT_ENFORCE === 'true'
      }
    },
    authentication: {
      methods: (process.env.AUTH_METHODS?.split(',') as AuthenticationMethod[]) || ['jwt'],
      jwt: {
        secret: process.env.JWT_SECRET || '',
        algorithm: process.env.JWT_ALGORITHM || 'HS256',
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        issuer: process.env.JWT_ISSUER || 'fusion-cross-chain',
        audience: process.env.JWT_AUDIENCE || 'fusion-api',
        clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE || '30'),
        refreshTokenEnabled: process.env.JWT_REFRESH_ENABLED === 'true',
        refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
      },
      apiKey: {
        headerName: process.env.API_KEY_HEADER || 'X-API-Key',
        queryName: process.env.API_KEY_QUERY,
        prefix: process.env.API_KEY_PREFIX,
        length: parseInt(process.env.API_KEY_LENGTH || '32'),
        algorithm: process.env.API_KEY_ALGORITHM || 'sha256'
      },
      oauth: {
        providers: [],
        stateExpiry: parseInt(process.env.OAUTH_STATE_EXPIRY || '600'),
        pkceEnabled: process.env.OAUTH_PKCE_ENABLED === 'true'
      },
      session: {
        enabled: process.env.SESSION_ENABLED === 'true',
        secret: process.env.SESSION_SECRET || '',
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '3600000'),
        secure: process.env.SESSION_SECURE === 'true',
        httpOnly: process.env.SESSION_HTTP_ONLY !== 'false',
        sameSite: (process.env.SESSION_SAME_SITE as any) || 'lax'
      }
    },
    authorization: {
      enabled: process.env.AUTHORIZATION_ENABLED === 'true',
      defaultPolicy: (process.env.AUTHORIZATION_DEFAULT_POLICY as any) || 'deny',
      roles: [],
      permissions: [],
      resources: [],
      policies: [],
      hierarchical: process.env.AUTHORIZATION_HIERARCHICAL === 'true'
    },
    validation: {
      enabled: process.env.VALIDATION_ENABLED !== 'false',
      sanitization: {
        enabled: process.env.SANITIZATION_ENABLED === 'true',
        xss: process.env.SANITIZATION_XSS === 'true',
        sql: process.env.SANITIZATION_SQL === 'true',
        html: process.env.SANITIZATION_HTML === 'true',
        scripts: process.env.SANITIZATION_SCRIPTS === 'true'
      },
      schemas: {
        strict: process.env.SCHEMA_STRICT === 'true',
        additionalProperties: process.env.SCHEMA_ADDITIONAL_PROPERTIES === 'true',
        coerceTypes: process.env.SCHEMA_COERCE_TYPES === 'true'
      },
      limits: {
        maxRequestSize: process.env.MAX_REQUEST_SIZE || '1mb',
        maxFieldSize: process.env.MAX_FIELD_SIZE || '1mb',
        maxFields: parseInt(process.env.MAX_FIELDS || '1000'),
        maxFiles: parseInt(process.env.MAX_FILES || '10'),
        maxFileSize: process.env.MAX_FILE_SIZE || '10mb'
      },
      patterns: {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        url: /^https?:\/\/[^\s/$.?#].[^\s]*$/,
        phone: /^\+?[\d\s\-\(\)]+$/,
        alphanumeric: /^[a-zA-Z0-9]+$/
      }
    },
    monitoring: {
      enabled: process.env.SECURITY_MONITORING_ENABLED === 'true',
      realTime: process.env.SECURITY_MONITORING_REALTIME === 'true',
      logging: {
        level: (process.env.SECURITY_LOG_LEVEL as any) || 'warn',
        events: [] as SecurityEventType[],
        destinations: []
      },
      alerts: {
        enabled: process.env.SECURITY_ALERTS_ENABLED === 'true',
        thresholds: [],
        channels: []
      },
      metrics: {
        enabled: process.env.SECURITY_METRICS_ENABLED === 'true',
        retention: parseInt(process.env.SECURITY_METRICS_RETENTION || '2592000'), // 30 days
        aggregation: []
      }
    },
    rateLimit: {
      enabled: process.env.SECURITY_RATE_LIMIT_ENABLED === 'true',
      global: {
        windowMs: parseInt(process.env.SECURITY_RATE_LIMIT_WINDOW || '900000'),
        maxRequests: parseInt(process.env.SECURITY_RATE_LIMIT_MAX || '1000'),
        blockDuration: parseInt(process.env.SECURITY_RATE_LIMIT_BLOCK_DURATION || '3600000'),
        progressiveDelay: process.env.SECURITY_RATE_LIMIT_PROGRESSIVE === 'true'
      },
      authentication: {
        windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || '900000'),
        maxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5'),
        blockDuration: parseInt(process.env.AUTH_RATE_LIMIT_BLOCK_DURATION || '900000'),
        progressiveDelay: true
      },
      api: {},
      bruteForce: {
        windowMs: parseInt(process.env.BRUTE_FORCE_WINDOW || '300000'),
        maxRequests: parseInt(process.env.BRUTE_FORCE_MAX || '3'),
        blockDuration: parseInt(process.env.BRUTE_FORCE_BLOCK_DURATION || '1800000'),
        progressiveDelay: true
      },
      skipSuccessful: process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true',
      skipFailed: process.env.RATE_LIMIT_SKIP_FAILED === 'true',
      keyGenerator: (req: any) => req.ip,
      whitelist: (process.env.RATE_LIMIT_WHITELIST || '').split(',').filter(Boolean),
      blacklist: (process.env.RATE_LIMIT_BLACKLIST || '').split(',').filter(Boolean)
    },
    audit: {
      enabled: process.env.AUDIT_ENABLED === 'true',
      events: [] as AuditEventType[],
      storage: {
        type: (process.env.AUDIT_STORAGE_TYPE as any) || 'file',
        retention: parseInt(process.env.AUDIT_RETENTION || '2592000'),
        encryption: process.env.AUDIT_ENCRYPTION === 'true',
        compression: process.env.AUDIT_COMPRESSION === 'true'
      },
      compliance: {
        pci: process.env.AUDIT_PCI_COMPLIANCE === 'true',
        hipaa: process.env.AUDIT_HIPAA_COMPLIANCE === 'true',
        gdpr: process.env.AUDIT_GDPR_COMPLIANCE === 'true',
        sox: process.env.AUDIT_SOX_COMPLIANCE === 'true'
      },
      realTime: process.env.AUDIT_REALTIME === 'true'
    },
    encryption: {
      atRest: {
        enabled: process.env.ENCRYPTION_AT_REST_ENABLED === 'true',
        algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
        keySize: parseInt(process.env.ENCRYPTION_KEY_SIZE || '256'),
        keyRotation: process.env.ENCRYPTION_KEY_ROTATION === 'true',
        keyRotationInterval: parseInt(process.env.ENCRYPTION_KEY_ROTATION_INTERVAL || '30')
      },
      inTransit: {
        enforced: process.env.ENCRYPTION_IN_TRANSIT_ENFORCED === 'true',
        minTlsVersion: process.env.MIN_TLS_VERSION || '1.2',
        cipherSuites: (process.env.TLS_CIPHER_SUITES || '').split(',').filter(Boolean),
        perfectForwardSecrecy: process.env.PERFECT_FORWARD_SECRECY === 'true'
      },
      database: {
        enabled: process.env.DB_ENCRYPTION_ENABLED === 'true',
        columns: (process.env.DB_ENCRYPTED_COLUMNS || '').split(',').filter(Boolean),
        keyManagement: (process.env.DB_KEY_MANAGEMENT as any) || 'local'
      }
    },
    threatDetection: {
      enabled: process.env.THREAT_DETECTION_ENABLED === 'true',
      modules: [],
      behaviorAnalysis: {
        enabled: process.env.BEHAVIOR_ANALYSIS_ENABLED === 'true',
        baselinePeriod: parseInt(process.env.BEHAVIOR_BASELINE_PERIOD || '604800'),
        sensitivity: parseFloat(process.env.BEHAVIOR_SENSITIVITY || '0.8')
      },
      ipReputation: {
        enabled: process.env.IP_REPUTATION_ENABLED === 'true',
        providers: (process.env.IP_REPUTATION_PROVIDERS || '').split(',').filter(Boolean),
        cacheTimeout: parseInt(process.env.IP_REPUTATION_CACHE_TIMEOUT || '3600')
      },
      anomalyDetection: {
        enabled: process.env.ANOMALY_DETECTION_ENABLED === 'true',
        algorithms: (process.env.ANOMALY_ALGORITHMS || 'isolation_forest').split(','),
        threshold: parseFloat(process.env.ANOMALY_THRESHOLD || '0.1')
      }
    }
  };

  const config = { ...defaultConfig, ...overrides };
  
  return new SecurityManager(config);
}

export default SecurityManager;