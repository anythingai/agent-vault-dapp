# API Reference

## Table of Contents

- [Authentication](#authentication)
- [Rate Limit Headers](#rate-limit-headers)
- [Error Responses](#error-responses)
- [Core API Endpoints](#core-api-endpoints)
- [Admin API Endpoints](#admin-api-endpoints)
- [Monitoring API Endpoints](#monitoring-api-endpoints)
- [WebSocket API](#websocket-api)
- [SDK Examples](#sdk-examples)

## Authentication

All API requests require authentication using API keys or JWT tokens.

### API Key Authentication

```http
GET /api/swap/quote HTTP/1.1
Host: api.1inch.io
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### JWT Token Authentication

```http
GET /api/swap/quote HTTP/1.1
Host: api.1inch.io
Authorization: JWT YOUR_JWT_TOKEN
Content-Type: application/json
```

### Getting API Keys

1. Visit the [Admin Panel](http://localhost:8081/admin)
2. Navigate to API Keys section
3. Generate a new API key for your application
4. Store the key securely (it won't be shown again)

## Rate Limit Headers

Every API response includes rate limiting information:

### Standard Headers

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Requests allowed per window | `50` |
| `X-RateLimit-Remaining` | Requests remaining in current window | `47` |
| `X-RateLimit-Reset` | Unix timestamp when limit resets | `1640995200` |
| `X-RateLimit-Type` | Rate limiting algorithm used | `sliding_window` |
| `X-RateLimit-Tier` | Your current subscription tier | `premium` |
| `X-RateLimit-Window` | Time window in seconds | `60` |

### Enhanced Headers

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Retry-After` | Seconds to wait before retry | `30` |
| `X-RateLimit-Scope` | Scope of the rate limit | `user` |
| `X-RateLimit-Policy` | Applied rate limiting policy | `tier_based` |
| `X-Circuit-Breaker` | Circuit breaker status | `closed` |
| `X-Cross-Chain-Pool` | Cross-chain resource usage | `ethereum:45/100` |

### Header Examples

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 185
X-RateLimit-Reset: 1640995260
X-RateLimit-Type: sliding_window
X-RateLimit-Tier: premium
X-RateLimit-Window: 60
X-RateLimit-Retry-After: 0
X-Circuit-Breaker: closed
Content-Type: application/json

{
  "quote": {
    "fromToken": "0xA0b86a33E6417...",
    "toToken": "0x6B175474E89...",
    "amount": "1000000000000000000"
  }
}
```

## Error Responses

### Rate Limit Exceeded (429)

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 50
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640995320
X-RateLimit-Retry-After: 60
Content-Type: application/json

{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please wait before making another request.",
  "details": {
    "limit": 50,
    "window": 60,
    "retryAfter": 60,
    "tier": "basic"
  },
  "documentation": "https://docs.1inch.io/rate-limiting"
}
```

### Service Unavailable (503)

```http
HTTP/1.1 503 Service Unavailable
X-Circuit-Breaker: open
X-RateLimit-Retry-After: 300
Content-Type: application/json

{
  "error": "SERVICE_UNAVAILABLE",
  "message": "Service temporarily unavailable due to high load.",
  "details": {
    "reason": "circuit_breaker_open",
    "estimatedRecovery": "2024-01-01T12:05:00Z"
  }
}
```

### Quota Exceeded

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": "QUOTA_EXCEEDED",
  "message": "Daily quota exceeded for your tier.",
  "details": {
    "tier": "basic",
    "dailyLimit": 10000,
    "used": 10000,
    "resetTime": "2024-01-02T00:00:00Z",
    "upgradeUrl": "https://1inch.io/upgrade"
  }
}
```

## Core API Endpoints

### Swap Operations

#### Get Quote

Get a quote for token swap.

```http
GET /api/swap/quote
```

**Parameters:**

- `fromToken` (required): Source token contract address
- `toToken` (required): Destination token contract address  
- `amount` (required): Amount to swap (in wei)
- `slippage` (optional): Max acceptable slippage (default: 1%)
- `gasPrice` (optional): Gas price in gwei

**Rate Limits:**

- Free: 10/min, 100/hour, 1,000/day
- Basic: 50/min, 1,000/hour, 10,000/day
- Premium: 200/min, 10,000/hour, 100,000/day
- Enterprise: 1,000/min, 50,000/hour, 1,000,000/day

**Example Request:**

```bash
curl -X GET "https://api.1inch.io/api/swap/quote" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -G \
  -d "fromToken=0xA0b86a33E64..." \
  -d "toToken=0x6B175474E89..." \
  -d "amount=1000000000000000000"
```

**Example Response:**

```json
{
  "quote": {
    "fromToken": "0xA0b86a33E6417...",
    "toToken": "0x6B175474E89...", 
    "fromAmount": "1000000000000000000",
    "toAmount": "1850340000000000000000",
    "gasEstimate": 180000,
    "slippage": 0.01,
    "priceImpact": 0.002,
    "route": [
      {
        "protocol": "uniswap_v3",
        "percentage": 100
      }
    ]
  },
  "metadata": {
    "requestId": "req_12345",
    "timestamp": "2024-01-01T12:00:00Z",
    "processingTime": 45
  }
}
```

#### Execute Swap

Execute a token swap.

```http
POST /api/swap/execute
```

**Rate Limits:**

- Free: 5/min, 50/hour, 500/day  
- Basic: 25/min, 500/hour, 5,000/day
- Premium: 100/min, 5,000/hour, 50,000/day
- Enterprise: 500/min, 25,000/hour, 500,000/day

**Request Body:**

```json
{
  "fromToken": "0xA0b86a33E6417...",
  "toToken": "0x6B175474E89...",
  "amount": "1000000000000000000",
  "slippage": 0.01,
  "userAddress": "0x742d35Cc643...",
  "signature": "0x1b2c3d4e5f..."
}
```

#### Cross-Chain Swap

Execute a cross-chain swap between Ethereum and Bitcoin.

```http
POST /api/swap/cross-chain
```

**Rate Limits:**

- Free: 5/day (special cross-chain allocation)
- Basic: 100/day  
- Premium: 1,000/day
- Enterprise: 10,000/day

**Additional Headers:**

- `X-Cross-Chain-Priority`: Priority level (low, normal, high)
- `X-Cross-Chain-Timeout`: Maximum execution time in seconds

### User Operations

#### Get User Balance

Retrieve user token balances.

```http
GET /api/user/balance
```

#### Get User History

Retrieve user transaction history.

```http
GET /api/user/history
```

**Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50, max: 200)
- `from` (optional): Start date (ISO 8601)
- `to` (optional): End date (ISO 8601)

### Market Data

#### Get Token Prices

Get current token prices.

```http
GET /api/market/prices
```

#### Get Token List

Get supported token list.

```http
GET /api/market/tokens
```

## Admin API Endpoints

**Base URL:** `http://localhost:8081/api/admin`

**Authentication:** Requires admin-level API key or session

### Rate Limit Management

#### Get Rate Limit Policies

```http
GET /api/admin/rate-limits/policies
```

#### Update Rate Limit Policy

```http
PUT /api/admin/rate-limits/policies/{policyId}
```

**Request Body:**

```json
{
  "name": "premium_tier",
  "limits": {
    "requestsPerMinute": 200,
    "requestsPerHour": 10000,
    "requestsPerDay": 100000,
    "concurrentRequests": 20
  },
  "algorithms": {
    "primary": "sliding_window",
    "fallback": "token_bucket"
  }
}
```

#### Get User Rate Limit Status

```http
GET /api/admin/rate-limits/users/{userId}
```

### User Management

#### Get User List

```http
GET /api/admin/users
```

#### Update User Tier

```http
PUT /api/admin/users/{userId}/tier
```

**Request Body:**

```json
{
  "tier": "premium",
  "reason": "Subscription upgrade",
  "effectiveDate": "2024-01-01T00:00:00Z"
}
```

### System Management

#### Get System Health

```http
GET /api/admin/system/health
```

**Response:**

```json
{
  "status": "healthy",
  "components": {
    "rateLimit": {
      "status": "healthy",
      "responseTime": 15,
      "requestsPerSecond": 450
    },
    "database": {
      "status": "healthy", 
      "responseTime": 8,
      "connections": 12
    },
    "circuitBreaker": {
      "status": "closed",
      "failureRate": 0.02,
      "lastTrip": null
    }
  },
  "metrics": {
    "uptime": 86400,
    "totalRequests": 1250000,
    "blockedRequests": 15000,
    "averageResponseTime": 125
  }
}
```

## Monitoring API Endpoints

**Base URL:** `http://localhost:3000/api/monitoring`

### Metrics

#### Get Rate Limit Metrics

```http
GET /api/monitoring/rate-limits/metrics
```

**Parameters:**

- `period` (optional): Time period (1h, 24h, 7d, 30d)
- `tier` (optional): Filter by user tier
- `endpoint` (optional): Filter by endpoint

**Response:**

```json
{
  "period": "24h",
  "metrics": {
    "totalRequests": 125000,
    "blockedRequests": 2500,
    "averageResponseTime": 145,
    "rateLimitHits": 500,
    "circuitBreakerTrips": 2
  },
  "breakdown": {
    "byTier": {
      "free": { "requests": 25000, "blocked": 1200 },
      "basic": { "requests": 50000, "blocked": 800 },
      "premium": { "requests": 35000, "blocked": 300 },
      "enterprise": { "requests": 15000, "blocked": 200 }
    },
    "byEndpoint": {
      "/api/swap/quote": { "requests": 75000, "blocked": 1500 },
      "/api/swap/execute": { "requests": 30000, "blocked": 600 },
      "/api/user/balance": { "requests": 20000, "blocked": 400 }
    }
  }
}
```

### Alerts

#### Get Active Alerts

```http
GET /api/monitoring/alerts/active
```

#### Create Alert Rule

```http
POST /api/monitoring/alerts/rules
```

**Request Body:**

```json
{
  "name": "High Rate Limit Violations",
  "condition": {
    "metric": "rate_limit_violations",
    "operator": ">",
    "threshold": 100,
    "period": "5m"
  },
  "actions": {
    "email": ["admin@1inch.io"],
    "webhook": "https://hooks.slack.com/..."
  }
}
```

## WebSocket API

Real-time updates for rate limiting and system status.

**Connection:** `ws://localhost:3000/ws`

### Authentication

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'authenticate',
    token: 'YOUR_API_KEY'
  }));
};
```

### Subscribe to Rate Limit Updates

```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'rate-limits',
  filters: {
    userId: 'your-user-id'
  }
}));
```

### Rate Limit Events

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'rate-limit-warning':
      console.log('Rate limit warning:', data.payload);
      break;
      
    case 'rate-limit-exceeded':
      console.log('Rate limit exceeded:', data.payload);
      break;
      
    case 'circuit-breaker-open':
      console.log('Circuit breaker opened:', data.payload);
      break;
      
    case 'system-overload':
      console.log('System overload detected:', data.payload);
      break;
  }
};
```

