/**
 * Comprehensive HTLC Testing Framework
 * Tests Bitcoin HTLC script creation, validation, and functionality
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';

describe('Bitcoin HTLC Script Tests', () => {
  let htlc: BitcoinHTLC;
  let testNetwork: bitcoin.Network;
  let testSecrets: Array<{ secret: Buffer; hash: Buffer }>;
  let testKeyPairs: Array<any>;

  beforeAll(async () => {
    // Use regtest network for testing
    testNetwork = bitcoin.networks.regtest;
    htlc = new BitcoinHTLC(testNetwork);

    // Generate test key pairs
    const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
    testKeyPairs = [
      ECPair.makeRandom({ network: testNetwork }), // User key
      ECPair.makeRandom({ network: testNetwork })  // Resolver key
    ];

    // Generate test secrets
    testSecrets = [
      SecretManager.generateSecret(),
      SecretManager.generateSecret(),
      SecretManager.generateSecret()
    ];
  });

  describe('HTLC Script Creation', () => {
    test('should create valid HTLC script with correct parameters', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);

      // Validate outputs
      expect(htlcOutput.script).toBeDefined();
      expect(htlcOutput.address).toBeDefined();
      expect(htlcOutput.redeemScript).toBeDefined();
      expect(htlcOutput.address).toBeBitcoinAddress();
      
      // Address should be bech32 (P2WSH)
      expect(htlcOutput.address).toMatch(/^bcrt1/);
    });

    test('should create different addresses for different parameters', () => {
      const params1: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const params2: HTLCParams = {
        secretHash: testSecrets[1].hash, // Different secret
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlc1 = htlc.createHTLCScript(params1);
      const htlc2 = htlc.createHTLCScript(params2);

      expect(htlc1.address).not.toBe(htlc2.address);
      expect(htlc1.script).not.toEqual(htlc2.script);
      expect(htlc1.redeemScript).not.toEqual(htlc2.redeemScript);
    });

    test('should reject invalid secret hash length', () => {
      const invalidHash = Buffer.from('invalid', 'hex');
      
      const params: HTLCParams = {
        secretHash: invalidHash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      expect(() => htlc.createHTLCScript(params)).toThrow('Secret hash must be 32 bytes');
    });

    test('should reject invalid timelock values', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 0 // Invalid
      };

      expect(() => htlc.createHTLCScript(params)).toThrow('Invalid timelock value');

      params.timelock = 0xffffffff; // Also invalid
      expect(() => htlc.createHTLCScript(params)).toThrow('Invalid timelock value');
    });

    test('should handle different timelock values correctly', () => {
      const shortTimelock: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 100
      };

      const longTimelock: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000000
      };

      const htlcShort = htlc.createHTLCScript(shortTimelock);
      const htlcLong = htlc.createHTLCScript(longTimelock);

      expect(htlcShort.address).not.toBe(htlcLong.address);
    });
  });

  describe('HTLC Script Validation', () => {
    test('should validate secret correctly', () => {
      const secret = testSecrets[0].secret;
      const hash = testSecrets[0].hash;
      const wrongSecret = testSecrets[1].secret;

      expect(htlc.validateSecret(secret, hash)).toBe(true);
      expect(htlc.validateSecret(wrongSecret, hash)).toBe(false);
      expect(htlc.validateSecret(Buffer.alloc(0), hash)).toBe(false);
    });

    test('should generate and validate random secrets', () => {
      const { secret, hash } = htlc.generateSecret();

      expect(secret).toHaveLength(32);
      expect(hash).toHaveLength(32);
      expect(htlc.validateSecret(secret, hash)).toBe(true);
      
      // Different generation should produce different results
      const { secret: secret2, hash: hash2 } = htlc.generateSecret();
      expect(secret).not.toEqual(secret2);
      expect(hash).not.toEqual(hash2);
    });
  });

  describe('HTLC Script Analysis', () => {
    test('should extract correct script elements', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const script = htlcOutput.redeemScript;

      // Decompile script to verify structure
      const decompiled = bitcoin.script.decompile(script);
      
      expect(decompiled).toBeDefined();
      if (decompiled) {
        // Verify script structure contains expected opcodes
        expect(decompiled).toContain(bitcoin.opcodes.OP_IF);
        expect(decompiled).toContain(bitcoin.opcodes.OP_SHA256);
        expect(decompiled).toContain(bitcoin.opcodes.OP_EQUALVERIFY);
        expect(decompiled).toContain(bitcoin.opcodes.OP_CHECKSIG);
        expect(decompiled).toContain(bitcoin.opcodes.OP_ELSE);
        expect(decompiled).toContain(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY);
        expect(decompiled).toContain(bitcoin.opcodes.OP_DROP);
        expect(decompiled).toContain(bitcoin.opcodes.OP_ENDIF);
        
        // Verify script contains our parameters
        expect(decompiled).toContain(testSecrets[0].hash);
        expect(decompiled).toContain(testKeyPairs[0].publicKey);
        expect(decompiled).toContain(testKeyPairs[1].publicKey);
      }
    });
  });

  describe('HTLC Script Size and Efficiency', () => {
    test('should generate compact scripts', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // HTLC scripts should be reasonably sized
      expect(htlcOutput.redeemScript.length).toBeLessThan(200);
      expect(htlcOutput.script.length).toBe(34); // P2WSH is always 34 bytes
    });

    test('should estimate transaction sizes accurately', () => {
      const fundingSize = htlc.estimateTransactionSize(2, 1, true); // 2 inputs, 1 output, witness
      const redeemSize = htlc.estimateTransactionSize(1, 1, true);   // 1 input, 1 output, witness
      
      expect(fundingSize).toBeWithinRange(100, 300);
      expect(redeemSize).toBeWithinRange(100, 250);
      
      // Witness transactions should be smaller than legacy
      const legacySize = htlc.estimateTransactionSize(2, 1, false);
      expect(fundingSize).toBeLessThan(legacySize);
    });
  });

  describe('HTLC Edge Cases', () => {
    test('should handle compressed and uncompressed public keys', () => {
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const compressedKey = ECPair.makeRandom({ network: testNetwork, compressed: true });
      const uncompressedKey = ECPair.makeRandom({ network: testNetwork, compressed: false });

      const paramsCompressed: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: compressedKey.publicKey,
        resolverPubkey: compressedKey.publicKey,
        timelock: 1000
      };

      const paramsUncompressed: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: uncompressedKey.publicKey,
        resolverPubkey: uncompressedKey.publicKey,
        timelock: 1000
      };

      expect(() => htlc.createHTLCScript(paramsCompressed)).not.toThrow();
      expect(() => htlc.createHTLCScript(paramsUncompressed)).not.toThrow();
    });

    test('should handle maximum timelock values', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 0xfffffffe // Maximum valid timelock
      };

      expect(() => htlc.createHTLCScript(params)).not.toThrow();
    });

    test('should handle identical user and resolver keys', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[0].publicKey, // Same key
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      expect(htlcOutput.address).toBeDefined();
      expect(htlcOutput.address).toBeBitcoinAddress();
    });
  });

  describe('HTLC Security Properties', () => {
    test('should produce deterministic outputs for same inputs', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlc1 = htlc.createHTLCScript(params);
      const htlc2 = htlc.createHTLCScript(params);

      expect(htlc1.address).toBe(htlc2.address);
      expect(htlc1.script).toEqual(htlc2.script);
      expect(htlc1.redeemScript).toEqual(htlc2.redeemScript);
    });

    test('should prevent script malleability', () => {
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: testKeyPairs[0].publicKey,
        resolverPubkey: testKeyPairs[1].publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // P2WSH scripts are not malleable
      // The script commitment is in the output script, not the input script
      expect(htlcOutput.script[0]).toBe(0); // OP_0 for witness v0
      expect(htlcOutput.script.length).toBe(34);
    });
  });

  describe('HTLC Network Compatibility', () => {
    test('should work with different Bitcoin networks', () => {
      const networks = [
        bitcoin.networks.bitcoin,  // Mainnet
        bitcoin.networks.testnet,  // Testnet
        bitcoin.networks.regtest   // Regtest
      ];

      networks.forEach((network) => {
        const networkHTLC = new BitcoinHTLC(network);
        const params: HTLCParams = {
          secretHash: testSecrets[0].hash,
          userPubkey: testKeyPairs[0].publicKey,
          resolverPubkey: testKeyPairs[1].publicKey,
          timelock: 1000
        };

        const htlcOutput = networkHTLC.createHTLCScript(params);
        expect(htlcOutput.address).toBeDefined();
        
        // Check address prefix matches network
        if (network === bitcoin.networks.bitcoin) {
          expect(htlcOutput.address).toMatch(/^bc1/);
        } else if (network === bitcoin.networks.testnet) {
          expect(htlcOutput.address).toMatch(/^tb1/);
        } else if (network === bitcoin.networks.regtest) {
          expect(htlcOutput.address).toMatch(/^bcrt1/);
        }
      });
    });
  });
});

// Custom Jest matchers for Bitcoin testing
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeBitcoinAddress(): R;
      toBeWithinRange(min: number, max: number): R;
    }
  }
}

// Simple implementations of custom matchers
expect.extend({
  toBeBitcoinAddress(received: string) {
    const isValidAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$|^tb1[a-z0-9]{39,59}$|^bcrt1[a-z0-9]{39,59}$/.test(received);
    return {
      message: () => `Expected ${received} ${this.isNot ? 'not ' : ''}to be a valid Bitcoin address`,
      pass: isValidAddress,
    };
  },
  
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return {
      message: () => `Expected ${received} ${this.isNot ? 'not ' : ''}to be within range ${min}-${max}`,
      pass,
    };
  }
});