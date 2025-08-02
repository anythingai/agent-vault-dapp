import {
  CrossChainSwapState,
  SwapStatus,
  PartialFillInfo,
  MerkleSecretTree,
  SwapError,
  SwapErrorCode,
  Hash,
  Address
} from '../shared/types.js';
import { SecretManager as BaseSecretManager, SecretPair, MerkleProof } from '../shared/secrets.js';

export interface SecretCoordinatorConfig {
  secretRevealDelay: number; // seconds after destination funding to reveal secret
  maxSecretAge: number; // maximum time to keep secrets before cleanup
  partialFillTimeout: number; // timeout for partial fill coordination
  encryptionKey: string; // key for encrypting stored secrets
}

export interface StoredSecret {
  orderId: string;
  secretIndex: number;
  secretHash: string;
  encryptedSecret: string; // encrypted for security
  revealTime?: number; // when the secret should be revealed
  revealedAt?: number; // when the secret was actually revealed
  status: 'pending' | 'ready' | 'revealed' | 'expired';
  partialFillIndex?: number; // for partial fills
  merkleProof?: string[]; // Merkle proof for partial fills
  createdAt: number;
}

export interface RevealSchedule {
  orderId: string;
  revealTime: number;
  secretIndex: number;
  isPartialFill: boolean;
}

export type SecretCoordinatorHandler = {
  secretReady?: (orderId: string, secretIndex: number) => void;
  secretRevealed?: (orderId: string, secret: string, secretIndex: number) => void;
  partialFillCoordinated?: (orderId: string, fillInfo: PartialFillInfo) => void;
  secretExpired?: (orderId: string, secretIndex: number) => void;
};

/**
 * Secret Coordination Manager - Manages secret revelation timing and coordination
 * Handles secure secret storage and release mechanisms with Merkle tree proofs for partial fills
 */
export class SecretCoordinator {
  private config: SecretCoordinatorConfig;
  private eventHandlers: SecretCoordinatorHandler = {};
  
  // Secret storage
  private storedSecrets: Map<string, StoredSecret> = new Map(); // key: orderId:secretIndex
  private revealSchedule: Map<number, RevealSchedule[]> = new Map(); // key: revealTime
  private partialFillSecrets: Map<string, MerkleSecretTree> = new Map(); // key: orderId
  
