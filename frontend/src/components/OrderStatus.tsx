import React, { useState, useEffect, useMemo } from 'react';
import { useSwap } from '../context/SwapContext';
import {
  CrossChainSwapState,
  SwapStatus,
  SwapEvent,
  TransactionInfo,
  SUPPORTED_CHAINS
} from '../types';

interface OrderStatusProps {
  orderId?: string;
  className?: string;
}

// Status step configuration
const STATUS_STEPS = [
  { status: SwapStatus.CREATED, label: 'Order Created', description: 'Swap order has been created' },
  { status: SwapStatus.AUCTION_STARTED, label: 'Auction Started', description: 'Dutch auction for resolvers' },
  { status: SwapStatus.RESOLVER_SELECTED, label: 'Resolver Selected', description: 'Best resolver has been chosen' },
  { status: SwapStatus.SOURCE_FUNDED, label: 'Source Funded', description: 'Ethereum escrow funded' },
  { status: SwapStatus.DESTINATION_FUNDED, label: 'Destination Funded', description: 'Bitcoin HTLC created' },
  { status: SwapStatus.BOTH_FUNDED, label: 'Both Funded', description: 'Both sides of swap are funded' },
  { status: SwapStatus.SECRET_REVEALED, label: 'Secret Revealed', description: 'Secret hash revealed for redemption' },
  { status: SwapStatus.COMPLETED, label: 'Completed', description: 'Swap successfully completed' }
];

const FINAL_STATUSES = [SwapStatus.COMPLETED, SwapStatus.FAILED, SwapStatus.REFUNDED, SwapStatus.EXPIRED];

