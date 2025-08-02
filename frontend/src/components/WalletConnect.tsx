import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useSwap } from '../context/SwapContext';
import { WalletState, SwapError, SwapErrorCode, SUPPORTED_CHAINS } from '../types';

interface WalletConnectProps {
  className?: string;
}

// Chain configurations
const CHAIN_CONFIGS = {
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: {
    chainId: `0x${SUPPORTED_CHAINS.ETHEREUM_SEPOLIA.toString(16)}`,
    chainName: 'Sepolia Test Network',
    nativeCurrency: {
      name: 'SepoliaETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: ['https://sepolia.infura.io/v3/'],
    blockExplorerUrls: ['https://sepolia.etherscan.io/'],
  },
};

export function WalletConnect({ className = '' }: WalletConnectProps) {
  const { wallet, updateWalletState } = useSwap();
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);

  useEffect(() => {
    // Check if wallet was previously connected
    checkConnection();
    
    // Listen for account changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      window.ethereum.on('disconnect', handleDisconnect);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, []);

  const checkConnection = async () => {
    if (!window.ethereum) return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.listAccounts();
      
      if (accounts.length > 0) {
        const network = await provider.getNetwork();
        const balance = await provider.getBalance(accounts[0].address);
        
        updateWalletState({
          isConnected: true,
          address: accounts[0].address,
          chainId: Number(network.chainId),
          balance: ethers.formatEther(balance),
          isConnecting: false
        });
        
        setProvider(provider);
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      updateWalletState({
        ...wallet,
        error: 'MetaMask not detected. Please install MetaMask to continue.',
        isConnecting: false
      });
      return;
    }

    try {
      updateWalletState({
        ...wallet,
        isConnecting: true,
        error: undefined
      });

      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Request account access
      await provider.send('eth_requestAccounts', []);
      
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      const balance = await provider.getBalance(address);

      // Check if we're on the correct network (Sepolia)
      if (Number(network.chainId) !== SUPPORTED_CHAINS.ETHEREUM_SEPOLIA) {
        await switchToSepolia();
        return; // switchToSepolia will handle the connection update
      }

      updateWalletState({
        isConnected: true,
        address,
        chainId: Number(network.chainId),
        balance: ethers.formatEther(balance),
        isConnecting: false,
        error: undefined
      });

      setProvider(provider);
    } catch (error: any) {
      let errorMessage = 'Failed to connect wallet';
      
      if (error.code === 4001) {
        errorMessage = 'User rejected the connection request';
      } else if (error.code === -32002) {
        errorMessage = 'Connection request already pending. Please check MetaMask.';
      }

      updateWalletState({
        ...wallet,
        error: errorMessage,
        isConnecting: false
      });
    }
  };

  const switchToSepolia = async () => {
    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_CONFIGS[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA].chainId }],
      });
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [CHAIN_CONFIGS[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]],
          });
        } catch (addError) {
          updateWalletState({
            ...wallet,
            error: 'Failed to add Sepolia network to MetaMask',
            isConnecting: false
          });
        }
      } else {
        updateWalletState({
          ...wallet,
          error: 'Failed to switch to Sepolia network',
          isConnecting: false
        });
      }
    }
  };

  const disconnectWallet = () => {
    updateWalletState({
      isConnected: false,
      isConnecting: false,
      error: undefined
    });
    setProvider(null);
  };

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      disconnectWallet();
    } else {
      // Account changed, update the state
      checkConnection();
    }
  };

  const handleChainChanged = (chainId: string) => {
    // Reload the page to reset state when chain changes
    window.location.reload();
  };

  const handleDisconnect = () => {
    disconnectWallet();
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    return num > 0.001 ? num.toFixed(4) : num.toExponential(2);
  };

  if (wallet.isConnected) {
    return (
      <div className={`wallet-connected ${className}`}>
        <div className="wallet-info">
          <div className="wallet-address">
            {formatAddress(wallet.address!)}
          </div>
          <div className="wallet-balance">
            {formatBalance(wallet.balance || '0')} ETH
          </div>
          {wallet.chainId !== SUPPORTED_CHAINS.ETHEREUM_SEPOLIA && (
            <div className="wallet-warning">
              ⚠️ Switch to Sepolia network
              <button onClick={switchToSepolia} className="switch-network-btn">
                Switch Network
              </button>
            </div>
          )}
        </div>
        <button onClick={disconnectWallet} className="disconnect-btn">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className={`wallet-connect ${className}`}>
      <button
        onClick={connectWallet}
        disabled={wallet.isConnecting}
        className="connect-btn"
      >
        {wallet.isConnecting ? (
          <span className="loading">
            <span className="spinner"></span>
            Connecting...
          </span>
        ) : (
          'Connect Wallet'
        )}
      </button>
      
      {wallet.error && (
        <div className="wallet-error">
          {wallet.error}
        </div>
      )}

      {!window.ethereum && (
        <div className="metamask-prompt">
          <p>MetaMask not detected</p>
          <a 
            href="https://metamask.io/download/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="install-metamask"
          >
            Install MetaMask
          </a>
        </div>
      )}
    </div>
  );
}

// Global type augmentation for ethereum object
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, callback: (...args: any[]) => void) => void;
      removeListener: (event: string, callback: (...args: any[]) => void) => void;
      send: (method: string, params: any[]) => Promise<any>;
    };
  }
}

export default WalletConnect;