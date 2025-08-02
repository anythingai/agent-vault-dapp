import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { useSwap } from '../context/SwapContext';
import { WalletConnect } from './WalletConnect';
import { BitcoinAddress } from './BitcoinAddress';
import {
  SwapFormData,
  TokenInfo,
  SUPPORTED_CHAINS,
  NATIVE_TOKEN_ADDRESS,
  MINIMUM_AMOUNTS,
  SwapError,
  SwapErrorCode
} from '../types';

interface SwapFormProps {
  className?: string;
}

// Supported tokens
const SUPPORTED_TOKENS: TokenInfo[] = [
  {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    logoUrl: '/images/eth-logo.svg',
    chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
  },
  {
    address: '0x326C977E6efc84E512bB9C30f76E30c160eD06FB', // LINK on Sepolia
    symbol: 'LINK',
    name: 'Chainlink',
    decimals: 18,
    logoUrl: '/images/link-logo.svg',
    chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
  },
  {
    address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI (example)
    symbol: 'UNI',
    name: 'Uniswap',
    decimals: 18,
    logoUrl: '/images/uni-logo.svg',
    chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
  }
];

const BTC_TOKEN: TokenInfo = {
  address: 'BTC',
  symbol: 'BTC',
  name: 'Bitcoin',
  decimals: 8,
  logoUrl: '/images/btc-logo.svg',
  chainId: SUPPORTED_CHAINS.BITCOIN_TESTNET
};

