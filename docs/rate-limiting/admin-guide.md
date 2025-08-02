# Administrator Guide

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Policy Management](#policy-management)
- [User Management](#user-management)
- [System Configuration](#system-configuration)
- [Monitoring & Alerting](#monitoring--alerting)
- [Security Management](#security-management)
- [Troubleshooting](#troubleshooting)
- [Backup & Recovery](#backup--recovery)
- [Performance Tuning](#performance-tuning)

## Overview

This guide covers administrative tasks for managing the 1inch Fusion+ rate limiting system. As an administrator, you have access to advanced configuration options, user management tools, and system monitoring capabilities.

### Admin Access

**Web Interface**: `http://localhost:8081/admin`
**API Endpoint**: `http://localhost:8081/api/admin`
**Default Credentials**:

- Username: `admin`
- Password: `fusion_admin_2024` (change on first login)

### Admin Roles

- **Super Admin**: Full system access and configuration
- **Policy Admin**: Rate limit policy management
- **User Admin**: User tier and access management
- **Monitor Admin**: Read-only monitoring and reporting

## Getting Started

### Initial Setup

1. **Change Default Credentials**

   ```bash
   curl -X PUT http://localhost:8081/api/admin/auth/password \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"newPassword": "your_secure_password"}'
   ```

2. **Configure Basic Policies**
   - Set default rate limits for each tier
   - Configure DOS protection thresholds
   - Set up circuit breaker parameters

3. **Enable Monitoring**
   - Configure alert rules
   - Set up notification channels
   - Enable audit logging

### Admin Dashboard

The admin dashboard provides:

- 📊 **System Overview**: Real-time metrics and health status
- 👥 **User Management**: User tiers, usage, and access control
- ⚙️ **Policy Configuration**: Rate limiting rules and parameters
- 🚨 **Alert Management**: Active alerts and notification settings
- 📈 **Analytics**: Historical data and trend analysis
- 🔧 **System Tools**: Backup, restore, and maintenance

## Policy Management

### Rate Limiting Policies

#### View Current Policies

```bash
curl -X GET http://localhost:8081/api/admin/policies \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

#### Create New Policy

```json
{
  "name": "high_volume_trader",
  "description": "Special limits for high-volume traders",
  "tier": "custom",
  "limits": {
    "requestsPerMinute": 500,
    "requestsPerHour": 25000,
    "requestsPerDay": 500000,
    "concurrentRequests": 50,
    "crossChainOperations": 5000
  },
  "algorithms": {
    "primary": "sliding_window",
    "fallback": "token_bucket",
    "adaptive": true
  },
  "specialRules": {
    "burstAllowed": true,
    "burstMultiplier": 2,
    "burstDuration": 300
  },
  "effectiveDate": "2024-01-01T00:00:00Z",
  "expirationDate": null
}
```

#### Policy Templates

**Conservative Policy (High Security)**:

```json
{
  "name": "conservative",
  "limits": {
    "requestsPerMinute": 20,
    "requestsPerHour": 500,
    "requestsPerDay": 5000
  },
  "algorithms": {
    "primary": "fixed_window",
    "strictMode": true
  },
  "dosProtection": {
    "enabled": true,
    "threshold": 50,
    "blockDuration": 3600
  }
}
```

**Performance Policy (High Throughput)**:

```json
{
  "name": "performance", 
  "limits": {
    "requestsPerMinute": 1000,
    "requestsPerHour": 50000,
    "requestsPerDay": 1000000
  },
  "algorithms": {
    "primary": "token_bucket",
    "adaptive": true,
    "burstAllowed": true
  },
  "circuitBreaker": {
    "enabled": true,
    "failureThreshold": 10,
    "recoveryTime": 300
  }
}
```

#### Policy Validation

Before applying policies, validate them:

```bash
curl -X POST http://localhost:8081/api/admin/policies/validate \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d @new_policy.json
```

### Algorithm Configuration

#### Sliding Window

```json
{
  "type": "sliding_window",
  "parameters": {
    "windowSize": 60000,
    "precision": 1000,
    "cleanup": true,
    "cleanupInterval": 300000
  }
}
```

#### Token Bucket

```json
{
  "type": "token_bucket",
  "parameters": {
    "capacity": 100,
    "refillRate": 1,
    "refillInterval": 1000,
    "initialTokens": 100
  }
}
```

#### Adaptive Algorithm

```json
{
  "type": "adaptive",
  "parameters": {
    "baseLimit": 100,
    "adaptationFactor": 0.8,
    "loadThreshold": 0.7,
    "recoveryFactor": 1.2,
    "minLimit": 10,
    "maxLimit": 1000
  }
}
```

## User Management

### User Tiers

#### List All Users

```bash
curl -X GET http://localhost:8081/api/admin/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -G -d "page=1&limit=50&tier=premium"
```

#### Update User Tier

```bash
curl -X PUT http://localhost:8081/api/admin/users/USER_ID/tier \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "premium",
    "reason": "Subscription upgrade",
    "effectiveDate": "2024-01-01T00:00:00Z",
    "notifyUser": true
  }'
```

#### Bulk User Operations

```bash
curl -X POST http://localhost:8081/api/admin/users/bulk \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "upgrade_tier",
    "filters": {
      "currentTier": "basic",
      "usageThreshold": 0.8
    },
    "newTier": "premium",
    "reason": "High usage upgrade"
  }'
```

### Access Control

#### API Key Management

```bash
# List user API keys
curl -X GET http://localhost:8081/api/admin/users/USER_ID/api-keys \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Revoke API key
curl -X DELETE http://localhost:8081/api/admin/users/USER_ID/api-keys/KEY_ID \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Create new API key for user
curl -X POST http://localhost:8081/api/admin/users/USER_ID/api-keys \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API Key",
    "permissions": ["swap", "balance", "history"],
    "expirationDate": "2025-01-01T00:00:00Z"
  }'
```

#### IP Whitelisting

```bash
# Add IP to whitelist
curl -X POST http://localhost:8081/api/admin/users/USER_ID/whitelist \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ipAddress": "192.168.1.100",
    "reason": "Office IP",
    "expirationDate": null
  }'

# Remove IP from whitelist  
curl -X DELETE http://localhost:8081/api/admin/users/USER_ID/whitelist/IP_ID \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### User Analytics

#### Usage Reports

```bash
curl -X GET http://localhost:8081/api/admin/analytics/usage \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -G \
  -d "period=30d" \
  -d "groupBy=tier" \
  -d "includeDetails=true"
```

#### Top Users Report

```bash
curl -X GET http://localhost:8081/api/admin/analytics/top-users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -G \
  -d "metric=requests" \
  -d "period=24h" \
  -d "limit=100"
```

## System Configuration

### Core Settings

#### Rate Limiting Engine

```bash
curl -X PUT http://localhost:8081/api/admin/config/rate-limiting \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "engine": {
      "defaultAlgorithm": "sliding_window",
      "memoryCleanup": true,
      "cleanupInterval": 300000,
      "maxMemoryUsage": "512MB"
    },
    "redis": {
      "enabled": true,
      "url": "redis://localhost:6379",
      "keyPrefix": "rate_limit:",
      "maxConnections": 50
    },
    "metrics": {
      "enabled": true,
      "interval": 60000,
      "retention": "30d"
    }
  }'
```

#### Cross-Chain Configuration

```bash
curl -X PUT http://localhost:8081/api/admin/config/cross-chain \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "coordination": {
      "enabled": true,
      "timeout": 30000,
      "retries": 3
    },
    "resourcePools": {
      "ethereum": {
        "maxConcurrent": 500,
        "queueSize": 1000,
        "timeout": 30000
      },
      "bitcoin": {
        "maxConcurrent": 200,
        "queueSize": 500,
        "timeout": 45000
      }
    },
    "failover": {
      "enabled": true,
      "failoverDelay": 5000
    }
  }'
```

### Circuit Breaker Configuration

#### Global Circuit Breaker

```json
{
  "circuitBreaker": {
    "enabled": true,
    "globalThreshold": {
      "errorRate": 0.1,
      "responseTime": 5000,
      "timeWindow": 60000
    },
    "recovery": {
      "testInterval": 30000,
      "successThreshold": 5,
      "recoveryTimeout": 300000
    },
    "notifications": {
      "onOpen": true,
      "onHalfOpen": true,
      "onClose": true
    }
  }
}
```

#### Endpoint-Specific Circuit Breakers

```json
{
  "endpointCircuitBreakers": {
    "/api/swap/execute": {
      "enabled": true,
      "failureThreshold": 5,
      "timeWindow": 30000,
      "resetTimeout": 60000
    },
    "/api/swap/cross-chain": {
      "enabled": true,
      "failureThreshold": 3,
      "timeWindow": 60000,
      "resetTimeout": 120000
    }
  }
}
```

### DOS Protection

#### Configure DOS Thresholds

```bash
curl -X PUT http://localhost:8081/api/admin/config/dos-protection \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "detection": {
      "requestSpike": {
        "threshold": 1000,
        "timeWindow": 60000,
        "action": "rate_limit"
      },
      "errorSpike": {
        "threshold": 100,
        "timeWindow": 30000,
        "action": "temporary_ban"
      },
      "slowLoris": {
        "enabled": true,
        "connectionTimeout": 30000,
        "maxConnections": 100
      }
    },
    "mitigation": {
      "autoBlock": true,
      "blockDuration": 3600000,
      "challengeEnabled": true,
      "challengeType": "captcha"
    }
  }'
```

## Monitoring & Alerting

### System Health Monitoring

#### Health Check Endpoints

```bash
# Overall system health
curl -X GET http://localhost:8081/api/admin/health

# Component-specific health
curl -X GET http://localhost:8081/api/admin/health/rate-limiter
curl -X GET http://localhost:8081/api/admin/health/database
curl -X GET http://localhost:8081/api/admin/health/redis
```

#### Performance Metrics

```bash
# Real-time metrics
curl -X GET http://localhost:8081/api/admin/metrics/realtime

# Historical metrics
curl -X GET http://localhost:8081/api/admin/metrics/historical \
  -G -d "period=24h&metric=requests,errors,response_time"
```

### Alert Configuration

#### Create Alert Rules

```bash
curl -X POST http://localhost:8081/api/admin/alerts/rules \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Error Rate",
    "description": "Alert when error rate exceeds 5%",
    "condition": {
      "metric": "error_rate",
      "operator": ">",
      "threshold": 0.05,
      "timeWindow": "5m",
      "evaluationInterval": "1m"
    },
    "severity": "critical",
    "actions": [
      {
        "type": "email",
        "recipients": ["admin@1inch.io"],
        "template": "error_rate_alert"
      },
      {
        "type": "slack",
        "webhook": "https://hooks.slack.com/...",
        "channel": "#alerts"
      },
      {
        "type": "pagerduty",
        "serviceKey": "PAGERDUTY_KEY"
      }
    ],
    "enabled": true
  }'
```

#### Common Alert Rules

**Rate Limit Violations**:

```json
{
  "name": "Rate Limit Violations",
  "condition": {
    "metric": "rate_limit_violations",
    "operator": ">",
    "threshold": 100,
    "timeWindow": "5m"
  },
  "severity": "warning"
}
```

**Circuit Breaker Activation**:

```json
{
  "name": "Circuit Breaker Open", 
  "condition": {
    "metric": "circuit_breaker_state",
    "operator": "==",
    "threshold": "open"
  },
  "severity": "critical"
}
```

**System Overload**:

```json
{
  "name": "System Overload",
  "condition": {
    "metric": "cpu_usage",
    "operator": ">", 
    "threshold": 0.8,
    "timeWindow": "10m"
  },
  "severity": "critical"
}
```

### Notification Channels

#### Email Configuration

```bash
curl -X PUT http://localhost:8081/api/admin/config/notifications/email \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": true,
      "auth": {
        "user": "alerts@1inch.io",
        "pass": "smtp_password"
      }
    },
    "templates": {
      "default": "default_alert_template",
      "errorRate": "error_rate_template"
    }
  }'
```

#### Slack Integration

```bash
curl -X PUT http://localhost:8081/api/admin/config/notifications/slack \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#alerts",
    "username": "1inch-bot",
    "iconEmoji": ":warning:"
  }'
```

## Security Management

### Access Control

#### Admin User Management

```bash
# Create new admin user
curl -X POST http://localhost:8081/api/admin/admins \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "policy_admin",
    "email": "policy@1inch.io",
    "role": "policy_admin",
    "permissions": [
      "read_policies",
      "write_policies",
      "read_users"
    ],
    "mfaRequired": true
  }'
```

#### Session Management

```bash
# View active admin sessions
curl -X GET http://localhost:8081/api/admin/sessions \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Revoke session
curl -X DELETE http://localhost:8081/api/admin/sessions/SESSION_ID \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Audit Logging

#### Configure Audit Logging

```json
{
  "auditLogging": {
    "enabled": true,
    "level": "info",
    "events": [
      "policy_change",
      "user_tier_change", 
      "admin_login",
      "config_change",
      "alert_rule_change"
    ],
    "storage": {
      "type": "database",
      "retention": "1y",
      "compression": true
    },
    "realTimeAlerts": {
      "enabled": true,
      "criticalEvents": [
        "admin_privilege_escalation",
        "bulk_user_operation",
        "security_setting_change"
      ]
    }
  }
}
```

#### View Audit Logs

```bash
curl -X GET http://localhost:8081/api/admin/audit-logs \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -G \
  -d "startDate=2024-01-01" \
  -d "endDate=2024-01-31" \
  -d "event=policy_change" \
  -d "user=admin_user"
```

### Security Scanning

#### Vulnerability Assessment

```bash
# Run security scan
curl -X POST http://localhost:8081/api/admin/security/scan \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scanType": "full",
    "components": ["api", "database", "redis", "nginx"],
    "notifications": ["email", "slack"]
  }'
```

#### Threat Intelligence Integration

```json
{
  "threatIntelligence": {
    "enabled": true,
    "providers": [
      {
        "name": "cloudflare",
        "apiKey": "CF_API_KEY",
        "updateInterval": "1h"
      }
    ],
    "autoBlocking": {
      "enabled": true,
      "threatLevels": ["high", "critical"],
      "blockDuration": "24h"
    }
  }
}
```

## Troubleshooting

### Common Issues

#### High Rate Limit Violations

**Symptoms**: Many 429 responses, user complaints
**Investigation**:

```bash
# Check violation patterns
curl -X GET http://localhost:8081/api/admin/analytics/violations \
  -G -d "period=24h&groupBy=endpoint,tier"

# Check if specific users are affected
curl -X GET http://localhost:8081/api/admin/analytics/violations/users \
  -G -d "period=1h&limit=50"
```

**Solutions**:

- Review and adjust tier limits
- Check for bot traffic
- Implement CAPTCHA challenges
- Consider temporary limit increases

#### Circuit Breaker Stuck Open

**Symptoms**: 503 responses, circuit breaker won't close
**Investigation**:

```bash
# Check circuit breaker status
curl -X GET http://localhost:8081/api/admin/circuit-breakers/status

# Review error logs
curl -X GET http://localhost:8081/api/admin/logs \
  -G -d "level=error&component=circuit_breaker&period=1h"
```

**Solutions**:

- Manually reset circuit breaker
- Investigate underlying service issues
- Adjust circuit breaker thresholds
- Check dependency services

#### Performance Degradation

**Symptoms**: Slow response times, high resource usage
**Investigation**:

```bash
# Check system metrics
curl -X GET http://localhost:8081/api/admin/metrics/system

# Analyze slow queries
curl -X GET http://localhost:8081/api/admin/analytics/slow-requests \
  -G -d "threshold=1000&period=1h"
```

**Solutions**:

- Scale infrastructure
- Optimize database queries
- Increase cache TTL
- Review algorithm efficiency

### Debug Mode

#### Enable Debug Logging

```bash
curl -X PUT http://localhost:8081/api/admin/config/logging \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "debug",
    "components": {
      "rateLimiter": "debug",
      "circuitBreaker": "debug",
      "dosProtection": "info"
    },
    "requestLogging": {
      "enabled": true,
      "includeHeaders": true,
      "includeBody": false
    }
  }'
```

#### Request Tracing

```bash
# Enable request tracing for specific user
curl -X POST http://localhost:8081/api/admin/debug/trace \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID",
    "duration": 3600,
    "includeInternal": true
  }'
```

## Backup & Recovery

### Configuration Backup

#### Export Configuration

```bash
curl -X GET http://localhost:8081/api/admin/backup/config \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -o config_backup_$(date +%Y%m%d).json
```

#### Import Configuration

```bash
curl -X POST http://localhost:8081/api/admin/backup/restore \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d @config_backup_20240101.json
```

### Data Backup

#### Database Backup

```bash
# Create backup
curl -X POST http://localhost:8081/api/admin/backup/database \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "full",
    "compress": true,
    "encryption": true
  }'

