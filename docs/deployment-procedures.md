# Deployment Procedures

## Overview

This document provides comprehensive deployment procedures for the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project. It covers pre-deployment validation, deployment steps, post-deployment verification, and rollback procedures for all environments.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment-Specific Procedures](#environment-specific-procedures)
3. [Deployment Steps](#deployment-steps)
4. [Post-Deployment Verification](#post-deployment-verification)
5. [Monitoring and Alerting](#monitoring-and-alerting)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Operational Procedures](#operational-procedures)

## Pre-Deployment Checklist

### 1. Configuration Validation

**Required Checks:**

```bash
# Run comprehensive configuration validation
npm run validate-config production

# Check deployment readiness
npm run deployment-readiness production --verbose

# Verify all environment variables
npm run validate-env production

# Test configuration loading
NODE_ENV=production npm run test:config
```

**Validation Requirements:**

- [ ] All required environment variables are set
- [ ] Secrets are properly encrypted and accessible
- [ ] Database connections are configured and tested
- [ ] External service endpoints are reachable
- [ ] SSL certificates are valid and not expiring soon
- [ ] Network configurations are correct for target environment

### 2. Security Validation

**Security Checklist:**

```bash
# Run security audit
npm audit --audit-level moderate

# Check for secrets in code
npm run security:scan

# Validate encryption configuration
npm run security:encryption-test

# Test access controls
npm run security:rbac-test
```

**Security Requirements:**

- [ ] No security vulnerabilities in dependencies
- [ ] All secrets are encrypted (no plain text)
- [ ] HTTPS is enabled with valid certificates
- [ ] Authentication and authorization are configured
- [ ] Rate limiting and CORS are properly set
- [ ] Audit logging is enabled and configured

### 3. Code Quality and Testing

**Quality Checks:**

```bash
# Run TypeScript compilation
npx tsc --noEmit

# Run all tests
npm run test:all

# Check test coverage
npm run test:coverage

# Run integration tests
npm run test:integration

# Lint code
npm run lint

# Check for code quality issues
npm run sonar:scan
```

**Quality Requirements:**

- [ ] All TypeScript compilation errors resolved
- [ ] Unit test coverage > 80%
- [ ] All integration tests passing
- [ ] No critical linting errors
- [ ] Code quality metrics meet standards
- [ ] Documentation is up to date

### 4. Infrastructure Validation

**Infrastructure Checklist:**

```bash
# Check Docker images
docker image ls | grep fusion-bitcoin

# Validate Kubernetes manifests
kubectl apply --dry-run=client -f k8s/

# Test database migrations
npm run db:migrate:dry-run

# Check resource requirements
kubectl describe nodes
```

**Infrastructure Requirements:**

- [ ] Docker images are built and tagged correctly
- [ ] Kubernetes manifests are valid
- [ ] Database migrations are ready and tested
- [ ] Sufficient compute and storage resources available
- [ ] Network policies and firewall rules configured
- [ ] Load balancer and ingress configured

### 5. External Dependencies

**Dependency Verification:**

```bash
# Test blockchain connectivity
npm run test:blockchain-connectivity

# Verify external APIs
npm run test:external-apis

# Check third-party service status
npm run check:service-status
```

**Dependency Requirements:**

- [ ] Ethereum RPC endpoints are accessible
- [ ] Bitcoin RPC endpoints are accessible
- [ ] 1inch API is available and responding
- [ ] Etherscan API keys are valid
- [ ] Database server is accessible
- [ ] Message queue/Redis is operational

## Environment-Specific Procedures

### Development Environment

**Development Deployment:**

```bash
# Set environment
export NODE_ENV=development

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start services in development mode
npm run dev

# Verify deployment
npm run health-check development
```

**Development Checklist:**

- [ ] Local blockchain nodes are running (optional)
- [ ] Test data is loaded
- [ ] Debug logging is enabled
- [ ] Hot reload is functional
- [ ] Development tools are accessible

### Staging Environment

**Staging Deployment:**

```bash
# Set environment
export NODE_ENV=staging

# Deploy to staging
./scripts/deploy-staging.sh

# Run staging-specific tests
npm run test:staging

# Verify deployment
npm run deployment-readiness staging
```

**Staging Checklist:**

- [ ] Environment mirrors production configuration
- [ ] Test data is representative but not production data
- [ ] All services are accessible
- [ ] Integration tests pass
- [ ] Performance tests meet baselines
- [ ] Security scans show no critical issues

### Production Environment

**Production Deployment:**

```bash
# Set environment  
export NODE_ENV=production

# Final pre-deployment validation
npm run deployment-readiness production

# Deploy to production
./scripts/deploy-production.sh

# Post-deployment verification
npm run verify-production-deployment
```

**Production Checklist:**

- [ ] All pre-deployment checks completed
- [ ] Production secrets are configured
- [ ] Monitoring and alerting are active
- [ ] Backup systems are operational
- [ ] Incident response team is notified
- [ ] Rollback plan is ready

## Deployment Steps

### 1. Application Deployment

**Step-by-Step Process:**

```bash
#!/bin/bash
# Production deployment script

set -e  # Exit on any error

echo "🚀 Starting production deployment..."

# 1. Pre-deployment validation
echo "📋 Running pre-deployment checks..."
npm run validate-config production
npm run deployment-readiness production

if [ $? -ne 0 ]; then
  echo "❌ Pre-deployment validation failed"
  exit 1
fi

# 2. Build application
echo "🔨 Building application..."
npm run build:production

# 3. Build Docker images
echo "🐳 Building Docker images..."
docker build -t fusion-bitcoin-relayer:${VERSION} -f docker/Dockerfile.relayer .
docker build -t fusion-bitcoin-resolver:${VERSION} -f docker/Dockerfile.resolver .
docker build -t fusion-bitcoin-frontend:${VERSION} -f docker/Dockerfile.frontend .

# 4. Tag and push images
echo "📤 Pushing Docker images..."
docker tag fusion-bitcoin-relayer:${VERSION} ${REGISTRY}/fusion-bitcoin-relayer:${VERSION}
docker tag fusion-bitcoin-resolver:${VERSION} ${REGISTRY}/fusion-bitcoin-resolver:${VERSION}
docker tag fusion-bitcoin-frontend:${VERSION} ${REGISTRY}/fusion-bitcoin-frontend:${VERSION}

docker push ${REGISTRY}/fusion-bitcoin-relayer:${VERSION}
docker push ${REGISTRY}/fusion-bitcoin-resolver:${VERSION}
docker push ${REGISTRY}/fusion-bitcoin-frontend:${VERSION}

# 5. Update Kubernetes manifests
echo "📝 Updating Kubernetes manifests..."
sed -i "s/{{VERSION}}/${VERSION}/g" k8s/*.yaml

# 6. Apply database migrations
echo "💾 Running database migrations..."
kubectl exec -it deployment/fusion-bitcoin-relayer -- npm run db:migrate

# 7. Deploy to Kubernetes
echo "☸️  Deploying to Kubernetes..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/services.yaml
kubectl apply -f k8s/deployments.yaml
kubectl apply -f k8s/ingress.yaml

# 8. Wait for rollout
echo "⏳ Waiting for deployment rollout..."
kubectl rollout status deployment/fusion-bitcoin-relayer -n fusion-bitcoin
kubectl rollout status deployment/fusion-bitcoin-resolver -n fusion-bitcoin
kubectl rollout status deployment/fusion-bitcoin-frontend -n fusion-bitcoin

# 9. Health check
echo "🏥 Running health checks..."
sleep 30  # Wait for services to start
npm run health-check production

if [ $? -eq 0 ]; then
  echo "✅ Deployment completed successfully!"
else
  echo "❌ Health check failed, initiating rollback..."
  ./scripts/rollback.sh
  exit 1
fi
```

### 2. Contract Deployment

**Smart Contract Deployment:**

```bash
#!/bin/bash
# Contract deployment script

cd contracts

# 1. Compile contracts
echo "🔨 Compiling contracts..."
npm run build

# 2. Run contract tests
echo "🧪 Running contract tests..."
npm run test

# 3. Deploy to target network
echo "🚀 Deploying contracts to ${NETWORK}..."
npx hardhat deploy --network ${NETWORK}

# 4. Verify contracts on Etherscan
echo "🔍 Verifying contracts..."
npx hardhat verify --network ${NETWORK} $(cat deployments/${NETWORK}/addresses.json | jq -r '.FusionResolver')
npx hardhat verify --network ${NETWORK} $(cat deployments/${NETWORK}/addresses.json | jq -r '.BitcoinBridge')

# 5. Update configuration
echo "📝 Updating contract addresses..."
cp deployments/${NETWORK}/addresses.json ../config/contract-addresses/${NETWORK}.json

cd ..
```

### 3. Database Migration

**Migration Process:**

```bash
#!/bin/bash
# Database migration script

echo "💾 Starting database migration..."

# 1. Backup current database
echo "📦 Creating database backup..."
pg_dump ${DATABASE_URL} > backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql

# 2. Test migrations on copy
echo "🧪 Testing migrations..."
npm run db:migrate:dry-run

# 3. Apply migrations
echo "🔄 Applying migrations..."
npm run db:migrate

# 4. Verify migration success
echo "✅ Verifying migrations..."
npm run db:verify

if [ $? -eq 0 ]; then
  echo "✅ Database migration completed successfully!"
else
  echo "❌ Migration failed, restoring backup..."
  psql ${DATABASE_URL} < backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql
  exit 1
fi
```

## Post-Deployment Verification

### 1. Health Checks

**Service Health Verification:**

```bash
# Comprehensive health check
npm run health-check production --verbose

# Service-specific checks
curl -f http://localhost:3000/health/relayer
curl -f http://localhost:3001/health/resolver  
curl -f http://localhost:3002/health/frontend

# Database connectivity
npm run health-check --service database

# External dependencies
npm run health-check --service external
```

**Expected Health Check Results:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T10:00:00Z",
  "services": {
    "relayer": { "status": "healthy", "responseTime": "45ms" },
    "resolver": { "status": "healthy", "responseTime": "38ms" },
    "frontend": { "status": "healthy", "responseTime": "22ms" },
    "database": { "status": "healthy", "connectionPool": "8/10" },
    "ethereum": { "status": "healthy", "blockNumber": 18500000 },
    "bitcoin": { "status": "healthy", "blockHeight": 815000 }
  }
}
```

### 2. Functional Testing

**End-to-End Testing:**

```bash
# Run post-deployment functional tests
npm run test:e2e:production

# Test critical user flows
npm run test:critical-flows

# Performance baseline tests
npm run test:performance

# Security validation
npm run test:security
```

**Test Scenarios:**

- [ ] User authentication and authorization
- [ ] Order creation and processing
- [ ] Cross-chain swap execution
- [ ] Error handling and recovery
- [ ] API rate limiting
- [ ] Data persistence and retrieval

### 3. Performance Verification

**Performance Benchmarks:**

```bash
# Load testing
npm run test:load

# Stress testing
npm run test:stress

# Memory and CPU monitoring
npm run monitor:resources

# Database performance
npm run test:db-performance
```

**Performance Criteria:**

- Response time < 200ms for 95% of requests
- Memory usage < 2GB per service
- CPU usage < 70% under normal load
- Database query time < 100ms average
- Concurrent users: 1000+ without degradation

### 4. Security Verification

**Security Testing:**

```bash
# Authentication tests
npm run test:auth

# Authorization tests  
npm run test:authz

# Input validation tests
npm run test:input-validation

# Encryption tests
npm run test:encryption
```

**Security Validation:**

- [ ] Authentication mechanisms working correctly
- [ ] Authorization rules enforced properly
- [ ] Input validation preventing injection attacks
- [ ] Secrets properly encrypted and inaccessible
- [ ] HTTPS redirect and security headers active
- [ ] Rate limiting functioning as configured

## Monitoring and Alerting

### 1. Monitoring Setup

**Monitoring Stack Configuration:**

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert-rules/*.yml"

scrape_configs:
  - job_name: 'fusion-bitcoin-relayer'
    static_configs:
      - targets: ['relayer:9090']
  
  - job_name: 'fusion-bitcoin-resolver' 
    static_configs:
      - targets: ['resolver:9091']

  - job_name: 'fusion-bitcoin-frontend'
    static_configs:
      - targets: ['frontend:9092']

alertmanager:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

**Key Metrics to Monitor:**

- Application response times and error rates
- Database connection pool and query performance
- Memory and CPU utilization
- Network I/O and external API response times
- Business metrics (orders processed, swap volume)
- Security events (failed logins, rate limit violations)

### 2. Alert Configuration

**Critical Alerts:**

```yaml
# monitoring/alerts/critical.yml
groups:
- name: critical
  rules:
  - alert: ServiceDown
    expr: up == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Service {{ $labels.instance }} is down"
      
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "High error rate on {{ $labels.instance }}"
      
  - alert: DatabaseConnectionsFull
    expr: pg_stat_activity_count >= pg_settings_max_connections * 0.9
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Database connection pool nearly full"

- name: security
  rules:
  - alert: TooManyFailedLogins
    expr: rate(security_logins_failed_total[5m]) > 10
    for: 1m
    labels:
      severity: high
    annotations:
      summary: "High number of failed login attempts"
      
  - alert: UnauthorizedAccess
    expr: rate(security_access_denied_total[5m]) > 50
    for: 30s
    labels:
      severity: high
    annotations:
      summary: "High number of unauthorized access attempts"
```

### 3. Dashboard Setup

**Grafana Dashboard Configuration:**

```json
{
  "dashboard": {
    "title": "1inch Fusion Bitcoin Bridge",
    "panels": [
      {
        "title": "Service Status",
        "type": "stat",
        "targets": [
          {
            "expr": "up{job=~\"fusion-bitcoin-.*\"}",
            "legendFormat": "{{ instance }}"
          }
        ]
      },
      {
        "title": "Request Rate",
        "type": "graph", 
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{ instance }}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "{{ instance }} errors"
          }
        ]
      },
      {
        "title": "Response Times",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      }
    ]
  }
}
```

## Rollback Procedures

### 1. Application Rollback

**Automated Rollback Script:**

```bash
#!/bin/bash
# Rollback script

