import { BitcoinHTLC, HTLCParams, HTLCOutput, BitcoinTransaction } from './htlc.js';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import axios from 'axios';

const ECPair = ECPairFactory(ecc);

export interface UTXO {
  txid: string;
  vout: number;
  value: number; // satoshis
  scriptPubKey: string;
  confirmations: number;
}

export interface BitcoinRPCConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  network: 'mainnet' | 'testnet' | 'regtest';
}

export interface SwapMonitoring {
  htlcAddress: string;
  secretHash: Buffer;
  userAddress: string;
  resolverAddress: string;
  timelock: number;
  amount: number;
  status: 'pending' | 'funded' | 'redeemed' | 'refunded' | 'expired';
  fundingTxid?: string;
  redeemTxid?: string;
  secret?: Buffer;
}

/**
 * Bitcoin client for interacting with Bitcoin Core and managing HTLC swaps
 * Supports testnet, regtest, and mainnet operations
 */
export class BitcoinClient {
  private htlc: BitcoinHTLC;
  private network: bitcoin.Network;
  private rpcConfig: BitcoinRPCConfig;
  private baseURL: string;

  constructor(rpcConfig: BitcoinRPCConfig) {
    this.rpcConfig = rpcConfig;
    
    // Set network
    switch (rpcConfig.network) {
      case 'mainnet':
        this.network = bitcoin.networks.bitcoin;
        break;
      case 'testnet':
        this.network = bitcoin.networks.testnet;
        break;
      case 'regtest':
        this.network = bitcoin.networks.regtest;
        break;
      default:
        throw new Error(`Unsupported network: ${rpcConfig.network}`);
    }
    
    this.htlc = new BitcoinHTLC(this.network);
    this.baseURL = `http://${rpcConfig.host}:${rpcConfig.port}`;
  }

