import { EventEmitter } from 'events';

/**
 * Frontend DOS Protection Service
 * 
 * Provides client-side protection with:
 * - Request rate limiting and throttling
 * - Request queuing with priority management
 * - Progressive delays for failed requests
 * - CAPTCHA integration for suspicious activity
 * - Client-side caching to reduce redundant requests
 * - Connection management and circuit breaker
 */

export interface RequestThrottleConfig {
  enabled: boolean;
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxRetryDelayMs: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  burstAllowed: number;
  progressiveDelayEnabled: boolean;
  progressiveDelayMultiplier: number;
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: number;
  defaultTtlMs: number;
  compressionEnabled: boolean;
}

export interface CaptchaConfig {
  enabled: boolean;
  provider: 'recaptcha' | 'hcaptcha' | 'turnstile';
  siteKey: string;
  threshold: number; // Number of failures before CAPTCHA
  bypassCookieName: string;
  bypassTtlMs: number;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  recoveryTimeoutMs: number;
  halfOpenMaxRequests: number;
}

export interface FrontendProtectionConfig {
  throttling: RequestThrottleConfig;
  rateLimit: RateLimitConfig;
  cache: CacheConfig;
  captcha: CaptchaConfig;
  circuitBreaker: CircuitBreakerConfig;
  suspiciousActivityDetection: {
    enabled: boolean;
    rapidClickThreshold: number;
    rapidClickWindowMs: number;
    repeatedFailureThreshold: number;
    repeatedFailureWindowMs: number;
  };
}

export interface QueuedRequest {
  id: string;
  url: string;
  options: RequestInit;
  priority: number;
  timestamp: number;
  retryCount: number;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

export interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
  compressed?: boolean;
}

