import { ethers } from 'ethers';
import { 
  OneInchOrder, 
  OneInchCrossChainOrder, 
  OneInchConfig, 
  OneInchFillParams,
  CrossChainFillArgs,
  OneInchFillResult,
  OrderConversionResult,
  ONEINCH_ORDER_TYPES,
  MakerTraits,
  TakerTraits,
  TraitsHelper,
  OneInchDomain
} from '../shared/oneinch-types.js';
import { SwapOrder, Address, Hash } from '../shared/types.js';

/**
 * 1inch Limit Order Protocol Integration Service
 * Handles order conversion, EIP-712 signing, and fillOrder calls
 */
export class OneInchIntegrationService {
  private provider: ethers.Provider;
  private limitOrderContract: ethers.Contract;
  private config: OneInchConfig;
  private domain: OneInchDomain;

  // 1inch LimitOrderProtocol ABI (minimal required functions)
  private readonly LIMIT_ORDER_ABI = [
    'function fillOrder(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 r, bytes32 vs, uint256 amount, uint256 takerTraits) external payable returns (uint256, uint256, bytes32)',
    'function fillOrderArgs(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 r, bytes32 vs, uint256 amount, uint256 takerTraits, bytes args) external payable returns (uint256, uint256, bytes32)',
    'function hashOrder(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order) external view returns (bytes32)',
    'function DOMAIN_SEPARATOR() external view returns (bytes32)',
    'function getEscrowForOrder(bytes32 orderHash) external view returns (address)',
    'function isOrderProcessed(bytes32 orderHash) external view returns (bool)'
  ];

  constructor(provider: ethers.Provider, config: OneInchConfig) {
    this.provider = provider;
    this.config = config;
    
    // Initialize contract
    this.limitOrderContract = new ethers.Contract(
      config.limitOrderProtocol,
      this.LIMIT_ORDER_ABI,
      provider
    );

    // Setup EIP-712 domain
    this.domain = {
      name: '1inch Limit Order Protocol',
      version: '4',
      chainId: config.chainId,
      verifyingContract: config.limitOrderProtocol
    };
  }

