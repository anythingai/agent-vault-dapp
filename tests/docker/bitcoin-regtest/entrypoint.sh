#!/bin/bash
set -e

# Initialize Bitcoin data directory
if [ ! -f /home/bitcoin/.bitcoin/regtest/wallet.dat ]; then
    echo "Initializing Bitcoin regtest environment..."
    
    # Start bitcoind in background temporarily
    bitcoind -regtest -daemon
    
    # Wait for it to start
    sleep 5
    
    # Create default wallet
    bitcoin-cli -regtest createwallet "default" || true
    
    # Generate initial blocks for coinbase maturity
    echo "Generating initial blocks..."
    ADDRESS=$(bitcoin-cli -regtest getnewaddress)
    bitcoin-cli -regtest generatetoaddress 101 $ADDRESS
    
    # Stop the temporary daemon
    bitcoin-cli -regtest stop
    
    # Wait for shutdown
    sleep 5
fi

echo "Starting Bitcoin regtest node..."
exec "$@"