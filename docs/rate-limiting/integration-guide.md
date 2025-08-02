# Integration Guide

## Table of Contents

- [Getting Started](#getting-started)
- [Authentication Setup](#authentication-setup)
- [Basic Integration](#basic-integration)
- [Advanced Features](#advanced-features)
- [Error Handling](#error-handling)
- [Testing Integration](#testing-integration)
- [Production Deployment](#production-deployment)
- [Framework-Specific Examples](#framework-specific-examples)

## Getting Started

### Prerequisites

- **API Access**: Register for an API key at the admin interface
- **Node.js**: Version 16+ (for JavaScript/TypeScript examples)
- **HTTP Client**: Any HTTP library (fetch, axios, curl)
- **Understanding**: Basic knowledge of rate limiting concepts

### Quick Start Checklist

1. ✅ **Get API Key**: Register and obtain your API key
2. ✅ **Choose Tier**: Select appropriate tier for your needs
3. ✅ **Set Up Environment**: Configure your development environment
4. ✅ **Install Dependencies**: Add required libraries to your project
5. ✅ **Test Connection**: Verify API connectivity
6. ✅ **Implement Error Handling**: Add proper error handling
7. ✅ **Monitor Usage**: Set up usage monitoring

## Authentication Setup

### API Key Authentication

The most common authentication method uses Bearer tokens:

```javascript
// Set up your API key
const API_KEY = 'your_api_key_here';
const BASE_URL = 'https://api.1inch.io';

// Create authenticated request function
async function makeAuthenticatedRequest(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  return response;
}
```

### Environment Configuration

Set up environment variables for different environments:

```bash
# .env.development
API_KEY=dev_api_key_here
BASE_URL=http://localhost:3000

# .env.production  
API_KEY=prod_api_key_here
BASE_URL=https://api.1inch.io

# .env.test
API_KEY=test_api_key_here
BASE_URL=http://localhost:3001
```

### JWT Authentication (Advanced)

For applications requiring user-specific authentication:

```javascript
// JWT authentication setup
class FusionClient {
  constructor(options) {
    this.baseURL = options.baseURL;
    this.jwtToken = null;
  }
  
  async authenticate(credentials) {
    const response = await fetch(`${this.baseURL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    
    const data = await response.json();
    this.jwtToken = data.token;
    
    return this.jwtToken;
  }
  
  async makeRequest(endpoint, options = {}) {
    return fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `JWT ${this.jwtToken}`,
        ...options.headers
      }
    });
  }
}
```

## Basic Integration

### Simple Swap Quote Example

```javascript
// Basic swap quote implementation
class SwapService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.1inch.io';
  }
  
  async getSwapQuote(fromToken, toToken, amount) {
    try {
      const response = await fetch(`${this.baseURL}/api/swap/quote`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: new URLSearchParams({
          fromToken,
          toToken,
          amount: amount.toString()
        })
      });
      
      // Check rate limiting headers
      this.checkRateLimits(response);
      
      if (response.status === 429) {
        return this.handleRateLimit(response);
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
      
    } catch (error) {
      console.error('Failed to get swap quote:', error);
      throw error;
    }
  }
  
  checkRateLimits(response) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const resetTime = response.headers.get('X-RateLimit-Reset');
    const tier = response.headers.get('X-RateLimit-Tier');
    
    console.log(`Rate Limit Info - Remaining: ${remaining}, Tier: ${tier}`);
    
    if (remaining && parseInt(remaining) < 5) {
      console.warn('Rate limit approaching! Consider implementing backoff.');
    }
  }
  
  async handleRateLimit(response) {
    const retryAfter = response.headers.get('X-RateLimit-Retry-After');
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    
    // Implement exponential backoff
    await this.sleep(parseInt(retryAfter) * 1000);
    
    // Retry the request (implement retry logic here)
    return null;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const swapService = new SwapService('your_api_key');
const quote = await swapService.getSwapQuote(
  '0xA0b86a33E6417...',  // USDT
  '0x6B175474E89...',    // DAI  
  '1000000'              // 1 USDT
);
```

### Batch Operations Example

```javascript
// Efficient batch operations to reduce API calls
class BatchSwapService extends SwapService {
  constructor(apiKey, batchSize = 10) {
    super(apiKey);
    this.batchSize = batchSize;
    this.requestQueue = [];
    this.processing = false;
  }
  
  async getMultipleQuotes(requests) {
    // Use batch endpoint when available
    if (requests.length <= this.batchSize) {
      return this.getBatchQuotes(requests);
    }
    
    // Split into batches for larger requests
    const batches = this.chunkArray(requests, this.batchSize);
    const results = [];
    
    for (const batch of batches) {
      const batchResults = await this.getBatchQuotes(batch);
      results.push(...batchResults);
      
      // Small delay between batches to respect rate limits
      await this.sleep(100);
    }
    
    return results;
  }
  
  async getBatchQuotes(requests) {
    try {
      const response = await fetch(`${this.baseURL}/api/swap/quotes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      });
      
      this.checkRateLimits(response);
      
      if (response.status === 429) {
        return this.handleRateLimit(response);
      }
      
      return await response.json();
      
    } catch (error) {
      console.error('Batch quote request failed:', error);
      throw error;
    }
  }
  
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
```

## Advanced Features

### Circuit Breaker Implementation

```javascript
// Client-side circuit breaker for handling service failures
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 60000;
    this.monitoringPeriod = options.monitoringPeriod || 10000;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }
  
  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.recoveryTimeout;
    }
  }
}

// Usage with SwapService
class ResilientSwapService extends SwapService {
  constructor(apiKey) {
    super(apiKey);
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeout: 30000
    });
  }
  
  async getSwapQuote(fromToken, toToken, amount) {
    return this.circuitBreaker.execute(async () => {
      return super.getSwapQuote(fromToken, toToken, amount);
    });
  }
}
```

### Caching Strategy

```javascript
// Intelligent caching to reduce API calls
class CachedSwapService extends SwapService {
  constructor(apiKey, cacheOptions = {}) {
    super(apiKey);
    this.cache = new Map();
    this.cacheTTL = cacheOptions.ttl || 30000; // 30 seconds
    this.maxCacheSize = cacheOptions.maxSize || 1000;
  }
  
  async getSwapQuote(fromToken, toToken, amount) {
    const cacheKey = `${fromToken}:${toToken}:${amount}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log('Cache hit for quote request');
      return cached.data;
    }
    
    const result = await super.getSwapQuote(fromToken, toToken, amount);
    
    // Cache the result
    this.setCache(cacheKey, result);
    
    return result;
  }
  
  setCache(key, data) {
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entries (LRU eviction)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  clearCache() {
    this.cache.clear();
  }
}
```

### WebSocket Integration

```javascript
// Real-time rate limit monitoring via WebSocket
class RealTimeSwapService extends SwapService {
  constructor(apiKey) {
    super(apiKey);
    this.ws = null;
    this.rateLimitStatus = null;
  }
  
  async connectWebSocket() {
    this.ws = new WebSocket('ws://localhost:3000/ws');
    
    this.ws.onopen = () => {
      // Authenticate WebSocket connection
      this.ws.send(JSON.stringify({
        type: 'authenticate',
        token: this.apiKey
      }));
      
      // Subscribe to rate limit updates
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'rate-limits'
      }));
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'rate-limit-status':
        this.rateLimitStatus = data.payload;
        break;
        
      case 'rate-limit-warning':
        console.warn('Rate limit warning:', data.payload);
        this.onRateLimitWarning(data.payload);
        break;
        
      case 'circuit-breaker-open':
        console.error('Circuit breaker opened:', data.payload);
        this.onCircuitBreakerOpen(data.payload);
        break;
    }
  }
  
  onRateLimitWarning(data) {
    // Implement custom logic for rate limit warnings
    console.log(`Warning: ${data.remaining} requests remaining`);
  }
  
  onCircuitBreakerOpen(data) {
    // Handle circuit breaker events
    console.log(`Circuit breaker opened for: ${data.service}`);
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

## Error Handling

### Comprehensive Error Handling

```javascript
// Custom error classes for different error types
class RateLimitError extends Error {
  constructor(message, retryAfter, tier) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.tier = tier;
    this.status = 429;
  }
}

class CircuitBreakerError extends Error {
  constructor(message, estimatedRecovery) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.estimatedRecovery = estimatedRecovery;
    this.status = 503;
  }
}

class QuotaExceededError extends Error {
  constructor(message, tier, resetTime) {
    super(message);
    this.name = 'QuotaExceededError';
    this.tier = tier;
    this.resetTime = resetTime;
    this.status = 402;
  }
}

// Enhanced service with comprehensive error handling
class RobustSwapService extends SwapService {
  async getSwapQuote(fromToken, toToken, amount, retryOptions = {}) {
    const maxRetries = retryOptions.maxRetries || 3;
    const baseDelay = retryOptions.baseDelay || 1000;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseURL}/api/swap/quote`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          params: new URLSearchParams({
            fromToken,
            toToken,
            amount: amount.toString()
          })
        });
        
        return await this.handleResponse(response);
        
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error; // Last attempt, throw the error
        }
        
        if (this.shouldRetry(error)) {
          const delay = this.calculateDelay(attempt, baseDelay);
          console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
          await this.sleep(delay);
          continue;
        } else {
          throw error; // Don't retry for certain error types
        }
      }
    }
  }
  
  async handleResponse(response) {
    const responseData = response.status !== 204 ? await response.json() : null;
    
    switch (response.status) {
      case 200:
        return responseData;
        
      case 429:
        const retryAfter = response.headers.get('X-RateLimit-Retry-After');
        const tier = response.headers.get('X-RateLimit-Tier');
        throw new RateLimitError(
          responseData?.message || 'Rate limit exceeded',
          parseInt(retryAfter),
          tier
        );
        
      case 503:
        const estimatedRecovery = responseData?.details?.estimatedRecovery;
        throw new CircuitBreakerError(
          responseData?.message || 'Service temporarily unavailable',
          estimatedRecovery
        );
        
      case 402:
        const resetTime = responseData?.details?.resetTime;
        const userTier = responseData?.details?.tier;
        throw new QuotaExceededError(
          responseData?.message || 'Quota exceeded',
          userTier,
          resetTime
        );
        
      default:
        throw new Error(`HTTP ${response.status}: ${responseData?.message || 'Unknown error'}`);
    }
  }
  
  shouldRetry(error) {
    // Don't retry quota exceeded errors
    if (error instanceof QuotaExceededError) {
      return false;
    }
    
    // Don't retry authentication errors
    if (error.status === 401 || error.status === 403) {
      return false;
    }
    
    // Retry rate limit and service errors
    return error instanceof RateLimitError || 
           error instanceof CircuitBreakerError ||
           error.status >= 500;
  }
  
  calculateDelay(attempt, baseDelay) {
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add randomness
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }
}
```

### Error Recovery Strategies

```javascript
// Error recovery with fallback mechanisms
class FallbackSwapService extends RobustSwapService {
  constructor(apiKey, fallbackOptions = {}) {
    super(apiKey);
    this.fallbackEndpoints = fallbackOptions.endpoints || [];
    this.fallbackCache = new Map();
  }
  
