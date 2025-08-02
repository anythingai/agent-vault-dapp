import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { createHash } from 'crypto';

// Initialize ECPair with secp256k1
const ECPair = ECPairFactory(ecc);

export interface HTLCParams {
  secretHash: Buffer;
  userPubkey: Buffer;
  resolverPubkey: Buffer;
  timelock: number; // Block height for CLTV
}

export interface HTLCOutput {
  script: Buffer;
  address: string;
  redeemScript: Buffer;
}

export interface BitcoinTransaction {
  txid: string;
  hex: string;
  size: number;
  vsize: number;
}

/**
 * Bitcoin HTLC implementation for cross-chain atomic swaps
 * Creates P2WSH scripts with hashlock and timelock constraints
 */
export class BitcoinHTLC {
  private network: bitcoin.Network;

  constructor(network: bitcoin.Network = bitcoin.networks.testnet) {
    this.network = network;
  }

  /**
   * Create HTLC script with hashlock and timelock
   * Script logic:
   * IF
   *   OP_SHA256 <secretHash> OP_EQUALVERIFY <userPubkey> OP_CHECKSIG
   * ELSE  
   *   <timelock> OP_CLTV OP_DROP <resolverPubkey> OP_CHECKSIG
   * ENDIF
   */
  createHTLCScript(params: HTLCParams): HTLCOutput {
    const { secretHash, userPubkey, resolverPubkey, timelock } = params;

    // Validate inputs
    if (secretHash.length !== 32) {
      throw new Error('Secret hash must be 32 bytes (SHA256)');
    }
    if (userPubkey.length !== 33 && userPubkey.length !== 65) {
      throw new Error('Invalid user public key');
    }
    if (resolverPubkey.length !== 33 && resolverPubkey.length !== 65) {
      throw new Error('Invalid resolver public key');
    }
    if (timelock <= 0 || timelock >= 0xffffffff) {
      throw new Error('Invalid timelock value');
    }

    // Build the HTLC script
    const redeemScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_IF,
        bitcoin.opcodes.OP_SHA256,
        secretHash,
        bitcoin.opcodes.OP_EQUALVERIFY,
        userPubkey,
        bitcoin.opcodes.OP_CHECKSIG,
      bitcoin.opcodes.OP_ELSE,
        bitcoin.script.number.encode(timelock),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        resolverPubkey,
        bitcoin.opcodes.OP_CHECKSIG,
      bitcoin.opcodes.OP_ENDIF
    ]);

    // Create P2WSH output
    const scriptHash = createHash('sha256').update(redeemScript).digest();
    const script = bitcoin.script.compile([
      bitcoin.opcodes.OP_0,
      scriptHash
    ]);

    // Generate address
    const address = bitcoin.address.fromOutputScript(script, this.network);

    return {
      script,
      address,
      redeemScript
    };
  }

  /**
   * Create funding transaction that sends BTC to HTLC address
   */
  async createFundingTransaction(
    htlcOutput: HTLCOutput,
    amount: number, // satoshis
    funderUTXOs: Array<{
      txid: string;
      vout: number;
      value: number;
      scriptPubKey: string;
    }>,
    funderKeyPair: any,
    changeAddress?: string,
    feeRate: number = 10 // sat/vbyte
  ): Promise<BitcoinTransaction> {
    const psbt = new bitcoin.Psbt({ network: this.network });
    
    let totalInput = 0;
    
    // Add inputs
    for (const utxo of funderUTXOs) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: Buffer.from(utxo.scriptPubKey, 'hex'),
          value: utxo.value
        }
      });
      totalInput += utxo.value;
    }

    // Add HTLC output
    psbt.addOutput({
      address: htlcOutput.address,
      value: amount
    });

    // Calculate fee (estimate)
    const estimatedSize = psbt.data.inputs.length * 148 + 2 * 34 + 10;
    const fee = estimatedSize * feeRate;

    // Add change output if needed
    const change = totalInput - amount - fee;
    if (change > 546) { // Dust threshold
      const changeAddr = changeAddress || bitcoin.payments.p2wpkh({
        pubkey: funderKeyPair.publicKey,
        network: this.network
      }).address!;
      
      psbt.addOutput({
        address: changeAddr,
        value: change
      });
    }

    // Sign all inputs
    for (let i = 0; i < funderUTXOs.length; i++) {
      psbt.signInput(i, funderKeyPair);
    }

    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();

    return {
      txid: tx.getId(),
      hex: tx.toHex(),
      size: tx.byteLength(),
      vsize: tx.virtualSize()
    };
  }

  /**
   * Create redemption transaction for user to claim BTC with secret
   */
  createRedemptionTransaction(
    htlcUTXO: {
      txid: string;
      vout: number;
      value: number;
    },
    htlcOutput: HTLCOutput,
    secret: Buffer,
    userKeyPair: any,
    userAddress: string,
    feeRate: number = 10
  ): BitcoinTransaction {
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Add HTLC input
    psbt.addInput({
      hash: htlcUTXO.txid,
      index: htlcUTXO.vout,
      witnessUtxo: {
        script: htlcOutput.script,
        value: htlcUTXO.value
      },
      witnessScript: htlcOutput.redeemScript
    });

    // Estimate fee
    const estimatedSize = 150; // Approximate size for this transaction type
    const fee = estimatedSize * feeRate;
    const outputAmount = htlcUTXO.value - fee;

    if (outputAmount <= 546) {
      throw new Error('Insufficient funds to cover fee');
    }

    // Add output to user
    psbt.addOutput({
      address: userAddress,
      value: outputAmount
    });

    // Sign input with user's key
    psbt.signInput(0, userKeyPair);

    // Create custom finalizer for redemption path
    psbt.finalizeInput(0, (inputIndex: number, input: any) => {
      // Get signature from partial sigs
      const signature = input.partialSig?.[0]?.signature;
      if (!signature) {
        throw new Error('No signature found');
      }

      // Build witness stack for redemption path
      // Stack: [signature] [secret] [1] [redeemScript]
      const witnessStack = [
        signature,
        secret,
        Buffer.from([0x01]), // TRUE for IF branch
        htlcOutput.redeemScript
      ];

      return {
        finalScriptSig: Buffer.alloc(0),
        finalScriptWitness: Buffer.concat([
          Buffer.from([witnessStack.length]),
          ...witnessStack.map(item => Buffer.concat([Buffer.from([item.length]), item]))
        ])
      };
    });
    const tx = psbt.extractTransaction();

    return {
      txid: tx.getId(),
      hex: tx.toHex(),
      size: tx.byteLength(),
      vsize: tx.virtualSize()
    };
  }

  /**
   * Create refund transaction for resolver to reclaim BTC after timelock
   */
  createRefundTransaction(
    htlcUTXO: {
      txid: string;
      vout: number;
      value: number;
    },
    htlcOutput: HTLCOutput,
    resolverKeyPair: any,
    resolverAddress: string,
    timelock: number,
    feeRate: number = 10
  ): BitcoinTransaction {
    const psbt = new bitcoin.Psbt({ network: this.network });

    // Set sequence for CLTV
    psbt.setLocktime(timelock);

    // Add HTLC input
    psbt.addInput({
      hash: htlcUTXO.txid,
      index: htlcUTXO.vout,
      witnessUtxo: {
        script: htlcOutput.script,
        value: htlcUTXO.value
      },
      witnessScript: htlcOutput.redeemScript,
      sequence: 0xfffffffe // Enable CLTV
    });

    // Estimate fee
    const estimatedSize = 140; // Approximate size for refund transaction
    const fee = estimatedSize * feeRate;
    const outputAmount = htlcUTXO.value - fee;

    if (outputAmount <= 546) {
      throw new Error('Insufficient funds to cover fee');
    }

    // Add output to resolver
    psbt.addOutput({
      address: resolverAddress,
      value: outputAmount
    });

    // Sign input with resolver's key
    psbt.signInput(0, resolverKeyPair);

    // Create custom finalizer for refund path
    psbt.finalizeInput(0, (inputIndex: number, input: any) => {
      // Get signature from partial sigs
      const signature = input.partialSig?.[0]?.signature;
      if (!signature) {
        throw new Error('No signature found');
      }

      // Build witness stack for refund path
      // Stack: [signature] [0] [redeemScript]
      const witnessStack = [
        signature,
        Buffer.from([]), // FALSE for ELSE branch
        htlcOutput.redeemScript
      ];

      return {
        finalScriptSig: Buffer.alloc(0),
        finalScriptWitness: Buffer.concat([
          Buffer.from([witnessStack.length]),
          ...witnessStack.map(item => Buffer.concat([Buffer.from([item.length]), item]))
        ])
      };
    });
    const tx = psbt.extractTransaction();

    return {
      txid: tx.getId(),
      hex: tx.toHex(),
      size: tx.byteLength(),
      vsize: tx.virtualSize()
    };
  }

  /**
   * Validate a secret against its hash
   */
  validateSecret(secret: Buffer, expectedHash: Buffer): boolean {
    if (secret.length === 0) return false;
    const actualHash = createHash('sha256').update(secret).digest();
    return actualHash.equals(expectedHash);
  }

  /**
   * Generate a random secret and its hash
   */
  generateSecret(): { secret: Buffer; hash: Buffer } {
    const secret = Buffer.from(require('crypto').randomBytes(32));
    const hash = createHash('sha256').update(secret).digest();
    return { secret, hash };
  }

  /**
   * Extract secret from a redemption transaction
   */
  extractSecretFromTransaction(txHex: string, redeemScript: Buffer): Buffer | null {
    try {
      const tx = bitcoin.Transaction.fromHex(txHex);
      
      // Look for the secret in witness data
      for (const input of tx.ins) {
        if (input.witness && input.witness.length >= 4) {
          // In redemption path: [signature] [secret] [1] [redeemScript]
          const potentialSecret = input.witness[1];
          const potentialRedeemScript = input.witness[3];
          
          if (potentialRedeemScript.equals(redeemScript) && potentialSecret.length === 32) {
            return potentialSecret;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting secret from transaction:', error);
      return null;
    }
  }

  /**
   * Check if a transaction spends from an HTLC
   */
  isHTLCSpend(txHex: string, htlcTxId: string, htlcVout: number): boolean {
    try {
      const tx = bitcoin.Transaction.fromHex(txHex);
      
      for (const input of tx.ins) {
        const inputTxId = Buffer.from(input.hash).reverse().toString('hex');
        if (inputTxId === htlcTxId && input.index === htlcVout) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking HTLC spend:', error);
      return false;
    }
  }

  /**
   * Estimate transaction size for fee calculation
   */
  estimateTransactionSize(
    inputCount: number,
    outputCount: number,
    isWitness: boolean = true
  ): number {
    // Base transaction size
    let size = 10; // version (4) + locktime (4) + input count (1) + output count (1)
    
    // Input sizes (witness transactions have different sizes)
    if (isWitness) {
      size += inputCount * 68; // Average witness input size
      size += 2; // Witness flag and marker
    } else {
      size += inputCount * 148; // Legacy input size
    }
    
    // Output sizes
    size += outputCount * 34; // Average output size (P2WPKH/P2WSH)
    
    return size;
  }
}

export default BitcoinHTLC;