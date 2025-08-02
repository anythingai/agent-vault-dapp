import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import {
  SwapOrder,
  CrossChainSwapState,
  SwapStatus,
  SwapEvent,
  SwapFormData,
  WalletState,
  ResolverInfo,
  SwapError,
  SwapErrorCode
} from '../types';
import { apiService } from '../services/api';

interface SwapState {
  // Wallet state
  wallet: WalletState;
  
  // Current swap form
  swapForm: SwapFormData;
  
  // Active swaps
  activeSwaps: CrossChainSwapState[];
  
  // Swap history
  swapHistory: CrossChainSwapState[];
  
  // Available resolvers
  resolvers: ResolverInfo[];
  
  // Loading states
  isLoadingSwaps: boolean;
  isLoadingResolvers: boolean;
  isCreatingOrder: boolean;
  
  // Error states
  error: SwapError | null;
  
  // WebSocket connection status
  wsConnected: boolean;
}

type SwapAction =
  | { type: 'SET_WALLET_STATE'; payload: WalletState }
  | { type: 'UPDATE_SWAP_FORM'; payload: Partial<SwapFormData> }
  | { type: 'RESET_SWAP_FORM' }
  | { type: 'SET_ACTIVE_SWAPS'; payload: CrossChainSwapState[] }
  | { type: 'UPDATE_SWAP_STATE'; payload: CrossChainSwapState }
  | { type: 'ADD_SWAP'; payload: CrossChainSwapState }
  | { type: 'SET_SWAP_HISTORY'; payload: CrossChainSwapState[] }
  | { type: 'SET_RESOLVERS'; payload: ResolverInfo[] }
  | { type: 'SET_LOADING_SWAPS'; payload: boolean }
  | { type: 'SET_LOADING_RESOLVERS'; payload: boolean }
  | { type: 'SET_CREATING_ORDER'; payload: boolean }
  | { type: 'SET_ERROR'; payload: SwapError | null }
  | { type: 'SET_WS_CONNECTED'; payload: boolean }
  | { type: 'CLEAR_ERROR' };

const initialSwapForm: SwapFormData = {
  fromToken: '0x0000000000000000000000000000000000000000', // ETH
  toToken: 'BTC',
  fromAmount: '',
  toAmount: '',
  fromChain: 11155111, // Sepolia
  toChain: 101, // Bitcoin testnet
  bitcoinAddress: '',
  slippage: 0.5
};

const initialState: SwapState = {
  wallet: {
    isConnected: false,
    isConnecting: false
  },
  swapForm: initialSwapForm,
  activeSwaps: [],
  swapHistory: [],
  resolvers: [],
  isLoadingSwaps: false,
  isLoadingResolvers: false,
  isCreatingOrder: false,
  error: null,
  wsConnected: false
};

function swapReducer(state: SwapState, action: SwapAction): SwapState {
  switch (action.type) {
    case 'SET_WALLET_STATE':
      return {
        ...state,
        wallet: action.payload
      };

    case 'UPDATE_SWAP_FORM':
      return {
        ...state,
        swapForm: {
          ...state.swapForm,
          ...action.payload
        }
      };

    case 'RESET_SWAP_FORM':
      return {
        ...state,
        swapForm: initialSwapForm
      };

    case 'SET_ACTIVE_SWAPS':
      return {
        ...state,
        activeSwaps: action.payload
      };

    case 'UPDATE_SWAP_STATE':
      return {
        ...state,
        activeSwaps: state.activeSwaps.map(swap =>
          swap.orderId === action.payload.orderId ? action.payload : swap
        ),
        swapHistory: state.swapHistory.map(swap =>
          swap.orderId === action.payload.orderId ? action.payload : swap
        )
      };

    case 'ADD_SWAP':
      return {
        ...state,
        activeSwaps: [action.payload, ...state.activeSwaps]
      };

    case 'SET_SWAP_HISTORY':
      return {
        ...state,
        swapHistory: action.payload
      };

    case 'SET_RESOLVERS':
      return {
        ...state,
        resolvers: action.payload
      };

    case 'SET_LOADING_SWAPS':
      return {
        ...state,
        isLoadingSwaps: action.payload
      };

    case 'SET_LOADING_RESOLVERS':
      return {
        ...state,
        isLoadingResolvers: action.payload
      };

    case 'SET_CREATING_ORDER':
      return {
        ...state,
        isCreatingOrder: action.payload
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload
      };

    case 'SET_WS_CONNECTED':
      return {
        ...state,
        wsConnected: action.payload
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null
      };

    default:
      return state;
  }
}

