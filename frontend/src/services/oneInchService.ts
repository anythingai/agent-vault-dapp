import { ethers } from 'ethers';

// 1inch Order structure (matches backend)
export interface OneInchOrder {
  salt: string;
  maker: string;
  receiver: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  makerTraits: string;
}

// EIP-712 Domain for 1inch
export interface OneInchDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

// EIP-712 Types for 1inch Order
export const ONEINCH_ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'makerAsset', type: 'address' },
    { name: 'takerAsset', type: 'address' },
    { name: 'makingAmount', type: 'uint256' },
    { name: 'takingAmount', type: 'uint256' },
    { name: 'makerTraits', type: 'uint256' }
  ]
};

// Configuration for 1inch integration
export interface OneInchConfig {
  limitOrderProtocol: string;
  escrowFactory: string;
  weth: string;
  domainSeparator: string;
  chainId: number;
}

// Default configuration (will be loaded from deployment)
const DEFAULT_CONFIG: OneInchConfig = {
  limitOrderProtocol: '0x0000000000000000000000000000000000000000', // Placeholder
  escrowFactory: '0x0000000000000000000000000000000000000000',     // Placeholder
  weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',              // WETH on Sepolia
  domainSeparator: '0x0000000000000000000000000000000000000000000000000000000000000000',
  chainId: 11155111 // Sepolia
};

/**
 * 1inch Frontend Integration Service
 * Handles EIP-712 signing and order creation for 1inch Limit Order Protocol
 */
export class OneInchService {
  private config: OneInchConfig;
  private domain: OneInchDomain;

  constructor(config?: Partial<OneInchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Setup EIP-712 domain
    this.domain = {
      name: '1inch Limit Order Protocol',
      version: '4',
      chainId: this.config.chainId,
      verifyingContract: this.config.limitOrderProtocol
    };
  }

  /**
   * Update configuration (called after deployment info is loaded)
   */
  updateConfig(config: Partial<OneInchConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update domain if relevant fields changed
    if (config.limitOrderProtocol || config.chainId) {
      this.domain = {
        ...this.domain,
        chainId: config.chainId || this.domain.chainId,
        verifyingContract: config.limitOrderProtocol || this.domain.verifyingContract
      };
    }
  }

  /**
   * Create a 1inch order from swap form data
   */
  createOrderFromSwapData(
    maker: string,
    makerAsset: string,
    takerAsset: string,
    makingAmount: string,
    takingAmount: string,
    receiver?: string,
    secretHash?: string
  ): OneInchOrder {
    // Generate salt (includes timestamp and random data for uniqueness)
    const timestamp = Math.floor(Date.now() / 1000);
    const randomBytes = ethers.randomBytes(16);
    const salt = ethers.keccak256(
      ethers.concat([
        ethers.toBeHex(timestamp, 32),
        randomBytes
      ])
    );

    // Set maker traits (allow partial fills by default)
    let makerTraits = '0x0';
    // Add flags as needed (simplified for hackathon)

    const order: OneInchOrder = {
      salt,
      maker,
      receiver: receiver || maker, // Default to maker if no receiver specified
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      makerTraits
    };

    return order;
  }

