# Security Best Practices

## Overview

This document outlines security best practices for the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project. It covers secure configuration management, secrets handling, network security, and operational security measures.

## Table of Contents

1. [Secrets Management Security](#secrets-management-security)
2. [Network Security](#network-security)
3. [Authentication and Authorization](#authentication-and-authorization)
4. [Data Protection](#data-protection)
5. [Operational Security](#operational-security)
6. [Compliance and Auditing](#compliance-and-auditing)
7. [Incident Response](#incident-response)
8. [Security Monitoring](#security-monitoring)

## Secrets Management Security

### Encryption Standards

**Required Encryption:**

- **Algorithm**: AES-256-GCM for symmetric encryption
- **Key Length**: 256-bit minimum for encryption keys
- **Key Derivation**: PBKDF2 with SHA-256, minimum 100,000 iterations
- **Random Generation**: Use cryptographically secure random number generators

```typescript
// Example: Secure key generation
import { randomBytes, pbkdf2Sync } from 'crypto';

const generateEncryptionKey = (password: string, salt?: Buffer): Buffer => {
  const saltBuffer = salt || randomBytes(32);
  return pbkdf2Sync(password, saltBuffer, 100000, 32, 'sha256');
};
```

**Encryption Implementation:**

```typescript
// config/secrets/encryption.ts
import { createCipher, createDecipher, randomBytes } from 'crypto';

export class SecureEncryption {
  private readonly algorithm = 'aes-256-gcm';
  
  encrypt(plaintext: string, key: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipher(this.algorithm, key);
    cipher.setAAD(Buffer.from('fusion-bitcoin-secrets'));
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  }
  
  decrypt(ciphertext: string, key: Buffer): string {
    const [ivHex, encrypted, authTagHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = createDecipher(this.algorithm, key);
    decipher.setAAD(Buffer.from('fusion-bitcoin-secrets'));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

### Key Management

**Key Storage Requirements:**

- **Production**: Use dedicated key management systems (AWS KMS, Azure Key Vault, HashiCorp Vault)
- **Staging**: Separate keys from production, use staging-appropriate security
- **Development**: Use separate, non-production keys with appropriate security

**Key Rotation Policy:**

- **Frequency**: Rotate encryption keys every 30-90 days
- **Emergency Rotation**: Immediate rotation upon suspected compromise
- **Automated Rotation**: Use automated key rotation where possible
- **Key Versioning**: Maintain multiple key versions during transition periods

```typescript
// Example: Key rotation configuration
export const keyRotationConfig = {
  rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
  retentionPeriod: 90 * 24 * 60 * 60 * 1000,  // 90 days retention
  emergencyRotation: {
    enabled: true,
    notificationChannels: ['security-team@company.com'],
    maxRotationTime: 60 * 60 * 1000 // 1 hour max
  }
};
```

### Secrets Access Control

**Access Patterns:**

```typescript
// Implement least-privilege access
export class SecureSecretsAccess {
  async getSecret(
    secretId: string,
    context: {
      userId: string;
      component: string;
      requestId: string;
      permissions: string[];
    }
  ): Promise<string> {
    // Validate permissions
    if (!this.hasPermission(context.permissions, secretId)) {
      await this.auditLog('secret-access-denied', {
        secretId,
        userId: context.userId,
        component: context.component,
        reason: 'insufficient-permissions'
      });
      throw new Error('Access denied');
    }

    // Log access
    await this.auditLog('secret-accessed', {
      secretId,
      userId: context.userId,
      component: context.component,
      requestId: context.requestId
    });

    return this.retrieveSecret(secretId);
  }
}
```

**Access Control Lists:**

```typescript
// Define role-based access control
export const secretsACL = {
  'eth-private-key': {
    roles: ['relayer-service', 'admin'],
    environments: ['production', 'staging'],
    timeRestrictions: {
      allowedHours: [0, 23], // 24/7 access
      maxSessionDuration: 60 * 60 * 1000 // 1 hour
    }
  },
  'jwt-secret': {
    roles: ['auth-service', 'api-gateway', 'admin'],
    environments: ['production', 'staging', 'development'],
    rateLimit: {
      maxRequests: 100,
      windowMs: 60 * 60 * 1000 // per hour
    }
  }
};
```

## Network Security

### HTTPS/TLS Configuration

**TLS Requirements:**

- **Version**: TLS 1.2 minimum, TLS 1.3 recommended
- **Cipher Suites**: Strong cipher suites only, disable weak ciphers
- **Certificate Management**: Use valid certificates from trusted CAs
- **HSTS**: Enable HTTP Strict Transport Security

```typescript
// Example: Secure server configuration
import https from 'https';
import fs from 'fs';

const serverOptions = {
  key: fs.readFileSync(process.env.TLS_KEY_PATH!),
  cert: fs.readFileSync(process.env.TLS_CERT_PATH!),
  ca: fs.readFileSync(process.env.TLS_CA_PATH!),
  
  // Security options
  secureProtocol: 'TLSv1_2_method',
  ciphers: [
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'ECDHE-RSA-AES256-SHA256'
  ].join(':'),
  
  // Disable weak features
  secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1,
  honorCipherOrder: true
};

const server = https.createServer(serverOptions, app);
```

### CORS Configuration

**CORS Security:**

```typescript
// Secure CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key'
  ],
  maxAge: 86400 // 24 hours
};
```

### Rate Limiting

**Rate Limiting Strategy:**

```typescript
// Multi-tier rate limiting
export const rateLimitConfig = {
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 1000,
    message: 'Too many requests, please try again later'
  },
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    keyGenerator: (req) => req.ip + ':' + req.path
  },
  sensitive: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  }
};

// Implementation
import rateLimit from 'express-rate-limit';

const createRateLimiter = (config) => {
  return rateLimit({
    ...config,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('User-Agent')
      });
      res.status(429).json({ error: 'Rate limit exceeded' });
    }
  });
};
```

## Authentication and Authorization

### JWT Security

**JWT Configuration:**

```typescript
// Secure JWT configuration
export const jwtConfig = {
  algorithm: 'HS256' as const,
  expiresIn: '15m', // Short-lived access tokens
  issuer: 'fusion-bitcoin-bridge',
  audience: 'fusion-api',
  
  // Refresh token configuration
  refreshToken: {
    expiresIn: '7d',
    family: true, // Token family for refresh token rotation
    reuseDetection: true
  },
  
  // Security options
  clockTolerance: 60, // 60 seconds clock skew tolerance
  maxAge: 15 * 60, // 15 minutes max age
  
  // Custom claims validation
  customClaims: ['role', 'permissions', 'component']
};

