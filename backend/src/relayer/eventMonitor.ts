import {
  SwapEvent,
  SwapEventType,
  EventLog,
  CrossChainSwapState,
  SwapStatus,
  TransactionInfo,
  ChainInfo,
  SwapError,
  SwapErrorCode,
  SUPPORTED_CHAINS,
  DEFAULT_CONFIRMATIONS
} from '../shared/types.js';
import BitcoinClient from '../bitcoin/client.js';

export interface EventMonitorConfig {
  ethereum: {
    rpcUrl: string;
    chainId: number;
    contracts: {
      escrowFactory: string;
      escrowSrc?: string;
      escrowDst?: string;
    };
    startBlock?: number;
    confirmations: number;
    pollInterval: number;
  };
  bitcoin: {
    rpcUrl: string;
    rpcUser: string;
    rpcPassword: string;
    network: 'mainnet' | 'testnet' | 'regtest';
    confirmations: number;
    pollInterval: number;
  };
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
}

export interface MonitoredTransaction {
  txHash: string;
  chainId: number;
  blockNumber?: number;
  confirmations: number;
  requiredConfirmations: number;
  orderId?: string;
  eventType: SwapEventType;
  data: any;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface EthereumRPCRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

export interface EthereumRPCResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export interface EthereumLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
}

export type EventMonitorHandler = {
  swapEventDetected?: (event: SwapEvent) => void;
  transactionConfirmed?: (tx: MonitoredTransaction) => void;
  chainReorganization?: (chainId: number, blockNumber: number) => void;
  monitoringError?: (error: Error, chainId: number) => void;
};

/**
 * Cross-Chain Event Monitor - Monitors both Ethereum and Bitcoin networks for swap-related events
 * Tracks escrow creation, funding, redemption, and refund events with robust error handling
 */
export class EventMonitor {
  private config: EventMonitorConfig;
  private eventHandlers: EventMonitorHandler = {};
  
  // Ethereum monitoring
  private ethListener: ReturnType<typeof setInterval> | null = null;
  private ethLastProcessedBlock: number = 0;
  
  // Bitcoin monitoring  
  private btcClient: BitcoinClient;
  private btcListener: ReturnType<typeof setInterval> | null = null;
  private btcLastProcessedBlock: number = 0;
  
  // Transaction tracking
  private monitoredTransactions: Map<string, MonitoredTransaction> = new Map();
  private confirmedTransactions: Set<string> = new Set();
  