export interface RateLimitState {
  requests: number[];
  violations: number;
  lastViolation: number;
  progressiveDelay: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class FrontendProtectionService extends EventEmitter {
  private config: FrontendProtectionConfig;
  private requestQueue: QueuedRequest[] = [];
  private activeRequests: Set<string> = new Set();
  private cache: Map<string, CacheEntry> = new Map();
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private circuitState: CircuitState = 'closed';
  private circuitFailures = 0;
  private circuitLastFailure = 0;
  private circuitHalfOpenRequests = 0;
  private suspiciousActivity = {
    rapidClicks: 0,
    rapidClickStart: 0,
    repeatedFailures: 0,
    repeatedFailureStart: 0
  };
  private captchaRequired = false;
  private queueProcessor?: number;

  constructor(config?: Partial<FrontendProtectionConfig>) {
    super();
    
    this.config = {
      throttling: {
        enabled: true,
        maxConcurrentRequests: 6,
        requestTimeoutMs: 30000,
        retryAttempts: 3,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 10000
      },
      rateLimit: {
        enabled: true,
        windowMs: 60000, // 1 minute
        maxRequests: 60,
        burstAllowed: 10,
        progressiveDelayEnabled: true,
        progressiveDelayMultiplier: 1.5
      },
      cache: {
        enabled: true,
        maxSize: 100,
        defaultTtlMs: 300000, // 5 minutes
        compressionEnabled: true
      },
      captcha: {
        enabled: true,
        provider: 'recaptcha',
        siteKey: process.env.REACT_APP_RECAPTCHA_SITE_KEY || '',
        threshold: 5,
        bypassCookieName: 'captcha_bypass',
        bypassTtlMs: 3600000 // 1 hour
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 10,
        recoveryTimeoutMs: 30000,
        halfOpenMaxRequests: 3
      },
      suspiciousActivityDetection: {
        enabled: true,
        rapidClickThreshold: 10,
        rapidClickWindowMs: 5000,
        repeatedFailureThreshold: 5,
        repeatedFailureWindowMs: 60000
      },
      ...config
    };

    this.startQueueProcessor();
    this.startCleanupTasks();
    
    console.log('🛡️ Frontend Protection Service initialized');
  }

  /**
   * Make a protected HTTP request
   */
  async fetch(url: string, options: RequestInit = {}, priority = 0): Promise<Response> {
    // Check circuit breaker
    if (this.config.circuitBreaker.enabled && this.circuitState === 'open') {
      const timeSinceLastFailure = Date.now() - this.circuitLastFailure;
      if (timeSinceLastFailure < this.config.circuitBreaker.recoveryTimeoutMs) {
        throw new Error('Circuit breaker is open - service temporarily unavailable');
      } else {
        this.circuitState = 'half-open';
        this.circuitHalfOpenRequests = 0;
      }
    }

    // Check rate limiting
    if (this.config.rateLimit.enabled) {
      const rateLimitCheck = this.checkRateLimit(url);
      if (!rateLimitCheck.allowed) {
        await this.applyProgressiveDelay(url, rateLimitCheck.delay);
        this.emit('rateLimitViolation', { url, delay: rateLimitCheck.delay });
      }
    }

    // Check cache first
    if (options.method === 'GET' || !options.method) {
      const cached = this.getCachedResponse(url);
      if (cached) {
        this.emit('cacheHit', { url });
        return new Response(JSON.stringify(cached.data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Check CAPTCHA requirement
    if (this.captchaRequired && this.config.captcha.enabled) {
      const captchaToken = await this.getCaptchaToken();
      options.headers = {
        ...options.headers,
        'X-Captcha-Token': captchaToken
      };
    }

    // Queue the request
    return this.queueRequest(url, options, priority);
  }

  /**
   * Queue a request for processing
   */
  private async queueRequest(url: string, options: RequestInit, priority: number): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const requestId = this.generateRequestId();
      const queuedRequest: QueuedRequest = {
        id: requestId,
        url,
        options,
        priority,
        timestamp: Date.now(),
        retryCount: 0,
        resolve,
        reject
      };

      // Insert request into queue based on priority
      const insertIndex = this.requestQueue.findIndex(req => req.priority < priority);
      if (insertIndex === -1) {
        this.requestQueue.push(queuedRequest);
      } else {
        this.requestQueue.splice(insertIndex, 0, queuedRequest);
      }

      this.emit('requestQueued', { requestId, url, priority, queueSize: this.requestQueue.length });
    });
  }

  /**
   * Process request queue
   */
  private startQueueProcessor(): void {
    this.queueProcessor = window.setInterval(() => {
      this.processQueue();
    }, 100); // Process every 100ms
  }

  private async processQueue(): Promise<void> {
    // Don't process if at max concurrent requests
    if (this.activeRequests.size >= this.config.throttling.maxConcurrentRequests) {
      return;
    }

    // Don't process if circuit is open
    if (this.circuitState === 'open') {
      return;
    }

    // Don't process if half-open and at limit
    if (this.circuitState === 'half-open' && 
        this.circuitHalfOpenRequests >= this.config.circuitBreaker.halfOpenMaxRequests) {
      return;
    }

    const request = this.requestQueue.shift();
    if (!request) {
      return;
    }

    // Check if request has timed out
    const requestAge = Date.now() - request.timestamp;
    if (requestAge > this.config.throttling.requestTimeoutMs) {
      request.reject(new Error('Request timeout'));
      this.emit('requestTimeout', { requestId: request.id, age: requestAge });
      return;
    }

    this.processRequest(request);
  }

  /**
   * Process individual request
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    this.activeRequests.add(request.id);

    if (this.circuitState === 'half-open') {
      this.circuitHalfOpenRequests++;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.config.throttling.requestTimeoutMs);

      const response = await fetch(request.url, {
        ...request.options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle successful response
      if (response.ok) {
        this.handleRequestSuccess(request, response);
        
        // Cache GET requests
        if ((!request.options.method || request.options.method === 'GET') && this.config.cache.enabled) {
          await this.cacheResponse(request.url, response.clone());
        }
        
        request.resolve(response);
      } else {
        this.handleRequestError(request, new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

    } catch (error) {
      this.handleRequestError(request, error as Error);
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  /**
   * Handle successful request
   */
  private handleRequestSuccess(request: QueuedRequest, response: Response): void {
    // Reset circuit breaker on success
    if (this.circuitState === 'half-open') {
      this.circuitState = 'closed';
      this.circuitFailures = 0;
      this.circuitHalfOpenRequests = 0;
      this.emit('circuitBreakerClosed');
    }

    // Reset suspicious activity counters on success
    this.suspiciousActivity.repeatedFailures = 0;
    
    this.emit('requestSuccess', { 
      requestId: request.id, 
      url: request.url, 
      status: response.status 
    });
  }

  /**
   * Handle request error
   */
  private handleRequestError(request: QueuedRequest, error: Error): void {
    // Update circuit breaker
    if (this.config.circuitBreaker.enabled) {
      this.circuitFailures++;
      this.circuitLastFailure = Date.now();

      if (this.circuitState === 'half-open') {
        this.circuitState = 'open';
        this.emit('circuitBreakerOpened', { reason: 'Half-open request failed' });
      } else if (this.circuitFailures >= this.config.circuitBreaker.failureThreshold) {
        this.circuitState = 'open';
        this.emit('circuitBreakerOpened', { reason: 'Failure threshold exceeded' });
      }
    }

    // Track suspicious activity
    this.trackSuspiciousActivity('failure');

    // Retry logic
    if (request.retryCount < this.config.throttling.retryAttempts) {
      this.retryRequest(request, error);
    } else {
      request.reject(error);
      this.emit('requestFailed', { 
        requestId: request.id, 
        url: request.url, 
        error: error.message,
        retryCount: request.retryCount
      });
    }
  }

  /**
   * Retry failed request
   */
  private retryRequest(request: QueuedRequest, lastError: Error): void {
    request.retryCount++;
    
    const delay = Math.min(
      this.config.throttling.retryDelayMs * 
      Math.pow(this.config.throttling.backoffMultiplier, request.retryCount - 1),
      this.config.throttling.maxRetryDelayMs
    );

    setTimeout(() => {
      // Re-queue the request
      const insertIndex = this.requestQueue.findIndex(req => req.priority < request.priority);
      if (insertIndex === -1) {
        this.requestQueue.push(request);
      } else {
        this.requestQueue.splice(insertIndex, 0, request);
      }

      this.emit('requestRetried', { 
        requestId: request.id, 
        url: request.url, 
        retryCount: request.retryCount,
        delay
      });
    }, delay);
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(url: string): { allowed: boolean; delay: number } {
    const key = new URL(url).pathname;
    const now = Date.now();
    
    let state = this.rateLimitState.get(key);
    if (!state) {
      state = {
        requests: [],
        violations: 0,
        lastViolation: 0,
        progressiveDelay: 0
      };
      this.rateLimitState.set(key, state);
    }

    // Clean old requests
    const windowStart = now - this.config.rateLimit.windowMs;
    state.requests = state.requests.filter(time => time > windowStart);

    // Check if within limits
    if (state.requests.length < this.config.rateLimit.maxRequests) {
      state.requests.push(now);
      return { allowed: true, delay: 0 };
    }

    // Check burst allowance
    const recentRequests = state.requests.filter(time => time > (now - 1000)); // Last second
    if (recentRequests.length < this.config.rateLimit.burstAllowed) {
      state.requests.push(now);
      return { allowed: true, delay: 0 };
    }

    // Rate limit violated
    state.violations++;
    state.lastViolation = now;
    
    if (this.config.rateLimit.progressiveDelayEnabled) {
      state.progressiveDelay = Math.min(
        1000 * Math.pow(this.config.rateLimit.progressiveDelayMultiplier, state.violations),
        30000 // Max 30 seconds
      );
    }

    return { allowed: false, delay: state.progressiveDelay };
  }

  /**
   * Apply progressive delay
   */
  private async applyProgressiveDelay(url: string, delay: number): Promise<void> {
    if (delay > 0) {
      this.emit('progressiveDelay', { url, delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Cache response
   */
  private async cacheResponse(url: string, response: Response): Promise<void> {
    try {
      const data = await response.json();
      const ttl = this.getCacheTTL(url);
      
      // Compress data if enabled
      let processedData = data;
      if (this.config.cache.compressionEnabled) {
        processedData = this.compressData(data);
      }

      const entry: CacheEntry = {
        data: processedData,
        timestamp: Date.now(),
        ttl,
        compressed: this.config.cache.compressionEnabled
      };

      // Evict oldest entries if at max size
      if (this.cache.size >= this.config.cache.maxSize) {
        const oldestKey = Array.from(this.cache.keys())[0];
        this.cache.delete(oldestKey);
      }

      this.cache.set(url, entry);
      this.emit('responseCached', { url, size: JSON.stringify(data).length });
    } catch (error) {
      // Ignore caching errors
    }
  }

  /**
   * Get cached response
   */
  private getCachedResponse(url: string): any | null {
    const entry = this.cache.get(url);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(url);
      return null;
    }

    let data = entry.data;
    if (entry.compressed) {
      data = this.decompressData(data);
    }

    return { data };
  }

  /**
   * Track suspicious activity
   */
  private trackSuspiciousActivity(type: 'click' | 'failure'): void {
    if (!this.config.suspiciousActivityDetection.enabled) {
      return;
    }

    const now = Date.now();

    if (type === 'click') {
      // Reset window if needed
      if (now - this.suspiciousActivity.rapidClickStart > this.config.suspiciousActivityDetection.rapidClickWindowMs) {
        this.suspiciousActivity.rapidClicks = 0;
        this.suspiciousActivity.rapidClickStart = now;
      }

      this.suspiciousActivity.rapidClicks++;

      if (this.suspiciousActivity.rapidClicks >= this.config.suspiciousActivityDetection.rapidClickThreshold) {
        this.handleSuspiciousActivity('rapid_clicks');
      }
    } else if (type === 'failure') {
      // Reset window if needed
      if (now - this.suspiciousActivity.repeatedFailureStart > this.config.suspiciousActivityDetection.repeatedFailureWindowMs) {
        this.suspiciousActivity.repeatedFailures = 0;
        this.suspiciousActivity.repeatedFailureStart = now;
      }

      this.suspiciousActivity.repeatedFailures++;

      if (this.suspiciousActivity.repeatedFailures >= this.config.suspiciousActivityDetection.repeatedFailureThreshold) {
        this.handleSuspiciousActivity('repeated_failures');
      }
    }
  }

  /**
   * Handle suspicious activity detection
   */
  private handleSuspiciousActivity(type: string): void {
    this.emit('suspiciousActivity', { type, timestamp: Date.now() });

    // Require CAPTCHA if threshold exceeded
    if (this.config.captcha.enabled && !this.captchaRequired) {
      this.captchaRequired = true;
      this.emit('captchaRequired', { reason: type });
    }
  }

  /**
   * Get CAPTCHA token
   */
  private async getCaptchaToken(): Promise<string> {
    // Check for bypass cookie
    const bypassCookie = this.getCookie(this.config.captcha.bypassCookieName);
    if (bypassCookie) {
      return bypassCookie;
    }

    // This would integrate with actual CAPTCHA provider
    return new Promise((resolve, reject) => {
      if (this.config.captcha.provider === 'recaptcha') {
        // Google reCAPTCHA integration
        if (typeof (window as any).grecaptcha !== 'undefined') {
          (window as any).grecaptcha.execute(this.config.captcha.siteKey, { action: 'submit' })
            .then((token: string) => {
              this.setCookie(this.config.captcha.bypassCookieName, token, this.config.captcha.bypassTtlMs);
              resolve(token);
            })
            .catch(reject);
        } else {
          reject(new Error('reCAPTCHA not loaded'));
        }
      } else {
        // Fallback - in production, implement other providers
        resolve('fallback-token');
      }
    });
  }

  /**
   * Utility methods
   */
  private generateRequestId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  private getCacheTTL(url: string): number {
    // Different TTLs based on endpoint
    if (url.includes('/orders/')) return 30000; // 30 seconds
    if (url.includes('/metrics')) return 10000; // 10 seconds
    if (url.includes('/health')) return 5000; // 5 seconds
    return this.config.cache.defaultTtlMs;
  }

  private compressData(data: any): string {
    // Simple compression simulation - in production use actual compression
    return JSON.stringify(data);
  }

  private decompressData(compressed: string): any {
    // Simple decompression simulation
    return JSON.parse(compressed);
  }

  private getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  private setCookie(name: string, value: string, maxAge: number): void {
    document.cookie = `${name}=${value}; max-age=${Math.floor(maxAge / 1000)}; path=/; secure; samesite=strict`;
  }

  /**
   * Start cleanup tasks
   */
  private startCleanupTasks(): void {
    // Clean expired cache entries
    setInterval(() => {
      const now = Date.now();
      for (const [url, entry] of this.cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          this.cache.delete(url);
        }
      }
    }, 60000); // Every minute

    // Clean rate limit state
    setInterval(() => {
      const now = Date.now();
      for (const [key, state] of this.rateLimitState.entries()) {
        const windowStart = now - this.config.rateLimit.windowMs;
        state.requests = state.requests.filter(time => time > windowStart);
        
        // Remove empty states
        if (state.requests.length === 0 && now - state.lastViolation > this.config.rateLimit.windowMs) {
          this.rateLimitState.delete(key);
        }
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Public API methods
   */
  
  // Track user interactions for suspicious activity detection
  trackUserInteraction(type: 'click' | 'keypress' | 'scroll'): void {
    if (type === 'click') {
      this.trackSuspiciousActivity('click');
    }
  }

  // Clear cache
  clearCache(pattern?: string): void {
    if (pattern) {
      for (const url of this.cache.keys()) {
        if (url.includes(pattern)) {
          this.cache.delete(url);
        }
      }
    } else {
      this.cache.clear();
    }
    this.emit('cacheCleared', { pattern });
  }

  // Reset CAPTCHA requirement
  resetCaptcha(): void {
    this.captchaRequired = false;
    this.suspiciousActivity.rapidClicks = 0;
    this.suspiciousActivity.repeatedFailures = 0;
    this.emit('captchaReset');
  }

  // Get service statistics
  getStats(): any {
    return {
      queueSize: this.requestQueue.length,
      activeRequests: this.activeRequests.size,
      cacheSize: this.cache.size,
      circuitState: this.circuitState,
      circuitFailures: this.circuitFailures,
      captchaRequired: this.captchaRequired,
      suspiciousActivity: { ...this.suspiciousActivity },
      rateLimitStates: this.rateLimitState.size
    };
  }

  // Update configuration
  updateConfig(newConfig: Partial<FrontendProtectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  // Shutdown service
  shutdown(): void {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
    }
    
    // Reject all pending requests
    for (const request of this.requestQueue) {
      request.reject(new Error('Service shutting down'));
    }
    
    this.requestQueue.length = 0; // Clear array
    this.cache.clear();
    this.rateLimitState.clear();
    
    this.emit('shutdown');
  }
}

// Export singleton instance
export const frontendProtection = new FrontendProtectionService();

export default frontendProtection;