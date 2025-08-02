import { EventEmitter } from 'events';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { configManager } from '../config/configManager';
import { monitoringSystem } from '../monitoring/index';

/**
 * Administrative Interface for Rate Limiting System
 * 
 * Provides a web-based administrative interface for:
 * - Managing rate limiting policies and user tiers
 * - Whitelist/blacklist management
 * - System configuration and monitoring
 * - User management and tier assignments
 * - Real-time system status and alerts
 * - Configuration backup and restore
 * - Audit log viewing and analysis
 */

export interface AdminConfig {
  port: number;
  enableAuth: boolean;
  sessionTimeout: number; // ms
  maxSessions: number;
  rateLimiting: {
    enabled: boolean;
    maxRequests: number;
    windowMs: number;
  };
}

export interface AdminSession {
  id: string;
  userId: string;
  username: string;
  role: 'admin' | 'moderator' | 'viewer';
  permissions: string[];
  loginTime: number;
  lastActivity: number;
  ipAddress: string;
  userAgent: string;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'moderator' | 'viewer';
  permissions: string[];
  enabled: boolean;
  passwordHash: string;
  lastLogin?: number;
  loginAttempts: number;
  lockedUntil?: number;
  createdAt: number;
  createdBy: string;
}

export class AdminInterface extends EventEmitter {
  private server: any;
  private config: AdminConfig;
  private sessions: Map<string, AdminSession> = new Map();
  private users: Map<string, AdminUser> = new Map();
  private sessionCleanupInterval?: NodeJS.Timeout;
  private rateLimitCache: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(config: Partial<AdminConfig> = {}) {
    super();
    
    this.config = {
      port: parseInt(process.env.ADMIN_PORT || '8081'),
      enableAuth: process.env.ADMIN_AUTH_ENABLED !== 'false',
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      maxSessions: 100,
      rateLimiting: {
        enabled: true,
        maxRequests: 100,
        windowMs: 60 * 1000 // 1 minute
      },
      ...config
    };
    
    this.initializeAdminUsers();
    this.initializeServer();
    this.setupSessionCleanup();
    
    console.log('👨‍💼 Admin Interface initialized');
  }

  /**
   * Start the admin interface server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, () => {
          console.log(`🌐 Admin Interface running on http://localhost:${this.config.port}`);
          console.log('🔧 Available admin endpoints:');
          console.log('   GET  /admin - Admin dashboard');
          console.log('   GET  /admin/api/policies - Rate limiting policies');
          console.log('   POST /admin/api/policies - Create/update policy');
          console.log('   GET  /admin/api/tiers - User tiers');
          console.log('   GET  /admin/api/whitelist - Whitelist management');
          console.log('   GET  /admin/api/blacklist - Blacklist management');
          console.log('   GET  /admin/api/config - System configuration');
          console.log('   GET  /admin/api/audit - Audit log');
          console.log('   GET  /admin/api/status - System status');
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the admin interface server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.sessionCleanupInterval) {
        clearInterval(this.sessionCleanupInterval);
      }
      
      this.server.close(() => {
        console.log('👨‍💼 Admin Interface stopped');
        resolve();
      });
    });
  }

  /**
   * Initialize HTTP server
   */
  private initializeServer(): void {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();
    const clientIP = this.getClientIP(req);
    
    const parsedUrl = parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    const method = req.method || 'GET';
    
    try {
      // Apply rate limiting
      if (!this.checkRateLimit(clientIP)) {
        this.sendResponse(res, 429, { error: 'Too Many Requests' });
        return;
      }
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Session');
      
      // Handle preflight requests
      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // Authentication check for protected routes
      if (pathname.startsWith('/admin/api/')) {
        const session = await this.validateSession(req);
        if (!session) {
          this.sendResponse(res, 401, { error: 'Authentication required' });
          return;
        }
        
        // Update last activity
        session.lastActivity = Date.now();
      }
      
      // Route handling
      if (pathname === '/admin' && method === 'GET') {
        await this.serveDashboard(req, res);
        
      } else if (pathname === '/admin/api/login' && method === 'POST') {
        await this.handleLogin(req, res);
        
      } else if (pathname === '/admin/api/logout' && method === 'POST') {
        await this.handleLogout(req, res);
        
      } else if (pathname === '/admin/api/policies' && method === 'GET') {
        await this.handleGetPolicies(req, res);
        
      } else if (pathname === '/admin/api/policies' && method === 'POST') {
        await this.handleCreatePolicy(req, res);
        
      } else if (pathname === '/admin/api/tiers' && method === 'GET') {
        await this.handleGetTiers(req, res);
        
      } else if (pathname === '/admin/api/whitelist' && method === 'GET') {
        await this.handleGetWhitelist(req, res);
        
      } else if (pathname === '/admin/api/whitelist' && method === 'POST') {
        await this.handleAddWhitelist(req, res);
        
      } else if (pathname === '/admin/api/blacklist' && method === 'GET') {
        await this.handleGetBlacklist(req, res);
        
      } else if (pathname === '/admin/api/blacklist' && method === 'POST') {
        await this.handleAddBlacklist(req, res);
        
      } else if (pathname === '/admin/api/config' && method === 'GET') {
        await this.handleGetConfig(req, res);
        
      } else if (pathname === '/admin/api/config' && method === 'PUT') {
        await this.handleUpdateConfig(req, res);
        
      } else if (pathname === '/admin/api/status' && method === 'GET') {
        await this.handleGetStatus(req, res);
        
      } else if (pathname === '/admin/api/audit' && method === 'GET') {
        await this.handleGetAuditLog(req, res);
        
      } else if (pathname === '/admin/api/backup' && method === 'POST') {
        await this.handleCreateBackup(req, res);
        
      } else if (pathname === '/admin/api/restore' && method === 'POST') {
        await this.handleRestoreBackup(req, res);
        
      } else {
        this.sendResponse(res, 404, { error: 'Not Found' });
      }
      
    } catch (error) {
      console.error('Admin interface error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      this.sendResponse(res, 500, { error: errorMessage });
    }
    
    // Log request
    const duration = Date.now() - startTime;
    console.log(`ADMIN ${method} ${pathname} - ${res.statusCode} (${duration}ms) [${clientIP}]`);
  }

  /**
   * Serve admin dashboard HTML
   */
  private async serveDashboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const dashboardHTML = this.generateDashboardHTML();
    
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(dashboardHTML);
  }

