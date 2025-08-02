import { spawn, ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BitcoinClient, BitcoinRPCConfig } from '../../backend/src/bitcoin/client.js';
import { testConfig, TestWallet, TEST_WALLETS } from '../config.js';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

export interface RegtestNode {
  process?: ChildProcess;
  datadir: string;
  config: BitcoinRPCConfig;
  isRunning: boolean;
  pid?: number;
}

export interface RegtestSetup {
  node: RegtestNode;
  client: BitcoinClient;
  wallets: Map<string, TestWallet>;
  cleanup: () => Promise<void>;
}

/**
 * Bitcoin Regtest Manager for comprehensive testing
 * Provides programmatic control over regtest node lifecycle
 */
export class BitcoinRegtestManager {
  private static instance: BitcoinRegtestManager;
  private currentSetup?: RegtestSetup;
  private readonly baseDataDir: string;

  private constructor() {
    this.baseDataDir = path.join(process.cwd(), 'tests', '.regtest-data');
  }

  static getInstance(): BitcoinRegtestManager {
    if (!BitcoinRegtestManager.instance) {
      BitcoinRegtestManager.instance = new BitcoinRegtestManager();
    }
    return BitcoinRegtestManager.instance;
  }

  /**
   * Start Bitcoin regtest node with custom configuration
   */
  async startRegtestNode(customConfig?: Partial<BitcoinRPCConfig>): Promise<RegtestSetup> {
    if (this.currentSetup?.node.isRunning) {
      console.log('Regtest node already running, returning existing setup');
      return this.currentSetup;
    }

    const config = { ...testConfig.bitcoin.regtest, ...customConfig };
    const dataDir = path.join(this.baseDataDir, `regtest-${Date.now()}`);
    
    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Create bitcoin.conf
    const bitcoinConf = this.generateBitcoinConf(config);
    await fs.writeFile(path.join(dataDir, 'bitcoin.conf'), bitcoinConf);

    // Start Bitcoin Core daemon
    const bitcoinPath = await this.findBitcoinPath();
    const node = await this.spawnBitcoinDaemon(bitcoinPath, dataDir, config);

    // Create client and wait for node to be ready
    const client = new BitcoinClient(config);
    await this.waitForNodeReady(client);

    // Create and fund test wallets
    const wallets = await this.createTestWallets(client);

    // Fund test wallets with initial balance
    await this.fundTestWallets(client, wallets);

    const setup: RegtestSetup = {
      node,
      client,
      wallets,
      cleanup: async () => await this.cleanup()
    };

    this.currentSetup = setup;
    return setup;
  }

  /**
   * Stop regtest node and cleanup resources
   */
  async stopRegtestNode(): Promise<void> {
    if (!this.currentSetup?.node.isRunning) {
      return;
    }

    await this.cleanup();
  }

  /**
   * Generate bitcoin.conf for regtest
   */
  private generateBitcoinConf(config: BitcoinRPCConfig): string {
    return `
# Bitcoin Core configuration for regtest
regtest=1
server=1
daemon=1

# RPC configuration
rpcuser=${config.username}
rpcpassword=${config.password}
rpcport=${config.port}
rpcbind=127.0.0.1
rpcallowip=127.0.0.1

# Network settings
listen=0
listenonion=0
upnp=0
natpmp=0

# Wallet settings
disablewallet=0
fallbackfee=0.00001

# Mining settings (for regtest)
addresstype=bech32
changetype=bech32

# Logging
debug=1
printtoconsole=1

# Performance (for testing)
dbcache=512
maxmempool=50
`.trim();
  }

  /**
   * Find Bitcoin Core executable path
   */
  private async findBitcoinPath(): Promise<string> {
    const possiblePaths = [
      '/usr/local/bin/bitcoind',
      '/usr/bin/bitcoind',
      '/opt/bitcoin/bin/bitcoind',
      'bitcoind' // Assume it's in PATH
    ];

    for (const binPath of possiblePaths) {
      try {
        // Check if file exists and is executable
        await fs.access(binPath, fs.constants.F_OK | fs.constants.X_OK);
        return binPath;
      } catch {
        continue;
      }
    }

    // Fallback to PATH lookup
    return 'bitcoind';
  }

  /**
   * Spawn Bitcoin daemon process
   */
  private async spawnBitcoinDaemon(
    bitcoinPath: string,
    dataDir: string,
    config: BitcoinRPCConfig
  ): Promise<RegtestNode> {
    const args = [
      '-datadir=' + dataDir,
      '-conf=bitcoin.conf'
    ];

    const process = spawn(bitcoinPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    const node: RegtestNode = {
      process,
      datadir: dataDir,
      config,
      isRunning: false,
      pid: process.pid
    };

    // Handle process events
    process.stdout?.on('data', (data) => {
      console.log(`Bitcoin regtest: ${data}`);
    });

    process.stderr?.on('data', (data) => {
      console.error(`Bitcoin regtest error: ${data}`);
    });

    process.on('error', (error) => {
      console.error('Failed to start Bitcoin regtest:', error);
      node.isRunning = false;
    });

    process.on('exit', (code, signal) => {
      console.log(`Bitcoin regtest exited with code ${code}, signal ${signal}`);
      node.isRunning = false;
    });

    // Wait for process to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Bitcoin daemon startup timeout'));
      }, 30000);

