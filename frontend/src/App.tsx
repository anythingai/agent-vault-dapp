import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SwapProvider } from './context/SwapContext';
import { WalletConnect } from './components/WalletConnect';
import { SwapForm } from './components/SwapForm';
import { OrderStatus } from './components/OrderStatus';
import { ToastContainer } from './components/UI/Toast';
import './App.css';

// Header Component
function Header() {
  return (
    <header className="app-header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <h1>Fusion+ Cross-Chain</h1>
            <span className="subtitle">Bitcoin ↔ Ethereum Swaps</span>
          </div>
          
          <nav className="main-nav">
            <a href="/" className="nav-link">Swap</a>
            <a href="/status" className="nav-link">Status</a>
          </nav>

          <div className="header-actions">
            <WalletConnect />
          </div>
        </div>
      </div>
    </header>
  );
}

// Footer Component
function Footer() {
  return (
    <footer className="app-footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-info">
            <p>&copy; 2024 1inch Fusion+ Cross-Chain. Built for Unite DeFi Hack.</p>
            <p>Enabling trustless cross-chain atomic swaps between Bitcoin and Ethereum</p>
          </div>
          <div className="footer-links">
            <a href="https://1inch.io" target="_blank" rel="noopener noreferrer">1inch</a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#" target="_blank" rel="noopener noreferrer">Documentation</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Main content pages
function SwapPage() {
  return (
    <div className="page swap-page">
      <div className="container">
        <div className="page-header">
          <h2>Cross-Chain Swap</h2>
          <p>Swap your assets between Bitcoin and Ethereum securely with atomic swaps</p>
        </div>
        
        <div className="page-content">
          <SwapForm />
          
          <div className="info-section">
            <div className="info-card">
              <h3>How it Works</h3>
              <ol>
                <li><strong>Connect Wallet:</strong> Connect your MetaMask wallet</li>
                <li><strong>Enter Details:</strong> Specify amount and Bitcoin address</li>
                <li><strong>Auction:</strong> Resolvers bid to fulfill your swap</li>
                <li><strong>Atomic Swap:</strong> Secure cross-chain transaction</li>
                <li><strong>Complete:</strong> Receive Bitcoin in your address</li>
              </ol>
            </div>

            <div className="info-card">
              <h3>Security Features</h3>
              <ul>
                <li>✅ Atomic swap guarantees</li>
                <li>✅ No custodial risk</li>
                <li>✅ Time-locked contracts</li>
                <li>✅ Cryptographic proofs</li>
                <li>✅ Decentralized resolvers</li>
              </ul>
            </div>

            <div className="info-card">
              <h3>Supported Networks</h3>
              <ul>
                <li><strong>Ethereum:</strong> Sepolia Testnet</li>
                <li><strong>Bitcoin:</strong> Testnet</li>
                <li><strong>Coming Soon:</strong> Mainnet support</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPage() {
  return (
    <div className="page status-page">
      <div className="container">
        <div className="page-header">
          <h2>Swap Status</h2>
          <p>Monitor your active swaps and view transaction history</p>
        </div>
        
        <div className="page-content">
          <OrderStatus />
        </div>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="page not-found-page">
      <div className="container">
        <div className="not-found-content">
          <h2>404 - Page Not Found</h2>
          <p>The page you're looking for doesn't exist.</p>
          <a href="/" className="btn-primary">Go to Swap</a>
        </div>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  return (
    <SwapProvider>
      <Router>
        <div className="app">
          <Header />
          
          <main className="app-main">
            <Routes>
              <Route path="/" element={<SwapPage />} />
              <Route path="/swap" element={<Navigate to="/" replace />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/status/:orderId" element={<StatusPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>

          <Footer />
          
          {/* Global components */}
          <ToastContainer />
        </div>
      </Router>
    </SwapProvider>
  );
}

export default App;