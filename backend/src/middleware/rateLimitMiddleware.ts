import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * Comprehensive Rate Limiting Middleware for Backend Services
 * 
 * Self-contained implementation with:
 * - Multi-tier rate limiting
 * - Per-IP, per-user, per-API-key rate limits  
 * - DOS protection mechanisms
 * - Circuit breaker patterns
 * - Real-time monitoring
 */

// Basic Express-like types
export interface Request {
  method: string;
  path: string;
  url: string;
  params: { [key: string]: string };
  query: { [key: string]: any };
  body: any;
  headers: { [key: string]: string | undefined };
  connection?: { remoteAddress?: string };
  socket?: { remoteAddress?: string };
  ip?: string;
}

export interface Response {
  status(code: number): Response;
  json(data: any): void;
  send(data: any): void;
  sendStatus(code: number): void;
  set(headers: { [key: string]: string }): void;
  header(name: string, value: string): void;
}

export interface NextFunction {
  (error?: any): void;
}

export interface ExtendedRequest extends Request {
  rateLimitInfo?: {
    limit: number;
    remaining: number;
    reset: number;
    tier: string;
  };
  user?: {
    id: string;
    tier: string;
    apiKey?: string;
  };
}

// Rate limiting types
export type RateLimitTier = 'free' | 'basic' | 'premium' | 'enterprise' | 'admin';
export type RateLimitAlgorithm = 'sliding_window' | 'token_bucket' | 'fixed_window';

export interface RateLimitRule {
  name: string;
  windowMs: number;
  maxRequests: number;
  blockDuration?: number;
  message?: string;
}

export interface RateLimitConfig {
  enabled: boolean;
  defaultTier: RateLimitTier;
  service: string;
  
  // Tier-based limits
  tiers: {
    [K in RateLimitTier]: {
      global: RateLimitRule;
      api?: RateLimitRule;
      [key: string]: RateLimitRule | undefined;
    };
  };
  
  // DOS protection
  dosProtection: {
    enabled: boolean;
    maxConcurrentRequests: number;
    requestSizeLimit: number; // bytes
    headerCountLimit: number;
    urlLengthLimit: number;
    slowLorisTimeout: number;
    userAgentRequired: boolean;
  };
  
  // Security
  security: {
    ipWhitelist: string[];
    ipBlacklist: string[];
    autoBlacklistEnabled: boolean;
    autoBlacklistThreshold: number;
  };
  
  // Headers
  headerNames: {
    limit: string;
    remaining: string;
    reset: string;
    retryAfter: string;
  };
  
  skipPaths: string[];
  trustProxy: boolean;
}

interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
  blocked: boolean;
  retryAfter?: number;
}

interface UserLimit {
  requests: number[];
  blockedUntil: number;
  violations: number;
  windowStart: number;
}

interface CircuitBreaker {
  isOpen: boolean;
  failures: number;
  lastFailure: number;
  openedAt: number;
}

export class RateLimitMiddleware extends EventEmitter {
  private config: RateLimitConfig;
  private userLimits: Map<string, UserLimit> = new Map();
  private concurrentRequests: Map<string, number> = new Map();
  private slowLorisDetection: Map<string, number> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private globalStats = {
    totalRequests: 0,
    blockedRequests: 0,
    violations: 0,
    startTime: Date.now()
  };

