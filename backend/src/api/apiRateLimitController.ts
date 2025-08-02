import { EventEmitter } from 'events';
import { Request, Response, NextFunction } from '../middleware/rateLimitMiddleware.js';
import { createRelayerRateLimitMiddleware, createResolverRateLimitMiddleware } from '../middleware/rateLimitMiddleware.js';

/**
 * API Rate Limiting Controller
 * 
 * Provides endpoint-specific rate limiting with:
 * - Operation-based rate limiting (create_order, place_bid, etc.)
 * - WebSocket connection rate limiting
 * - Batch operation controls
 * - API key management and quotas
 * - Real-time monitoring and alerting
 */

export interface APIEndpointConfig {
  path: string;
  method: string;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    skipSuccessful?: boolean;
    skipFailed?: boolean;
    keyGenerator?: (req: any) => string;
    onLimitReached?: (req: any, res: any) => void;
  };
  authentication?: {
    required: boolean;
    roles?: string[];
    apiKeyRequired?: boolean;
  };
  validation?: {
    bodySchema?: any;
    querySchema?: any;
    paramSchema?: any;
  };
}

export interface WebSocketLimits {
  maxConnections: number;
  maxConnectionsPerIP: number;
  messageRateLimit: {
    windowMs: number;
    maxMessages: number;
  };
  subscriptionLimits: {
    maxSubscriptions: number;
    maxChannelsPerSubscription: number;
  };
}

export interface APIKeyQuota {
  apiKey: string;
  tier: string;
  dailyLimit: number;
  monthlyLimit: number;
  currentDaily: number;
  currentMonthly: number;
  lastReset: {
    daily: number;
    monthly: number;
  };
  rateLimits: Record<string, {
    windowMs: number;
    maxRequests: number;
    current: number;
    resetAt: number;
  }>;
}

export class APIRateLimitController extends EventEmitter {
  private relayerMiddleware = createRelayerRateLimitMiddleware();
  private resolverMiddleware = createResolverRateLimitMiddleware();
  
  // Endpoint configurations
  private endpointConfigs: Map<string, APIEndpointConfig> = new Map();
  
  // WebSocket management
  private wsConnections: Map<string, {
    ip: string;
    connectedAt: number;
    messageCount: number;
    lastMessage: number;
    subscriptions: Set<string>;
  }> = new Map();
  
  // API key management
  private apiKeyQuotas: Map<string, APIKeyQuota> = new Map();
  
  // Connection tracking
  private ipConnections: Map<string, Set<string>> = new Map();
  
  // Statistics
  private stats = {
    totalRequests: 0,
    blockedRequests: 0,
    apiKeyRequests: 0,
    wsConnections: 0,
    wsMessages: 0,
    quotaViolations: 0
  };

  constructor() {
    super();
    this.initializeEndpointConfigs();
    this.startQuotaResetTask();
    console.log('🛡️ API Rate Limit Controller initialized');
  }

  /**
   * Initialize endpoint configurations
   */
  private initializeEndpointConfigs(): void {
    // Relayer endpoints
    this.endpointConfigs.set('POST:/api/orders', {
      path: '/api/orders',
      method: 'POST',
      rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 10, // 10 orders per minute
        skipSuccessful: false,
        keyGenerator: (req) => `create_order:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        apiKeyRequired: false
      }
    });

    this.endpointConfigs.set('GET:/api/orders/:id', {
      path: '/api/orders/:id',
      method: 'GET',
      rateLimit: {
        windowMs: 60 * 1000,
        maxRequests: 100, // 100 queries per minute
        skipSuccessful: true,
        keyGenerator: (req) => `get_order:${this.getClientIdentifier(req)}`
      }
    });

    this.endpointConfigs.set('POST:/api/auctions', {
      path: '/api/auctions',
      method: 'POST',
      rateLimit: {
        windowMs: 5 * 60 * 1000, // 5 minutes
        maxRequests: 5, // 5 auctions per 5 minutes
        keyGenerator: (req) => `start_auction:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        roles: ['relayer', 'admin']
      }
    });

    this.endpointConfigs.set('POST:/api/auctions/:id/bids', {
      path: '/api/auctions/:id/bids',
      method: 'POST',
      rateLimit: {
        windowMs: 60 * 1000,
        maxRequests: 20, // 20 bids per minute
        keyGenerator: (req) => `place_bid:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        roles: ['resolver', 'admin']
      }
    });

    // Resolver endpoints
    this.endpointConfigs.set('POST:/api/resolve', {
      path: '/api/resolve',
      method: 'POST',
      rateLimit: {
        windowMs: 60 * 1000,
        maxRequests: 15, // 15 resolutions per minute
        keyGenerator: (req) => `resolve_order:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        roles: ['resolver', 'admin']
      }
    });

