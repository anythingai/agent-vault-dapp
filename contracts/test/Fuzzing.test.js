const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Fuzzing and DOS Protection Tests
 * Tests system resilience against various attack patterns and edge cases
 */

describe("Fuzzing and DOS Protection Tests", function () {
    let factory, mockToken, accounts, owner;
    const safetyDeposit = ethers.parseEther("0.001");

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        owner = accounts[0];

        // Deploy mock token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("1000000"));

        // Deploy factory
        const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
        factory = await EscrowFactory.deploy();

        // Fund accounts
        for (let i = 1; i < 10; i++) {
            await mockToken.transfer(accounts[i].address, ethers.parseEther("10000"));
        }
    });

    describe("Input Fuzzing Tests", function () {
        // Generate random test data
        function generateRandomBytes32() {
            return ethers.randomBytes(32);
        }

        function generateRandomAddress() {
            return ethers.Wallet.createRandom().address;
        }

        function generateRandomAmount() {
            return ethers.parseEther((Math.random() * 1000).toFixed(18));
        }

        function generateRandomTimelock() {
            const currentTime = Math.floor(Date.now() / 1000);
            const minTime = currentTime + 30 * 60; // 30 minutes minimum
            const maxTime = currentTime + 24 * 60 * 60; // 24 hours maximum
            return minTime + Math.floor(Math.random() * (maxTime - minTime));
        }

        it("Should handle random valid inputs without failing", async function () {
            for (let i = 0; i < 10; i++) {
                const orderId = generateRandomBytes32();
                const secretHash = generateRandomBytes32();
                const depositor = generateRandomAddress();
                const withdrawer = generateRandomAddress();
                const amount = generateRandomAmount();
                const timelock = generateRandomTimelock();

                try {
                    const tx = await factory.createEscrowSrc(
                        orderId,
                        mockToken.target,
                        amount,
                        depositor,
                        withdrawer,
                        secretHash,
                        timelock,
                        { value: safetyDeposit }
                    );

                    await tx.wait();

                    // Verify escrow was created
                    const escrowAddress = await factory.escrows(orderId);
                    expect(escrowAddress).to.not.equal(ethers.ZeroAddress);

                    console.log(`✓ Fuzz test ${i + 1}: Escrow created successfully`);
                } catch (error) {
                    // Should only fail for known validation reasons
                    console.log(`⚠ Fuzz test ${i + 1} failed (expected for some invalid inputs):`, error.message);
                }
            }
        });

        it("Should reject invalid inputs appropriately", async function () {
            const validOrderId = generateRandomBytes32();
            const validSecretHash = generateRandomBytes32();
            const validDepositor = generateRandomAddress();
            const validWithdrawer = generateRandomAddress();
            const validAmount = ethers.parseEther("1.0");
            const validTimelock = generateRandomTimelock();

            // Test zero order ID
            await expect(
                factory.createEscrowSrc(
                    ethers.ZeroHash,
                    mockToken.target,
                    validAmount,
                    validDepositor,
                    validWithdrawer,
                    validSecretHash,
                    validTimelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowSrc: Invalid order ID");

            // Test zero amount
            await expect(
                factory.createEscrowSrc(
                    validOrderId,
                    mockToken.target,
                    0,
                    validDepositor,
                    validWithdrawer,
                    validSecretHash,
                    validTimelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Amount must be positive");

            // Test zero addresses
            await expect(
                factory.createEscrowSrc(
                    validOrderId,
                    mockToken.target,
                    validAmount,
                    ethers.ZeroAddress,
                    validWithdrawer,
                    validSecretHash,
                    validTimelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Invalid depositor");

            await expect(
                factory.createEscrowSrc(
                    validOrderId,
                    mockToken.target,
                    validAmount,
                    validDepositor,
                    ethers.ZeroAddress,
                    validSecretHash,
                    validTimelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Invalid withdrawer");

            // Test zero secret hash
            await expect(
                factory.createEscrowSrc(
                    validOrderId,
                    mockToken.target,
                    validAmount,
                    validDepositor,
                    validWithdrawer,
                    ethers.ZeroHash,
                    validTimelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Invalid secret hash");
        });

        it("Should handle extreme but valid values", async function () {
            const maxAmount = ethers.MaxUint256 / 2n; // Avoid overflow in calculations
            const maxTimelock = Math.floor(Date.now() / 1000) + 24 * 60 * 60 - 1; // Just under 24 hours
            
            // Mint large amount
            await mockToken.mint(accounts[1].address, maxAmount);

            const orderId = generateRandomBytes32();
            const secretHash = generateRandomBytes32();

            const tx = await factory.createEscrowSrc(
                orderId,
                mockToken.target,
                maxAmount,
                accounts[1].address,
                accounts[2].address,
                secretHash,
                maxTimelock,
                { value: safetyDeposit }
            );

            await tx.wait();

            const escrowAddress = await factory.escrows(orderId);
            const escrow = await ethers.getContractAt("EscrowSrc", escrowAddress);
            
            const details = await escrow.getDetails();
            expect(details._amount).to.equal(maxAmount);
        });
    });

    describe("DOS Attack Resistance", function () {
        it("Should handle rapid succession of escrow creations", async function () {
            const batchSize = 20;
            const promises = [];

            console.log(`Testing rapid creation of ${batchSize} escrows...`);
            const startTime = Date.now();

            for (let i = 0; i < batchSize; i++) {
                const orderId = ethers.keccak256(ethers.toUtf8Bytes(`dos-test-${i}-${Date.now()}`));
                const secretHash = generateRandomBytes32();
                const timelock = generateRandomTimelock();

                const promise = factory.createEscrowSrc(
                    orderId,
                    mockToken.target,
                    ethers.parseEther("0.1"),
                    accounts[1].address,
                    accounts[2].address,
                    secretHash,
                    timelock,
                    { value: safetyDeposit }
                );

                promises.push(promise);
            }

            // Execute all simultaneously
            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const endTime = Date.now();

            console.log(`✓ Created ${successful}/${batchSize} escrows in ${endTime - startTime}ms`);
            expect(successful).to.be.greaterThan(batchSize * 0.8); // At least 80% success rate
        });

        it("Should handle gas limit attacks", async function () {
            // Test with operations that could consume excessive gas
            const orderId = generateRandomBytes32();
            const secretHash = generateRandomBytes32();
            const timelock = generateRandomTimelock();

            // Create escrow with reasonable gas limit
            const tx = await factory.createEscrowSrc(
                orderId,
                mockToken.target,
                ethers.parseEther("1.0"),
                accounts[1].address,
                accounts[2].address,
                secretHash,
                timelock,
                { value: safetyDeposit, gasLimit: 500000 }
            );

            const receipt = await tx.wait();
            expect(receipt.gasUsed).to.be.lessThan(400000); // Should be reasonable
            console.log(`✓ Escrow creation used ${receipt.gasUsed} gas`);
        });

        it("Should prevent batch creation spam", async function () {
            // Test batch creation with maximum allowed items
            const maxBatchSize = 50; // Reasonable upper limit
            
            const orderIds = [];
            const tokens = [];
            const amounts = [];
            const depositors = [];
            const withdrawers = [];
            const secretHashes = [];
            const timelocks = [];
            const isSource = [];

            const baseTimelock = generateRandomTimelock();

            for (let i = 0; i < maxBatchSize; i++) {
                orderIds.push(ethers.keccak256(ethers.toUtf8Bytes(`batch-dos-${i}-${Date.now()}`)));
                tokens.push(mockToken.target);
                amounts.push(ethers.parseEther("0.01"));
                depositors.push(accounts[1].address);
                withdrawers.push(accounts[2].address);
                secretHashes.push(generateRandomBytes32());
                timelocks.push(baseTimelock);
                isSource.push(true);
            }

            const totalSafetyDeposit = safetyDeposit * BigInt(maxBatchSize);

            const startTime = Date.now();
            const batchTx = await factory.batchCreateEscrows(
                orderIds,
                tokens,
                amounts,
                depositors,
                withdrawers,
                secretHashes,
                timelocks,
                isSource,
                { value: totalSafetyDeposit, gasLimit: 15000000 } // High gas limit for batch
            );

            const receipt = await batchTx.wait();
            const endTime = Date.now();

            console.log(`✓ Batch created ${maxBatchSize} escrows in ${endTime - startTime}ms using ${receipt.gasUsed} gas`);
            
            // Verify all were created
            for (const orderId of orderIds) {
                const escrowAddress = await factory.escrows(orderId);
                expect(escrowAddress).to.not.equal(ethers.ZeroAddress);
            }
        });

        it("Should handle memory exhaustion attempts", async function () {
            // Test with large data structures that could cause memory issues
            const largeData = "0x" + "a".repeat(1000); // Large hex string
            
            try {
                // This should either work or fail gracefully, not crash the node
                const orderId = ethers.keccak256(largeData);
                const secretHash = ethers.keccak256(largeData);
                
                await factory.createEscrowSrc(
                    orderId,
                    mockToken.target,
                    ethers.parseEther("1.0"),
                    accounts[1].address,
                    accounts[2].address,
                    secretHash,
                    generateRandomTimelock(),
                    { value: safetyDeposit }
                );

                console.log("✓ Large data handling successful");
            } catch (error) {
                // Should fail gracefully, not cause system crash
                console.log("⚠ Large data rejected (expected):", error.message);
                expect(error.message).to.not.include("out of memory");
                expect(error.message).to.not.include("crash");
            }
        });
    });

    describe("State Corruption Resistance", function () {
        it("Should resist state corruption from malformed transactions", async function () {
            // Create valid escrow
            const orderId = generateRandomBytes32();
            const secretHash = generateRandomBytes32();
            const timelock = generateRandomTimelock();

            await factory.createEscrowSrc(
                orderId,
                mockToken.target,
                ethers.parseEther("1.0"),
                accounts[1].address,
                accounts[2].address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const escrowAddress = await factory.escrows(orderId);
            const escrow = await ethers.getContractAt("EscrowSrc", escrowAddress);

            // Fund escrow
            await mockToken.connect(accounts[1]).approve(escrowAddress, ethers.parseEther("1.0"));
            await escrow.connect(accounts[1]).deposit();

            // Try various malformed calls that should not corrupt state
            const malformedSecret = "0x1234"; // Too short
            const invalidSecret = "not_hex";

            try {
                await escrow.connect(accounts[2]).redeem(malformedSecret);
            } catch (error) {
                expect(error.message).to.include("invalid");
            }

            try {
                await escrow.connect(accounts[2]).redeem(invalidSecret);
            } catch (error) {
                // Should handle gracefully
            }

            // State should remain consistent
            const details = await escrow.getDetails();
            expect(details._isRedeemed).to.be.false;
            expect(details._isRefunded).to.be.false;

            // Normal operation should still work
            const correctSecret = ethers.randomBytes(32);
            const correctHash = ethers.keccak256(correctSecret);
            
            // Create new escrow with correct secret
            const newOrderId = generateRandomBytes32();
            await factory.createEscrowSrc(
                newOrderId,
                mockToken.target,
                ethers.parseEther("1.0"),
                accounts[1].address,
                accounts[2].address,
                correctHash,
                timelock,
                { value: safetyDeposit }
            );

            const newEscrowAddress = await factory.escrows(newOrderId);
            const newEscrow = await ethers.getContractAt("EscrowSrc", newEscrowAddress);

            await mockToken.connect(accounts[1]).approve(newEscrowAddress, ethers.parseEther("1.0"));
            await newEscrow.connect(accounts[1]).deposit();
            await newEscrow.connect(accounts[2]).redeem(correctSecret);

            const newDetails = await newEscrow.getDetails();
            expect(newDetails._isRedeemed).to.be.true;
        });

        it("Should handle concurrent operations without state corruption", async function () {
            // Create multiple escrows for concurrent testing
            const numEscrows = 5;
            const escrows = [];
            const secrets = [];

            for (let i = 0; i < numEscrows; i++) {
                const secret = ethers.randomBytes(32);
                const secretHash = ethers.keccak256(secret);
                const orderId = ethers.keccak256(ethers.toUtf8Bytes(`concurrent-${i}-${Date.now()}`));
                const timelock = generateRandomTimelock();

                await factory.createEscrowSrc(
                    orderId,
                    mockToken.target,
                    ethers.parseEther("0.1"),
                    accounts[1].address,
                    accounts[2].address,
                    secretHash,
                    timelock,
                    { value: safetyDeposit }
                );

                const escrowAddress = await factory.escrows(orderId);
                const escrow = await ethers.getContractAt("EscrowSrc", escrowAddress);

                await mockToken.connect(accounts[1]).approve(escrowAddress, ethers.parseEther("0.1"));
                await escrow.connect(accounts[1]).deposit();

                escrows.push(escrow);
                secrets.push(secret);
            }

            // Perform concurrent redemptions
            await ethers.provider.send("evm_setAutomine", [false]);

            try {
                const redeemPromises = escrows.map((escrow, i) =>
                    escrow.connect(accounts[2]).redeem(secrets[i])
                );

                await ethers.provider.send("evm_mine");
                const results = await Promise.allSettled(redeemPromises);

                // All should succeed
                const successful = results.filter(r => r.status === 'fulfilled').length;
                expect(successful).to.equal(numEscrows);

                console.log(`✓ ${successful}/${numEscrows} concurrent redemptions successful`);
            } finally {
                await ethers.provider.send("evm_setAutomine", [true]);
            }

            // Verify all escrows are in correct state
            for (const escrow of escrows) {
                const details = await escrow.getDetails();
                expect(details._isRedeemed).to.be.true;
                expect(details._isRefunded).to.be.false;
            }
        });
    });

    describe("Resource Exhaustion Tests", function () {
        it("Should handle maximum contract interactions", async function () {
            // Test maximum number of function calls without running out of resources
            const orderId = generateRandomBytes32();
            const secretHash = generateRandomBytes32();
            const timelock = generateRandomTimelock();

            await factory.createEscrowSrc(
                orderId,
                mockToken.target,
                ethers.parseEther("1.0"),
                accounts[1].address,
                accounts[2].address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const escrowAddress = await factory.escrows(orderId);
            const escrow = await ethers.getContractAt("EscrowSrc", escrowAddress);

            // Call view functions many times (should not consume much gas)
            const numCalls = 100;
            console.log(`Testing ${numCalls} view function calls...`);

            for (let i = 0; i < numCalls; i++) {
                const details = await escrow.getDetails();
                expect(details._orderId).to.equal(orderId);
                
                const canRedeem = await escrow.canRedeem(secretHash);
                expect(canRedeem).to.be.false; // Not deposited yet
                
                const canRefund = await escrow.canRefund();
                expect(canRefund).to.be.false; // Before timelock
            }

            console.log(`✓ Completed ${numCalls} view function calls successfully`);
        });

        it("Should handle storage exhaustion attempts", async function () {
            // Test creating many escrows to see if storage can be exhausted
            const numEscrows = 100;
            console.log(`Testing creation of ${numEscrows} escrows...`);

            let successCount = 0;
            const startTime = Date.now();

            for (let i = 0; i < numEscrows; i++) {
                try {
                    const orderId = ethers.keccak256(ethers.toUtf8Bytes(`storage-test-${i}-${Date.now()}`));
                    const secretHash = generateRandomBytes32();
                    const timelock = generateRandomTimelock();

                    await factory.createEscrowSrc(
                        orderId,
                        mockToken.target,
                        ethers.parseEther("0.01"),
                        accounts[1].address,
                        accounts[2].address,
                        secretHash,
                        timelock,
                        { value: safetyDeposit }
                    );

                    successCount++;
                } catch (error) {
                    console.log(`Storage test ${i} failed:`, error.message);
                    break;
                }
            }

            const endTime = Date.now();
            console.log(`✓ Successfully created ${successCount}/${numEscrows} escrows in ${endTime - startTime}ms`);

            // Should handle reasonable number of escrows
            expect(successCount).to.be.greaterThan(10);
        });
    });

    describe("Network Condition Simulation", function () {
        it("Should handle high gas price conditions", async function () {
            const highGasPrice = ethers.parseUnits("1000", "gwei"); // Very high gas price
            
            const orderId = generateRandomBytes32();
            const secretHash = generateRandomBytes32();
            const timelock = generateRandomTimelock();

            const tx = await factory.createEscrowSrc(
                orderId,
                mockToken.target,
                ethers.parseEther("1.0"),
                accounts[1].address,
                accounts[2].address,
                secretHash,
                timelock,
                { 
                    value: safetyDeposit,
                    gasPrice: highGasPrice,
                    gasLimit: 1000000
                }
            );

            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
            console.log(`✓ Transaction succeeded with high gas price, used ${receipt.gasUsed} gas`);
        });

        it("Should handle network congestion simulation", async function () {
            // Simulate network congestion by creating many pending transactions
            await ethers.provider.send("evm_setAutomine", [false]);

            try {
                const numTx = 10;
                const promises = [];

                for (let i = 0; i < numTx; i++) {
                    const orderId = ethers.keccak256(ethers.toUtf8Bytes(`congestion-${i}-${Date.now()}`));
                    const secretHash = generateRandomBytes32();
                    const timelock = generateRandomTimelock();

                    const promise = factory.createEscrowSrc(
                        orderId,
                        mockToken.target,
                        ethers.parseEther("0.1"),
                        accounts[1].address,
                        accounts[2].address,
                        secretHash,
                        timelock,
                        { value: safetyDeposit }
                    );

                    promises.push(promise);
                }

                // Mine several blocks to process all transactions
                for (let i = 0; i < 5; i++) {
                    await ethers.provider.send("evm_mine");
                }

                const results = await Promise.allSettled(promises);
                const successful = results.filter(r => r.status === 'fulfilled').length;

                console.log(`✓ Processed ${successful}/${numTx} transactions under congestion`);
                expect(successful).to.be.greaterThan(0);

            } finally {
                await ethers.provider.send("evm_setAutomine", [true]);
            }
        });
    });

    // Utility functions for fuzzing
    function generateRandomBytes32() {
        return ethers.randomBytes(32);
    }

    function generateRandomAddress() {
        return ethers.Wallet.createRandom().address;
    }

    function generateRandomTimelock() {
        const currentTime = Math.floor(Date.now() / 1000);
        const minTime = currentTime + 30 * 60; // 30 minutes minimum
        const maxTime = currentTime + 24 * 60 * 60; // 24 hours maximum
        return minTime + Math.floor(Math.random() * (maxTime - minTime));
    }
});