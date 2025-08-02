import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * Comprehensive Rate Limiting Monitoring and Alerting System
 * 
 * Provides real-time monitoring with:
 * - Multi-layer metrics collection (contracts, backend, frontend, infrastructure)
 * - Real-time alerting with multiple notification channels
 * - Security event correlation and threat detection
 * - Performance monitoring and SLA tracking
 * - Automated response mechanisms
 * - Dashboard data aggregation
 * - Historical analysis and reporting
 */

export interface MetricData {
  timestamp: number;
  source: string; // 'contract', 'relayer', 'resolver', 'frontend', 'nginx'
  type: string;
  value: number;
  tags: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: string[];
  metric: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'change_rate' | 'anomaly';
  threshold: number;
  timeWindow: number; // ms
  minDataPoints: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channels: AlertChannel[];
  cooldownPeriod: number; // ms to avoid alert spam
  suppressionRules?: SuppressionRule[];
  autoResponse?: AutoResponseAction[];
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'sms' | 'dashboard';
  config: {
    url?: string;
    recipients?: string[];
    apiKey?: string;
    template?: string;
  };
  enabled: boolean;
}

export interface SuppressionRule {
  condition: string;
  duration: number;
}

export interface AutoResponseAction {
  type: 'block_ip' | 'increase_rate_limit' | 'circuit_breaker' | 'scale_up' | 'notify_admin';
  config: Record<string, any>;
  delay?: number;
}

export interface SecurityEvent {
  id: string;
  timestamp: number;
  source: string;
  type: 'rate_limit_violation' | 'dos_attack' | 'suspicious_pattern' | 'circuit_breaker_trip' | 'security_breach';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: {
    ip?: string;
    userAgent?: string;
    endpoint?: string;
    userId?: string;
    violationType?: string;
    metrics?: MetricData[];
  };
  correlation: {
    relatedEvents: string[];
    attackPattern?: string;
    confidence: number;
  };
  response: {
    automated: AutoResponseAction[];
    manual: string[];
    status: 'pending' | 'in_progress' | 'resolved' | 'escalated';
  };
}

export interface DashboardData {
  overview: {
    totalRequests: number;
    blockedRequests: number;
    blockRate: number;
    activeAlerts: number;
    systemHealth: 'healthy' | 'degraded' | 'critical';
  };
  rateLimits: {
    byTier: Record<string, { requests: number; blocked: number; rate: number }>;
    byEndpoint: Record<string, { requests: number; blocked: number; avgResponseTime: number }>;
    byChain: Record<string, { operations: number; blocked: number; queueSize: number }>;
  };
  security: {
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
    activeThreats: number;
    blockedIPs: number;
    suspiciousActivity: number;
  };
  performance: {
    avgResponseTime: number;
    throughput: number;
    errorRate: number;
    uptime: number;
  };
}

export interface ThreatIntelligence {
  ip: string;
  reputation: 'good' | 'suspicious' | 'malicious';
  lastSeen: number;
  activities: {
    violationCount: number;
    patterns: string[];
    locations: string[];
    userAgents: string[];
  };
  riskScore: number;
  automated: boolean;
}