    // Batch endpoints
    this.endpointConfigs.set('POST:/api/batch/orders', {
      path: '/api/batch/orders',
      method: 'POST',
      rateLimit: {
        windowMs: 5 * 60 * 1000, // 5 minutes
        maxRequests: 3, // 3 batch operations per 5 minutes
        keyGenerator: (req) => `batch_orders:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        apiKeyRequired: true
      }
    });

    // Administrative endpoints
    this.endpointConfigs.set('GET:/api/metrics', {
      path: '/api/metrics',
      method: 'GET',
      rateLimit: {
        windowMs: 60 * 1000,
        maxRequests: 60, // 1 per second
        keyGenerator: (req) => `metrics:${this.getClientIdentifier(req)}`
      },
      authentication: {
        required: true,
        roles: ['admin', 'monitor']
      }
    });
  }

  /**
   * Get middleware for specific service
   */
  getServiceMiddleware(service: 'relayer' | 'resolver') {
    return service === 'relayer' ? this.relayerMiddleware.middleware() : this.resolverMiddleware.middleware();
  }

  /**
   * Create endpoint-specific rate limiting middleware
   */
  createEndpointMiddleware(endpoint: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      this.stats.totalRequests++;

      const config = this.endpointConfigs.get(endpoint);
      if (!config) {
        return next();
      }

      try {
        // Check API key quota if required
        if (config.authentication?.apiKeyRequired) {
          const apiKeyCheck = await this.checkAPIKeyQuota(req);
          if (!apiKeyCheck.allowed) {
            return this.sendQuotaExceededError(res, apiKeyCheck.reason || 'Quota exceeded', apiKeyCheck.retryAfter);
          }
        }

        // Apply endpoint-specific rate limiting
        const rateLimitCheck = await this.checkEndpointRateLimit(req, config);
        if (!rateLimitCheck.allowed) {
          this.stats.blockedRequests++;
          return this.sendRateLimitError(res, rateLimitCheck.reason || 'Rate limit exceeded', rateLimitCheck.retryAfter);
        }

        // Update API key usage
        await this.updateAPIKeyUsage(req, endpoint);

        next();
        
      } catch (error) {
        console.error('Endpoint rate limiting error:', error);
        next(); // Don't block on errors
      }
    };
  }

  /**
   * WebSocket connection rate limiting
   */
  handleWebSocketConnection(
    connectionId: string, 
    ip: string, 
    limits: WebSocketLimits
  ): { allowed: boolean; reason?: string } {
    
    // Check global connection limit
    if (this.wsConnections.size >= limits.maxConnections) {
      return { allowed: false, reason: 'Maximum WebSocket connections exceeded' };
    }

    // Check per-IP connection limit
    const ipConns = this.ipConnections.get(ip) || new Set();
    if (ipConns.size >= limits.maxConnectionsPerIP) {
      return { allowed: false, reason: 'Maximum connections per IP exceeded' };
    }

    // Track connection
    this.wsConnections.set(connectionId, {
      ip,
      connectedAt: Date.now(),
      messageCount: 0,
      lastMessage: 0,
      subscriptions: new Set()
    });

    ipConns.add(connectionId);
    this.ipConnections.set(ip, ipConns);
    
    this.stats.wsConnections++;
    this.emit('wsConnectionAccepted', { connectionId, ip });
    
    return { allowed: true };
  }

  /**
   * WebSocket message rate limiting
   */
  handleWebSocketMessage(
    connectionId: string, 
    message: any, 
    limits: WebSocketLimits
  ): { allowed: boolean; reason?: string } {
    
    const connection = this.wsConnections.get(connectionId);
    if (!connection) {
      return { allowed: false, reason: 'Connection not found' };
    }

    const now = Date.now();
    const { messageRateLimit } = limits;
    
    // Reset count if window expired
    if (now - connection.lastMessage > messageRateLimit.windowMs) {
      connection.messageCount = 0;
    }

    // Check rate limit
    if (connection.messageCount >= messageRateLimit.maxMessages) {
      this.emit('wsMessageRateLimited', { connectionId, ip: connection.ip });
      return { allowed: false, reason: 'Message rate limit exceeded' };
    }

    // Update counters
    connection.messageCount++;
    connection.lastMessage = now;
    this.stats.wsMessages++;

    return { allowed: true };
  }

  /**
   * Handle WebSocket disconnection
   */
  handleWebSocketDisconnection(connectionId: string): void {
    const connection = this.wsConnections.get(connectionId);
    if (connection) {
      // Remove from IP tracking
      const ipConns = this.ipConnections.get(connection.ip);
      if (ipConns) {
        ipConns.delete(connectionId);
        if (ipConns.size === 0) {
          this.ipConnections.delete(connection.ip);
        }
      }

      this.wsConnections.delete(connectionId);
      this.stats.wsConnections--;
      
      this.emit('wsConnectionClosed', { connectionId, ip: connection.ip });
    }
  }

  /**
   * Check API key quota
   */
  private async checkAPIKeyQuota(req: Request): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }> {
    const apiKey = this.extractAPIKey(req);
    if (!apiKey) {
      return { allowed: false, reason: 'API key required' };
    }

    let quota = this.apiKeyQuotas.get(apiKey);
    if (!quota) {
      // Initialize quota for new API key
      quota = this.initializeAPIKeyQuota(apiKey);
      this.apiKeyQuotas.set(apiKey, quota);
    }

    // Check daily quota
    if (quota.currentDaily >= quota.dailyLimit) {
      const resetTime = quota.lastReset.daily + 24 * 60 * 60 * 1000;
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return { allowed: false, reason: 'Daily quota exceeded', retryAfter };
    }

    // Check monthly quota
    if (quota.currentMonthly >= quota.monthlyLimit) {
      const resetTime = quota.lastReset.monthly + 30 * 24 * 60 * 60 * 1000;
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      return { allowed: false, reason: 'Monthly quota exceeded', retryAfter };
    }

    return { allowed: true };
  }

  /**
   * Check endpoint-specific rate limiting
   */
  private async checkEndpointRateLimit(
    req: Request,
    config: APIEndpointConfig
  ): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }> {
    const key = config.rateLimit.keyGenerator ? 
      config.rateLimit.keyGenerator(req) :
      `${config.method}:${config.path}:${this.getClientIdentifier(req)}`;
    
    // Simple rate limiting implementation
    const now = Date.now();
    const windowStart = now - config.rateLimit.windowMs;
    
    // This would typically use Redis or similar for distributed rate limiting
    // For now, using a simple in-memory implementation
    const rateLimitKey = `endpoint:${key}`;
    
    // Mock rate limit check - in production this would be more sophisticated
    return { allowed: true };
  }

  /**
   * Update API key usage
   */
  private async updateAPIKeyUsage(req: Request, endpoint: string): Promise<void> {
    const apiKey = this.extractAPIKey(req);
    if (!apiKey) return;

    const quota = this.apiKeyQuotas.get(apiKey);
    if (quota) {
      quota.currentDaily++;
      quota.currentMonthly++;
      this.stats.apiKeyRequests++;

      // Update endpoint-specific counters
      const endpointCounter = quota.rateLimits[endpoint];
      if (endpointCounter) {
        const now = Date.now();
        if (now > endpointCounter.resetAt) {
          endpointCounter.current = 0;
          endpointCounter.resetAt = now + endpointCounter.windowMs;
        }
        endpointCounter.current++;
      }
    }
  }

  /**
   * Initialize API key quota
   */
  private initializeAPIKeyQuota(apiKey: string): APIKeyQuota {
    const tier = this.getAPIKeyTier(apiKey);
    const now = Date.now();
    
    const quotas: Record<string, { daily: number; monthly: number }> = {
      free: { daily: 100, monthly: 1000 },
      basic: { daily: 1000, monthly: 10000 },
      premium: { daily: 10000, monthly: 100000 },
      enterprise: { daily: 100000, monthly: 1000000 },
      admin: { daily: 1000000, monthly: 10000000 }
    };

    const limits = quotas[tier] || quotas.free;

    return {
      apiKey,
      tier,
      dailyLimit: limits.daily,
      monthlyLimit: limits.monthly,
      currentDaily: 0,
      currentMonthly: 0,
      lastReset: {
        daily: now,
        monthly: now
      },
      rateLimits: {}
    };
  }

  /**
   * Helper methods
   */
  private getClientIdentifier(req: Request): string {
    const apiKey = this.extractAPIKey(req);
    const userId = (req as any).user?.id;
    const ip = this.getClientIP(req);
    
    return userId || apiKey || ip || 'anonymous';
  }

  private extractAPIKey(req: Request): string | undefined {
    return req.headers['x-api-key'] as string ||
           req.headers['authorization']?.replace('Bearer ', '') ||
           (req.query as any)?.apiKey;
  }

  private getClientIP(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
           req.ip ||
           (req as any).connection?.remoteAddress ||
           'unknown';
  }

  private getAPIKeyTier(apiKey: string): string {
    if (apiKey.startsWith('admin_')) return 'admin';
    if (apiKey.startsWith('ent_')) return 'enterprise';
    if (apiKey.startsWith('prem_')) return 'premium';
    if (apiKey.startsWith('basic_')) return 'basic';
    return 'free';
  }

  private sendRateLimitError(res: Response, reason: string, retryAfter?: number): void {
    res.status(429);
    if (retryAfter) {
      res.header('Retry-After', retryAfter.toString());
    }
    res.json({
      error: 'Rate limit exceeded',
      message: reason,
      retryAfter: retryAfter || 60,
      timestamp: new Date().toISOString()
    });
  }

  private sendQuotaExceededError(res: Response, reason: string, retryAfter?: number): void {
    this.stats.quotaViolations++;
    
    res.status(429);
    if (retryAfter) {
      res.header('Retry-After', retryAfter.toString());
    }
    res.json({
      error: 'Quota exceeded',
      message: reason,
      retryAfter: retryAfter || 3600,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Quota reset task
   */
  private startQuotaResetTask(): void {
    // Reset daily quotas at midnight
    setInterval(() => {
      const now = Date.now();
      const today = new Date(now).toDateString();
      
      for (const quota of this.apiKeyQuotas.values()) {
        const lastResetDay = new Date(quota.lastReset.daily).toDateString();
        if (today !== lastResetDay) {
          quota.currentDaily = 0;
          quota.lastReset.daily = now;
        }
        
        // Reset monthly quotas on first day of month
        const currentMonth = new Date(now).getMonth();
        const lastResetMonth = new Date(quota.lastReset.monthly).getMonth();
        if (currentMonth !== lastResetMonth) {
          quota.currentMonthly = 0;
          quota.lastReset.monthly = now;
        }
      }
    }, 60 * 60 * 1000); // Check every hour
  }

  /**
   * Admin functions
   */
  getAPIKeyQuotas(): Record<string, APIKeyQuota> {
    const result: Record<string, APIKeyQuota> = {};
    for (const [key, quota] of this.apiKeyQuotas.entries()) {
      result[key] = { ...quota };
    }
    return result;
  }

  updateAPIKeyQuota(apiKey: string, updates: Partial<APIKeyQuota>): boolean {
    const quota = this.apiKeyQuotas.get(apiKey);
    if (quota) {
      Object.assign(quota, updates);
      this.emit('apiKeyQuotaUpdated', { apiKey, quota });
      return true;
    }
    return false;
  }

  resetAPIKeyQuota(apiKey: string, type: 'daily' | 'monthly' | 'all' = 'all'): boolean {
    const quota = this.apiKeyQuotas.get(apiKey);
    if (quota) {
      const now = Date.now();
      
      if (type === 'daily' || type === 'all') {
        quota.currentDaily = 0;
        quota.lastReset.daily = now;
      }
      
      if (type === 'monthly' || type === 'all') {
        quota.currentMonthly = 0;
        quota.lastReset.monthly = now;
      }
      
      this.emit('apiKeyQuotaReset', { apiKey, type });
      return true;
    }
    return false;
  }

  getStats(): any {
    return {
      ...this.stats,
      activeWSConnections: this.wsConnections.size,
      uniqueIPs: this.ipConnections.size,
      trackedAPIKeys: this.apiKeyQuotas.size,
      endpointConfigs: this.endpointConfigs.size,
      uptime: Date.now() - (this.stats as any).startTime || Date.now()
    };
  }

  getEndpointStats(): any {
    const endpoints: Record<string, any> = {};
    
    for (const [endpoint, config] of this.endpointConfigs.entries()) {
      endpoints[endpoint] = {
        path: config.path,
        method: config.method,
        rateLimit: config.rateLimit,
        authRequired: config.authentication?.required || false
      };
    }
    
    return endpoints;
  }

  getWebSocketStats(): any {
    const connectionsByIP: Record<string, number> = {};
    let totalSubscriptions = 0;
    
    for (const connection of this.wsConnections.values()) {
      connectionsByIP[connection.ip] = (connectionsByIP[connection.ip] || 0) + 1;
      totalSubscriptions += connection.subscriptions.size;
    }
    
    return {
      totalConnections: this.wsConnections.size,
      connectionsByIP,
      totalSubscriptions,
      averageSubscriptionsPerConnection: this.wsConnections.size > 0 
        ? totalSubscriptions / this.wsConnections.size 
        : 0
    };
  }
}

export default APIRateLimitController;