# 1inch Fusion+ Cross-Chain Configuration Management

## Overview

This documentation covers the comprehensive configuration management system for the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project. The system provides production-grade configuration management with secure secrets handling, environment-specific settings, and operational readiness features.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [System Architecture](#system-architecture)
3. [Documentation Structure](#documentation-structure)
4. [Configuration Components](#configuration-components)
5. [Security Features](#security-features)
6. [Validation and Testing](#validation-and-testing)
7. [Deployment Process](#deployment-process)
8. [Operational Procedures](#operational-procedures)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Docker and Kubernetes (for production)
- Access to required blockchain networks
- Database server (PostgreSQL recommended)

### Initial Setup

1. **Clone and Install Dependencies:**

```bash
git clone <repository-url>
cd fusion-bitcoin-bridge
npm install
```

2. **Configure Environment:**

```bash
# Copy environment template
cp .env.example .env.development

# Edit with your configuration
vim .env.development
```

3. **Set Up Secrets:**

```bash
# Initialize secrets manager
npm run secrets:init

# Encrypt sensitive values
npm run secrets:encrypt "your-secret-value"
```

4. **Validate Configuration:**

```bash
# Run comprehensive validation
npm run validate-config development

# Check deployment readiness
npm run deployment-readiness development
```

5. **Start Services:**

```bash
# Development mode
npm run dev

# Production mode
npm run start
```

### Environment Variables

**Required Environment Variables:**

```env
# Application
NODE_ENV=development
APP_NAME=fusion-bitcoin-bridge
LOG_LEVEL=info

# Blockchain
ETH_NETWORK=goerli
ETH_RPC_URL=https://goerli.infura.io/v3/YOUR_KEY
BTC_NETWORK=testnet
BTC_RPC_URL=https://btc-testnet.example.com

# Security
SECRETS_ENCRYPTION_KEY=your-encryption-key
JWT_SECRET=encrypted:your-jwt-secret
```

See [`.env.example`](../.env.example) for complete configuration template.

## 🏗️ System Architecture

### Configuration Hierarchy

```
📁 Configuration System
├── 🔧 Root Configuration
│   ├── .env.example (182 variables)
│   └── config/index.ts (main loader)
│
├── 🌍 Environment-Specific
│   ├── config/environments/development.ts
│   ├── config/environments/staging.ts
│   └── config/environments/production.ts
│
├── 🔐 Secrets Management
│   ├── config/secrets/ (encryption, rotation, validation)
│   └── Multi-provider support (env, file, vault, cloud)
│
├── 🛡️ Security & Operations
│   ├── config/security/ (HTTPS, CORS, auth, threats)
│   └── config/operational/ (health, circuit breakers, backups)
│
├── 📦 Component-Specific
│   ├── contracts/ (network configs, deployment)
│   ├── backend/ (services, database, APIs)
│   └── frontend/ (Vite integration, features)
│
└── 🔍 Validation & Scripts
    ├── scripts/validate-config.ts
    ├── scripts/health-check.ts
    └── scripts/deployment-readiness.ts
```

### Core Components

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **Configuration Loader** | Type-safe loading with validation | Environment detection, fallbacks, error handling |
| **Secrets Manager** | Encrypted secrets with rotation | AES-256-GCM, key versioning, audit logging |
| **Environment Manager** | Environment-specific overrides | Development, staging, production configs |
| **Validator** | Configuration validation | Syntax, connectivity, security, consistency |
| **Health Monitor** | Runtime health and metrics | Service status, dependencies, performance |

## 📚 Documentation Structure

### Core Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| **[Configuration Management](./configuration-management.md)** | Complete configuration guide | Developers, DevOps |
| **[Security Best Practices](./security-best-practices.md)** | Security implementation guide | Security teams, Developers |
| **[Deployment Procedures](./deployment-procedures.md)** | Step-by-step deployment guide | DevOps, Operations |

### API Documentation

| Document | Description |
|----------|-------------|
| **[Configuration API](./api/configuration.md)** | Configuration system API reference |
| **[Secrets API](./api/secrets.md)** | Secrets management API reference |
| **[Validation API](./api/validation.md)** | Validation and health check APIs |

### Examples and Tutorials

| Resource | Description |
|----------|-------------|
| **[Examples](../examples/)** | Code examples and usage patterns |
| **[Tutorials](./tutorials/)** | Step-by-step implementation guides |
| **[Templates](../templates/)** | Configuration templates and boilerplate |

## 🔧 Configuration Components

### Root-Level Configuration

**Main Configuration Loader:** [`config/index.ts`](../config/index.ts)

- Type-safe configuration loading
- Environment-specific overrides
- Validation and error handling
- Hot-reload support

**Environment Template:** [`.env.example`](../.env.example)

- 182 comprehensive environment variables
- Categorized by: application, blockchain, security, monitoring, etc.
- Production-ready defaults with development flexibility

### Component-Specific Configuration

#### Smart Contracts

- **Network Configuration:** [`contracts/config/networks.ts`](../contracts/config/networks.ts)
- **Deployment Management:** [`contracts/config/deployment.ts`](../contracts/config/deployment.ts)
- **Hardhat Integration:** [`contracts/hardhat.config.ts`](../contracts/hardhat.config.ts)

#### Backend Services

- **Service Configuration:** [`backend/config/index.ts`](../backend/config/index.ts)
- **Environment Variables:** [`backend/.env.example`](../backend/.env.example)
- **Database, API, and service settings**

#### Frontend Application

- **Vite Configuration:** [`frontend/src/config/index.ts`](../frontend/src/config/index.ts)
- **Environment Variables:** [`frontend/.env.example`](../frontend/.env.example)
- **Feature flags and runtime configuration**

## 🔐 Security Features

### Secrets Management

**Encryption Standards:**

- **Algorithm:** AES-256-GCM symmetric encryption
- **Key Management:** PBKDF2 with SHA-256, 100,000+ iterations
- **Provider Support:** Environment, files, Vault, AWS/GCP secrets

**Key Features:**

- ✅ Automated key rotation with versioning
- ✅ Access audit logging and monitoring
- ✅ Role-based access control
- ✅ Environment-specific secrets with inheritance
- ✅ Emergency key rotation procedures

### Security Controls

**Network Security:**

- HTTPS/TLS 1.2+ with strong cipher suites
- CORS protection with configurable origins
- Rate limiting with IP-based and user-based limits
- Request validation and sanitization

**Authentication & Authorization:**

- JWT-based authentication with short-lived tokens
- Role-based access control (RBAC) with granular permissions
- API key management with secure hashing
- Multi-factor authentication support

**Data Protection:**

- Encryption at rest for sensitive data
- Input validation and sanitization
- Data anonymization for logs and metrics
- PII protection and GDPR compliance

## ✅ Validation and Testing

### Configuration Validation

**Validation Script:** [`scripts/validate-config.ts`](../scripts/validate-config.ts)

```bash
# Run comprehensive validation
npm run validate-config production

# Category-specific validation
npm run validate-config --category security
npm run validate-config --category blockchain

# Export validation report
npm run validate-config --output validation-report.json
```

**Validation Categories:**

- ✅ Syntax validation (JSON, YAML, environment variables)
- ✅ Type validation (TypeScript interfaces, schema validation)
- ✅ Connectivity validation (databases, APIs, blockchain nodes)
- ✅ Security validation (encryption, certificates, access controls)
- ✅ Cross-component consistency validation

### Health Monitoring

**Health Check Script:** [`scripts/health-check.ts`](../scripts/health-check.ts)

```bash
# Complete health assessment
npm run health-check

# Service-specific checks
npm run health-check --service database
npm run health-check --service blockchain

# Continuous monitoring
npm run health-check --watch --interval 30
```

**Health Check Categories:**

- 🏥 Service availability and response times
- 💾 Database connectivity and performance
- 🔗 External dependencies (blockchain nodes, APIs)
- 💻 System resources (memory, CPU, disk)
- 🔒 Security controls and access validation

### Deployment Readiness

**Readiness Assessment:** [`scripts/deployment-readiness.ts`](../scripts/deployment-readiness.ts)

```bash
# Production deployment readiness
npm run deployment-readiness production

# Detailed assessment with recommendations
npm run deployment-readiness production --verbose

# JSON report for CI/CD integration
npm run deployment-readiness production --json
```

**Assessment Categories:**

- 🚀 Environment-specific requirements validation
- 🛡️ Production security compliance
- ⚡ Performance and resource optimization
- 📊 Monitoring and alerting setup
- 🔄 Backup and disaster recovery readiness

## 🚢 Deployment Process

### Pre-Deployment Checklist

1. **Configuration Validation**

   ```bash
   npm run validate-config production
   npm run deployment-readiness production
   ```

2. **Security Validation**

   ```bash
   npm audit --audit-level moderate
   npm run security:scan
   npm run security:encryption-test
   ```

3. **Testing**

   ```bash
   npm run test:all
   npm run test:integration
   npm run test:e2e
   ```

4. **Build and Package**

   ```bash
   npm run build:production
   docker build -t fusion-bitcoin:${VERSION} .
   ```

### Environment-Specific Deployment

#### Development

```bash
export NODE_ENV=development
npm run dev
npm run health-check development
```

#### Staging

```bash
export NODE_ENV=staging
./scripts/deploy-staging.sh
npm run test:staging
npm run deployment-readiness staging
```

#### Production

```bash
export NODE_ENV=production
npm run deployment-readiness production
./scripts/deploy-production.sh
npm run verify-production-deployment
```

### Post-Deployment Verification

1. **Health Checks:** Service availability and response times
2. **Functional Tests:** Critical user flows and integrations
3. **Performance Tests:** Load testing and resource monitoring
4. **Security Tests:** Authentication, authorization, and encryption

## 🔧 Operational Procedures

### Routine Maintenance

**Daily:**

- Monitor health check dashboards
- Review security logs and alerts
- Check system resource utilization

**Weekly:**

- Run configuration validation
- Update dependencies and security patches
- Rotate logs and cleanup temporary files
- Review and update documentation

**Monthly:**

- Rotate secrets and encryption keys
- Security audit and penetration testing
- Disaster recovery testing
- Performance optimization review

### Monitoring and Alerting

**Key Metrics:**

- Application response times and error rates
- Database performance and connection pools
- Memory and CPU utilization
- Security events and threat detection
- Business metrics (transaction volume, success rates)

**Alert Configuration:**

- Critical: Service downtime, security breaches
- High: Performance degradation, failed authentications
- Medium: Resource warnings, external dependency issues
- Low: Configuration changes, maintenance notifications

### Backup and Recovery

**Automated Backups:**

- Database backups every 6 hours
- Configuration backups daily
- Application state snapshots
- Cross-region replication for disaster recovery

**Recovery Procedures:**

- Automated rollback for failed deployments
- Point-in-time database recovery
- Configuration rollback with version control
- Disaster recovery with RTO < 4 hours

## 🔍 Troubleshooting

### Common Issues and Solutions

#### Configuration Loading Errors

```bash
# Debug configuration loading
export CONFIG_DEBUG=true
npm run debug:config

# Check environment variables
printenv | grep FUSION_

# Validate syntax
npm run validate-config --syntax-only
```

#### Database Connection Issues

```bash
# Test connectivity
pg_isready -h $DB_HOST -p $DB_PORT

# Debug connection pool
npm run debug:db-connections

# Check credentials
psql "postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" -c "SELECT 1;"
```

#### Secrets Decryption Errors

```bash
# Verify encryption key
echo $SECRETS_ENCRYPTION_KEY | wc -c

# Test secrets manager
npm run secrets:test

# Check provider configuration
npm run validate-config --category secrets
```

### Support Resources

- **Documentation:** Complete guides and API references
- **Examples:** Working code examples and templates
- **Scripts:** Validation, health checks, and debugging utilities
- **Monitoring:** Real-time dashboards and alerting

## 🤝 Contributing

### Development Workflow

1. **Setup Development Environment:**

   ```bash
   git clone <repository>
   npm install
   cp .env.example .env.development
   npm run validate-config development
   ```

2. **Make Changes:**
   - Follow TypeScript coding standards
   - Update tests for new features
   - Validate configuration changes

3. **Test Changes:**

   ```bash
   npm run test:all
   npm run lint
   npm run validate-config
   ```

4. **Submit Pull Request:**
   - Include comprehensive tests
   - Update documentation
   - Validate security implications

### Configuration Best Practices

1. **Environment Variables:**
   - Use descriptive names with consistent prefixes
   - Provide sensible defaults for development
   - Document all variables in `.env.example`

2. **Secrets Management:**
   - Never commit secrets to version control
   - Use encryption for all sensitive data
   - Implement proper access controls and audit logging

3. **Validation:**
   - Add validation for new configuration options
   - Include both positive and negative test cases
   - Validate cross-component consistency

4. **Documentation:**
   - Keep documentation current with code changes
   - Include examples and common usage patterns
   - Document security implications and best practices

## 📊 Configuration Statistics

| Component | Files | Variables | Features |
|-----------|-------|-----------|----------|
| **Root Configuration** | 4 files | 182 variables | Type-safe loading, validation |
| **Secrets Management** | 3 files | 25 variables | Encryption, rotation, audit |
| **Security Controls** | 2 files | 35 variables | HTTPS, CORS, auth, threats |
| **Contracts Config** | 3 files | 28 variables | Networks, deployment, Hardhat |
| **Backend Services** | 2 files | 232 variables | APIs, database, monitoring |
| **Frontend Config** | 2 files | 188 variables | Vite integration, features |
| **Validation Scripts** | 3 files | - | 750+ validation checks |

**Total:** 19 configuration files, 690+ environment variables, comprehensive validation and security features.

## 📚 Additional Resources

### External Documentation

- [Node.js Configuration Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Kubernetes Configuration Management](https://kubernetes.io/docs/concepts/configuration/)
- [HashiCorp Vault Documentation](https://www.vaultproject.io/docs)

### Related Projects

- [1inch API Documentation](https://docs.1inch.io/)
- [Hardhat Configuration](https://hardhat.org/config/)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

---

**Last Updated:** January 2024  
**Version:** 1.0.0  
**Maintainer:** Fusion Bitcoin Bridge Team

For questions or support, please refer to the troubleshooting guides or contact the development team.