export class RateLimitMonitor extends EventEmitter {
  private metrics: Map<string, MetricData[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, any> = new Map();
  private securityEvents: SecurityEvent[] = [];
  private threatIntelligence: Map<string, ThreatIntelligence> = new Map();
  
  // Alert state management
  private alertCooldowns: Map<string, number> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();
  
  // Performance tracking
  private performanceMetrics = {
    requestCounts: new Map<string, number>(),
    responseTimes: new Map<string, number[]>(),
    errorCounts: new Map<string, number>(),
    lastReset: Date.now()
  };
  
  // Anomaly detection
  private baselineMetrics: Map<string, { mean: number; stdDev: number; samples: number[] }> = new Map();
  
  // Configuration
  private config = {
    metricsRetention: 24 * 60 * 60 * 1000, // 24 hours
    alertRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
    securityEventRetention: 30 * 24 * 60 * 60 * 1000, // 30 days
    baselineUpdateInterval: 60 * 60 * 1000, // 1 hour
    anomalyThreshold: 2.5, // Standard deviations
    threatScoreThreshold: 80,
    autoResponseEnabled: process.env.AUTO_RESPONSE_ENABLED === 'true'
  };

  constructor() {
    super();
    
    this.initializeDefaultAlertRules();
    this.startBackgroundTasks();
    
    console.log('📊 Rate Limit Monitor initialized');
  }

  /**
   * Record a metric data point
   */
  recordMetric(metric: Omit<MetricData, 'timestamp'>): void {
    const metricData: MetricData = {
      ...metric,
      timestamp: Date.now()
    };

    const key = `${metric.source}:${metric.type}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    this.metrics.get(key)!.push(metricData);
    
    // Update performance metrics
    this.updatePerformanceMetrics(metricData);
    
    // Check alert rules
    this.checkAlertRules(metricData);
    
    // Update baselines for anomaly detection
    this.updateBaselines(key, metricData.value);
    
    this.emit('metricRecorded', metricData);
  }

  /**
   * Record a security event
   */
  async recordSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp' | 'correlation' | 'response'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
      correlation: {
        relatedEvents: [],
        confidence: 0
      },
      response: {
        automated: [],
        manual: [],
        status: 'pending'
      }
    };

    // Correlate with existing events
    this.correlateSecurityEvent(securityEvent);
    
    // Update threat intelligence
    if (securityEvent.details.ip) {
      this.updateThreatIntelligence(securityEvent);
    }
    
    this.securityEvents.push(securityEvent);
    
    // Trigger automated responses if enabled
    if (this.config.autoResponseEnabled && securityEvent.severity in ['high', 'critical']) {
      await this.triggerSecurityEventResponse(securityEvent);
    }
    
    // Create alert if needed
    this.createSecurityAlert(securityEvent);
    
    this.emit('securityEvent', securityEvent);
  }

  /**
   * Create or update an alert rule
   */
  setAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.emit('alertRuleUpdated', rule);
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    this.emit('alertRuleRemoved', ruleId);
  }

  /**
   * Get current dashboard data
   */
  getDashboardData(): DashboardData {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    
    // Calculate overview metrics
    const recentMetrics = this.getMetricsInTimeRange(last24h, now);
    const totalRequests = this.sumMetricValues(recentMetrics, 'requests');
    const blockedRequests = this.sumMetricValues(recentMetrics, 'blocked');
    const blockRate = totalRequests > 0 ? (blockedRequests / totalRequests) * 100 : 0;
    
    // System health assessment
    let systemHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (blockRate > 50) systemHealth = 'critical';
    else if (blockRate > 20 || this.activeAlerts.size > 0) systemHealth = 'degraded';
    
    // Rate limits by tier
    const rateLimitsByTier = this.aggregateRateLimitsByTier(recentMetrics);
    
    // Rate limits by endpoint
    const rateLimitsByEndpoint = this.aggregateRateLimitsByEndpoint(recentMetrics);
    
    // Cross-chain metrics
    const rateLimitsByChain = this.aggregateRateLimitsByChain(recentMetrics);
    
    // Security metrics
    const recentSecurityEvents = this.securityEvents.filter(e => e.timestamp > last24h);
    const threatLevel = this.calculateThreatLevel(recentSecurityEvents);
    
    // Performance metrics
    const avgResponseTime = this.calculateAverageResponseTime();
    const throughput = this.calculateThroughput();
    const errorRate = this.calculateErrorRate();
    const uptime = this.calculateUptime();
    
    return {
      overview: {
        totalRequests,
        blockedRequests,
        blockRate,
        activeAlerts: this.activeAlerts.size,
        systemHealth
      },
      rateLimits: {
        byTier: rateLimitsByTier,
        byEndpoint: rateLimitsByEndpoint,
        byChain: rateLimitsByChain
      },
      security: {
        threatLevel,
        activeThreats: recentSecurityEvents.filter(e => e.severity in ['high', 'critical']).length,
        blockedIPs: Array.from(this.threatIntelligence.values()).filter(t => t.reputation === 'malicious').length,
        suspiciousActivity: recentSecurityEvents.length
      },
      performance: {
        avgResponseTime,
        throughput,
        errorRate,
        uptime
      }
    };
  }

  /**
   * Get metrics for a specific time range
   */
  getMetricsInTimeRange(startTime: number, endTime: number): MetricData[] {
    const result: MetricData[] = [];
    
    for (const metricList of this.metrics.values()) {
      const filteredMetrics = metricList.filter(
        m => m.timestamp >= startTime && m.timestamp <= endTime
      );
      result.push(...filteredMetrics);
    }
    
    return result;
  }

  /**
   * Get threat intelligence data
   */
  getThreatIntelligence(ip?: string): ThreatIntelligence[] {
    if (ip) {
      const threat = this.threatIntelligence.get(ip);
      return threat ? [threat] : [];
    }
    
    return Array.from(this.threatIntelligence.values())
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 100); // Top 100 threats
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): any[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get security events
   */
  getSecurityEvents(severity?: string, limit = 100): SecurityEvent[] {
    let events = [...this.securityEvents];
    
    if (severity) {
      events = events.filter(e => e.severity === severity);
    }
    
    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Check alert rules against metric data
   */
  private checkAlertRules(metric: MetricData): void {
    const now = Date.now();
    
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled || !rule.source.includes(metric.source)) {
        continue;
      }
      
      if (rule.metric !== metric.type) {
        continue;
      }
      
      // Check cooldown period
      const lastAlert = this.lastAlertTimes.get(rule.id);
      if (lastAlert && now - lastAlert < rule.cooldownPeriod) {
        continue;
      }
      
      // Evaluate alert condition
      if (this.evaluateAlertCondition(rule, metric)) {
        this.triggerAlert(rule, metric);
      }
    }
  }

  /**
   * Evaluate alert condition
   */
  private evaluateAlertCondition(rule: AlertRule, metric: MetricData): boolean {
    const now = Date.now();
    const key = `${metric.source}:${metric.type}`;
    const recentMetrics = this.metrics.get(key)?.filter(
      m => now - m.timestamp <= rule.timeWindow
    ) || [];
    
    if (recentMetrics.length < rule.minDataPoints) {
      return false;
    }
    
    switch (rule.condition) {
      case 'greater_than':
        return metric.value > rule.threshold;
        
      case 'less_than':
        return metric.value < rule.threshold;
        
      case 'equals':
        return metric.value === rule.threshold;
        
      case 'change_rate':
        if (recentMetrics.length < 2) return false;
        const oldValue = recentMetrics[recentMetrics.length - 2].value;
        const changeRate = Math.abs((metric.value - oldValue) / oldValue) * 100;
        return changeRate > rule.threshold;
        
      case 'anomaly':
        const baseline = this.baselineMetrics.get(key);
        if (!baseline) return false;
        const zScore = Math.abs((metric.value - baseline.mean) / baseline.stdDev);
        return zScore > this.config.anomalyThreshold;
        
      default:
        return false;
    }
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(rule: AlertRule, metric: MetricData): Promise<void> {
    const alertId = this.generateEventId();
    const now = Date.now();
    
    const alert = {
      id: alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      timestamp: now,
      metric,
      message: this.generateAlertMessage(rule, metric),
      status: 'active',
      acknowledgedBy: null,
      resolvedAt: null
    };
    
    this.activeAlerts.set(alertId, alert);
    this.lastAlertTimes.set(rule.id, now);
    
    // Send notifications
    for (const channel of rule.channels) {
      if (channel.enabled) {
        try {
          await this.sendNotification(channel, alert);
        } catch (error) {
          console.error(`Failed to send notification via ${channel.type}:`, error);
        }
      }
    }
    
    // Execute auto-responses
    if (rule.autoResponse && this.config.autoResponseEnabled) {
      for (const action of rule.autoResponse) {
        try {
          await this.executeAutoResponse(action, alert);
        } catch (error) {
          console.error(`Failed to execute auto-response ${action.type}:`, error);
        }
      }
    }
    
    this.emit('alertTriggered', alert);
  }

  /**
   * Send notification through specified channel
   */
  private async sendNotification(channel: AlertChannel, alert: any): Promise<void> {
    switch (channel.type) {
      case 'email':
        await this.sendEmailNotification(channel, alert);
        break;
        
      case 'slack':
        await this.sendSlackNotification(channel, alert);
        break;
        
      case 'webhook':
        await this.sendWebhookNotification(channel, alert);
        break;
        
      case 'sms':
        await this.sendSMSNotification(channel, alert);
        break;
        
      case 'dashboard':
        this.sendDashboardNotification(alert);
        break;
    }
  }

  /**
   * Execute automated response action
   */
  private async executeAutoResponse(action: AutoResponseAction, alert: any): Promise<void> {
    if (action.delay) {
      await new Promise(resolve => setTimeout(resolve, action.delay));
    }
    
    switch (action.type) {
      case 'block_ip':
        await this.blockIP(action.config.ip || alert.metric.tags.ip, action.config.duration);
        break;
        
      case 'increase_rate_limit':
        await this.adjustRateLimit(action.config.rule, action.config.factor);
        break;
        
      case 'circuit_breaker':
        await this.triggerCircuitBreaker(action.config.service, action.config.reason);
        break;
        
      case 'scale_up':
        await this.requestScaling(action.config.service, action.config.instances);
        break;
        
      case 'notify_admin':
        await this.notifyAdministrator(alert, action.config.urgency);
        break;
    }
    
    this.emit('autoResponseExecuted', { action, alert });
  }

  /**
   * Correlate security event with existing events
   */
  private correlateSecurityEvent(event: SecurityEvent): void {
    const now = Date.now();
    const correlationWindow = 10 * 60 * 1000; // 10 minutes
    const recentEvents = this.securityEvents.filter(
      e => now - e.timestamp <= correlationWindow
    );
    
    // Find related events
    const relatedEvents: string[] = [];
    let confidence = 0;
    
    for (const existingEvent of recentEvents) {
      let relationScore = 0;
      
      // Same IP
      if (event.details.ip && event.details.ip === existingEvent.details.ip) {
        relationScore += 30;
      }
      
      // Same user agent
      if (event.details.userAgent && event.details.userAgent === existingEvent.details.userAgent) {
        relationScore += 20;
      }
      
      // Same event type
      if (event.type === existingEvent.type) {
        relationScore += 25;
      }
      
      // Same user
      if (event.details.userId && event.details.userId === existingEvent.details.userId) {
        relationScore += 35;
      }
      
      if (relationScore >= 30) {
        relatedEvents.push(existingEvent.id);
        confidence = Math.max(confidence, relationScore);
      }
    }
    
    event.correlation.relatedEvents = relatedEvents;
    event.correlation.confidence = confidence;
    
    // Detect attack patterns
    if (relatedEvents.length >= 3) {
      event.correlation.attackPattern = this.detectAttackPattern(event, recentEvents);
    }
  }

  /**
   * Update threat intelligence
   */
  private updateThreatIntelligence(event: SecurityEvent): void {
    const ip = event.details.ip!;
    let threat = this.threatIntelligence.get(ip);
    
    if (!threat) {
      threat = {
        ip,
        reputation: 'good',
        lastSeen: event.timestamp,
        activities: {
          violationCount: 0,
          patterns: [],
          locations: [],
          userAgents: []
        },
        riskScore: 0,
        automated: false
      };
    }
    
    // Update activity data
    threat.lastSeen = event.timestamp;
    threat.activities.violationCount++;
    
    if (event.details.userAgent && !threat.activities.userAgents.includes(event.details.userAgent)) {
      threat.activities.userAgents.push(event.details.userAgent);
    }
    
    if (!threat.activities.patterns.includes(event.type)) {
      threat.activities.patterns.push(event.type);
    }
    
    // Calculate risk score
    threat.riskScore = this.calculateRiskScore(threat);
    
    // Update reputation
    if (threat.riskScore >= this.config.threatScoreThreshold) {
      threat.reputation = 'malicious';
    } else if (threat.riskScore >= 50) {
      threat.reputation = 'suspicious';
    }
    
    this.threatIntelligence.set(ip, threat);
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-rate-limit-violations',
        name: 'High Rate Limit Violations',
        description: 'Too many rate limit violations detected',
        enabled: true,
        source: ['relayer', 'resolver', 'nginx'],
        metric: 'rate_limit_violations',
        condition: 'greater_than',
        threshold: 100,
        timeWindow: 5 * 60 * 1000,
        minDataPoints: 1,
        severity: 'high',
        channels: [
          { type: 'dashboard', config: {}, enabled: true },
          { type: 'email', config: { recipients: ['admin@example.com'] }, enabled: true }
        ],
        cooldownPeriod: 5 * 60 * 1000
      },
      {
        id: 'dos-attack-detected',
        name: 'DoS Attack Detected',
        description: 'Potential DoS attack pattern detected',
        enabled: true,
        source: ['nginx', 'relayer', 'resolver'],
        metric: 'blocked_requests',
        condition: 'greater_than',
        threshold: 1000,
        timeWindow: 1 * 60 * 1000,
        minDataPoints: 1,
        severity: 'critical',
        channels: [
          { type: 'dashboard', config: {}, enabled: true },
          { type: 'email', config: { recipients: ['security@example.com'] }, enabled: true },
          { type: 'slack', config: { url: process.env.SLACK_WEBHOOK_URL }, enabled: !!process.env.SLACK_WEBHOOK_URL }
        ],
        cooldownPeriod: 2 * 60 * 1000,
        autoResponse: [
          { type: 'circuit_breaker', config: { service: 'global', reason: 'DoS attack detected' } },
          { type: 'notify_admin', config: { urgency: 'immediate' } }
        ]
      },
      {
        id: 'circuit-breaker-trips',
        name: 'Circuit Breaker Trips',
        description: 'Circuit breaker has been triggered',
        enabled: true,
        source: ['relayer', 'resolver', 'cross-chain'],
        metric: 'circuit_breaker_trips',
        condition: 'greater_than',
        threshold: 0,
        timeWindow: 1 * 60 * 1000,
        minDataPoints: 1,
        severity: 'high',
        channels: [
          { type: 'dashboard', config: {}, enabled: true },
          { type: 'email', config: { recipients: ['ops@example.com'] }, enabled: true }
        ],
        cooldownPeriod: 10 * 60 * 1000
      },
      {
        id: 'response-time-anomaly',
        name: 'Response Time Anomaly',
        description: 'Unusual response time detected',
        enabled: true,
        source: ['relayer', 'resolver', 'frontend'],
        metric: 'response_time',
        condition: 'anomaly',
        threshold: 2.5,
        timeWindow: 10 * 60 * 1000,
        minDataPoints: 10,
        severity: 'medium',
        channels: [
          { type: 'dashboard', config: {}, enabled: true }
        ],
        cooldownPeriod: 5 * 60 * 1000
      }
    ];
    
    for (const rule of defaultRules) {
      this.alertRules.set(rule.id, rule);
    }
  }

  /**
   * Trigger automated responses for security events
   */
  private async triggerSecurityEventResponse(event: SecurityEvent): Promise<void> {
    // Define default auto-responses for different event types
    const autoResponses: AutoResponseAction[] = [];
    
    switch (event.type) {
      case 'dos_attack':
        autoResponses.push(
          { type: 'block_ip', config: { ip: event.details.ip, duration: 60 * 60 * 1000 } }, // 1 hour
          { type: 'circuit_breaker', config: { service: 'global', reason: 'DoS attack detected' } },
          { type: 'notify_admin', config: { urgency: 'immediate' } }
        );
        break;
        
      case 'rate_limit_violation':
        if (event.severity === 'high' || event.severity === 'critical') {
          autoResponses.push(
            { type: 'increase_rate_limit', config: { rule: 'global', factor: 0.5 } }, // Reduce by 50%
            { type: 'block_ip', config: { ip: event.details.ip, duration: 30 * 60 * 1000 } } // 30 minutes
          );
        }
        break;
        
      case 'suspicious_pattern':
        autoResponses.push(
          { type: 'notify_admin', config: { urgency: 'normal' } }
        );
        break;
        
      case 'circuit_breaker_trip':
        autoResponses.push(
          { type: 'scale_up', config: { service: event.source, instances: 2 } },
          { type: 'notify_admin', config: { urgency: 'high' } }
        );
        break;
        
      case 'security_breach':
        autoResponses.push(
          { type: 'circuit_breaker', config: { service: 'global', reason: 'Security breach detected' } },
          { type: 'block_ip', config: { ip: event.details.ip, duration: 24 * 60 * 60 * 1000 } }, // 24 hours
          { type: 'notify_admin', config: { urgency: 'critical' } }
        );
        break;
    }
    
    // Execute the automated responses
    for (const action of autoResponses) {
      try {
        await this.executeAutoResponse(action, { securityEvent: event });
        
        // Record the action in the event
        event.response.automated.push(action);
        event.response.status = 'in_progress';
        
      } catch (error) {
        console.error(`Failed to execute auto-response for security event ${event.id}:`, error);
        event.response.status = 'escalated';
      }
    }
    
    this.emit('securityEventResponseTriggered', { event, responses: autoResponses });
  }

  /**
   * Notification implementations (simplified)
   */
  private async sendEmailNotification(channel: AlertChannel, alert: any): Promise<void> {
    // Email notification implementation
    console.log(`📧 Email alert: ${alert.message}`, { recipients: channel.config.recipients });
  }

  private async sendSlackNotification(channel: AlertChannel, alert: any): Promise<void> {
    // Slack notification implementation
    console.log(`💬 Slack alert: ${alert.message}`, { url: channel.config.url });
  }

  private async sendWebhookNotification(channel: AlertChannel, alert: any): Promise<void> {
    // Webhook notification implementation
    console.log(`🔗 Webhook alert: ${alert.message}`, { url: channel.config.url });
  }

  private async sendSMSNotification(channel: AlertChannel, alert: any): Promise<void> {
    // SMS notification implementation
    console.log(`📱 SMS alert: ${alert.message}`, { recipients: channel.config.recipients });
  }

  private sendDashboardNotification(alert: any): void {
    // Dashboard notification (real-time update)
    this.emit('dashboardAlert', alert);
  }

  /**
   * Auto-response implementations (simplified)
   */
  private async blockIP(ip: string, duration: number): Promise<void> {
    console.log(`🚫 Auto-blocking IP: ${ip} for ${duration}ms`);
    this.emit('ipBlocked', { ip, duration });
  }

  private async adjustRateLimit(rule: string, factor: number): Promise<void> {
    console.log(`⚡ Adjusting rate limit: ${rule} by factor ${factor}`);
    this.emit('rateLimitAdjusted', { rule, factor });
  }

  private async triggerCircuitBreaker(service: string, reason: string): Promise<void> {
    console.log(`🔌 Triggering circuit breaker: ${service} - ${reason}`);
    this.emit('circuitBreakerTriggered', { service, reason });
  }

  private async requestScaling(service: string, instances: number): Promise<void> {
    console.log(`📈 Requesting scaling: ${service} to ${instances} instances`);
    this.emit('scalingRequested', { service, instances });
  }

  private async notifyAdministrator(alert: any, urgency: string): Promise<void> {
    console.log(`👨‍💼 Notifying administrator: ${alert.message} (${urgency})`);
    this.emit('adminNotified', { alert, urgency });
  }

  /**
   * Helper methods
   */
  private generateEventId(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .substring(0, 12);
  }

  private generateAlertMessage(rule: AlertRule, metric: MetricData): string {
    return `Alert: ${rule.name} - ${metric.type} = ${metric.value} (threshold: ${rule.threshold})`;
  }

  private updatePerformanceMetrics(metric: MetricData): void {
    const key = `${metric.source}:${metric.type}`;
    
    // Update request counts
    if (metric.type.includes('request')) {
      const current = this.performanceMetrics.requestCounts.get(key) || 0;
      this.performanceMetrics.requestCounts.set(key, current + metric.value);
    }
    
    // Update response times
    if (metric.type.includes('response_time')) {
      if (!this.performanceMetrics.responseTimes.has(key)) {
        this.performanceMetrics.responseTimes.set(key, []);
      }
      this.performanceMetrics.responseTimes.get(key)!.push(metric.value);
    }
    
    // Update error counts
    if (metric.type.includes('error') || metric.type.includes('blocked')) {
      const current = this.performanceMetrics.errorCounts.get(key) || 0;
      this.performanceMetrics.errorCounts.set(key, current + metric.value);
    }
  }

  private updateBaselines(key: string, value: number): void {
    let baseline = this.baselineMetrics.get(key);
    
    if (!baseline) {
      baseline = { mean: value, stdDev: 0, samples: [value] };
    } else {
      baseline.samples.push(value);
      
      // Keep only recent samples
      if (baseline.samples.length > 1000) {
        baseline.samples = baseline.samples.slice(-500);
      }
      
      // Calculate mean and standard deviation
      const mean = baseline.samples.reduce((sum, sample) => sum + sample, 0) / baseline.samples.length;
      const variance = baseline.samples.reduce((sum, sample) => sum + Math.pow(sample - mean, 2), 0) / baseline.samples.length;
      
      baseline.mean = mean;
      baseline.stdDev = Math.sqrt(variance);
    }
    
    this.baselineMetrics.set(key, baseline);
  }

  private sumMetricValues(metrics: MetricData[], metricType: string): number {
    return metrics
      .filter(m => m.type.includes(metricType))
      .reduce((sum, m) => sum + m.value, 0);
  }

  private aggregateRateLimitsByTier(metrics: MetricData[]): Record<string, any> {
    // Aggregate rate limiting metrics by user tier
    const result: Record<string, any> = {};
    
    for (const metric of metrics) {
      if (metric.tags.tier) {
        const tier = metric.tags.tier;
        if (!result[tier]) {
          result[tier] = { requests: 0, blocked: 0, rate: 0 };
        }
        
        if (metric.type.includes('request')) {
          result[tier].requests += metric.value;
        } else if (metric.type.includes('blocked')) {
          result[tier].blocked += metric.value;
        }
      }
    }
    
    // Calculate block rates
    for (const tier in result) {
      const data = result[tier];
      data.rate = data.requests > 0 ? (data.blocked / data.requests) * 100 : 0;
    }
    
    return result;
  }

  private aggregateRateLimitsByEndpoint(metrics: MetricData[]): Record<string, any> {
    // Aggregate rate limiting metrics by endpoint
    const result: Record<string, any> = {};
    
    for (const metric of metrics) {
      if (metric.tags.endpoint) {
        const endpoint = metric.tags.endpoint;
        if (!result[endpoint]) {
          result[endpoint] = { requests: 0, blocked: 0, avgResponseTime: 0 };
        }
        
        if (metric.type.includes('request')) {
          result[endpoint].requests += metric.value;
        } else if (metric.type.includes('blocked')) {
          result[endpoint].blocked += metric.value;
        } else if (metric.type.includes('response_time')) {
          result[endpoint].avgResponseTime = metric.value;
        }
      }
    }
    
    return result;
  }

  private aggregateRateLimitsByChain(metrics: MetricData[]): Record<string, any> {
    // Aggregate cross-chain rate limiting metrics
    const result: Record<string, any> = {};
    
    for (const metric of metrics) {
      if (metric.tags.chainId) {
        const chainId = metric.tags.chainId;
        if (!result[chainId]) {
          result[chainId] = { operations: 0, blocked: 0, queueSize: 0 };
        }
        
        if (metric.type.includes('operation')) {
          result[chainId].operations += metric.value;
        } else if (metric.type.includes('blocked')) {
          result[chainId].blocked += metric.value;
        } else if (metric.type.includes('queue')) {
          result[chainId].queueSize = metric.value;
        }
      }
    }
    
    return result;
  }

  private calculateThreatLevel(events: SecurityEvent[]): 'low' | 'medium' | 'high' | 'critical' {
    if (events.length === 0) return 'low';
    
    const criticalEvents = events.filter(e => e.severity === 'critical').length;
    const highEvents = events.filter(e => e.severity === 'high').length;
    
    if (criticalEvents > 0) return 'critical';
    if (highEvents > 5) return 'high';
    if (events.length > 20) return 'medium';
    return 'low';
  }

  private calculateAverageResponseTime(): number {
    const allResponseTimes: number[] = [];
    
    for (const times of this.performanceMetrics.responseTimes.values()) {
      allResponseTimes.push(...times);
    }
    
    return allResponseTimes.length > 0 
      ? allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length 
      : 0;
  }

  private calculateThroughput(): number {
    const totalRequests = Array.from(this.performanceMetrics.requestCounts.values())
      .reduce((sum, count) => sum + count, 0);
    
    const timeDiff = (Date.now() - this.performanceMetrics.lastReset) / 1000; // seconds
    
    return timeDiff > 0 ? totalRequests / timeDiff : 0;
  }

  private calculateErrorRate(): number {
    const totalRequests = Array.from(this.performanceMetrics.requestCounts.values())
      .reduce((sum, count) => sum + count, 0);
    
    const totalErrors = Array.from(this.performanceMetrics.errorCounts.values())
      .reduce((sum, count) => sum + count, 0);
    
    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  }

  private calculateUptime(): number {
    // Simplified uptime calculation
    return 99.9; // Would be calculated from actual service availability
  }

  private calculateRiskScore(threat: ThreatIntelligence): number {
    let score = 0;
    
    // Base score from violation count
    score += Math.min(threat.activities.violationCount * 10, 50);
    
    // Pattern diversity penalty
    score += threat.activities.patterns.length * 5;
    
    // User agent diversity penalty
    score += Math.min(threat.activities.userAgents.length * 3, 20);
    
    // Recent activity bonus
    const hoursSinceLastSeen = (Date.now() - threat.lastSeen) / (1000 * 60 * 60);
    if (hoursSinceLastSeen < 1) score += 20;
    else if (hoursSinceLastSeen < 24) score += 10;
    
    return Math.min(score, 100);
  }

  private detectAttackPattern(event: SecurityEvent, recentEvents: SecurityEvent[]): string {
    // Simple attack pattern detection
    const sameIPEvents = recentEvents.filter(e => e.details.ip === event.details.ip);
    
    if (sameIPEvents.length >= 10) {
      return 'brute_force';
    } else if (sameIPEvents.length >= 5) {
      return 'rapid_fire';
    } else if (event.type === 'dos_attack') {
      return 'dos_attack';
    }
    
    return 'suspicious_activity';
  }

  private createSecurityAlert(event: SecurityEvent): void {
    if (event.severity in ['high', 'critical']) {
      const alertRule: AlertRule = {
        id: `security-${event.id}`,
        name: `Security Event: ${event.type}`,
        description: `Security event detected: ${event.type}`,
        enabled: true,
        source: [event.source],
        metric: 'security_event',
        condition: 'greater_than',
        threshold: 0,
        timeWindow: 1000,
        minDataPoints: 1,
        severity: event.severity as any,
        channels: [
          { type: 'dashboard', config: {}, enabled: true },
          { type: 'email', config: { recipients: ['security@example.com'] }, enabled: true }
        ],
        cooldownPeriod: 0
      };
      
      this.triggerAlert(alertRule, {
        timestamp: event.timestamp,
        source: event.source,
        type: 'security_event',
        value: 1,
        tags: {
          eventType: event.type,
          severity: event.severity,
          ip: event.details.ip || 'unknown'
        }
      });
    }
  }

  /**
   * Background tasks
   */
  private startBackgroundTasks(): void {
    // Clean up old data
    setInterval(() => {
      this.cleanupOldData();
    }, 60 * 60 * 1000); // Every hour
    
    // Update baselines
    setInterval(() => {
      this.updateAllBaselines();
    }, this.config.baselineUpdateInterval);
    
    // Health check
    setInterval(() => {
      this.performHealthCheck();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private cleanupOldData(): void {
    const now = Date.now();
    
    // Clean metrics
    for (const [key, metrics] of this.metrics.entries()) {
      this.metrics.set(
        key, 
        metrics.filter(m => now - m.timestamp <= this.config.metricsRetention)
      );
    }
    
    // Clean security events
    this.securityEvents = this.securityEvents.filter(
      e => now - e.timestamp <= this.config.securityEventRetention
    );
    
    // Clean threat intelligence
    for (const [ip, threat] of this.threatIntelligence.entries()) {
      if (now - threat.lastSeen > 7 * 24 * 60 * 60 * 1000) { // 7 days
        this.threatIntelligence.delete(ip);
      }
    }
    
    // Clean active alerts (resolved ones)
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.status === 'resolved' && now - alert.resolvedAt > this.config.alertRetention) {
        this.activeAlerts.delete(id);
      }
    }
  }

  private updateAllBaselines(): void {
    console.log('📊 Updating metric baselines for anomaly detection');
    // Baselines are updated continuously in updateBaselines method
  }

  private performHealthCheck(): void {
    const stats = {
      metricsCount: Array.from(this.metrics.values()).reduce((sum, arr) => sum + arr.length, 0),
      alertRulesCount: this.alertRules.size,
      activeAlertsCount: this.activeAlerts.size,
      securityEventsCount: this.securityEvents.length,
      threatIntelCount: this.threatIntelligence.size
    };
    
    this.emit('healthCheck', stats);
  }

  /**
   * Public API methods
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledgedBy = acknowledgedBy;
      alert.status = 'acknowledged';
      this.emit('alertAcknowledged', { alertId, acknowledgedBy });
    }
  }

  resolveAlert(alertId: string, resolvedBy: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolvedBy = resolvedBy;
      alert.resolvedAt = Date.now();
      alert.status = 'resolved';
      this.emit('alertResolved', { alertId, resolvedBy });
    }
  }

  getMonitoringStats(): any {
    return {
      metricsCollected: Array.from(this.metrics.values()).reduce((sum, arr) => sum + arr.length, 0),
      alertRules: this.alertRules.size,
      activeAlerts: this.activeAlerts.size,
      securityEvents: this.securityEvents.length,
      threatIntelEntries: this.threatIntelligence.size,
      uptime: Date.now() - this.performanceMetrics.lastReset
    };
  }
}

// Export singleton instance
export const rateLimitMonitor = new RateLimitMonitor();

export default rateLimitMonitor;