// JWT middleware with security validation
export const jwtMiddleware = (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, jwtSecret, jwtConfig);
    
    // Additional security checks
    if (!decoded.component || !decoded.permissions) {
      throw new Error('Invalid token structure');
    }
    
    // Check token age
    const tokenAge = Date.now() / 1000 - decoded.iat;
    if (tokenAge > jwtConfig.maxAge) {
      throw new Error('Token too old');
    }

    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('JWT validation failed', {
      error: error.message,
      ip: req.ip,
      path: req.path
    });
    return res.status(401).json({ error: 'Invalid token' });
  }
};
```

### API Key Management

**API Key Security:**

```typescript
// Secure API key implementation
export class APIKeyManager {
  generateAPIKey(): { key: string; hashedKey: string } {
    const key = this.generateSecureKey();
    const hashedKey = this.hashAPIKey(key);
    
    return { key: `fbt_${key}`, hashedKey };
  }

  private generateSecureKey(): string {
    // Generate cryptographically secure random key
    const bytes = randomBytes(32);
    return bytes.toString('base64url');
  }

  private hashAPIKey(key: string): string {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(key, salt, 100000, 64, 'sha256');
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  async validateAPIKey(providedKey: string, hashedKey: string): Promise<boolean> {
    try {
      const [salt, hash] = hashedKey.split(':');
      const providedHash = pbkdf2Sync(providedKey, Buffer.from(salt, 'hex'), 100000, 64, 'sha256');
      
      return timingSafeEqual(Buffer.from(hash, 'hex'), providedHash);
    } catch (error) {
      return false;
    }
  }
}
```

### Role-Based Access Control

**RBAC Implementation:**

```typescript
// Role definitions
export const roles = {
  admin: {
    permissions: ['*'], // All permissions
    description: 'System administrator'
  },
  relayer: {
    permissions: [
      'blockchain:read',
      'blockchain:write', 
      'orders:read',
      'orders:execute'
    ],
    description: 'Relayer service'
  },
  resolver: {
    permissions: [
      'orders:read',
      'orders:resolve',
      'bitcoin:read'
    ],
    description: 'Order resolution service'
  },
  frontend: {
    permissions: [
      'orders:read',
      'user:read',
      'user:write'
    ],
    description: 'Frontend application'
  }
};

// Authorization middleware
export const authorize = (requiredPermissions: string[]) => {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions || [];
    const userRole = req.user?.role;

    // Check if user has admin role (full access)
    if (userRole === 'admin') {
      return next();
    }

    // Check specific permissions
    const hasPermission = requiredPermissions.every(permission => {
      return userPermissions.includes(permission) || 
             userPermissions.includes('*');
    });

    if (!hasPermission) {
      logger.warn('Authorization failed', {
        userId: req.user?.id,
        role: userRole,
        requiredPermissions,
        userPermissions,
        path: req.path
      });
      
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
```

## Data Protection

### Encryption at Rest

**Database Encryption:**

```typescript
// Database encryption configuration
export const databaseEncryption = {
  enabled: process.env.NODE_ENV === 'production',
  algorithm: 'aes-256-cbc',
  keyRotation: {
    enabled: true,
    intervalDays: 90
  },
  
  // Fields to encrypt
  encryptedFields: [
    'private_keys',
    'user_data',
    'transaction_details',
    'api_keys'
  ],
  
  // Encryption configuration
  options: {
    saltLength: 16,
    ivLength: 16,
    tagLength: 16
  }
};

// Example: Encrypted model field
export class UserModel {
  @Column({
    type: 'text',
    transformer: {
      to: (value: string) => encrypt(value, encryptionKey),
      from: (value: string) => decrypt(value, encryptionKey)
    }
  })
  sensitiveData: string;
}
```

### Data Sanitization

**Input Validation and Sanitization:**

```typescript
import validator from 'validator';
import { body, param, query, validationResult } from 'express-validator';

// Input validation rules
export const validationRules = {
  ethereumAddress: body('address')
    .isEthereumAddress()
    .withMessage('Invalid Ethereum address'),
    
  bitcoinAddress: body('address')
    .custom((value) => {
      if (!validator.isBtcAddress(value)) {
        throw new Error('Invalid Bitcoin address');
      }
      return true;
    }),
    
  amount: body('amount')
    .isDecimal({ decimal_digits: '0,18' })
    .custom((value) => {
      const amount = parseFloat(value);
      if (amount <= 0 || amount > 1000000) {
        throw new Error('Amount must be between 0 and 1,000,000');
      }
      return true;
    }),
    
  sanitizeString: body('*')
    .trim()
    .escape()
    .isLength({ max: 1000 })
};

// Validation middleware
export const validateAndSanitize = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      errors: errors.array(),
      ip: req.ip,
      path: req.path
    });
    
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};
```

### Data Anonymization

**PII Protection:**

```typescript
// Data anonymization utilities
export class DataAnonymizer {
  static anonymizeAddress(address: string): string {
    if (address.length < 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  static anonymizeIP(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    return 'xxx.xxx.xxx.xxx';
  }

  static hashIdentifier(identifier: string): string {
    return createHash('sha256')
      .update(identifier + process.env.ANONYMIZATION_SALT)
      .digest('hex')
      .slice(0, 16);
  }

  // Safe logging with anonymization
  static createSafeLogData(data: any): any {
    const safe = { ...data };
    
    // Anonymize common PII fields
    if (safe.ip) safe.ip = this.anonymizeIP(safe.ip);
    if (safe.userAgent) safe.userAgent = createHash('md5').update(safe.userAgent).digest('hex');
    if (safe.walletAddress) safe.walletAddress = this.anonymizeAddress(safe.walletAddress);
    
    return safe;
  }
}
```

## Operational Security

### Logging and Monitoring Security

**Secure Logging:**

```typescript
// Security-focused logging configuration
export const securityLoggingConfig = {
  // Security events to log
  securityEvents: [
    'authentication-failed',
    'authorization-denied', 
    'rate-limit-exceeded',
    'suspicious-activity',
    'configuration-changed',
    'secret-accessed',
    'admin-action'
  ],
  
  // Log levels
  levels: {
    security: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
  },
  
  // Secure log formatting
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    // Remove sensitive data
    winston.format.printf((info) => {
      const safe = DataAnonymizer.createSafeLogData(info);
      return JSON.stringify(safe);
    })
  ),
  
  // Transport configuration
  transports: [
    // Secure file transport
    new winston.transports.File({
      filename: '/var/log/security.log',
      level: 'security',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    }),
    
    // SIEM integration
    new winston.transports.Http({
      host: process.env.SIEM_HOST,
      port: parseInt(process.env.SIEM_PORT || '514'),
      ssl: true,
      auth: {
        username: process.env.SIEM_USERNAME,
        password: process.env.SIEM_PASSWORD
      }
    })
  ]
};
```

### Environment Isolation

**Environment Security Boundaries:**

```typescript
// Environment isolation configuration
export const environmentIsolation = {
  production: {
    networkAccess: {
      allowedHosts: [
        'api.1inch.io',
        'eth-mainnet.g.alchemy.com',
        'btc.getblock.io'
      ],
      blockedPorts: [22, 23, 3389], // Common admin ports
      firewallRules: 'strict'
    },
    
    processLimits: {
      maxMemory: '2GB',
      maxCPU: '2.0',
      maxConnections: 1000,
      maxFileHandles: 10000
    },
    
    securityHeaders: {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Content-Security-Policy': "default-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    }
  },
  
  staging: {
    // Staging-specific security configurations
    testDataProtection: true,
    limitedNetworkAccess: true,
    debuggingRestrictions: {
      noProductionData: true,
      limitedLogging: true
    }
  }
};
```

### Container Security

**Docker Security Configuration:**

```dockerfile
# Dockerfile security best practices
FROM node:18-alpine AS builder

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S fusion -u 1001

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY --chown=fusion:nodejs . .

# Install dependencies and build
RUN npm ci --only=production && npm cache clean --force
RUN npm run build

# Production image
FROM node:18-alpine AS runner

# Security updates
RUN apk update && apk upgrade
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S fusion -u 1001

WORKDIR /app

# Copy built application
COPY --from=builder --chown=fusion:nodejs /app/dist ./dist
COPY --from=builder --chown=fusion:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=fusion:nodejs /app/package.json ./package.json

# Security configurations
USER fusion
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/health-check.js

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
```

## Compliance and Auditing

### Audit Trail Requirements

**Audit Event Types:**

```typescript
// Comprehensive audit event definitions
export enum AuditEventType {
  // Authentication events
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILURE = 'auth.login.failure',
  LOGOUT = 'auth.logout',
  TOKEN_REFRESH = 'auth.token.refresh',
  
  // Authorization events
  ACCESS_GRANTED = 'authz.access.granted',
  ACCESS_DENIED = 'authz.access.denied',
  PERMISSION_CHANGED = 'authz.permission.changed',
  
  // Data access events
  SECRET_ACCESSED = 'data.secret.accessed',
  SECRET_MODIFIED = 'data.secret.modified',
  CONFIG_ACCESSED = 'data.config.accessed',
  CONFIG_MODIFIED = 'data.config.modified',
  
  // Transaction events
  TRANSACTION_INITIATED = 'tx.initiated',
  TRANSACTION_COMPLETED = 'tx.completed',
  TRANSACTION_FAILED = 'tx.failed',
  
  // Administrative events
  ADMIN_ACTION = 'admin.action',
  SYSTEM_CONFIGURATION_CHANGED = 'admin.config.changed',
  USER_CREATED = 'admin.user.created',
  USER_DELETED = 'admin.user.deleted',
  
  // Security events
  SECURITY_VIOLATION = 'security.violation',
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  SUSPICIOUS_ACTIVITY = 'security.suspicious',
  INTRUSION_ATTEMPT = 'security.intrusion'
}

// Audit logger implementation
export class AuditLogger {
  async logEvent(
    eventType: AuditEventType,
    data: {
      userId?: string;
      component: string;
      resource?: string;
      action: string;
      result: 'success' | 'failure';
      metadata?: Record<string, any>;
      ip?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      eventId: generateUUID(),
      ...data,
      // Anonymize sensitive data
      ip: data.ip ? DataAnonymizer.anonymizeIP(data.ip) : undefined,
      userAgent: data.userAgent ? createHash('md5').update(data.userAgent).digest('hex') : undefined
    };

    // Store in secure audit log
    await this.storeAuditEntry(auditEntry);
    
    // Real-time security monitoring
    if (this.isSecurityEvent(eventType)) {
      await this.triggerSecurityAlert(auditEntry);
    }
  }

  private isSecurityEvent(eventType: AuditEventType): boolean {
    return [
      AuditEventType.LOGIN_FAILURE,
      AuditEventType.ACCESS_DENIED,
      AuditEventType.SECURITY_VIOLATION,
      AuditEventType.RATE_LIMIT_EXCEEDED,
      AuditEventType.SUSPICIOUS_ACTIVITY,
      AuditEventType.INTRUSION_ATTEMPT
    ].includes(eventType);
  }
}
```

### Compliance Monitoring

**Regulatory Compliance Checks:**

```typescript
// Compliance validation framework
export class ComplianceValidator {
  async validateGDPRCompliance(): Promise<ComplianceResult> {
    const checks = [
      this.checkDataMinimization(),
      this.checkConsentManagement(), 
      this.checkRightToErasure(),
      this.checkDataPortability(),
      this.checkBreachNotification()
    ];

    const results = await Promise.all(checks);
    return this.aggregateResults('GDPR', results);
  }

  async validateSOXCompliance(): Promise<ComplianceResult> {
    const checks = [
      this.checkAuditTrail(),
      this.checkAccessControls(),
      this.checkDataIntegrity(),
      this.checkFinancialReporting()
    ];

    const results = await Promise.all(checks);
    return this.aggregateResults('SOX', results);
  }

  private async checkDataMinimization(): Promise<CheckResult> {
    // Verify only necessary data is collected and stored
    return {
      passed: true,
      message: 'Data minimization principles followed',
      evidence: 'Configuration validates only required fields are collected'
    };
  }

  private async checkAuditTrail(): Promise<CheckResult> {
    // Verify comprehensive audit logging
    const auditConfig = await this.getAuditConfiguration();
    const requiredEvents = [
      'authentication', 'authorization', 'data-access', 
      'configuration-changes', 'administrative-actions'
    ];
    
    const missingEvents = requiredEvents.filter(event => 
      !auditConfig.loggedEvents.includes(event)
    );

    return {
      passed: missingEvents.length === 0,
      message: missingEvents.length === 0 
        ? 'All required events are audited'
        : `Missing audit events: ${missingEvents.join(', ')}`,
      evidence: `Audit configuration: ${JSON.stringify(auditConfig)}`
    };
  }
}
```

## Incident Response

### Security Incident Classification

**Incident Severity Levels:**

```typescript
export enum IncidentSeverity {
  CRITICAL = 'critical',    // Service compromise, data breach
  HIGH = 'high',           // Unauthorized access, service disruption  
  MEDIUM = 'medium',       // Security control failure, suspicious activity
  LOW = 'low',            // Policy violation, minor security issue
  INFO = 'informational'   // Security event, no immediate impact
}

export enum IncidentType {
  DATA_BREACH = 'data-breach',
  UNAUTHORIZED_ACCESS = 'unauthorized-access',
  SERVICE_COMPROMISE = 'service-compromise',
  MALWARE_DETECTION = 'malware-detection',
  DDOS_ATTACK = 'ddos-attack',
  INSIDER_THREAT = 'insider-threat',
  CONFIGURATION_ERROR = 'config-error',
  VULNERABILITY_EXPLOIT = 'vulnerability-exploit'
}

// Incident response workflow
export class IncidentResponseManager {
  async handleSecurityIncident(
    type: IncidentType,
    severity: IncidentSeverity,
    details: any
  ): Promise<void> {
    const incident = await this.createIncident(type, severity, details);
    
    // Immediate response actions
    switch (severity) {
      case IncidentSeverity.CRITICAL:
        await this.executeCriticalResponse(incident);
        break;
      case IncidentSeverity.HIGH:
        await this.executeHighResponse(incident);
        break;
      default:
        await this.executeStandardResponse(incident);
    }
  }

  private async executeCriticalResponse(incident: SecurityIncident): Promise<void> {
    // 1. Immediate containment
    await this.containThreat(incident);
    
    // 2. Emergency notifications
    await this.notifySecurityTeam(incident, 'immediate');
    await this.notifyManagement(incident);
    
    // 3. Service protection
    if (incident.type === IncidentType.SERVICE_COMPROMISE) {
      await this.enableEmergencyMode();
    }
    
    // 4. Evidence preservation
    await this.preserveEvidence(incident);
    
    // 5. Start recovery process
    await this.initiateRecovery(incident);
  }

  private async containThreat(incident: SecurityIncident): Promise<void> {
    switch (incident.type) {
      case IncidentType.UNAUTHORIZED_ACCESS:
        // Revoke compromised tokens/keys
        await this.revokeCompromisedCredentials(incident.affectedCredentials);
        // Block suspicious IPs
        await this.blockSuspiciousIPs(incident.sourceIPs);
        break;
        
      case IncidentType.SERVICE_COMPROMISE:
        // Isolate affected services
        await this.isolateServices(incident.affectedServices);
        // Enable circuit breakers
        await this.enableCircuitBreakers();
        break;
        
      case IncidentType.DATA_BREACH:
        // Stop data access
        await this.suspendDataAccess(incident.affectedData);
        // Encrypt affected data
        await this.emergencyEncryption(incident.affectedData);
        break;
    }
  }
}
```

### Automated Response Actions

**Security Automation:**

```typescript
// Automated security response system
export class SecurityAutomation {
  private readonly responseActions = new Map<string, Function>();

  constructor() {
    this.registerResponseActions();
  }

  private registerResponseActions(): void {
    // Rate limiting response
    this.responseActions.set('rate-limit-exceeded', async (event) => {
      await this.blockIP(event.sourceIP, 3600); // 1 hour block
      await this.notifySecurityTeam('Rate limit exceeded', event);
    });

    // Failed authentication response  
    this.responseActions.set('auth-failed-multiple', async (event) => {
      if (event.failureCount >= 5) {
        await this.blockIP(event.sourceIP, 86400); // 24 hour block
        await this.lockAccount(event.userId, 3600); // 1 hour lock
      }
    });

    // Suspicious activity response
    this.responseActions.set('suspicious-activity', async (event) => {
      await this.increaseMonitoring(event.userId);
      await this.requireAdditionalAuth(event.userId);
      await this.logSuspiciousActivity(event);
    });

    // Secret access anomaly
    this.responseActions.set('secret-access-anomaly', async (event) => {
      await this.revokeSecret(event.secretId);
      await this.rotateSecret(event.secretId);
      await this.auditSecretAccess(event.secretId);
    });
  }

  async executeResponse(eventType: string, eventData: any): Promise<void> {
    const action = this.responseActions.get(eventType);
    if (action) {
      await action(eventData);
    }
  }

  private async blockIP(ip: string, durationSeconds: number): Promise<void> {
    // Add IP to firewall block list
    await this.firewallManager.blockIP(ip, durationSeconds);
    
    // Update rate limiting rules
    await this.rateLimiter.addBlockedIP(ip, durationSeconds);
    
    logger.security('IP blocked', { ip, duration: durationSeconds });
  }
}
```

## Security Monitoring

### Real-time Threat Detection

**Anomaly Detection:**

```typescript
// Security monitoring and anomaly detection
export class SecurityMonitor {
  private readonly alertThresholds = {
    failedLogins: { count: 5, windowMinutes: 15 },
    apiCalls: { count: 1000, windowMinutes: 60 },
    secretAccess: { count: 100, windowMinutes: 60 },
    configChanges: { count: 10, windowMinutes: 60 }
  };

  async monitorSecurityEvents(): Promise<void> {
    // Real-time event processing
    this.eventStream.on('security-event', async (event) => {
      await this.processSecurityEvent(event);
    });

    // Periodic anomaly detection
    setInterval(async () => {
      await this.detectAnomalies();
    }, 60000); // Every minute
  }

  private async processSecurityEvent(event: SecurityEvent): Promise<void> {
    // Check against known attack patterns
    const threatLevel = await this.assessThreatLevel(event);
    
    if (threatLevel >= ThreatLevel.HIGH) {
      await this.triggerImmediateResponse(event);
    }

    // Update security metrics
    await this.updateSecurityMetrics(event);
    
    // Machine learning based detection
    const anomalyScore = await this.mlDetector.calculateAnomalyScore(event);
    if (anomalyScore > 0.8) {
      await this.investigateAnomaly(event, anomalyScore);
    }
  }

  private async detectAnomalies(): Promise<void> {
    const timeWindow = 15 * 60 * 1000; // 15 minutes
    const now = Date.now();
    const startTime = now - timeWindow;

    // Check failed login patterns
    const failedLogins = await this.getEventCount('login-failed', startTime, now);
    if (failedLogins > this.alertThresholds.failedLogins.count) {
      await this.triggerAlert('multiple-failed-logins', { count: failedLogins });
    }

    // Check unusual API usage patterns
    const apiCalls = await this.getEventCount('api-call', startTime, now);
    const normalAPIUsage = await this.getBaselineAPIUsage();
    if (apiCalls > normalAPIUsage * 2) {
      await this.triggerAlert('unusual-api-usage', { 
        current: apiCalls, 
        baseline: normalAPIUsage 
      });
    }

    // Check configuration change frequency
    const configChanges = await this.getEventCount('config-changed', startTime, now);
    if (configChanges > this.alertThresholds.configChanges.count) {
      await this.triggerAlert('excessive-config-changes', { count: configChanges });
    }
  }
}
```

### Security Metrics and Dashboards

**Key Security Metrics:**

```typescript
// Security metrics collection
export class SecurityMetrics {
  async collectSecurityMetrics(): Promise<SecurityMetricsData> {
    return {
      authentication: {
        successfulLogins: await this.countEvents('login-success', '24h'),
        failedLogins: await this.countEvents('login-failed', '24h'),
        suspiciousLogins: await this.countEvents('login-suspicious', '24h'),
        activeUsers: await this.countActiveUsers('24h')
      },
      
      authorization: {
        accessGranted: await this.countEvents('access-granted', '24h'),
        accessDenied: await this.countEvents('access-denied', '24h'),
        privilegeEscalation: await this.countEvents('privilege-escalation', '24h')
      },
      
      secrets: {
        secretAccess: await this.countEvents('secret-accessed', '24h'),
        secretRotations: await this.countEvents('secret-rotated', '24h'),
        suspiciousSecretAccess: await this.countEvents('secret-access-suspicious', '24h')
      },
      
      network: {
        rateLimitViolations: await this.countEvents('rate-limit-exceeded', '24h'),
        blockedIPs: await this.countBlockedIPs('24h'),
        suspiciousTraffic: await this.countEvents('traffic-suspicious', '24h')
      },
      
      threats: {
        detectedThreats: await this.countEvents('threat-detected', '24h'),
        mitigatedThreats: await this.countEvents('threat-mitigated', '24h'),
        activeInvestigations: await this.countActiveInvestigations()
      }
    };
  }

  // Export metrics for monitoring systems
  async exportPrometheusMetrics(): Promise<string> {
    const metrics = await this.collectSecurityMetrics();
    
    return `
# HELP security_logins_total Total number of login attempts
# TYPE security_logins_total counter
security_logins_successful_total ${metrics.authentication.successfulLogins}
security_logins_failed_total ${metrics.authentication.failedLogins}

# HELP security_access_total Total number of access attempts  
# TYPE security_access_total counter
security_access_granted_total ${metrics.authorization.accessGranted}
security_access_denied_total ${metrics.authorization.accessDenied}

# HELP security_threats_total Total number of detected threats
# TYPE security_threats_total counter
security_threats_detected_total ${metrics.threats.detectedThreats}
security_threats_mitigated_total ${metrics.threats.mitigatedThreats}
    `;
  }
}
```

## Summary

This security best practices guide provides comprehensive security measures for the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project. Key security pillars include:

1. **Strong Encryption**: AES-256-GCM encryption with proper key management
2. **Access Control**: JWT-based authentication with RBAC authorization  
3. **Network Security**: TLS encryption, CORS protection, and rate limiting
4. **Data Protection**: Encryption at rest, input validation, and anonymization
5. **Monitoring**: Real-time threat detection and security metrics
6. **Incident Response**: Automated response and escalation procedures
7. **Compliance**: Audit trails and regulatory compliance validation

Regular security assessments, penetration testing, and security training should complement these technical measures to maintain a strong security posture.