  /**
   * Sign a 1inch order using EIP-712 (MetaMask/browser wallet)
   */
  async signOrder(order: OneInchOrder, signer: ethers.Signer): Promise<{
    signature: string;
    r: string;
    s: string;
    v: number;
  }> {
    // Verify we have the right signer
    const signerAddress = await signer.getAddress();
    if (signerAddress.toLowerCase() !== order.maker.toLowerCase()) {
      throw new Error('Signer address does not match order maker');
    }

    // Create the typed data for EIP-712 signing
    const typedData = {
      types: ONEINCH_ORDER_TYPES,
      domain: this.domain,
      primaryType: 'Order',
      message: {
        salt: order.salt,
        maker: order.maker,
        receiver: order.receiver,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: order.makingAmount,
        takingAmount: order.takingAmount,
        makerTraits: order.makerTraits
      }
    };

    try {
      // Sign using EIP-712
      const signature = await signer.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
      );

      // Split signature into components
      const sig = ethers.Signature.from(signature);
      
      return {
        signature,
        r: sig.r,
        s: sig.s,
        v: sig.v
      };
    } catch (error: any) {
      console.error('Error signing 1inch order:', error);
      
      // Handle specific MetaMask errors
      if (error.code === 4001) {
        throw new Error('User rejected the signing request');
      } else if (error.code === -32603) {
        throw new Error('Internal JSON-RPC error during signing');
      } else {
        throw new Error(`Failed to sign order: ${error.message || 'Unknown error'}`);
      }
    }
  }

  /**
   * Verify an order signature
   */
  async verifyOrderSignature(
    order: OneInchOrder,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    try {
      // Create the typed data hash
      const typedData = {
        types: ONEINCH_ORDER_TYPES,
        domain: this.domain,
        primaryType: 'Order',
        message: {
          salt: order.salt,
          maker: order.maker,
          receiver: order.receiver,
          makerAsset: order.makerAsset,
          takerAsset: order.takerAsset,
          makingAmount: order.makingAmount,
          takingAmount: order.takingAmount,
          makerTraits: order.makerTraits
        }
      };

      // Get the hash of the typed data
      const hash = ethers.TypedDataEncoder.hash(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
      );

      // Recover the signer from the signature
      const recoveredSigner = ethers.recoverAddress(hash, signature);

      return recoveredSigner.toLowerCase() === expectedSigner.toLowerCase();
    } catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Calculate order hash (for tracking and verification)
   */
  calculateOrderHash(order: OneInchOrder): string {
    const typedData = {
      types: ONEINCH_ORDER_TYPES,
      domain: this.domain,
      primaryType: 'Order',
      message: {
        salt: order.salt,
        maker: order.maker,
        receiver: order.receiver,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: order.makingAmount,
        takingAmount: order.takingAmount,
        makerTraits: order.makerTraits
      }
    };

    return ethers.TypedDataEncoder.hash(
      typedData.domain,
      { Order: typedData.types.Order },
      typedData.message
    );
  }

  /**
   * Format order for display in UI
   */
  formatOrderForDisplay(order: OneInchOrder): {
    maker: string;
    giving: { asset: string; amount: string };
    receiving: { asset: string; amount: string };
    orderHash: string;
  } {
    return {
      maker: order.maker,
      giving: {
        asset: order.makerAsset === ethers.ZeroAddress ? 'ETH' : order.makerAsset,
        amount: ethers.formatEther(order.makingAmount)
      },
      receiving: {
        asset: order.takerAsset,
        amount: order.takingAmount
      },
      orderHash: this.calculateOrderHash(order)
    };
  }

  /**
   * Prepare order data for API submission
   */
  prepareOrderForSubmission(
    order: OneInchOrder,
    signature: { signature: string; r: string; s: string; v: number },
    secretHash: string,
    timelock: number,
    bitcoinAddress?: string
  ): any {
    return {
      // 1inch order data
      oneInchOrder: order,
      signature: {
        r: signature.r,
        s: signature.s,
        v: signature.v,
        signature: signature.signature
      },
      
      // Cross-chain swap data
      crossChain: {
        secretHash,
        timelock,
        bitcoinAddress
      },
      
      // Order metadata
      orderHash: this.calculateOrderHash(order),
      createdAt: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): OneInchConfig {
    return { ...this.config };
  }

  /**
   * Check if configuration is properly set
   */
  isConfigured(): boolean {
    return this.config.limitOrderProtocol !== '0x0000000000000000000000000000000000000000' &&
           this.config.escrowFactory !== '0x0000000000000000000000000000000000000000';
  }
}

// Create default instance
export const oneInchService = new OneInchService();

/**
 * Load 1inch deployment configuration from deployment info
 */
export async function loadOneInchConfig(): Promise<void> {
  try {
    // Try to load from deployment config file
    const response = await fetch('/api/config/1inch-deployment');
    if (response.ok) {
      const deploymentConfig = await response.json();
      
      oneInchService.updateConfig({
        limitOrderProtocol: deploymentConfig.contracts.LimitOrderProtocol,
        escrowFactory: deploymentConfig.contracts.EscrowFactory,
        domainSeparator: deploymentConfig.contracts.DomainSeparator,
        chainId: deploymentConfig.network.chainId
      });
      
      console.log('✅ 1inch configuration loaded:', deploymentConfig);
    } else {
      console.warn('⚠️  Could not load 1inch deployment config, using defaults');
    }
  } catch (error) {
    console.error('❌ Error loading 1inch config:', error);
  }
}

export default oneInchService;