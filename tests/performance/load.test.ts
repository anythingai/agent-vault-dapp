/**
 * Bitcoin HTLC Performance and Load Testing Suite
 * Tests system performance under various load conditions and benchmarks
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinHTLC, HTLCParams } from '../../backend/src/bitcoin/htlc.js';
import { SecretManager } from '../../backend/src/shared/secrets.js';
import { integrationManager, CrossChainTestUtils } from '../integration/setup.js';
import { RegtestUtils } from '../bitcoin/setup.js';
import { testConfig, TEST_WALLETS, TEST_AMOUNTS } from '../config.js';

interface PerformanceMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  throughput: number; // operations per second
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  duration: number;
}

interface LoadTestResult {
  testName: string;
  metrics: PerformanceMetrics;
  errors: string[];
  warnings: string[];
}

describe('Bitcoin HTLC Performance Tests', () => {
  let testSetup: any;
  let performanceResults: LoadTestResult[] = [];

  beforeAll(async () => {
    // Start cross-chain environment with extended timeout
    testSetup = await integrationManager.startCrossChainEnvironment();
    await CrossChainTestUtils.fundTestAccounts(testSetup);
    console.log('Performance test environment ready');
  }, 180000);

  afterAll(async () => {
    // Generate performance report
    generatePerformanceReport();
    await testSetup?.cleanup();
  });

  describe('HTLC Creation Performance', () => {
    test('should benchmark HTLC script creation', async () => {
      const testName = 'HTLC Script Creation Benchmark';
      const iterations = 1000;
      const metrics = await benchmarkOperation(
        testName,
        async () => {
          const secret = SecretManager.generateSecret();
          const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
          const keyPairs = [
            ECPair.makeRandom({ network: bitcoin.networks.regtest }),
            ECPair.makeRandom({ network: bitcoin.networks.regtest })
          ];

          const params: HTLCParams = {
            secretHash: secret.hash,
            userPubkey: keyPairs[0].publicKey,
            resolverPubkey: keyPairs[1].publicKey,
            timelock: 1000
          };

          const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
          const output = htlc.createHTLCScript(params);
          
          return { success: true, data: output };
        },
        iterations
      );

      expect(metrics.successfulOperations).toBe(iterations);
      expect(metrics.averageLatency).toBeLessThan(10); // Should be under 10ms per operation
      expect(metrics.throughput).toBeGreaterThan(100); // Should handle 100+ ops/sec

      performanceResults.push({
        testName,
        metrics,
        errors: [],
        warnings: metrics.averageLatency > 5 ? ['High latency detected'] : []
      });

      console.log(`✓ ${testName}: ${metrics.throughput.toFixed(2)} ops/sec, ${metrics.averageLatency.toFixed(2)}ms avg`);
    }, 60000);

    test('should test HTLC creation with various key sizes', async () => {
      const testName = 'HTLC Creation - Key Size Variations';
      const iterations = 500;

      const metrics = await benchmarkOperation(
        testName,
        async () => {
          const secret = SecretManager.generateSecret();
          const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
          
          // Mix compressed and uncompressed keys
          const useCompressed = Math.random() > 0.5;
          const keyPairs = [
            ECPair.makeRandom({ network: bitcoin.networks.regtest, compressed: useCompressed }),
            ECPair.makeRandom({ network: bitcoin.networks.regtest, compressed: !useCompressed })
          ];

          const params: HTLCParams = {
            secretHash: secret.hash,
            userPubkey: keyPairs[0].publicKey,
            resolverPubkey: keyPairs[1].publicKey,
            timelock: Math.floor(Math.random() * 1000000) + 1000
          };

          const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
          const output = htlc.createHTLCScript(params);
          
          return { success: true, data: output };
        },
        iterations
      );

      performanceResults.push({
        testName,
        metrics,
        errors: [],
        warnings: []
      });

      console.log(`✓ ${testName}: ${metrics.throughput.toFixed(2)} ops/sec`);
    }, 45000);
  });

  describe('Transaction Performance', () => {
    test('should benchmark funding transaction creation', async () => {
      const testName = 'Funding Transaction Creation';
      const iterations = 100;

      // Pre-generate test data
      const testData = [];
      for (let i = 0; i < iterations; i++) {
        const secret = SecretManager.generateSecret();
        const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
        const keyPair = ECPair.makeRandom({ network: bitcoin.networks.regtest });
        
        const params: HTLCParams = {
          secretHash: secret.hash,
          userPubkey: keyPair.publicKey,
          resolverPubkey: keyPair.publicKey,
          timelock: 1000 + i
        };

        const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
        const output = htlc.createHTLCScript(params);

        testData.push({ htlc, output, keyPair });
      }

      const metrics = await benchmarkOperation(
        testName,
        async (index: number) => {
          const { htlc, output, keyPair } = testData[index];
          
          // Mock UTXO
          const mockUTXO = {
            txid: '1234567890abcdef'.repeat(4),
            vout: 0,
            value: TEST_AMOUNTS.MEDIUM,
            scriptPubKey: '001412345678901234567890123456789012'
          };

          const fundingTx = await htlc.createFundingTransaction(
            output,
            TEST_AMOUNTS.SMALL,
            [mockUTXO],
            keyPair,
            'bcrt1qtest1234567890123456789012345678901234',
            10
          );

          return { success: true, data: fundingTx };
        },
        iterations,
        true // Pass index to operation
      );

      expect(metrics.successfulOperations).toBe(iterations);
      expect(metrics.averageLatency).toBeLessThan(100); // Should be under 100ms per transaction

      performanceResults.push({
        testName,
        metrics,
        errors: [],
        warnings: metrics.averageLatency > 50 ? ['High transaction creation latency'] : []
      });

      console.log(`✓ ${testName}: ${metrics.throughput.toFixed(2)} tx/sec, ${metrics.averageLatency.toFixed(2)}ms avg`);
    }, 90000);

    test('should test transaction size optimization', async () => {
      const testName = 'Transaction Size Optimization';
      const scenarios = [
        { inputs: 1, outputs: 1, desc: 'Simple' },
        { inputs: 2, outputs: 2, desc: 'Standard' },
        { inputs: 5, outputs: 3, desc: 'Complex' },
        { inputs: 10, outputs: 1, desc: 'Consolidation' }
      ];

      const results = [];

      for (const scenario of scenarios) {
        const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
        const estimatedSize = htlc.estimateTransactionSize(scenario.inputs, scenario.outputs, true);
        
        results.push({
          scenario: scenario.desc,
          inputs: scenario.inputs,
          outputs: scenario.outputs,
          estimatedSize,
          efficiency: scenario.inputs / estimatedSize // inputs per byte
        });
      }

      // Log results
      console.log('Transaction Size Analysis:');
      results.forEach(result => {
        console.log(`  ${result.scenario}: ${result.inputs}→${result.outputs} = ${result.estimatedSize} bytes (${result.efficiency.toFixed(4)} inputs/byte)`);
      });

      // Verify efficiency
      expect(results[0].estimatedSize).toBeLessThan(250); // Simple tx should be under 250 bytes
      expect(results[3].efficiency).toBeGreaterThan(results[0].efficiency); // Consolidation should be more efficient

      console.log(`✓ Transaction size optimization analysis completed`);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent HTLC operations', async () => {
      const testName = 'Concurrent HTLC Operations';
      const concurrency = 20;
      const operationsPerWorker = 50;

      const startTime = Date.now();
      const workers = [];
      let totalOperations = 0;
      let successfulOperations = 0;
      const latencies: number[] = [];

      for (let i = 0; i < concurrency; i++) {
        const worker = (async (workerId: number) => {
          const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
          let workerSuccesses = 0;

          for (let j = 0; j < operationsPerWorker; j++) {
            const opStartTime = Date.now();
            
            try {
              const secret = SecretManager.generateSecret();
              const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
              const keyPairs = [
                ECPair.makeRandom({ network: bitcoin.networks.regtest }),
                ECPair.makeRandom({ network: bitcoin.networks.regtest })
              ];

              const params: HTLCParams = {
                secretHash: secret.hash,
                userPubkey: keyPairs[0].publicKey,
                resolverPubkey: keyPairs[1].publicKey,
                timelock: 1000 + workerId * operationsPerWorker + j
              };

              const output = htlc.createHTLCScript(params);
              
              // Simulate additional validation
              const isValid = output.address.startsWith('bcrt1') && 
                             output.script.length > 0 &&
                             output.redeemScript.length > 0;
              
              if (isValid) {
                workerSuccesses++;
              }
            } catch (error) {
              console.warn(`Worker ${workerId} operation ${j} failed:`, error);
            }

            const latency = Date.now() - opStartTime;
            latencies.push(latency);
            totalOperations++;
          }

          return workerSuccesses;
        })(i);

        workers.push(worker);
      }

      const workerResults = await Promise.all(workers);
      successfulOperations = workerResults.reduce((sum, result) => sum + result, 0);

      const duration = Date.now() - startTime;
      const metrics: PerformanceMetrics = {
        totalOperations,
        successfulOperations,
        failedOperations: totalOperations - successfulOperations,
        averageLatency: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
        maxLatency: Math.max(...latencies),
        minLatency: Math.min(...latencies),
        throughput: (successfulOperations / duration) * 1000,
        memoryUsage: getMemoryUsage(),
        duration
      };

      expect(successfulOperations).toBeGreaterThan(concurrency * operationsPerWorker * 0.95); // 95% success rate
      expect(metrics.throughput).toBeGreaterThan(50); // Should handle 50+ concurrent ops/sec

      performanceResults.push({
        testName,
        metrics,
        errors: [],
        warnings: metrics.failedOperations > totalOperations * 0.1 ? ['High failure rate'] : []
      });

      console.log(`✓ ${testName}: ${concurrency} workers, ${metrics.throughput.toFixed(2)} ops/sec, ${((successfulOperations/totalOperations)*100).toFixed(1)}% success`);
    }, 120000);

    test('should stress test with high transaction volume', async () => {
      const testName = 'High Volume Transaction Stress Test';
      const targetTPS = 10; // Target transactions per second
      const testDurationSeconds = 30;
      const totalTargetTx = targetTPS * testDurationSeconds;

      const alice = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.ALICE);
      const resolver = RegtestUtils.getTestWallet(testSetup.bitcoin, TEST_WALLETS.RESOLVER);

      let successfulTx = 0;
      let failedTx = 0;
      const txLatencies: number[] = [];
      const startTime = Date.now();

      console.log(`Starting stress test: ${targetTPS} TPS for ${testDurationSeconds}s (target: ${totalTargetTx} tx)`);

      // Create transaction batches
      const batchSize = 5;
      const batches = Math.ceil(totalTargetTx / batchSize);
      const batchInterval = (testDurationSeconds * 1000) / batches;

      for (let batch = 0; batch < batches; batch++) {
        const batchStart = Date.now();
        const batchPromises = [];

        for (let i = 0; i < batchSize && (batch * batchSize + i) < totalTargetTx; i++) {
          const txPromise = (async () => {
            const txStart = Date.now();
            
            try {
              const secret = SecretManager.generateSecret();
              const currentHeight = await testSetup.bitcoin.client.getBlockHeight();
              
              const params: HTLCParams = {
                secretHash: secret.hash,
                userPubkey: alice.publicKey,
                resolverPubkey: resolver.publicKey,
                timelock: currentHeight + 100 + i
              };

              const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
              const output = htlc.createHTLCScript(params);

              // Simulate transaction creation without broadcasting
              const mockUTXO = {
                txid: require('crypto').randomBytes(32).toString('hex'),
                vout: 0,
                value: TEST_AMOUNTS.SMALL,
                scriptPubKey: '001412345678901234567890123456789012'
              };

              const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
              const keyPair = ECPair.fromWIF(resolver.privateKey, bitcoin.networks.regtest);

              const fundingTx = await htlc.createFundingTransaction(
                output,
                TEST_AMOUNTS.SMALL / 10,
                [mockUTXO],
                keyPair,
                resolver.address
              );

              successfulTx++;
              txLatencies.push(Date.now() - txStart);
            } catch (error) {
              failedTx++;
              console.warn(`Transaction ${batch * batchSize + i} failed:`, error);
            }
          })();

          batchPromises.push(txPromise);
        }

        // Execute batch
        await Promise.all(batchPromises);

        // Wait for next batch interval (if not last batch)
        if (batch < batches - 1) {
          const batchDuration = Date.now() - batchStart;
          const waitTime = Math.max(0, batchInterval - batchDuration);
          if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      const actualTPS = (successfulTx / totalDuration) * 1000;

      const metrics: PerformanceMetrics = {
        totalOperations: successfulTx + failedTx,
        successfulOperations: successfulTx,
        failedOperations: failedTx,
        averageLatency: txLatencies.reduce((sum, lat) => sum + lat, 0) / txLatencies.length,
        maxLatency: Math.max(...txLatencies),
        minLatency: Math.min(...txLatencies),
        throughput: actualTPS,
        memoryUsage: getMemoryUsage(),
        duration: totalDuration
      };

      expect(successfulTx).toBeGreaterThan(totalTargetTx * 0.8); // 80% success rate
      expect(actualTPS).toBeGreaterThan(targetTPS * 0.7); // 70% of target TPS

      performanceResults.push({
        testName,
        metrics,
        errors: failedTx > successfulTx * 0.2 ? [`High failure rate: ${failedTx}/${successfulTx + failedTx}`] : [],
        warnings: actualTPS < targetTPS ? [`Below target TPS: ${actualTPS.toFixed(2)} < ${targetTPS}`] : []
      });

      console.log(`✓ ${testName}: ${successfulTx}/${successfulTx + failedTx} tx (${((successfulTx/(successfulTx + failedTx))*100).toFixed(1)}%), ${actualTPS.toFixed(2)} TPS`);
    }, 180000);
  });

  describe('Memory and Resource Usage', () => {
    test('should monitor memory usage under load', async () => {
      const testName = 'Memory Usage Under Load';
      const iterations = 1000;
      const memorySnapshots: Array<{ iteration: number; memory: NodeJS.MemoryUsage }> = [];

      let operations = 0;
      const startMemory = process.memoryUsage();

      console.log(`Starting memory test with ${iterations} operations...`);

      for (let i = 0; i < iterations; i++) {
        // Create HTLC operations that might accumulate memory
        const secret = SecretManager.generateSecret();
        const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
        const keyPairs = [
          ECPair.makeRandom({ network: bitcoin.networks.regtest }),
          ECPair.makeRandom({ network: bitcoin.networks.regtest })
        ];

        const params: HTLCParams = {
          secretHash: secret.hash,
          userPubkey: keyPairs[0].publicKey,
          resolverPubkey: keyPairs[1].publicKey,
          timelock: 1000 + i
        };

        const htlc = new BitcoinHTLC(bitcoin.networks.regtest);
        const output = htlc.createHTLCScript(params);

        // Create some transactions to stress memory
        const mockUTXO = {
          txid: require('crypto').randomBytes(32).toString('hex'),
          vout: 0,
          value: TEST_AMOUNTS.SMALL,
          scriptPubKey: '001412345678901234567890123456789012'
        };

        try {
          const fundingTx = await htlc.createFundingTransaction(
            output,
            TEST_AMOUNTS.SMALL / 10,
            [mockUTXO],
            keyPairs[0],
            'bcrt1qtest1234567890123456789012345678901234'
          );
          operations++;
        } catch (error) {
          // Expected for mock UTXOs
        }

        // Take memory snapshots
        if (i % 100 === 0) {
          memorySnapshots.push({
            iteration: i,
            memory: process.memoryUsage()
          });
        }
      }

      const endMemory = process.memoryUsage();

      // Analyze memory growth
      const heapGrowth = endMemory.heapUsed - startMemory.heapUsed;
      const memoryPerOp = heapGrowth / iterations;

      console.log(`Memory Analysis:`);
      console.log(`  Initial heap: ${(startMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Final heap: ${(endMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Growth: ${(heapGrowth / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Per operation: ${(memoryPerOp / 1024).toFixed(2)} KB`);

      // Memory should not grow excessively
      expect(memoryPerOp).toBeLessThan(10240); // Less than 10KB per operation
      expect(endMemory.heapUsed).toBeLessThan(testConfig.performance.memoryThreshold * 1024 * 1024);

      const metrics: PerformanceMetrics = {
        totalOperations: iterations,
        successfulOperations: operations,
        failedOperations: iterations - operations,
        averageLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        throughput: 0,
        memoryUsage: {
          heapUsed: endMemory.heapUsed,
          heapTotal: endMemory.heapTotal,
          external: endMemory.external
        },
        duration: 0
      };

      performanceResults.push({
        testName,
        metrics,
        errors: [],
        warnings: memoryPerOp > 5120 ? [`High memory usage per operation: ${(memoryPerOp/1024).toFixed(2)}KB`] : []
      });

      console.log(`✓ ${testName}: ${(memoryPerOp/1024).toFixed(2)}KB per operation, ${operations}/${iterations} successful`);
    }, 120000);

    test('should test garbage collection efficiency', async () => {
      const testName = 'Garbage Collection Efficiency';
      const cycles = 10;
      const operationsPerCycle = 100;

      const gcStats = [];

      for (let cycle = 0; cycle < cycles; cycle++) {
        const cycleStart = Date.now();
        const initialMemory = process.memoryUsage();

        // Create temporary objects
        const tempObjects = [];
        for (let i = 0; i < operationsPerCycle; i++) {
          const secret = SecretManager.generateSecret();
          const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
          const keyPair = ECPair.makeRandom({ network: bitcoin.networks.regtest });
          
          tempObjects.push({ secret, keyPair, htlc: new BitcoinHTLC() });
        }

        // Clear references
        tempObjects.length = 0;

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        } else {
          // Wait for natural GC
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const finalMemory = process.memoryUsage();
        const cycleDuration = Date.now() - cycleStart;

        gcStats.push({
          cycle,
          duration: cycleDuration,
          heapBefore: initialMemory.heapUsed,
          heapAfter: finalMemory.heapUsed,
          recovered: Math.max(0, initialMemory.heapUsed - finalMemory.heapUsed)
        });
      }

      const averageRecovery = gcStats.reduce((sum, stat) => sum + stat.recovered, 0) / gcStats.length;
      const totalRecovered = gcStats.reduce((sum, stat) => sum + stat.recovered, 0);

      console.log(`Garbage Collection Analysis:`);
      console.log(`  Cycles: ${cycles}`);
      console.log(`  Average recovery: ${(averageRecovery / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Total recovered: ${(totalRecovered / 1024 / 1024).toFixed(2)} MB`);

      // Should be able to recover significant memory
      expect(totalRecovered).toBeGreaterThan(0);

      console.log(`✓ ${testName}: ${(totalRecovered / 1024 / 1024).toFixed(2)} MB total recovered`);
    }, 60000);
  });

  // Helper function to benchmark operations
  async function benchmarkOperation(
    name: string,
    operation: (index?: number) => Promise<{ success: boolean; data?: any }>,
    iterations: number,
    passIndex: boolean = false
  ): Promise<PerformanceMetrics> {
    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    for (let i = 0; i < iterations; i++) {
      const opStart = Date.now();
      
      try {
        const result = await operation(passIndex ? i : undefined);
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
      }

      latencies.push(Date.now() - opStart);
    }

    const duration = Date.now() - startTime;
    const endMemory = process.memoryUsage();

    return {
      totalOperations: iterations,
      successfulOperations: successful,
      failedOperations: failed,
      averageLatency: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
      maxLatency: Math.max(...latencies),
      minLatency: Math.min(...latencies),
      throughput: (successful / duration) * 1000,
      memoryUsage: {
        heapUsed: endMemory.heapUsed,
        heapTotal: endMemory.heapTotal,
        external: endMemory.external
      },
      duration
    };
  }

  // Helper function to get current memory usage
  function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external
    };
  }

  // Helper function to generate performance report
  function generatePerformanceReport() {
    console.log('\n' + '='.repeat(80));
    console.log('BITCOIN HTLC PERFORMANCE TEST REPORT');
    console.log('='.repeat(80));

    performanceResults.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.testName}`);
      console.log('-'.repeat(result.testName.length + 3));
      
      const m = result.metrics;
      console.log(`   Total Operations: ${m.totalOperations.toLocaleString()}`);
      console.log(`   Success Rate: ${((m.successfulOperations/m.totalOperations)*100).toFixed(2)}%`);
      
      if (m.averageLatency > 0) {
        console.log(`   Average Latency: ${m.averageLatency.toFixed(2)}ms`);
        console.log(`   Latency Range: ${m.minLatency.toFixed(2)}ms - ${m.maxLatency.toFixed(2)}ms`);
      }
      
      if (m.throughput > 0) {
        console.log(`   Throughput: ${m.throughput.toFixed(2)} ops/sec`);
      }
      
      if (m.duration > 0) {
        console.log(`   Duration: ${(m.duration/1000).toFixed(2)}s`);
      }

      console.log(`   Memory Usage: ${(m.memoryUsage.heapUsed/1024/1024).toFixed(2)} MB`);

      if (result.errors.length > 0) {
        console.log(`   ❌ Errors: ${result.errors.join(', ')}`);
      }
      
      if (result.warnings.length > 0) {
        console.log(`   ⚠️  Warnings: ${result.warnings.join(', ')}`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE SUMMARY');
    console.log('='.repeat(80));

    const totalOps = performanceResults.reduce((sum, r) => sum + r.metrics.totalOperations, 0);
    const totalSuccess = performanceResults.reduce((sum, r) => sum + r.metrics.successfulOperations, 0);
    const avgThroughput = performanceResults
      .filter(r => r.metrics.throughput > 0)
      .reduce((sum, r, _, arr) => sum + r.metrics.throughput / arr.length, 0);

    console.log(`Total Operations: ${totalOps.toLocaleString()}`);
    console.log(`Overall Success Rate: ${((totalSuccess/totalOps)*100).toFixed(2)}%`);
    console.log(`Average Throughput: ${avgThroughput.toFixed(2)} ops/sec`);
    console.log(`Tests with Errors: ${performanceResults.filter(r => r.errors.length > 0).length}`);
    console.log(`Tests with Warnings: ${performanceResults.filter(r => r.warnings.length > 0).length}`);
    
    console.log('\n' + '='.repeat(80) + '\n');
  }
});