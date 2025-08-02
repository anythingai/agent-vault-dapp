// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./interfaces/IOrderMixin.sol";
import "../interfaces/IEscrow.sol";
import "../EscrowFactory.sol";

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title LimitOrderProtocol
 * @dev 1inch-compatible Limit Order Protocol integrated with cross-chain atomic swaps
 * This contract handles order creation, signature verification, and order filling
 * while creating escrow contracts for cross-chain coordination
 */
contract LimitOrderProtocol is IOrderMixin, EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Constants
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)"
    );

    // State variables
    IWETH public immutable weth;
    EscrowFactory public immutable escrowFactory;
    
    // Order tracking
    mapping(address => mapping(bytes32 => uint256)) public remainingInvalidatorForOrder;
    mapping(address => mapping(uint256 => uint256)) public bitInvalidatorForOrder;
    mapping(bytes32 => bool) public cancelledOrders;
    
    // Cross-chain integration
    mapping(bytes32 => address) public orderToEscrow;
    mapping(bytes32 => bool) public isProcessedOrder;

    // Events
    event EscrowCreatedForOrder(
        bytes32 indexed orderHash,
        address indexed escrowAddress,
        address indexed maker,
        uint256 amount
    );

    modifier validOrder(Order calldata order) {
        require(order.maker != address(0), "LimitOrderProtocol: Invalid maker");
        require(order.makerAsset != address(0), "LimitOrderProtocol: Invalid maker asset");
        require(order.takerAsset != address(0), "LimitOrderProtocol: Invalid taker asset");
        require(order.makingAmount > 0, "LimitOrderProtocol: Invalid making amount");
        require(order.takingAmount > 0, "LimitOrderProtocol: Invalid taking amount");
        _;
    }

    constructor(
        address _weth,
        address _escrowFactory
    ) EIP712("1inch Limit Order Protocol", "4") Ownable(msg.sender) {
        weth = IWETH(_weth);
        escrowFactory = EscrowFactory(_escrowFactory);
    }

    /**
     * @dev Pauses the contract (owner only)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract (owner only)
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Returns the domain separator for EIP-712
     */
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev Returns order hash using EIP-712
     */
    function hashOrder(Order calldata order) external view override returns (bytes32) {
        return _hashTypedDataV4(_hashOrder(order));
    }

    /**
     * @dev Internal function to hash order struct
     */
    function _hashOrder(Order calldata order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.salt,
                order.maker,
                order.receiver,
                order.makerAsset,
                order.takerAsset,
                order.makingAmount,
                order.takingAmount,
                order.makerTraits
            )
        );
    }

    /**
     * @dev Cancels an order
     */
    function cancelOrder(uint256 makerTraits, bytes32 orderHash) external override {
        cancelledOrders[orderHash] = true;
        emit OrderCanceled(msg.sender, orderHash, makerTraits);
    }

    /**
     * @dev Fills an order by creating an escrow contract for cross-chain swaps
     */
    function fillOrder(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits
    ) external payable override nonReentrant whenNotPaused validOrder(order) 
      returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash) {
        
        bytes memory emptyArgs;
        return _fillOrder(order, r, vs, amount, takerTraits, emptyArgs);
    }

    /**
     * @dev Fills an order with additional arguments
     */
    function fillOrderArgs(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits,
        bytes calldata args
    ) external payable override nonReentrant whenNotPaused validOrder(order)
      returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash) {
        
        bytes memory argsMemory = args;
        return _fillOrder(order, r, vs, amount, takerTraits, argsMemory);
    }

    /**
     * @dev Internal function to fill orders
     */
    function _fillOrder(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits,
        bytes memory args
    ) internal returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash) {
        // Calculate order hash
        orderHash = _hashTypedDataV4(_hashOrder(order));
        
        // Check if order is cancelled or already processed
        require(!cancelledOrders[orderHash], "LimitOrderProtocol: Order cancelled");
        require(!isProcessedOrder[orderHash], "LimitOrderProtocol: Order already filled");
        
        // Verify signature
        _verifySignature(order, orderHash, r, vs);
        
        // Calculate amounts (simplified - using the requested amount)
        // In a full implementation, this would handle partial fills
        makingAmount = order.makingAmount;
        takingAmount = order.takingAmount;
        
        // Parse args for cross-chain information (if provided)
        bytes32 secretHash;
        uint256 timelock;
        address bitcoinAddress;
        
        if (args.length > 0) {
            (secretHash, timelock, bitcoinAddress) = abi.decode(args, (bytes32, uint256, address));
        } else {
            // Default values if no cross-chain args provided
            secretHash = keccak256(abi.encodePacked(orderHash, block.timestamp));
            timelock = block.timestamp + 2 hours;
            bitcoinAddress = address(0);
        }
        
        // Create escrow contract instead of direct transfer
        address escrowAddress = _createEscrowForOrder(
            order,
            orderHash,
            secretHash,
            timelock,
            makingAmount
        );
        
        // Transfer maker's tokens to the escrow
        _transferToEscrow(order, makingAmount, escrowAddress);
        
        // Mark order as processed
        isProcessedOrder[orderHash] = true;
        orderToEscrow[orderHash] = escrowAddress;
        
        emit OrderFilled(orderHash, makingAmount, takingAmount);
        emit EscrowCreatedForOrder(orderHash, escrowAddress, order.maker, makingAmount);
    }

    /**
     * @dev Creates an escrow contract for the order
     */
    function _createEscrowForOrder(
        Order calldata order,
        bytes32 orderHash,
        bytes32 secretHash,
        uint256 timelock,
        uint256 amount
    ) internal returns (address escrowAddress) {
        uint256 safetyDeposit = 0.001 ether; // Minimum safety deposit
        
        // Create escrow using the factory
        escrowAddress = escrowFactory.createEscrowSrc{value: safetyDeposit}(
            orderHash, // Use order hash as escrow ID
            order.makerAsset,
            amount,
            address(this), // This contract deposits the tokens
            order.receiver, // Receiver can withdraw with secret
            secretHash,
            timelock
        );
        
        return escrowAddress;
    }

    /**
     * @dev Transfers tokens from maker to escrow
     */
    function _transferToEscrow(
        Order calldata order,
        uint256 amount,
        address escrowAddress
    ) internal {
        if (order.makerAsset == address(0)) {
            // Handle ETH
            require(msg.value >= amount, "LimitOrderProtocol: Insufficient ETH");
            payable(escrowAddress).transfer(amount);
            
            // Refund excess
            if (msg.value > amount) {
                payable(msg.sender).transfer(msg.value - amount);
            }
        } else {
            // Handle ERC20
            IERC20(order.makerAsset).safeTransferFrom(order.maker, escrowAddress, amount);
        }
    }

    /**
     * @dev Verifies order signature
     */
    function _verifySignature(
        Order calldata order,
        bytes32 orderHash,
        bytes32 r,
        bytes32 vs
    ) internal pure {
        address recoveredSigner = orderHash.recover(r, vs);
        require(recoveredSigner == order.maker, "LimitOrderProtocol: Invalid signature");
    }

    /**
     * @dev Get escrow address for an order
     */
    function getEscrowForOrder(bytes32 orderHash) external view returns (address) {
        return orderToEscrow[orderHash];
    }

    /**
     * @dev Check if order has been processed
     */
    function isOrderProcessed(bytes32 orderHash) external view returns (bool) {
        return isProcessedOrder[orderHash];
    }

    /**
     * @dev Emergency function to recover stuck ETH (owner only)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /**
     * @dev Receive function to handle ETH deposits
     */
    receive() external payable {
        // Allow ETH deposits for escrow safety deposits and order fills
    }
}