      const checkStartup = () => {
        if (process.pid) {
          node.isRunning = true;
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkStartup, 1000);
        }
      };

      checkStartup();
    });

    return node;
  }

  /**
   * Wait for Bitcoin node to be ready for RPC calls
   */
  private async waitForNodeReady(client: BitcoinClient): Promise<void> {
    const maxAttempts = 30;
    const delay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await client.getBlockHeight();
        console.log('Bitcoin regtest node is ready');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Bitcoin node not ready after ${maxAttempts} attempts: ${error}`);
        }
        console.log(`Waiting for Bitcoin node... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Create test wallets with deterministic keys
   */
  private async createTestWallets(client: BitcoinClient): Promise<Map<string, TestWallet>> {
    const wallets = new Map<string, TestWallet>();
    const network = bitcoin.networks.regtest;

    // Create deterministic wallets for consistent testing
    const walletSeeds = {
      [TEST_WALLETS.ALICE]: 'alice-test-seed-deterministic-2024',
      [TEST_WALLETS.BOB]: 'bob-test-seed-deterministic-2024',
      [TEST_WALLETS.CHARLIE]: 'charlie-test-seed-deterministic-2024',
      [TEST_WALLETS.RESOLVER]: 'resolver-test-seed-deterministic-2024'
    };

    for (const [name, seed] of Object.entries(walletSeeds)) {
      // Generate deterministic key from seed
      const hash = require('crypto').createHash('sha256').update(seed).digest();
      const keyPair = ECPair.fromPrivateKey(hash, { network });
      
      const { address } = bitcoin.payments.p2wpkh({ 
        pubkey: keyPair.publicKey, 
        network 
      });

      const wallet: TestWallet = {
        privateKey: keyPair.toWIF(),
        publicKey: keyPair.publicKey,
        address: address!,
        name
      };

      wallets.set(name, wallet);
      
      // Import address for monitoring
      try {
        await client.importAddress(address!, `test-wallet-${name}`, false);
      } catch (error) {
        console.warn(`Failed to import address for ${name}:`, error);
      }
    }

    return wallets;
  }

  /**
   * Fund test wallets with regtest BTC
   */
  private async fundTestWallets(
    client: BitcoinClient, 
    wallets: Map<string, TestWallet>
  ): Promise<void> {
    try {
      // Generate initial blocks and coinbase rewards
      const minerAddress = wallets.get(TEST_WALLETS.ALICE)?.address;
      if (!minerAddress) {
        throw new Error('No miner address available');
      }

      console.log('Generating initial blocks...');
      await this.generateBlocks(client, 101, minerAddress);

      // Distribute funds to other wallets
      const fundingAmount = 1000000000; // 10 BTC in satoshis
      const aliceWallet = wallets.get(TEST_WALLETS.ALICE);
      if (!aliceWallet) {
        throw new Error('Alice wallet not found');
      }

      const aliceUTXOs = await client.getUTXOs(aliceWallet.address, 1);
      if (aliceUTXOs.length === 0) {
        throw new Error('No UTXOs available for Alice');
      }

      // Send funds to each wallet
      for (const [name, wallet] of wallets) {
        if (name === TEST_WALLETS.ALICE) continue; // Skip Alice as she already has funds

        console.log(`Funding ${name} wallet with ${fundingAmount / 100000000} BTC`);
        
        try {
          const tx = await this.sendFunds(
            client,
            aliceWallet,
            wallet.address,
            fundingAmount / 4, // 2.5 BTC each
            aliceUTXOs.slice(0, 1)
          );
          
          console.log(`Funded ${name} with transaction: ${tx.txid}`);
        } catch (error) {
          console.warn(`Failed to fund ${name}:`, error);
        }
      }

      // Generate blocks to confirm transactions
      await this.generateBlocks(client, 6, minerAddress);
      console.log('Test wallets funded and confirmed');

    } catch (error) {
      console.error('Error funding test wallets:', error);
      throw error;
    }
  }

  /**
   * Generate blocks in regtest
   */
  async generateBlocks(
    client: BitcoinClient, 
    count: number, 
    address: string
  ): Promise<string[]> {
    try {
      const result = await (client as any).rpc('generatetoaddress', [count, address]);
      console.log(`Generated ${count} blocks to ${address}`);
      return result;
    } catch (error) {
      console.error('Error generating blocks:', error);
      throw error;
    }
  }

  /**
   * Send funds between test wallets
   */
  private async sendFunds(
    client: BitcoinClient,
    fromWallet: TestWallet,
    toAddress: string,
    amount: number,
    utxos: Array<any>
  ): Promise<any> {
    const keyPair = ECPair.fromWIF(fromWallet.privateKey, bitcoin.networks.regtest);
    
    // Create simple transaction (this is a simplified version)
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    
    let totalInput = 0;
    for (const utxo of utxos.slice(0, 1)) { // Use first UTXO
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: Buffer.from(utxo.scriptPubKey, 'hex'),
          value: utxo.value
        }
      });
      totalInput += utxo.value;
      break; // Use only one UTXO for simplicity
    }
    
    // Add output
    psbt.addOutput({
      address: toAddress,
      value: amount
    });
    
    // Add change output if needed
    const fee = 1000; // 1000 sats fee
    const change = totalInput - amount - fee;
    if (change > 546) { // Above dust threshold
      psbt.addOutput({
        address: fromWallet.address,
        value: change
      });
    }
    
    // Sign and broadcast
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    
    const txid = await client.sendRawTransaction(tx.toHex());
    return { txid, hex: tx.toHex() };
  }

  /**
   * Reset regtest chain to genesis
   */
  async resetChain(): Promise<void> {
    if (!this.currentSetup) {
      throw new Error('No regtest setup active');
    }

    // This would typically involve restarting the node with a clean datadir
    console.log('Resetting regtest chain...');
    await this.stopRegtestNode();
    await this.startRegtestNode();
  }

  /**
   * Get current regtest setup
   */
  getCurrentSetup(): RegtestSetup | undefined {
    return this.currentSetup;
  }

  /**
   * Cleanup resources and stop node
   */
  private async cleanup(): Promise<void> {
    if (!this.currentSetup) return;

    const { node } = this.currentSetup;

    if (node.process && node.isRunning) {
      console.log('Stopping Bitcoin regtest node...');
      
      // Graceful shutdown
      node.process.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('Force killing Bitcoin regtest node...');
          node.process?.kill('SIGKILL');
          resolve();
        }, 10000);

        node.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Cleanup data directory (optional - keep for debugging)
    try {
      await fs.rm(node.datadir, { recursive: true, force: true });
      console.log('Cleaned up regtest data directory');
    } catch (error) {
      console.warn('Failed to cleanup data directory:', error);
    }

    node.isRunning = false;
    this.currentSetup = undefined;
  }
}

