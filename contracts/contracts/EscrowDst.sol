// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IEscrow.sol";

/**
 * @title EscrowDst
 * @dev Destination chain escrow contract that holds the resolver's tokens for user withdrawal
 * Implements HTLC (Hashed Timelock Contract) logic for secure cross-chain swaps
 */
contract EscrowDst is IEscrow, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Escrow state
    bytes32 public orderId;
    address public token; // Address(0) for native ETH
    uint256 public amount;
    address public depositor; // Who deposited the funds (resolver)
    address public withdrawer; // Who can withdraw with secret (user)
    bytes32 public secretHash;
    uint256 public timelock; // Block timestamp when refund becomes available
    uint256 public safetyDeposit; // Native token deposit to incentivize completion
    uint256 public depositTimestamp; // CRITICAL FIX: Tracks when deposit was made for public withdraw delay calculation
    
    bool public isRedeemed;
    bool public isRefunded;
    bool private initialized;

    // Constants
    uint256 public constant PUBLIC_WITHDRAW_DELAY = 30 minutes; // Anyone can withdraw for user after delay
    
    modifier onlyInitialized() {
        require(initialized, "EscrowDst: Not initialized");
        _;
    }
    
    modifier onlyNotRedeemed() {
        require(!isRedeemed, "EscrowDst: Already redeemed");
        _;
    }
    
    modifier onlyNotRefunded() {
        require(!isRefunded, "EscrowDst: Already refunded");
        _;
    }

    modifier onlyActiveEscrow() {
        require(!isRedeemed && !isRefunded, "EscrowDst: Escrow not active");
        _;
    }

    /**
     * @dev Initialize the escrow with swap parameters
     * @param _orderId Unique identifier for the swap order
     * @param _token Token contract address (address(0) for ETH)
     * @param _amount Amount of tokens to escrow
     * @param _depositor Address that will deposit the tokens (resolver)
     * @param _withdrawer Address that can withdraw with secret (user)
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
        require(!initialized, "EscrowDst: Already initialized");
        require(_orderId != bytes32(0), "EscrowDst: Invalid order ID");
        require(_amount > 0, "EscrowDst: Amount must be positive");
        require(_depositor != address(0), "EscrowDst: Invalid depositor");
        require(_withdrawer != address(0), "EscrowDst: Invalid withdrawer");
        require(_secretHash != bytes32(0), "EscrowDst: Invalid secret hash");
        require(_timelock > block.timestamp, "EscrowDst: Invalid timelock");
        require(msg.value == _safetyDeposit, "EscrowDst: Incorrect safety deposit");

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
     * @dev Deposit tokens into escrow (called by resolver)
     */
    function deposit() external payable onlyInitialized onlyActiveEscrow nonReentrant {
        require(msg.sender == depositor, "EscrowDst: Only depositor can deposit");
        require(depositTimestamp == 0, "EscrowDst: Already deposited");
        
        // CRITICAL FIX: Record deposit timestamp for proper public withdrawal delay calculation
        // This fixes the bug where public withdrawals were impossible due to incorrect timelock logic
        depositTimestamp = block.timestamp;
        
        if (token == address(0)) {
            // Handle ETH deposits
            require(msg.value == amount, "EscrowDst: Incorrect ETH amount");
        } else {
            // Handle ERC20 deposits
            require(msg.value == 0, "EscrowDst: No ETH expected for token deposit");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @dev Redeem funds by providing the correct secret (user only initially)
     * @param secret The preimage that hashes to secretHash
     */
    function redeem(bytes32 secret) external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(sha256(abi.encodePacked(secret)) == secretHash, "EscrowDst: Invalid secret");
        require(block.timestamp < timelock, "EscrowDst: Past timelock");
        require(msg.sender == withdrawer, "EscrowDst: Only user can redeem directly");

        isRedeemed = true;
        
        // Transfer funds to user
        _transferFunds(withdrawer);
        
        // Transfer safety deposit to user as bonus
        if (safetyDeposit > 0) {
            payable(withdrawer).transfer(safetyDeposit);
        }

        emit Redeemed(orderId, secret, withdrawer);
    }

    /**
     * @dev Public withdrawal - anyone can trigger withdrawal for user after delay
     * @param secret The preimage that hashes to secretHash
     */
    function publicWithdraw(bytes32 secret) external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(sha256(abi.encodePacked(secret)) == secretHash, "EscrowDst: Invalid secret");
        require(block.timestamp < timelock, "EscrowDst: Past timelock");
        require(depositTimestamp > 0, "EscrowDst: No deposit made yet");
        
        // Allow public withdrawal after some delay to give user first opportunity
        // This incentivizes anyone to complete the swap if user is offline
        // CRITICAL SECURITY FIX: Previously used (block.timestamp + PUBLIC_WITHDRAW_DELAY)
        // which was mathematically impossible and broke public withdrawals completely.
        // Now correctly uses depositTimestamp as reference point.
        require(
            msg.sender == withdrawer ||
            block.timestamp >= (depositTimestamp + PUBLIC_WITHDRAW_DELAY),
            "EscrowDst: Public withdraw not yet available"
        );

        isRedeemed = true;
        
        // Transfer funds to user (withdrawer)
        _transferFunds(withdrawer);
        
        // Transfer safety deposit to caller as incentive if they're not the user
        if (safetyDeposit > 0) {
            if (msg.sender == withdrawer) {
                payable(withdrawer).transfer(safetyDeposit);
            } else {
                // Split safety deposit: half to user, half to helpful caller
                uint256 userShare = safetyDeposit / 2;
                uint256 callerShare = safetyDeposit - userShare;
                payable(withdrawer).transfer(userShare);
                payable(msg.sender).transfer(callerShare);
            }
        }

        emit Redeemed(orderId, secret, withdrawer);
    }

    /**
     * @dev Refund depositor after timelock expires
     */
    function refund() external override onlyInitialized onlyNotRedeemed onlyNotRefunded nonReentrant {
        require(block.timestamp >= timelock, "EscrowDst: Before timelock");

        isRefunded = true;
        
        // Transfer funds back to depositor (resolver)
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
     * @dev Check if public withdrawal is available
     */
    function canPublicWithdraw(bytes32 secret) external view returns (bool) {
        return initialized
            && !isRedeemed
            && !isRefunded
            && sha256(abi.encodePacked(secret)) == secretHash
            && block.timestamp < timelock
            && depositTimestamp > 0
            && block.timestamp >= (depositTimestamp + PUBLIC_WITHDRAW_DELAY);
    }

    /**
     * @dev Emergency function to recover stuck funds (only after significant delay)
     */
    function emergencyRecover() external onlyInitialized nonReentrant {
        require(block.timestamp >= timelock + 7 days, "EscrowDst: Emergency period not reached");
        require(!isRedeemed && !isRefunded, "EscrowDst: Already resolved");
        
        // In destination escrow, emergency recovery goes to the user (withdrawer)
        // since they're the intended recipient
        isRedeemed = true;
        _transferFunds(withdrawer);
        
        if (safetyDeposit > 0) {
            // Split between user and caller
            uint256 userShare = safetyDeposit / 2;
            uint256 callerShare = safetyDeposit - userShare;
            payable(withdrawer).transfer(userShare);
            payable(msg.sender).transfer(callerShare);
        }

        emit Redeemed(orderId, bytes32(0), withdrawer);
    }

    /**
     * @dev Receive function to handle direct ETH transfers
     */
    receive() external payable {
        // Only accept ETH during initialization for safety deposit
        // or during deposit if this is an ETH escrow
        require(!initialized || (token == address(0) && msg.sender == depositor), "EscrowDst: Unexpected ETH");
    }
}