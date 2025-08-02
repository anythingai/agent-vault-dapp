import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  SwapEvent,
  ResolverInfo,
  SwapMetrics,
  HealthCheck,
  AuctionBid,
  SwapError,
  SwapErrorCode
} from '../types';

// API Configuration
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
const WS_BASE_URL = process.env.REACT_APP_WS_BASE_URL || 'ws://localhost:3001';

interface WebSocketMessage {
  type: string;
  data: any;
  orderId?: string;
  timestamp: number;
}

class ApiService {
  private httpClient: AxiosInstance;
  private wsConnection: WebSocket | null = null;
  private wsReconnectTimeout: number | null = null;
  private wsEventHandlers: Map<string, Array<(data: any) => void>> = new Map();
  private isReconnecting = false;
  private maxReconnectAttempts = 5;
  private reconnectAttempts = 0;

  constructor() {
    this.httpClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for authentication if needed
    this.httpClient.interceptors.request.use(
      (config) => {
        const apiKey = localStorage.getItem('apiKey');
        if (apiKey) {
          config.headers.Authorization = `Bearer ${apiKey}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Handle authentication error
          localStorage.removeItem('apiKey');
          window.dispatchEvent(new CustomEvent('auth-error'));
        }
        return Promise.reject(this.transformError(error));
      }
    );
  }

  private transformError(error: any): SwapError {
    if (error.response) {
      const { status, data } = error.response;
      let code = SwapErrorCode.NETWORK_ERROR;
      
      switch (status) {
        case 400:
          code = SwapErrorCode.INVALID_ORDER;
          break;
        case 404:
          code = SwapErrorCode.RESOLVER_UNAVAILABLE;
          break;
        case 408:
          code = SwapErrorCode.TIMEOUT;
          break;
        case 422:
          code = SwapErrorCode.INVALID_SIGNATURE;
          break;
        default:
          code = SwapErrorCode.NETWORK_ERROR;
      }

      return new SwapError(
        data.message || error.message,
        code,
        data.orderId,
        data.chainId
      );
    }
    
    return new SwapError(
      error.message || 'Network error occurred',
      SwapErrorCode.NETWORK_ERROR
    );
  }

  // REST API Methods

  async createOrder(orderData: Partial<SwapOrder>): Promise<SwapOrder> {
    try {
      const response: AxiosResponse<SwapOrder> = await this.httpClient.post(
        '/api/orders',
        orderData
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async getOrder(orderId: string): Promise<CrossChainSwapState> {
    try {
      const response: AxiosResponse<CrossChainSwapState> = await this.httpClient.get(
        `/api/orders/${orderId}`
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async getUserOrders(address: string, limit = 20, offset = 0): Promise<CrossChainSwapState[]> {
    try {
      const response: AxiosResponse<CrossChainSwapState[]> = await this.httpClient.get(
        `/api/orders/user/${address}`,
        { params: { limit, offset } }
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async startAuction(orderId: string): Promise<{ success: boolean; auctionId: string }> {
    try {
      const response = await this.httpClient.post(`/api/orders/${orderId}/auction`);
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async placeBid(orderId: string, bid: Partial<AuctionBid>): Promise<{ success: boolean }> {
    try {
      const response = await this.httpClient.post(
        `/api/auctions/${orderId}/bids`,
        bid
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async getActiveResolvers(): Promise<ResolverInfo[]> {
    try {
      const response: AxiosResponse<ResolverInfo[]> = await this.httpClient.get(
        '/api/resolvers'
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async getSwapMetrics(): Promise<SwapMetrics> {
    try {
      const response: AxiosResponse<SwapMetrics> = await this.httpClient.get(
        '/api/metrics'
      );
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async getHealthStatus(): Promise<HealthCheck> {
    try {
      const response: AxiosResponse<HealthCheck> = await this.httpClient.get('/health');
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  async estimateSwapFee(
    sourceChain: number,
    destChain: number,
    amount: string,
    token: string
  ): Promise<{ estimatedFee: string; gasEstimate?: string }> {
    try {
      const response = await this.httpClient.get('/api/estimate-fee', {
        params: { sourceChain, destChain, amount, token }
      });
      return response.data;
    } catch (error) {
      throw this.transformError(error);
    }
  }

  // WebSocket Methods

  connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wsConnection?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        this.wsConnection = new WebSocket(`${WS_BASE_URL}/ws`);

        this.wsConnection.onopen = () => {
          console.log('WebSocket connected');
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
          if (this.wsReconnectTimeout) {
            clearTimeout(this.wsReconnectTimeout);
            this.wsReconnectTimeout = null;
          }
          resolve();
        };

        this.wsConnection.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.wsConnection.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason);
          this.handleWebSocketDisconnect();
        };

        this.wsConnection.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleWebSocketMessage(message: WebSocketMessage): void {
    const { type, data, orderId } = message;
    
    // Emit to specific event handlers
    const handlers = this.wsEventHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }

    // Emit to order-specific handlers
    if (orderId) {
      const orderHandlers = this.wsEventHandlers.get(`order:${orderId}`);
      if (orderHandlers) {
        orderHandlers.forEach(handler => handler(data));
      }
    }

    // Emit to global handlers
    const globalHandlers = this.wsEventHandlers.get('*');
    if (globalHandlers) {
      globalHandlers.forEach(handler => handler(message));
    }
  }

  private handleWebSocketDisconnect(): void {
    if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.isReconnecting = true;
      this.reconnectAttempts++;
      
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
      console.log(`Reconnecting WebSocket in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      this.wsReconnectTimeout = window.setTimeout(() => {
        this.connectWebSocket().catch(error => {
          console.error('WebSocket reconnection failed:', error);
          this.handleWebSocketDisconnect();
        });
      }, delay);
    }
  }

  subscribeToSwapEvents(orderId: string, callback: (event: SwapEvent) => void): () => void {
    const eventType = `order:${orderId}`;
    
    if (!this.wsEventHandlers.has(eventType)) {
      this.wsEventHandlers.set(eventType, []);
    }
    
    this.wsEventHandlers.get(eventType)!.push(callback);

    // Send subscription message
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({
        type: 'subscribe',
        channel: 'order-events',
        orderId
      }));
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.wsEventHandlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(callback);
        if (index > -1) {
          handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
          this.wsEventHandlers.delete(eventType);
          
          // Send unsubscription message
          if (this.wsConnection?.readyState === WebSocket.OPEN) {
            this.wsConnection.send(JSON.stringify({
              type: 'unsubscribe',
              channel: 'order-events',
              orderId
            }));
          }
        }
      }
    };
  }

  subscribeToGlobalEvents(callback: (message: WebSocketMessage) => void): () => void {
    const eventType = '*';
    
    if (!this.wsEventHandlers.has(eventType)) {
      this.wsEventHandlers.set(eventType, []);
    }
    
    this.wsEventHandlers.get(eventType)!.push(callback);

    return () => {
      const handlers = this.wsEventHandlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(callback);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  disconnectWebSocket(): void {
    if (this.wsReconnectTimeout) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
    
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    this.wsEventHandlers.clear();
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  isWebSocketConnected(): boolean {
    return this.wsConnection?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const apiService = new ApiService();

// Export default for easier imports
export default apiService;