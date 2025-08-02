import { Address, Hash, Amount, ChainId } from './types.js';

/**
 * 1inch Limit Order Protocol compatible types
 */

// 1inch Order structure (matches the contract)
export interface OneInchOrder {
  salt: string; // uint256 as hex string
  maker: Address;
  receiver: Address;
  makerAsset: Address;
  takerAsset: Address;
  makingAmount: Amount;
  takingAmount: Amount;
  makerTraits: string; // uint256 as hex string (bit flags)
}

// EIP-712 Domain for 1inch
export interface OneInchDomain {
  name: string;
  version: string;
  chainId: ChainId;
  verifyingContract: Address;
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

// Extended order with cross-chain data
export interface OneInchCrossChainOrder extends OneInchOrder {
  // Cross-chain specific fields
  secretHash: Hash;
  timelock: number;
  bitcoinAddress?: string;
  
  // Signature components for verification
  signature?: {
    r: string;
    s: string;
    v: number;
  };
  
  // Original swap order ID for tracking
  originalOrderId: string;
  
  // EIP-712 hash of the order
  orderHash?: Hash;
}

// 1inch fill order parameters
export interface OneInchFillParams {
  order: OneInchOrder;
  r: string; // bytes32
  vs: string; // bytes32 (combines v and s)
  amount: Amount;
  takerTraits: string; // uint256 as hex string
  args?: string; // bytes (optional cross-chain args)
}

// Cross-chain arguments for fillOrder
export interface CrossChainFillArgs {
  secretHash: Hash;
  timelock: number;
  bitcoinAddress: Address;
}

// 1inch contract addresses and configuration
export interface OneInchConfig {
  limitOrderProtocol: Address;
  escrowFactory: Address;
  weth: Address;
  domainSeparator: Hash;
  chainId: ChainId;
}

// Maker traits bit flags (simplified version)
export enum MakerTraits {
  NO_PARTIAL_FILL = 1 << 0,
  ALLOW_MULTIPLE_FILLS = 1 << 1,
  PRE_INTERACTION = 1 << 2,
  POST_INTERACTION = 1 << 3,
  NEED_CHECK_EPOCH_MANAGER = 1 << 4,
  HAS_EXTENSION = 1 << 5,
  USE_PERMIT2 = 1 << 6,
  UNWRAP_WETH = 1 << 7
}

// Taker traits bit flags (simplified version)
export enum TakerTraits {
  MAKER_AMOUNT_FLAG = 1 << 0,
  UNWRAP_WETH = 1 << 1,
  SKIP_ORDER_PERMIT = 1 << 2,
  USE_PERMIT2 = 1 << 3,
  ARGS_HAS_TARGET = 1 << 4
}

// Fill order result from 1inch contract
export interface OneInchFillResult {
  makingAmount: Amount;
  takingAmount: Amount;
  orderHash: Hash;
  escrowAddress?: Address;
  transactionHash: Hash;
}

// Helper functions for bit manipulation
export class TraitsHelper {
  static setFlag(traits: string, flag: number): string {
    const traitsNum = BigInt(traits);
    return '0x' + (traitsNum | BigInt(flag)).toString(16);
  }
  
  static hasFlag(traits: string, flag: number): boolean {
    const traitsNum = BigInt(traits);
    return (traitsNum & BigInt(flag)) !== 0n;
  }
  
  static clearFlag(traits: string, flag: number): string {
    const traitsNum = BigInt(traits);
    return '0x' + (traitsNum & ~BigInt(flag)).toString(16);
  }
}

// Convert existing SwapOrder to 1inch format
export interface OrderConversionResult {
  oneInchOrder: OneInchCrossChainOrder;
  crossChainArgs: CrossChainFillArgs;
}