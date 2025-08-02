import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  TransactionInfo,
  ChainId,
  Address,
  Amount,
  Hash,
  SwapError,
  SwapErrorCode,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS,
  DEFAULT_CONFIRMATIONS
} from '../shared/types.js';

import BitcoinClient, { UTXO } from '../bitcoin/client.js';
import { LiquidityManager, LiquidityReservation } from './liquidityManager.js';

// Import Buffer from Node.js
import { Buffer } from 'buffer';

export interface SwapExecution {
  orderId: string;
  order: CrossChainSwapState;
  reservationId: string;
  status: 'pending' | 'source_funding' | 'destination_funding' | 'both_funded' | 'revealing_secret' | 'redeeming' | 'completed' | 'failed' | 'expired';
  transactions: {
    sourceFunding?: ExecutedTransaction;
    destinationFunding?: ExecutedTransaction;
    sourceRedeem?: ExecutedTransaction;
    destinationRedeem?: ExecutedTransaction;
    sourceRefund?: ExecutedTransaction;
    destinationRefund?: ExecutedTransaction;
  };
  secret?: string;
  secretHash: string;
  timelocks: {
    source: number;
    destination: number;
  };
  executionStarted: number;
  lastActivity: number;
  retryCount: number;
  errors: ExecutionError[];
}

export interface ExecutedTransaction {
  chainId: ChainId;
  txHash: Hash;
  blockHeight?: number;
  confirmations: number;
  requiredConfirmations: number;
  status: 'pending' | 'confirmed' | 'failed';
  gasUsed?: string;
  fee: string;
  timestamp: number;
  retryCount: number;
}

export interface ExecutionError {
  timestamp: number;
  error: string;
  context: string;
  recoverable: boolean;
  retryAfter?: number;
}

export interface SwapExecutorConfig {
  ethereum: {
    rpcUrl: string;
    chainId: ChainId;
    privateKey: string;
    gasLimit: {
      escrowCreation: string;
      escrowRedeem: string;
      escrowRefund: string;
    };
    gasPrice: {
      standard: string;
      fast: string;
      rapid: string;
    };
    confirmations: number;
  };
  bitcoin: {
    rpcUrl: string;
    rpcUser: string;
    rpcPassword: string;
    network: 'mainnet' | 'testnet' | 'regtest';
    privateKey: string;
    feeRate: {
      standard: number; // sat/byte
      fast: number;
      rapid: number;
    };
    confirmations: number;
  };
  execution: {
    maxRetries: number;
    retryDelay: number; // Base delay in ms
    retryBackoff: number; // Multiplier for exponential backoff
    transactionTimeout: number; // Max time to wait for confirmation
    secretRevealDelay: number; // Delay before revealing secret
    maxConcurrentExecutions: number;
  };
  monitoring: {
    pollInterval: number; // Transaction monitoring interval
    confirmationThreshold: number; // Additional confirmations for safety
    staleTransactionTimeout: number; // Time before considering tx stale
  };
}

export type SwapExecutorEventHandler = {
  executionStarted?: (execution: SwapExecution) => void;
  transactionSubmitted?: (execution: SwapExecution, tx: ExecutedTransaction) => void;
  transactionConfirmed?: (execution: SwapExecution, tx: ExecutedTransaction) => void;
  secretRevealed?: (execution: SwapExecution, secret: string) => void;
  executionCompleted?: (execution: SwapExecution) => void;
  executionFailed?: (execution: SwapExecution, error: ExecutionError) => void;
  retryAttempt?: (execution: SwapExecution, attempt: number) => void;
};

export interface SwapExecutorMetrics {
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  activeExecutions: number;
  averageExecutionTime: number;
  successRate: number;
  totalGasUsed: {
    ethereum: string;
    bitcoin: string;
  };
  totalFees: {
    ethereum: string;
    bitcoin: string;
  };
}

/**
 * Swap Executor - Executes cross-chain atomic swaps
 * Coordinates transaction submission and monitoring on both Ethereum and Bitcoin
 */
