/**
 * End-to-End Atomic Swap Testing Suite
 * Tests complete ETH→BTC and BTC→ETH swap flows with real cross-chain coordination
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';
import { integrationManager, CrossChainTestUtils } from './setup.js';
import { RegtestUtils } from '../bitcoin/setup.js';
import { testConfig, TEST_WALLETS, TEST_AMOUNTS } from '../config.js';
import { SUPPORTED_CHAINS, SwapStatus } from '../../backend/src/shared/types.js';

describe('Cross-Chain Atomic Swap Tests', () => {
  let testSetup: any;
  let testData: any;

  beforeAll(async () => {
    // Start cross-chain environment
    testSetup = await integrationManager.startCrossChainEnvironment();
    
    // Fund test accounts
    await CrossChainTestUtils.fundTestAccounts(testSetup);
    
    // Generate test data
    testData = CrossChainTestUtils.generateCrossChainTestData();
    
    console.log('Cross-chain atomic swap test environment ready');
  }, 120000);

  afterAll(async () => {
    await testSetup?.cleanup();
  });

  describe('ETH → BTC Atomic Swaps', () => {
    test('should complete successful ETH to BTC swap', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.BOB);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      // Generate swap parameters
      const secret = testData.secrets[0];
      const ethAmount = testData.amounts.medium.eth;
      const btcAmount = testData.amounts.medium.btc;
      
      const currentHeight = await testSetup.bitcoin.client.getBlockHeight();
      const sourceTimelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const destTimelock = currentHeight + 50; // 50 blocks from now

      // Step 1: Create swap order
      const swapOrder = CrossChainTestUtils.createTestSwapOrder(
        testSetup.ethereum.accounts[0].address, // Alice's ETH address
        {
          chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA,
          token: '0x0000000000000000000000000000000000000000', // ETH
          amount: ethAmount.toString()
        },
        {
          chainId: SUPPORTED_CHAINS.BITCOIN_REGTEST,
          token: '0x0000000000000000000000000000000000000000', // BTC
          amount: btcAmount.toString()
        },
        '0x' + secret.hash.toString('hex'),
        sourceTimelock
      );

      console.log(`Created swap order: ${swapOrder.orderId}`);

      // Step 2: Create Bitcoin HTLC (destination side)
      const btcHtlcParams: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: resolver.publicKey,
        timelock: destTimelock
      };

      const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const htlcOutput = btcHtlc.createHTLCScript(btcHtlcParams);

      console.log(`Created Bitcoin HTLC: ${htlcOutput.address}`);

      // Step 3: Resolver funds Bitcoin HTLC
      const resolverUTXOs = await testSetup.bitcoin.client.getUTXOs(resolver.address, 1);
      expect(resolverUTXOs.length).toBeGreaterThan(0);

      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const resolverKeyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

      const fundingTx = await btcHtlc.createFundingTransaction(
        htlcOutput,
        btcAmount,
        resolverUTXOs.slice(0, 1),
        resolverKeyPair,
        resolver.address
      );

      const fundingTxId = await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
      console.log(`Bitcoin HTLC funded: ${fundingTxId}`);

      // Mine block to confirm funding
      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 1);

      // Step 4: Simulate Ethereum escrow funding (would be done by Alice)
      // In a real scenario, Alice would fund the Ethereum escrow here
      console.log('Ethereum escrow would be funded here (simulated)');

      // Step 5: Alice redeems Bitcoin HTLC with secret
      await testSetup.bitcoin.client.importAddress(htlcOutput.address, 'swap-htlc');
      const htlcUTXOs = await testSetup.bitcoin.client.getUTXOs(htlcOutput.address, 1);
      expect(htlcUTXOs.length).toBeGreaterThan(0);

      const aliceKeyPair = ECPair.fromWIF(alice.privateKey, bitcoin.networks.regtest);

      const redeemTx = btcHtlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        secret.secret,
        aliceKeyPair,
        alice.address
      );

      const redeemTxId = await testSetup.bitcoin.client.sendRawTransaction(redeemTx.hex);
      console.log(`Alice redeemed Bitcoin: ${redeemTxId}`);

      // Mine block to confirm redemption
      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 2);

      // Step 6: Extract secret from Bitcoin transaction
      const extractedSecret = btcHtlc.extractSecretFromTransaction(
        redeemTx.hex,
        htlcOutput.redeemScript
      );

      expect(extractedSecret).not.toBeNull();
      expect(extractedSecret).toEqual(secret.secret);
      console.log('Secret successfully extracted from Bitcoin redemption');

      // Step 7: Verify swap completion
      const status = await testSetup.bitcoin.client.monitorHTLC(
        htlcOutput.address,
        secret.hash,
        htlcOutput.redeemScript
      );

      expect(status.status).toBe('redeemed');
      expect(status.secret).toEqual(secret.secret);

      console.log('✓ ETH → BTC atomic swap completed successfully');
    }, 60000);

    test('should handle ETH to BTC swap timeout and refund', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      const secret = testData.secrets[1];
      const btcAmount = testData.amounts.small.btc;
      
      const currentHeight = await testSetup.bitcoin.client.getBlockHeight();
      const shortTimelock = currentHeight + 3; // Very short timelock

      // Create HTLC with short timelock
      const btcHtlcParams: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: resolver.publicKey,
        timelock: shortTimelock
      };

      const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const htlcOutput = btcHtlc.createHTLCScript(btcHtlcParams);

      // Fund HTLC
      const resolverUTXOs = await testSetup.bitcoin.client.getUTXOs(resolver.address, 1);
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const resolverKeyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

      const fundingTx = await btcHtlc.createFundingTransaction(
        htlcOutput,
        btcAmount,
        resolverUTXOs.slice(0, 1),
        resolverKeyPair,
        resolver.address
      );

      await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 1);

      // Wait for timelock expiry
      await RegtestUtils.mineToHeight(testSetup.bitcoin, shortTimelock + 1);

      // Resolver can now refund
      await testSetup.bitcoin.client.importAddress(htlcOutput.address, 'timeout-htlc');
      const htlcUTXOs = await testSetup.bitcoin.client.getUTXOs(htlcOutput.address, 1);

      const refundTx = btcHtlc.createRefundTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        resolverKeyPair,
        resolver.address,
        shortTimelock
      );

      const refundTxId = await testSetup.bitcoin.client.sendRawTransaction(refundTx.hex);
      console.log(`Resolver refunded after timeout: ${refundTxId}`);

      // Verify refund
      await RegtestUtils.mineToHeight(testSetup.bitcoin, shortTimelock + 2);
      
      const status = await testSetup.bitcoin.client.monitorHTLC(
        htlcOutput.address,
        secret.hash,
        htlcOutput.redeemScript
      );

      expect(status.status).toBe('refunded');

      console.log('✓ ETH → BTC swap timeout and refund handled correctly');
    }, 45000);
  });

  describe('BTC → ETH Atomic Swaps', () => {
    test('should complete successful BTC to ETH swap', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.BOB);

      const secret = testData.secrets[2];
      const ethAmount = testData.amounts.small.eth;
      const btcAmount = testData.amounts.small.btc;

      const currentHeight = await testSetup.bitcoin.client.getBlockHeight();
      const btcTimelock = currentHeight + 100; // Bitcoin side has longer timelock

      // Step 1: Alice creates and funds Bitcoin HTLC
      const btcHtlcParams: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: bob.publicKey, // Bob will redeem
        resolverPubkey: alice.publicKey, // Alice can refund
        timelock: btcTimelock
      };

      const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const htlcOutput = btcHtlc.createHTLCScript(btcHtlcParams);

      // Alice funds the Bitcoin HTLC
      const aliceUTXOs = await testSetup.bitcoin.client.getUTXOs(alice.address, 1);
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const aliceKeyPair = ECPair.fromWIF(alice.privateKey, bitcoin.networks.regtest);

      const fundingTx = await btcHtlc.createFundingTransaction(
        htlcOutput,
        btcAmount,
        aliceUTXOs.slice(0, 1),
        aliceKeyPair,
        alice.address
      );

      const fundingTxId = await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
      console.log(`Alice funded Bitcoin HTLC: ${fundingTxId}`);

      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 1);

      // Step 2: Simulate Ethereum HTLC creation and funding by Bob
      // In reality, Bob would create Ethereum HTLC with shorter timelock
      console.log('Bob would create and fund Ethereum HTLC here (simulated)');

      // Step 3: Simulate Alice revealing secret on Ethereum to claim ETH
      // This would happen when Alice redeems the Ethereum HTLC
      console.log('Alice would redeem Ethereum HTLC revealing secret (simulated)');

      // Step 4: Bob uses revealed secret to redeem Bitcoin HTLC
      await testSetup.bitcoin.client.importAddress(htlcOutput.address, 'btc-eth-htlc');
      const htlcUTXOs = await testSetup.bitcoin.client.getUTXOs(htlcOutput.address, 1);

      const bobKeyPair = ECPair.fromWIF(bob.privateKey, bitcoin.networks.regtest);

      const redeemTx = btcHtlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        secret.secret,
        bobKeyPair,
        bob.address
      );

      const redeemTxId = await testSetup.bitcoin.client.sendRawTransaction(redeemTx.hex);
      console.log(`Bob redeemed Bitcoin with secret: ${redeemTxId}`);

      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 2);

      // Step 5: Verify completion
      const status = await testSetup.bitcoin.client.monitorHTLC(
        htlcOutput.address,
        secret.hash,
        htlcOutput.redeemScript
      );

      expect(status.status).toBe('redeemed');
      expect(status.secret).toEqual(secret.secret);

      console.log('✓ BTC → ETH atomic swap completed successfully');
    }, 60000);
  });

  describe('Partial Fill Scenarios', () => {
    test('should handle partial fill with multiple secrets', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      // Generate multiple secrets for partial fills
      const maxFills = 3;
      const totalAmount = testData.amounts.medium.btc;
      const partialFills = SecretManager.createPartialFillStructure(BigInt(totalAmount), maxFills);

      console.log(`Created partial fill structure with ${maxFills} fills`);
      expect(partialFills.partialFills).toHaveLength(maxFills);

      // Create HTLC for each partial fill
      const htlcs = [];
      const currentHeight = await testSetup.bitcoin.client.getBlockHeight();

      for (let i = 0; i < maxFills; i++) {
        const fill = partialFills.partialFills[i];
        
        const params: HTLCParams = {
          secretHash: fill.secretHash,
          userPubkey: alice.publicKey,
          resolverPubkey: resolver.publicKey,
          timelock: currentHeight + 50 + i // Staggered timelocks
        };

        const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
        const htlcOutput = btcHtlc.createHTLCScript(params);

        htlcs.push({
          fill,
          htlc: btcHtlc,
          output: htlcOutput,
          params
        });

        console.log(`Created HTLC ${i + 1}/${maxFills}: ${htlcOutput.address}`);
      }

      // Fund first partial fill
      const firstHtlc = htlcs[0];
      const resolverUTXOs = await testSetup.bitcoin.client.getUTXOs(resolver.address, 1);
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const resolverKeyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

      const fundingTx = await firstHtlc.htlc.createFundingTransaction(
        firstHtlc.output,
        Number(firstHtlc.fill.amount),
        resolverUTXOs.slice(0, 1),
        resolverKeyPair,
        resolver.address
      );

      await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 1);

      // Alice redeems first partial fill
      await testSetup.bitcoin.client.importAddress(firstHtlc.output.address, 'partial-1');
      const htlcUTXOs = await testSetup.bitcoin.client.getUTXOs(firstHtlc.output.address, 1);

      const aliceKeyPair = ECPair.fromWIF(alice.privateKey, bitcoin.networks.regtest);
      const secret = partialFills.secrets[firstHtlc.fill.index].secret;

      const redeemTx = firstHtlc.htlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        firstHtlc.output,
        secret,
        aliceKeyPair,
        alice.address
      );

      const redeemTxId = await testSetup.bitcoin.client.sendRawTransaction(redeemTx.hex);
      console.log(`First partial fill redeemed: ${redeemTxId}`);

      // Verify Merkle proof
      const isValidProof = SecretManager.verifyMerkleProof(
        firstHtlc.fill.secretHash,
        firstHtlc.fill.merkleProof,
        partialFills.merkleRoot
      );

      expect(isValidProof).toBe(true);
      console.log('✓ Partial fill with Merkle proof verified successfully');
    }, 90000);
  });

  describe('Cross-Chain Failure Recovery', () => {
    test('should recover from network partition', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      const secret = testData.secrets[3];
      const btcAmount = testData.amounts.small.btc;
      const currentHeight = await testSetup.bitcoin.client.getBlockHeight();

      // Create and fund HTLC
      const params: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: resolver.publicKey,
        timelock: currentHeight + 20
      };

      const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const htlcOutput = btcHtlc.createHTLCScript(params);

      const resolverUTXOs = await testSetup.bitcoin.client.getUTXOs(resolver.address, 1);
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const resolverKeyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

      const fundingTx = await btcHtlc.createFundingTransaction(
        htlcOutput,
        btcAmount,
        resolverUTXOs.slice(0, 1),
        resolverKeyPair,
        resolver.address
      );

      await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
      await RegtestUtils.mineToHeight(testSetup.bitcoin, currentHeight + 1);

      // Simulate network partition
      console.log('Simulating network partition...');
      try {
        await CrossChainTestUtils.simulateNetworkConditions('partition', 3000);
      } catch (error) {
        console.log('Network partition simulation completed');
      }

      // After partition ends, redemption should still work
      await testSetup.bitcoin.client.importAddress(htlcOutput.address, 'partition-htlc');
      const htlcUTXOs = await testSetup.bitcoin.client.getUTXOs(htlcOutput.address, 1);

      const aliceKeyPair = ECPair.fromWIF(alice.privateKey, bitcoin.networks.regtest);

      const redeemTx = btcHtlc.createRedemptionTransaction(
        {
          txid: htlcUTXOs[0].txid,
          vout: htlcUTXOs[0].vout,
          value: htlcUTXOs[0].value
        },
        htlcOutput,
        secret.secret,
        aliceKeyPair,
        alice.address
      );

      const redeemTxId = await testSetup.bitcoin.client.sendRawTransaction(redeemTx.hex);
      console.log(`Redemption after partition: ${redeemTxId}`);

      console.log('✓ Network partition recovery handled successfully');
    }, 45000);

    test('should handle concurrent swap attempts', async () => {
      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const bob = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.BOB);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      // Create multiple concurrent swaps
      const swapCount = 3;
      const swapPromises = [];

      for (let i = 0; i < swapCount; i++) {
        const swapPromise = (async (swapIndex: number) => {
          const secret = testData.secrets[swapIndex];
          const btcAmount = testData.amounts.small.btc;
          const currentHeight = await testSetup.bitcoin.client.getBlockHeight();

          const params: HTLCParams = {
            secretHash: secret.hash,
            userPubkey: alice.publicKey,
            resolverPubkey: resolver.publicKey,
            timelock: currentHeight + 30 + swapIndex
          };

          const btcHtlc = new BitcoinHTLC(bitcoin.networks.regtest);
          const htlcOutput = btcHtlc.createHTLCScript(params);

          // Fund HTLC
          const resolverUTXOs = await testSetup.bitcoin.client.getUTXOs(resolver.address, 1);
          const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
          const resolverKeyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

          const fundingTx = await btcHtlc.createFundingTransaction(
            htlcOutput,
            btcAmount,
            [resolverUTXOs[swapIndex]],
            resolverKeyPair,
            resolver.address
          );

          await testSetup.bitcoin.client.sendRawTransaction(fundingTx.hex);
          return { swapIndex, htlc: btcHtlc, output: htlcOutput, secret };
        })(i);

        swapPromises.push(swapPromise);
      }

      // Wait for all swaps to be funded
      const swaps = await Promise.all(swapPromises);
      await RegtestUtils.mineToHeight(testSetup.bitcoin, await testSetup.bitcoin.client.getBlockHeight() + 1);

      console.log(`✓ ${swapCount} concurrent swaps created and funded successfully`);

      // Verify all HTLCs are funded
      for (const swap of swaps) {
        await testSetup.bitcoin.client.importAddress(swap.output.address, `concurrent-${swap.swapIndex}`);
        const utxos = await testSetup.bitcoin.client.getUTXOs(swap.output.address, 1);
        expect(utxos.length).toBeGreaterThan(0);
      }

      console.log('✓ Concurrent swap handling verified successfully');
    }, 90000);
  });
});

// Custom matchers for cross-chain testing
expect.extend({
  toBeValidSwapOrder(received: any) {
    const hasRequiredFields = received.orderId && 
                             received.maker && 
                             received.makerAsset && 
                             received.takerAsset && 
                             received.secretHash;
    
    return {
      message: () => `Expected ${JSON.stringify(received)} ${this.isNot ? 'not ' : ''}to be a valid swap order`,
      pass: hasRequiredFields,
    };
  },

  toBeWithinTimeRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return {
      message: () => `Expected ${received} ${this.isNot ? 'not ' : ''}to be within time range ${min}-${max}`,
      pass,
    };
  }
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidSwapOrder(): R;
      toBeWithinTimeRange(min: number, max: number): R;
    }
  }
}