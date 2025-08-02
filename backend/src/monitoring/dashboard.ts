import { EventEmitter } from 'events';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { rateLimitMonitor, DashboardData, SecurityEvent, ThreatIntelligence } from './rateLimitMonitor';

/**
 * Real-time Rate Limiting Dashboard and Metrics API
 * 
 * Features:
 * - RESTful API for dashboard data and metrics
 * - Security event monitoring and reporting
 * - Threat intelligence aggregation
 * - Alert management interface
 * - Performance monitoring and SLA tracking
 * - Historical data analysis and reporting
 * - Export capabilities for compliance and auditing
 */

export interface DashboardConfig {
  port: number;
  enableAuth: boolean;
  enableSSL: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  cors: {
    origin: string[];
    methods: string[];
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
}

export interface HistoricalDataQuery {
  startTime: number;
  endTime: number;
  metrics: string[];
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count';
  interval: number; // ms
  filters?: Record<string, any>;
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string;
    borderColor?: string;
    type?: 'line' | 'bar' | 'pie' | 'doughnut';
  }[];
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
  requestId: string;
}

export class RateLimitDashboard extends EventEmitter {
  private server: any;
  private config: DashboardConfig;
  
  // Data caching for performance
  private dashboardCache: {
    data: DashboardData | null;
    timestamp: number;
    ttl: number;
  } = {
    data: null,
    timestamp: 0,
    ttl: 5000 // 5 seconds
  };
  
  // Simple rate limiting for API endpoints
  private apiRateLimit: Map<string, { count: number; resetTime: number }> = new Map();
  