export class SwapExecutor {
  private config: SwapExecutorConfig;
  private liquidityManager: LiquidityManager;
  private bitcoinClient: BitcoinClient;
  private eventHandlers: SwapExecutorEventHandler = {};
  
  private activeExecutions: Map<string, SwapExecution> = new Map();
  private monitoringTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  
  private metrics: SwapExecutorMetrics = {
    totalExecutions: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    activeExecutions: 0,
    averageExecutionTime: 0,
    successRate: 0,
    totalGasUsed: { ethereum: '0', bitcoin: '0' },
    totalFees: { ethereum: '0', bitcoin: '0' }
  };

  constructor(config: SwapExecutorConfig, liquidityManager: LiquidityManager) {
    this.config = config;
    this.liquidityManager = liquidityManager;
    
    // Initialize Bitcoin client
    this.bitcoinClient = new BitcoinClient({
      host: new URL(config.bitcoin.rpcUrl).hostname,
      port: parseInt(new URL(config.bitcoin.rpcUrl).port) || 8332,
      username: config.bitcoin.rpcUser,
      password: config.bitcoin.rpcPassword,
      network: config.bitcoin.network
    });
    
    console.log('SwapExecutor initialized with:');
    console.log(`- Ethereum chain: ${config.ethereum.chainId}`);
    console.log(`- Bitcoin network: ${config.bitcoin.network}`);
    console.log(`- Max concurrent executions: ${config.execution.maxConcurrentExecutions}`);
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: SwapExecutorEventHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof SwapExecutorEventHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Start the swap executor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Swap executor already running');
      return;
    }
    
    console.log('Starting swap executor...');
    this.isRunning = true;
    
    // Start transaction monitoring
    this.startTransactionMonitoring();
    