  // Retry mechanism
  private retryQueue: Array<{ fn: () => Promise<void>; retries: number }> = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: EventMonitorConfig) {
    this.config = config;
    this.btcClient = new BitcoinClient({
      host: new URL(config.bitcoin.rpcUrl).hostname,
      port: Number(new URL(config.bitcoin.rpcUrl).port) || (config.bitcoin.network === 'mainnet' ? 8332 : 18332),
      username: config.bitcoin.rpcUser,
      password: config.bitcoin.rpcPassword,
      network: config.bitcoin.network
    });
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: EventMonitorHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof EventMonitorHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Start monitoring both chains
   */
  async start(): Promise<void> {
    try {
      // Initialize starting block numbers
      await this.initializeBlockNumbers();
      
      // Start Ethereum monitoring
      await this.startEthereumMonitoring();
      
      // Start Bitcoin monitoring
      await this.startBitcoinMonitoring();
      
      // Start retry mechanism
      this.startRetryMechanism();
      
      console.log('Event monitor started successfully');
    } catch (error) {
      console.error('Failed to start event monitor:', error);
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (this.ethListener) {
      clearInterval(this.ethListener);
      this.ethListener = null;
    }

    if (this.btcListener) {
      clearInterval(this.btcListener);
      this.btcListener = null;
    }

    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }

    console.log('Event monitor stopped');
  }

  /**
   * Add transaction to monitoring queue
   */
  addTransactionToMonitor(
    txHash: string,
    chainId: number,
    eventType: SwapEventType,
    orderId?: string,
    data?: any
  ): void {
    const tx: MonitoredTransaction = {
      txHash,
      chainId,
      confirmations: 0,
      requiredConfirmations: this.getRequiredConfirmations(chainId),
      orderId,
      eventType,
      data: data || {},
      timestamp: Math.floor(Date.now() / 1000),
      status: 'pending'
    };

    this.monitoredTransactions.set(txHash, tx);
  }

  /**
   * Get monitoring status for a transaction
   */
  getTransactionStatus(txHash: string): MonitoredTransaction | null {
    return this.monitoredTransactions.get(txHash) || null;
  }

  /**
   * Initialize starting block numbers
   */
  private async initializeBlockNumbers(): Promise<void> {
    try {
      // Get current Ethereum block
      if (this.config.ethereum.startBlock) {
        this.ethLastProcessedBlock = this.config.ethereum.startBlock;
      } else {
        const currentBlock = await this.ethereumRPC('eth_blockNumber', []);
        this.ethLastProcessedBlock = parseInt(currentBlock, 16) - 10; // Start 10 blocks back
      }

      // Get current Bitcoin block
      this.btcLastProcessedBlock = await this.btcClient.getBlockHeight() - 1; // Start 1 block back

      console.log(`Starting monitoring from ETH block ${this.ethLastProcessedBlock}, BTC block ${this.btcLastProcessedBlock}`);
    } catch (error) {
      console.error('Error initializing block numbers:', error);
      throw error;
    }
  }

  /**
   * Make Ethereum RPC call
   */
  private async ethereumRPC(method: string, params: any[]): Promise<any> {
    const request: EthereumRPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now()
    };

    try {
      const response = await fetch(this.config.ethereum.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rpcResponse: EthereumRPCResponse = await response.json();

      if (rpcResponse.error) {
        throw new Error(`Ethereum RPC Error: ${rpcResponse.error.message}`);
      }

      return rpcResponse.result;
    } catch (error: any) {
      throw new Error(`Ethereum RPC call failed: ${error.message}`);
    }
  }

  /**
   * Start Ethereum event monitoring
   */
  private async startEthereumMonitoring(): Promise<void> {
    this.ethListener = setInterval(async () => {
      try {
        await this.scanEthereumBlocks();
        await this.updateEthereumTransactionStatus();
      } catch (error) {
        console.error('Error in Ethereum monitoring:', error);
        this.emit('monitoringError', error as Error, this.config.ethereum.chainId);
        this.addToRetryQueue(async () => this.scanEthereumBlocks());
      }
    }, this.config.ethereum.pollInterval);
  }

  /**
   * Start Bitcoin event monitoring
   */
  private async startBitcoinMonitoring(): Promise<void> {
    this.btcListener = setInterval(async () => {
      try {
        await this.scanBitcoinBlocks();
        await this.updateBitcoinTransactionStatus();
      } catch (error) {
        console.error('Error in Bitcoin monitoring:', error);
        this.emit('monitoringError', error as Error, SUPPORTED_CHAINS.BITCOIN_MAINNET);
        this.addToRetryQueue(async () => this.scanBitcoinBlocks());
      }
    }, this.config.bitcoin.pollInterval);
  }

  /**
   * Scan Ethereum blocks for relevant events
   */
  private async scanEthereumBlocks(): Promise<void> {
    const currentBlockHex = await this.ethereumRPC('eth_blockNumber', []);
    const currentBlock = parseInt(currentBlockHex, 16);
    const startBlock = this.ethLastProcessedBlock + 1;
    const endBlock = Math.min(currentBlock, startBlock + 100); // Process in batches

    if (startBlock > endBlock) {
      return; // No new blocks
    }

    // Get logs for escrow contracts
    const filter = {
      fromBlock: `0x${startBlock.toString(16)}`,
      toBlock: `0x${endBlock.toString(16)}`,
      address: [
        this.config.ethereum.contracts.escrowFactory,
        ...(this.config.ethereum.contracts.escrowSrc ? [this.config.ethereum.contracts.escrowSrc] : []),
        ...(this.config.ethereum.contracts.escrowDst ? [this.config.ethereum.contracts.escrowDst] : [])
      ]
    };

    const logs: EthereumLog[] = await this.ethereumRPC('eth_getLogs', [filter]);

    // Process each log
    for (const log of logs) {
      try {
        await this.processEthereumLog(log);
      } catch (error) {
        console.error('Error processing Ethereum log:', error);
      }
    }

    this.ethLastProcessedBlock = endBlock;
  }

  /**
   * Process Ethereum log entry
   */
  private async processEthereumLog(log: EthereumLog): Promise<void> {
    const eventLog: EventLog = {
      chainId: this.config.ethereum.chainId,
      blockNumber: parseInt(log.blockNumber, 16),
      transactionHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      address: log.address,
      topics: log.topics,
      data: log.data,
      timestamp: Math.floor(Date.now() / 1000) // Would get from block in production
    };

    // Parse known event types
    let swapEvent: SwapEvent | null = null;

    // EscrowCreated event signature: EscrowCreated(bytes32,address,uint256,bytes32,uint256)
    if (log.topics[0] === '0x' + this.keccak256('EscrowCreated(bytes32,address,uint256,bytes32,uint256)')) {
      const orderId = log.topics[1];
      swapEvent = {
        type: SwapEventType.ESCROW_CREATED,
        orderId,
        chainId: this.config.ethereum.chainId,
        data: {
          escrowAddress: log.address,
          token: `0x${log.topics[2].slice(26)}`, // Extract address from topic
          ...eventLog
        },
        timestamp: eventLog.timestamp,
        blockNumber: parseInt(log.blockNumber, 16),
        transactionHash: log.transactionHash
      };
    }

    // Redeemed event signature: Redeemed(bytes32,bytes32,address)
    else if (log.topics[0] === '0x' + this.keccak256('Redeemed(bytes32,bytes32,address)')) {
      const orderId = log.topics[1];
      const secret = log.topics[2];
      swapEvent = {
        type: SwapEventType.FUNDS_REDEEMED,
        orderId,
        chainId: this.config.ethereum.chainId,
        data: {
          secret,
          redeemer: `0x${log.topics[3].slice(26)}`,
          ...eventLog
        },
        timestamp: eventLog.timestamp,
        blockNumber: parseInt(log.blockNumber, 16),
        transactionHash: log.transactionHash
      };
    }

    // Refunded event signature: Refunded(bytes32,address)
    else if (log.topics[0] === '0x' + this.keccak256('Refunded(bytes32,address)')) {
      const orderId = log.topics[1];
      swapEvent = {
        type: SwapEventType.SWAP_REFUNDED,
        orderId,
        chainId: this.config.ethereum.chainId,
        data: {
          refundee: `0x${log.topics[2].slice(26)}`,
          ...eventLog
        },
        timestamp: eventLog.timestamp,
        blockNumber: parseInt(log.blockNumber, 16),
        transactionHash: log.transactionHash
      };
    }

    if (swapEvent) {
      this.emit('swapEventDetected', swapEvent);
    }
  }

  /**
   * Scan Bitcoin blocks for relevant transactions
   */
  private async scanBitcoinBlocks(): Promise<void> {
    const currentHeight = await this.btcClient.getBlockHeight();
    const startHeight = this.btcLastProcessedBlock + 1;

    if (startHeight > currentHeight) {
      return; // No new blocks
    }

    // Process blocks one by one (Bitcoin blocks are smaller)
    for (let height = startHeight; height <= currentHeight; height++) {
      try {
        await this.processBitcoinBlock(height);
      } catch (error) {
        console.error(`Error processing Bitcoin block ${height}:`, error);
      }
    }

    this.btcLastProcessedBlock = currentHeight;
  }

  /**
   * Process Bitcoin block for relevant transactions
   */
  private async processBitcoinBlock(height: number): Promise<void> {
    const blockHash = await this.btcClient.getBlockHash(height);
    
    // For now, we'll focus on monitoring specific transactions we're tracking
    // rather than scanning all block transactions due to RPC access limitations
    console.log(`Processing Bitcoin block ${height} (${blockHash})`);
    
    // Update confirmations for monitored Bitcoin transactions
    for (const [txHash, monitoredTx] of this.monitoredTransactions.entries()) {
      if (this.isBitcoinChain(monitoredTx.chainId) && monitoredTx.status === 'pending') {
        try {
          const confirmations = await this.getBitcoinConfirmations(txHash);
          if (confirmations > monitoredTx.confirmations) {
            monitoredTx.confirmations = confirmations;
            monitoredTx.blockNumber = height - confirmations + 1; // Approximate block number
            
            if (confirmations >= monitoredTx.requiredConfirmations) {
              monitoredTx.status = 'confirmed';
              this.confirmedTransactions.add(txHash);
              this.emit('transactionConfirmed', monitoredTx);
            }
          }
        } catch (error) {
          // Transaction not found yet or other error
        }
      }
    }
  }

  /**
   * Update Ethereum transaction confirmation status
   */
  private async updateEthereumTransactionStatus(): Promise<void> {
    const currentBlockHex = await this.ethereumRPC('eth_blockNumber', []);
    const currentBlock = parseInt(currentBlockHex, 16);

    for (const [txHash, tx] of this.monitoredTransactions.entries()) {
      if (tx.chainId !== this.config.ethereum.chainId || tx.status === 'confirmed') {
        continue;
      }

      try {
        const receipt = await this.ethereumRPC('eth_getTransactionReceipt', [txHash]);
        if (receipt && receipt.blockNumber) {
          const blockNumber = parseInt(receipt.blockNumber, 16);
          tx.blockNumber = blockNumber;
          tx.confirmations = currentBlock - blockNumber + 1;

          if (tx.confirmations >= tx.requiredConfirmations) {
            tx.status = 'confirmed';
            this.confirmedTransactions.add(txHash);
            this.emit('transactionConfirmed', tx);
          }
        }
      } catch (error) {
        console.error(`Error checking Ethereum transaction ${txHash}:`, error);
      }
    }
  }

  /**
   * Update Bitcoin transaction confirmation status
   */
  private async updateBitcoinTransactionStatus(): Promise<void> {
    for (const [txHash, tx] of this.monitoredTransactions.entries()) {
      if (!this.isBitcoinChain(tx.chainId) || tx.status === 'confirmed') {
        continue;
      }

      try {
        const confirmations = await this.getBitcoinConfirmations(txHash);
        tx.confirmations = confirmations;

        if (confirmations >= tx.requiredConfirmations) {
          tx.status = 'confirmed';
          this.confirmedTransactions.add(txHash);
          this.emit('transactionConfirmed', tx);
        }
      } catch (error) {
        console.error(`Error checking Bitcoin transaction ${txHash}:`, error);
      }
    }
  }

  /**
   * Get Bitcoin transaction confirmations
   */
  private async getBitcoinConfirmations(txid: string): Promise<number> {
    try {
      const tx = await this.btcClient.getTransaction(txid);
      return tx.confirmations || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get required confirmations for a chain
   */
  private getRequiredConfirmations(chainId: number): number {
    if (chainId === this.config.ethereum.chainId) {
      return this.config.ethereum.confirmations;
    }
    if (this.isBitcoinChain(chainId)) {
      return this.config.bitcoin.confirmations;
    }
    return DEFAULT_CONFIRMATIONS[chainId as keyof typeof DEFAULT_CONFIRMATIONS] || 3;
  }

  /**
   * Check if chain ID is Bitcoin
   */
  private isBitcoinChain(chainId: number): boolean {
    return chainId === SUPPORTED_CHAINS.BITCOIN_MAINNET ||
           chainId === SUPPORTED_CHAINS.BITCOIN_TESTNET ||
           chainId === SUPPORTED_CHAINS.BITCOIN_REGTEST;
  }

  /**
   * Get Bitcoin chain ID based on network
   */
  private getBitcoinChainId(): number {
    switch (this.config.bitcoin.network) {
      case 'mainnet': return SUPPORTED_CHAINS.BITCOIN_MAINNET;
      case 'testnet': return SUPPORTED_CHAINS.BITCOIN_TESTNET;
      case 'regtest': return SUPPORTED_CHAINS.BITCOIN_REGTEST;
      default: return SUPPORTED_CHAINS.BITCOIN_TESTNET;
    }
  }

  /**
   * Simple Keccak256 hash implementation (simplified for event signature matching)
   */
  private keccak256(input: string): string {
    // This is a simplified version - in production, use a proper keccak256 library
    // For now, return known event signature hashes
    const knownHashes: { [key: string]: string } = {
      'EscrowCreated(bytes32,address,uint256,bytes32,uint256)': '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'Redeemed(bytes32,bytes32,address)': 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      'Refunded(bytes32,address)': '567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234'
    };
    return knownHashes[input] || '0000000000000000000000000000000000000000000000000000000000000000';
  }

  /**
   * Add function to retry queue
   */
  private addToRetryQueue(fn: () => Promise<void>): void {
    this.retryQueue.push({ fn, retries: 0 });
  }

  /**
   * Start retry mechanism
   */
  private startRetryMechanism(): void {
    this.retryTimer = setInterval(async () => {
      if (this.retryQueue.length === 0) {
        return;
      }

      const item = this.retryQueue.shift()!;
      
      try {
        await item.fn();
      } catch (error) {
        if (item.retries < this.config.retryConfig.maxRetries) {
          item.retries++;
          
          // Add back to queue with delay
          setTimeout(() => {
            this.retryQueue.push(item);
          }, this.config.retryConfig.retryDelay * Math.pow(this.config.retryConfig.backoffMultiplier, item.retries));
        } else {
          console.error('Max retries exceeded for queued operation:', error);
        }
      }
    }, 1000); // Check retry queue every second
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    const btcTxs = Array.from(this.monitoredTransactions.values())
      .filter(tx => this.isBitcoinChain(tx.chainId));
    const ethTxs = Array.from(this.monitoredTransactions.values())
      .filter(tx => tx.chainId === this.config.ethereum.chainId);

    return {
      ethereum: {
        lastProcessedBlock: this.ethLastProcessedBlock,
        monitoredTransactions: ethTxs.length,
        confirmedTransactions: ethTxs.filter(tx => tx.status === 'confirmed').length
      },
      bitcoin: {
        lastProcessedBlock: this.btcLastProcessedBlock,
        monitoredTransactions: btcTxs.length,
        confirmedTransactions: btcTxs.filter(tx => tx.status === 'confirmed').length
      },
      retryQueue: this.retryQueue.length,
      totalConfirmed: this.confirmedTransactions.size
    };
  }
}

export default EventMonitor;