  constructor(config: Partial<DashboardConfig> = {}) {
    super();
    
    this.config = {
      port: 8080,
      enableAuth: false, // Simplified for this example
      enableSSL: false,
      logLevel: 'info',
      cors: {
        origin: ['*'],
        methods: ['GET', 'POST', 'PUT', 'DELETE']
      },
      rateLimit: {
        enabled: true,
        windowMs: 60000, // 1 minute
        maxRequests: 100
      },
      ...config
    };
    
    this.initializeServer();
    this.setupPeriodicTasks();
    
    console.log(`📊 Dashboard API server initialized on port ${this.config.port}`);
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, () => {
          console.log(`🌐 Dashboard API server listening on port ${this.config.port}`);
          console.log(`📊 Available endpoints:`);
          console.log(`   GET  /api/dashboard - Get dashboard overview`);
          console.log(`   GET  /api/metrics/historical - Get historical metrics`);
          console.log(`   GET  /api/security/events - Get security events`);
          console.log(`   GET  /api/threats - Get threat intelligence`);
          console.log(`   GET  /api/alerts - Get active alerts`);
          console.log(`   POST /api/alerts/acknowledge - Acknowledge alert`);
          console.log(`   POST /api/alerts/resolve - Resolve alert`);
          console.log(`   POST /api/export - Export data for compliance`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('📊 Dashboard API server stopped');
        resolve();
      });
    });
  }

  /**
   * Get current dashboard data with caching
   */
  getDashboardData(): DashboardData {
    const now = Date.now();
    
    if (this.dashboardCache.data && (now - this.dashboardCache.timestamp) < this.dashboardCache.ttl) {
      return this.dashboardCache.data;
    }
    
    const data = rateLimitMonitor.getDashboardData();
    this.dashboardCache = {
      data,
      timestamp: now,
      ttl: this.dashboardCache.ttl
    };
    
    return data;
  }

  /**
   * Get historical data for charts
   */
  getHistoricalData(query: HistoricalDataQuery): ChartData {
    const { startTime, endTime, metrics, aggregation, interval } = query;
    const data = rateLimitMonitor.getMetricsInTimeRange(startTime, endTime);
    
    // Group data by time intervals
    const timeSlots = this.createTimeSlots(startTime, endTime, interval);
    const labels = timeSlots.map(slot => new Date(slot).toISOString());
    
    const datasets = metrics.map((metricType, index) => {
      const metricData = data.filter(d => d.type === metricType);
      const aggregatedData = this.aggregateDataByTimeSlots(metricData, timeSlots, aggregation);
      
      return {
        label: metricType,
        data: aggregatedData,
        backgroundColor: this.getChartColor(index, 0.2),
        borderColor: this.getChartColor(index, 1),
        type: 'line' as const
      };
    });
    
    return { labels, datasets };
  }

  /**
   * Get security events with filtering
   */
  getSecurityEvents(filters: { severity?: string; timeRange?: number; limit?: number } = {}): SecurityEvent[] {
    const { severity, timeRange = 24 * 60 * 60 * 1000, limit = 100 } = filters;
    
    let events = rateLimitMonitor.getSecurityEvents(severity, limit);
    
    if (timeRange) {
      const cutoff = Date.now() - timeRange;
      events = events.filter(e => e.timestamp >= cutoff);
    }
    
    return events;
  }

  /**
   * Get threat intelligence data
   */
  getThreatIntelligence(filters: { riskThreshold?: number; limit?: number } = {}): ThreatIntelligence[] {
    const { riskThreshold = 0, limit = 50 } = filters;
    
    return rateLimitMonitor.getThreatIntelligence()
      .filter(threat => threat.riskScore >= riskThreshold)
      .slice(0, limit);
  }

  /**
   * Execute administrative command
   */
  async executeCommand(command: string, params: any): Promise<any> {
    switch (command) {
      case 'acknowledge_alert':
        const { alertId, acknowledgedBy } = params;
        rateLimitMonitor.acknowledgeAlert(alertId, acknowledgedBy);
        return { success: true, message: `Alert ${alertId} acknowledged` };
        
      case 'resolve_alert':
        const { alertId: resolveAlertId, resolvedBy } = params;
        rateLimitMonitor.resolveAlert(resolveAlertId, resolvedBy);
        return { success: true, message: `Alert ${resolveAlertId} resolved` };
        
      case 'export_data':
        const { format, timeRange } = params;
        const exportData = await this.exportData(format, timeRange);
        return { success: true, data: exportData };
        
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * Export data for compliance and auditing
   */
  async exportData(format: 'json' | 'csv', timeRange: number): Promise<string> {
    const endTime = Date.now();
    const startTime = endTime - timeRange;
    
    const data = {
      metadata: {
        exportTime: new Date().toISOString(),
        timeRange: { startTime, endTime },
        format
      },
      dashboard: this.getDashboardData(),
      metrics: rateLimitMonitor.getMetricsInTimeRange(startTime, endTime),
      securityEvents: this.getSecurityEvents({ timeRange }),
      threats: this.getThreatIntelligence(),
      alerts: rateLimitMonitor.getActiveAlerts()
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        return this.convertToCSV(data);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Initialize HTTP server
   */
  private initializeServer(): void {
    this.server = createServer((req, res) => {
      this.handleHTTPRequest(req, res);
    });
  }

  /**
   * Handle HTTP requests (REST API)
   */
  private handleHTTPRequest(req: IncomingMessage, res: ServerResponse): void {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', this.config.cors.origin.join(','));
    res.setHeader('Access-Control-Allow-Methods', this.config.cors.methods.join(','));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Request-ID', requestId);
    
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    
    try {
      // Apply rate limiting
      if (!this.checkRateLimit(this.getClientIP(req))) {
        this.sendResponse(res, 429, { success: false, error: 'Too Many Requests' }, requestId);
        return;
      }
      
      // Handle preflight requests
      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // Route handling
      if (path === '/api/dashboard' && method === 'GET') {
        const data = this.getDashboardData();
        this.sendResponse(res, 200, { success: true, data }, requestId);
        
      } else if (path === '/api/metrics/historical' && method === 'GET') {
        const query = this.parseQueryParams(url.searchParams);
        const data = this.getHistoricalData(query as HistoricalDataQuery);
        this.sendResponse(res, 200, { success: true, data }, requestId);
        
      } else if (path === '/api/security/events' && method === 'GET') {
        const filters = this.parseQueryParams(url.searchParams);
        const events = this.getSecurityEvents(filters);
        this.sendResponse(res, 200, { success: true, data: events }, requestId);
        
      } else if (path === '/api/threats' && method === 'GET') {
        const filters = this.parseQueryParams(url.searchParams);
        const threats = this.getThreatIntelligence(filters);
        this.sendResponse(res, 200, { success: true, data: threats }, requestId);
        
      } else if (path === '/api/alerts' && method === 'GET') {
        const alerts = rateLimitMonitor.getActiveAlerts();
        this.sendResponse(res, 200, { success: true, data: alerts }, requestId);
        
      } else if (path === '/api/alerts/acknowledge' && method === 'POST') {
        this.handlePostRequest(req, res, requestId, async (body) => {
          const result = await this.executeCommand('acknowledge_alert', body);
          this.sendResponse(res, 200, result, requestId);
        });
        
      } else if (path === '/api/alerts/resolve' && method === 'POST') {
        this.handlePostRequest(req, res, requestId, async (body) => {
          const result = await this.executeCommand('resolve_alert', body);
          this.sendResponse(res, 200, result, requestId);
        });
        
      } else if (path === '/api/export' && method === 'POST') {
        this.handlePostRequest(req, res, requestId, async (body) => {
          const result = await this.executeCommand('export_data', body);
          
          // Set appropriate headers for file download
          const { format } = body;
          res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="rate-limit-report.${format}"`);
          
          res.writeHead(200);
          res.end(result.data);
        });
        
      } else if (path === '/api/stats' && method === 'GET') {
        const stats = rateLimitMonitor.getMonitoringStats();
        this.sendResponse(res, 200, { success: true, data: stats }, requestId);
        
      } else if (path === '/health' && method === 'GET') {
        const health = {
          status: 'healthy',
          timestamp: Date.now(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          monitoring: rateLimitMonitor.getMonitoringStats()
        };
        this.sendResponse(res, 200, { success: true, data: health }, requestId);
        
      } else {
        this.sendResponse(res, 404, { success: false, error: 'Not Found' }, requestId);
      }
      
    } catch (error) {
      console.error('HTTP request error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      this.sendResponse(res, 500, { success: false, error: errorMessage }, requestId);
    }
    
    // Log request
    const duration = Date.now() - startTime;
    console.log(`${method} ${path} - ${res.statusCode} (${duration}ms) [${requestId}]`);
  }

  /**
   * Handle POST requests with body parsing
   */
  private handlePostRequest(
    req: IncomingMessage, 
    res: ServerResponse, 
    requestId: string,
    handler: (body: any) => Promise<void>
  ): void {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk;
      
      // Prevent overly large payloads
      if (body.length > 1024 * 1024) { // 1MB limit
        res.writeHead(413);
        res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
        return;
      }
    });
    
    req.on('end', async () => {
      try {
        const parsedBody = JSON.parse(body);
        await handler(parsedBody);
      } catch (error) {
        console.error('POST request error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Bad Request';
        this.sendResponse(res, 400, { success: false, error: errorMessage }, requestId);
      }
    });
  }

  /**
   * Send standardized API response
   */
  private sendResponse(res: ServerResponse, statusCode: number, data: any, requestId: string): void {
    const response: APIResponse = {
      ...data,
      timestamp: Date.now(),
      requestId
    };
    
    res.writeHead(statusCode);
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Simple rate limiting check
   */
  private checkRateLimit(clientIP: string): boolean {
    if (!this.config.rateLimit.enabled) {
      return true;
    }
    
    const now = Date.now();
    const key = `rate_limit:${clientIP}`;
    const limit = this.apiRateLimit.get(key);
    
    if (!limit || now > limit.resetTime) {
      this.apiRateLimit.set(key, {
        count: 1,
        resetTime: now + this.config.rateLimit.windowMs
      });
      return true;
    }
    
    if (limit.count >= this.config.rateLimit.maxRequests) {
      return false;
    }
    
    limit.count++;
    return true;
  }

  /**
   * Get client IP address
   */
  private getClientIP(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Setup periodic maintenance tasks
   */
  private setupPeriodicTasks(): void {
    // Clean rate limit cache
    setInterval(() => {
      const now = Date.now();
      for (const [key, limit] of this.apiRateLimit.entries()) {
        if (now > limit.resetTime) {
          this.apiRateLimit.delete(key);
        }
      }
    }, 60000); // Every minute
    
    // Clear dashboard cache periodically
    setInterval(() => {
      this.dashboardCache.data = null;
    }, this.dashboardCache.ttl);
  }

  /**
   * Helper methods
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private parseQueryParams(params: URLSearchParams): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of params.entries()) {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    }
    return result;
  }
  
  private createTimeSlots(startTime: number, endTime: number, interval: number): number[] {
    const slots: number[] = [];
    for (let time = startTime; time < endTime; time += interval) {
      slots.push(time);
    }
    return slots;
  }
  
  private aggregateDataByTimeSlots(data: any[], timeSlots: number[], aggregation: string): number[] {
    return timeSlots.map((slot, index) => {
      const nextSlot = timeSlots[index + 1] || slot + 60000; // Default 1 minute
      const slotData = data.filter(d => 
        d.timestamp >= slot && d.timestamp < nextSlot
      );
      
      if (slotData.length === 0) return 0;
      
      switch (aggregation) {
        case 'sum':
          return slotData.reduce((sum, d) => sum + d.value, 0);
        case 'avg':
          return slotData.reduce((sum, d) => sum + d.value, 0) / slotData.length;
        case 'min':
          return Math.min(...slotData.map(d => d.value));
        case 'max':
          return Math.max(...slotData.map(d => d.value));
        case 'count':
          return slotData.length;
        default:
          return slotData[slotData.length - 1]?.value || 0;
      }
    });
  }
  
  private getChartColor(index: number, alpha: number): string {
    const colors = [
      `rgba(54, 162, 235, ${alpha})`,   // Blue
      `rgba(255, 99, 132, ${alpha})`,   // Red
      `rgba(75, 192, 192, ${alpha})`,   // Green
      `rgba(255, 205, 86, ${alpha})`,   // Yellow
      `rgba(153, 102, 255, ${alpha})`,  // Purple
      `rgba(255, 159, 64, ${alpha})`    // Orange
    ];
    return colors[index % colors.length];
  }
  
  private convertToCSV(data: any): string {
    const lines: string[] = [];
    
    // Add metadata
    lines.push('# Rate Limiting Dashboard Export');
    lines.push(`# Export Time: ${data.metadata.exportTime}`);
    lines.push(`# Time Range: ${new Date(data.metadata.timeRange.startTime)} - ${new Date(data.metadata.timeRange.endTime)}`);
    lines.push('');
    
    // Add dashboard overview
    lines.push('# Dashboard Overview');
    lines.push('Metric,Value');
    lines.push(`Total Requests,${data.dashboard.overview.totalRequests}`);
    lines.push(`Blocked Requests,${data.dashboard.overview.blockedRequests}`);
    lines.push(`Block Rate,${data.dashboard.overview.blockRate}%`);
    lines.push(`Active Alerts,${data.dashboard.overview.activeAlerts}`);
    lines.push(`System Health,${data.dashboard.overview.systemHealth}`);
    lines.push('');
    
    // Add metrics
    lines.push('# Metrics History');
    lines.push('Timestamp,Source,Type,Value,Tags');
    for (const metric of data.metrics) {
      const tags = Object.entries(metric.tags || {}).map(([k, v]) => `${k}=${v}`).join(';');
      lines.push(`${new Date(metric.timestamp).toISOString()},${metric.source},${metric.type},${metric.value},"${tags}"`);
    }
    
    // Add security events
    lines.push('');
    lines.push('# Security Events');
    lines.push('Timestamp,Type,Severity,Source,IP,Details');
    for (const event of data.securityEvents) {
      const details = JSON.stringify(event.details).replace(/"/g, '""');
      lines.push(`${new Date(event.timestamp).toISOString()},${event.type},${event.severity},${event.source},${event.details.ip || 'unknown'},"${details}"`);
    }
    
    return lines.join('\n');
  }
}

// Export singleton instance
export const dashboard = new RateLimitDashboard();

export default dashboard;