  constructor(config: Partial<RateLimitConfig>) {
    super();
    
    this.config = {
      enabled: true,
      defaultTier: 'basic',
      service: 'api',
      tiers: {
        free: {
          global: {
            name: 'free_global',
            windowMs: 15 * 60 * 1000, // 15 minutes
            maxRequests: 100,
            blockDuration: 5 * 60 * 1000, // 5 minutes
            message: 'Rate limit exceeded for free tier'
          }
        },
        basic: {
          global: {
            name: 'basic_global', 
            windowMs: 15 * 60 * 1000,
            maxRequests: 1000,
            blockDuration: 60 * 1000 // 1 minute
          }
        },
        premium: {
          global: {
            name: 'premium_global',
            windowMs: 15 * 60 * 1000,
            maxRequests: 5000
          }
        },
        enterprise: {
          global: {
            name: 'enterprise_global',
            windowMs: 15 * 60 * 1000,
            maxRequests: 20000
          }
        },
        admin: {
          global: {
            name: 'admin_global',
            windowMs: 15 * 60 * 1000,
            maxRequests: 100000
          }
        }
      },
      dosProtection: {
        enabled: true,
        maxConcurrentRequests: 100,
        requestSizeLimit: 1024 * 1024, // 1MB
        headerCountLimit: 100,
        urlLengthLimit: 2048,
        slowLorisTimeout: 30000, // 30 seconds
        userAgentRequired: false
      },
      security: {
        ipWhitelist: [],
        ipBlacklist: [],
        autoBlacklistEnabled: true,
        autoBlacklistThreshold: 10
      },
      headerNames: {
        limit: 'X-RateLimit-Limit',
        remaining: 'X-RateLimit-Remaining', 
        reset: 'X-RateLimit-Reset',
        retryAfter: 'Retry-After'
      },
      skipPaths: ['/health', '/metrics'],
      trustProxy: false,
      ...config
    };

    // Initialize circuit breakers
    this.circuitBreakers.set('global', {
      isOpen: false,
      failures: 0,
      lastFailure: 0,
      openedAt: 0
    });

    // Cleanup task
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
    
    console.log(`🛡️ Rate Limiting initialized for ${this.config.service} service`);
  }

  /**
   * Main middleware function
   */
  middleware() {
    return (req: ExtendedRequest, res: Response, next: NextFunction) => {
      if (!this.config.enabled) {
        return next();
      }

      this.globalStats.totalRequests++;

      try {
        // Skip certain paths
        if (this.shouldSkipPath(req.path)) {
          return next();
        }

        const ip = this.getClientIP(req);
        
        // Check IP blacklist/whitelist
        if (this.config.security.ipBlacklist.includes(ip)) {
          return this.sendError(res, 403, 'IP address is blacklisted');
        }
        
        if (this.config.security.ipWhitelist.length > 0 && 
            !this.config.security.ipWhitelist.includes(ip)) {
          return this.sendError(res, 403, 'IP address not whitelisted');
        }

        // DOS protection checks
        if (this.config.dosProtection.enabled) {
          const dosCheck = this.checkDOSProtection(req);
          if (!dosCheck.allowed) {
            return this.handleDOSViolation(req, res, dosCheck.reason || 'DOS protection triggered');
          }
        }

        // Circuit breaker check
        if (this.circuitBreakers.get('global')?.isOpen) {
          return this.sendError(res, 503, 'Service temporarily unavailable');
        }

        // Get user tier and check rate limit
        const tier = this.getUserTier(req);
        const key = this.generateKey(req, tier);
        const rule = this.config.tiers[tier].global;
        
        const rateLimitInfo = this.checkRateLimit(key, rule);
        
        if (rateLimitInfo.blocked) {
          this.recordViolation(ip, rule.name, tier);
          return this.handleRateLimitViolation(req, res, rateLimitInfo, rule);
        }

        // Set rate limit info and headers
        req.rateLimitInfo = {
          limit: rateLimitInfo.limit,
          remaining: rateLimitInfo.remaining,
          reset: rateLimitInfo.resetTime,
          tier
        };

        this.setRateLimitHeaders(res, rateLimitInfo);
        
        // Track concurrent request
        this.trackConcurrentRequest(ip, () => {
          // Request finished callback
        });

        next();
        
      } catch (error) {
        console.error('Rate limiting error:', error);
        // Don't block on errors
        next();
      }
    };
  }

  /**
   * Check DOS protection rules
   */
  private checkDOSProtection(req: ExtendedRequest): { allowed: boolean; reason?: string } {
    const ip = this.getClientIP(req);
    
    // Check concurrent requests
    const concurrent = this.concurrentRequests.get(ip) || 0;
    if (concurrent >= this.config.dosProtection.maxConcurrentRequests) {
      return { allowed: false, reason: 'Too many concurrent requests' };
    }

    // Check request size
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > this.config.dosProtection.requestSizeLimit) {
      return { allowed: false, reason: 'Request too large' };
    }

    // Check header count
    const headerCount = Object.keys(req.headers).length;
    if (headerCount > this.config.dosProtection.headerCountLimit) {
      return { allowed: false, reason: 'Too many headers' };
    }

    // Check URL length
    if (req.url.length > this.config.dosProtection.urlLengthLimit) {
      return { allowed: false, reason: 'URL too long' };
    }

