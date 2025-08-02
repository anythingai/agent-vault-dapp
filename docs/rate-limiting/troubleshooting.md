# Troubleshooting Guide

## Table of Contents

- [Common Issues](#common-issues)
- [Error Messages](#error-messages)
- [Diagnostic Tools](#diagnostic-tools)
- [Performance Issues](#performance-issues)
- [Configuration Problems](#configuration-problems)
- [Integration Issues](#integration-issues)
- [Getting Support](#getting-support)

## Common Issues

### Rate Limit Exceeded (HTTP 429)

**Symptoms:**

- Receiving HTTP 429 responses
- Error message: "Rate limit exceeded"
- Users unable to complete transactions

**Causes:**

- User exceeding their tier limits
- Burst of requests above allowed rate
- Incorrectly configured rate limits
- Bot or automated traffic

**Solutions:**

1. **Check User Tier and Usage:**

   ```bash
   curl -X GET http://localhost:8081/api/admin/users/USER_ID \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

2. **Review Rate Limit Headers:**

   ```bash
   curl -I https://api.1inch.io/api/swap/quote \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```

   Look for headers:
   - `X-RateLimit-Remaining`: Requests left
   - `X-RateLimit-Reset`: Reset time
   - `X-RateLimit-Retry-After`: Wait time

3. **Implement Proper Retry Logic:**

   ```javascript
   async function retryRequest(requestFn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await requestFn();
       } catch (error) {
         if (error.status === 429 && i < maxRetries - 1) {
           const retryAfter = error.retryAfter || Math.pow(2, i) * 1000;
           await sleep(retryAfter);
           continue;
         }
         throw error;
       }
     }
   }
   ```

4. **Consider Tier Upgrade:**
   - Review usage patterns
   - Upgrade to higher tier if needed
   - Contact support for custom limits

### Circuit Breaker Open (HTTP 503)

**Symptoms:**

- Receiving HTTP 503 responses
- Error message: "Service temporarily unavailable"
- Circuit breaker status shows "open"

**Causes:**

- High error rate in upstream services
- System overload or resource exhaustion
- Network connectivity issues
- Database connection problems

**Solutions:**

1. **Check System Health:**

   ```bash
   curl -X GET http://localhost:8081/api/admin/health \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

2. **Review Circuit Breaker Status:**

   ```bash
   curl -X GET http://localhost:8081/api/admin/circuit-breakers/status \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

3. **Manual Circuit Breaker Reset:**

   ```bash
   curl -X POST http://localhost:8081/api/admin/circuit-breakers/reset \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"service": "rate_limiter"}'
   ```

4. **Check Error Logs:**

   ```bash
   curl -X GET http://localhost:8081/api/admin/logs \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -G -d "level=error&period=1h"
   ```

### Quota Exceeded (HTTP 402)

**Symptoms:**

- Receiving HTTP 402 responses
- Daily/monthly limits reached
- Users blocked from making requests

**Causes:**

- User reached daily/monthly quota
- Incorrect quota calculations
- Quota not properly reset

**Solutions:**

1. **Check User Quota:**

   ```bash
   curl -X GET http://localhost:8081/api/admin/users/USER_ID/quota \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

2. **Reset User Quota (if needed):**

   ```bash
   curl -X POST http://localhost:8081/api/admin/users/USER_ID/quota/reset \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Customer support ticket #12345"}'
   ```

3. **Upgrade User Tier:**

   ```bash
   curl -X PUT http://localhost:8081/api/admin/users/USER_ID/tier \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tier": "premium", "reason": "Quota upgrade"}'
   ```

## Error Messages

### "Invalid API Key"

**Error Code:** 401
**Cause:** API key is missing, invalid, or expired

**Solutions:**

1. Verify API key format
2. Check if key is active in admin panel
3. Regenerate new API key if needed
4. Ensure proper header format: `Authorization: Bearer YOUR_KEY`

### "Cross-chain operation failed"

**Error Code:** 500
**Cause:** Issues with cross-chain coordination

**Debug Steps:**

1. Check resource pool status:

   ```bash
   curl -X GET http://localhost:8081/api/admin/cross-chain/pools \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

2. Review cross-chain logs:

   ```bash
   curl -X GET http://localhost:8081/api/admin/logs \
     -G -d "component=cross_chain&period=1h"
   ```

3. Test individual chain connectivity:

   ```bash
   curl -X GET http://localhost:8081/api/admin/health/ethereum
   curl -X GET http://localhost:8081/api/admin/health/bitcoin
   ```

### "Configuration validation failed"

**Error Code:** 400
**Cause:** Invalid configuration submitted

**Debug Steps:**

1. Validate configuration format:

   ```bash
   curl -X POST http://localhost:8081/api/admin/config/validate \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d @your_config.json
   ```

2. Check configuration schema:

   ```bash
   curl -X GET http://localhost:8081/api/admin/config/schema \
     -H "Authorization: Bearer ADMIN_TOKEN"
   ```

## Diagnostic Tools

### Rate Limit Status Checker

```bash
#!/bin/bash
# Check rate limit status for user
USER_ID="$1"
API_KEY="$2"

if [ -z "$USER_ID" ] || [ -z "$API_KEY" ]; then
  echo "Usage: $0 <user_id> <admin_api_key>"
  exit 1
fi

echo "Checking rate limit status for user: $USER_ID"
echo "================================================"

# Get user info
echo "User Information:"
curl -s -X GET "http://localhost:8081/api/admin/users/$USER_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nRate Limit Status:"
curl -s -X GET "http://localhost:8081/api/admin/rate-limits/users/$USER_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nRecent Activity:"
curl -s -X GET "http://localhost:8081/api/admin/analytics/user-activity" \
  -G -d "userId=$USER_ID" -d "period=1h" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

### System Health Check Script

```bash
#!/bin/bash
# Comprehensive system health check
ADMIN_TOKEN="$1"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "Usage: $0 <admin_token>"
  exit 1
fi

echo "System Health Check"
echo "==================="

# Overall system health
echo "Overall Health:"
curl -s -X GET "http://localhost:8081/api/admin/health" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Component health
echo -e "\nComponent Health:"
components=("rate_limiter" "database" "redis" "circuit_breaker")

for component in "${components[@]}"; do
  echo "  $component:"
  curl -s -X GET "http://localhost:8081/api/admin/health/$component" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.status'
done

# Circuit breaker status
echo -e "\nCircuit Breaker Status:"
curl -s -X GET "http://localhost:8081/api/admin/circuit-breakers/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Current load
echo -e "\nSystem Load:"
curl -s -X GET "http://localhost:8081/api/admin/metrics/realtime" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{
    cpu_usage: .cpu_usage,
    memory_usage: .memory_usage,
    request_rate: .request_rate,
    error_rate: .error_rate
  }'
```

### Performance Analysis Tool

```javascript
// Performance diagnostic tool
class PerformanceDiagnostic {
  constructor(adminToken) {
    this.adminToken = adminToken;
    this.baseUrl = 'http://localhost:8081/api/admin';
  }

  async runDiagnostic() {
    console.log('🔍 Running performance diagnostic...\n');

    const results = {
      timestamp: new Date().toISOString(),
      tests: {}
    };

    // Test API response times
    results.tests.apiResponseTime = await this.testAPIResponseTime();
    
    // Test rate limiter performance
    results.tests.rateLimiterPerformance = await this.testRateLimiterPerformance();
    
    // Test database performance
    results.tests.databasePerformance = await this.testDatabasePerformance();
    
    // Test memory usage
    results.tests.memoryUsage = await this.testMemoryUsage();

    return this.generateReport(results);
  }

  async testAPIResponseTime() {
    const tests = [
      { name: 'Health Check', endpoint: '/health' },
      { name: 'User Lookup', endpoint: '/users/test-user' },
      { name: 'Rate Limit Check', endpoint: '/rate-limits/policies' }
    ];

    const results = [];

    for (const test of tests) {
      const startTime = Date.now();
      
      try {
        const response = await fetch(`${this.baseUrl}${test.endpoint}`, {
          headers: { 'Authorization': `Bearer ${this.adminToken}` }
        });
        
        const duration = Date.now() - startTime;
        
        results.push({
          name: test.name,
          duration,
          status: response.status,
          success: response.ok
        });
        
      } catch (error) {
        results.push({
          name: test.name,
          duration: Date.now() - startTime,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  async testRateLimiterPerformance() {
    // Test rate limiter processing time
    const iterations = 100;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        await fetch(`${this.baseUrl}/rate-limits/test`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userId: `test-${i}`, operation: 'test' })
        });
        
        times.push(Date.now() - startTime);
      } catch (error) {
        console.error(`Rate limit test ${i} failed:`, error.message);
      }
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    return {
      iterations,
      averageTime: avgTime,
      maxTime,
      minTime,
      throughput: 1000 / avgTime // ops per second
    };
  }

  async testDatabasePerformance() {
    // Test database query performance
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.baseUrl}/test/database-performance`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });
      
      const data = await response.json();
      
      return {
        queryTime: Date.now() - startTime,
        connectionCount: data.connectionCount,
        slowQueries: data.slowQueries,
        success: true
      };
      
    } catch (error) {
      return {
        error: error.message,
        success: false
      };
    }
  }

  async testMemoryUsage() {
    try {
      const response = await fetch(`${this.baseUrl}/metrics/memory`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });
      
      const data = await response.json();
      
      return {
        heapUsed: data.heapUsed,
        heapTotal: data.heapTotal,
        external: data.external,
        rss: data.rss,
        usage: (data.heapUsed / data.heapTotal) * 100
      };
      
    } catch (error) {
      return {
        error: error.message,
        success: false
      };
    }
  }

  generateReport(results) {
    let report = '\n📊 Performance Diagnostic Report\n';
    report += '==================================\n';
    report += `Timestamp: ${results.timestamp}\n\n`;

    // API Response Time
    if (results.tests.apiResponseTime) {
      report += '🌐 API Response Times:\n';
      results.tests.apiResponseTime.forEach(test => {
        const status = test.success ? '✅' : '❌';
        report += `   ${status} ${test.name}: ${test.duration}ms\n`;
      });
      report += '\n';
    }

    // Rate Limiter Performance
    if (results.tests.rateLimiterPerformance) {
      const rl = results.tests.rateLimiterPerformance;
      report += '⚡ Rate Limiter Performance:\n';
      report += `   Average Time: ${rl.averageTime.toFixed(2)}ms\n`;
      report += `   Max Time: ${rl.maxTime}ms\n`;
      report += `   Min Time: ${rl.minTime}ms\n`;
      report += `   Throughput: ${rl.throughput.toFixed(0)} ops/sec\n\n`;
    }

    // Memory Usage
    if (results.tests.memoryUsage) {
      const mem = results.tests.memoryUsage;
      report += '💾 Memory Usage:\n';
      report += `   Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
      report += `   Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB\n`;
      report += `   Usage: ${mem.usage.toFixed(1)}%\n\n`;
    }

    // Recommendations
    report += '💡 Recommendations:\n';
    
    if (results.tests.apiResponseTime) {
      const avgResponseTime = results.tests.apiResponseTime
        .reduce((sum, test) => sum + (test.duration || 0), 0) / 
        results.tests.apiResponseTime.length;
      
      if (avgResponseTime > 500) {
        report += '   ⚠️  API response times are high (>500ms). Consider:\n';
        report += '      - Optimizing database queries\n';
        report += '      - Adding caching layers\n';
        report += '      - Scaling infrastructure\n';
      }
    }

    if (results.tests.memoryUsage && results.tests.memoryUsage.usage > 80) {
      report += '   ⚠️  Memory usage is high (>80%). Consider:\n';
      report += '      - Increasing available memory\n';
      report += '      - Optimizing data structures\n';
      report += '      - Implementing memory cleanup\n';
    }

    if (results.tests.rateLimiterPerformance && 
        results.tests.rateLimiterPerformance.averageTime > 100) {
      report += '   ⚠️  Rate limiter performance is degraded (>100ms). Consider:\n';
      report += '      - Optimizing rate limiting algorithms\n';
      report += '      - Using more efficient data structures\n';
      report += '      - Implementing caching\n';
    }

    return report;
  }
}

// Usage
// const diagnostic = new PerformanceDiagnostic('your_admin_token');
// diagnostic.runDiagnostic().then(report => console.log(report));
```

## Performance Issues

### Slow API Responses

**Symptoms:**

- Response times > 1 second
- Timeouts occurring
- Poor user experience

**Investigation:**

1. Check system metrics
2. Analyze slow query logs
3. Review connection pool usage
4. Monitor resource utilization

**Solutions:**

- Optimize database queries
- Implement caching
- Scale infrastructure
- Tune connection pools

### High Memory Usage

**Symptoms:**

- Memory usage > 80%
- Out of memory errors
- Frequent garbage collection

**Investigation:**

1. Check memory metrics
2. Profile memory usage
3. Identify memory leaks
4. Review data structures

**Solutions:**

- Optimize data structures
- Implement memory cleanup
- Increase available memory
- Use memory pools

### Database Connection Issues

**Symptoms:**

- Connection timeout errors
- Pool exhausted messages
- Slow database queries

**Investigation:**

1. Check connection pool status
2. Review connection settings
3. Analyze query performance
4. Monitor database load

**Solutions:**

- Tune connection pool settings
- Optimize database queries
- Add read replicas
- Implement connection retry logic

## Configuration Problems

### Invalid Configuration Format

**Error:** Configuration validation fails

**Solutions:**

1. Validate JSON format
2. Check required fields
3. Verify data types
4. Use configuration schema

### Policy Conflicts

**Error:** Conflicting rate limit policies

**Solutions:**

1. Review policy hierarchy
2. Check for overlapping rules
3. Validate policy logic
4. Test policy combinations

### Missing Environment Variables

**Error:** Configuration values undefined

**Solutions:**

1. Verify environment variables
2. Check configuration loading
3. Validate default values
4. Review configuration precedence

## Integration Issues

### SDK Connection Problems

**Symptoms:**

- Connection refused errors
- Authentication failures
- Network timeouts

**Solutions:**

1. Verify endpoint URLs
2. Check API key validity
3. Test network connectivity
4. Review firewall settings

### Framework Compatibility

**Symptoms:**

- Import/require errors
- Version conflicts
- Missing dependencies

**Solutions:**

1. Check framework versions
2. Update dependencies
3. Review compatibility matrix
4. Use appropriate SDK version

## Getting Support

### Self-Service Resources

1. **Documentation**: Check the complete documentation
2. **FAQ**: Review frequently asked questions
3. **Community Forum**: Search existing discussions
4. **Status Page**: Check system status and incidents

### Contact Support

**For Technical Issues:**

- Email: <support@1inch.io>
- Include: Error messages, logs, reproduction steps
- Response time: 4-8 hours

**For API Issues:**

- Email: <api-support@1inch.io>
- Include: API key (partial), request/response examples
- Response time: 2-4 hours

**For Security Issues:**

- Email: <security@1inch.io>
- Include: Vulnerability details, impact assessment
- Response time: 1-2 hours

**For Enterprise Support:**

- Contact your account manager
- Enterprise support hotline
- 24/7 availability

### Information to Include

When contacting support, please provide:

1. **Environment Details:**
   - Node.js/Python version
   - SDK version
   - Operating system

2. **Error Information:**
   - Complete error messages
   - Stack traces
   - Request/response logs

3. **Reproduction Steps:**
   - Minimal code example
   - Steps to reproduce
   - Expected vs actual behavior

4. **Context:**
   - When did the issue start?
   - Has it worked before?
   - What changed recently?

### Emergency Contacts

For critical production issues:

- **Phone**: +1-555-FUSION-HELP
- **Emergency Email**: <emergency@1inch.io>
- **Slack**: #emergency (enterprise customers)

**Define as emergency:**

- Complete service outage
- Security incident
- Data loss or corruption
- Critical functionality broken

---

**Troubleshooting Best Practices:**

1. **Start with logs** - Check application and system logs first
2. **Use diagnostic tools** - Leverage built-in diagnostic capabilities
3. **Isolate the problem** - Test individual components
4. **Check recent changes** - Review what changed recently
5. **Monitor trends** - Look for patterns in errors
6. **Document solutions** - Keep track of fixes for future reference

**Prevention Tips:**

- Implement comprehensive monitoring
- Set up proactive alerting
- Regular health checks
- Load testing before deployment
- Keep documentation updated
- Train team on troubleshooting procedures

**Last Updated**: January 2025
