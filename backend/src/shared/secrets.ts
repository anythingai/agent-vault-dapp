import { createHash, randomBytes } from 'crypto';

export interface SecretPair {
  secret: Buffer;
  hash: Buffer;
}

export interface MerkleNode {
  hash: Buffer;
  left?: MerkleNode;
  right?: MerkleNode;
}

export interface MerkleProof {
  siblings: Buffer[];
  path: boolean[]; // true for right, false for left
}

/**
 * Utility class for generating secrets and managing Merkle trees for partial fills
 * Implements the 1inch Fusion+ approach for secure partial fill handling
 */
export class SecretManager {
  /**
   * Generate a single random secret and its hash
   */
  static generateSecret(): SecretPair {
    const secret = randomBytes(32);
    const hash = createHash('sha256').update(secret).digest();
    return { secret, hash };
  }

  /**
   * Generate multiple secrets for partial fills
   * Creates N+1 secrets where N is the number of potential partial fills
   */
  static generateSecretsForPartialFills(maxFills: number): SecretPair[] {
    const secrets: SecretPair[] = [];
    
    // Generate N+1 secrets (one extra for completion)
    for (let i = 0; i <= maxFills; i++) {
      secrets.push(this.generateSecret());
    }
    
    return secrets;
  }

  /**
   * Create Merkle tree from secret hashes
   * Returns the root hash and the complete tree structure
   */
  static createMerkleTree(secretHashes: Buffer[]): {
    root: Buffer;
    tree: MerkleNode;
    leaves: Buffer[];
  } {
    if (secretHashes.length === 0) {
      throw new Error('Cannot create Merkle tree with no secret hashes');
    }

    // Ensure we have a power of 2 number of leaves by padding with zeros
    const paddedHashes = [...secretHashes];
    while (paddedHashes.length > 1 && (paddedHashes.length & (paddedHashes.length - 1)) !== 0) {
      paddedHashes.push(Buffer.alloc(32, 0));
    }

    const leaves = paddedHashes.map(hash => ({
      hash,
      left: undefined,
      right: undefined
    }));

    const tree = this.buildMerkleTree(leaves);
    
    return {
      root: tree.hash,
      tree,
      leaves: paddedHashes
    };
  }

  /**
   * Build Merkle tree recursively from leaf nodes
   */
  private static buildMerkleTree(nodes: MerkleNode[]): MerkleNode {
    if (nodes.length === 1) {
      return nodes[0];
    }

    const nextLevel: MerkleNode[] = [];
    
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = i + 1 < nodes.length ? nodes[i + 1] : nodes[i]; // Duplicate last node if odd

      const combined = Buffer.concat([left.hash, right.hash]);
      const parentHash = createHash('sha256').update(combined).digest();
      
      nextLevel.push({
        hash: parentHash,
        left,
        right
      });
    }

