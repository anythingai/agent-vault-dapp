# Configuration Reference

## Table of Contents

- [Overview](#overview)
- [Core Configuration](#core-configuration)
- [Rate Limiting Policies](#rate-limiting-policies)
- [Algorithm Settings](#algorithm-settings)
- [User Tiers](#user-tiers)
- [Cross-Chain Settings](#cross-chain-settings)
- [Infrastructure Configuration](#infrastructure-configuration)
- [Security Settings](#security-settings)
- [Monitoring Configuration](#monitoring-configuration)
- [Environment Variables](#environment-variables)

## Overview

This document provides a complete reference for all configuration options in the 1inch Fusion+ rate limiting system. Configuration is managed through JSON files, environment variables, and the admin interface.

### Configuration Hierarchy

1. **Environment Variables** (highest priority)
2. **Admin Interface Settings**
3. **Configuration Files**
4. **Default Values** (lowest priority)

### Configuration Validation

All configurations are validated against JSON schemas before applying. Invalid configurations are rejected with detailed error messages.

## Core Configuration

### Main Configuration File

**Location**: `config/rate-limiting/config.json`

```json
{
  "version": "1.0.0",
  "environment": "production",
  "debug": false,
  
  "engine": {
    "defaultAlgorithm": "sliding_window",
    "memoryManagement": {
      "maxMemoryMB": 1024,
      "cleanupInterval": 300000,
      "gcThreshold": 0.8
    },
    "persistence": {
      "enabled": true,
      "provider": "redis",
      "connectionString": "redis://localhost:6379",
      "keyPrefix": "rate_limit:",
      "ttl": 3600
    }
  },

  "server": {
    "host": "localhost",
    "port": 3000,
    "adminPort": 8081,
    "cors": {
      "enabled": true,
      "origins": ["https://app.1inch.io"],
      "credentials": true
    },
    "security": {
      "helmet": true,
      "rateLimit": true,
      "compression": true
    }
  },

  "database": {
    "type": "postgresql",
    "host": "localhost",
    "port": 5432,
    "database": "fusion_rate_limit",
    "username": "fusion_user",
    "password": "${DB_PASSWORD}",
    "ssl": true,
    "pool": {
      "min": 5,
      "max": 50,
      "acquireTimeout": 30000,
      "idleTimeout": 300000
    }
  },

  "redis": {
    "host": "localhost",
    "port": 6379,
    "password": "${REDIS_PASSWORD}",
    "db": 0,
    "keyPrefix": "fusion:",
    "maxRetriesPerRequest": 3,
    "retryDelayOnFailover": 100,
    "lazyConnect": true
  }
}
```

### Environment-Specific Overrides

**Development** (`config/development.json`):

```json
{
  "debug": true,
  "engine": {
    "memoryManagement": {
      "maxMemoryMB": 256
    }
  },
  "server": {
    "cors": {
      "origins": ["http://localhost:3000", "http://localhost:3001"]
    }
  }
}
```

**Production** (`config/production.json`):

```json
{
  "debug": false,
  "engine": {
    "memoryManagement": {
      "maxMemoryMB": 2048,
      "cleanupInterval": 180000
    }
  },
  "database": {
    "ssl": true,
    "pool": {
      "max": 100
    }
  }
}
```

## Rate Limiting Policies

### Policy Structure

```json
{
  "policies": {
    "default": {
      "name": "Default Policy",
      "description": "Standard rate limiting for all users",
      "enabled": true,
      "algorithms": {
        "primary": "sliding_window",
        "fallback": "token_bucket",
        "adaptive": false
      },
      "limits": {
        "requestsPerMinute": 60,
        "requestsPerHour": 1000,
        "requestsPerDay": 10000,
        "concurrentRequests": 10
      },
      "windows": {
        "minute": 60000,
        "hour": 3600000,
        "day": 86400000
      }
    }
  }
}
```

### Policy Templates

**Conservative Policy:**

```json
{
  "conservative": {
    "name": "Conservative Rate Limiting",
    "algorithms": {
      "primary": "fixed_window",
      "strictMode": true
    },
    "limits": {
      "requestsPerMinute": 30,
      "requestsPerHour": 500,
      "requestsPerDay": 5000,
      "concurrentRequests": 5
    },
    "penalties": {
      "enabled": true,
      "progressiveDelay": true,
      "maxPenalty": 300000
    }
  }
}
```

**Performance Policy:**

```json
{
  "performance": {
    "name": "High Performance Rate Limiting",
    "algorithms": {
      "primary": "token_bucket",
      "burstAllowed": true,
      "adaptive": true
    },
    "limits": {
      "requestsPerMinute": 300,
      "requestsPerHour": 10000,
      "requestsPerDay": 100000,
      "concurrentRequests": 50
    },
    "burst": {
      "enabled": true,
      "multiplier": 2,
      "duration": 30000
    }
  }
}
```

### Policy Validation Rules

```json
{
  "validation": {
    "limits": {
      "requestsPerMinute": {
        "min": 1,
        "max": 10000,
        "required": true
      },
      "requestsPerHour": {
        "min": 60,
        "max": 1000000,
        "required": true
      },
      "concurrentRequests": {
        "min": 1,
        "max": 1000,
        "required": true
      }
    },
    "algorithms": {
      "primary": {
        "enum": ["sliding_window", "token_bucket", "fixed_window", "adaptive"],
        "required": true
      }
    }
  }
}
```

## Algorithm Settings

### Sliding Window Algorithm

```json
{
  "slidingWindow": {
    "enabled": true,
    "precision": 1000,
    "cleanup": {
      "enabled": true,
      "interval": 300000,
      "batchSize": 1000
    },
    "storage": {
      "type": "redis",
      "keyPattern": "sw:{userId}:{operation}",
      "ttl": 3600
    },
    "performance": {
      "maxWindowSize": 3600000,
      "optimizationThreshold": 1000
    }
  }
}
```

### Token Bucket Algorithm

```json
{
  "tokenBucket": {
    "enabled": true,
    "defaultCapacity": 100,
    "defaultRefillRate": 1,
    "refillInterval": 1000,
    "persistence": {
      "enabled": true,
      "saveInterval": 30000
    },
    "burst": {
      "enabled": true,
      "maxMultiplier": 5,
      "cooldownPeriod": 300000
    }
  }
}
```

### Fixed Window Algorithm

```json
{
  "fixedWindow": {
    "enabled": true,
    "windowAlignment": "start",
    "storage": {
      "type": "redis",
      "keyPattern": "fw:{userId}:{window}",
      "atomic": true
    },
    "optimization": {
      "precompute": true,
      "cacheWindows": true,
      "maxCacheSize": 10000
    }
  }
}
```

### Adaptive Algorithm

```json
{
  "adaptive": {
    "enabled": true,
    "loadThresholds": {
      "low": 0.3,
      "medium": 0.6,
      "high": 0.8,
      "critical": 0.95
    },
    "adjustmentFactors": {
      "low": 1.2,
      "medium": 1.0,
      "high": 0.8,
      "critical": 0.5
    },
    "evaluationInterval": 30000,
    "smoothingFactor": 0.1,
    "minLimit": 10,
    "maxLimit": 10000
  }
}
```

## User Tiers

### Tier Definitions

```json
{
  "tiers": {
    "free": {
      "name": "Free Tier",
      "priority": 1,
      "limits": {
        "requestsPerMinute": 10,
        "requestsPerHour": 100,
        "requestsPerDay": 1000,
        "concurrentRequests": 2,
        "crossChainOperations": 5
      },
      "features": {
        "basicAPI": true,
        "premiumEndpoints": false,
        "prioritySupport": false,
        "advancedAnalytics": false
      },
      "quotas": {
        "daily": 1000,
        "monthly": 30000
      }
    },
    
    "basic": {
      "name": "Basic Tier",
      "priority": 2,
      "limits": {
        "requestsPerMinute": 50,
        "requestsPerHour": 1000,
        "requestsPerDay": 10000,
        "concurrentRequests": 5,
        "crossChainOperations": 100
      },
      "features": {
        "basicAPI": true,
        "premiumEndpoints": false,
        "prioritySupport": false,
        "advancedAnalytics": true
      },
      "quotas": {
        "daily": 10000,
        "monthly": 300000
      }
    },
    
    "premium": {
      "name": "Premium Tier",
      "priority": 3,
      "limits": {
        "requestsPerMinute": 200,
        "requestsPerHour": 10000,
        "requestsPerDay": 100000,
        "concurrentRequests": 20,
        "crossChainOperations": 1000
      },
      "features": {
        "basicAPI": true,
        "premiumEndpoints": true,
        "prioritySupport": true,
        "advancedAnalytics": true,
        "customLimits": true
      },
      "quotas": {
        "daily": 100000,
        "monthly": 3000000
      },
      "sla": {
        "uptime": 99.9,
        "responseTime": 200
      }
    },
    
    "enterprise": {
      "name": "Enterprise Tier",
      "priority": 4,
      "limits": {
        "requestsPerMinute": 1000,
        "requestsPerHour": 50000,
        "requestsPerDay": 1000000,
        "concurrentRequests": 100,
        "crossChainOperations": 10000
      },
      "features": {
        "basicAPI": true,
        "premiumEndpoints": true,
        "prioritySupport": true,
        "advancedAnalytics": true,
        "customLimits": true,
        "dedicatedSupport": true,
        "betaFeatures": true
      },
      "quotas": {
        "daily": 1000000,
        "monthly": 30000000
      },
      "sla": {
        "uptime": 99.95,
        "responseTime": 100
      }
    },
    
    "admin": {
      "name": "Admin Tier",
      "priority": 5,
      "limits": {
        "requestsPerMinute": 10000,
        "requestsPerHour": 500000,
        "requestsPerDay": 10000000,
        "concurrentRequests": 1000,
        "crossChainOperations": 100000
      },
      "features": {
        "unlimited": true
      }
    }
  }
}
```

### Tier Upgrade Rules

```json
{
  "tierUpgrade": {
    "automaticUpgrade": {
      "enabled": true,
      "thresholds": {
        "usagePercentage": 0.8,
        "consecutiveDays": 7,
        "averageUsage": 0.7
      }
    },
    "downgradePrevention": {
      "enabled": true,
      "gracePeriod": 2592000,
      "warningPeriod": 604800
    },
    "customTiers": {
      "enabled": true,
      "approvalRequired": true,
      "maxCustomLimits": {
        "requestsPerMinute": 5000,
        "requestsPerDay": 5000000
      }
    }
  }
}
```

## Cross-Chain Settings

### Cross-Chain Coordination

```json
{
  "crossChain": {
    "enabled": true,
    "coordination": {
      "timeout": 30000,
      "retries": 3,
      "backoffMultiplier": 2,
      "maxBackoff": 60000
    },
    
    "resourcePools": {
      "ethereum": {
        "maxConcurrent": 500,
        "queueSize": 1000,
        "timeout": 30000,
        "priority": {
          "enterprise": 1,
          "premium": 2,
          "basic": 3,
          "free": 4
        }
      },
      "bitcoin": {
        "maxConcurrent": 200,
        "queueSize": 500,
        "timeout": 45000,
        "priority": {
          "enterprise": 1,
          "premium": 2,
          "basic": 3,
          "free": 4
        }
      }
    },
    
    "sharedLimits": {
      "enabled": true,
      "distributionRatio": {
        "ethereum": 0.7,
        "bitcoin": 0.3
      },
      "rebalancing": {
        "enabled": true,
        "interval": 60000,
        "threshold": 0.8
      }
    },
    
    "dependencyTracking": {
      "enabled": true,
      "maxDependencies": 10,
      "cleanupInterval": 300000,
      "timeoutHandling": {
        "enabled": true,
        "defaultTimeout": 600000,
        "cleanupOnTimeout": true
      }
    }
  }
}
```

### Chain-Specific Settings

```json
{
  "chains": {
    "ethereum": {
      "rpcUrl": "${ETHEREUM_RPC_URL}",
      "maxBlockConfirmations": 12,
      "gasLimitSafety": 1.2,
      "rateLimits": {
        "rpcCalls": 1000,
        "contractCalls": 100
      }
    },
    
    "bitcoin": {
      "rpcUrl": "${BITCOIN_RPC_URL}",
      "maxBlockConfirmations": 6,
      "feeEstimation": "medium",
      "rateLimits": {
        "rpcCalls": 500,
        "transactionBroadcast": 50
      }
    }
  }
}
```

## Infrastructure Configuration

### Nginx Configuration

**File**: `docker/nginx/rate-limit.conf`

```nginx
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=admin:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=swap:10m rate=2r/s;

# Connection limiting
limit_conn_zone $binary_remote_addr zone=conn_limit_per_ip:10m;

# Upstream servers
upstream fusion_api {
    server app:3000 max_fails=3 fail_timeout=30s;
    server app:3001 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    server_name api.1inch.io;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Rate limiting
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        limit_conn conn_limit_per_ip 10;
        proxy_pass http://fusion_api;
    }
    
    location /api/swap/ {
        limit_req zone=swap burst=5 nodelay;
        limit_conn conn_limit_per_ip 5;
        proxy_pass http://fusion_api;
    }
    
    location /admin/ {
        limit_req zone=admin burst=10 nodelay;
        limit_conn conn_limit_per_ip 2;
        allow 192.168.1.0/24;
        deny all;
        proxy_pass http://fusion_api;
    }
}
```

### Load Balancer Configuration

```json
{
  "loadBalancer": {
    "algorithm": "least_connections",
    "healthCheck": {
      "enabled": true,
      "path": "/health",
      "interval": 30000,
      "timeout": 5000,
      "retries": 3,
      "healthyThreshold": 2,
      "unhealthyThreshold": 3
    },
    "servers": [
      {
        "host": "app1.internal",
        "port": 3000,
        "weight": 1,
        "maxConnections": 1000
      },
      {
        "host": "app2.internal",
        "port": 3000,
        "weight": 1,
        "maxConnections": 1000
      }
    ],
    "sessionAffinity": {
      "enabled": false,
      "method": "cookie",
      "cookieName": "fusion_session"
    }
  }
}
```

## Security Settings

### Authentication Configuration

```json
{
  "authentication": {
    "jwt": {
      "secret": "${JWT_SECRET}",
      "expiresIn": "24h",
      "issuer": "1inch-fusion",
      "audience": "fusion-api",
      "algorithm": "HS256"
    },
    
    "apiKeys": {
      "enabled": true,
      "headerName": "Authorization",
      "prefix": "Bearer ",
      "encryption": {
        "algorithm": "aes-256-gcm",
        "key": "${API_KEY_ENCRYPTION_KEY}"
      },
      "rotation": {
        "enabled": true,
        "interval": 2592000,
        "gracePeriod": 604800
      }
    },
    
    "rateLimit": {
      "failedAttempts": {
        "max": 5,
        "window": 900000,
        "blockDuration": 3600000
      }
    }
  }
}
```

### Access Control

```json
{
  "accessControl": {
    "whitelist": {
      "enabled": true,
      "ips": [
        "192.168.1.0/24",
        "10.0.0.0/8"
      ],
      "adminOnly": true
    },
    
    "blacklist": {
      "enabled": true,
      "ips": [],
      "automatic": {
        "enabled": true,
        "threshold": 100,
        "timeWindow": 3600000,
        "blockDuration": 86400000
      }
    },
    
    "geoblocking": {
      "enabled": false,
      "allowedCountries": [],
      "blockedCountries": []
    }
  }
}
```

### DDoS Protection

```json
{
  "ddosProtection": {
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
        "action": "temporary_block"
      },
      "slowLoris": {
        "enabled": true,
        "connectionTimeout": 30000,
        "maxConnections": 100
      }
    },
    
    "mitigation": {
      "autoBlock": {
        "enabled": true,
        "duration": 3600000,
        "escalation": true
      },
      "challenge": {
        "enabled": true,
        "type": "captcha",
        "threshold": 500
      },
      "rateLimitEscalation": {
        "enabled": true,
        "levels": [
          { "threshold": 100, "limit": 10 },
          { "threshold": 500, "limit": 5 },
          { "threshold": 1000, "limit": 1 }
        ]
      }
    }
  }
}
```

## Monitoring Configuration

### Metrics Collection

```json
{
  "monitoring": {
    "metrics": {
      "enabled": true,
      "interval": 60000,
      "retention": "30d",
      "aggregation": {
        "enabled": true,
        "levels": ["1m", "5m", "1h", "1d"]
      }
    },
    
    "prometheus": {
      "enabled": true,
      "host": "localhost",
      "port": 9090,
      "path": "/metrics",
      "defaultLabels": {
        "service": "fusion-rate-limit",
        "environment": "${NODE_ENV}"
      }
    },
    
    "customMetrics": [
      {
        "name": "rate_limit_violations_total",
        "type": "counter",
        "help": "Total number of rate limit violations",
        "labels": ["user_id", "tier", "endpoint"]
      },
      {
        "name": "request_duration_seconds",
        "type": "histogram",
        "help": "Request duration in seconds",
        "buckets": [0.1, 0.5, 1, 2, 5]
      }
    ]
  }
}
```

### Alerting Rules

```json
{
  "alerting": {
    "enabled": true,
    
    "rules": [
      {
        "name": "HighErrorRate",
        "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) > 0.05",
        "for": "5m",
        "severity": "critical",
        "annotations": {
          "summary": "High error rate detected",
          "description": "Error rate is {{ $value }} requests per second"
        }
      },
      {
        "name": "RateLimitViolations",
        "expr": "rate(rate_limit_violations_total[1m]) > 10",
        "for": "2m",
        "severity": "warning",
        "annotations": {
          "summary": "High rate limit violations",
          "description": "{{ $value }} violations per second"
        }
      }
    ],
    
    "channels": [
      {
        "name": "email",
        "type": "email",
        "config": {
          "smtp": {
            "host": "smtp.gmail.com",
            "port": 587,
            "username": "${SMTP_USERNAME}",
            "password": "${SMTP_PASSWORD}"
          },
          "from": "alerts@1inch.io",
          "to": ["admin@1inch.io"]
        }
      },
      {
        "name": "slack",
        "type": "slack",
        "config": {
          "webhookUrl": "${SLACK_WEBHOOK_URL}",
          "channel": "#alerts"
        }
      }
    ]
  }
}
```

### Logging Configuration

```json
{
  "logging": {
    "level": "info",
    "format": "json",
    "
    "outputs": [
      {
        "type": "console",
        "enabled": true,
        "colorize": true
      },
      {
        "type": "file",
        "enabled": true,
        "filename": "logs/fusion-rate-limit.log",
        "maxSize": "100MB",
        "maxFiles": 10
      },
      {
        "type": "elasticsearch",
        "enabled": false,
        "host": "localhost:9200",
        "index": "fusion-logs"
      }
    ],
    
    "requestLogging": {
      "enabled": true,
      "includeHeaders": false,
      "includeBody": false,
      "sanitize": ["password", "apiKey", "authorization"]
    },
    
    "auditLogging": {
      "enabled": true,
      "events": [
        "user_tier_change",
        "policy_update",
        "admin_login",
        "rate_limit_override"
      ],
      "retention": "1y"
    }
  }
}
```

## Environment Variables

### Required Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `NODE_ENV` | Environment | development | `production` |
| `PORT` | Main server port | 3000 | `3000` |
| `ADMIN_PORT` | Admin server port | 8081 | `8081` |
| `DB_PASSWORD` | Database password | - | `secure_password` |
| `REDIS_PASSWORD` | Redis password | - | `redis_password` |
| `JWT_SECRET` | JWT signing secret | - | `jwt_secret_key` |

### Optional Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEBUG` | Debug mode | false | `true` |
| `LOG_LEVEL` | Logging level | info | `debug` |
| `RATE_LIMIT_REDIS_URL` | Redis URL | localhost:6379 | `redis://redis:6379` |
| `PROMETHEUS_PORT` | Metrics port | 9090 | `9090` |
| `SLACK_WEBHOOK_URL` | Slack alerts | - | `https://hooks.slack.com/...` |

### Environment File Examples

**.env.development:**

```bash
NODE_ENV=development
DEBUG=true
LOG_LEVEL=debug
PORT=3000
ADMIN_PORT=8081

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fusion_dev
DB_USERNAME=dev_user
DB_PASSWORD=dev_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Security
JWT_SECRET=dev_jwt_secret
API_KEY_ENCRYPTION_KEY=dev_encryption_key

# External APIs
ETHEREUM_RPC_URL=http://localhost:8545
BITCOIN_RPC_URL=http://localhost:8332
```

**.env.production:**

```bash
NODE_ENV=production
DEBUG=false
LOG_LEVEL=info
PORT=3000
ADMIN_PORT=8081

# Database
DB_HOST=db.internal
DB_PORT=5432
DB_NAME=fusion_prod
DB_USERNAME=fusion_user
DB_PASSWORD=secure_prod_password

# Redis
REDIS_HOST=redis.internal
REDIS_PORT=6379
REDIS_PASSWORD=secure_redis_password

# Security
JWT_SECRET=secure_jwt_secret_key
API_KEY_ENCRYPTION_KEY=secure_encryption_key

# External APIs
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/PROJECT_ID
BITCOIN_RPC_URL=https://bitcoin-rpc.internal

# Monitoring
PROMETHEUS_PORT=9090
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Performance
MAX_MEMORY_MB=2048
CLEANUP_INTERVAL=180000
```

---

**Configuration Best Practices:**

1. **Use environment variables** for secrets and environment-specific settings
2. **Validate all configuration** before starting the application
3. **Document changes** when modifying configuration
4. **Test configurations** in non-production environments first
5. **Use configuration versioning** for change tracking
6. **Implement configuration backup** and restore procedures
7. **Monitor configuration changes** through audit logs

**Security Notes:**

- Never commit secrets to version control
- Use strong encryption keys and rotate them regularly
- Limit access to configuration files
- Validate all configuration inputs
- Use secure defaults for all settings

**Last Updated**: January 2025