set -e

PREVIOUS_VERSION=${1:-$(cat .previous-version)}

echo "🔄 Starting rollback to version ${PREVIOUS_VERSION}..."

# 1. Stop health checks
echo "⏸️  Stopping health checks..."
kubectl scale deployment/health-checker --replicas=0 -n fusion-bitcoin

# 2. Rollback Kubernetes deployments
echo "☸️  Rolling back Kubernetes deployments..."
kubectl rollout undo deployment/fusion-bitcoin-relayer -n fusion-bitcoin
kubectl rollout undo deployment/fusion-bitcoin-resolver -n fusion-bitcoin  
kubectl rollout undo deployment/fusion-bitcoin-frontend -n fusion-bitcoin

# 3. Wait for rollback completion
echo "⏳ Waiting for rollback to complete..."
kubectl rollout status deployment/fusion-bitcoin-relayer -n fusion-bitcoin
kubectl rollout status deployment/fusion-bitcoin-resolver -n fusion-bitcoin
kubectl rollout status deployment/fusion-bitcoin-frontend -n fusion-bitcoin

# 4. Verify rollback
echo "🔍 Verifying rollback..."
sleep 30
npm run health-check production

if [ $? -eq 0 ]; then
  echo "✅ Rollback completed successfully!"
  
  # 5. Restart health checks
  kubectl scale deployment/health-checker --replicas=1 -n fusion-bitcoin
  
  # 6. Send notification
  curl -X POST ${SLACK_WEBHOOK} -d '{
    "text": "🔄 Production rollback completed successfully to version '${PREVIOUS_VERSION}'"
  }'
