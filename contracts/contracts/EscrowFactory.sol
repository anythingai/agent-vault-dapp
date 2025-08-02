// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./EscrowSrc.sol";
import "./EscrowDst.sol";
import "./interfaces/IEscrow.sol";

/**
 * @title EscrowFactory
 * @dev Factory contract for creating deterministic escrow instances using CREATE2
 * Supports both source and destination escrows for cross-chain atomic swaps
 */
contract EscrowFactory is Ownable, ReentrancyGuard {
    using Clones for address;

    // Events
    event EscrowSrcCreated(
        bytes32 indexed orderId,
        address indexed escrowAddress,
        address indexed token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    event EscrowDstCreated(
        bytes32 indexed orderId,
        address indexed escrowAddress,
        address indexed token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );

    // Implementation contracts
    address public immutable escrowSrcImplementation;
    address public immutable escrowDstImplementation;
    
    // Mapping to track created escrows
    mapping(bytes32 => address) public escrows;
    mapping(address => bool) public isEscrow;
    
    // Configuration
    uint256 public minimumSafetyDeposit = 0.001 ether;
    uint256 public maximumTimelock = 24 hours;
    uint256 public minimumTimelock = 30 minutes;
    
    // Statistics
    uint256 public totalEscrowsCreated;
    uint256 public totalValueLocked;

    modifier validOrderId(bytes32 orderId) {
        require(orderId != bytes32(0), "EscrowFactory: Invalid order ID");
        require(escrows[orderId] == address(0), "EscrowFactory: Order already exists");
        _;
    }

    modifier validTimelock(uint256 timelock) {
        require(timelock > block.timestamp + minimumTimelock, "EscrowFactory: Timelock too short");
        require(timelock <= block.timestamp + maximumTimelock, "EscrowFactory: Timelock too long");
        _;
    }

    constructor() Ownable(msg.sender) {
        // Deploy implementation contracts
        escrowSrcImplementation = address(new EscrowSrc());
        escrowDstImplementation = address(new EscrowDst());
    }

    /**
     * @dev Create a new source escrow instance
     * @param orderId Unique identifier for the swap order
     * @param token Token contract address (address(0) for ETH)
     * @param amount Amount of tokens to escrow
     * @param depositor Address that will deposit the tokens
     * @param withdrawer Address that can withdraw with secret
     * @param secretHash SHA256 hash of the secret
     * @param timelock Timestamp when refund becomes available
     * @return escrowAddress Address of the created escrow contract
     */
    function createEscrowSrc(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) external payable validOrderId(orderId) validTimelock(timelock) nonReentrant returns (address escrowAddress) {
        require(amount > 0, "EscrowFactory: Amount must be positive");
        require(depositor != address(0), "EscrowFactory: Invalid depositor");
        require(withdrawer != address(0), "EscrowFactory: Invalid withdrawer");
        require(secretHash != bytes32(0), "EscrowFactory: Invalid secret hash");
        require(msg.value >= minimumSafetyDeposit, "EscrowFactory: Insufficient safety deposit");

        // Calculate deterministic address
        bytes32 salt = keccak256(abi.encodePacked(orderId, "src"));
        escrowAddress = Clones.cloneDeterministic(escrowSrcImplementation, salt);
        
        // Initialize the escrow
        IEscrow(escrowAddress).initialize{value: msg.value}(
            orderId,
            token,
            amount,
            depositor,
            withdrawer,
            secretHash,
            timelock,
            msg.value
        );

        // Track the escrow
        escrows[orderId] = escrowAddress;
        isEscrow[escrowAddress] = true;
        totalEscrowsCreated++;
        totalValueLocked += amount;

        emit EscrowSrcCreated(orderId, escrowAddress, token, amount, secretHash, timelock);
    }

    /**
     * @dev Create a new destination escrow instance
     * @param orderId Unique identifier for the swap order
     * @param token Token contract address (address(0) for ETH)
     * @param amount Amount of tokens to escrow
     * @param depositor Address that will deposit the tokens (resolver)
     * @param withdrawer Address that can withdraw with secret (user)
     * @param secretHash SHA256 hash of the secret
     * @param timelock Timestamp when refund becomes available
     * @return escrowAddress Address of the created escrow contract
     */
    function createEscrowDst(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) external payable validOrderId(orderId) validTimelock(timelock) nonReentrant returns (address escrowAddress) {
        require(amount > 0, "EscrowFactory: Amount must be positive");
        require(depositor != address(0), "EscrowFactory: Invalid depositor");
        require(withdrawer != address(0), "EscrowFactory: Invalid withdrawer");
        require(secretHash != bytes32(0), "EscrowFactory: Invalid secret hash");
        require(msg.value >= minimumSafetyDeposit, "EscrowFactory: Insufficient safety deposit");

        // Calculate deterministic address
        bytes32 salt = keccak256(abi.encodePacked(orderId, "dst"));
        escrowAddress = Clones.cloneDeterministic(escrowDstImplementation, salt);
        
        // Initialize the escrow
        IEscrow(escrowAddress).initialize{value: msg.value}(
            orderId,
            token,
            amount,
            depositor,
            withdrawer,
            secretHash,
            timelock,
            msg.value
        );

        // Track the escrow
        escrows[orderId] = escrowAddress;
        isEscrow[escrowAddress] = true;
        totalEscrowsCreated++;
        totalValueLocked += amount;

        emit EscrowDstCreated(orderId, escrowAddress, token, amount, secretHash, timelock);
    }

    /**
     * @dev Get the predicted address for a source escrow
     * @param orderId Unique identifier for the swap order
     * @return predictedAddress The address where the escrow will be deployed
     */
    function getEscrowSrcAddress(bytes32 orderId) external view returns (address predictedAddress) {
        bytes32 salt = keccak256(abi.encodePacked(orderId, "src"));
        predictedAddress = Clones.predictDeterministicAddress(escrowSrcImplementation, salt);
    }

    /**
     * @dev Get the predicted address for a destination escrow
     * @param orderId Unique identifier for the swap order
     * @return predictedAddress The address where the escrow will be deployed
     */
    function getEscrowDstAddress(bytes32 orderId) external view returns (address predictedAddress) {
        bytes32 salt = keccak256(abi.encodePacked(orderId, "dst"));
        predictedAddress = Clones.predictDeterministicAddress(escrowDstImplementation, salt);
    }

    /**
     * @dev Batch create escrows for partial fills
     * @param orderIds Array of unique order identifiers
     * @param tokens Array of token addresses
     * @param amounts Array of amounts
     * @param depositors Array of depositor addresses
     * @param withdrawers Array of withdrawer addresses
     * @param secretHashes Array of secret hashes
     * @param timelocks Array of timelocks
     * @param isSource Array indicating whether each escrow is source (true) or destination (false)
     * @return escrowAddresses Array of created escrow addresses
     */
    function batchCreateEscrows(
        bytes32[] calldata orderIds,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address[] calldata depositors,
        address[] calldata withdrawers,
        bytes32[] calldata secretHashes,
        uint256[] calldata timelocks,
        bool[] calldata isSource
    ) external payable nonReentrant returns (address[] memory escrowAddresses) {
        require(orderIds.length == tokens.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == amounts.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == depositors.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == withdrawers.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == secretHashes.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == timelocks.length, "EscrowFactory: Array length mismatch");
        require(orderIds.length == isSource.length, "EscrowFactory: Array length mismatch");

        uint256 totalSafetyDeposit = minimumSafetyDeposit * orderIds.length;
        require(msg.value >= totalSafetyDeposit, "EscrowFactory: Insufficient safety deposit");

        escrowAddresses = new address[](orderIds.length);
        uint256 depositPerEscrow = msg.value / orderIds.length;

        for (uint256 i = 0; i < orderIds.length; i++) {
            if (isSource[i]) {
                escrowAddresses[i] = this.createEscrowSrc{value: depositPerEscrow}(
                    orderIds[i],
                    tokens[i],
                    amounts[i],
                    depositors[i],
                    withdrawers[i],
                    secretHashes[i],
                    timelocks[i]
                );
            } else {
                escrowAddresses[i] = this.createEscrowDst{value: depositPerEscrow}(
                    orderIds[i],
                    tokens[i],
                    amounts[i],
                    depositors[i],
                    withdrawers[i],
                    secretHashes[i],
                    timelocks[i]
                );
            }
        }
    }

    /**
     * @dev Get escrow details by order ID
     * @param orderId The order identifier
     * @return escrowAddress Address of the escrow
     * @return _orderId Order ID from escrow details
     * @return token Token address from escrow details
     * @return amount Token amount from escrow details
     * @return depositor Depositor address from escrow details
     * @return withdrawer Withdrawer address from escrow details
     * @return secretHash Secret hash from escrow details
     * @return timelock Timelock from escrow details
     * @return safetyDeposit Safety deposit from escrow details
     * @return isRedeemed Whether escrow is redeemed
     * @return isRefunded Whether escrow is refunded
     */
    /**
     * @dev Get escrow address by order ID
     * @param orderId The order identifier
     * @return escrowAddress Address of the escrow
     */
    function getEscrowAddress(bytes32 orderId) external view returns (address escrowAddress) {
        escrowAddress = escrows[orderId];
        require(escrowAddress != address(0), "EscrowFactory: Escrow not found");
    }

    /**
     * @dev Update factory configuration (owner only)
     */
    function updateConfig(
        uint256 _minimumSafetyDeposit,
        uint256 _maximumTimelock,
        uint256 _minimumTimelock
    ) external onlyOwner {
        require(_minimumTimelock > 0, "EscrowFactory: Invalid minimum timelock");
        require(_maximumTimelock > _minimumTimelock, "EscrowFactory: Invalid maximum timelock");
        
        minimumSafetyDeposit = _minimumSafetyDeposit;
        maximumTimelock = _maximumTimelock;
        minimumTimelock = _minimumTimelock;
    }

    /**
     * @dev Emergency pause for factory (owner only)
     */
    bool public paused = false;
    
    modifier whenNotPaused() {
        require(!paused, "EscrowFactory: Contract is paused");
        _;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /**
     * @dev Get factory statistics
     */
    function getFactoryStats() external view returns (
        uint256 _totalEscrowsCreated,
        uint256 _totalValueLocked,
        uint256 _minimumSafetyDeposit,
        uint256 _maximumTimelock,
        uint256 _minimumTimelock,
        address _escrowSrcImplementation,
        address _escrowDstImplementation
    ) {
        return (
            totalEscrowsCreated,
            totalValueLocked,
            minimumSafetyDeposit,
            maximumTimelock,
            minimumTimelock,
            escrowSrcImplementation,
            escrowDstImplementation
        );
    }

    /**
     * @dev Emergency recovery for factory owner
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}