    return this.buildMerkleTree(nextLevel);
  }

  /**
   * Generate Merkle proof for a specific leaf index
   */
  static generateMerkleProof(tree: MerkleNode, leafHash: Buffer, leaves: Buffer[]): MerkleProof {
    const leafIndex = leaves.findIndex(hash => hash.equals(leafHash));
    if (leafIndex === -1) {
      throw new Error('Leaf hash not found in tree');
    }

    const siblings: Buffer[] = [];
    const path: boolean[] = [];

    this.collectMerkleProof(tree, leafIndex, 0, leaves.length, siblings, path);

    return { siblings, path };
  }

  /**
   * Recursively collect siblings and path for Merkle proof
   */
  private static collectMerkleProof(
    node: MerkleNode,
    targetIndex: number,
    currentIndex: number,
    rangeSize: number,
    siblings: Buffer[],
    path: boolean[]
  ): void {
    if (rangeSize === 1) {
      return; // Reached leaf level
    }

    const halfRange = rangeSize / 2;
    const isRightPath = targetIndex >= currentIndex + halfRange;

    if (isRightPath) {
      // Target is in right subtree, sibling is left subtree
      if (node.left) {
        siblings.push(node.left.hash);
      }
      path.push(true);
      
      if (node.right) {
        this.collectMerkleProof(
          node.right,
          targetIndex,
          currentIndex + halfRange,
          halfRange,
          siblings,
          path
        );
      }
    } else {
      // Target is in left subtree, sibling is right subtree
      if (node.right) {
        siblings.push(node.right.hash);
      }
      path.push(false);
      
      if (node.left) {
        this.collectMerkleProof(
          node.left,
          targetIndex,
          currentIndex,
          halfRange,
          siblings,
          path
        );
      }
    }
  }

  /**
   * Verify a Merkle proof
   */
  static verifyMerkleProof(
    leafHash: Buffer,
    proof: MerkleProof,
    rootHash: Buffer
  ): boolean {
    let currentHash = leafHash;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isRightPath = proof.path[i];

      const combined = isRightPath 
        ? Buffer.concat([sibling, currentHash])
        : Buffer.concat([currentHash, sibling]);
      
      currentHash = createHash('sha256').update(combined).digest();
    }

    return currentHash.equals(rootHash);
  }

  /**
   * Create partial fill structure for an order
   * Returns the secrets, Merkle root, and proofs for each partial fill
   */
  static createPartialFillStructure(
    totalAmount: bigint,
    maxFills: number
  ): {
    secrets: SecretPair[];
    merkleRoot: Buffer;
    partialFills: Array<{
      index: number;
      amount: bigint;
      secretHash: Buffer;
      merkleProof: MerkleProof;
    }>;
  } {
    // Generate secrets for partial fills
    const secrets = this.generateSecretsForPartialFills(maxFills);
    const secretHashes = secrets.map(s => s.hash);

    // Create Merkle tree
    const { root: merkleRoot, tree, leaves } = this.createMerkleTree(secretHashes);

    // Calculate amounts for each partial fill
    const baseAmount = totalAmount / BigInt(maxFills);
    const remainder = totalAmount % BigInt(maxFills);

    const partialFills = [];
    let cumulativeAmount = BigInt(0);

    for (let i = 0; i < maxFills; i++) {
      const fillAmount = baseAmount + (i < remainder ? BigInt(1) : BigInt(0));
      cumulativeAmount += fillAmount;

      const merkleProof = this.generateMerkleProof(tree, secretHashes[i], leaves);

      partialFills.push({
        index: i,
        amount: fillAmount,
        secretHash: secretHashes[i],
        merkleProof
      });
    }

    return {
      secrets,
      merkleRoot,
      partialFills
    };
  }

  /**
   * Validate secret against its hash
   */
  static validateSecret(secret: Buffer, expectedHash: Buffer): boolean {
    if (secret.length !== 32) {
      return false;
    }
    
    const actualHash = createHash('sha256').update(secret).digest();
    return actualHash.equals(expectedHash);
  }

  /**
   * Convert secret to hex string for storage/transmission
   */
  static secretToHex(secret: Buffer): string {
    return '0x' + secret.toString('hex');
  }

  /**
   * Convert hex string back to secret buffer
   */
  static hexToSecret(hex: string): Buffer {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length !== 64) {
      throw new Error('Invalid secret hex string length');
    }
    return Buffer.from(cleanHex, 'hex');
  }

  /**
   * Generate deterministic secret from seed (for testing)
   */
  static generateDeterministicSecret(seed: string): SecretPair {
    const secret = createHash('sha256').update(seed).digest();
    const hash = createHash('sha256').update(secret).digest();
    return { secret, hash };
  }

  /**
   * Create secret commitment for order (combines secret hash with order parameters)
   */
  static createSecretCommitment(
    secretHash: Buffer,
    orderId: string,
    maker: string,
    amount: bigint
  ): Buffer {
    const orderIdHash = createHash('sha256').update(orderId).digest();
    const makerHash = createHash('sha256').update(maker).digest();
    const amountHash = createHash('sha256').update(amount.toString()).digest();
    
    const combined = Buffer.concat([secretHash, orderIdHash, makerHash, amountHash]);
    return createHash('sha256').update(combined).digest();
  }

  /**
   * Verify secret commitment
   */
  static verifySecretCommitment(
    secret: Buffer,
    orderId: string,
    maker: string,
    amount: bigint,
    expectedCommitment: Buffer
  ): boolean {
    const secretHash = createHash('sha256').update(secret).digest();
    const actualCommitment = this.createSecretCommitment(secretHash, orderId, maker, amount);
    return actualCommitment.equals(expectedCommitment);
  }

  /**
   * Generate time-locked secret (secret that's only valid after certain time)
   */
  static generateTimeLockedSecret(
    unlockTime: number,
    seed?: string
  ): {
    secret: Buffer;
    hash: Buffer;
    unlockTime: number;
  } {
    const baseSeed = seed || Date.now().toString();
    const timeLockedSeed = `${baseSeed}-${unlockTime}`;
    const { secret, hash } = this.generateDeterministicSecret(timeLockedSeed);
    
    return { secret, hash, unlockTime };
  }

  /**
   * Verify time-locked secret is valid for current time
   */
  static isTimeLockedSecretValid(
    secret: Buffer,
    unlockTime: number,
    currentTime: number = Math.floor(Date.now() / 1000)
  ): boolean {
    return currentTime >= unlockTime;
  }
}

export default SecretManager;