    // Check User-Agent requirement
    if (this.config.dosProtection.userAgentRequired && !req.headers['user-agent']) {
      return { allowed: false, reason: 'User-Agent required' };
    }

    // Slow Loris protection
    const requestStart = this.slowLorisDetection.get(ip);
    if (requestStart) {
      if (Date.now() - requestStart > this.config.dosProtection.slowLorisTimeout) {
        return { allowed: false, reason: 'Slow request detected' };
      }
    } else {
      this.slowLorisDetection.set(ip, Date.now());
    }

    return { allowed: true };
  }

  /**
   * Check rate limit for a key
   */
  private checkRateLimit(key: string, rule: RateLimitRule): RateLimitInfo {
    const now = Date.now();
    let userLimit = this.userLimits.get(key);

    if (!userLimit) {
      userLimit = {
        requests: [],
        blockedUntil: 0,
        violations: 0,
        windowStart: now
      };
      this.userLimits.set(key, userLimit);
    }

    // Check if currently blocked
    if (now < userLimit.blockedUntil) {
      return {
        limit: rule.maxRequests,
        current: rule.maxRequests,
        remaining: 0,
        resetTime: userLimit.blockedUntil,
        blocked: true,
        retryAfter: Math.ceil((userLimit.blockedUntil - now) / 1000)
      };
    }

    // Clean old requests (sliding window)
    const windowStart = now - rule.windowMs;
    userLimit.requests = userLimit.requests.filter(time => time > windowStart);

    // Check if limit exceeded
    if (userLimit.requests.length >= rule.maxRequests) {
      const oldestRequest = Math.min(...userLimit.requests);
      const resetTime = oldestRequest + rule.windowMs;
      
      // Apply block if configured
      if (rule.blockDuration) {
        userLimit.blockedUntil = now + rule.blockDuration;
        userLimit.violations++;
        
        // Check for auto-blacklist
        if (this.config.security.autoBlacklistEnabled && 
            userLimit.violations >= this.config.security.autoBlacklistThreshold) {
          const ip = key.split(':').pop() || '';
          this.config.security.ipBlacklist.push(ip);
          this.emit('ipAutoBlacklisted', { ip, violations: userLimit.violations });
        }
      }
      
      return {
        limit: rule.maxRequests,
        current: userLimit.requests.length,
        remaining: 0,
        resetTime,
        blocked: true,
        retryAfter: Math.ceil((resetTime - now) / 1000)
      };
    }

    // Add current request
    userLimit.requests.push(now);
    
    return {
      limit: rule.maxRequests,
      current: userLimit.requests.length,
      remaining: rule.maxRequests - userLimit.requests.length,
      resetTime: now + rule.windowMs,
      blocked: false
    };
  }

  /**
   * Handle rate limit violation
   */
  private handleRateLimitViolation(
    req: ExtendedRequest,
    res: Response, 
    rateLimitInfo: RateLimitInfo,
    rule: RateLimitRule
  ): void {
    this.setRateLimitHeaders(res, rateLimitInfo);
    
    if (rateLimitInfo.retryAfter) {
      res.header(this.config.headerNames.retryAfter, rateLimitInfo.retryAfter.toString());
    }

    this.emit('rateLimitViolation', {
      ip: this.getClientIP(req),
      rule: rule.name,
      path: req.path,
      method: req.method
    });

    this.sendError(res, 429, rule.message || 'Rate limit exceeded', {
      retryAfter: rateLimitInfo.retryAfter || 60
    });
  }

  /**
   * Handle DOS violation
   */
  private handleDOSViolation(req: ExtendedRequest, res: Response, reason: string): void {
    const ip = this.getClientIP(req);
    
    this.emit('dosViolation', {
      ip,
      reason,
      path: req.path,
      method: req.method
    });

    this.sendError(res, 429, `Request blocked: ${reason}`);
  }

  /**
   * Record security violation
   */
  private recordViolation(ip: string, ruleName: string, tier: string): void {
    this.globalStats.violations++;
    this.globalStats.blockedRequests++;
    
    // Update circuit breaker
    const breaker = this.circuitBreakers.get('global')!;
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    // Open circuit breaker if too many failures
    if (breaker.failures >= 50 && !breaker.isOpen) {
      breaker.isOpen = true;
      breaker.openedAt = Date.now();
      
      // Auto-close after 5 minutes
      setTimeout(() => {
        breaker.isOpen = false;
        breaker.failures = 0;
      }, 5 * 60 * 1000);
      
      this.emit('circuitBreakerOpen', { reason: 'High failure rate' });
    }
  }

  /**
   * Helper methods
   */
  private shouldSkipPath(path: string): boolean {
    return this.config.skipPaths.some(skipPath => path.startsWith(skipPath));
  }

  private getClientIP(req: ExtendedRequest): string {
    if (this.config.trustProxy) {
      return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
             (req.headers['x-real-ip'] as string) ||
             req.ip ||
             req.connection?.remoteAddress ||
             'unknown';
    }
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }

  private getUserTier(req: ExtendedRequest): RateLimitTier {
    // Check user object
    if (req.user?.tier) {
      return req.user.tier as RateLimitTier;
    }

    // Check API key
    const apiKey = req.headers['x-api-key'] as string ||
                   req.headers.authorization?.replace('Bearer ', '') ||
                   req.query?.apiKey as string;
    
    if (apiKey) {
      return this.getAPIKeyTier(apiKey);
    }

    return this.config.defaultTier;
  }

  private getAPIKeyTier(apiKey: string): RateLimitTier {
    // Simple tier detection based on key prefix
    if (apiKey.startsWith('admin_')) return 'admin';
    if (apiKey.startsWith('ent_')) return 'enterprise';
    if (apiKey.startsWith('prem_')) return 'premium';
    if (apiKey.startsWith('basic_')) return 'basic';
    return 'free';
  }

  private generateKey(req: ExtendedRequest, tier: string): string {
    const ip = this.getClientIP(req);
    const userId = req.user?.id;
    const apiKey = req.headers['x-api-key'];
    
    // Priority: user ID > API key > IP
    const identifier = userId || apiKey || ip;
    return `${this.config.service}:${tier}:${identifier}`;
  }

  private setRateLimitHeaders(res: Response, info: RateLimitInfo): void {
    res.set({
      [this.config.headerNames.limit]: info.limit.toString(),
      [this.config.headerNames.remaining]: info.remaining.toString(),
      [this.config.headerNames.reset]: Math.ceil(info.resetTime / 1000).toString()
    });
  }

  private trackConcurrentRequest(ip: string, onFinish: () => void): void {
    const current = this.concurrentRequests.get(ip) || 0;
    this.concurrentRequests.set(ip, current + 1);
    
    // Decrement when done (simplified)
    setTimeout(() => {
      const updated = this.concurrentRequests.get(ip) || 1;
      this.concurrentRequests.set(ip, Math.max(0, updated - 1));
      onFinish();
    }, 1000); // Rough estimate
  }

  private sendError(res: Response, status: number, message: string, extra?: any): void {
    res.status(status).json({
      error: message,
      timestamp: new Date().toISOString(),
      ...extra
    });
  }

  /**
   * Cleanup expired data
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean user limits
    for (const [key, userLimit] of this.userLimits.entries()) {
      if (userLimit.requests.length === 0 && now - userLimit.windowStart > maxAge) {
        this.userLimits.delete(key);
      }
    }
    
    // Clean slow loris detection
    for (const [ip, timestamp] of this.slowLorisDetection.entries()) {
      if (now - timestamp > this.config.dosProtection.slowLorisTimeout * 2) {
        this.slowLorisDetection.delete(ip);
      }
    }
    
    // Clean concurrent requests (shouldn't be needed but safety)
    for (const [ip, count] of this.concurrentRequests.entries()) {
      if (count === 0) {
        this.concurrentRequests.delete(ip);
      }
    }
  }

  /**
   * Get middleware statistics
   */
  getStats(): any {
    const uptime = Date.now() - this.globalStats.startTime;
    
    return {
      service: this.config.service,
      uptime,
      totalRequests: this.globalStats.totalRequests,
      blockedRequests: this.globalStats.blockedRequests,
      violations: this.globalStats.violations,
      activeUsers: this.userLimits.size,
      concurrentRequests: Array.from(this.concurrentRequests.values()).reduce((a, b) => a + b, 0),
      circuitBreakerOpen: this.circuitBreakers.get('global')?.isOpen || false,
      blacklistedIPs: this.config.security.ipBlacklist.length,
      whitelistedIPs: this.config.security.ipWhitelist.length
    };
  }

  /**
   * Reset rate limits (admin function)
   */
  resetRateLimits(identifier?: string): void {
    if (identifier) {
      // Reset specific user/IP
      for (const key of this.userLimits.keys()) {
        if (key.includes(identifier)) {
          this.userLimits.delete(key);
        }
      }
    } else {
      // Reset all
      this.userLimits.clear();
      this.concurrentRequests.clear();
      this.slowLorisDetection.clear();
    }
  }

  /**
   * Update IP lists
   */
  updateIPList(ip: string, action: 'whitelist' | 'blacklist' | 'remove'): void {
    switch (action) {
      case 'whitelist':
        if (!this.config.security.ipWhitelist.includes(ip)) {
          this.config.security.ipWhitelist.push(ip);
        }
        this.config.security.ipBlacklist = this.config.security.ipBlacklist.filter(blockedIP => blockedIP !== ip);
        break;
        
      case 'blacklist':
        if (!this.config.security.ipBlacklist.includes(ip)) {
          this.config.security.ipBlacklist.push(ip);
        }
        this.config.security.ipWhitelist = this.config.security.ipWhitelist.filter(whiteIP => whiteIP !== ip);
        break;
        
      case 'remove':
        this.config.security.ipWhitelist = this.config.security.ipWhitelist.filter(whiteIP => whiteIP !== ip);
        this.config.security.ipBlacklist = this.config.security.ipBlacklist.filter(blockedIP => blockedIP !== ip);
        break;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }
}