  // Timers
  private revealTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SecretCoordinatorConfig) {
    this.config = config;
    this.initializeTimers();
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: SecretCoordinatorHandler): void {
    this.eventHandlers = handlers;
  }

  /**
   * Emit events to registered handlers
   */
  private emit(event: string, ...args: any[]): void {
    const handler = this.eventHandlers[event as keyof SecretCoordinatorHandler] as any;
    if (handler) {
      handler(...args);
    }
  }

  /**
   * Store secret for a swap order
   */
  async storeSecret(
    orderId: string,
    secret: string,
    secretIndex: number = 0,
    partialFillIndex?: number,
    merkleProof?: string[]
  ): Promise<void> {
    const secretKey = `${orderId}:${secretIndex}`;
    
    // Check if secret already exists
    if (this.storedSecrets.has(secretKey)) {
      throw new SwapError(
        'Secret already stored for this order and index',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    // Validate secret format
    if (!this.isValidSecret(secret)) {
      throw new SwapError(
        'Invalid secret format',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    // Generate secret hash
    const secretHash = BaseSecretManager.secretToHex(
      BaseSecretManager.hexToSecret(secret.startsWith('0x') ? secret : `0x${secret}`)
    );

    // Encrypt the secret for storage
    const encryptedSecret = this.encryptSecret(secret);

    // Create stored secret entry
    const storedSecret: StoredSecret = {
      orderId,
      secretIndex,
      secretHash,
      encryptedSecret,
      status: 'pending',
      partialFillIndex,
      merkleProof,
      createdAt: Math.floor(Date.now() / 1000)
    };

    // Store the secret
    this.storedSecrets.set(secretKey, storedSecret);

    console.log(`Secret stored for order ${orderId}, index ${secretIndex}`);
  }

  /**
   * Schedule secret revelation for a swap order
   */
  async scheduleSecretReveal(
    orderId: string,
    secretIndex: number = 0,
    delaySeconds?: number
  ): Promise<void> {
    const secretKey = `${orderId}:${secretIndex}`;
    const storedSecret = this.storedSecrets.get(secretKey);

    if (!storedSecret) {
      throw new SwapError(
        'Secret not found for scheduling',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    if (storedSecret.status !== 'pending') {
      throw new SwapError(
        `Cannot schedule reveal for secret in status: ${storedSecret.status}`,
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    // Calculate reveal time
    const delay = delaySeconds || this.config.secretRevealDelay;
    const revealTime = Math.floor(Date.now() / 1000) + delay;

    // Update stored secret
    storedSecret.revealTime = revealTime;
    storedSecret.status = 'ready';

    // Add to reveal schedule
    if (!this.revealSchedule.has(revealTime)) {
      this.revealSchedule.set(revealTime, []);
    }

    this.revealSchedule.get(revealTime)!.push({
      orderId,
      revealTime,
      secretIndex,
      isPartialFill: storedSecret.partialFillIndex !== undefined
    });

    // Emit event
    this.emit('secretReady', orderId, secretIndex);

    console.log(`Secret reveal scheduled for order ${orderId} at ${new Date(revealTime * 1000)}`);
  }

  /**
   * Reveal secret immediately
   */
  async revealSecret(orderId: string, secretIndex: number = 0): Promise<string> {
    const secretKey = `${orderId}:${secretIndex}`;
    const storedSecret = this.storedSecrets.get(secretKey);

    if (!storedSecret) {
      throw new SwapError(
        'Secret not found for reveal',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    if (storedSecret.status === 'revealed') {
      throw new SwapError(
        'Secret already revealed',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    if (storedSecret.status === 'expired') {
      throw new SwapError(
        'Secret has expired',
        SwapErrorCode.INVALID_SECRET,
        orderId
      );
    }

    // Decrypt the secret
    const secret = this.decryptSecret(storedSecret.encryptedSecret);

    // Update stored secret status
    storedSecret.status = 'revealed';
    storedSecret.revealedAt = Math.floor(Date.now() / 1000);

    // Emit event
    this.emit('secretRevealed', orderId, secret, secretIndex);

    console.log(`Secret revealed for order ${orderId}, index ${secretIndex}`);
    return secret;
  }

  /**
   * Setup partial fill secret coordination
   */
  async setupPartialFillSecrets(
    orderId: string,
    totalAmount: string,
    maxFills: number
  ): Promise<MerkleSecretTree> {
    if (this.partialFillSecrets.has(orderId)) {
      throw new SwapError(
        'Partial fill secrets already setup for this order',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // Generate secrets for partial fills
    const totalAmountBN = BigInt(totalAmount);
    const partialFillStructure = BaseSecretManager.createPartialFillStructure(
      totalAmountBN,
      maxFills
    );

    // Create Merkle secret tree
    const secretTree: MerkleSecretTree = {
      root: BaseSecretManager.secretToHex(partialFillStructure.merkleRoot),
      secrets: partialFillStructure.secrets.map(s => BaseSecretManager.secretToHex(s.secret)),
      hashes: partialFillStructure.secrets.map(s => BaseSecretManager.secretToHex(s.hash)),
      leaves: partialFillStructure.secrets.map(s => BaseSecretManager.secretToHex(s.hash)),
      proofs: partialFillStructure.partialFills.map(fill => 
        fill.merkleProof.siblings.map(s => BaseSecretManager.secretToHex(s))
      )
    };

    // Store the tree
    this.partialFillSecrets.set(orderId, secretTree);

    // Store each secret individually
    for (let i = 0; i < partialFillStructure.secrets.length; i++) {
      const secret = partialFillStructure.secrets[i];
      const proof = secretTree.proofs[i];
      
      await this.storeSecret(
        orderId,
        BaseSecretManager.secretToHex(secret.secret),
        i,
        i, // partial fill index same as secret index
        proof
      );
    }

    console.log(`Partial fill secrets setup for order ${orderId} with ${maxFills} fills`);
    return secretTree;
  }

  /**
   * Coordinate partial fill secret revelation
   */
  async coordinatePartialFillReveal(
    orderId: string,
    fillIndex: number,
    fillAmount: string
  ): Promise<PartialFillInfo> {
    const secretTree = this.partialFillSecrets.get(orderId);
    if (!secretTree) {
      throw new SwapError(
        'Partial fill secrets not found',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    if (fillIndex >= secretTree.secrets.length) {
      throw new SwapError(
        'Invalid fill index',
        SwapErrorCode.INVALID_ORDER,
        orderId
      );
    }

    // Reveal the secret for this fill
    const secret = await this.revealSecret(orderId, fillIndex);

    // Create partial fill info
    const partialFillInfo: PartialFillInfo = {
      orderId,
      fillIndex,
      totalFills: secretTree.secrets.length,
      amount: fillAmount,
      secretIndex: fillIndex,
      merkleProof: secretTree.proofs[fillIndex],
      resolver: '', // Will be set by caller
      status: SwapStatus.SECRET_REVEALED
    };

    // Emit event
    this.emit('partialFillCoordinated', orderId, partialFillInfo);

    return partialFillInfo;
  }

  /**
   * Get stored secret info
   */
  getStoredSecret(orderId: string, secretIndex: number = 0): StoredSecret | null {
    const secretKey = `${orderId}:${secretIndex}`;
    return this.storedSecrets.get(secretKey) || null;
  }

  /**
   * Get partial fill secret tree
   */
  getPartialFillSecrets(orderId: string): MerkleSecretTree | null {
    return this.partialFillSecrets.get(orderId) || null;
  }

  /**
   * Check if order has secrets ready for reveal
   */
  isSecretReadyForReveal(orderId: string, secretIndex: number = 0): boolean {
    const storedSecret = this.getStoredSecret(orderId, secretIndex);
    if (!storedSecret) {
      return false;
    }

    if (storedSecret.status !== 'ready') {
      return false;
    }

    if (!storedSecret.revealTime) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return now >= storedSecret.revealTime;
  }

  /**
   * Get all secrets for an order
   */
  getOrderSecrets(orderId: string): StoredSecret[] {
    return Array.from(this.storedSecrets.values())
      .filter(secret => secret.orderId === orderId)
      .sort((a, b) => a.secretIndex - b.secretIndex);
  }

  /**
   * Validate secret format
   */
  private isValidSecret(secret: string): boolean {
    try {
      // Check if it's a valid hex string
      const cleanSecret = secret.startsWith('0x') ? secret.slice(2) : secret;
      if (cleanSecret.length !== 64) {
        return false;
      }
      
      // Check if all characters are valid hex
      const hexRegex = /^[0-9a-fA-F]+$/;
      return hexRegex.test(cleanSecret);
    } catch {
      return false;
    }
  }

  /**
   * Encrypt secret for storage (simplified implementation)
   */
  private encryptSecret(secret: string): string {
    // This is a simplified XOR encryption - in production, use proper encryption
    const key = this.config.encryptionKey;
    let encrypted = '';
    
    for (let i = 0; i < secret.length; i++) {
      const secretChar = secret.charCodeAt(i);
      const keyChar = key.charCodeAt(i % key.length);
      encrypted += String.fromCharCode(secretChar ^ keyChar);
    }
    
    return btoa(encrypted);
  }

  /**
   * Decrypt secret from storage (simplified implementation)
   */
  private decryptSecret(encryptedSecret: string): string {
    // Reverse the XOR encryption
    const key = this.config.encryptionKey;
    const encrypted = atob(encryptedSecret);
    let decrypted = '';
    
    for (let i = 0; i < encrypted.length; i++) {
      const encryptedChar = encrypted.charCodeAt(i);
      const keyChar = key.charCodeAt(i % key.length);
      decrypted += String.fromCharCode(encryptedChar ^ keyChar);
    }
    
    return decrypted;
  }

  /**
   * Initialize timers for secret management
   */
  private initializeTimers(): void {
    // Check for secrets ready to reveal every 10 seconds
    this.revealTimer = setInterval(() => {
      this.processRevealSchedule();
    }, 10000);

    // Clean up old secrets every hour
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSecrets();
    }, 3600000);
  }

  /**
   * Process reveal schedule and reveal ready secrets
   */
  private async processRevealSchedule(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    
    // Check all scheduled reveals
    for (const [revealTime, schedules] of this.revealSchedule.entries()) {
      if (revealTime <= now) {
        for (const schedule of schedules) {
          try {
            if (this.isSecretReadyForReveal(schedule.orderId, schedule.secretIndex)) {
              await this.revealSecret(schedule.orderId, schedule.secretIndex);
            }
          } catch (error) {
            console.error(`Error revealing secret for order ${schedule.orderId}:`, error);
          }
        }
        
        // Remove processed schedule
        this.revealSchedule.delete(revealTime);
      }
    }
  }

  /**
   * Clean up expired secrets
   */
  private cleanupExpiredSecrets(): void {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.config.maxSecretAge;
    
    for (const [secretKey, storedSecret] of this.storedSecrets.entries()) {
      const age = now - storedSecret.createdAt;
      
      if (age > maxAge && storedSecret.status !== 'revealed') {
        storedSecret.status = 'expired';
        this.emit('secretExpired', storedSecret.orderId, storedSecret.secretIndex);
        
        // Remove very old secrets
        if (age > maxAge * 2) {
          this.storedSecrets.delete(secretKey);
        }
      }
    }
  }

  /**
   * Get coordination statistics
   */
  getStats() {
    const allSecrets = Array.from(this.storedSecrets.values());
    
    return {
      totalSecrets: allSecrets.length,
      pendingSecrets: allSecrets.filter(s => s.status === 'pending').length,
      readySecrets: allSecrets.filter(s => s.status === 'ready').length,
      revealedSecrets: allSecrets.filter(s => s.status === 'revealed').length,
      expiredSecrets: allSecrets.filter(s => s.status === 'expired').length,
      scheduledReveals: Array.from(this.revealSchedule.values()).reduce((sum, arr) => sum + arr.length, 0),
      partialFillOrders: this.partialFillSecrets.size
    };
  }

  /**
   * Shutdown the secret coordinator
   */
  shutdown(): void {
    if (this.revealTimer) {
      clearInterval(this.revealTimer);
      this.revealTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear all stored data
    this.storedSecrets.clear();
    this.revealSchedule.clear();
    this.partialFillSecrets.clear();
  }
}

export default SecretCoordinator;