interface SwapContextValue extends SwapState {
  // Actions
  updateWalletState: (wallet: WalletState) => void;
  updateSwapForm: (data: Partial<SwapFormData>) => void;
  resetSwapForm: () => void;
  createSwapOrder: (orderData: Partial<SwapOrder>) => Promise<SwapOrder>;
  loadUserSwaps: (address: string) => Promise<void>;
  loadResolvers: () => Promise<void>;
  subscribeToSwapUpdates: (orderId: string) => () => void;
  clearError: () => void;
  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => void;
}

const SwapContext = createContext<SwapContextValue | undefined>(undefined);

export function SwapProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(swapReducer, initialState);

  // Actions
  const updateWalletState = (wallet: WalletState) => {
    dispatch({ type: 'SET_WALLET_STATE', payload: wallet });
  };

  const updateSwapForm = (data: Partial<SwapFormData>) => {
    dispatch({ type: 'UPDATE_SWAP_FORM', payload: data });
  };

  const resetSwapForm = () => {
    dispatch({ type: 'RESET_SWAP_FORM' });
  };

  const createSwapOrder = async (orderData: Partial<SwapOrder>): Promise<SwapOrder> => {
    try {
      dispatch({ type: 'SET_CREATING_ORDER', payload: true });
      dispatch({ type: 'CLEAR_ERROR' });

      const order = await apiService.createOrder(orderData);
      
      // Convert to CrossChainSwapState format and add to active swaps
      const swapState: CrossChainSwapState = {
        orderId: order.orderId,
        status: SwapStatus.CREATED,
        sourceChain: {
          chainId: orderData.makerAsset?.chainId || state.swapForm.fromChain,
          name: 'Ethereum Sepolia',
          type: 'ethereum',
          rpcUrl: '',
          confirmations: 1
        },
        destinationChain: {
          chainId: orderData.takerAsset?.chainId || state.swapForm.toChain,
          name: 'Bitcoin Testnet',
          type: 'bitcoin',
          rpcUrl: '',
          confirmations: 1
        },
        maker: order.maker,
        secretHash: order.secretHash,
        amounts: {
          source: order.makerAsset.amount,
          destination: order.takerAsset.amount
        },
        addresses: {},
        transactions: {},
        timelocks: {
          source: order.timelock,
          destination: order.timelock - 3600
        },
        createdAt: order.createdAt,
        updatedAt: Date.now()
      };

      dispatch({ type: 'ADD_SWAP', payload: swapState });
      return order;
    } catch (error) {
      const swapError = error instanceof SwapError 
        ? error 
        : new SwapError('Failed to create swap order', SwapErrorCode.NETWORK_ERROR);
      dispatch({ type: 'SET_ERROR', payload: swapError });
      throw swapError;
    } finally {
      dispatch({ type: 'SET_CREATING_ORDER', payload: false });
    }
  };

  const loadUserSwaps = async (address: string) => {
    try {
      dispatch({ type: 'SET_LOADING_SWAPS', payload: true });
      dispatch({ type: 'CLEAR_ERROR' });

      const swaps = await apiService.getUserOrders(address);
      
      // Separate active and completed swaps
      const activeSwaps = swaps.filter(swap => 
        ![SwapStatus.COMPLETED, SwapStatus.FAILED, SwapStatus.REFUNDED, SwapStatus.EXPIRED]
          .includes(swap.status)
      );
      
      const completedSwaps = swaps.filter(swap => 
        [SwapStatus.COMPLETED, SwapStatus.FAILED, SwapStatus.REFUNDED, SwapStatus.EXPIRED]
          .includes(swap.status)
      );

      dispatch({ type: 'SET_ACTIVE_SWAPS', payload: activeSwaps });
      dispatch({ type: 'SET_SWAP_HISTORY', payload: completedSwaps });
    } catch (error) {
      const swapError = error instanceof SwapError 
        ? error 
        : new SwapError('Failed to load user swaps', SwapErrorCode.NETWORK_ERROR);
      dispatch({ type: 'SET_ERROR', payload: swapError });
    } finally {
      dispatch({ type: 'SET_LOADING_SWAPS', payload: false });
    }
  };

  const loadResolvers = async () => {
    try {
      dispatch({ type: 'SET_LOADING_RESOLVERS', payload: true });
      dispatch({ type: 'CLEAR_ERROR' });

      const resolvers = await apiService.getActiveResolvers();
      dispatch({ type: 'SET_RESOLVERS', payload: resolvers });
    } catch (error) {
      const swapError = error instanceof SwapError 
        ? error 
        : new SwapError('Failed to load resolvers', SwapErrorCode.NETWORK_ERROR);
      dispatch({ type: 'SET_ERROR', payload: swapError });
    } finally {
      dispatch({ type: 'SET_LOADING_RESOLVERS', payload: false });
    }
  };

  const subscribeToSwapUpdates = (orderId: string) => {
    return apiService.subscribeToSwapEvents(orderId, (event: SwapEvent) => {
      // Update swap state based on the event
      const currentSwap = [...state.activeSwaps, ...state.swapHistory]
        .find(swap => swap.orderId === orderId);

      if (currentSwap) {
        const updatedSwap: CrossChainSwapState = {
          ...currentSwap,
          status: mapEventTypeToStatus(event.type),
          updatedAt: event.timestamp
        };

        // Update additional fields based on event data
        if (event.data) {
          if (event.data.resolver) {
            updatedSwap.resolver = event.data.resolver;
          }
          if (event.data.txHash) {
            // Update transaction info based on event type
            // This would need more specific logic based on event types
          }
        }

        dispatch({ type: 'UPDATE_SWAP_STATE', payload: updatedSwap });
      }
    });
  };

  const connectWebSocket = async () => {
    try {
      await apiService.connectWebSocket();
      dispatch({ type: 'SET_WS_CONNECTED', payload: true });
    } catch (error) {
      dispatch({ type: 'SET_WS_CONNECTED', payload: false });
      const swapError = new SwapError(
        'Failed to connect to real-time updates',
        SwapErrorCode.NETWORK_ERROR
      );
      dispatch({ type: 'SET_ERROR', payload: swapError });
    }
  };

  const disconnectWebSocket = () => {
    apiService.disconnectWebSocket();
    dispatch({ type: 'SET_WS_CONNECTED', payload: false });
  };

  const clearError = () => {
    dispatch({ type: 'CLEAR_ERROR' });
  };

  // Effect for WebSocket connection
  useEffect(() => {
    if (state.wallet.isConnected) {
      connectWebSocket();
      
      return () => {
        disconnectWebSocket();
      };
    }
  }, [state.wallet.isConnected]);

  // Effect for loading user data when wallet connects
  useEffect(() => {
    if (state.wallet.isConnected && state.wallet.address) {
      loadUserSwaps(state.wallet.address);
    }
  }, [state.wallet.isConnected, state.wallet.address]);

  // Effect for loading resolvers on mount
  useEffect(() => {
    loadResolvers();
  }, []);

  const contextValue: SwapContextValue = {
    ...state,
    updateWalletState,
    updateSwapForm,
    resetSwapForm,
    createSwapOrder,
    loadUserSwaps,
    loadResolvers,
    subscribeToSwapUpdates,
    clearError,
    connectWebSocket,
    disconnectWebSocket
  };

  return (
    <SwapContext.Provider value={contextValue}>
      {children}
    </SwapContext.Provider>
  );
}

export function useSwap() {
  const context = useContext(SwapContext);
  if (!context) {
    throw new Error('useSwap must be used within a SwapProvider');
  }
  return context;
}

// Helper function to map event types to swap status
function mapEventTypeToStatus(eventType: string): SwapStatus {
  switch (eventType) {
    case 'order_created':
      return SwapStatus.CREATED;
    case 'auction_started':
      return SwapStatus.AUCTION_STARTED;
    case 'resolver_selected':
      return SwapStatus.RESOLVER_SELECTED;
    case 'funds_deposited':
      return SwapStatus.SOURCE_FUNDED;
    case 'secret_revealed':
      return SwapStatus.SECRET_REVEALED;
    case 'swap_completed':
      return SwapStatus.COMPLETED;
    case 'swap_refunded':
      return SwapStatus.REFUNDED;
    case 'swap_expired':
      return SwapStatus.EXPIRED;
    default:
      return SwapStatus.CREATED;
  }
}

export default SwapContext;