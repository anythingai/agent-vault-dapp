# Configuration Management Guide

## Overview

The 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project uses a comprehensive configuration management system designed for production-grade deployments. This system provides:

- **Environment-specific configurations** (development, staging, production)
- **Type-safe configuration loading** with validation
- **Secure secrets management** with encryption and key rotation
- **Operational readiness** with health checks and monitoring
- **Cross-component consistency** across contracts, backend, and frontend

## Table of Contents

1. [Architecture](#architecture)
2. [Environment Configuration](#environment-configuration)
3. [Secrets Management](#secrets-management)
4. [Component Configuration](#component-configuration)
5. [Validation and Health Checks](#validation-and-health-checks)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

## Architecture

### Configuration Hierarchy

```
├── .env.example                    # Root environment template (182 variables)
├── config/
│   ├── index.ts                   # Main configuration loader
│   ├── environments/              # Environment-specific configs
│   │   ├── development.ts
│   │   ├── staging.ts
│   │   └── production.ts
│   ├── secrets/                   # Secrets management
│   │   ├── index.ts              # Core secrets manager
│   │   ├── key-rotation.ts       # Key rotation system
│   │   └── validation.ts         # Secrets validation
│   ├── operational/              # Operational configurations
│   │   └── index.ts
│   └── security/                 # Security configurations
│       └── index.ts
├── contracts/
│   ├── .env.example              # Contract-specific variables
│   ├── config/
│   │   ├── networks.ts           # Network configurations
│   │   └── deployment.ts         # Deployment management
│   └── hardhat.config.ts         # Enhanced Hardhat config
├── backend/
│   ├── .env.example              # Backend variables (232 vars)
│   └── config/
│       └── index.ts              # Backend configuration
└── frontend/
    ├── .env.example              # Frontend variables (188 vars)
    └── src/config/
        └── index.ts              # Frontend configuration
```

### Core Components

1. **Configuration Loader** ([`config/index.ts`](../config/index.ts)): Type-safe loading with validation
2. **Environment Manager**: Environment-specific overrides and defaults
3. **Secrets Manager**: Encrypted storage, rotation, and access control
4. **Validator**: Comprehensive configuration validation across components
5. **Health Monitor**: Runtime health checks and system metrics

## Environment Configuration

### Environment Variables Structure

The system uses a hierarchical environment variable structure with the following categories:

#### Core Application (45 variables)

```env
# Application Identity
APP_NAME=1inch-fusion-bitcoin-bridge
APP_VERSION=1.0.0
NODE_ENV=production
LOG_LEVEL=info

# Network Configuration
RELAYER_PORT=3000
RESOLVER_PORT=3001
FRONTEND_PORT=3002
METRICS_PORT=9090
```

#### Blockchain Configuration (38 variables)

```env
# Ethereum Configuration
ETH_NETWORK=mainnet
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_PRIVATE_KEY=encrypted:abcd1234...
ETH_GAS_LIMIT=300000
ETH_GAS_PRICE_MULTIPLIER=1.2

# Bitcoin Configuration
BTC_NETWORK=mainnet
BTC_RPC_URL=https://btc.getblock.io/YOUR_KEY/mainnet/
BTC_PRIVATE_KEY=encrypted:efgh5678...
BTC_CONFIRMATION_BLOCKS=6
```

#### Security Configuration (35 variables)

```env
# Authentication & Authorization
JWT_SECRET=encrypted:ijkl9012...
JWT_EXPIRY=24h
SESSION_SECRET=encrypted:mnop3456...
API_SECRET_KEY=encrypted:qrst7890...

# HTTPS/TLS
HTTPS_ENABLED=true
TLS_CERT_PATH=/etc/ssl/certs/app.crt
TLS_KEY_PATH=/etc/ssl/private/app.key
TLS_CA_PATH=/etc/ssl/certs/ca.crt
```

### Environment-Specific Configuration

#### Development Environment

```typescript
// config/environments/development.ts
export const developmentConfig = {
  app: {
    logLevel: 'debug',
    corsEnabled: true,
    corsOrigins: ['http://localhost:3000']
  },
  blockchain: {
    eth: {
      network: 'goerli',
      confirmationBlocks: 1
    },
    btc: {
      network: 'testnet',
      confirmationBlocks: 1
    }
  },
  security: {
    httpsEnabled: false,
    rateLimiting: {
      enabled: false
    }
  }
};
```

#### Production Environment

```typescript
// config/environments/production.ts
export const productionConfig = {
  app: {
    logLevel: 'error',
    corsEnabled: true,
    corsOrigins: process.env.ALLOWED_ORIGINS?.split(',') || []
  },
  security: {
    httpsEnabled: true,
    rateLimiting: {
      enabled: true,
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000
    },
    csrfProtection: true
  }
};
```

### Configuration Loading

```typescript
import { loadConfiguration } from './config';

// Load configuration for current environment
const config = await loadConfiguration();

// Access configuration values
const ethRpcUrl = config.blockchain.eth.rpcUrl;
const jwtSecret = config.security.jwtSecret;
const logLevel = config.app.logLevel;

// Validate configuration
if (!config.isValid) {
  console.error('Configuration validation failed:', config.errors);
  process.exit(1);
}
```

## Secrets Management

### Overview

The secrets management system provides:

- **AES-256-GCM encryption** for sensitive data
- **Multiple provider support** (environment, files, Vault, cloud)
- **Automated key rotation** with versioning
- **Access audit logging** for compliance
- **Environment-specific secrets** with inheritance

### Core Features

#### 1. Encryption and Decryption

```typescript
import { SecretsManager } from './config/secrets';

const secrets = new SecretsManager({
  provider: 'vault', // or 'env', 'file', 'aws', 'gcp'
  encryptionKey: process.env.SECRETS_ENCRYPTION_KEY,
  auditLogging: true
});

// Store encrypted secret
await secrets.setSecret('jwt-secret', 'your-secret-value');

// Retrieve and decrypt secret
const jwtSecret = await secrets.getSecret('jwt-secret');

// List all secrets (metadata only)
const secretsList = await secrets.listSecrets();
```

#### 2. Key Rotation

```typescript
import { KeyRotationManager } from './config/secrets/key-rotation';

const rotationManager = new KeyRotationManager({
  rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
  retentionPeriod: 90 * 24 * 60 * 60 * 1000,  // 90 days
  auditLogging: true
});

// Rotate all keys
await rotationManager.rotateKeys();

// Schedule automatic rotation
rotationManager.scheduleRotation();
```

#### 3. Access Control and Auditing

```typescript
// All secret access is logged
const secret = await secrets.getSecret('api-key', {
  requestId: 'req-123',
  userId: 'user-456',
  component: 'relayer-service'
});

// Audit log entry:
// {
//   timestamp: '2024-01-01T10:00:00Z',
//   action: 'secret-accessed',
//   secretId: 'api-key',
//   requestId: 'req-123',
//   userId: 'user-456',
//   component: 'relayer-service',
//   success: true
// }
```

### Secrets Configuration

#### Environment Variables with Encryption

```env
# Encrypted secrets (prefixed with 'encrypted:')
ETH_PRIVATE_KEY=encrypted:AES256:abcd1234567890...
JWT_SECRET=encrypted:AES256:efgh5678901234...
DB_PASSWORD=encrypted:AES256:ijkl9012345678...

# Encryption configuration
SECRETS_PROVIDER=vault
SECRETS_ENCRYPTION_KEY=your-master-key
SECRETS_AUDIT_LOGGING=true
SECRETS_KEY_ROTATION_ENABLED=true
```

#### Vault Integration

```env
# HashiCorp Vault configuration
VAULT_URL=https://vault.company.com
VAULT_TOKEN=your-vault-token
VAULT_NAMESPACE=fusion-bitcoin
VAULT_SECRET_PATH=secret/fusion-bitcoin
VAULT_TRANSIT_KEY=fusion-encryption-key
```

#### Cloud Provider Integration

```env
# AWS Secrets Manager
AWS_REGION=us-east-1
AWS_SECRETS_MANAGER_ENDPOINT=https://secretsmanager.us-east-1.amazonaws.com
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Google Secret Manager
GCP_PROJECT_ID=your-project-id
GCP_CREDENTIALS_PATH=/path/to/service-account.json
```

## Component Configuration

### Contracts Configuration

The contracts configuration manages network settings, deployment parameters, and Hardhat integration.

#### Network Configuration

```typescript
// contracts/config/networks.ts
export const networks = {
  mainnet: {
    chainId: 1,
    rpcUrl: process.env.ETH_MAINNET_RPC_URL!,
    gasPrice: 'auto',
    gasMultiplier: 1.2,
    timeout: 60000,
    contracts: {
      fusionResolver: '0x...',
      bitcoinBridge: '0x...'
    }
  },
  goerli: {
    chainId: 5,
    rpcUrl: process.env.ETH_GOERLI_RPC_URL!,
    gasPrice: 'auto',
    gasMultiplier: 1.5,
    timeout: 120000
  }
};
```

#### Deployment Management

```typescript
// contracts/config/deployment.ts
export const deploymentConfig = {
  networks: ['mainnet', 'goerli'],
  verification: {
    etherscan: true,
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  deployment: {
    confirmations: 2,
    timeout: 300000,
    retries: 3
  }
};
```

### Backend Services Configuration

The backend configuration provides type-safe loading for all backend services.

```typescript
// backend/config/index.ts
import { loadBackendConfig } from './index';

const config = await loadBackendConfig();

// Server configuration
const server = {
  port: config.server.port,
  host: config.server.host,
  corsOrigins: config.server.corsOrigins
};

// Database configuration
const database = {
  type: config.database.type,
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  username: config.database.username,
  password: await secrets.getSecret('db-password')
};
```

### Frontend Configuration

The frontend configuration integrates with Vite and provides runtime configuration.

```typescript
// frontend/src/config/index.ts
import { loadFrontendConfig } from './index';

const config = loadFrontendConfig();

// API configuration
const api = {
  baseUrl: config.api.baseUrl,
  timeout: config.api.timeout,
  retries: config.api.retries
};

// Feature flags
const features = {
  darkMode: config.features.darkMode,
  advancedTrading: config.features.advancedTrading,
  notifications: config.features.notifications
};
```

## Validation and Health Checks

### Configuration Validation

The system includes comprehensive validation scripts that check:

1. **Syntax validation**: Proper format and structure
2. **Connectivity validation**: Network and service availability  
3. **Security validation**: Compliance with security requirements
4. **Cross-component consistency**: Consistent settings across components

#### Running Validation

```bash
# Validate all configurations
npm run validate-config

# Validate specific environment
npm run validate-config production

# Validate with verbose output
npm run validate-config production --verbose

# Export validation report
npm run validate-config production --output report.json
```

#### Validation Output

```
🔍 Configuration Validation Report
=====================================
🎯 Environment: production
📅 Timestamp: 2024-01-01T10:00:00Z

📊 SUMMARY
----------
✅ Passed: 45/50 checks
❌ Failed: 3/50 checks  
⚠️  Warnings: 2/50 checks

🚨 CRITICAL ISSUES
------------------
❌ [security] Missing JWT_SECRET in production
❌ [blockchain] ETH_PRIVATE_KEY not encrypted
❌ [database] Database password using default value

⚠️  WARNINGS
-----------  
⚠️  [monitoring] Sentry DSN not configured
⚠️  [backup] Automated backups disabled

💡 RECOMMENDATIONS
------------------
1. Set JWT_SECRET environment variable with strong random value
2. Encrypt ETH_PRIVATE_KEY using secrets manager
3. Configure database password with secure value
4. Enable Sentry error tracking for production monitoring
5. Configure automated backup system
```

### Health Checks

The health check system monitors:

- **Service availability**: All services responding correctly
- **Database connectivity**: Database connections and query performance
- **External dependencies**: Blockchain nodes, APIs, and third-party services
- **System resources**: Memory, CPU, and disk usage
- **Configuration validity**: Real-time configuration validation

#### Running Health Checks

```bash
# Run complete health check
npm run health-check

# Check specific service
npm run health-check --service relayer

# Continuous monitoring mode
npm run health-check --watch --interval 30

# Export health report
npm run health-check --output health-report.json
```

### Deployment Readiness

The deployment readiness script performs comprehensive pre-deployment validation:

```bash
# Check production deployment readiness
npm run deployment-readiness production

# Check with detailed output
npm run deployment-readiness production --verbose

# Generate JSON report
npm run deployment-readiness production --json > readiness-report.json
```

## Best Practices

### 1. Environment Variable Management

**✅ Do:**

- Use `.env.example` files to document required variables
- Never commit actual `.env` files to version control
- Use environment-specific prefixes (DEV_, STAGING_, PROD_)
- Validate all required variables at startup

**❌ Don't:**

- Store secrets in plain text environment variables
- Use default values for sensitive configuration in production
- Mix development and production configurations

### 2. Secrets Management

**✅ Do:**

- Encrypt all sensitive data using the secrets manager
- Rotate keys regularly (recommended: 30-90 days)
- Enable audit logging for all secret access
- Use different secrets for different environments

**❌ Don't:**

- Store secrets in configuration files
- Share secrets between environments
- Log secret values in application logs
- Use weak encryption keys

### 3. Configuration Validation

**✅ Do:**

- Validate configuration at application startup
- Use type-safe configuration loading
- Check external dependencies during validation
- Fail fast on critical configuration errors

**❌ Don't:**

- Skip validation in production
- Continue running with invalid configuration
- Ignore validation warnings
- Use string concatenation for configuration paths

### 4. Environment Separation

**✅ Do:**

- Maintain separate configurations for each environment
- Use infrastructure as code for consistent environments
- Document environment-specific requirements
- Test configuration changes in staging first

**❌ Don't:**

- Use production configuration in development
- Modify production configuration directly
- Skip environment-specific testing
- Use shared resources between environments

### 5. Monitoring and Alerting

**✅ Do:**

- Monitor configuration changes
- Set up alerts for configuration validation failures
- Track configuration usage metrics
- Monitor external dependency health

**❌ Don't:**

- Deploy without monitoring
- Ignore configuration-related alerts
- Skip dependency health checks
- Use monitoring credentials in application logs

## Troubleshooting

### Common Issues

#### 1. Configuration Loading Failures

**Problem:** Configuration fails to load with type errors

**Solution:**

```bash
# Check environment variables
npm run validate-config --verbose

# Verify type definitions
npx tsc --noEmit

# Check for missing dependencies
npm install
```

#### 2. Secrets Decryption Errors

**Problem:** Cannot decrypt secrets or "invalid encryption key" errors

**Solution:**

```bash
# Verify encryption key is set
echo $SECRETS_ENCRYPTION_KEY

# Test secrets manager
node -e "
const { SecretsManager } = require('./config/secrets');
const sm = new SecretsManager();
sm.getSecret('test').catch(console.error);
"

# Check secrets provider configuration
npm run validate-config --category secrets
```

#### 3. Network Connectivity Issues

**Problem:** Blockchain RPC or external API connections fail

**Solution:**

```bash
# Test network connectivity
npm run health-check --service connectivity

# Check RPC URLs
curl -X POST $ETH_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# Verify API keys
npm run validate-config --category external
```

#### 4. Port Conflicts

**Problem:** Services cannot start due to port conflicts

**Solution:**

```bash
# Check port usage
netstat -tulpn | grep :3000

# Validate port configuration
npm run validate-config --category services

# Update port configuration
export RELAYER_PORT=3010
export RESOLVER_PORT=3011
```

#### 5. Database Connection Issues

**Problem:** Cannot connect to database

**Solution:**

```bash
# Test database connectivity
npm run health-check --service database

# Check database configuration
echo $DB_HOST $DB_PORT $DB_NAME

# Test database credentials
psql "postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" -c "SELECT 1;"
```

### Debug Mode

Enable debug logging for troubleshooting:

```bash
# Set debug log level
export LOG_LEVEL=debug
export DEBUG=config:*,secrets:*

# Run with debug output
npm start
```

### Configuration Debugging

```typescript
// Enable configuration debugging
process.env.CONFIG_DEBUG = 'true';
process.env.LOG_LEVEL = 'debug';

// Load configuration with debug info
const config = await loadConfiguration();

// Check configuration state
console.log('Configuration loaded:', config.isLoaded);
console.log('Validation errors:', config.errors);
console.log('Environment:', config.environment);
console.log('Sources:', config.sources);
```

### Log Analysis

```bash
# Search for configuration errors
grep -r "config.*error" logs/

# Check validation logs
grep -r "validation.*failed" logs/

# Monitor secrets access
grep -r "secret.*accessed" logs/audit/

# Check health check failures
grep -r "health.*check.*failed" logs/
```

## Advanced Topics

### Custom Configuration Providers

```typescript
// Implement custom configuration provider
import { ConfigurationProvider } from './config/types';

class CustomConfigProvider implements ConfigurationProvider {
  async load(environment: string): Promise<any> {
    // Custom loading logic
    return customConfig;
  }

  async validate(config: any): Promise<boolean> {
    // Custom validation logic
    return isValid;
  }
}

// Register custom provider
const config = await loadConfiguration({
  providers: [new CustomConfigProvider()]
});
```

### Configuration Middleware

```typescript
// Add configuration middleware
import { configurationMiddleware } from './config/middleware';

app.use(configurationMiddleware({
  reloadOnChange: true,
  validateOnAccess: true,
  auditAccess: true
}));
```

### Configuration Caching

```typescript
// Configure caching
const config = await loadConfiguration({
  cache: {
    enabled: true,
    ttl: 300000, // 5 minutes
    refreshOnExpiry: true
  }
});
```

## Support and Resources

- **Configuration Schema**: [`config/schema.ts`](../config/schema.ts)
- **Validation Scripts**: [`scripts/validate-config.ts`](../scripts/validate-config.ts)
- **Health Checks**: [`scripts/health-check.ts`](../scripts/health-check.ts)
- **Examples**: [`examples/configuration/`](../examples/configuration/)
- **API Documentation**: [`docs/api/configuration.md`](./api/configuration.md)

For additional support, check the troubleshooting section or contact the development team.
