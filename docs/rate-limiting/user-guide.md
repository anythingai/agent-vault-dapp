# Rate Limiting User Guide

## Table of Contents

- [Overview](#overview)
- [User Tiers](#user-tiers)
- [Understanding Rate Limits](#understanding-rate-limits)
- [Monitoring Your Usage](#monitoring-your-usage)
- [Best Practices](#best-practices)
- [Common Scenarios](#common-scenarios)
- [Error Handling](#error-handling)
- [Upgrading Your Tier](#upgrading-your-tier)

## Overview

The 1inch Fusion+ Cross-Chain Swap Extension implements a comprehensive rate limiting system to ensure fair resource usage and system stability. This guide explains how the system works from a user perspective and how to optimize your usage.

### What Are Rate Limits?

Rate limits control how many requests you can make to our API within specific time periods. They prevent system overload and ensure all users get fair access to resources.

### Why Do We Have Rate Limits?

- **System Stability**: Prevent overload and maintain reliable service
- **Fair Usage**: Ensure all users get equal access to resources
- **Security**: Protect against abuse and DOS attacks
- **Performance**: Maintain fast response times for all users

## User Tiers

Our system uses a tiered approach where your limits depend on your subscription level:

### 🆓 Free Tier

**Perfect for**: Individual developers, testing, small projects

**Limits**:

- **Requests per Minute**: 10
- **Requests per Hour**: 100
- **Requests per Day**: 1,000
- **Concurrent Requests**: 2
- **Cross-Chain Operations**: 5 per day
- **API Endpoints**: Basic swap operations only

**Features**:

- ✅ Basic API access
- ✅ Standard support documentation
- ✅ Community forum access
- ❌ No premium features
- ❌ Limited cross-chain operations

### 💼 Basic Tier

**Perfect for**: Small businesses, active traders, medium projects

**Limits**:

- **Requests per Minute**: 50
- **Requests per Hour**: 1,000
- **Requests per Day**: 10,000
- **Concurrent Requests**: 5
- **Cross-Chain Operations**: 100 per day
- **API Endpoints**: All public endpoints

**Features**:

- ✅ Enhanced API access
- ✅ Email support
- ✅ Basic analytics dashboard
- ✅ Standard cross-chain operations
- ❌ No priority support

### ⭐ Premium Tier

**Perfect for**: Large businesses, high-frequency trading, enterprise apps

**Limits**:

- **Requests per Minute**: 200
- **Requests per Hour**: 10,000
- **Requests per Day**: 100,000
- **Concurrent Requests**: 20
- **Cross-Chain Operations**: 1,000 per day
- **API Endpoints**: All endpoints including advanced features

**Features**:

- ✅ Full API access
- ✅ Priority support
- ✅ Advanced analytics dashboard
- ✅ Enhanced cross-chain operations
- ✅ Custom rate limit adjustments
- ✅ 99.9% SLA guarantee

### 🏢 Enterprise Tier

**Perfect for**: Large enterprises, institutional traders, exchange integrations

**Limits**:

- **Requests per Minute**: 1,000
- **Requests per Hour**: 50,000
- **Requests per Day**: 1,000,000
- **Concurrent Requests**: 100
- **Cross-Chain Operations**: 10,000 per day
- **API Endpoints**: All endpoints + beta features

**Features**:

- ✅ Unlimited API access
- ✅ Dedicated account manager
- ✅ Custom integration support
- ✅ Advanced monitoring tools
- ✅ Custom SLA agreements
- ✅ Beta feature access
- ✅ On-premise deployment options

## Understanding Rate Limits

### Time Windows

Rate limits are enforced across multiple time windows:

1. **Per Minute**: Short-term burst protection
2. **Per Hour**: Medium-term usage control
3. **Per Day**: Long-term fair usage policy

### Limit Types

1. **Request Limits**: Total number of API calls
2. **Concurrent Limits**: Simultaneous active requests
3. **Endpoint-Specific Limits**: Different limits for different operations
4. **Cross-Chain Limits**: Special limits for cross-chain operations

### How Limits Reset

- **Rolling Windows**: Limits reset continuously (recommended)
- **Fixed Windows**: Limits reset at specific intervals
- **Sliding Windows**: Most recent activity determines current limit

## Monitoring Your Usage

### HTTP Headers

Every API response includes rate limit information in headers:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 50
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1640995200
X-RateLimit-Type: sliding_window
X-RateLimit-Tier: basic
X-RateLimit-Retry-After: 60
```

**Header Explanations**:

- `X-RateLimit-Limit`: Your current rate limit
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `X-RateLimit-Type`: Type of rate limiting algorithm
- `X-RateLimit-Tier`: Your current subscription tier
- `X-RateLimit-Retry-After`: Seconds to wait if rate limited

### User Dashboard

Access your usage dashboard at: `http://localhost:8081/dashboard`

**Dashboard Features**:

- 📊 Real-time usage statistics
- 📈 Historical usage charts
- ⚠️ Rate limit warnings
- 🔍 Request analysis
- 📋 Tier comparison
- 🎯 Usage recommendations

### Programmatic Monitoring

Use our monitoring API to check your usage:

```javascript
const response = await fetch('/api/user/usage', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

const usage = await response.json();
console.log('Current usage:', usage);
```

## Best Practices

### 1. Implement Proper Error Handling

Always check for rate limit responses:

```javascript
async function makeAPICall() {
  try {
    const response = await fetch('/api/swap/quote');
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('X-RateLimit-Retry-After');
      console.log(`Rate limited. Retry after ${retryAfter} seconds`);
      await sleep(retryAfter * 1000);
      return makeAPICall(); // Retry
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
  }
}
```

### 2. Use Exponential Backoff

Implement exponential backoff for retries:

```javascript
async function makeAPICallWithBackoff(maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('/api/swap/quote');
      
      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
        await sleep(delay);
        continue;
      }
      
      return await response.json();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### 3. Cache Responses When Possible

Reduce API calls by caching responses:

```javascript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function getCachedQuote(tokenPair) {
  const cacheKey = `quote_${tokenPair}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const quote = await fetch(`/api/swap/quote?pair=${tokenPair}`);
  cache.set(cacheKey, {
    data: quote,
    timestamp: Date.now()
  });
  
  return quote;
}
```

### 4. Batch Requests When Possible

Use batch endpoints to reduce request count:

```javascript
// Instead of multiple requests
const quotes = await Promise.all([
  fetch('/api/swap/quote?pair=ETH-USDC'),
  fetch('/api/swap/quote?pair=BTC-ETH'),
  fetch('/api/swap/quote?pair=USDT-DAI')
]);

// Use batch endpoint
const batchQuotes = await fetch('/api/swap/quotes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pairs: ['ETH-USDC', 'BTC-ETH', 'USDT-DAI']
  })
});
```

### 5. Monitor Your Usage

Regularly check your usage patterns:

```javascript
// Check remaining requests before making calls
function checkRateLimit(response) {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const resetTime = response.headers.get('X-RateLimit-Reset');
  
  if (remaining < 5) {
    console.warn(`Only ${remaining} requests remaining until ${new Date(resetTime * 1000)}`);
  }
}
```

## Common Scenarios

### Scenario 1: High-Frequency Trading

If you're building a high-frequency trading application:

1. **Upgrade to Premium/Enterprise**: Get higher limits
2. **Use WebSocket connections**: Real-time data with fewer API calls
3. **Implement smart caching**: Cache market data appropriately
4. **Batch operations**: Group multiple trades when possible

### Scenario 2: Mobile Application

For mobile app integration:

1. **Cache aggressively**: Mobile users expect fast responses
2. **Use background refresh**: Update data periodically, not on-demand
3. **Implement offline mode**: Graceful degradation when limits hit
4. **Consider user tiers**: Offer premium features for higher tiers

### Scenario 3: Analytics Dashboard

For building analytics dashboards:

1. **Pre-aggregate data**: Use historical data endpoints
2. **Schedule updates**: Update data at regular intervals
3. **Use appropriate intervals**: Don't refresh faster than needed
4. **Cache calculations**: Store computed metrics locally

### Scenario 4: Cross-Chain Operations

For cross-chain swap integrations:

1. **Understand coordination**: Cross-chain ops use shared resources
2. **Plan timing**: Allow extra time for cross-chain coordination
3. **Handle complexity**: More error conditions to manage
4. **Monitor both chains**: Track usage on Ethereum and Bitcoin

## Error Handling

### Rate Limit Exceeded (429)

```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  const rateLimitType = response.headers.get('X-RateLimit-Type');
  
  console.log(`Rate limited (${rateLimitType}). Retry in ${retryAfter}s`);
  
  // Show user-friendly message
  showMessage(`Please wait ${retryAfter} seconds before trying again`);
  
  // Schedule retry
  setTimeout(() => retryRequest(), retryAfter * 1000);
}
```

### Service Unavailable (503)

```javascript
if (response.status === 503) {
  const circuitBreaker = response.headers.get('X-Circuit-Breaker');
  
  if (circuitBreaker === 'open') {
    console.log('Circuit breaker activated. Service temporarily unavailable');
    showMessage('Service is temporarily unavailable. Please try again later.');
  }
}
```

### Quota Exceeded

```javascript
const errorData = await response.json();

if (errorData.error === 'QUOTA_EXCEEDED') {
  console.log('Daily quota exceeded');
  showUpgradePrompt('You\'ve reached your daily limit. Consider upgrading your tier.');
}
```

## Upgrading Your Tier

### When to Upgrade

Consider upgrading when you experience:

- ⚠️ Frequent rate limit errors (429 responses)
- 🐌 Slower development due to limits
- 📈 Growing user base requiring more requests
- 🔗 Need for more cross-chain operations
- 🎯 Desire for premium features

### How to Upgrade

1. **Visit Admin Panel**: Go to `http://localhost:8081/admin`
2. **Review Usage**: Check your current usage patterns
3. **Compare Tiers**: Review tier benefits and limits
4. **Contact Support**: For enterprise needs
5. **Monitor Impact**: Track improvements after upgrade

### Upgrade Benefits

#### From Free to Basic

- 5x more requests per minute
- 10x more daily requests
- Email support
- Cross-chain operations

#### From Basic to Premium

- 4x more requests per minute
- 10x more daily requests
- Priority support
- Advanced analytics
- Custom configurations

#### From Premium to Enterprise

- 5x more requests per minute
- 10x more daily requests
- Dedicated support
- Custom SLA
- Beta features

---

**Need Help?**

- 📖 Check our [troubleshooting guide](./troubleshooting.md)
- 💬 Visit our community forum
- 📧 Contact support at <support@1inch.io>
- 📞 Enterprise customers: Call your account manager

**Last Updated**: January 2025