## SDK Examples

### JavaScript/TypeScript SDK

#### Installation

```bash
npm install @1inch/fusion-sdk
```

#### Basic Usage

```typescript
import { FusionSDK } from '@1inch/fusion-sdk';

const sdk = new FusionSDK({
  apiKey: 'YOUR_API_KEY',
  baseUrl: 'https://api.1inch.io',
  rateLimitStrategy: 'exponential-backoff'
});

// Get quote with automatic rate limit handling
try {
  const quote = await sdk.getQuote({
    fromToken: '0xA0b86a33E6417...',
    toToken: '0x6B175474E89...',
    amount: '1000000000000000000'
  });
  
  console.log('Quote:', quote);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  }
}
```

#### Advanced Configuration

```typescript
const sdk = new FusionSDK({
  apiKey: 'YOUR_API_KEY',
  rateLimitStrategy: {
    type: 'exponential-backoff',
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 30000
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeout: 60000
  }
});

// Monitor rate limit usage
sdk.on('rate-limit-warning', (event) => {
  console.log(`Rate limit warning: ${event.remaining} requests remaining`);
});

sdk.on('rate-limit-exceeded', (event) => {
  console.log(`Rate limited until ${new Date(event.resetTime)}`);
});
```

### Python SDK

#### Installation

```bash
pip install inch-fusion-sdk
```