  /**
   * Convert existing SwapOrder to 1inch Order format
   */
  convertSwapOrderToOneInch(
    swapOrder: SwapOrder,
    receiver?: Address
  ): OrderConversionResult {
    // Generate salt (includes order ID and timestamp for uniqueness)
    const salt = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes(swapOrder.orderId),
        ethers.toBeHex(swapOrder.createdAt, 32)
      ])
    );

    // Set maker traits (allow partial fills by default)
    let makerTraits = '0x0';
    makerTraits = TraitsHelper.setFlag(makerTraits, MakerTraits.ALLOW_MULTIPLE_FILLS);

    // Create 1inch order
    const oneInchOrder: OneInchCrossChainOrder = {
      salt,
      maker: swapOrder.maker,
      receiver: receiver || swapOrder.maker, // Default to maker if no receiver specified
      makerAsset: swapOrder.makerAsset.token,
      takerAsset: swapOrder.takerAsset.token,
      makingAmount: swapOrder.makerAsset.amount,
      takingAmount: swapOrder.takerAsset.amount,
      makerTraits,
      
      // Cross-chain specific fields
      secretHash: swapOrder.secretHash,
      timelock: swapOrder.timelock,
      originalOrderId: swapOrder.orderId
    };

    // Prepare cross-chain arguments
    const crossChainArgs: CrossChainFillArgs = {
      secretHash: swapOrder.secretHash,
      timelock: swapOrder.timelock,
      bitcoinAddress: ethers.ZeroAddress // Will be set during Bitcoin coordination
    };

    return {
      oneInchOrder,
      crossChainArgs
    };
  }

  /**
   * Sign a 1inch order using EIP-712
   */
  async signOrder(
    order: OneInchOrder,
    signer: ethers.Signer
  ): Promise<{ r: string; s: string; v: number; signature: string }> {
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

    // Sign using EIP-712
    const signature = await signer.signTypedData(
      typedData.domain,
      { Order: typedData.types.Order },
      typedData.message
    );

    // Split signature into components
    const sig = ethers.Signature.from(signature);
    
    return {
      r: sig.r,
      s: sig.s,
      v: sig.v,
      signature
    };
  }

  /**
   * Calculate order hash using the contract
   */
  async calculateOrderHash(order: OneInchOrder): Promise<Hash> {
    return await this.limitOrderContract.hashOrder([
      order.salt,
      order.maker,
      order.receiver,
      order.makerAsset,
      order.takerAsset,
      order.makingAmount,
      order.takingAmount,
      order.makerTraits
    ]);
  }

  /**
   * Fill a 1inch order (used by resolvers)
   */
  async fillOrder(
    fillParams: OneInchFillParams,
    signer: ethers.Signer,
    crossChainArgs?: CrossChainFillArgs
  ): Promise<OneInchFillResult> {
    const contractWithSigner = this.limitOrderContract.connect(signer);
    
    let tx: ethers.ContractTransactionResponse;
    
    if (crossChainArgs) {
      // Encode cross-chain arguments
      const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256', 'address'],
        [crossChainArgs.secretHash, crossChainArgs.timelock, crossChainArgs.bitcoinAddress]
      );

      // Call fillOrderArgs with cross-chain data
      tx = await (contractWithSigner as any).fillOrderArgs(
        [
          fillParams.order.salt,
          fillParams.order.maker,
          fillParams.order.receiver,
          fillParams.order.makerAsset,
          fillParams.order.takerAsset,
          fillParams.order.makingAmount,
          fillParams.order.takingAmount,
          fillParams.order.makerTraits
        ],
        fillParams.r,
        fillParams.vs,
        fillParams.amount,
        fillParams.takerTraits,
        encodedArgs
      ) as ethers.ContractTransactionResponse;
    } else {
      // Call basic fillOrder
      tx = await (contractWithSigner as any).fillOrder(
        [
          fillParams.order.salt,
          fillParams.order.maker,
          fillParams.order.receiver,
          fillParams.order.makerAsset,
          fillParams.order.takerAsset,
          fillParams.order.makingAmount,
          fillParams.order.takingAmount,
          fillParams.order.makerTraits
        ],
        fillParams.r,
        fillParams.vs,
        fillParams.amount,
        fillParams.takerTraits
      ) as ethers.ContractTransactionResponse;
    }

    // Wait for transaction confirmation
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('Transaction failed');
    }

    // Parse the OrderFilled event to get results
    const orderFilledEvent = receipt.logs.find(log => {
      try {
        const parsedLog = this.limitOrderContract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
        return parsedLog?.name === 'OrderFilled';
      } catch {
        return false;
      }
    });

    if (!orderFilledEvent) {
      throw new Error('OrderFilled event not found in transaction receipt');
    }

    const parsedLog = this.limitOrderContract.interface.parseLog({
      topics: orderFilledEvent.topics as string[],
      data: orderFilledEvent.data
    });

    if (!parsedLog) {
      throw new Error('Failed to parse OrderFilled event');
    }

    const [orderHash, makingAmount, takingAmount] = parsedLog.args;

    // Get escrow address if created
    let escrowAddress: Address | undefined;
    try {
      escrowAddress = await this.limitOrderContract.getEscrowForOrder(orderHash);
      if (escrowAddress === ethers.ZeroAddress) {
        escrowAddress = undefined;
      }
    } catch (error) {
      console.warn('Could not get escrow address:', error);
    }

    return {
      makingAmount: makingAmount.toString(),
      takingAmount: takingAmount.toString(),
      orderHash,
      escrowAddress,
      transactionHash: receipt.hash
    };
  }

  /**
   * Check if order has been processed
   */
  async isOrderProcessed(orderHash: Hash): Promise<boolean> {
    return await this.limitOrderContract.isOrderProcessed(orderHash);
  }

  /**
   * Get escrow address for an order
   */
  async getEscrowForOrder(orderHash: Hash): Promise<Address | null> {
    try {
      const escrowAddress = await this.limitOrderContract.getEscrowForOrder(orderHash);
      return escrowAddress === ethers.ZeroAddress ? null : escrowAddress;
    } catch (error) {
      console.error('Error getting escrow for order:', error);
      return null;
    }
  }

  /**
   * Prepare fill parameters with proper signature components
   */
  prepareFillParams(
    order: OneInchOrder,
    signature: { r: string; s: string; v: number },
    amount: string,
    takerTraits?: string
  ): OneInchFillParams {
    // Combine v and s into vs format (1inch optimization)
    const vs = ethers.concat([
      ethers.toBeHex(signature.v - 27, 1), // Convert v to 0/1 format
      signature.s
    ]);

    return {
      order,
      r: signature.r,
      vs: ethers.hexlify(vs),
      amount,
      takerTraits: takerTraits || '0x0'
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): OneInchConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OneInchConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update contract instance if address changed
    if (newConfig.limitOrderProtocol) {
      this.limitOrderContract = new ethers.Contract(
        newConfig.limitOrderProtocol,
        this.LIMIT_ORDER_ABI,
        this.provider
      );
    }
    
    // Update domain if relevant fields changed
    if (newConfig.limitOrderProtocol || newConfig.chainId) {
      this.domain = {
        ...this.domain,
        chainId: newConfig.chainId || this.domain.chainId,
        verifyingContract: newConfig.limitOrderProtocol || this.domain.verifyingContract
      };
    }
  }
}

export default OneInchIntegrationService;