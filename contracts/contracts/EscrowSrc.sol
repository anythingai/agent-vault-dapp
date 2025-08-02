// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IEscrow.sol";

/**
 * @title EscrowSrc
 * @dev Source chain escrow contract that holds the maker's tokens during atomic swap
 * Implements HTLC (Hashed Timelock Contract) logic for secure cross-chain swaps
 */
contract EscrowSrc is IEscrow, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Escrow state
    bytes32 public orderId;
    address public token; // Address(0) for native ETH
    uint256 public amount;
    address public depositor; // Who deposited the funds (usually resolver via LimitOrder)
    address public withdrawer; // Who can withdraw with secret (usually resolver)
    bytes32 public secretHash;
    uint256 public timelock; // Block timestamp when refund becomes available
    uint256 public safetyDeposit; // Native token deposit to incentivize completion
    
    bool public isRedeemed;
    bool public isRefunded;
    bool private initialized;

    // Constants
    uint256 public constant RESOLVER_EXCLUSIVE_PERIOD = 1 hours; // Resolver has exclusive withdraw rights
    
    modifier onlyInitialized() {
        require(initialized, "EscrowSrc: Not initialized");
        _;
    }
    
    modifier onlyNotRedeemed() {
        require(!isRedeemed, "EscrowSrc: Already redeemed");
        _;
    }
    
    modifier onlyNotRefunded() {
        require(!isRefunded, "EscrowSrc: Already refunded");
        _;
    }

    modifier onlyActiveEscrow() {
        require(!isRedeemed && !isRefunded, "EscrowSrc: Escrow not active");
        _;
    }

    /**
     * @dev Initialize the escrow with swap parameters
     * @param _orderId Unique identifier for the swap order
     * @param _token Token contract address (address(0) for ETH)
     * @param _amount Amount of tokens to escrow
     * @param _depositor Address that will deposit the tokens
     * @param _withdrawer Address that can withdraw with secret (resolver)
     * @param _secretHash SHA256 hash of the secret
     * @param _timelock Timestamp when refund becomes available
     * @param _safetyDeposit Amount of native token as safety deposit
     */
    function initialize(
        bytes32 _orderId,
        address _token,
        uint256 _amount,
        address _depositor,
        address _withdrawer,
        bytes32 _secretHash,
        uint256 _timelock,
        uint256 _safetyDeposit
    ) external payable override {
        require(!initialized, "EscrowSrc: Already initialized");
        require(_orderId != bytes32(0), "EscrowSrc: Invalid order ID");
        require(_amount > 0, "EscrowSrc: Amount must be positive");
        require(_depositor != address(0), "EscrowSrc: Invalid depositor");
        require(_withdrawer != address(0), "EscrowSrc: Invalid withdrawer");
        require(_secretHash != bytes32(0), "EscrowSrc: Invalid secret hash");
        require(_timelock > block.timestamp, "EscrowSrc: Invalid timelock");
        require(msg.value == _safetyDeposit, "EscrowSrc: Incorrect safety deposit");

        orderId = _orderId;
        token = _token;
        amount = _amount;
        depositor = _depositor;
        withdrawer = _withdrawer;
        secretHash = _secretHash;
        timelock = _timelock;
        safetyDeposit = _safetyDeposit;
        initialized = true;

        emit EscrowCreated(_orderId, _token, _amount, _secretHash, _timelock);
    }

    /**
     * @dev Deposit tokens into escrow (called by depositor, usually via LimitOrder)
     */
    function deposit() external payable onlyInitialized onlyActiveEscrow nonReentrant {
        require(msg.sender == depositor, "EscrowSrc: Only depositor can deposit");
        
        if (token == address(0)) {
            // Handle ETH deposits
            require(msg.value == amount, "EscrowSrc: Incorrect ETH amount");
        } else {
            // Handle ERC20 deposits
            require(msg.value == 0, "EscrowSrc: No ETH expected for token deposit");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @dev Redeem funds by providing the correct secret (resolver exclusive period)
     * @param secret The preimage that hashes to secretHash
     */
    function redeem(bytes32 secret) external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(sha256(abi.encodePacked(secret)) == secretHash, "EscrowSrc: Invalid secret");
        require(block.timestamp < timelock, "EscrowSrc: Past timelock");
        require(msg.sender == withdrawer, "EscrowSrc: Only withdrawer can redeem in exclusive period");

        isRedeemed = true;
        
        // Transfer funds to withdrawer
        _transferFunds(withdrawer);
        
        // Transfer safety deposit to withdrawer as reward
        if (safetyDeposit > 0) {
            payable(withdrawer).transfer(safetyDeposit);
        }

        emit Redeemed(orderId, secret, withdrawer);
    }

    /**
     * @dev Public withdrawal after resolver exclusive period (anyone can trigger with secret)
     * @param secret The preimage that hashes to secretHash
     */
    function publicWithdraw(bytes32 secret) external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(sha256(abi.encodePacked(secret)) == secretHash, "EscrowSrc: Invalid secret");
        require(block.timestamp < timelock, "EscrowSrc: Past timelock");
        require(block.timestamp >= (timelock - RESOLVER_EXCLUSIVE_PERIOD), "EscrowSrc: Still in exclusive period");

        isRedeemed = true;
        
        // Transfer funds to withdrawer
        _transferFunds(withdrawer);
        
        // Transfer safety deposit to caller as incentive
        if (safetyDeposit > 0) {
            payable(msg.sender).transfer(safetyDeposit);
        }

        emit Redeemed(orderId, secret, withdrawer);
    }

    /**
     * @dev Refund depositor after timelock expires
     */
    function refund() external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(block.timestamp >= timelock, "EscrowSrc: Before timelock");

        isRefunded = true;
        
        // Transfer funds back to depositor
        _transferFunds(depositor);
        
        // Transfer safety deposit to caller as incentive for cleanup
        if (safetyDeposit > 0) {
            payable(msg.sender).transfer(safetyDeposit);
        }

        emit Refunded(orderId, depositor);
    }

    /**
     * @dev Internal function to transfer funds
     * @param recipient Address to receive the funds
     */
    function _transferFunds(address recipient) internal {
        if (token == address(0)) {
            // Transfer ETH
            payable(recipient).transfer(amount);
        } else {
            // Transfer ERC20 tokens
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /**
     * @dev Get escrow details
     */
    function getDetails() external view override returns (
        bytes32 _orderId,
        address _token,
        uint256 _amount,
        address _depositor,
        address _withdrawer,
        bytes32 _secretHash,
        uint256 _timelock,
        uint256 _safetyDeposit,
        bool _isRedeemed,
        bool _isRefunded
    ) {
        return (
            orderId,
            token,
            amount,
            depositor,
            withdrawer,
            secretHash,
            timelock,
            safetyDeposit,
            isRedeemed,
            isRefunded
        );
    }

    /**
     * @dev Check if escrow can be redeemed with secret
     */
    function canRedeem(bytes32 secret) external view returns (bool) {
        return initialized 
            && !isRedeemed 
            && !isRefunded 
            && sha256(abi.encodePacked(secret)) == secretHash 
            && block.timestamp < timelock;
    }

    /**
     * @dev Check if escrow can be refunded
     */
    function canRefund() external view returns (bool) {
        return initialized 
            && !isRedeemed 
            && !isRefunded 
            && block.timestamp >= timelock;
    }

    /**
     * @dev Emergency function to recover stuck funds (only after significant delay)
     */
    function emergencyRecover() external onlyInitialized nonReentrant {
        require(block.timestamp >= timelock + 7 days, "EscrowSrc: Emergency period not reached");
        require(!isRedeemed && !isRefunded, "EscrowSrc: Already resolved");
        
        // Treat as refund to depositor
        isRefunded = true;
        _transferFunds(depositor);
        
        if (safetyDeposit > 0) {
            payable(msg.sender).transfer(safetyDeposit);
        }

        emit Refunded(orderId, depositor);
    }

    /**
     * @dev Receive function to handle direct ETH transfers
     */
    receive() external payable {
        // Only accept ETH during initialization for safety deposit
        // or during deposit if this is an ETH escrow
        require(!initialized || (token == address(0) && msg.sender == depositor), "EscrowSrc: Unexpected ETH");
    }
}