  /**
   * Make RPC call to Bitcoin Core
   */
  private async rpc(method: string, params: any[] = []): Promise<any> {
    const auth = Buffer.from(`${this.rpcConfig.username}:${this.rpcConfig.password}`).toString('base64');
    
    try {
      const response = await axios.post(this.baseURL, {
        jsonrpc: '1.0',
        id: Date.now(),
        method,
        params
      }, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error: any) {
      throw new Error(`Bitcoin RPC call failed: ${error.message}`);
    }
  }

  /**
   * Get current block height
   */
  async getBlockHeight(): Promise<number> {
    return await this.rpc('getblockcount');
  }

  /**
   * Get block hash by height
   */
  async getBlockHash(height: number): Promise<string> {
    return await this.rpc('getblockhash', [height]);
  }

  /**
   * Get transaction by txid
   */
  async getTransaction(txid: string, includeWatchOnly: boolean = true): Promise<any> {
    return await this.rpc('gettransaction', [txid, includeWatchOnly]);
  }

  /**
   * Get raw transaction by txid
   */
  async getRawTransaction(txid: string, verbose: boolean = true): Promise<any> {
    return await this.rpc('getrawtransaction', [txid, verbose]);
  }

  /**
   * Send raw transaction
   */
  async sendRawTransaction(hexTx: string): Promise<string> {
    return await this.rpc('sendrawtransaction', [hexTx]);
  }

  /**
   * Get UTXOs for an address
   */
  async getUTXOs(address: string, minConfirmations: number = 1): Promise<UTXO[]> {
    const unspent = await this.rpc('listunspent', [minConfirmations, 9999999, [address]]);
    
    return unspent.map((utxo: any) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: Math.round(utxo.amount * 100000000), // Convert BTC to satoshis
      scriptPubKey: utxo.scriptPubKey,
      confirmations: utxo.confirmations
    }));
  }

  /**
   * Import address for watching (watch-only)
   */
  async importAddress(address: string, label: string = '', rescan: boolean = false): Promise<void> {
    await this.rpc('importaddress', [address, label, rescan]);
  }

  /**
   * Get balance of an address
   */
  async getAddressBalance(address: string): Promise<number> {
    const utxos = await this.getUTXOs(address);
    return utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  }

  /**
   * Create and monitor an HTLC swap
   */
  async createHTLCSwap(params: HTLCParams): Promise<{
    htlcOutput: HTLCOutput;
    monitoring: SwapMonitoring;
  }> {
    const htlcOutput = this.htlc.createHTLCScript(params);
    
    // Import address for monitoring
    await this.importAddress(htlcOutput.address, `HTLC_${params.secretHash.toString('hex').substring(0, 8)}`);
    
    const monitoring: SwapMonitoring = {
      htlcAddress: htlcOutput.address,
      secretHash: params.secretHash,
      userAddress: '', // Will be set later
      resolverAddress: '', // Will be set later
      timelock: params.timelock,
      amount: 0, // Will be set when funded
      status: 'pending'
    };

    return { htlcOutput, monitoring };
  }

  /**
   * Fund an HTLC with BTC
   */
  async fundHTLC(
    htlcOutput: HTLCOutput,
    amount: number,
    funderUTXOs: UTXO[],
    funderPrivateKey: string,
    changeAddress?: string,
    feeRate: number = 10
  ): Promise<BitcoinTransaction> {
    const keyPair = ECPair.fromWIF(funderPrivateKey, this.network);
    
    const utxos = funderUTXOs.map(utxo => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      scriptPubKey: utxo.scriptPubKey
    }));

    const tx = await this.htlc.createFundingTransaction(
      htlcOutput,
      amount,
      utxos,
      keyPair,
      changeAddress,
      feeRate
    );

    // Broadcast transaction
    const txid = await this.sendRawTransaction(tx.hex);
    
    return { ...tx, txid };
  }

  /**
   * Redeem BTC from HTLC with secret
   */
  async redeemHTLC(
    htlcUTXO: UTXO,
    htlcOutput: HTLCOutput,
    secret: Buffer,
    userPrivateKey: string,
    userAddress: string,
    feeRate: number = 10
  ): Promise<BitcoinTransaction> {
    const keyPair = ECPair.fromWIF(userPrivateKey, this.network);
    
    const tx = this.htlc.createRedemptionTransaction(
      {
        txid: htlcUTXO.txid,
        vout: htlcUTXO.vout,
        value: htlcUTXO.value
      },
      htlcOutput,
      secret,
      keyPair,
      userAddress,
      feeRate
    );

    // Broadcast transaction
    const txid = await this.sendRawTransaction(tx.hex);
    
    return { ...tx, txid };
  }

  /**
   * Refund BTC from HTLC after timelock
   */
  async refundHTLC(
    htlcUTXO: UTXO,
    htlcOutput: HTLCOutput,
    resolverPrivateKey: string,
    resolverAddress: string,
    timelock: number,
    feeRate: number = 10
  ): Promise<BitcoinTransaction> {
    const keyPair = ECPair.fromWIF(resolverPrivateKey, this.network);
    
    const tx = this.htlc.createRefundTransaction(
      {
        txid: htlcUTXO.txid,
        vout: htlcUTXO.vout,
        value: htlcUTXO.value
      },
      htlcOutput,
      keyPair,
      resolverAddress,
      timelock,
      feeRate
    );

    // Broadcast transaction
    const txid = await this.sendRawTransaction(tx.hex);
    
    return { ...tx, txid };
  }

  /**
   * Monitor HTLC status and extract secret if redeemed
   */
  async monitorHTLC(
    htlcAddress: string,
    secretHash: Buffer,
    redeemScript: Buffer
  ): Promise<{
    status: 'pending' | 'funded' | 'redeemed' | 'refunded';
    fundingTxid?: string;
    redeemTxid?: string;
    secret?: Buffer;
    amount?: number;
  }> {
    const utxos = await this.getUTXOs(htlcAddress, 0); // Include unconfirmed
    
    if (utxos.length === 0) {
      return { status: 'pending' };
    }

    // HTLC is funded
    const fundingUTXO = utxos[0];
    const result: any = {
      status: 'funded',
      fundingTxid: fundingUTXO.txid,
      amount: fundingUTXO.value
    };

    // Check if HTLC has been spent (redeemed or refunded)
    try {
      const unspent = await this.getUTXOs(htlcAddress, 1); // Only confirmed
      
      if (unspent.length === 0 && utxos.length > 0) {
        // HTLC was spent, need to find the spending transaction
        const spendingTxs = await this.findSpendingTransactions(fundingUTXO.txid, fundingUTXO.vout);
        
        if (spendingTxs.length > 0) {
          const spendingTx = spendingTxs[0];
          result.redeemTxid = spendingTx.txid;
          
          // Try to extract secret from transaction
          const secret = this.htlc.extractSecretFromTransaction(spendingTx.hex, redeemScript);
          
          if (secret && this.htlc.validateSecret(secret, secretHash)) {
            result.status = 'redeemed';
            result.secret = secret;
          } else {
            result.status = 'refunded';
          }
        }
      }
    } catch (error) {
      console.warn('Error checking HTLC spend status:', error);
    }

    return result;
  }

  /**
   * Find transactions that spend a specific output
   */
  private async findSpendingTransactions(txid: string, vout: number): Promise<any[]> {
    try {
      // This is a simplified implementation
      // In a production system, you'd want to use a more efficient method
      // such as maintaining a UTXO set or using block explorer APIs
      
      const currentHeight = await this.getBlockHeight();
      const spendingTxs = [];
      
      // Search recent blocks for spending transactions
      for (let i = 0; i < 10; i++) { // Check last 10 blocks
        const blockHeight = currentHeight - i;
        if (blockHeight < 0) break;
        
        const blockHash = await this.getBlockHash(blockHeight);
        const block = await this.rpc('getblock', [blockHash, 2]); // Verbose level 2
        
        for (const tx of block.tx) {
          for (const vin of tx.vin) {
            if (vin.txid === txid && vin.vout === vout) {
              const rawTx = await this.getRawTransaction(tx.txid);
              spendingTxs.push({
                txid: tx.txid,
                hex: rawTx.hex || rawTx
              });
            }
          }
        }
      }
      
      return spendingTxs;
    } catch (error) {
      console.error('Error finding spending transactions:', error);
      return [];
    }
  }

  /**
   * Generate a new Bitcoin key pair
   */
  generateKeyPair(): { privateKey: string; publicKey: Buffer; address: string } {
    const keyPair = ECPair.makeRandom({ network: this.network });
    const { address } = bitcoin.payments.p2wpkh({ 
      pubkey: keyPair.publicKey, 
      network: this.network 
    });

    return {
      privateKey: keyPair.toWIF(),
      publicKey: keyPair.publicKey,
      address: address!
    };
  }

  /**
   * Get current network fee rate estimate
   */
  async getFeeRate(targetBlocks: number = 6): Promise<number> {
    try {
      const feeRate = await this.rpc('estimatesmartfee', [targetBlocks]);
      if (feeRate.feerate) {
        // Convert BTC/kB to sat/byte
        return Math.ceil(feeRate.feerate * 100000000 / 1000);
      }
    } catch (error) {
      console.warn('Unable to estimate fee rate:', error);
    }
    
    // Fallback fee rates (sat/byte)
    switch (this.rpcConfig.network) {
      case 'mainnet':
        return 20;
      case 'testnet':
        return 1;
      case 'regtest':
        return 1;
      default:
        return 10;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    txid: string, 
    requiredConfirmations: number = 1,
    timeoutMs: number = 300000 // 5 minutes
  ): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const tx = await this.getTransaction(txid);
        if (tx.confirmations >= requiredConfirmations) {
          return tx;
        }
      } catch (error) {
        // Transaction not found yet, continue waiting
      }
      
      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    throw new Error(`Transaction ${txid} not confirmed within ${timeoutMs}ms`);
  }

  /**
   * Check if Bitcoin Core is running and accessible
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.getBlockHeight();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get network info
   */
  async getNetworkInfo(): Promise<any> {
    return await this.rpc('getnetworkinfo');
  }

  /**
   * Get blockchain info
   */
  async getBlockchainInfo(): Promise<any> {
    return await this.rpc('getblockchaininfo');
  }
}

export default BitcoinClient;