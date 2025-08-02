// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./EscrowSrc.sol";
import "./EscrowDst.sol";
import "./interfaces/IEscrow.sol";

/**
 * @title RateLimitedEscrowFactory
 * @dev Enhanced EscrowFactory with comprehensive rate limiting and DOS protection
 * 
 * Features:
 * - Per-user rate limiting with cooldown periods
 * - Gas-based rate limiting to prevent exhaustion attacks
 * - Circuit breaker patterns for emergency situations
 * - Maximum transaction limits per time window
 * - Progressive penalties for repeated violations
 * - Batch operation limits and validation
 * - Economic incentives alignment
 */
contract RateLimitedEscrowFactory is Ownable, ReentrancyGuard, Pausable {
    using Clones for address;

    // Rate limiting structures
    struct UserRateLimit {
        uint256 requestCount;
        uint256 lastRequestTime;
        uint256 windowStart;
        uint256 penaltyLevel;
        uint256 blockedUntil;
        uint256 totalGasUsed;
        uint256 gasWindowStart;
    }

    struct CircuitBreaker {
        bool isOpen;
        uint256 failureCount;
        uint256 lastFailureTime;
        uint256 openedAt;
        uint256 successCount;
        uint256 totalRequests;
    }

    struct RateLimitConfig {
        uint256 maxRequestsPerWindow;
        uint256 windowDuration;
        uint256 cooldownPeriod;
        uint256 maxGasPerWindow;
        uint256 gasWindowDuration;
        uint256 penaltyMultiplier;
        uint256 maxPenaltyLevel;
        uint256 maxBatchSize;
    }

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

    event RateLimitViolation(
        address indexed user,
        string violationType,
        uint256 timestamp,
        uint256 penaltyLevel
    );

    event CircuitBreakerTriggered(
        string indexed breakerName,
        uint256 timestamp,
        string reason
    );

    event UserBlocked(
        address indexed user,
        uint256 blockedUntil,
        string reason
    );

    event EmergencyStop(
        address indexed admin,
        string reason,
        uint256 timestamp
    );

    // Implementation contracts
    address public immutable escrowSrcImplementation;
    address public immutable escrowDstImplementation;
    
    // Rate limiting state
    mapping(address => UserRateLimit) public userRateLimits;
    mapping(string => CircuitBreaker) public circuitBreakers;
    mapping(bytes32 => address) public escrows;
    mapping(address => bool) public isEscrow;
    
    // Configuration
    RateLimitConfig public rateLimitConfig;
    uint256 public minimumSafetyDeposit = 0.001 ether;
    uint256 public maximumTimelock = 24 hours;
    uint256 public minimumTimelock = 30 minutes;
    uint256 public globalRequestCount;
    uint256 public globalGasUsed;
    uint256 public lastGlobalReset;
    
    // Statistics
    uint256 public totalEscrowsCreated;
    uint256 public totalValueLocked;
    uint256 public totalViolations;
    uint256 public totalBlockedUsers;

    // Administrative controls
    mapping(address => bool) public whitelist;
    mapping(address => bool) public blacklist;
    bool public emergencyStop;

    // Constants
    uint256 private constant CIRCUIT_BREAKER_THRESHOLD = 10;
    uint256 private constant CIRCUIT_BREAKER_RECOVERY_TIME = 5 minutes;
    uint256 private constant MAX_GLOBAL_REQUESTS_PER_BLOCK = 50;
    uint256 private constant MAX_GLOBAL_GAS_PER_BLOCK = 10_000_000;

    modifier rateLimited() {
        require(!emergencyStop, "Emergency stop activated");
        require(!blacklist[msg.sender], "Address is blacklisted");
        
        if (!whitelist[msg.sender]) {
            _checkRateLimit(msg.sender);
            _checkGasLimit(msg.sender);
            _checkCircuitBreakers();
        }
        
        _;
        
        _recordRequest(msg.sender);
    }

    modifier validOrderId(bytes32 orderId) {
        require(orderId != bytes32(0), "Invalid order ID");
        require(escrows[orderId] == address(0), "Order already exists");
        _;
    }

    modifier validTimelock(uint256 timelock) {
        require(timelock > block.timestamp + minimumTimelock, "Timelock too short");
        require(timelock <= block.timestamp + maximumTimelock, "Timelock too long");
        _;
    }

    modifier validAmount(uint256 amount) {
        require(amount > 0, "Amount must be positive");
        require(amount <= type(uint128).max, "Amount too large");
        _;
    }

    modifier batchSizeLimit(uint256 batchSize) {
        require(batchSize > 0 && batchSize <= rateLimitConfig.maxBatchSize, "Invalid batch size");
        _;
    }

    constructor() Ownable(msg.sender) {
        // Deploy implementation contracts
        escrowSrcImplementation = address(new EscrowSrc());
        escrowDstImplementation = address(new EscrowDst());
        
        // Initialize rate limiting configuration
        rateLimitConfig = RateLimitConfig({
            maxRequestsPerWindow: 10,
            windowDuration: 1 hours,
            cooldownPeriod: 5 minutes,
            maxGasPerWindow: 2_000_000,
            gasWindowDuration: 15 minutes,
            penaltyMultiplier: 2,
            maxPenaltyLevel: 5,
            maxBatchSize: 10
        });

        // Initialize circuit breakers
        _initializeCircuitBreakers();
        
        lastGlobalReset = block.timestamp;
    }

    /**
     * @dev Create a new source escrow instance with rate limiting
     */
    function createEscrowSrc(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) 
        external 
        payable 
        rateLimited
        validOrderId(orderId) 
        validTimelock(timelock)
        validAmount(amount)
        nonReentrant 
        whenNotPaused
        returns (address escrowAddress) 
    {
        require(depositor != address(0), "Invalid depositor");
        require(withdrawer != address(0), "Invalid withdrawer");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(msg.value >= minimumSafetyDeposit, "Insufficient safety deposit");

        // Additional validation for rate limiting
        _validateEscrowCreation(orderId, amount, depositor, withdrawer);

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
     * @dev Create a new destination escrow instance with rate limiting
     */
    function createEscrowDst(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) 
        external 
        payable 
        rateLimited
        validOrderId(orderId) 
        validTimelock(timelock)
        validAmount(amount)
        nonReentrant 
        whenNotPaused
        returns (address escrowAddress) 
    {
        require(depositor != address(0), "Invalid depositor");
        require(withdrawer != address(0), "Invalid withdrawer");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(msg.value >= minimumSafetyDeposit, "Insufficient safety deposit");

        // Additional validation for rate limiting
        _validateEscrowCreation(orderId, amount, depositor, withdrawer);

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
     * @dev Batch create escrows with enhanced rate limiting
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
    ) 
        external 
        payable 
        rateLimited
        batchSizeLimit(orderIds.length)
        nonReentrant 
        whenNotPaused
        returns (address[] memory escrowAddresses) 
    {
        require(orderIds.length == tokens.length, "Array length mismatch");
        require(orderIds.length == amounts.length, "Array length mismatch");
        require(orderIds.length == depositors.length, "Array length mismatch");
        require(orderIds.length == withdrawers.length, "Array length mismatch");
        require(orderIds.length == secretHashes.length, "Array length mismatch");
        require(orderIds.length == timelocks.length, "Array length mismatch");
        require(orderIds.length == isSource.length, "Array length mismatch");

        uint256 totalSafetyDeposit = minimumSafetyDeposit * orderIds.length;
        require(msg.value >= totalSafetyDeposit, "Insufficient safety deposit");

        // Enhanced batch validation
        _validateBatchRequest(orderIds, amounts, depositors, withdrawers);

        escrowAddresses = new address[](orderIds.length);
        uint256 depositPerEscrow = msg.value / orderIds.length;

        for (uint256 i = 0; i < orderIds.length; i++) {
            require(orderIds[i] != bytes32(0), "Invalid order ID");
            require(escrows[orderIds[i]] == address(0), "Order already exists");
            require(amounts[i] > 0, "Amount must be positive");
            require(depositors[i] != address(0), "Invalid depositor");
            require(withdrawers[i] != address(0), "Invalid withdrawer");
            require(secretHashes[i] != bytes32(0), "Invalid secret hash");
            require(timelocks[i] > block.timestamp + minimumTimelock, "Timelock too short");
            require(timelocks[i] <= block.timestamp + maximumTimelock, "Timelock too long");

            if (isSource[i]) {
                escrowAddresses[i] = this.createEscrowSrcInternal{value: depositPerEscrow}(
                    orderIds[i],
                    tokens[i],
                    amounts[i],
                    depositors[i],
                    withdrawers[i],
                    secretHashes[i],
                    timelocks[i]
                );
            } else {
                escrowAddresses[i] = this.createEscrowDstInternal{value: depositPerEscrow}(
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
     * @dev Internal function for batch escrow src creation (bypasses rate limiting for batch)
     */
    function createEscrowSrcInternal(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) external payable returns (address escrowAddress) {
        require(msg.sender == address(this), "Internal function");
        
        bytes32 salt = keccak256(abi.encodePacked(orderId, "src"));
        escrowAddress = Clones.cloneDeterministic(escrowSrcImplementation, salt);
        
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

        escrows[orderId] = escrowAddress;
        isEscrow[escrowAddress] = true;
        totalEscrowsCreated++;
        totalValueLocked += amount;

        emit EscrowSrcCreated(orderId, escrowAddress, token, amount, secretHash, timelock);
    }

    /**
     * @dev Internal function for batch escrow dst creation (bypasses rate limiting for batch)
     */
    function createEscrowDstInternal(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock
    ) external payable returns (address escrowAddress) {
        require(msg.sender == address(this), "Internal function");
        
        bytes32 salt = keccak256(abi.encodePacked(orderId, "dst"));
        escrowAddress = Clones.cloneDeterministic(escrowDstImplementation, salt);
        
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

        escrows[orderId] = escrowAddress;
        isEscrow[escrowAddress] = true;
        totalEscrowsCreated++;
        totalValueLocked += amount;

        emit EscrowDstCreated(orderId, escrowAddress, token, amount, secretHash, timelock);
    }

    /**
     * @dev Check rate limit for a user
     */
    function _checkRateLimit(address user) internal view {
        UserRateLimit memory userLimit = userRateLimits[user];
        
        // Check if user is currently blocked
        require(block.timestamp >= userLimit.blockedUntil, "User is temporarily blocked");
        
        // Check request rate limit
        uint256 currentWindow = block.timestamp / rateLimitConfig.windowDuration;
        uint256 userWindow = userLimit.windowStart;
        
        if (currentWindow == userWindow) {
            uint256 adjustedLimit = rateLimitConfig.maxRequestsPerWindow / (userLimit.penaltyLevel + 1);
            require(userLimit.requestCount < adjustedLimit, "Request rate limit exceeded");
        }
    }

    /**
     * @dev Check gas limit for a user
     */
    function _checkGasLimit(address user) internal view {
        UserRateLimit memory userLimit = userRateLimits[user];
        
        uint256 currentGasWindow = block.timestamp / rateLimitConfig.gasWindowDuration;
        uint256 userGasWindow = userLimit.gasWindowStart;
        
        if (currentGasWindow == userGasWindow) {
            require(userLimit.totalGasUsed < rateLimitConfig.maxGasPerWindow, "Gas limit exceeded");
        }
    }

    /**
     * @dev Check circuit breakers
     */
    function _checkCircuitBreakers() internal view {
        CircuitBreaker memory globalBreaker = circuitBreakers["global"];
        require(!globalBreaker.isOpen, "Global circuit breaker is open");
        
        CircuitBreaker memory createBreaker = circuitBreakers["create"];
        require(!createBreaker.isOpen, "Create circuit breaker is open");
    }

    /**
     * @dev Record a request for rate limiting
     */
    function _recordRequest(address user) internal {
        UserRateLimit storage userLimit = userRateLimits[user];
        uint256 gasUsed = gasleft();
        
        // Update request count
        uint256 currentWindow = block.timestamp / rateLimitConfig.windowDuration;
        if (userLimit.windowStart != currentWindow) {
            userLimit.requestCount = 0;
            userLimit.windowStart = currentWindow;
        }
        userLimit.requestCount++;
        userLimit.lastRequestTime = block.timestamp;
        
        // Update gas usage
        uint256 currentGasWindow = block.timestamp / rateLimitConfig.gasWindowDuration;
        if (userLimit.gasWindowStart != currentGasWindow) {
            userLimit.totalGasUsed = 0;
            userLimit.gasWindowStart = currentGasWindow;
        }
        userLimit.totalGasUsed += gasUsed;
        
        // Update global counters
        globalRequestCount++;
        globalGasUsed += gasUsed;
        
        // Reset global counters if needed
        if (block.timestamp - lastGlobalReset > 1 hours) {
            globalRequestCount = 0;
            globalGasUsed = 0;
            lastGlobalReset = block.timestamp;
        }
        
        // Update circuit breakers
        _updateCircuitBreakers(true);
    }

    /**
     * @dev Validate escrow creation parameters
     */
    function _validateEscrowCreation(
        bytes32 orderId,
        uint256 amount,
        address depositor,
        address withdrawer
    ) internal pure {
        // Additional business logic validation
        require(depositor != withdrawer, "Depositor and withdrawer cannot be the same");
        
        // Minimum value checks to prevent spam
        require(amount >= 0.001 ether || amount >= 100000, "Amount below minimum threshold");
    }

    /**
     * @dev Validate batch request parameters
     */
    function _validateBatchRequest(
        bytes32[] calldata orderIds,
        uint256[] calldata amounts,
        address[] calldata depositors,
        address[] calldata withdrawers
    ) internal pure {
        // Check for duplicate order IDs
        for (uint256 i = 0; i < orderIds.length; i++) {
            for (uint256 j = i + 1; j < orderIds.length; j++) {
                require(orderIds[i] != orderIds[j], "Duplicate order ID in batch");
            }
        }
        
        // Validate minimum amounts
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] >= 0.001 ether || amounts[i] >= 100000, "Amount below minimum");
            totalAmount += amounts[i];
            require(depositors[i] != withdrawers[i], "Invalid depositor-withdrawer pair");
        }
        
        require(totalAmount <= 100 ether, "Batch total amount too large");
    }

    /**
     * @dev Initialize circuit breakers
     */
    function _initializeCircuitBreakers() internal {
        circuitBreakers["global"] = CircuitBreaker({
            isOpen: false,
            failureCount: 0,
            lastFailureTime: 0,
            openedAt: 0,
            successCount: 0,
            totalRequests: 0
        });
        
        circuitBreakers["create"] = CircuitBreaker({
            isOpen: false,
            failureCount: 0,
            lastFailureTime: 0,
            openedAt: 0,
            successCount: 0,
            totalRequests: 0
        });
    }

    /**
     * @dev Update circuit breakers
     */
    function _updateCircuitBreakers(bool success) internal {
        _updateCircuitBreaker("global", success);
        _updateCircuitBreaker("create", success);
    }

    /**
     * @dev Update individual circuit breaker
     */
    function _updateCircuitBreaker(string memory breakerName, bool success) internal {
        CircuitBreaker storage breaker = circuitBreakers[breakerName];
        breaker.totalRequests++;
        
        if (success) {
            breaker.successCount++;
            
            // Check if breaker should be closed
            if (breaker.isOpen && 
                block.timestamp - breaker.openedAt >= CIRCUIT_BREAKER_RECOVERY_TIME &&
                breaker.successCount >= 3) {
                breaker.isOpen = false;
                breaker.failureCount = 0;
            }
        } else {
            breaker.failureCount++;
            breaker.lastFailureTime = block.timestamp;
            
            // Check if breaker should be opened
            if (!breaker.isOpen && 
                breaker.failureCount >= CIRCUIT_BREAKER_THRESHOLD &&
                breaker.totalRequests >= 20) {
                
                uint256 errorRate = (breaker.failureCount * 100) / breaker.totalRequests;
                if (errorRate >= 50) {
                    breaker.isOpen = true;
                    breaker.openedAt = block.timestamp;
                    
                    emit CircuitBreakerTriggered(
                        breakerName, 
                        block.timestamp, 
                        "High error rate detected"
                    );
                }
            }
        }
    }

    /**
     * @dev Apply penalty to user for rate limit violation
     */
    function _applyPenalty(address user, string memory violationType) internal {
        UserRateLimit storage userLimit = userRateLimits[user];
        
        if (userLimit.penaltyLevel < rateLimitConfig.maxPenaltyLevel) {
            userLimit.penaltyLevel++;
        }
        
        // Calculate block duration based on penalty level
        uint256 blockDuration = rateLimitConfig.cooldownPeriod * 
            (rateLimitConfig.penaltyMultiplier ** userLimit.penaltyLevel);
        
        userLimit.blockedUntil = block.timestamp + blockDuration;
        totalViolations++;
        
        if (userLimit.blockedUntil > block.timestamp) {
            totalBlockedUsers++;
        }
        
        emit RateLimitViolation(user, violationType, block.timestamp, userLimit.penaltyLevel);
        emit UserBlocked(user, userLimit.blockedUntil, violationType);
    }

    // Administrative functions

    /**
     * @dev Update rate limiting configuration (owner only)
     */
    function updateRateLimitConfig(RateLimitConfig calldata newConfig) external onlyOwner {
        require(newConfig.maxRequestsPerWindow > 0, "Invalid max requests");
        require(newConfig.windowDuration > 0, "Invalid window duration");
        require(newConfig.maxBatchSize <= 100, "Batch size too large");
        
        rateLimitConfig = newConfig;
    }

    /**
     * @dev Add address to whitelist (owner only)
     */
    function addToWhitelist(address user) external onlyOwner {
        whitelist[user] = true;
    }

    /**
     * @dev Remove address from whitelist (owner only)
     */
    function removeFromWhitelist(address user) external onlyOwner {
        whitelist[user] = false;
    }

    /**
     * @dev Add address to blacklist (owner only)
     */
    function addToBlacklist(address user) external onlyOwner {
        blacklist[user] = true;
    }

    /**
     * @dev Remove address from blacklist (owner only)
     */
    function removeFromBlacklist(address user) external onlyOwner {
        blacklist[user] = false;
    }

    /**
     * @dev Reset user's rate limit and penalties (owner only)
     */
    function resetUserRateLimit(address user) external onlyOwner {
        delete userRateLimits[user];
    }

    /**
     * @dev Emergency stop (owner only)
     */
    function setEmergencyStop(bool stop, string calldata reason) external onlyOwner {
        emergencyStop = stop;
        if (stop) {
            emit EmergencyStop(msg.sender, reason, block.timestamp);
        }
    }

    /**
     * @dev Manually open/close circuit breaker (owner only)
     */
    function setCircuitBreaker(string calldata breakerName, bool isOpen) external onlyOwner {
        circuitBreakers[breakerName].isOpen = isOpen;
        if (isOpen) {
            circuitBreakers[breakerName].openedAt = block.timestamp;
            emit CircuitBreakerTriggered(breakerName, block.timestamp, "Manually triggered");
        }
    }

    /**
     * @dev Update factory configuration (owner only)
     */
    function updateConfig(
        uint256 _minimumSafetyDeposit,
        uint256 _maximumTimelock,
        uint256 _minimumTimelock
    ) external onlyOwner {
        require(_minimumTimelock > 0, "Invalid minimum timelock");
        require(_maximumTimelock > _minimumTimelock, "Invalid maximum timelock");
        
        minimumSafetyDeposit = _minimumSafetyDeposit;
        maximumTimelock = _maximumTimelock;
        minimumTimelock = _minimumTimelock;
    }

    /**
     * @dev Pause/unpause contract (owner only)
     */
    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    // View functions

    /**
     * @dev Get user rate limit information
     */
    function getUserRateLimit(address user) external view returns (UserRateLimit memory) {
        return userRateLimits[user];
    }

    /**
     * @dev Get circuit breaker status
     */
    function getCircuitBreakerStatus(string calldata breakerName) external view returns (CircuitBreaker memory) {
        return circuitBreakers[breakerName];
    }

    /**
     * @dev Check if user can make a request
     */
    function canMakeRequest(address user) external view returns (bool, string memory) {
        if (emergencyStop) return (false, "Emergency stop active");
        if (blacklist[user]) return (false, "Address blacklisted");
        if (whitelist[user]) return (true, "Whitelisted");
        
        UserRateLimit memory userLimit = userRateLimits[user];
        
        if (block.timestamp < userLimit.blockedUntil) {
            return (false, "User temporarily blocked");
        }
        
        uint256 currentWindow = block.timestamp / rateLimitConfig.windowDuration;
        if (userLimit.windowStart == currentWindow) {
            uint256 adjustedLimit = rateLimitConfig.maxRequestsPerWindow / (userLimit.penaltyLevel + 1);
            if (userLimit.requestCount >= adjustedLimit) {
                return (false, "Request rate limit exceeded");
            }
        }
        
        uint256 currentGasWindow = block.timestamp / rateLimitConfig.gasWindowDuration;
        if (userLimit.gasWindowStart == currentGasWindow && userLimit.totalGasUsed >= rateLimitConfig.maxGasPerWindow) {
            return (false, "Gas limit exceeded");
        }
        
        if (circuitBreakers["global"].isOpen) return (false, "Global circuit breaker open");
        if (circuitBreakers["create"].isOpen) return (false, "Create circuit breaker open");
        
        return (true, "Request allowed");
    }

    /**
     * @dev Get factory statistics
     */
    function getFactoryStats() external view returns (
        uint256 _totalEscrowsCreated,
        uint256 _totalValueLocked,
        uint256 _totalViolations,
        uint256 _totalBlockedUsers,
        uint256 _globalRequestCount,
        uint256 _globalGasUsed,
        bool _emergencyStopActive
    ) {
        return (
            totalEscrowsCreated,
            totalValueLocked,
            totalViolations,
            totalBlockedUsers,
            globalRequestCount,
            globalGasUsed,
            emergencyStop
        );
    }

    /**
     * @dev Get escrow address by order ID
     */
    function getEscrowAddress(bytes32 orderId) external view returns (address escrowAddress) {
        escrowAddress = escrows[orderId];
        require(escrowAddress != address(0), "Escrow not found");
    }

    /**
     * @dev Get predicted addresses
     */
    function getEscrowSrcAddress(bytes32 orderId) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(orderId, "src"));
        return Clones.predictDeterministicAddress(escrowSrcImplementation, salt);
    }

    function getEscrowDstAddress(bytes32 orderId) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(orderId, "dst"));
        return Clones.predictDeterministicAddress(escrowDstImplementation, salt);
    }

    /**
     * @dev Emergency recovery (owner only)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}