/**
 * Factory functions for different services
 */
export function createRelayerRateLimitMiddleware(): RateLimitMiddleware {
  return new RateLimitMiddleware({
    service: 'relayer',
    defaultTier: 'basic',
    tiers: {
      free: {
        global: {
          name: 'relayer_free',
          windowMs: 15 * 60 * 1000,
          maxRequests: 50,
          blockDuration: 5 * 60 * 1000,
          message: 'Relayer rate limit exceeded for free tier'
        }
      },
      basic: {
        global: {
          name: 'relayer_basic',
          windowMs: 15 * 60 * 1000,
          maxRequests: 500,
          blockDuration: 60 * 1000
        }
      },
      premium: {
        global: {
          name: 'relayer_premium', 
          windowMs: 15 * 60 * 1000,
          maxRequests: 2500
        }
      },
      enterprise: {
        global: {
          name: 'relayer_enterprise',
          windowMs: 15 * 60 * 1000,
          maxRequests: 10000
        }
      },
      admin: {
        global: {
          name: 'relayer_admin',
          windowMs: 15 * 60 * 1000,
          maxRequests: 50000
        }
      }
    },
    dosProtection: {
      enabled: true,
      maxConcurrentRequests: 100,
      requestSizeLimit: 1024 * 1024, // 1MB
      headerCountLimit: 50,
      urlLengthLimit: 1024,
      slowLorisTimeout: 30000,
      userAgentRequired: false
    }
  });
}

