// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOrderMixin {
    struct Order {
        uint256 salt;
        address maker;
        address receiver;
        address makerAsset;
        address takerAsset;
        uint256 makingAmount;
        uint256 takingAmount;
        uint256 makerTraits; // Using uint256 instead of MakerTraits for simplicity
    }

    event OrderFilled(
        bytes32 indexed orderHash,
        uint256 makingAmount,
        uint256 takingAmount
    );

    event OrderCanceled(
        address indexed maker,
        bytes32 orderHash,
        uint256 makerTraits
    );

    /**
     * @dev Returns order hash, hashed with limit order protocol contract EIP712
     */
    function hashOrder(Order calldata order) external view returns (bytes32 orderHash);

    /**
     * @dev Cancels order's quote
     */
    function cancelOrder(uint256 makerTraits, bytes32 orderHash) external;

    /**
     * @dev Fills order's quote, either fully or partially
     */
    function fillOrder(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits
    ) external payable returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash);

    /**
     * @dev Similar to fillOrder but allows to specify arguments used by the taker
     */
    function fillOrderArgs(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits,
        bytes calldata args
    ) external payable returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash);

    /**
     * @dev Returns the domain separator for EIP-712
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}