export function OrderStatus({ orderId, className = '' }: OrderStatusProps) {
  const { activeSwaps, swapHistory, subscribeToSwapUpdates } = useSwap();
  const [selectedOrder, setSelectedOrder] = useState<CrossChainSwapState | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<SwapEvent[]>([]);

  // Find the order to display
  const swapOrder = useMemo(() => {
    const allSwaps = [...activeSwaps, ...swapHistory];
    if (orderId) {
      return allSwaps.find(swap => swap.orderId === orderId) || null;
    }
    return selectedOrder;
  }, [orderId, activeSwaps, swapHistory, selectedOrder]);

  // Subscribe to real-time updates for the selected order
  useEffect(() => {
    if (swapOrder?.orderId) {
      const unsubscribe = subscribeToSwapUpdates(swapOrder.orderId);
      return unsubscribe;
    }
  }, [swapOrder?.orderId, subscribeToSwapUpdates]);

  // Calculate progress percentage
  const progressPercentage = useMemo(() => {
    if (!swapOrder) return 0;
    
    const currentStepIndex = STATUS_STEPS.findIndex(step => step.status === swapOrder.status);
    if (currentStepIndex === -1) return 0;
    
    return Math.round(((currentStepIndex + 1) / STATUS_STEPS.length) * 100);
  }, [swapOrder?.status]);

  // Get current step info
  const currentStep = useMemo(() => {
    if (!swapOrder) return null;
    return STATUS_STEPS.find(step => step.status === swapOrder.status);
  }, [swapOrder?.status]);

  // Format time remaining
  const formatTimeRemaining = (timestamp: number): string => {
    const now = Date.now() / 1000;
    const remaining = timestamp - now;
    
    if (remaining <= 0) return 'Expired';
    
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    return `${minutes}m remaining`;
  };

  // Format transaction hash for display
  const formatTxHash = (txHash: string): string => {
    return `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;
  };

  // Get block explorer URL
  const getExplorerUrl = (txHash: string, chainId: number): string => {
    if (chainId === SUPPORTED_CHAINS.ETHEREUM_SEPOLIA) {
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    } else if (chainId === SUPPORTED_CHAINS.BITCOIN_TESTNET) {
      return `https://blockstream.info/testnet/tx/${txHash}`;
    }
    return '#';
  };

  const renderTransactionStatus = (tx: TransactionInfo | undefined, chainType: 'ethereum' | 'bitcoin') => {
    if (!tx) {
      return (
        <div className="tx-status pending">
          <span className="status-indicator pending"></span>
          <span>Waiting for transaction...</span>
        </div>
      );
    }

    const explorerUrl = getExplorerUrl(tx.txid, chainType === 'ethereum' ? SUPPORTED_CHAINS.ETHEREUM_SEPOLIA : SUPPORTED_CHAINS.BITCOIN_TESTNET);

    return (
      <div className={`tx-status ${tx.status}`}>
        <span className={`status-indicator ${tx.status}`}></span>
        <div className="tx-details">
          <a 
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-hash"
          >
            {formatTxHash(tx.txid)}
          </a>
          <div className="tx-meta">
            <span>Confirmations: {tx.confirmations}</span>
            <span>Fee: {tx.fee}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderProgressSteps = () => {
    if (!swapOrder) return null;

    return (
      <div className="progress-steps">
        <div className="progress-header">
          <h3>Swap Progress</h3>
          <div className="progress-percentage">{progressPercentage}%</div>
        </div>
        
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>

        <div className="steps-list">
          {STATUS_STEPS.map((step, index) => {
            const isCompleted = STATUS_STEPS.findIndex(s => s.status === swapOrder.status) >= index;
            const isCurrent = step.status === swapOrder.status;
            
            return (
              <div 
                key={step.status}
                className={`step ${isCompleted ? 'completed' : 'pending'} ${isCurrent ? 'current' : ''}`}
              >
                <div className="step-indicator">
                  {isCompleted ? '✓' : index + 1}
                </div>
                <div className="step-content">
                  <div className="step-label">{step.label}</div>
                  <div className="step-description">{step.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSwapDetails = () => {
    if (!swapOrder) return null;

    const isExpired = swapOrder.timelocks.source < Date.now() / 1000;
    const isFinalStatus = FINAL_STATUSES.includes(swapOrder.status);

    return (
      <div className="swap-details">
        <div className="details-header">
          <h3>Swap Details</h3>
          <div className={`status-badge ${swapOrder.status}`}>
            {swapOrder.status.replace('_', ' ').toUpperCase()}
          </div>
        </div>

        <div className="details-grid">
          <div className="detail-section">
            <h4>Order Information</h4>
            <div className="detail-row">
              <span>Order ID:</span>
              <span className="order-id">{swapOrder.orderId}</span>
            </div>
            <div className="detail-row">
              <span>Created:</span>
              <span>{new Date(swapOrder.createdAt).toLocaleString()}</span>
            </div>
            <div className="detail-row">
              <span>Maker:</span>
              <span className="address">{swapOrder.maker}</span>
            </div>
            {swapOrder.resolver && (
              <div className="detail-row">
                <span>Resolver:</span>
                <span className="address">{swapOrder.resolver}</span>
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4>Amounts</h4>
            <div className="detail-row">
              <span>From (ETH):</span>
              <span>{swapOrder.amounts.source} ETH</span>
            </div>
            <div className="detail-row">
              <span>To (BTC):</span>
              <span>{swapOrder.amounts.destination} BTC</span>
            </div>
          </div>

          <div className="detail-section">
            <h4>Timelock Information</h4>
            <div className="detail-row">
              <span>Source Timelock:</span>
              <span className={isExpired ? 'expired' : ''}>
                {formatTimeRemaining(swapOrder.timelocks.source)}
              </span>
            </div>
            <div className="detail-row">
              <span>Destination Timelock:</span>
              <span>{formatTimeRemaining(swapOrder.timelocks.destination)}</span>
            </div>
          </div>
        </div>

        {/* Transaction Status */}
        <div className="transactions-section">
          <h4>Transactions</h4>
          
          <div className="chain-transactions">
            <div className="chain-section ethereum">
              <h5>Ethereum (Sepolia)</h5>
              <div className="transaction-group">
                <div className="tx-label">Source Funding:</div>
                {renderTransactionStatus(swapOrder.transactions.sourceFunding, 'ethereum')}
              </div>
              <div className="transaction-group">
                <div className="tx-label">Source Redeem:</div>
                {renderTransactionStatus(swapOrder.transactions.sourceRedeem, 'ethereum')}
              </div>
            </div>

            <div className="chain-section bitcoin">
              <h5>Bitcoin (Testnet)</h5>
              <div className="transaction-group">
                <div className="tx-label">HTLC Creation:</div>
                {renderTransactionStatus(swapOrder.transactions.destinationFunding, 'bitcoin')}
              </div>
              <div className="transaction-group">
                <div className="tx-label">HTLC Redeem:</div>
                {renderTransactionStatus(swapOrder.transactions.destinationRedeem, 'bitcoin')}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOrderSelector = () => {
    const allOrders = [...activeSwaps, ...swapHistory];
    
    if (allOrders.length === 0) {
      return (
        <div className="no-orders">
          <p>No swap orders found.</p>
          <p>Create your first swap to start monitoring.</p>
        </div>
      );
    }

    return (
      <div className="order-selector">
        <h3>Your Swaps</h3>
        <div className="orders-list">
          {allOrders.map((order) => (
            <div
              key={order.orderId}
              onClick={() => setSelectedOrder(order)}
              className={`order-item ${selectedOrder?.orderId === order.orderId ? 'selected' : ''}`}
            >
              <div className="order-summary">
                <div className="order-id-short">
                  {order.orderId.slice(0, 8)}...
                </div>
                <div className="order-amounts">
                  {order.amounts.source} ETH → {order.amounts.destination} BTC
                </div>
                <div className={`order-status ${order.status}`}>
                  {order.status.replace('_', ' ')}
                </div>
              </div>
              <div className="order-timestamp">
                {new Date(order.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`order-status ${className}`}>
      <div className="order-status-header">
        <h2>Swap Status</h2>
        {swapOrder && (
          <div className="current-order-info">
            Order: {swapOrder.orderId.slice(0, 12)}...
          </div>
        )}
      </div>

      <div className="order-status-content">
        {!swapOrder && !orderId && renderOrderSelector()}
        
        {swapOrder && (
          <>
            {renderProgressSteps()}
            {renderSwapDetails()}
          </>
        )}

        {orderId && !swapOrder && (
          <div className="order-not-found">
            <p>Order not found: {orderId}</p>
            <p>Please check the order ID and try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default OrderStatus;