export function createResolverRateLimitMiddleware(): RateLimitMiddleware {
  return new RateLimitMiddleware({
    service: 'resolver',
    defaultTier: 'basic',
    tiers: {
      free: {
        global: {
          name: 'resolver_free',
          windowMs: 15 * 60 * 1000,
          maxRequests: 30,
          blockDuration: 5 * 60 * 1000
        }
      },
      basic: {
        global: {
          name: 'resolver_basic',
          windowMs: 15 * 60 * 1000,
          maxRequests: 300,
          blockDuration: 60 * 1000
        }
      },
      premium: {
        global: {
          name: 'resolver_premium',
          windowMs: 15 * 60 * 1000,
          maxRequests: 1500
        }
      },
      enterprise: {
        global: {
          name: 'resolver_enterprise',
          windowMs: 15 * 60 * 1000,
          maxRequests: 6000
        }
      },
      admin: {
        global: {
          name: 'resolver_admin',
          windowMs: 15 * 60 * 1000,
          maxRequests: 30000
        }
      }
    },
    dosProtection: {
      enabled: true,
      maxConcurrentRequests: 50,
      requestSizeLimit: 512 * 1024, // 512KB
      headerCountLimit: 30,
      urlLengthLimit: 512,
      slowLorisTimeout: 20000,
      userAgentRequired: false
    }
  });
}

export default RateLimitMiddleware;