else
  echo "❌ Rollback verification failed!"
  exit 1
fi
```

### 2. Database Rollback

**Database Rollback Procedure:**

```bash
#!/bin/bash
# Database rollback script

BACKUP_FILE=${1:-$(ls -t backups/*.sql | head -1)}

echo "💾 Starting database rollback..."
echo "📦 Using backup: ${BACKUP_FILE}"

# 1. Create current state backup
echo "📦 Creating current state backup..."
pg_dump ${DATABASE_URL} > backups/pre-rollback-$(date +%Y%m%d-%H%M%S).sql

# 2. Stop application services
echo "⏸️  Stopping application services..."
kubectl scale deployment/fusion-bitcoin-relayer --replicas=0 -n fusion-bitcoin
kubectl scale deployment/fusion-bitcoin-resolver --replicas=0 -n fusion-bitcoin

# 3. Restore database
echo "🔄 Restoring database..."
psql ${DATABASE_URL} < ${BACKUP_FILE}

# 4. Verify database integrity
echo "🔍 Verifying database integrity..."
npm run db:verify

if [ $? -eq 0 ]; then
  echo "✅ Database rollback completed successfully!"
  
  # 5. Restart services
  kubectl scale deployment/fusion-bitcoin-relayer --replicas=2 -n fusion-bitcoin
  kubectl scale deployment/fusion-bitcoin-resolver --replicas=2 -n fusion-bitcoin
else
  echo "❌ Database rollback failed!"
  exit 1
fi
```

### 3. Contract Rollback

**Smart Contract Rollback:**

```bash
#!/bin/bash
# Contract rollback (emergency only)

echo "⚠️  WARNING: Contract rollback is a complex operation!"
echo "This should only be performed in emergency situations."

# 1. Deploy previous contract version
cd contracts
npm run deploy:emergency --network ${NETWORK} --version ${PREVIOUS_CONTRACT_VERSION}

# 2. Update configuration
echo "📝 Updating contract addresses..."
cp deployments/${NETWORK}/previous-addresses.json ../config/contract-addresses/${NETWORK}.json

# 3. Restart services with new contract addresses
kubectl rollout restart deployment/fusion-bitcoin-relayer -n fusion-bitcoin
kubectl rollout restart deployment/fusion-bitcoin-resolver -n fusion-bitcoin

cd ..
```

## Troubleshooting

### Common Deployment Issues

#### 1. Configuration Errors

**Problem:** Environment variables not properly loaded

```bash
# Debug configuration loading
export CONFIG_DEBUG=true
npm run debug:config

# Check specific environment variables
printenv | grep FUSION_

# Validate configuration syntax
npm run validate-config --syntax-only
```

**Solution:**

- Verify `.env` files are in correct locations
- Check for typos in variable names
- Ensure proper escaping of special characters
- Validate JSON/YAML syntax in configuration files

#### 2. Database Connection Issues

**Problem:** Cannot connect to database

```bash
# Test database connectivity
pg_isready -h ${DB_HOST} -p ${DB_PORT}

# Test credentials
psql "postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -c "SELECT 1;"

# Check connection pool
npm run debug:db-connections
```

**Solution:**

- Verify database credentials and host information
- Check network connectivity and firewall rules
- Ensure database server is running and accepting connections
- Validate connection pool configuration

#### 3. Docker Image Issues

**Problem:** Docker build failures or image not found

```bash
# Check Docker build process
docker build --no-cache -t fusion-bitcoin-test .

# Inspect image layers
docker history fusion-bitcoin-relayer:latest

# Check image registry connectivity
docker pull ${REGISTRY}/fusion-bitcoin-relayer:${VERSION}
```

**Solution:**

- Verify Dockerfile syntax and dependencies
- Check base image availability
- Ensure proper Docker registry authentication
- Validate image tags and naming conventions

#### 4. Kubernetes Deployment Issues

**Problem:** Pods not starting or failing health checks

```bash
# Check pod status
kubectl get pods -n fusion-bitcoin

# Inspect pod logs
kubectl logs deployment/fusion-bitcoin-relayer -n fusion-bitcoin

# Describe failing pods
kubectl describe pod ${POD_NAME} -n fusion-bitcoin

# Check resource limits
kubectl describe nodes
```

**Solution:**

- Check resource requests and limits
- Verify image pull secrets and registry access
- Ensure proper service account permissions
- Validate health check endpoints and timeouts

### Monitoring and Debugging

**Debug Commands:**

```bash
# Enable debug logging
export LOG_LEVEL=debug
export DEBUG=*

# Monitor application logs
kubectl logs -f deployment/fusion-bitcoin-relayer -n fusion-bitcoin

# Check system resources
kubectl top nodes
kubectl top pods -n fusion-bitcoin

# Network debugging
kubectl exec -it ${POD_NAME} -n fusion-bitcoin -- ping external-api.com
kubectl exec -it ${POD_NAME} -n fusion-bitcoin -- nslookup database-host

# Database debugging
kubectl exec -it ${POD_NAME} -n fusion-bitcoin -- npm run db:status
```

## Operational Procedures

### 1. Routine Maintenance

**Weekly Maintenance Tasks:**

```bash
#!/bin/bash
# Weekly maintenance script

echo "🔧 Starting weekly maintenance..."

# 1. Update dependencies
npm audit fix
npm update

# 2. Rotate logs
kubectl exec -it deployment/fusion-bitcoin-relayer -- logrotate /etc/logrotate.conf

# 3. Database maintenance
kubectl exec -it deployment/fusion-bitcoin-relayer -- npm run db:vacuum
kubectl exec -it deployment/fusion-bitcoin-relayer -- npm run db:analyze

# 4. Security updates
npm audit --audit-level high
docker scout cves

# 5. Backup verification
npm run backup:verify

# 6. Generate maintenance report
npm run maintenance:report
```

**Monthly Tasks:**

- Review and rotate secrets
- Update SSL certificates if needed
- Performance optimization review
- Security audit and penetration testing
- Disaster recovery testing
- Documentation updates

### 2. Scaling Procedures

**Horizontal Scaling:**

```bash
# Scale relayer service
kubectl scale deployment/fusion-bitcoin-relayer --replicas=5 -n fusion-bitcoin

# Scale resolver service  
kubectl scale deployment/fusion-bitcoin-resolver --replicas=3 -n fusion-bitcoin

# Auto-scaling configuration
kubectl apply -f k8s/hpa.yaml
```

**Vertical Scaling:**

```bash
# Update resource limits
kubectl patch deployment fusion-bitcoin-relayer -n fusion-bitcoin -p '
{
  "spec": {
    "template": {
      "spec": {
        "containers": [
          {
            "name": "relayer",
            "resources": {
              "requests": {"cpu": "500m", "memory": "1Gi"},
              "limits": {"cpu": "2", "memory": "4Gi"}
            }
          }
        ]
      }
    }
  }
}'
```

### 3. Backup and Recovery

**Backup Procedures:**

```bash
#!/bin/bash
# Automated backup script

echo "📦 Starting automated backup..."

# 1. Database backup
pg_dump ${DATABASE_URL} | gzip > backups/db-$(date +%Y%m%d-%H%M%S).sql.gz

# 2. Configuration backup
tar -czf backups/config-$(date +%Y%m%d-%H%M%S).tar.gz config/ .env.*

# 3. Application state backup
kubectl exec -it deployment/fusion-bitcoin-relayer -- npm run backup:state

# 4. Upload to cloud storage
aws s3 cp backups/ s3://fusion-bitcoin-backups/ --recursive --exclude "*" --include "$(date +%Y%m%d)*"

# 5. Verify backup integrity
npm run backup:verify
```

**Recovery Testing:**

```bash
#!/bin/bash
# Disaster recovery test

echo "🧪 Starting disaster recovery test..."

# 1. Create isolated test environment
kubectl create namespace fusion-bitcoin-test

# 2. Restore from backup
./scripts/restore-backup.sh backups/latest/

# 3. Verify functionality
npm run test:recovery

# 4. Cleanup test environment
kubectl delete namespace fusion-bitcoin-test
```

## Conclusion

This deployment procedures document provides comprehensive guidance for deploying, monitoring, and maintaining the 1inch Fusion+ Cross-Chain Swap Extension to Bitcoin project. Following these procedures ensures:

- **Reliable deployments** with proper validation and testing
- **Quick problem resolution** through comprehensive monitoring
- **Rapid recovery** via automated rollback procedures
- **Operational excellence** through routine maintenance and optimization

Regular review and updates of these procedures based on operational experience will help maintain deployment reliability and system performance.

For additional support or questions about deployment procedures, refer to:

- [Configuration Management Guide](./configuration-management.md)
- [Security Best Practices](./security-best-practices.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [API Documentation](./api/)
