/**
 * Bitcoin Transaction Testing Suite
 * Tests funding, redemption, and refund transactions for HTLCs
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient, UTXO } from '../../backend/src/bitcoin/client.js';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';
import { regtestManager, RegtestUtils } from './setup.js';
import { testConfig, TEST_WALLETS, TEST_AMOUNTS } from '../config.js';

describe('Bitcoin Transaction Tests', () => {
  let client: BitcoinClient;
  let htlc: BitcoinHTLC;
  let testSetup: any;
  let testSecrets: Array<{ secret: Buffer; hash: Buffer }>;
  let testKeyPairs: Array<any>;

  beforeAll(async () => {
    // Start regtest node
    testSetup = await regtestManager.startRegtestNode();
    client = testSetup.client;
    htlc = new BitcoinHTLC(bitcoin.networks.regtest);

    // Generate test data
    const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
    testKeyPairs = [
      ECPair.makeRandom({ network: bitcoin.networks.regtest }),
      ECPair.makeRandom({ network: bitcoin.networks.regtest })
    ];

    testSecrets = [
      SecretManager.generateSecret(),
      SecretManager.generateSecret()
    ];
  }, 60000);

  afterAll(async () => {
    await testSetup?.cleanup();
  });

  describe('HTLC Funding Transactions', () => {
    test('should create and broadcast funding transaction', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      // Create HTLC
      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Get Alice's UTXOs
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      expect(aliceUTXOs.length).toBeGreaterThan(0);

      // Create funding transaction
      const fundingAmount = TEST_AMOUNTS.SMALL;
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        fundingAmount,
        aliceUTXOs.slice(0, 1),
        keyPair,
        alice.address
      );

      expect(fundingTx.txid).toBeDefined();
      expect(fundingTx.hex).toBeDefined();
      expect(fundingTx.txid).toBeTransactionId();

      // Broadcast transaction
      const broadcastTxId = await client.sendRawTransaction(fundingTx.hex);
      expect(broadcastTxId).toBe(fundingTx.txid);

      // Wait for transaction confirmation
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);
      
      const confirmedTx = await client.getTransaction(broadcastTxId);
      expect(confirmedTx.confirmations).toBeGreaterThan(0);
    }, 30000);

    test('should handle insufficient funds gracefully', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Create a small UTXO that's insufficient
      const smallUTXO = {
        txid: '0'.repeat(64),
        vout: 0,
        value: 1000, // Very small amount
        scriptPubKey: '001412345678901234567890123456789012'
      };

      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      // This should fail due to insufficient funds
      await expect(
        htlc.createFundingTransaction(
          htlcOutput,
          TEST_AMOUNTS.LARGE, // Much larger than available
          [smallUTXO],
          keyPair,
          alice.address
        )
      ).rejects.toThrow();
    });

    test('should calculate fees correctly', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: 1000
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const aliceUTXOs = await client.getUTXOs(alice.address, 1);
      
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      // Test different fee rates
      const lowFeeTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        aliceUTXOs.slice(0, 1),
        keyPair,
        alice.address,
        1 // 1 sat/vbyte
      );

      const highFeeTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        aliceUTXOs.slice(1, 2),
        keyPair,
        alice.address,
        50 // 50 sat/vbyte
      );

      // High fee transaction should be larger in byte size due to fee calculation
      expect(lowFeeTx.vsize).toBeLessThanOrEqual(highFeeTx.vsize);
    });
  });

  describe('HTLC Redemption Transactions', () => {
    let htlcUTXO: UTXO;
    let htlcOutput: any;
    let fundingTxId: string;

    beforeEach(async () => {
      // Setup: Create and fund an HTLC
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await client.getBlockHeight() + 100 // Future timelock
      };

      htlcOutput = htlc.createHTLCScript(params);
      
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

      fundingTxId = await client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);

      // Import HTLC address and get its UTXO
      await client.importAddress(htlcOutput.address, 'test-htlc');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);
      expect(htlcUTXOs.length).toBeGreaterThan(0);
      htlcUTXO = htlcUTXOs[0];
    });

    test('should create valid redemption transaction with correct secret', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const redeemTx = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXO.txid,
          vout: htlcUTXO.vout,
          value: htlcUTXO.value
        },
        htlcOutput,
        testSecrets[0].secret,
        keyPair,
        alice.address
      );

      expect(redeemTx.txid).toBeDefined();
      expect(redeemTx.hex).toBeDefined();
      expect(redeemTx.txid).toBeTransactionId();

      // Broadcast redemption transaction
      const redeemTxId = await client.sendRawTransaction(redeemTx.hex);
      expect(redeemTxId).toBe(redeemTx.txid);

      // Confirm transaction
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);
      
      const confirmedTx = await client.getTransaction(redeemTxId);
      expect(confirmedTx.confirmations).toBeGreaterThan(0);
    });

    test('should extract secret from redemption transaction', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        alice.privateKey, 
        bitcoin.networks.regtest
      );

      const redeemTx = htlc.createRedemptionTransaction(
        {
          txid: htlcUTXO.txid,
          vout: htlcUTXO.vout,
          value: htlcUTXO.value
        },
        htlcOutput,
        testSecrets[0].secret,
        keyPair,
        alice.address
      );

      // Extract secret from transaction
      const extractedSecret = htlc.extractSecretFromTransaction(
        redeemTx.hex, 
        htlcOutput.redeemScript
      );

      expect(extractedSecret).not.toBeNull();
      if (extractedSecret) {
        expect(extractedSecret).toEqual(testSecrets[0].secret);
        expect(htlc.validateSecret(extractedSecret, testSecrets[0].hash)).toBe(true);
      }
    });
  });

  describe('HTLC Refund Transactions', () => {
    let htlcUTXO: UTXO;
    let htlcOutput: any;
    let timelock: number;

    beforeEach(async () => {
      // Setup: Create and fund an HTLC with short timelock
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      const currentHeight = await client.getBlockHeight();
      timelock = currentHeight + 5; // Short timelock for testing

      const params: HTLCParams = {
        secretHash: testSecrets[1].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock
      };

      htlcOutput = htlc.createHTLCScript(params);
      
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

      await client.importAddress(htlcOutput.address, 'test-htlc-refund');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);
      htlcUTXO = htlcUTXOs[0];
    });

    test('should fail refund before timelock expiry', async () => {
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        bob.privateKey, 
        bitcoin.networks.regtest
      );

      // Current height should be less than timelock
      const currentHeight = await client.getBlockHeight();
      expect(currentHeight).toBeLessThan(timelock);

      const refundTx = htlc.createRefundTransaction(
        {
          txid: htlcUTXO.txid,
          vout: htlcUTXO.vout,
          value: htlcUTXO.value
        },
        htlcOutput,
        keyPair,
        bob.address,
        timelock
      );

      // This should fail when broadcast due to CLTV
      await expect(
        client.sendRawTransaction(refundTx.hex)
      ).rejects.toThrow();
    });

    test('should succeed refund after timelock expiry', async () => {
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);
      
      // Mine blocks to exceed timelock
      await RegtestUtils.mineToHeight(testSetup, timelock + 1);
      
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        bob.privateKey, 
        bitcoin.networks.regtest
      );

      const refundTx = htlc.createRefundTransaction(
        {
          txid: htlcUTXO.txid,
          vout: htlcUTXO.vout,
          value: htlcUTXO.value
        },
        htlcOutput,
        keyPair,
        bob.address,
        timelock
      );

      expect(refundTx.txid).toBeDefined();
      expect(refundTx.hex).toBeDefined();

      // Should successfully broadcast after timelock
      const refundTxId = await client.sendRawTransaction(refundTx.hex);
      expect(refundTxId).toBe(refundTx.txid);

      // Confirm transaction
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);
      
      const confirmedTx = await client.getTransaction(refundTxId);
      expect(confirmedTx.confirmations).toBeGreaterThan(0);
    });
  });

  describe('Transaction Monitoring', () => {
    test('should monitor HTLC status correctly', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await client.getBlockHeight() + 100
      };

      const htlcOutput = htlc.createHTLCScript(params);
      
      // Initial status should be pending
      let status = await client.monitorHTLC(
        htlcOutput.address,
        testSecrets[0].hash,
        htlcOutput.redeemScript
      );
      expect(status.status).toBe('pending');

      // Fund the HTLC
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

      // Status should now be funded
      await client.importAddress(htlcOutput.address, 'monitor-test');
      status = await client.monitorHTLC(
        htlcOutput.address,
        testSecrets[0].hash,
        htlcOutput.redeemScript
      );
      
      expect(status.status).toBe('funded');
      expect(status.fundingTxid).toBeDefined();
      expect(status.amount).toBeGreaterThan(0);
    });

    test('should detect HTLC redemption', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup, TEST_WALLETS.BOB);

      const params: HTLCParams = {
        secretHash: testSecrets[0].hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await client.getBlockHeight() + 100
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
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 1);

      await client.importAddress(htlcOutput.address, 'redeem-test');
      const htlcUTXOs = await client.getUTXOs(htlcOutput.address, 1);
      
      // Redeem HTLC
      const redeemTx = htlc.createRedemptionTransaction(
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

      await client.sendRawTransaction(redeemTx.hex);
      await RegtestUtils.mineToHeight(testSetup, await client.getBlockHeight() + 2);

      // Check status - should be redeemed with secret
      const status = await client.monitorHTLC(
        htlcOutput.address,
        testSecrets[0].hash,
        htlcOutput.redeemScript
      );

      expect(status.status).toBe('redeemed');
      expect(status.redeemTxid).toBeDefined();
      expect(status.secret).toBeDefined();
      if (status.secret) {
        expect(status.secret).toEqual(testSecrets[0].secret);
      }
    });
  });

  describe('Transaction Fee Estimation', () => {
    test('should estimate transaction fees accurately', async () => {
      const estimatedFunding = htlc.estimateTransactionSize(2, 2, true);
      const estimatedRedemption = htlc.estimateTransactionSize(1, 1, true);
      const estimatedRefund = htlc.estimateTransactionSize(1, 1, true);

      expect(estimatedFunding).toBeWithinRange(150, 300);
      expect(estimatedRedemption).toBeWithinRange(100, 200);
      expect(estimatedRefund).toBeWithinRange(100, 200);

      // Test with different input/output counts
      const largeTx = htlc.estimateTransactionSize(5, 3, true);
      expect(largeTx).toBeGreaterThan(estimatedFunding);
    });

    test('should handle different fee rates', async () => {
      const currentFeeRate = await client.getFeeRate();
      expect(currentFeeRate).toBeGreaterThan(0);

      const fastFeeRate = await client.getFeeRate(1);
      const slowFeeRate = await client.getFeeRate(10);

      expect(fastFeeRate).toBeGreaterThanOrEqual(slowFeeRate);
    });
  });
});

// Custom matchers (same as in htlc.test.ts)
expect.extend({
  toBeTransactionId(received: string) {
    const isValidTxId = /^[a-fA-F0-9]{64}$/.test(received);
    return {
      message: () => `Expected ${received} ${this.isNot ? 'not ' : ''}to be a valid transaction ID`,
      pass: isValidTxId,
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

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeTransactionId(): R;
      toBeWithinRange(min: number, max: number): R;
    }
  }
}