  async getSwapQuote(fromToken, toToken, amount) {
    try {
      return await super.getSwapQuote(fromToken, toToken, amount);
    } catch (error) {
      console.log('Primary endpoint failed, trying fallbacks:', error.message);
      return await this.tryFallbacks(fromToken, toToken, amount, error);
    }
  }
  
  async tryFallbacks(fromToken, toToken, amount, primaryError) {
    // Try cached result first
    const cached = this.getCachedFallback(fromToken, toToken, amount);
    if (cached) {
      console.log('Using cached fallback result');
      return { ...cached, fallback: true, cached: true };
    }
    
    // Try alternative endpoints
    for (const endpoint of this.fallbackEndpoints) {
      try {
        const result = await this.queryFallbackEndpoint(endpoint, fromToken, toToken, amount);
        this.cacheFallbackResult(fromToken, toToken, amount, result);
        return { ...result, fallback: true };
      } catch (fallbackError) {
        console.log(`Fallback endpoint ${endpoint} also failed:`, fallbackError.message);
      }
    }
    
    // All fallbacks failed, throw original error
    throw primaryError;
  }
  
  async queryFallbackEndpoint(endpoint, fromToken, toToken, amount) {
    // Implementation depends on fallback service API
    // This is a simplified example
    const response = await fetch(`${endpoint}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromToken, toToken, amount })
    });
    
    if (!response.ok) {
      throw new Error(`Fallback endpoint error: ${response.status}`);
    }
    
    return await response.json();
  }
  
  getCachedFallback(fromToken, toToken, amount) {
    const key = `${fromToken}:${toToken}:${amount}`;
    const cached = this.fallbackCache.get(key);
    
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes TTL
      return cached.data;
    }
    
    return null;
  }
  
  cacheFallbackResult(fromToken, toToken, amount, result) {
    const key = `${fromToken}:${toToken}:${amount}`;
    this.fallbackCache.set(key, {
      data: result,
      timestamp: Date.now()
    });
  }
}
```

## Testing Integration

### Unit Tests Example

```javascript
// Jest unit tests for integration
describe('SwapService', () => {
  let swapService;
  
  beforeEach(() => {
    swapService = new SwapService('test_api_key');
    
    // Mock fetch globally
    global.fetch = jest.fn();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  test('should get swap quote successfully', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Map([
        ['X-RateLimit-Remaining', '45'],
        ['X-RateLimit-Tier', 'basic']
      ]),
      json: async () => ({
        quote: {
          fromToken: '0xA0b86a33E6417...',
          toToken: '0x6B175474E89...',
          fromAmount: '1000000',
          toAmount: '995000'
        }
      })
    };
    
    global.fetch.mockResolvedValueOnce(mockResponse);
    
    const result = await swapService.getSwapQuote(
      '0xA0b86a33E6417...',
      '0x6B175474E89...',
      '1000000'
    );
    
    expect(result).toHaveProperty('quote');
    expect(result.quote.fromAmount).toBe('1000000');
  });
  
  test('should handle rate limit error', async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      headers: new Map([
        ['X-RateLimit-Retry-After', '60'],
        ['X-RateLimit-Tier', 'basic']
      ]),
      json: async () => ({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded'
      })
    };
    
    global.fetch.mockResolvedValueOnce(mockResponse);
    
    // Mock the sleep function to avoid actual delays in tests
    jest.spyOn(swapService, 'sleep').mockResolvedValue();
    
    const result = await swapService.getSwapQuote(
      '0xA0b86a33E6417...',
      '0x6B175474E89...',
      '1000000'
    );
    
    expect(swapService.sleep).toHaveBeenCalledWith(60000);
    expect(result).toBeNull(); // handleRateLimit returns null
  });
});
```

### Integration Tests

```javascript
// Integration tests with real API
describe('SwapService Integration', () => {
  let swapService;
  
  beforeAll(() => {
    // Use test API key from environment
    const testApiKey = process.env.TEST_API_KEY;
    if (!testApiKey) {
      throw new Error('TEST_API_KEY environment variable is required');
    }
    
    swapService = new SwapService(testApiKey);
  });
  
  test('should get real swap quote', async () => {
    const result = await swapService.getSwapQuote(
      '0xA0b86a33E6417...', // USDT
      '0x6B175474E89...', // DAI
      '1000000' // 1 USDT
    );
    
    expect(result).toHaveProperty('quote');
    expect(result.quote.fromToken).toBe('0xA0b86a33E6417...');
    expect(result.quote.toToken).toBe('0x6B175474E89...');
  }, 10000); // 10 second timeout
  
  test('should respect rate limits', async () => {
    // Make multiple requests quickly to test rate limiting
    const requests = Array(20).fill().map((_, i) => 
      swapService.getSwapQuote(
        '0xA0b86a33E6417...',
        '0x6B175474E89...',
        `${1000000 + i}`
      )
    );
    
    const results = await Promise.allSettled(requests);
    
    // Some requests should be rate limited
    const rateLimited = results.some(result => 
      result.status === 'rejected' && 
      result.reason.message.includes('rate limit')
    );
    
    // Note: This test might pass if you have high tier limits
    console.log('Rate limited requests detected:', rateLimited);
  }, 30000);
});
```

## Production Deployment

### Environment Configuration

```javascript
// Production configuration setup
class ProductionSwapService extends FallbackSwapService {
  constructor(config = {}) {
    const apiKey = config.apiKey || process.env.FUSION_API_KEY;
    const environment = config.environment || process.env.NODE_ENV || 'development';
    
    super(apiKey, {
      endpoints: config.fallbackEndpoints || []
    });
    
    this.environment = environment;
    this.setupProductionFeatures(config);
  }
  
  setupProductionFeatures(config) {
    // Enable detailed logging in production
    this.logger = config.logger || console;
    
    // Set up monitoring
    if (config.monitoring) {
      this.monitoring = config.monitoring;
      this.enableMetrics();
    }
    
    // Configure health checks
    this.healthCheck = {
      enabled: config.healthCheck !== false,
      interval: config.healthCheckInterval || 30000
    };
    
    if (this.healthCheck.enabled) {
      this.startHealthCheck();
    }
  }
  
  enableMetrics() {
    const originalGetSwapQuote = this.getSwapQuote.bind(this);
    
    this.getSwapQuote = async (...args) => {
      const startTime = Date.now();
      const labels = {
        method: 'getSwapQuote',
        environment: this.environment
      };
      
      try {
        const result = await originalGetSwapQuote(...args);
        
        this.monitoring.recordSuccess(labels, Date.now() - startTime);
        return result;
        
      } catch (error) {
        this.monitoring.recordError(labels, error, Date.now() - startTime);
        throw error;
      }
    };
  }
  
  startHealthCheck() {
    setInterval(async () => {
      try {
        await this.healthCheck();
        this.logger.debug('Health check passed');
      } catch (error) {
        this.logger.error('Health check failed:', error);
      }
    }, this.healthCheck.interval);
  }
  
  async performHealthCheck() {
    // Simple health check - get a small quote
    const healthCheckQuote = await this.getSwapQuote(
      '0xA0b86a33E6417...', // USDT
      '0x6B175474E89...', // DAI
      '1' // Minimal amount
    );
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      response_time: healthCheckQuote.metadata?.processingTime || 0
    };
  }
}
```

### Monitoring and Observability

```javascript
// Production monitoring setup
class MonitoredSwapService extends ProductionSwapService {
  constructor(config) {
    super(config);
    
    this.metrics = {
      requests: 0,
      errors: 0,
      rateLimits: 0,
      responseTimeSum: 0,
      lastReset: Date.now()
    };
    
    // Report metrics every minute
    setInterval(() => this.reportMetrics(), 60000);
  }
  
  async getSwapQuote(...args) {
    const startTime = Date.now();
    this.metrics.requests++;
    
    try {
      const result = await super.getSwapQuote(...args);
      this.metrics.responseTimeSum += Date.now() - startTime;
      return result;
      
    } catch (error) {
      this.metrics.errors++;
      
      if (error instanceof RateLimitError) {
        this.metrics.rateLimits++;
      }
      
      throw error;
    }
  }
  
  reportMetrics() {
    const now = Date.now();
    const duration = now - this.metrics.lastReset;
    
    const report = {
      timestamp: now,
      duration,
      requests: this.metrics.requests,
      errors: this.metrics.errors,
      rateLimits: this.metrics.rateLimits,
      errorRate: this.metrics.requests > 0 ? this.metrics.errors / this.metrics.requests : 0,
      averageResponseTime: this.metrics.requests > 0 ? 
        this.metrics.responseTimeSum / this.metrics.requests : 0,
      requestsPerSecond: this.metrics.requests / (duration / 1000)
    };
    
    this.logger.info('Metrics report:', report);
    
    // Send to monitoring system
    if (this.monitoring) {
      this.monitoring.recordMetrics(report);
    }
    
    // Reset metrics
    this.metrics = {
      requests: 0,
      errors: 0,
      rateLimits: 0,
      responseTimeSum: 0,
      lastReset: now
    };
  }
}
```

## Framework-Specific Examples

### React Integration

```jsx
// React hook for swap quotes
import { useState, useEffect, useCallback } from 'react';

function useSwapQuote(fromToken, toToken, amount) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  
  const swapService = useMemo(() => 
    new SwapService(process.env.REACT_APP_API_KEY), []
  );
  
  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !amount) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await swapService.getSwapQuote(fromToken, toToken, amount);
      setQuote(result);
      
      // Extract rate limit info from headers (would need modification to return headers)
      // setRateLimitInfo(result.rateLimitInfo);
      
    } catch (err) {
      setError(err);
      
      if (err instanceof RateLimitError) {
        setRateLimitInfo({
          limited: true,
          retryAfter: err.retryAfter,
          tier: err.tier
        });
      }
    } finally {
      setLoading(false);
    }
  }, [fromToken, toToken, amount, swapService]);
  
  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);
  
  return { quote, loading, error, rateLimitInfo, refetch: fetchQuote };
}

// Component usage
function SwapQuoteDisplay({ fromToken, toToken, amount }) {
  const { quote, loading, error, rateLimitInfo } = useSwapQuote(fromToken, toToken, amount);
  
  if (loading) return <div>Loading quote...</div>;
  
  if (error) {
    if (error instanceof RateLimitError) {
      return (
        <div className="error">
          Rate limit exceeded. Please wait {error.retryAfter} seconds.
          <br />
          Current tier: {error.tier}
        </div>
      );
    }
    
    return <div className="error">Error: {error.message}</div>;
  }
  
  if (!quote) return <div>No quote available</div>;
  
  return (
    <div className="quote">
      <h3>Swap Quote</h3>
      <p>From: {quote.quote.fromAmount} {fromToken}</p>
      <p>To: {quote.quote.toAmount} {toToken}</p>
      <p>Price Impact: {(quote.quote.priceImpact * 100).toFixed(2)}%</p>
      
      {rateLimitInfo && (
        <div className="rate-limit-info">
          <small>
            Rate limit: {rateLimitInfo.remaining || 'N/A'} remaining
          </small>
        </div>
      )}
    </div>
  );
}
```

### Node.js Express Integration

```javascript
// Express.js server integration
const express = require('express');
const { SwapService, RateLimitError } = require('./services/SwapService');

const app = express();
app.use(express.json());

// Initialize swap service
const swapService = new SwapService(process.env.API_KEY);

// Middleware for handling rate limits
const rateLimitHandler = (error, req, res, next) => {
  if (error instanceof RateLimitError) {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: error.message,
      retryAfter: error.retryAfter,
      tier: error.tier
    });
    return;
  }
  
  next(error);
};

// Quote endpoint
app.get('/api/quotes', async (req, res, next) => {
  try {
    const { fromToken, toToken, amount } = req.query;
    
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        error: 'MISSING_PARAMETERS',
        message: 'fromToken, toToken, and amount are required'
      });
    }
    
    const quote = await swapService.getSwapQuote(fromToken, toToken, amount);
    
    res.json({
      success: true,
      data: quote,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
app.use(rateLimitHandler);
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  
  res.status(error.status || 500).json({
    error: error.name || 'INTERNAL_ERROR',
    message: error.message || 'Internal server error'
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Python Integration

```python
import asyncio
import aiohttp
import time
from typing import Optional, Dict, Any

class RateLimitError(Exception):
    def __init__(self, message: str, retry_after: int, tier: str):
        super().__init__(message)
        self.retry_after = retry_after
        self.tier = tier

class SwapService:
    def __init__(self, api_key: str, base_url: str = "https://api.1inch.io"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_swap_quote(
        self, 
        from_token: str, 
        to_token: str, 
        amount: str
    ) -> Dict[str, Any]:
        params = {
            "fromToken": from_token,
            "toToken": to_token,
            "amount": amount
        }
        
        url = f"{self.base_url}/api/swap/quote"
        
        async with self.session.get(url, params=params) as response:
            self._check_rate_limits(response)
            
            if response.status == 429:
                retry_after = int(response.headers.get('X-RateLimit-Retry-After', 60))
                tier = response.headers.get('X-RateLimit-Tier', 'unknown')
                raise RateLimitError(
                    "Rate limit exceeded", 
                    retry_after, 
                    tier
                )
            
            response.raise_for_status()
            return await response.json()
    
    def _check_rate_limits(self, response: aiohttp.ClientResponse):
        remaining = response.headers.get('X-RateLimit-Remaining')
        tier = response.headers.get('X-RateLimit-Tier')
        
        if remaining and int(remaining) < 5:
            print(f"Rate limit warning: {remaining} requests remaining (tier: {tier})")

# Usage example
async def main():
    async with SwapService("your_api_key") as service:
        try:
            quote = await service.get_swap_quote(
                "0xA0b86a33E6417...",
                "0x6B175474E89...",
                "1000000"
            )
            print(f"Quote: {quote}")
            
        except RateLimitError as e:
            print(f"Rate limited: {e.retry_after}s (tier: {e.tier})")
            await asyncio.sleep(e.retry_after)

if __name__ == "__main__":
    asyncio.run(main())
```

---

**Integration Best Practices:**

1. **Always handle rate limits gracefully** with proper error handling and retry logic
2. **Implement caching** to reduce unnecessary API calls
3. **Use batch operations** when available to maximize efficiency
4. **Monitor your usage** and set up alerts for approaching limits
5. **Test thoroughly** with both unit and integration tests
6. **Plan for failures** with circuit breakers and fallback mechanisms
7. **Keep API keys secure** and rotate them regularly

**Production Checklist:**

- ✅ API key management and rotation
- ✅ Error handling and retry logic
- ✅ Rate limit monitoring and alerting
- ✅ Caching strategy implementation
- ✅ Health checks and monitoring
- ✅ Load testing and performance validation
- ✅ Security review and penetration testing
- ✅ Documentation and runbooks

**Last Updated**: January 2025
    // Set up monitoring
    if (config.monitoring) {
      this.monitoring = config.monitoring;
      this.enableMetrics();
    }

    // Configure health checks
    this.healthCheck = {
      enabled: config.healthCheck !== false,
      interval: config.healthCheckInterval || 30000
    };
    
    if (this.healthCheck.enabled) {
      this.startHealthCheck();
    }
  }
  
  enableMetrics() {
    const originalGetSwapQuote = this.getSwapQuote.bind(this);

    this.getSwapQuote = async (...args) => {
      const startTime = Date.now();
      const labels = {
        method: 'getSwapQuote',
        environment: this.environment
      };
      
      try {
        const result = await originalGetSwapQuote(...args);
        
        this.monitoring.recordSuccess(labels, Date.now() - startTime);
        return result;
        
      } catch (error) {
        this.monitoring.recordError(labels, error, Date.now() - startTime);
        throw error;
      }
    };
  }
  
  startHealthCheck() {
    setInterval(async () => {
      try {
        await this.healthCheck();
        this.logger.debug('Health check passed');
      } catch (error) {
        this.logger.error('Health check failed:', error);
      }
    }, this.healthCheck.interval);
  }
  
  async performHealthCheck() {
    // Simple health check - get a small quote
    const healthCheckQuote = await this.getSwapQuote(
      '0xA0b86a33E6417...', // USDT
      '0x6B175474E89...', // DAI
      '1' // Minimal amount
    );

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      response_time: healthCheckQuote.metadata?.processingTime || 0
    };
  }
}

```

### Monitoring and Observability

```javascript
// Production monitoring setup
class MonitoredSwapService extends ProductionSwapService {
  constructor(config) {
    super(config);
    
    this.metrics = {
      requests: 0,
      errors: 0,
      rateLimits: 0,
      responseTimeSum: 0,
      lastReset: Date.now()
    };
    
    // Report metrics every minute
    setInterval(() => this.reportMetrics(), 60000);
  }
  
  async getSwapQuote(...args) {
    const startTime = Date.now();
    this.metrics.requests++;
    
    try {
      const result = await super.getSwapQuote(...args);
      this.metrics.responseTimeSum += Date.now() - startTime;
      return result;
      
    } catch (error) {
      this.metrics.errors++;
      
      if (error instanceof RateLimitError) {
        this.metrics.rateLimits++;
      }
      
      throw error;
    }
  }
  
  reportMetrics() {
    const now = Date.now();
    const duration = now - this.metrics.lastReset;
    
    const report = {
      timestamp: now,
      duration,
      requests: this.metrics.requests,
      errors: this.metrics.errors,
      rateLimits: this.metrics.rateLimits,
      errorRate: this.metrics.requests > 0 ? this.metrics.errors / this.metrics.requests : 0,
      averageResponseTime: this.metrics.requests > 0 ? 
        this.metrics.responseTimeSum / this.metrics.requests : 0,
      requestsPerSecond: this.metrics.requests / (duration / 1000)
    };
    
    this.logger.info('Metrics report:', report);
    
    // Send to monitoring system
    if (this.monitoring) {
      this.monitoring.recordMetrics(report);
    }
    
    // Reset metrics
    this.metrics = {
      requests: 0,
      errors: 0,
      rateLimits: 0,
      responseTimeSum: 0,
      lastReset: now
    };
  }
}
```

## Framework-Specific Examples

### React Integration

```jsx
// React hook for swap quotes
import { useState, useEffect, useCallback } from 'react';

function useSwapQuote(fromToken, toToken, amount) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  
  const swapService = useMemo(() => 
    new SwapService(process.env.REACT_APP_API_KEY), []
  );
  
  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !amount) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await swapService.getSwapQuote(fromToken, toToken, amount);
      setQuote(result);
      
      // Extract rate limit info from headers (would need modification to return headers)
      // setRateLimitInfo(result.rateLimitInfo);
      
    } catch (err) {
      setError(err);
      
      if (err instanceof RateLimitError) {
        setRateLimitInfo({
          limited: true,
          retryAfter: err.retryAfter,
          tier: err.tier
        });
      }
    } finally {
      setLoading(false);
    }
  }, [fromToken, toToken, amount, swapService]);
  
  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);
  
  return { quote, loading, error, rateLimitInfo, refetch: fetchQuote };
}

// Component usage
function SwapQuoteDisplay({ fromToken, toToken, amount }) {
  const { quote, loading, error, rateLimitInfo } = useSwapQuote(fromToken, toToken, amount);
  
  if (loading) return <div>Loading quote...</div>;
  
  if (error) {
    if (error instanceof RateLimitError) {
      return (
        <div className="error">
          Rate limit exceeded. Please wait {error.retryAfter} seconds.
          <br />
          Current tier: {error.tier}
        </div>
      );
    }
    
    return <div className="error">Error: {error.message}</div>;
  }
  
  if (!quote) return <div>No quote available</div>;
  
  return (
    <div className="quote">
      <h3>Swap Quote</h3>
      <p>From: {quote.quote.fromAmount} {fromToken}</p>
      <p>To: {quote.quote.toAmount} {toToken}</p>
      <p>Price Impact: {(quote.quote.priceImpact * 100).toFixed(2)}%</p>
      
      {rateLimitInfo && (
        <div className="rate-limit-info">
          <small>
            Rate limit: {rateLimitInfo.remaining || 'N/A'} remaining
          </small>
        </div>
      )}
    </div>
  );
}
```

### Node.js Express Integration

```javascript
// Express.js server integration
const express = require('express');
const { SwapService, RateLimitError } = require('./services/SwapService');

const app = express();
app.use(express.json());

// Initialize swap service
const swapService = new SwapService(process.env.API_KEY);

// Middleware for handling rate limits
const rateLimitHandler = (error, req, res, next) => {
  if (error instanceof RateLimitError) {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: error.message,
      retryAfter: error.retryAfter,
      tier: error.tier
    });
    return;
  }
  
  next(error);
};

// Quote endpoint
app.get('/api/quotes', async (req, res, next) => {
  try {
    const { fromToken, toToken, amount } = req.query;
    
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        error: 'MISSING_PARAMETERS',
        message: 'fromToken, toToken, and amount are required'
      });
    }
    
    const quote = await swapService.getSwapQuote(fromToken, toToken, amount);
    
    res.json({
      success: true,
      data: quote,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
app.use(rateLimitHandler);
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  
  res.status(error.status || 500).json({
    error: error.name || 'INTERNAL_ERROR',
    message: error.message || 'Internal server error'
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Python Integration

```python
import asyncio
import aiohttp
import time
from typing import Optional, Dict, Any

class RateLimitError(Exception):
    def __init__(self, message: str, retry_after: int, tier: str):
        super().__init__(message)
        self.retry_after = retry_after
        self.tier = tier

class SwapService:
    def __init__(self, api_key: str, base_url: str = "https://api.1inch.io"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_swap_quote(
        self, 
        from_token: str, 
        to_token: str, 
        amount: str
    ) -> Dict[str, Any]:
        params = {
            "fromToken": from_token,
            "toToken": to_token,
            "amount": amount
        }
        
        url = f"{self.base_url}/api/swap/quote"
        
        async with self.session.get(url, params=params) as response:
            self._check_rate_limits(response)
            
            if response.status == 429:
                retry_after = int(response.headers.get('X-RateLimit-Retry-After', 60))
                tier = response.headers.get('X-RateLimit-Tier', 'unknown')
                raise RateLimitError(
                    "Rate limit exceeded", 
                    retry_after, 
                    tier
                )
            
            response.raise_for_status()
            return await response.json()
    
    def _check_rate_limits(self, response: aiohttp.ClientResponse):
        remaining = response.headers.get('X-RateLimit-Remaining')
        tier = response.headers.get('X-RateLimit-Tier')
        
        if remaining and int(remaining) < 5:
            print(f"Rate limit warning: {remaining} requests remaining (tier: {tier})")

# Usage example
async def main():
    async with SwapService("your_api_key") as service:
        try:
            quote = await service.get_swap_quote(
                "0xA0b86a33E6417...",
                "0x6B175474E89...",
                "1000000"
            )
            print(f"Quote: {quote}")
            
        except RateLimitError as e:
            print(f"Rate limited: {e.retry_after}s (tier: {e.tier})")
            await asyncio.sleep(e.retry_after)

if __name__ == "__main__":
    asyncio.run(main())
```

---

**Integration Best Practices:**

1. **Always handle rate limits gracefully** with proper error handling and retry logic
2. **Implement caching** to reduce unnecessary API calls
3. **Use batch operations** when available to maximize efficiency
4. **Monitor your usage** and set up alerts for approaching limits
5. **Test thoroughly** with both unit and integration tests
6. **Plan for failures** with circuit breakers and fallback mechanisms
7. **Keep API keys secure** and rotate them regularly

**Production Checklist:**

- ✅ API key management and rotation
- ✅ Error handling and retry logic
- ✅ Rate limit monitoring and alerting
- ✅ Caching strategy implementation
- ✅ Health checks and monitoring
- ✅ Load testing and performance validation
- ✅ Security review and penetration testing
- ✅ Documentation and runbooks

**Last Updated**: January 2025
