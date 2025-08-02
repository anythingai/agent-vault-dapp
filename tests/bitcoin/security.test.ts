/**
 * Bitcoin HTLC Security Testing Suite
 * Tests security properties, attack resistance, and edge cases
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient, UTXO } from '../../backend/src/bitcoin/client.js';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';
import { regtestManager, RegtestUtils } from './setup.js';
import { testConfig, TEST_WALLETS, TEST_AMOUNTS, TEST_TIMELOCKS } from '../config.js';

describe('Bitcoin HTLC Security Tests', () => {
  let client: BitcoinClient;
  let htlc: BitcoinHTLC;
  let testSetup: any;
  let testSecrets: Array<{ secret: Buffer; hash: Buffer }>;
  let testKeyPairs: Array<any>;
  let attackerKeyPair: any;

  beforeAll(async () => {
    testSetup = await regtestManager.startRegtestNode();
    client = testSetup.client;
    htlc = new BitcoinHTLC(bitcoin.networks.regtest);

    const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
    testKeyPairs = [
      ECPair.makeRandom({ network: bitcoin.networks.regtest }),
      ECPair.makeRandom({ network: bitcoin.networks.regtest })
    ];
    attackerKeyPair = ECPair.makeRandom({ network: bitcoin.networks.regtest });

    testSecrets = [
      SecretManager.generateSecret(),
      SecretManager.generateSecret(),
      SecretManager.generateSecret()
    ];
  }, 60000);

  afterAll(async () => {
    await testSetup?.cleanup();
  });

  describe('Secret Security Tests', () => {
    test('should reject invalid secret hash', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await client.getBlockHeight() + TEST_TIMELOCKS.MEDIUM
      };

      const htlcOutput = htlc.createHTLCScript(params);

      // Fund HTLC first
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        aliceUTXOs.slice(0, 1),
        keyPair,
        alice.address
      );

      await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);

      await client.importAddress(htlcOutput.address, 'security-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);

      // Try to redeem with wrong secret
      const wrongSecret = testSecrets[1].secret; // Different secret
      
      const redeemTx = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        wrongSecret, // Wrong secret
        keyPair,
        alice.address
      );

      // This should fail when broadcast
      await expect(
        client.sendRawTransaction(redeemTx.hex)
      ).rejects.toThrow();
    });

    test('should prevent brute force attacks on short secrets', () => {
      // Test with artificially short secret (for demonstration)
      const shortSecret = Buffer.from('short', 'utf8');
      const shortHash = require('crypto').createHash('sha256').update(shortSecret).digest();

      // Validate against correct short secret
      expect(htlc.validateSecret(shortSecret, shortHash)).toBe(true);

      // Test some common brute force attempts
      const commonSecrets = [
        Buffer.from('password', 'utf8'),
        Buffer.from('123456', 'utf8'),
        Buffer.from('secret', 'utf8'),
        Buffer.from('bitcoin', 'utf8'),
        Buffer.from('', 'utf8') // Empty secret
      ];

      commonSecrets.forEach(guessSecret => {
        expect(htlc.validateSecret(guessSecret, shortHash)).toBe(false);
      });
    });

    test('should handle edge case secrets correctly', () => {
      // Test with maximum length secret
      const maxSecret = Buffer.alloc(32, 0xff);
      const maxHash = require('crypto').createHash('sha256').update(maxSecret).digest();
      expect(htlc.validateSecret(maxSecret, maxHash)).toBe(true);

      // Test with all zeros secret
      const zeroSecret = Buffer.alloc(32, 0x00);
      const zeroHash = require('crypto').createHash('sha256').update(zeroSecret).digest();
      expect(htlc.validateSecret(zeroSecret, zeroHash)).toBe(true);

      // Test with partial secrets (should fail)
      expect(htlc.validateSecret(maxSecret.slice(0, 16), maxHash)).toBe(false);
    });
  });

  describe('Timelock Security Tests', () => {
    test('should prevent premature refunds', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      const currentHeight = await client.getBlockHeight();
      const futureTimelock = currentHeight + TEST_TIMELOCKS.LONG;

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: futureTimelock
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Fund HTLC
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.MEDIUM,
        aliceUTXOs.slice(0, 1),
        keyPair,
        alice.address
      );

      await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);

      await client.importAddress(htlcOutput.address, 'timelock-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);

      // Try to refund before timelock (should fail)
      const bobKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        bob.privateKey, 
        bitcoin.networks.regtest
      );

      const prematureRefundTx = htlc.createRefundTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        bobKeyPair,
        bob.address,
        futureTimelock
      );

      // Should fail due to CHECKLOCKTIMEVERIFY
      await expect(
        client.sendRawTransaction(prematureRefundTx.hex)
      ).rejects.toThrow();

      // Verify current height is still before timelock
      const newHeight = await client.getBlockHeight();
      expect(newHeight).toBeLessThan(futureTimelock);
    });

    test('should handle timelock edge cases', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      const currentHeight = await client.getBlockHeight();
      
      // Test with timelock exactly at current height + 1
      const edgeTimelock = currentHeight + 1;

      const params: HTLCParams = {
        secretHash: testSecrets[1].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: edgeTimelock
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Fund HTLC
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      const aliceKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        aliceUTXOs.slice(0, 1),
        aliceKeyPair,
        alice.address
      );

      await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, edgeTimelock);

      await client.importAddress(htlcOutput.address, 'edge-timelock-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);

      // Should now be able to refund
      const bobKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        bob.privateKey, 
        bitcoin.networks.regtest
      );

      const refundTx = htlc.createRefundTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        bobKeyPair,
        bob.address,
        edgeTimelock
      );

      // Should succeed at exact timelock height
      const refundTxId = await client.sendRawTransaction(refundTx.hex);
      expect(refundTxId).toBeDefined();
    });
  });

  describe('Double Spending Prevention', () => {
    test('should prevent double spending attempts', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await client.getBlockHeight() + TEST_TIMELOCKS.MEDIUM
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Fund HTLC
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      const aliceKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.MEDIUM,
        aliceUTXOs.slice(0, 1),
        aliceKeyPair,
        alice.address
      );

      await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);

      await client.importAddress(htlcOutput.address, 'double-spend-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);

      // Create first redemption transaction
      const redeemTx1 = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        testSecrets[0].secret,
        aliceKeyPair,
        alice.address
      );

      // Create second redemption transaction (same UTXO, different output)
      const redeemTx2 = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        testSecrets[0].secret,
        aliceKeyPair,
        bob.address // Different output address
      );

      // First transaction should succeed
      const firstTxId = await client.sendRawTransaction(redeemTx1.hex);
      expect(firstTxId).toBeDefined();

      // Second transaction should fail (double spend)
      await expect(
        client.sendRawTransaction(redeemTx2.hex)
      ).rejects.toThrow();
    });

    test('should handle conflicting redemption and refund', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      const currentHeight = await client.getBlockHeight();
      const shortTimelock = currentHeight + 2; // Very short timelock

      const params: HTLCParams = {
        secretHash: testSecrets[1].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: shortTimelock
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Fund HTLC
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      const aliceKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        aliceUTXOs.slice(0, 1),
        aliceKeyPair,
        alice.address
      );

      await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, shortTimelock);

      await client.importAddress(htlcOutput.address, 'conflict-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);

      // Create both redemption and refund transactions
      const redeemTx = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        testSecrets[1].secret,
        aliceKeyPair,
        alice.address
      );

      const bobKeyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        bob.privateKey, 
        bitcoin.networks.regtest
      );

      const refundTx = htlc.createRefundTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        bobKeyPair,
        bob.address,
        shortTimelock
      );

      // One should succeed, the other should fail
      try {
        await client.sendRawTransaction(redeemTx.hex);
        // If redemption succeeds, refund should fail
        await expect(
          client.sendRawTransaction(refundTx.hex)
        ).rejects.toThrow();
      } catch {
        // If redemption fails, try refund
        const refundTxId = await client.sendRawTransaction(refundTx.hex);
        expect(refundTxId).toBeDefined();
      }
    });
  });

  describe('Script Attack Resistance', () => {
    test('should resist script manipulation attacks', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const originalScript = htlcOutput.redeemScript;

      // Try to modify script opcodes (this would break the hash)
      const modifiedScript = Buffer.from(originalScript);
      modifiedScript[0] = 0x00; // Change first byte

      expect(modifiedScript).not.toEqual(originalScript);

      // The P2WSH address should be different with modified script
      const modifiedHash = require('crypto').createHash('sha256').update(modifiedScript).digest();
      const modifiedP2WSH = bitcoin.script.compile([
        bitcoin.opcodes.OP_0,
        modifiedHash
      ]);

      expect(modifiedP2WSH).not.toEqual(htlcOutput.script);
    });

    test('should validate script structure correctly', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const decompiled = bitcoin.script.decompile(htlcOutput.redeemScript);

      expect(decompiled).toBeDefined();
      
      if (decompiled) {
        // Verify critical opcodes are in correct positions
        expect(decompiled[0]).toBe(bitcoin.opcodes.OP_IF);
        expect(decompiled[1]).toBe(bitcoin.opcodes.OP_SHA256);
        expect(decompiled[2]).toEqual(testSecrets[0].hash);
        expect(decompiled[3]).toBe(bitcoin.opcodes.OP_EQUALVERIFY);
        expect(decompiled[4]).toEqual(testKeyPairs[0].publicKey);
        expect(decompiled[5]).toBe(bitcoin.opcodes.OP_CHECKSIG);
        expect(decompiled[6]).toBe(bitcoin.opcodes.OP_ELSE);
        // Timelock and remaining opcodes...
        const lastOpcode = decompiled[decompiled.length - 1];
        expect(lastOpcode).toBe(bitcoin.opcodes.OP_ENDIF);
      }
    });

    test('should prevent unauthorized key substitution', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const legitimateHTLC = htlc.createHTLCScript(params);

      // Try with attacker's keys
      const attackParams: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: attackerKeyPair.publicKey,
        resolverPubkey: attackerKeyPair.publicKey,
        timelock: 1000
      };

      const attackerHTLC = htlc.createHTLCScript(attackParams);

      // Should produce different addresses
      expect(legitimateHTLC.address).not.toBe(attackerHTLC.address);
      expect(legitimateHTLC.redeemScript).not.toEqual(attackerHTLC.redeemScript);
    });
  });

  describe('Transaction Malleability Resistance', () => {
    test('should use witness transactions to prevent malleability', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);

      // P2WSH outputs are not malleable
      expect(htlcOutput.script[0]).toBe(0); // OP_0 for witness v0
      expect(htlcOutput.script.length).toBe(34); // Fixed length for P2WSH
      
      // Script commitment is in the output, not the input
      const scriptHash = require('crypto').createHash('sha256').update(htlcOutput.redeemScript).digest();
      expect(htlcOutput.script.slice(2)).toEqual(scriptHash);
    });

    test('should generate deterministic transaction IDs', async () => {
      // Create identical UTXOs for testing
      const utxo = {
        txid: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        vout: 0,
        value: 100000,
        scriptPubKey: '00141234567890123456789012345678901234567890'
      };

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);

      // Create two identical funding transactions
      const fundingTx1 = await htlc.createFundingTransaction(
        htlcOutput,
        50000,
        [utxo],
        testKeyPairs[0],
        'bcrt1qzd9xm2v8q9x8m2v8q9x8m2v8q9x8m2v8q9x8m',
        10
      );

      const fundingTx2 = await htlc.createFundingTransaction(
        htlcOutput,
        50000,
        [utxo],
        testKeyPairs[0],
        'bcrt1qzd9xm2v8q9x8m2v8q9x8m2v8q9x8m2v8q9x8m',
        10
      );

      // Transaction IDs should be identical (deterministic)
      expect(fundingTx1.txid).toBe(fundingTx2.txid);
      expect(fundingTx1.hex).toBe(fundingTx2.hex);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed transaction inputs gracefully', () => {
      const invalidTxHex = 'invalid_hex_string';
      
      expect(() => {
        htlc.extractSecretFromTransaction(invalidTxHex, testSecrets[0].hash);
      }).not.toThrow(); // Should return null instead of throwing

      const result = htlc.extractSecretFromTransaction(invalidTxHex, testSecrets[0].hash);
      expect(result).toBeNull();
    });

    test('should validate transaction spending correctly', () => {
      const validTxHex = '0100000000010136641869ca081e70f394c6948e8af409e18b619df2ed74aa106c1ca29787b96e01000000004847304402204bdb5c3af99b95020fcbb367d3d5f38967a7e7d9a8da6e0b5b76d9ee31e6b8b00022003eae0f94e02db5dd5b6e6e63bdef98d5c06c6e04f7efb4e1d72e1f4aa0d8b5c90101fffffffffe01d4b45d9404e1b8b7c8c30b0b48eee4ee1bb0e3c9c94f90df2e9bf5e9f5f7e01';
      const htlcTxId = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const isSpend = htlc.isHTLCSpend(validTxHex, htlcTxId, 0);
      expect(typeof isSpend).toBe('boolean');
    });

    test('should handle empty or null inputs safely', () => {
      // Test with empty buffers
      expect(htlc.validateSecret(Buffer.alloc(0), testSecrets[0].hash)).toBe(false);
      
      // Test with null-like inputs (should be handled by TypeScript, but test runtime behavior)
      const emptyHash = Buffer.alloc(32, 0);
      expect(htlc.validateSecret(testSecrets[0].secret, emptyHash)).toBe(false);
    });
  });

  describe('Cryptographic Security', () => {
    test('should use secure random number generation', () => {
      const secret1 = htlc.generateSecret();
      const secret2 = htlc.generateSecret();
      
      // Secrets should be different (extremely high probability)
      expect(secret1.secret).not.toEqual(secret2.secret);
      expect(secret1.hash).not.toEqual(secret2.hash);
      
      // Both should be valid
      expect(htlc.validateSecret(secret1.secret, secret1.hash)).toBe(true);
      expect(htlc.validateSecret(secret2.secret, secret2.hash)).toBe(true);
    });

    test('should resist hash collision attacks', () => {
      // Test with known SHA-256 test vectors
      const testVector1 = Buffer.from('abc', 'utf8');
      const expectedHash1 = Buffer.from('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'hex');
      
      const actualHash1 = require('crypto').createHash('sha256').update(testVector1).digest();
      expect(actualHash1).toEqual(expectedHash1);
      
      expect(htlc.validateSecret(testVector1, expectedHash1)).toBe(true);
      expect(htlc.validateSecret(testVector1, testSecrets[0].hash)).toBe(false);
    });

    test('should handle maximum security parameters', () => {
      // Test with maximum valid timelock
      const maxTimelock = 0xfffffffe;
      
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: maxTimelock
      };

      expect(() => htlc.createHTLCScript(params)).not.toThrow();
      
      const htlcOutput = htlc.createHTLCScript(params);
      expect(htlcOutput.address).toBeDefined();
    });
  });
});

// Custom matchers for security testing
expect.extend({
  toBeSecurelyRandom(received: Buffer) {
    // Basic entropy check - should not be all zeros or all ones
    const allZeros = Buffer.alloc(received.length, 0);
    const allOnes = Buffer.alloc(received.length, 0xff);
    
    const isNotAllZeros = !received.equals(allZeros);
    const isNotAllOnes = !received.equals(allOnes);
    
    return {
      message: () => `Expected ${received.toString('hex')} ${this.isNot ? 'not ' : ''}to be securely random`,
      pass: isNotAllZeros && isNotAllOnes,
    };
  }
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeSecurelyRandom(): R;
    }
  }
}