/**
 * Utility functions for test setup
 */
export class RegtestUtils {
  /**
   * Mine blocks until target height
   */
  static async mineToHeight(
    setup: RegtestSetup, 
    targetHeight: number
  ): Promise<void> {
    const manager = BitcoinRegtestManager.getInstance();
    const currentHeight = await setup.client.getBlockHeight();
    const blocksNeeded = targetHeight - currentHeight;
    
    if (blocksNeeded > 0) {
      const minerAddress = setup.wallets.get(TEST_WALLETS.ALICE)?.address;
      if (!minerAddress) {
        throw new Error('No miner address available');
      }
      
      await manager.generateBlocks(setup.client, blocksNeeded, minerAddress);
    }
  }

  /**
   * Wait for mempool to clear
   */
  static async waitForMempoolClear(
    setup: RegtestSetup,
    timeoutMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const mempool = await (setup.client as any).rpc('getrawmempool');
        if (mempool.length === 0) {
          return;
        }
      } catch (error) {
        console.warn('Error checking mempool:', error);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Mempool did not clear within timeout');
  }

  /**
   * Get test wallet by name
   */
  static getTestWallet(setup: RegtestSetup, name: string): TestWallet {
    const wallet = setup.wallets.get(name);
    if (!wallet) {
      throw new Error(`Test wallet '${name}' not found`);
    }
    return wallet;
  }

  /**
   * Fund wallet with specific amount
   */
  static async fundWallet(
    setup: RegtestSetup,
    targetWallet: string,
    amount: number
  ): Promise<string> {
    const manager = BitcoinRegtestManager.getInstance();
    const alice = setup.wallets.get(TEST_WALLETS.ALICE);
    const target = setup.wallets.get(targetWallet);
    
    if (!alice || !target) {
      throw new Error('Required wallets not found');
    }

    const aliceUTXOs = await setup.client.getUTXOs(alice.address, 1);
    if (aliceUTXOs.length === 0) {
      throw new Error('No UTXOs available for funding');
    }

    const tx = await (manager as any).sendFunds(
      setup.client,
      alice,
      target.address,
      amount,
      aliceUTXOs.slice(0, 1)
    );

    return tx.txid;
  }
}

// Export singleton instance
export const regtestManager = BitcoinRegtestManager.getInstance();
export default BitcoinRegtestManager;