  /**
   * Handle user login
   */
  private async handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseRequestBody(req);
    const { username, password } = body;
    
    if (!username || !password) {
      this.sendResponse(res, 400, { error: 'Username and password required' });
      return;
    }
    
    const user = this.authenticateUser(username, password);
    if (!user) {
      this.sendResponse(res, 401, { error: 'Invalid credentials' });
      return;
    }
    
    // Create session
    const session = this.createSession(user, this.getClientIP(req), req.headers['user-agent'] || '');
    
    this.sendResponse(res, 200, {
      success: true,
      session: {
        id: session.id,
        username: session.username,
        role: session.role,
        permissions: session.permissions
      }
    });
  }

  /**
   * Handle user logout
   */
  private async handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (session) {
      this.sessions.delete(session.id);
    }
    
    this.sendResponse(res, 200, { success: true, message: 'Logged out successfully' });
  }

  /**
   * Handle get policies
   */
  private async handleGetPolicies(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const policies = configManager.getAllPolicies();
    this.sendResponse(res, 200, { success: true, data: policies });
  }

  /**
   * Handle create/update policy
   */
  private async handleCreatePolicy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session) {
      this.sendResponse(res, 401, { error: 'Authentication required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    
    try {
      const policy = await configManager.setPolicy(body, session.userId);
      this.sendResponse(res, 200, { success: true, data: policy });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save policy';
      this.sendResponse(res, 400, { error: errorMessage });
    }
  }

  /**
   * Handle get tiers
   */
  private async handleGetTiers(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const tiers = configManager.getAllTiers();
    this.sendResponse(res, 200, { success: true, data: tiers });
  }

  /**
   * Handle get whitelist
   */
  private async handleGetWhitelist(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Get whitelist entries (simplified - would implement pagination in production)
    const whitelist = Array.from((configManager as any).whitelist.values());
    this.sendResponse(res, 200, { success: true, data: whitelist });
  }

  /**
   * Handle add whitelist entry
   */
  private async handleAddWhitelist(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session) {
      this.sendResponse(res, 401, { error: 'Authentication required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    
    try {
      const entry = await configManager.addToWhitelist({
        type: body.type,
        value: body.value,
        reason: body.reason,
        enabled: body.enabled !== false,
        expiresAt: body.expiresAt,
        createdBy: session.userId
      }, session.userId);
      
      this.sendResponse(res, 200, { success: true, data: entry });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add whitelist entry';
      this.sendResponse(res, 400, { error: errorMessage });
    }
  }

  /**
   * Handle get blacklist
   */
  private async handleGetBlacklist(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Get blacklist entries (simplified)
    const blacklist = Array.from((configManager as any).blacklist.values());
    this.sendResponse(res, 200, { success: true, data: blacklist });
  }

  /**
   * Handle add blacklist entry
   */
  private async handleAddBlacklist(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session) {
      this.sendResponse(res, 401, { error: 'Authentication required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    
    try {
      const entry = await configManager.addToBlacklist({
        type: body.type,
        value: body.value,
        reason: body.reason,
        severity: body.severity || 'medium',
        enabled: body.enabled !== false,
        expiresAt: body.expiresAt,
        createdBy: session.userId
      }, session.userId);
      
      this.sendResponse(res, 200, { success: true, data: entry });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add blacklist entry';
      this.sendResponse(res, 400, { error: errorMessage });
    }
  }

  /**
   * Handle get system configuration
   */
  private async handleGetConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const status = configManager.getStatus();
    this.sendResponse(res, 200, { success: true, data: status });
  }

  /**
   * Handle update system configuration
   */
  private async handleUpdateConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session) {
      this.sendResponse(res, 401, { error: 'Authentication required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    
    try {
      const config = await configManager.updateSystemConfig(body, session.userId, body.reason);
      this.sendResponse(res, 200, { success: true, data: config });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update configuration';
      this.sendResponse(res, 400, { error: errorMessage });
    }
  }

  /**
   * Handle get system status
   */
  private async handleGetStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const configStatus = configManager.getStatus();
    const monitoringStatus = monitoringSystem.getStatus();
    
    const status = {
      timestamp: Date.now(),
      config: configStatus,
      monitoring: monitoringStatus,
      admin: {
        activeSessions: this.sessions.size,
        totalUsers: this.users.size,
        uptime: process.uptime()
      }
    };
    
    this.sendResponse(res, 200, { success: true, data: status });
  }

  /**
   * Handle get audit log
   */
  private async handleGetAuditLog(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = parse(req.url || '', true);
    const limit = parseInt(parsedUrl.query.limit as string) || 100;
    
    const auditLog = configManager.getAuditLog(limit);
    this.sendResponse(res, 200, { success: true, data: auditLog });
  }

  /**
   * Handle create backup
   */
  private async handleCreateBackup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session) {
      this.sendResponse(res, 401, { error: 'Authentication required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    const description = body.description || 'Manual backup';
    
    try {
      const backup = await configManager.createBackup(description, session.userId);
      this.sendResponse(res, 200, { success: true, data: backup });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create backup';
      this.sendResponse(res, 500, { error: errorMessage });
    }
  }

  /**
   * Handle restore backup
   */
  private async handleRestoreBackup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = await this.validateSession(req);
    if (!session || session.role !== 'admin') {
      this.sendResponse(res, 403, { error: 'Admin privileges required' });
      return;
    }
    
    const body = await this.parseRequestBody(req);
    const { backupId } = body;
    
    try {
      await configManager.restoreBackup(backupId, session.userId);
      this.sendResponse(res, 200, { success: true, message: 'Configuration restored successfully' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to restore backup';
      this.sendResponse(res, 500, { error: errorMessage });
    }
  }

  /**
   * Validate session from request
   */
  private async validateSession(req: IncomingMessage): Promise<AdminSession | null> {
    const sessionId = req.headers['x-admin-session'] as string || 
                     req.headers['authorization']?.replace('Bearer ', '');
    
    if (!sessionId) {
      return null;
    }
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    
    // Check if session is expired
    if (Date.now() - session.lastActivity > this.config.sessionTimeout) {
      this.sessions.delete(sessionId);
      return null;
    }
    
    return session;
  }

  /**
   * Create a new admin session
   */
  private createSession(user: AdminUser, ipAddress: string, userAgent: string): AdminSession {
    const sessionId = this.generateSessionId();
    
    const session: AdminSession = {
      id: sessionId,
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      loginTime: Date.now(),
      lastActivity: Date.now(),
      ipAddress,
      userAgent
    };
    
    // Remove oldest session if we hit the limit
    if (this.sessions.size >= this.config.maxSessions) {
      const oldestSession = Array.from(this.sessions.values())
        .sort((a, b) => a.lastActivity - b.lastActivity)[0];
      this.sessions.delete(oldestSession.id);
    }
    
    this.sessions.set(sessionId, session);
    
    // Update user last login
    user.lastLogin = Date.now();
    user.loginAttempts = 0;
    
    this.emit('userLogin', { user: user.username, session: sessionId, ip: ipAddress });
    
    return session;
  }

  /**
   * Authenticate user credentials
   */
  private authenticateUser(username: string, password: string): AdminUser | null {
    const user = Array.from(this.users.values()).find(u => u.username === username);
    
    if (!user || !user.enabled) {
      return null;
    }
    
    // Check if user is locked
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      return null;
    }
    
    // Simplified password check (in production, use proper hashing)
    const expectedHash = this.hashPassword(password);
    if (user.passwordHash !== expectedHash) {
      user.loginAttempts++;
      
      // Lock user after 5 failed attempts
      if (user.loginAttempts >= 5) {
        user.lockedUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
      }
      
      return null;
    }
    
    return user;
  }

  /**
   * Initialize default admin users
   */
  private initializeAdminUsers(): void {
    // Create default admin user
    const defaultAdmin: AdminUser = {
      id: 'admin-001',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      permissions: ['*'], // All permissions
      enabled: true,
      passwordHash: this.hashPassword('admin123'), // Change in production!
      loginAttempts: 0,
      createdAt: Date.now(),
      createdBy: 'system'
    };
    
    this.users.set(defaultAdmin.id, defaultAdmin);
    
    console.log('👨‍💼 Default admin user created (username: admin, password: admin123)');
    console.log('⚠️  IMPORTANT: Change default admin password in production!');
  }

  /**
   * Generate dashboard HTML
   */
  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rate Limiting Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: #f5f6fa; 
            color: #333; 
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 30px; 
            border-radius: 12px; 
            margin-bottom: 30px; 
            text-align: center;
        }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .header p { font-size: 1.1em; opacity: 0.9; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { 
            background: white; 
            border-radius: 12px; 
            padding: 25px; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.1); 
            border-left: 4px solid #667eea;
        }
        .card h3 { margin-bottom: 15px; color: #333; font-size: 1.3em; }
        .metric { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .metric-value { font-weight: bold; color: #667eea; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.9em; }
        .status.healthy { background: #d4edda; color: #155724; }
        .status.degraded { background: #fff3cd; color: #856404; }
        .status.critical { background: #f8d7da; color: #721c24; }
        .btn { 
            background: #667eea; 
            color: white; 
            border: none; 
            padding: 10px 20px; 
            border-radius: 6px; 
            cursor: pointer; 
            margin: 5px;
            text-decoration: none;
            display: inline-block;
        }
        .btn:hover { background: #5a67d8; }
        .btn.danger { background: #e53e3e; }
        .btn.danger:hover { background: #c53030; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 500; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; 
            padding: 8px 12px; 
            border: 1px solid #ddd; 
            border-radius: 4px; 
            font-size: 14px;
        }
        .alert { 
            padding: 15px; 
            margin: 15px 0; 
            border-radius: 6px; 
            border: 1px solid transparent;
        }
        .alert.success { background: #d4edda; color: #155724; border-color: #c3e6cb; }
        .alert.error { background: #f8d7da; color: #721c24; border-color: #f5c6cb; }
        .tabs { 
            display: flex; 
            margin-bottom: 20px; 
            border-bottom: 2px solid #eee;
        }
        .tab { 
            padding: 12px 24px; 
            cursor: pointer; 
            border-bottom: 2px solid transparent;
            transition: all 0.3s;
        }
        .tab.active { 
            border-bottom-color: #667eea; 
            color: #667eea; 
            font-weight: bold;
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ Rate Limiting Admin Dashboard</h1>
            <p>Comprehensive management interface for rate limiting and DOS protection</p>
        </div>

        <div class="tabs">
            <div class="tab active" onclick="showTab('overview')">Overview</div>
            <div class="tab" onclick="showTab('policies')">Policies</div>
            <div class="tab" onclick="showTab('tiers')">Tiers</div>
            <div class="tab" onclick="showTab('whitelist')">Whitelist</div>
            <div class="tab" onclick="showTab('blacklist')">Blacklist</div>
            <div class="tab" onclick="showTab('config')">Configuration</div>
            <div class="tab" onclick="showTab('audit')">Audit Log</div>
        </div>

        <!-- Overview Tab -->
        <div id="overview" class="tab-content active">
            <div class="grid">
                <div class="card">
                    <h3>📊 System Status</h3>
                    <div id="system-status" class="loading">Loading...</div>
                </div>
                <div class="card">
                    <h3>⚠️ Active Alerts</h3>
                    <div id="active-alerts" class="loading">Loading...</div>
                </div>
                <div class="card">
                    <h3>📈 Performance Metrics</h3>
                    <div id="performance-metrics" class="loading">Loading...</div>
                </div>
                <div class="card">
                    <h3>🔐 Security Status</h3>
                    <div id="security-status" class="loading">Loading...</div>
                </div>
            </div>
        </div>

        <!-- Policies Tab -->
        <div id="policies" class="tab-content">
            <div class="card">
                <h3>📋 Rate Limiting Policies</h3>
                <button class="btn" onclick="createPolicy()">Create New Policy</button>
                <div id="policies-list" class="loading">Loading...</div>
            </div>
        </div>

        <!-- Tiers Tab -->
        <div id="tiers" class="tab-content">
            <div class="card">
                <h3>🏆 User Tiers</h3>
                <div id="tiers-list" class="loading">Loading...</div>
            </div>
        </div>

        <!-- Whitelist Tab -->
        <div id="whitelist" class="tab-content">
            <div class="card">
                <h3>✅ Whitelist Management</h3>
                <button class="btn" onclick="addWhitelistEntry()">Add Entry</button>
                <div id="whitelist-list" class="loading">Loading...</div>
            </div>
        </div>

        <!-- Blacklist Tab -->
        <div id="blacklist" class="tab-content">
            <div class="card">
                <h3>🚫 Blacklist Management</h3>
                <button class="btn" onclick="addBlacklistEntry()">Add Entry</button>
                <div id="blacklist-list" class="loading">Loading...</div>
            </div>
        </div>

        <!-- Configuration Tab -->
        <div id="config" class="tab-content">
            <div class="card">
                <h3>⚙️ System Configuration</h3>
                <div id="config-form" class="loading">Loading...</div>
            </div>
        </div>

        <!-- Audit Log Tab -->
        <div id="audit" class="tab-content">
            <div class="card">
                <h3>📋 Audit Log</h3>
                <div id="audit-log" class="loading">Loading...</div>
            </div>
        </div>
    </div>

    <script>
        // Tab switching functionality
        function showTab(tabName) {
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected tab content
            document.getElementById(tabName).classList.add('active');
            
            // Add active class to clicked tab
            event.target.classList.add('active');
            
            // Load tab data
            loadTabData(tabName);
        }

        // Load data for specific tab
        async function loadTabData(tabName) {
            try {
                switch(tabName) {
                    case 'overview':
                        await loadOverview();
                        break;
                    case 'policies':
                        await loadPolicies();
                        break;
                    case 'tiers':
                        await loadTiers();
                        break;
                    case 'whitelist':
                        await loadWhitelist();
                        break;
                    case 'blacklist':
                        await loadBlacklist();
                        break;
                    case 'config':
                        await loadConfig();
                        break;
                    case 'audit':
                        await loadAuditLog();
                        break;
                }
            } catch (error) {
                console.error('Error loading tab data:', error);
            }
        }

        // Load overview data
        async function loadOverview() {
            const response = await fetch('/admin/api/status');
            const data = await response.json();
            
            if (data.success) {
                updateSystemStatus(data.data);
            }
        }

        // Update system status display
        function updateSystemStatus(status) {
            const systemStatusDiv = document.getElementById('system-status');
            const healthClass = status.monitoring.health === 'healthy' ? 'healthy' : 
                               status.monitoring.health === 'degraded' ? 'degraded' : 'critical';
            
            systemStatusDiv.innerHTML = \`
                <div class="metric">
                    <span>Overall Health:</span>
                    <span class="status \${healthClass}">\${status.monitoring.health.toUpperCase()}</span>
                </div>
                <div class="metric">
                    <span>Active Policies:</span>
                    <span class="metric-value">\${status.config.stats.policies}</span>
                </div>
                <div class="metric">
                    <span>User Tiers:</span>
                    <span class="metric-value">\${status.config.stats.tiers}</span>
                </div>
                <div class="metric">
                    <span>Active Sessions:</span>
                    <span class="metric-value">\${status.admin.activeSessions}</span>
                </div>
            \`;
        }

        // Load other data functions (simplified for this example)
        async function loadPolicies() {
            const response = await fetch('/admin/api/policies');
            const data = await response.json();
            
            if (data.success) {
                displayPolicies(data.data);
            }
        }

        function displayPolicies(policies) {
            const listDiv = document.getElementById('policies-list');
            if (policies.length === 0) {
                listDiv.innerHTML = '<p>No policies configured</p>';
                return;
            }

            const policiesHTML = policies.map(policy => \`
                <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 6px;">
                    <h4>\${policy.name} (\${policy.tier})</h4>
                    <p>\${policy.description}</p>
                    <div class="metric">
                        <span>Requests per minute:</span>
                        <span class="metric-value">\${policy.limits.requests.perMinute}</span>
                    </div>
                    <div class="metric">
                        <span>Status:</span>
                        <span class="status \${policy.enabled ? 'healthy' : 'critical'}">\${policy.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                </div>
            \`).join('');

            listDiv.innerHTML = policiesHTML;
        }

        // Simplified implementations for other functions
        async function loadTiers() {
            document.getElementById('tiers-list').innerHTML = '<p>User tiers management coming soon...</p>';
        }

        async function loadWhitelist() {
            document.getElementById('whitelist-list').innerHTML = '<p>Whitelist management coming soon...</p>';
        }

        async function loadBlacklist() {
            document.getElementById('blacklist-list').innerHTML = '<p>Blacklist management coming soon...</p>';
        }

        async function loadConfig() {
            document.getElementById('config-form').innerHTML = '<p>Configuration management coming soon...</p>';
        }

        async function loadAuditLog() {
            document.getElementById('audit-log').innerHTML = '<p>Audit log coming soon...</p>';
        }

        // Placeholder functions for buttons
        function createPolicy() {
            alert('Create policy functionality would open a form here');
        }

        function addWhitelistEntry() {
            alert('Add whitelist entry functionality would open a form here');
        }

        function addBlacklistEntry() {
            alert('Add blacklist entry functionality would open a form here');
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            loadTabData('overview');
            
            // Auto-refresh overview every 30 seconds
            setInterval(() => {
                if (document.getElementById('overview').classList.contains('active')) {
                    loadTabData('overview');
                }
            }, 30000);
        });
    </script>
</body>
</html>`;
  }

  /**
   * Helper methods
   */
  private getClientIP(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private checkRateLimit(clientIP: string): boolean {
    if (!this.config.rateLimiting.enabled) {
      return true;
    }
    
    const now = Date.now();
    const key = `admin_rate_limit:${clientIP}`;
    const limit = this.rateLimitCache.get(key);
    
    if (!limit || now > limit.resetTime) {
      this.rateLimitCache.set(key, {
        count: 1,
        resetTime: now + this.config.rateLimiting.windowMs
      });
      return true;
    }
    
    if (limit.count >= this.config.rateLimiting.maxRequests) {
      return false;
    }
    
    limit.count++;
    return true;
  }

  private async parseRequestBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk;
        
        // Prevent overly large payloads
        if (body.length > 1024 * 1024) { // 1MB limit
          reject(new Error('Payload too large'));
          return;
        }
      });
      
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON'));
        }
      });
    });
  }

  private sendResponse(res: ServerResponse, statusCode: number, data: any): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(statusCode);
    res.end(JSON.stringify({
      ...data,
      timestamp: Date.now()
    }, null, 2));
  }

  private generateSessionId(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private hashPassword(password: string): string {
    // Simplified hashing - use proper bcrypt in production
    return require('crypto').createHash('sha256').update(password).digest('hex');
  }

  private setupSessionCleanup(): void {
    // Clean up expired sessions every 5 minutes
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastActivity > this.config.sessionTimeout) {
          this.sessions.delete(sessionId);
          console.log(`🗑️ Cleaned up expired session: ${sessionId}`);
        }
      }
    }, 5 * 60 * 1000);
  }
}

// Export singleton instance
export const adminInterface = new AdminInterface();

export default adminInterface;