    console.log('Swap executor started successfully');
  }

  /**
   * Stop the swap executor
   */
  async stop(): Promise<void> {
    console.log('Stopping swap executor...');
    this.isShuttingDown = true;
    this.isRunning = false;
    
    // Clear monitoring timer
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    // Wait for active executions to complete or timeout
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    
    while (this.activeExecutions.size > 0 && (Date.now() - start) < timeout) {
      console.log(`Waiting for ${this.activeExecutions.size} active executions to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('Swap executor stopped');
  }

  /**
   * Execute a cross-chain swap
   */
  async executeSwap(
    order: CrossChainSwapState,
    reservationId: string,
    secret: string
  ): Promise<SwapExecution> {
    // Check concurrent execution limit
    if (this.activeExecutions.size >= this.config.execution.maxConcurrentExecutions) {
      throw new SwapError(
        'Maximum concurrent executions reached',
        SwapErrorCode.RESOLVER_UNAVAILABLE,
        order.orderId
      );
    }
    
    // Create execution record
    const execution: SwapExecution = {
      orderId: order.orderId,
      order,
      reservationId,
      status: 'pending',
      transactions: {},
      secret,
      secretHash: order.secretHash,
      timelocks: {
        source: order.timelocks.source,
        destination: order.timelocks.destination
      },
      executionStarted: Math.floor(Date.now() / 1000),
      lastActivity: Math.floor(Date.now() / 1000),
      retryCount: 0,
      errors: []
    };
    
    this.activeExecutions.set(order.orderId, execution);
    this.metrics.totalExecutions++;
    
    this.emit('executionStarted', execution);
    
    console.log(`Starting swap execution for order ${order.orderId}`);
    
    try {
      // Start the execution process
      await this.processSwapExecution(execution);
      return execution;
      
    } catch (error) {
      console.error(`Error starting swap execution for ${order.orderId}:`, error);
      this.handleExecutionError(execution, error as Error, 'execution_start');
      throw error;
    }
  }

  /**
   * Process swap execution through different stages
   */
  private async processSwapExecution(execution: SwapExecution): Promise<void> {
    try {
      // Stage 1: Fund source chain (resolver provides destination asset)
      execution.status = 'source_funding';
      await this.fundSourceChain(execution);
      
      // Stage 2: Fund destination chain (resolver provides source asset)  
      execution.status = 'destination_funding';
      await this.fundDestinationChain(execution);
      
      execution.status = 'both_funded';
      
      // Stage 3: Wait briefly then reveal secret
      execution.status = 'revealing_secret';
      await this.scheduleSecretReveal(execution);
      
      // Stage 4: Redeem from both chains
      execution.status = 'redeeming';
      await this.redeemFromBothChains(execution);
      
      // Stage 5: Execution completed
      await this.completeExecution(execution);
      
    } catch (error) {
      console.error(`Error in swap execution ${execution.orderId}:`, error);
      this.handleExecutionError(execution, error as Error, 'swap_processing');
    }
  }

  /**
   * Fund the source chain (where user wants to receive tokens)
   */
  private async fundSourceChain(execution: SwapExecution): Promise<void> {
    const order = execution.order;
    
    if (this.isBitcoinChain(order.sourceChain.chainId)) {
      // Fund Bitcoin HTLC
      await this.fundBitcoinHTLC(execution, 'source');
    } else {
      // Fund Ethereum escrow
      await this.fundEthereumEscrow(execution, 'source');
    }
    
    console.log(`Source chain funded for swap ${execution.orderId}`);
  }

  /**
   * Fund the destination chain (where user provides tokens)
   */
  private async fundDestinationChain(execution: SwapExecution): Promise<void> {
    const order = execution.order;
    
    if (this.isBitcoinChain(order.destinationChain.chainId)) {
      // Fund Bitcoin HTLC
      await this.fundBitcoinHTLC(execution, 'destination');
    } else {
      // Fund Ethereum escrow
      await this.fundEthereumEscrow(execution, 'destination');
    }
    
    console.log(`Destination chain funded for swap ${execution.orderId}`);
  }

  /**
   * Fund Bitcoin HTLC
   */
  private async fundBitcoinHTLC(execution: SwapExecution, side: 'source' | 'destination'): Promise<void> {
    const order = execution.order;
    const amount = side === 'source' ? order.amounts.source : order.amounts.destination;
    const timelock = side === 'source' ? execution.timelocks.source : execution.timelocks.destination;
    
    try {
      // Create HTLC
      const secretHashBuffer = Buffer.from(execution.secretHash, 'hex');
      
      const { htlcOutput } = await this.bitcoinClient.createHTLCSwap({
        secretHash: secretHashBuffer,
        userPubkey: Buffer.from('placeholder_user_pubkey', 'hex'),
        resolverPubkey: Buffer.from('placeholder_resolver_pubkey', 'hex'),
        timelock
      });
      
      // Get UTXOs for funding
      const resolverAddress = this.bitcoinClient.generateKeyPair().address;
      const utxos = await this.bitcoinClient.getUTXOs(resolverAddress, 1);
      
      if (utxos.length === 0) {
        throw new Error('No UTXOs available for funding HTLC');
      }
      
      // Fund the HTLC
      const fundingTx = await this.bitcoinClient.fundHTLC(
        htlcOutput,
        parseInt(amount),
        utxos,
        this.config.bitcoin.privateKey,
        resolverAddress,
        this.config.bitcoin.feeRate.standard
      );
      
      // Create transaction record
      const executedTx: ExecutedTransaction = {
        chainId: side === 'source' ? order.sourceChain.chainId : order.destinationChain.chainId,
        txHash: fundingTx.txid!,
        confirmations: 0,
        requiredConfirmations: this.config.bitcoin.confirmations,
        status: 'pending',
        fee: '1000', // Mock fee in satoshis
        timestamp: Math.floor(Date.now() / 1000),
        retryCount: 0
      };
      
      if (side === 'source') {
        execution.transactions.sourceFunding = executedTx;
      } else {
        execution.transactions.destinationFunding = executedTx;
      }
      
      this.emit('transactionSubmitted', execution, executedTx);
      
      // Wait for confirmation
      await this.waitForTransactionConfirmation(execution, executedTx);
      
    } catch (error) {
      throw new Error(`Failed to fund Bitcoin HTLC on ${side}: ${(error as Error).message}`);
    }
  }

  /**
   * Fund Ethereum escrow (simplified implementation)
   */
  private async fundEthereumEscrow(execution: SwapExecution, side: 'source' | 'destination'): Promise<void> {
    const order = execution.order;
    const amount = side === 'source' ? order.amounts.source : order.amounts.destination;
    
    // In a real implementation, this would:
    // 1. Create or interact with Ethereum escrow contract
    // 2. Submit funding transaction
    // 3. Wait for confirmation
    
    console.log(`Funding Ethereum escrow for ${side} with amount ${amount}`);
    
    // Mock transaction for this implementation
    const executedTx: ExecutedTransaction = {
      chainId: side === 'source' ? order.sourceChain.chainId : order.destinationChain.chainId,
      txHash: `0x${Math.random().toString(16).substring(2)}`,
      confirmations: this.config.ethereum.confirmations,
      requiredConfirmations: this.config.ethereum.confirmations,
      status: 'confirmed',
      fee: this.config.ethereum.gasPrice.standard,
      timestamp: Math.floor(Date.now() / 1000),
      retryCount: 0
    };
    
    if (side === 'source') {
      execution.transactions.sourceFunding = executedTx;
    } else {
      execution.transactions.destinationFunding = executedTx;
    }
    
    this.emit('transactionSubmitted', execution, executedTx);
    this.emit('transactionConfirmed', execution, executedTx);
  }

  /**
   * Schedule secret reveal after delay
   */
  private async scheduleSecretReveal(execution: SwapExecution): Promise<void> {
    console.log(`Scheduling secret reveal for swap ${execution.orderId}`);
    
    // Wait for configured delay before revealing secret
    await new Promise(resolve => 
      setTimeout(resolve, this.config.execution.secretRevealDelay)
    );
    
    // Reveal secret (in production, this would be done by publishing it on-chain)
    console.log(`Revealing secret for swap ${execution.orderId}`);
    this.emit('secretRevealed', execution, execution.secret!);
  }

  /**
   * Redeem from both chains after secret reveal
   */
  private async redeemFromBothChains(execution: SwapExecution): Promise<void> {
    const promises = [];
    
    // Redeem from source chain (user gets their tokens)
    if (execution.transactions.sourceFunding) {
      promises.push(this.redeemFromChain(execution, 'source'));
    }
    
    // Redeem from destination chain (resolver gets their payment)
    if (execution.transactions.destinationFunding) {
      promises.push(this.redeemFromChain(execution, 'destination'));
    }
    
    await Promise.all(promises);
    console.log(`Redemption completed for swap ${execution.orderId}`);
  }

  /**
   * Redeem from a specific chain
   */
  private async redeemFromChain(execution: SwapExecution, side: 'source' | 'destination'): Promise<void> {
    const order = execution.order;
    const chainId = side === 'source' ? order.sourceChain.chainId : order.destinationChain.chainId;
    
    if (this.isBitcoinChain(chainId)) {
      await this.redeemBitcoinHTLC(execution, side);
    } else {
      await this.redeemEthereumEscrow(execution, side);
    }
  }

  /**
   * Redeem Bitcoin HTLC with secret
   */
  private async redeemBitcoinHTLC(execution: SwapExecution, side: 'source' | 'destination'): Promise<void> {
    try {
      const fundingTx = side === 'source' ? 
        execution.transactions.sourceFunding : 
        execution.transactions.destinationFunding;
      
      if (!fundingTx) {
        throw new Error(`No funding transaction found for ${side}`);
      }
      
      // Mock HTLC redemption - in production would use actual Bitcoin client
      console.log(`Redeeming Bitcoin HTLC for ${side} from tx ${fundingTx.txHash}`);
      
      const redeemTx: ExecutedTransaction = {
        chainId: fundingTx.chainId,
        txHash: `redeem_${fundingTx.txHash}`,
        confirmations: this.config.bitcoin.confirmations,
        requiredConfirmations: this.config.bitcoin.confirmations,
        status: 'confirmed',
        fee: '1000', // Mock fee in satoshis
        timestamp: Math.floor(Date.now() / 1000),
        retryCount: 0
      };
      
      if (side === 'source') {
        execution.transactions.sourceRedeem = redeemTx;
      } else {
        execution.transactions.destinationRedeem = redeemTx;
      }
      
      this.emit('transactionSubmitted', execution, redeemTx);
      this.emit('transactionConfirmed', execution, redeemTx);
      
    } catch (error) {
      throw new Error(`Failed to redeem Bitcoin HTLC on ${side}: ${(error as Error).message}`);
    }
  }

  /**
   * Redeem Ethereum escrow with secret
   */
  private async redeemEthereumEscrow(execution: SwapExecution, side: 'source' | 'destination'): Promise<void> {
    const fundingTx = side === 'source' ? 
      execution.transactions.sourceFunding : 
      execution.transactions.destinationFunding;
    
    if (!fundingTx) {
      throw new Error(`No funding transaction found for ${side}`);
    }
    
    console.log(`Redeeming Ethereum escrow for ${side} from tx ${fundingTx.txHash}`);
    
    // Mock escrow redemption
    const redeemTx: ExecutedTransaction = {
      chainId: fundingTx.chainId,
      txHash: `0x${Math.random().toString(16).substring(2)}`,
      confirmations: this.config.ethereum.confirmations,
      requiredConfirmations: this.config.ethereum.confirmations,
      status: 'confirmed',
      fee: this.config.ethereum.gasPrice.standard,
      timestamp: Math.floor(Date.now() / 1000),
      retryCount: 0
    };
    
    if (side === 'source') {
      execution.transactions.sourceRedeem = redeemTx;
    } else {
      execution.transactions.destinationRedeem = redeemTx;
    }
    
    this.emit('transactionSubmitted', execution, redeemTx);
    this.emit('transactionConfirmed', execution, redeemTx);
  }

  /**
   * Complete execution and cleanup
   */
  private async completeExecution(execution: SwapExecution): Promise<void> {
    execution.status = 'completed';
    execution.lastActivity = Math.floor(Date.now() / 1000);
    
    // Consume liquidity reservation
    if (execution.reservationId) {
      try {
        await this.liquidityManager.consumeLiquidity(execution.reservationId);
      } catch (error) {
        console.warn('Error consuming liquidity reservation:', error);
      }
    }
    
    // Update metrics
    this.metrics.completedExecutions++;
    this.updateMetrics();
    
    // Remove from active executions
    this.activeExecutions.delete(execution.orderId);
    
    this.emit('executionCompleted', execution);
    
    console.log(`Swap execution completed for order ${execution.orderId}`);
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForTransactionConfirmation(
    execution: SwapExecution,
    tx: ExecutedTransaction
  ): Promise<void> {
    console.log(`Waiting for confirmation of tx ${tx.txHash} (${tx.confirmations}/${tx.requiredConfirmations})`);
    
    const startTime = Date.now();
    const timeout = this.config.execution.transactionTimeout;
    
    while (tx.confirmations < tx.requiredConfirmations && 
           (Date.now() - startTime) < timeout &&
           !this.isShuttingDown) {
      
      await new Promise(resolve => setTimeout(resolve, this.config.monitoring.pollInterval));
      
      // Update confirmation count (mock for this implementation)
      tx.confirmations++;
      
      if (tx.confirmations >= tx.requiredConfirmations) {
        tx.status = 'confirmed';
        this.emit('transactionConfirmed', execution, tx);
        break;
      }
    }
    
    if (tx.status !== 'confirmed') {
      throw new Error(`Transaction ${tx.txHash} failed to confirm within timeout`);
    }
  }

  /**
   * Handle execution error
   */
  private handleExecutionError(execution: SwapExecution, error: Error, context: string): void {
    const executionError: ExecutionError = {
      timestamp: Math.floor(Date.now() / 1000),
      error: error.message,
      context,
      recoverable: this.isRecoverableError(error),
      retryAfter: this.calculateRetryDelay(execution.retryCount)
    };
    
    execution.errors.push(executionError);
    execution.lastActivity = Math.floor(Date.now() / 1000);
    
    this.emit('executionFailed', execution, executionError);
    
    if (executionError.recoverable && execution.retryCount < this.config.execution.maxRetries) {
      // Schedule retry
      execution.retryCount++;
      this.emit('retryAttempt', execution, execution.retryCount);
      
      setTimeout(() => {
        this.processSwapExecution(execution);
      }, executionError.retryAfter!);
      
    } else {
      // Permanent failure
      execution.status = 'failed';
      this.metrics.failedExecutions++;
      
      // Release liquidity reservation
      if (execution.reservationId) {
        this.liquidityManager.releaseLiquidity(execution.reservationId);
      }
      
      this.activeExecutions.delete(execution.orderId);
      this.updateMetrics();
    }
  }

  /**
   * Start transaction monitoring
   */
  private startTransactionMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      this.monitorActiveTransactions();
    }, this.config.monitoring.pollInterval);
  }

  /**
   * Monitor active transactions for confirmations
   */
  private async monitorActiveTransactions(): Promise<void> {
    for (const execution of this.activeExecutions.values()) {
      try {
        await this.updateTransactionStatuses(execution);
      } catch (error) {
        console.error(`Error monitoring transactions for ${execution.orderId}:`, error);
      }
    }
  }

  /**
   * Update transaction statuses
   */
  private async updateTransactionStatuses(execution: SwapExecution): Promise<void> {
    const txs = Object.values(execution.transactions);
    
    for (const tx of txs) {
      if (tx && tx.status === 'pending') {
        // In production, this would query the actual blockchain
        // For now, we'll mock the confirmation process
        if (this.isBitcoinChain(tx.chainId)) {
          // Mock Bitcoin confirmation check
          if (Math.random() > 0.3) { // 70% chance of getting another confirmation
            tx.confirmations = Math.min(tx.confirmations + 1, tx.requiredConfirmations);
          }
        } else {
          // Mock Ethereum confirmation check  
          tx.confirmations = tx.requiredConfirmations; // Immediate confirmation for mock
        }
        
        if (tx.confirmations >= tx.requiredConfirmations) {
          tx.status = 'confirmed';
          this.emit('transactionConfirmed', execution, tx);
        }
      }
    }
  }

  /**
   * Get execution metrics
   */
  getMetrics(): SwapExecutorMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): SwapExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get execution by order ID
   */
  getExecution(orderId: string): SwapExecution | null {
    return this.activeExecutions.get(orderId) || null;
  }

  /**
   * Cancel execution
   */
  async cancelExecution(orderId: string): Promise<void> {
    const execution = this.activeExecutions.get(orderId);
    if (!execution) {
      throw new SwapError('Execution not found', SwapErrorCode.INVALID_ORDER, orderId);
    }
    
    execution.status = 'failed';
    
    // Release liquidity reservation
    if (execution.reservationId) {
      await this.liquidityManager.releaseLiquidity(execution.reservationId);
    }
    
    this.activeExecutions.delete(orderId);
    console.log(`Cancelled execution for order ${orderId}`);
  }

  /**
   * Helper methods
   */
  private isBitcoinChain(chainId: ChainId): boolean {
    return [
      SUPPORTED_CHAINS.BITCOIN_MAINNET,
      SUPPORTED_CHAINS.BITCOIN_TESTNET,
      SUPPORTED_CHAINS.BITCOIN_REGTEST
    ].includes(chainId as any);
  }

  private isRecoverableError(error: Error): boolean {
    const recoverableErrors = [
      'network error',
      'timeout',
      'insufficient gas',
      'nonce too low',
      'replacement transaction underpriced'
    ];
    
    return recoverableErrors.some(errorType => 
      error.message.toLowerCase().includes(errorType)
    );
  }

  private calculateRetryDelay(retryCount: number): number {
    return this.config.execution.retryDelay * 
           Math.pow(this.config.execution.retryBackoff, retryCount);
  }

  private updateMetrics(): void {
    this.metrics.activeExecutions = this.activeExecutions.size;
    this.metrics.successRate = this.metrics.totalExecutions > 0 
      ? (this.metrics.completedExecutions / this.metrics.totalExecutions) * 100
      : 0;
    
    // Calculate average execution time (simplified)
    if (this.metrics.completedExecutions > 0) {
      this.metrics.averageExecutionTime = 180; // Mock 3 minutes average
    }
  }
}

export default SwapExecutor;