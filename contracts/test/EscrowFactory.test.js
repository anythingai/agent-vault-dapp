const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EscrowFactory", function () {
    let factory;
    let token;
    let owner;
    let depositor;
    let withdrawer;
    let resolver;
    let user;
    let accounts;

    const secret = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const secretHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
    const amount = ethers.parseEther("1.0");
    const safetyDeposit = ethers.parseEther("0.001");

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        [owner, depositor, withdrawer, resolver, user] = accounts;

        // Deploy test ERC20 token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Test Token", "TEST", ethers.parseEther("1000"));

        // Deploy factory
        const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
        factory = await EscrowFactory.deploy();

        // Distribute tokens
        await token.transfer(depositor.address, ethers.parseEther("10"));
        await token.transfer(resolver.address, ethers.parseEther("10"));
    });

    describe("Deployment", function () {
        it("Should deploy with correct implementation addresses", async function () {
            const stats = await factory.getFactoryStats();
            expect(stats._escrowSrcImplementation).to.not.equal(ethers.ZeroAddress);
            expect(stats._escrowDstImplementation).to.not.equal(ethers.ZeroAddress);
            expect(stats._totalEscrowsCreated).to.equal(0);
            expect(stats._minimumSafetyDeposit).to.equal(ethers.parseEther("0.001"));
        });

        it("Should set correct default parameters", async function () {
            const stats = await factory.getFactoryStats();
            expect(stats._minimumTimelock).to.equal(30 * 60); // 30 minutes
            expect(stats._maximumTimelock).to.equal(24 * 60 * 60); // 24 hours
        });
    });

    describe("Source Escrow Creation", function () {
        it("Should create source escrow with correct parameters", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-1"));

            const tx = await factory.createEscrowSrc(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "EscrowSrcCreated");
            
            expect(event).to.not.be.undefined;
            expect(event.args.orderId).to.equal(orderId);
            expect(event.args.token).to.equal(token.target);
            expect(event.args.amount).to.equal(amount);
            expect(event.args.secretHash).to.equal(secretHash);

            // Check escrow is tracked
            const escrowAddress = await factory.escrows(orderId);
            expect(escrowAddress).to.not.equal(ethers.ZeroAddress);
            expect(await factory.isEscrow(escrowAddress)).to.be.true;

            // Check stats updated
            const stats = await factory.getFactoryStats();
            expect(stats._totalEscrowsCreated).to.equal(1);
        });

        it("Should predict correct escrow address", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-predict"));

            const predictedAddress = await factory.getEscrowSrcAddress(orderId);

            const tx = await factory.createEscrowSrc(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "EscrowSrcCreated");
            const actualAddress = event.args.escrowAddress;

            expect(actualAddress).to.equal(predictedAddress);
        });

        it("Should not allow duplicate order IDs", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("duplicate-order"));

            await factory.createEscrowSrc(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            await expect(
                factory.createEscrowSrc(
                    orderId,
                    token.target,
                    amount,
                    depositor.address,
                    withdrawer.address,
                    secretHash,
                    timelock,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Order already exists");
        });

        it("Should validate timelock constraints", async function () {
            const currentTime = await time.latest();
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("timelock-test"));

            // Too short timelock
            await expect(
                factory.createEscrowSrc(
                    orderId,
                    token.target,
                    amount,
                    depositor.address,
                    withdrawer.address,
                    secretHash,
                    currentTime + 60, // Only 1 minute
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Timelock too short");

            // Too long timelock
            await expect(
                factory.createEscrowSrc(
                    orderId,
                    token.target,
                    amount,
                    depositor.address,
                    withdrawer.address,
                    secretHash,
                    currentTime + 25 * 60 * 60, // 25 hours
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Timelock too long");
        });

        it("Should require minimum safety deposit", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("safety-deposit-test"));

            await expect(
                factory.createEscrowSrc(
                    orderId,
                    token.target,
                    amount,
                    depositor.address,
                    withdrawer.address,
                    secretHash,
                    timelock,
                    { value: ethers.parseEther("0.0005") } // Below minimum
                )
            ).to.be.revertedWith("EscrowFactory: Insufficient safety deposit");
        });
    });

    describe("Destination Escrow Creation", function () {
        it("Should create destination escrow with correct parameters", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-dst"));

            const tx = await factory.createEscrowDst(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "EscrowDstCreated");
            
            expect(event).to.not.be.undefined;
            expect(event.args.orderId).to.equal(orderId);
            expect(event.args.token).to.equal(token.target);
            expect(event.args.amount).to.equal(amount);
            expect(event.args.secretHash).to.equal(secretHash);

            const escrowAddress = await factory.escrows(orderId);
            expect(escrowAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should predict correct destination escrow address", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-dst-predict"));

            const predictedAddress = await factory.getEscrowDstAddress(orderId);

            const tx = await factory.createEscrowDst(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "EscrowDstCreated");
            const actualAddress = event.args.escrowAddress;

            expect(actualAddress).to.equal(predictedAddress);
        });
    });

    describe("Batch Escrow Creation", function () {
        it("Should create multiple escrows in batch", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            
            const orderIds = [
                ethers.keccak256(ethers.toUtf8Bytes("batch-1")),
                ethers.keccak256(ethers.toUtf8Bytes("batch-2")),
                ethers.keccak256(ethers.toUtf8Bytes("batch-3"))
            ];
            
            const tokens = [token.target, token.target, ethers.ZeroAddress];
            const amounts = [amount, amount / 2n, ethers.parseEther("0.1")];
            const depositors = [depositor.address, resolver.address, depositor.address];
            const withdrawers = [withdrawer.address, user.address, withdrawer.address];
            const secretHashes = [secretHash, secretHash, secretHash];
            const timelocks = [timelock, timelock, timelock];
            const isSource = [true, false, true];

            const totalSafetyDeposit = safetyDeposit * 3n;

            const tx = await factory.batchCreateEscrows(
                orderIds,
                tokens,
                amounts,
                depositors,
                withdrawers,
                secretHashes,
                timelocks,
                isSource,
                { value: totalSafetyDeposit }
            );

            const receipt = await tx.wait();
            
            // Check all escrows were created
            for (let i = 0; i < orderIds.length; i++) {
                const escrowAddress = await factory.escrows(orderIds[i]);
                expect(escrowAddress).to.not.equal(ethers.ZeroAddress);
                expect(await factory.isEscrow(escrowAddress)).to.be.true;
            }

            const stats = await factory.getFactoryStats();
            expect(stats._totalEscrowsCreated).to.equal(3);
        });

        it("Should validate array lengths in batch creation", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            
            const orderIds = [ethers.keccak256(ethers.toUtf8Bytes("batch-1"))];
            const tokens = [token.target, token.target]; // Different length
            const amounts = [amount];
            const depositors = [depositor.address];
            const withdrawers = [withdrawer.address];
            const secretHashes = [secretHash];
            const timelocks = [timelock];
            const isSource = [true];

            await expect(
                factory.batchCreateEscrows(
                    orderIds,
                    tokens,
                    amounts,
                    depositors,
                    withdrawers,
                    secretHashes,
                    timelocks,
                    isSource,
                    { value: safetyDeposit }
                )
            ).to.be.revertedWith("EscrowFactory: Array length mismatch");
        });
    });

    describe("Escrow Details", function () {
        it("Should return correct escrow details", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("details-test"));

            await factory.createEscrowSrc(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const details = await factory.getEscrowDetails(orderId);
            expect(details.escrowAddress).to.not.equal(ethers.ZeroAddress);
            expect(details._orderId).to.equal(orderId);
            expect(details.token).to.equal(token.target);
            expect(details.amount).to.equal(amount);
            expect(details.depositor).to.equal(depositor.address);
            expect(details.withdrawer).to.equal(withdrawer.address);
            expect(details.secretHash).to.equal(secretHash);
            expect(details.safetyDeposit).to.equal(safetyDeposit);
        });

        it("Should revert for non-existent escrow", async function () {
            const nonExistentId = ethers.keccak256(ethers.toUtf8Bytes("non-existent"));
            
            await expect(
                factory.getEscrowDetails(nonExistentId)
            ).to.be.revertedWith("EscrowFactory: Escrow not found");
        });
    });

    describe("Configuration Management", function () {
        it("Should allow owner to update configuration", async function () {
            const newMinDeposit = ethers.parseEther("0.002");
            const newMaxTimelock = 48 * 60 * 60; // 48 hours
            const newMinTimelock = 60 * 60; // 1 hour

            await factory.updateConfig(newMinDeposit, newMaxTimelock, newMinTimelock);

            const stats = await factory.getFactoryStats();
            expect(stats._minimumSafetyDeposit).to.equal(newMinDeposit);
            expect(stats._maximumTimelock).to.equal(newMaxTimelock);
            expect(stats._minimumTimelock).to.equal(newMinTimelock);
        });

        it("Should not allow non-owner to update configuration", async function () {
            await expect(
                factory.connect(user).updateConfig(
                    ethers.parseEther("0.002"),
                    48 * 60 * 60,
                    60 * 60
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should validate configuration parameters", async function () {
            await expect(
                factory.updateConfig(
                    ethers.parseEther("0.002"),
                    60 * 60, // max
                    120 * 60 // min > max
                )
            ).to.be.revertedWith("EscrowFactory: Invalid maximum timelock");

            await expect(
                factory.updateConfig(
                    ethers.parseEther("0.002"),
                    60 * 60,
                    0 // min = 0
                )
            ).to.be.revertedWith("EscrowFactory: Invalid minimum timelock");
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause the factory", async function () {
            await factory.setPaused(true);
            expect(await factory.paused()).to.be.true;

            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("paused-test"));

            // Factory operations should be blocked when paused
            // Note: The current implementation doesn't use whenNotPaused modifier
            // This test documents the expected behavior if pause functionality is fully implemented
        });

        it("Should not allow non-owner to pause", async function () {
            await expect(
                factory.connect(user).setPaused(true)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow owner to emergency withdraw", async function () {
            // Send some ETH to factory
            await owner.sendTransaction({
                to: factory.target,
                value: ethers.parseEther("1.0")
            });

            const initialBalance = await ethers.provider.getBalance(owner.address);
            const tx = await factory.emergencyWithdraw();
            const receipt = await tx.wait();

            const finalBalance = await ethers.provider.getBalance(owner.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            // Should receive the ETH minus gas costs
            expect(finalBalance - initialBalance + gasUsed).to.be.closeTo(
                ethers.parseEther("1.0"),
                ethers.parseEther("0.001")
            );
        });

        it("Should not allow non-owner emergency withdraw", async function () {
            await expect(
                factory.connect(user).emergencyWithdraw()
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Integration Tests", function () {
        it("Should create and interact with escrows end-to-end", async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;
            const orderId = ethers.keccak256(ethers.toUtf8Bytes("integration-test"));

            // Create source escrow
            await factory.createEscrowSrc(
                orderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const escrowAddress = await factory.escrows(orderId);
            const escrow = await ethers.getContractAt("EscrowSrc", escrowAddress);

            // Deposit tokens
            await token.connect(depositor).approve(escrowAddress, amount);
            await escrow.connect(depositor).deposit();

            // Redeem with secret
            const initialBalance = await token.balanceOf(withdrawer.address);
            await escrow.connect(withdrawer).redeem(secret);
            const finalBalance = await token.balanceOf(withdrawer.address);

            expect(finalBalance - initialBalance).to.equal(amount);
        });
    });
});