export function SwapForm({ className = '' }: SwapFormProps) {
  const {
    wallet,
    swapForm,
    updateSwapForm,
    resetSwapForm,
    createSwapOrder,
    isCreatingOrder,
    error,
    clearError
  } = useSwap();

  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load token balances when wallet connects
  useEffect(() => {
    if (wallet.isConnected && wallet.address) {
      loadTokenBalances();
    }
  }, [wallet.isConnected, wallet.address]);

  // Estimate fees when swap parameters change
  useEffect(() => {
    if (swapForm.fromAmount && swapForm.fromToken && swapForm.toToken) {
      estimateSwapCost();
    }
  }, [swapForm.fromAmount, swapForm.fromToken, swapForm.toToken]);

  const loadTokenBalances = async () => {
    if (!wallet.address || !window.ethereum) return;

    setIsLoadingBalances(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const balances: Record<string, string> = {};

      // Get ETH balance
      const ethBalance = await provider.getBalance(wallet.address);
      balances[NATIVE_TOKEN_ADDRESS] = ethers.formatEther(ethBalance);

      // Get ERC-20 token balances
      for (const token of SUPPORTED_TOKENS) {
        if (token.address !== NATIVE_TOKEN_ADDRESS) {
          try {
            const contract = new ethers.Contract(
              token.address,
              ['function balanceOf(address owner) view returns (uint256)'],
              provider
            );
            const balance = await contract.balanceOf(wallet.address);
            balances[token.address] = ethers.formatUnits(balance, token.decimals);
          } catch (error) {
            console.warn(`Failed to get balance for ${token.symbol}:`, error);
            balances[token.address] = '0';
          }
        }
      }

      setTokenBalances(balances);
    } catch (error) {
      console.error('Failed to load token balances:', error);
    } finally {
      setIsLoadingBalances(false);
    }
  };

  const estimateSwapCost = async () => {
    // Mock estimation - in real app, this would call the API
    setTimeout(() => {
      const amount = parseFloat(swapForm.fromAmount);
      if (amount > 0) {
        setEstimatedFee('0.002 ETH');
        setEstimatedTime('10-15 minutes');
      }
    }, 500);
  };

  const selectedFromToken = useMemo(() => {
    return SUPPORTED_TOKENS.find(token => token.address === swapForm.fromToken);
  }, [swapForm.fromToken]);

  const selectedToToken = useMemo(() => {
    return swapForm.toToken === 'BTC' ? BTC_TOKEN : null;
  }, [swapForm.toToken]);

  const maxFromAmount = useMemo(() => {
    if (!selectedFromToken) return '0';
    const balance = tokenBalances[selectedFromToken.address];
    if (!balance) return '0';
    
    // Reserve gas for transaction
    if (selectedFromToken.address === NATIVE_TOKEN_ADDRESS) {
      const reserveAmount = 0.01; // Reserve 0.01 ETH for gas
      const maxAmount = Math.max(0, parseFloat(balance) - reserveAmount);
      return maxAmount.toString();
    }
    
    return balance;
  }, [selectedFromToken, tokenBalances]);

  const isValidAmount = useMemo(() => {
    const amount = parseFloat(swapForm.fromAmount);
    const maxAmount = parseFloat(maxFromAmount);
    const minAmount = selectedFromToken?.symbol === 'ETH' 
      ? parseFloat(MINIMUM_AMOUNTS.ETH)
      : 0.0001;

    return amount > 0 && amount >= minAmount && amount <= maxAmount;
  }, [swapForm.fromAmount, maxFromAmount, selectedFromToken]);

  const canCreateSwap = useMemo(() => {
    return (
      wallet.isConnected &&
      swapForm.fromToken &&
      swapForm.toToken &&
      swapForm.fromAmount &&
      swapForm.bitcoinAddress &&
      isValidAmount &&
      !isCreatingOrder
    );
  }, [wallet.isConnected, swapForm, isValidAmount, isCreatingOrder]);

  const handleFromTokenChange = (tokenAddress: string) => {
    updateSwapForm({ fromToken: tokenAddress });
    clearError();
  };

  const handleFromAmountChange = (amount: string) => {
    // Validate numeric input
    if (amount === '' || /^\d*\.?\d*$/.test(amount)) {
      updateSwapForm({ fromAmount: amount });
      clearError();
    }
  };

  const handleMaxClick = () => {
    handleFromAmountChange(maxFromAmount);
  };

  const handleSlippageChange = (slippage: number) => {
    updateSwapForm({ slippage });
  };

  const handleCreateSwap = async () => {
    if (!canCreateSwap) return;

    try {
      clearError();
      
      const secretHash = ethers.keccak256(ethers.randomBytes(32));
      const timelock = Math.floor(Date.now() / 1000) + (2 * 3600); // 2 hours from now

      const orderData = {
        maker: wallet.address!,
        makerAsset: {
          chainId: swapForm.fromChain,
          token: swapForm.fromToken,
          amount: ethers.parseUnits(
            swapForm.fromAmount,
            selectedFromToken?.decimals || 18
          ).toString()
        },
        takerAsset: {
          chainId: swapForm.toChain,
          token: swapForm.toToken,
          amount: ethers.parseUnits(
            swapForm.toAmount || swapForm.fromAmount, // Mock 1:1 conversion
            BTC_TOKEN.decimals
          ).toString()
        },
        secretHash,
        timelock
      };

      const order = await createSwapOrder(orderData);
      console.log('Swap order created:', order);
      
      // Reset form after successful creation
      resetSwapForm();
    } catch (error) {
      console.error('Failed to create swap:', error);
    }
  };

  return (
    <div className={`swap-form ${className}`}>
      <div className="swap-form-header">
        <h2>Cross-Chain Swap</h2>
        <p>Swap between Ethereum and Bitcoin</p>
      </div>

      {!wallet.isConnected ? (
        <div className="connect-wallet-section">
          <WalletConnect />
        </div>
      ) : (
        <div className="swap-form-content">
          {/* From Section */}
          <div className="swap-section from-section">
            <div className="section-header">
              <label>From</label>
              <div className="balance">
                Balance: {tokenBalances[swapForm.fromToken] || '0'} {selectedFromToken?.symbol}
              </div>
            </div>
            
            <div className="token-input">
              <select
                value={swapForm.fromToken}
                onChange={(e) => handleFromTokenChange(e.target.value)}
                className="token-select"
              >
                {SUPPORTED_TOKENS.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol} - {token.name}
                  </option>
                ))}
              </select>

              <div className="amount-input">
                <input
                  type="text"
                  placeholder="0.0"
                  value={swapForm.fromAmount}
                  onChange={(e) => handleFromAmountChange(e.target.value)}
                  className={`amount-field ${!isValidAmount && swapForm.fromAmount ? 'invalid' : ''}`}
                />
                <button onClick={handleMaxClick} className="max-btn">
                  MAX
                </button>
              </div>
            </div>

            {!isValidAmount && swapForm.fromAmount && (
              <div className="input-error">
                {parseFloat(swapForm.fromAmount) > parseFloat(maxFromAmount)
                  ? 'Insufficient balance'
                  : 'Amount too small'
                }
              </div>
            )}
          </div>

          {/* Swap Arrow */}
          <div className="swap-arrow">
            <button className="swap-direction-btn" disabled>
              ↓
            </button>
          </div>

          {/* To Section */}
          <div className="swap-section to-section">
            <div className="section-header">
              <label>To</label>
            </div>
            
            <div className="token-input">
              <div className="token-display">
                <img src={BTC_TOKEN.logoUrl} alt="BTC" className="token-logo" />
                <span>BTC - Bitcoin</span>
              </div>

              <div className="amount-display">
                {swapForm.fromAmount || '0.0'}
              </div>
            </div>
          </div>

          {/* Bitcoin Address */}
          <div className="bitcoin-address-section">
            <label>Bitcoin Address</label>
            <BitcoinAddress
              value={swapForm.bitcoinAddress}
              onChange={(address) => updateSwapForm({ bitcoinAddress: address })}
            />
          </div>

          {/* Advanced Settings */}
          <div className="advanced-settings">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="advanced-toggle"
            >
              Advanced Settings {showAdvanced ? '−' : '+'}
            </button>

            {showAdvanced && (
              <div className="advanced-content">
                <div className="slippage-setting">
                  <label>Slippage Tolerance</label>
                  <div className="slippage-options">
                    {[0.1, 0.5, 1.0].map(value => (
                      <button
                        key={value}
                        onClick={() => handleSlippageChange(value)}
                        className={`slippage-btn ${swapForm.slippage === value ? 'active' : ''}`}
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Swap Details */}
          {estimatedFee && (
            <div className="swap-details">
              <div className="detail-row">
                <span>Estimated Fee:</span>
                <span>{estimatedFee}</span>
              </div>
              <div className="detail-row">
                <span>Estimated Time:</span>
                <span>{estimatedTime}</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="swap-error">
              {error.message}
            </div>
          )}

          {/* Swap Button */}
          <button
            onClick={handleCreateSwap}
            disabled={!canCreateSwap}
            className={`swap-btn ${canCreateSwap ? 'enabled' : 'disabled'}`}
          >
            {isCreatingOrder ? (
              <span className="loading">
                <span className="spinner"></span>
                Creating Swap...
              </span>
            ) : !wallet.isConnected ? (
              'Connect Wallet'
            ) : !swapForm.fromAmount ? (
              'Enter Amount'
            ) : !swapForm.bitcoinAddress ? (
              'Enter Bitcoin Address'
            ) : !isValidAmount ? (
              'Invalid Amount'
            ) : (
              'Create Swap'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default SwapForm;