# List backups
curl -X GET http://localhost:8081/api/admin/backup/database/list \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Disaster Recovery

#### Recovery Procedures

1. **Service Restart**: Automatic recovery from temporary failures
2. **Configuration Rollback**: Restore previous working configuration
3. **Database Restore**: Restore from latest backup
4. **Full System Recovery**: Complete system restoration

#### Recovery Testing

```bash
# Test configuration rollback
curl -X POST http://localhost:8081/api/admin/test/recovery/config \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Test database restore
curl -X POST http://localhost:8081/api/admin/test/recovery/database \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"backupId": "backup_20240101_123456"}'
```

## Performance Tuning

### Memory Optimization

#### Rate Limiter Memory Settings

```json
{
  "memory": {
    "maxUsage": "1GB",
    "cleanupInterval": 300000,
    "compressionEnabled": true,
    "gcSettings": {
      "enabled": true,
      "interval": 60000,
      "threshold": 0.8
    }
  }
}
```

### Database Optimization

#### Connection Pool Tuning

```json
{
  "database": {
    "pool": {
      "min": 5,
      "max": 50,
      "acquireTimeout": 30000,
      "idleTimeout": 300000
    },
    "queries": {
      "timeout": 5000,
      "retries": 3,
      "cacheEnabled": true
    }
  }
}
```

### Redis Optimization

#### Redis Configuration

```json
{
  "redis": {
    "pool": {
      "min": 5,
      "max": 50
    },
    "keyExpiration": {
      "enabled": true,
      "defaultTTL": 3600,
      "cleanupInterval": 300
    },
    "memory": {
      "maxMemory": "512MB",
      "policy": "allkeys-lru"
    }
  }
}
```

### Load Testing

#### Performance Benchmarking

```bash
# Run load test
curl -X POST http://localhost:8081/api/admin/test/load \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": 300,
    "concurrency": 100,
    "targetRPS": 1000,
    "endpoints": ["/api/swap/quote", "/api/swap/execute"]
  }'
```

---

**Administrative Best Practices:**

1. Regular configuration backups
2. Monitor system health continuously
3. Review audit logs regularly
4. Test disaster recovery procedures
5. Keep security configurations updated
6. Performance tune based on usage patterns

**Support Resources:**

- 📖 Full documentation at docs.1inch.io
- 🎫 Admin support portal
- 📞 Emergency support: +1-555-FUSION
- 💬 Admin Slack channel: #1inch-admins

**Last Updated**: January 2025
