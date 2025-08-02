// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEscrow {
    event EscrowCreated(
        bytes32 indexed orderId,
        address indexed token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );
    
    event Redeemed(
        bytes32 indexed orderId,
        bytes32 secret,
        address indexed redeemer
    );
    
    event Refunded(
        bytes32 indexed orderId,
        address indexed refundee
    );

    function initialize(
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock,
        uint256 safetyDeposit
    ) external payable;

    function redeem(bytes32 secret) external;
    function refund() external;
    function publicWithdraw(bytes32 secret) external;
    
    function getDetails() external view returns (
        bytes32 orderId,
        address token,
        uint256 amount,
        address depositor,
        address withdrawer,
        bytes32 secretHash,
        uint256 timelock,
        uint256 safetyDeposit,
        bool isRedeemed,
        bool isRefunded
    );
}