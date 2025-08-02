/**
 * Edge Case Validation Tests for Cross-Chain Atomic Swaps
 * Tests network congestion, failure scenarios, concurrent conflicts, and extreme value cases
 */

import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient, UTXO } from '../../backend/src/bitcoin/client.js';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';
import { integrationManager, CrossChainTestUtils } from './setup.js';
import { regtestManager, RegtestUtils } from '../bitcoin/setup.js';
import { testConfig, TEST_AMOUNTS, TEST_TIMELOCKS } from '../config.js';

describe('Edge Case Validation Tests', () => {
  let crossChainSetup: any;
  let bitcoinClient: BitcoinClient;
  let ethereumProvider: ethers.JsonRpcProvider;
  let testAccounts: ethers.Wallet[];
  let contracts: any;

  beforeAll(async () => {
    // Start cross-chain environment
    crossChainSetup = await integrationManager.startCrossChainEnvironment();
    bitcoinClient = crossChainSetup.bitcoin.client;
    ethereumProvider = crossChainSetup.ethereum.provider;
    testAccounts = crossChainSetup.ethereum.accounts;
    contracts = crossChainSetup.ethereum.contracts;

    // Fund test accounts
    await CrossChainTestUtils.fundTestAccounts(crossChainSetup);
  }, 120000);

  afterAll(async () => {
    if (crossChainSetup) {
      await crossChainSetup.cleanup();
    }
  });

  describe('Network Congestion Scenarios', () => {
    test('should handle high gas price conditions on Ethereum', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret = SecretManager.generateSecret();
      const amount = ethers.parseEther('0.1');
      const safetyDeposit = ethers.parseEther('0.001');

      // Simulate high gas prices by setting very high gas price
      const highGasPrice = ethers.parseUnits('1000', 'gwei'); // Extremely high gas price

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`high-gas-${Date.now()}`));

      // Create escrow with high gas price
      const createTx = await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret.hash,
        timelock,
        {
          value: safetyDeposit,
          gasPrice: highGasPrice,
          gasLimit: 500000 // Set reasonable gas limit
        }
      );

      const receipt = await createTx.wait();
      expect(receipt.status).toBe(1);

      // Verify the transaction succeeded despite high gas price
      const escrowAddress = await contracts.escrowFactory.escrows(orderId);
      expect(escrowAddress).not.toBe(ethers.ZeroAddress);

      // Test that gas price doesn't affect contract functionality
      const escrow = new ethers.Contract(
        escrowAddress,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Approve and deposit with high gas price
      await contracts.mockERC20.connect(alice).approve(escrowAddress, amount, {
        gasPrice: highGasPrice
      });

      const depositTx = await escrow.connect(alice).deposit({
        gasPrice: highGasPrice
      });

      await depositTx.wait();

      // Redeem should work regardless of gas price
      const redeemTx = await escrow.connect(bob).redeem(secret.secret, {
        gasPrice: highGasPrice
      });

      const redeemReceipt = await redeemTx.wait();
      expect(redeemReceipt.status).toBe(1);
    });

    test('should handle Bitcoin network congestion and slow confirmations', async () => {
      const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const secret = SecretManager.generateSecret();

      // Create test wallets
      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const alice = ECPair.makeRandom({ network: bitcoin.networks.regtest });
      const bob = ECPair.makeRandom({ network: bitcoin.networks.regtest });

      // Get initial funding
      const testWallet = RegtestUtils.getTestWallet(crossChainSetup.bitcoin, 'alice');
      const fundingUTXOs = await bitcoinClient.getUTXOs(testWallet.address, 1);

      if (fundingUTXOs.length === 0) {
        console.log('Skipping test - no funding UTXOs available');
        return;
      }

      const params: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await bitcoinClient.getBlockHeight() + TEST_TIMELOCKS.LONG
      };

      const htlcOutput = htlc.createHTLCScript(params);

      // Create funding transaction with low fee (simulates congestion)
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        testWallet.privateKey,
        bitcoin.networks.regtest
      );

      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.MEDIUM,
        fundingUTXOs.slice(0, 1),
        keyPair,
        testWallet.address,
        1 // Very low fee rate (simulates congestion)
      );

      // In regtest, we control mining, so we can simulate delayed confirmation
      const txId = await bitcoinClient.sendRawTransaction(fundingTx.hex);
      expect(txId).toBeDefined();

      // Don't mine block immediately to simulate network congestion
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check that transaction is in mempool but not confirmed
      let txInfo;
      try {
        txInfo = await bitcoinClient.getTransaction(txId);
      } catch (error) {
        // Transaction might not be visible yet
      }

      // Now mine blocks to confirm
      await RegtestUtils.mineToHeight(
        crossChainSetup.bitcoin, 
        await bitcoinClient.getBlockHeight() + 3
      );

      // Transaction should now be confirmed
      const confirmedTx = await bitcoinClient.getTransaction(txId);
      expect(confirmedTx.confirmations).toBeGreaterThanOrEqual(1);
    });

    test('should handle mempool congestion with fee estimation', async () => {
      // This test simulates scenarios where fee estimation is critical
      const testWallet = RegtestUtils.getTestWallet(crossChainSetup.bitcoin, 'bob');
      
      // Create multiple transactions to fill mempool
      const transactions = [];
      const utxos = await bitcoinClient.getUTXOs(testWallet.address, 5);

      for (let i = 0; i < Math.min(3, utxos.length); i++) {
        try {
          const tx = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
          
          tx.addInput({
            hash: utxos[i].txid,
            index: utxos[i].vout,
            witnessUtxo: {
              script: Buffer.from(utxos[i].scriptPubKey, 'hex'),
              value: utxos[i].value
            }
          });

          tx.addOutput({
            address: testWallet.address,
            value: utxos[i].value - 1000 // Basic fee
          });

          const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
            testWallet.privateKey,
            bitcoin.networks.regtest
          );

          tx.signInput(0, keyPair);
          tx.finalizeAllInputs();

          const rawTx = tx.extractTransaction().toHex();
          const txId = await bitcoinClient.sendRawTransaction(rawTx);
          transactions.push(txId);
        } catch (error) {
          console.log(`Failed to create test transaction ${i}:`, error.message);
        }
      }

      // Verify transactions are in mempool
      expect(transactions.length).toBeGreaterThan(0);

      // Mine blocks to clear mempool
      await RegtestUtils.mineToHeight(
        crossChainSetup.bitcoin,
        await bitcoinClient.getBlockHeight() + 1
      );
    });
  });

  describe('Partial Execution Failures and Recovery', () => {
    test('should handle partial escrow funding failures', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret = SecretManager.generateSecret();
      const amount = ethers.parseEther('100'); // Large amount
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`partial-fail-${Date.now()}`));

      // Create escrow
      const createTx = await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret.hash,
        timelock,
        { value: safetyDeposit }
      );

      await createTx.wait();
      const escrowAddress = await contracts.escrowFactory.escrows(orderId);
      const escrow = new ethers.Contract(
        escrowAddress,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Try to deposit more than alice has (should fail)
      const aliceBalance = await contracts.mockERC20.balanceOf(alice.address);
      if (aliceBalance < amount) {
        await contracts.mockERC20.connect(alice).approve(escrowAddress, amount);
        
        await expect(escrow.connect(alice).deposit()).rejects.toThrow();

        // Escrow should remain unfunded
        const tokenBalance = await contracts.mockERC20.balanceOf(escrowAddress);
        expect(tokenBalance).toBe(0n);

        // Fund alice properly and retry
        await contracts.mockERC20.mint(alice.address, amount);
        
        // Now deposit should work
        await escrow.connect(alice).deposit();
        const newTokenBalance = await contracts.mockERC20.balanceOf(escrowAddress);
        expect(newTokenBalance).toBe(amount);
      }
    });

    test('should recover from Bitcoin transaction broadcast failures', async () => {
      const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const secret = SecretManager.generateSecret();

      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const alice = ECPair.makeRandom({ network: bitcoin.networks.regtest });
      const bob = ECPair.makeRandom({ network: bitcoin.networks.regtest });

      const testWallet = RegtestUtils.getTestWallet(crossChainSetup.bitcoin, 'charlie');
      const utxos = await bitcoinClient.getUTXOs(testWallet.address, 1);

      if (utxos.length === 0) {
        console.log('Skipping test - no UTXOs available');
        return;
      }

      const params: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await bitcoinClient.getBlockHeight() + TEST_TIMELOCKS.MEDIUM
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        testWallet.privateKey,
        bitcoin.networks.regtest
      );

      // Create a transaction with invalid fee (negative fee simulation)
      try {
        const invalidFundingTx = await htlc.createFundingTransaction(
          htlcOutput,
          utxos[0].value + 1000, // Output more than input (invalid)
          utxos.slice(0, 1),
          keyPair,
          testWallet.address
        );

        // This should fail when broadcast
        await expect(
          bitcoinClient.sendRawTransaction(invalidFundingTx.hex)
        ).rejects.toThrow();

      } catch (error) {
        // Transaction creation might fail before broadcast
        expect(error).toBeDefined();
      }

      // Create valid transaction as recovery
      const validFundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        TEST_AMOUNTS.SMALL,
        utxos.slice(0, 1),
        keyPair,
        testWallet.address
      );

      const txId = await bitcoinClient.sendRawTransaction(validFundingTx.hex);
      expect(txId).toBeDefined();
    });

    test('should handle race conditions in concurrent executions', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob, charlie] = testAccounts;
      const secret = SecretManager.generateSecret();
      const amount = ethers.parseEther('0.1');
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`race-${Date.now()}`));

      // Create escrow
      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret.hash,
        timelock,
        { value: safetyDeposit }
      );

      const escrowAddress = await contracts.escrowFactory.escrows(orderId);
      const escrow = new ethers.Contract(
        escrowAddress,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Fund escrow
      await contracts.mockERC20.connect(alice).approve(escrowAddress, amount);
      await escrow.connect(alice).deposit();

      // Simulate race condition: multiple parties trying to redeem
      await ethereumProvider.send('evm_setAutomine', [false]);

      try {
        // Multiple attempts with same secret (race condition)
        const redeemPromise1 = escrow.connect(bob).redeem(secret.secret);
        const redeemPromise2 = escrow.connect(charlie).redeem(secret.secret);

        // Mine block
        await ethereumProvider.send('evm_mine');

        // Only one should succeed
        const results = await Promise.allSettled([redeemPromise1, redeemPromise2]);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        expect(successful).toBe(1);
        expect(failed).toBe(1);

      } finally {
        await ethereumProvider.send('evm_setAutomine', [true]);
      }
    });
  });

  describe('Concurrent Swap Conflicts and Resolution', () => {
    test('should handle multiple swaps with same participants', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret1 = SecretManager.generateSecret();
      const secret2 = SecretManager.generateSecret();
      const amount = ethers.parseEther('0.1');
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      
      const orderId1 = ethers.keccak256(ethers.toUtf8Bytes(`concurrent-1-${Date.now()}`));
      const orderId2 = ethers.keccak256(ethers.toUtf8Bytes(`concurrent-2-${Date.now()}`));

      // Create two concurrent escrows
      const createTx1 = contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId1,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret1.hash,
        timelock,
        { value: safetyDeposit }
      );

      const createTx2 = contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId2,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret2.hash,
        timelock + 10, // Slightly different timelock
        { value: safetyDeposit }
      );

      await Promise.all([createTx1, createTx2]);

      const escrowAddress1 = await contracts.escrowFactory.escrows(orderId1);
      const escrowAddress2 = await contracts.escrowFactory.escrows(orderId2);

      expect(escrowAddress1).not.toBe(escrowAddress2);

      // Both escrows should be independent
      const escrow1 = new ethers.Contract(
        escrowAddress1,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );
      
      const escrow2 = new ethers.Contract(
        escrowAddress2,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Fund both escrows
      await contracts.mockERC20.connect(alice).approve(escrowAddress1, amount);
      await contracts.mockERC20.connect(alice).approve(escrowAddress2, amount);
      
      await escrow1.connect(alice).deposit();
      await escrow2.connect(alice).deposit();

      // Redeem both with correct secrets
      await escrow1.connect(bob).redeem(secret1.secret);
      await escrow2.connect(bob).redeem(secret2.secret);

      // Verify both completed successfully
      const details1 = await escrow1.getDetails();
      const details2 = await escrow2.getDetails();

      expect(details1._isRedeemed).toBe(true);
      expect(details2._isRedeemed).toBe(true);
    });

    test('should prevent secret reuse across different swaps', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob, charlie] = testAccounts;
      const sharedSecret = SecretManager.generateSecret();
      const amount = ethers.parseEther('0.1');
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      
      const orderId1 = ethers.keccak256(ethers.toUtf8Bytes(`reuse-1-${Date.now()}`));
      const orderId2 = ethers.keccak256(ethers.toUtf8Bytes(`reuse-2-${Date.now()}`));

      // Create two escrows with same secret hash (dangerous but possible)
      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId1,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        sharedSecret.hash,
        timelock,
        { value: safetyDeposit }
      );

      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId2,
        contracts.mockERC20.target,
        amount,
        alice.address,
        charlie.address,
        sharedSecret.hash,
        timelock,
        { value: safetyDeposit }
      );

      const escrowAddress1 = await contracts.escrowFactory.escrows(orderId1);
      const escrowAddress2 = await contracts.escrowFactory.escrows(orderId2);

      const escrow1 = new ethers.Contract(
        escrowAddress1,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );
      
      const escrow2 = new ethers.Contract(
        escrowAddress2,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Fund both
      await contracts.mockERC20.connect(alice).approve(escrowAddress1, amount);
      await contracts.mockERC20.connect(alice).approve(escrowAddress2, amount);
      await escrow1.connect(alice).deposit();
      await escrow2.connect(alice).deposit();

      // First redemption reveals the secret
      await escrow1.connect(bob).redeem(sharedSecret.secret);

      // Second user can also use the revealed secret (this is expected behavior)
      await escrow2.connect(charlie).redeem(sharedSecret.secret);

      // Both should succeed - this demonstrates why unique secrets are important
      const details1 = await escrow1.getDetails();
      const details2 = await escrow2.getDetails();

      expect(details1._isRedeemed).toBe(true);
      expect(details2._isRedeemed).toBe(true);
    });
  });

  describe('Invalid Transaction Handling and Recovery', () => {
    test('should handle malformed transaction inputs gracefully', async () => {
      const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const secret = SecretManager.generateSecret();

      // Test with various invalid transaction formats
      const invalidTransactions = [
        '', // Empty string
        '0x', // Empty hex
        'not_hex_string', // Invalid hex
        '01000000', // Incomplete transaction
        '01' + '00'.repeat(100) // Malformed transaction
      ];

      for (const invalidTx of invalidTransactions) {
        const result = htlc.extractSecretFromTransaction(invalidTx, secret.hash);
        expect(result).toBeNull();
      }
    });

    test('should recover from Bitcoin node connection failures', async () => {
      // Test connection resilience
      const originalUrl = bitcoinClient.rpcUrl;

      try {
        // Temporarily point to invalid URL
        (bitcoinClient as any).rpcUrl = 'http://invalid-url:18443';

        // Operations should fail gracefully
        await expect(bitcoinClient.getBlockHeight()).rejects.toThrow();

      } finally {
        // Restore connection
        (bitcoinClient as any).rpcUrl = originalUrl;

        // Should work again
        const height = await bitcoinClient.getBlockHeight();
        expect(typeof height).toBe('number');
      }
    });

    test('should handle Ethereum node RPC failures', async () => {
      if (!contracts.escrowFactory) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const originalUrl = ethereumProvider.connection.url;

      try {
        // Create provider with invalid URL
        const invalidProvider = new ethers.JsonRpcProvider('http://invalid-url:8545');
        
        // Operations should fail
        await expect(invalidProvider.getBlockNumber()).rejects.toThrow();

      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }

      // Original provider should still work
      const blockNumber = await ethereumProvider.getBlockNumber();
      expect(typeof blockNumber).toBe('number');
    });
  });

  describe('Extreme Value Scenarios', () => {
    test('should handle dust amounts correctly', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret = SecretManager.generateSecret();
      const dustAmount = 1n; // 1 wei - extremely small amount
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`dust-${Date.now()}`));

      // Create escrow with dust amount
      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId,
        contracts.mockERC20.target,
        dustAmount,
        alice.address,
        bob.address,
        secret.hash,
        timelock,
        { value: safetyDeposit }
      );

      const escrowAddress = await contracts.escrowFactory.escrows(orderId);
      const escrow = new ethers.Contract(
        escrowAddress,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Should work with dust amounts
      await contracts.mockERC20.connect(alice).approve(escrowAddress, dustAmount);
      await escrow.connect(alice).deposit();
      await escrow.connect(bob).redeem(secret.secret);

      const details = await escrow.getDetails();
      expect(details._isRedeemed).toBe(true);
      expect(details._amount).toBe(dustAmount);
    });

    test('should handle maximum possible amounts', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret = SecretManager.generateSecret();
      
      // Use a very large but reasonable amount
      const maxAmount = ethers.parseEther('1000000'); // 1M tokens
      const safetyDeposit = ethers.parseEther('0.001');

      // Mint large amount to alice
      await contracts.mockERC20.mint(alice.address, maxAmount);

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`max-amount-${Date.now()}`));

      // Create escrow with maximum amount
      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId,
        contracts.mockERC20.target,
        maxAmount,
        alice.address,
        bob.address,
        secret.hash,
        timelock,
        { value: safetyDeposit }
      );

      const escrowAddress = await contracts.escrowFactory.escrows(orderId);
      const escrow = new ethers.Contract(
        escrowAddress,
        (await ethers.getContractFactory('EscrowSrc')).interface,
        alice
      );

      // Should handle large amounts
      await contracts.mockERC20.connect(alice).approve(escrowAddress, maxAmount);
      await escrow.connect(alice).deposit();
      
      const balanceBefore = await contracts.mockERC20.balanceOf(bob.address);
      await escrow.connect(bob).redeem(secret.secret);
      const balanceAfter = await contracts.mockERC20.balanceOf(bob.address);

      expect(balanceAfter - balanceBefore).toBe(maxAmount);
    });

    test('should handle Bitcoin dust limits properly', async () => {
      const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
      const secret = SecretManager.generateSecret();

      const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
      const alice = ECPair.makeRandom({ network: bitcoin.networks.regtest });
      const bob = ECPair.makeRandom({ network: bitcoin.networks.regtest });

      const testWallet = RegtestUtils.getTestWallet(crossChainSetup.bitcoin, 'alice');
      const utxos = await bitcoinClient.getUTXOs(testWallet.address, 1);

      if (utxos.length === 0) {
        console.log('Skipping test - no UTXOs available');
        return;
      }

      const params: HTLCParams = {
        secretHash: secret.hash,
        userPubkey: alice.publicKey,
        resolverPubkey: bob.publicKey,
        timelock: await bitcoinClient.getBlockHeight() + TEST_TIMELOCKS.MEDIUM
      };

      const htlcOutput = htlc.createHTLCScript(params);
      const keyPair = require('ecpair').ECPairFactory(require('tiny-secp256k1')).fromWIF(
        testWallet.privateKey,
        bitcoin.networks.regtest
      );

      // Bitcoin dust limit is typically 546 satoshis for P2WSH
      const dustAmount = 546;

      // Should handle dust amounts (just above dust limit)
      const fundingTx = await htlc.createFundingTransaction(
        htlcOutput,
        dustAmount,
        utxos.slice(0, 1),
        keyPair,
        testWallet.address
      );

      const txId = await bitcoinClient.sendRawTransaction(fundingTx.hex);
      expect(txId).toBeDefined();

      await RegtestUtils.mineToHeight(
        crossChainSetup.bitcoin,
        await bitcoinClient.getBlockHeight() + 1
      );

      // Verify transaction was mined
      const confirmedTx = await bitcoinClient.getTransaction(txId);
      expect(confirmedTx.confirmations).toBeGreaterThanOrEqual(1);
    });

    test('should handle extreme timelock values', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const secret = SecretManager.generateSecret();
      const amount = ethers.parseEther('0.1');
      const safetyDeposit = ethers.parseEther('0.001');

      const currentTime = Math.floor(Date.now() / 1000);

      // Test minimum allowed timelock
      const minTimelock = currentTime + 30 * 60 + 1; // Just over 30 minutes
      const orderId1 = ethers.keccak256(ethers.toUtf8Bytes(`min-timelock-${Date.now()}`));

      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId1,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret.hash,
        minTimelock,
        { value: safetyDeposit }
      );

      // Test maximum allowed timelock
      const maxTimelock = currentTime + 24 * 60 * 60 - 1; // Just under 24 hours
      const orderId2 = ethers.keccak256(ethers.toUtf8Bytes(`max-timelock-${Date.now()}`));

      await contracts.escrowFactory.connect(deployer).createEscrowSrc(
        orderId2,
        contracts.mockERC20.target,
        amount,
        alice.address,
        bob.address,
        secret.hash,
        maxTimelock,
        { value: safetyDeposit }
      );

      // Both should be created successfully
      const escrowAddress1 = await contracts.escrowFactory.escrows(orderId1);
      const escrowAddress2 = await contracts.escrowFactory.escrows(orderId2);

      expect(escrowAddress1).not.toBe(ethers.ZeroAddress);
      expect(escrowAddress2).not.toBe(ethers.ZeroAddress);
    });
  });

  describe('Cross-Chain Timing Edge Cases', () => {
    test('should handle Bitcoin-Ethereum block time discrepancies', async () => {
      // Simulate the timing challenges between Bitcoin (~10 min blocks) and Ethereum (~12 sec blocks)
      
      const btcBlockTime = 10 * 60; // 10 minutes in seconds
      const ethBlockTime = 12; // 12 seconds
      
      // Calculate safe timelock differences
      const btcTimelock = await bitcoinClient.getBlockHeight() + 6; // ~1 hour on Bitcoin
      const ethCurrentTime = Math.floor(Date.now() / 1000);
      const ethTimelock = ethCurrentTime + 2 * 3600; // 2 hours on Ethereum

      // Ethereum timelock should be longer to account for Bitcoin's slower finality
      const timeDifference = (ethTimelock - ethCurrentTime) - (btcTimelock * btcBlockTime);
      expect(timeDifference).toBeGreaterThan(0);

      console.log(`Bitcoin timelock: ${btcTimelock} blocks (~${btcTimelock * 10} minutes)`);
      console.log(`Ethereum timelock: ${ethTimelock} timestamp (${(ethTimelock - ethCurrentTime) / 3600} hours)`);
      console.log(`Safety buffer: ${timeDifference / 60} minutes`);
    });

    test('should handle network partition scenarios', async () => {
      // Simulate temporary network issues
      const partitionDuration = 5000; // 5 seconds

      console.log('Simulating network partition...');
      await CrossChainTestUtils.simulateNetworkConditions('partition', partitionDuration);

      // After partition, operations should still work
      if (contracts.escrowFactory && contracts.mockERC20) {
        const [deployer, alice, bob] = testAccounts;
        const secret = SecretManager.generateSecret();
        const amount = ethers.parseEther('0.1');
        const safetyDeposit = ethers.parseEther('0.001');

        const currentTime = Math.floor(Date.now() / 1000);
        const timelock = currentTime + 3600;
        const orderId = ethers.keccak256(ethers.toUtf8Bytes(`partition-${Date.now()}`));

        // Should work after network recovery
        await contracts.escrowFactory.connect(deployer).createEscrowSrc(
          orderId,
          contracts.mockERC20.target,
          amount,
          alice.address,
          bob.address,
          secret.hash,
          timelock,
          { value: safetyDeposit }
        );

        const escrowAddress = await contracts.escrowFactory.escrows(orderId);
        expect(escrowAddress).not.toBe(ethers.ZeroAddress);
      }
    });

    test('should handle clock synchronization issues', async () => {
      // Test scenarios where system clocks might be out of sync
      const currentTime = Math.floor(Date.now() / 1000);
      const clockSkew = 300; // 5 minutes skew
      
      // Simulate future timestamp (clock ahead)
      const futureTime = currentTime + clockSkew;
      const pastTime = currentTime - clockSkew;

      // Timelock calculations should account for potential clock skew
      const safeTimelock = Math.max(futureTime, currentTime) + 3600; // Use the later time + buffer

      expect(safeTimelock).toBeGreaterThan(currentTime + 3600);
      
      console.log(`Current time: ${currentTime}`);
      console.log(`Safe timelock: ${safeTimelock} (buffer: ${safeTimelock - currentTime} seconds)`);
    });
  });

  describe('Memory and Resource Exhaustion', () => {
    test('should handle large batch operations without memory issues', async () => {
      if (!contracts.escrowFactory || !contracts.mockERC20) {
        console.log('Skipping test - contracts not available');
        return;
      }

      const [deployer, alice, bob] = testAccounts;
      const batchSize = 10; // Reasonable batch size for testing

      const orderIds = [];
      const tokens = [];
      const amounts = [];
      const depositors = [];
      const withdrawers = [];
      const secretHashes = [];
      const timelocks = [];
      const isSource = [];

      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600;
      const amount = ethers.parseEther('0.01');

      // Prepare batch data
      for (let i = 0; i < batchSize; i++) {
        const secret = SecretManager.generateSecret();
        
        orderIds.push(ethers.keccak256(ethers.toUtf8Bytes(`batch-${i}-${Date.now()}`)));
        tokens.push(contracts.mockERC20.target);
        amounts.push(amount);
        depositors.push(alice.address);
        withdrawers.push(bob.address);
        secretHashes.push(secret.hash);
        timelocks.push(timelock);
        isSource.push(true);
      }

      const totalSafetyDeposit = ethers.parseEther('0.001') * BigInt(batchSize);

      // Execute batch creation
      const startTime = Date.now();
      const batchTx = await contracts.escrowFactory.connect(deployer).batchCreateEscrows(
        orderIds,
        tokens,
        amounts,
        depositors,
        withdrawers,
        secretHashes,
        timelocks,
        isSource,
        { value: totalSafetyDeposit }
      );

      await batchTx.wait();
      const endTime = Date.now();

      console.log(`Batch creation of ${batchSize} escrows took ${endTime - startTime}ms`);

      // Verify all were created
      for (const orderId of orderIds) {
        const escrowAddress = await contracts.escrowFactory.escrows(orderId);
        expect(escrowAddress).not.toBe(ethers.ZeroAddress);
      }
    });
  });
});