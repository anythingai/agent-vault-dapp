import React, { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';

interface BitcoinAddressProps {
  value: string;
  onChange: (address: string) => void;
  className?: string;
  showQR?: boolean;
}

// Bitcoin address validation regex patterns
const BITCOIN_ADDRESS_PATTERNS = {
  // Legacy P2PKH addresses (start with 1)
  p2pkh: /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  // P2SH addresses (start with 3)
  p2sh: /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  // Bech32 addresses (start with bc1 for mainnet, tb1 for testnet)
  bech32: /^(bc1|tb1|bcrt1)[a-zA-HJ-NP-Z0-9]{25,87}$/,
};

export function BitcoinAddress({ 
  value, 
  onChange, 
  className = '',
  showQR = false 
}: BitcoinAddressProps) {
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [addressType, setAddressType] = useState<string>('');
  const [showQRCode, setShowQRCode] = useState(false);

  useEffect(() => {
    if (!value) {
      setIsValid(null);
      setAddressType('');
      return;
    }

    const validation = validateBitcoinAddress(value);
    setIsValid(validation.isValid);
    setAddressType(validation.type);
  }, [value]);

  const validateBitcoinAddress = (address: string): { isValid: boolean; type: string } => {
    if (!address) return { isValid: false, type: '' };

    // Remove whitespace
    const cleanAddress = address.trim();

    // Check each address type
    if (BITCOIN_ADDRESS_PATTERNS.p2pkh.test(cleanAddress)) {
      return { isValid: true, type: 'P2PKH (Legacy)' };
    }

    if (BITCOIN_ADDRESS_PATTERNS.p2sh.test(cleanAddress)) {
      return { isValid: true, type: 'P2SH (Script Hash)' };
    }

    if (BITCOIN_ADDRESS_PATTERNS.bech32.test(cleanAddress)) {
      const prefix = cleanAddress.substring(0, 3);
      const networkType = prefix === 'bc1' ? 'Mainnet' : 
                         prefix === 'tb1' ? 'Testnet' : 
                         prefix === 'bcrt1' ? 'Regtest' : 'Unknown';
      return { isValid: true, type: `Bech32 (${networkType})` };
    }

    return { isValid: false, type: 'Invalid format' };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Allow paste and let the validation handle the format
    setTimeout(() => {
      const pastedValue = (e.target as HTMLTextAreaElement).value;
      onChange(pastedValue.trim());
    }, 0);
  };

  const generateSampleAddress = () => {
    // Generate a sample testnet address for demo purposes
    const sampleAddresses = [
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', // Bech32 testnet
      '2N4Q5FhU2497BryFfUgbqkAJE87aKDv3V3e',         // P2SH testnet
      'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'          // P2PKH testnet
    ];
    const randomAddress = sampleAddresses[Math.floor(Math.random() * sampleAddresses.length)];
    onChange(randomAddress);
  };

  const clearAddress = () => {
    onChange('');
  };

  const copyToClipboard = async () => {
    if (value) {
      try {
        await navigator.clipboard.writeText(value);
        // Could add a toast notification here
      } catch (error) {
        console.error('Failed to copy address:', error);
      }
    }
  };

  return (
    <div className={`bitcoin-address ${className}`}>
      <div className="address-input-container">
        <textarea
          value={value}
          onChange={handleInputChange}
          onPaste={handlePaste}
          placeholder="Enter Bitcoin address (e.g., tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx)"
          className={`address-input ${
            isValid === null ? '' : 
            isValid ? 'valid' : 'invalid'
          }`}
          rows={2}
          spellCheck={false}
        />

        <div className="address-actions">
          {value && (
            <>
              <button
                onClick={copyToClipboard}
                className="action-btn copy-btn"
                title="Copy address"
              >
                📋
              </button>
              <button
                onClick={clearAddress}
                className="action-btn clear-btn"
                title="Clear address"
              >
                ✕
              </button>
            </>
          )}
          
          {showQR && (
            <button
              onClick={() => setShowQRCode(!showQRCode)}
              className="action-btn qr-btn"
              title="Show QR Code"
            >
              📱
            </button>
          )}

          <button
            onClick={generateSampleAddress}
            className="action-btn sample-btn"
            title="Use sample address"
          >
            🎯
          </button>
        </div>
      </div>

      {/* Validation Status */}
      <div className="address-status">
        {isValid === null && value === '' && (
          <div className="status-info">
            Enter a Bitcoin address to receive your swapped Bitcoin
          </div>
        )}
        
        {isValid === true && (
          <div className="status-valid">
            ✓ Valid {addressType} address
          </div>
        )}
        
        {isValid === false && value && (
          <div className="status-invalid">
            ✗ {addressType || 'Invalid Bitcoin address format'}
          </div>
        )}
      </div>

      {/* Address Format Help */}
      <details className="address-help">
        <summary>Address Format Guide</summary>
        <div className="help-content">
          <div className="address-format">
            <strong>Supported formats:</strong>
            <ul>
              <li><strong>Bech32 (Recommended):</strong> Starts with bc1 (mainnet) or tb1 (testnet)</li>
              <li><strong>P2SH:</strong> Starts with 3 (mainnet) or 2 (testnet)</li>
              <li><strong>Legacy (P2PKH):</strong> Starts with 1 (mainnet) or m/n (testnet)</li>
            </ul>
          </div>
          
          <div className="security-note">
            <strong>⚠️ Security Note:</strong>
            <p>Make sure you control this Bitcoin address and can access the private keys. 
               Double-check the address before confirming the swap.</p>
          </div>
        </div>
      </details>

      {/* QR Code Display */}
      {showQRCode && value && isValid && (
        <div className="qr-code-container">
          <div className="qr-code-header">
            <span>Bitcoin Address QR Code</span>
            <button 
              onClick={() => setShowQRCode(false)}
              className="close-qr-btn"
            >
              ✕
            </button>
          </div>
          <div className="qr-code">
            <QRCode 
              value={`bitcoin:${value}`}
              size={200}
              level="M"
              includeMargin={true}
            />
          </div>
          <div className="qr-code-address">
            {value}
          </div>
        </div>
      )}

      {/* Network Warning */}
      {isValid && value && (
        <div className="network-warning">
          {value.startsWith('bc1') || value.startsWith('1') || value.startsWith('3') ? (
            <div className="warning mainnet">
              ⚠️ This appears to be a mainnet address. Make sure you're using the correct network.
            </div>
          ) : (
            <div className="info testnet">
              ℹ️ This appears to be a testnet address, suitable for testing.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BitcoinAddress;