#### Basic Usage

```python
from inch_fusion import FusionClient, RateLimitError

client = FusionClient(
    api_key='YOUR_API_KEY',
    base_url='https://api.1inch.io'
)

try:
    quote = client.get_quote(
        from_token='0xA0b86a33E6417...',
        to_token='0x6B175474E89...',
        amount='1000000000000000000'
    )
    print(f"Quote: {quote}")
    
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
```

### cURL Examples

#### Get Quote with Rate Limit Monitoring

```bash
#!/bin/bash

API_KEY="YOUR_API_KEY"
ENDPOINT="https://api.1inch.io/api/swap/quote"

response=$(curl -s -w "%{http_code}" \
  -H "Authorization: Bearer $API_KEY" \
  -G \
  -d "fromToken=0xA0b86a33E6417..." \
  -d "toToken=0x6B175474E89..." \
  -d "amount=1000000000000000000" \
  "$ENDPOINT")

http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "429" ]; then
  retry_after=$(echo "$response" | grep -i "x-ratelimit-retry-after" | cut -d: -f2 | tr -d ' ')
  echo "Rate limited. Retry after ${retry_after}s"
  sleep "$retry_after"
  # Retry the request...
else
  echo "Response: $body"
fi
```

---

**Rate Limiting Best Practices:**

1. Always check rate limit headers
2. Implement exponential backoff for retries
3. Cache responses when appropriate
4. Use batch endpoints when available
5. Monitor your usage patterns
6. Handle 429 and 503 errors gracefully

**Need Help?**

- 📖 See [Integration Guide](./integration-guide.md) for detailed examples
- 💬 Join our developer community
- 📧 Contact API support: <api-support@1inch.io>

**Last Updated**: January 2025
