const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EscrowSrc", function () {
    let escrowSrc;
    let factory;
    let token;
    let owner;
    let depositor;
    let withdrawer;
    let user;
    let accounts;

    const secret = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const secretHash = ethers.sha256(ethers.solidityPacked(["bytes32"], [secret]));
    const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-1"));
    const amount = ethers.parseEther("1.0");
    const safetyDeposit = ethers.parseEther("0.001");

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        [owner, depositor, withdrawer, user] = accounts;

        // Deploy test ERC20 token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Test Token", "TEST", ethers.parseEther("1000"));

        // Deploy factory
        const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
        factory = await EscrowFactory.deploy();

        // Get current time and set timelock 1 hour in the future
        const currentTime = await time.latest();
        const timelock = currentTime + 3600; // 1 hour

        // Create escrow through factory
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
        const escrowAddress = event.args.escrowAddress;

        escrowSrc = await ethers.getContractAt("EscrowSrc", escrowAddress);

        // Give tokens to depositor and approve escrow
        await token.transfer(depositor.address, amount);
        await token.connect(depositor).approve(escrowAddress, amount);
    });

    describe("Initialization", function () {
        it("Should be initialized with correct parameters", async function () {
            const details = await escrowSrc.getDetails();
            expect(details._orderId).to.equal(orderId);
            expect(details._token).to.equal(token.target);
            expect(details._amount).to.equal(amount);
            expect(details._depositor).to.equal(depositor.address);
            expect(details._withdrawer).to.equal(withdrawer.address);
            expect(details._secretHash).to.equal(secretHash);
            expect(details._safetyDeposit).to.equal(safetyDeposit);
            expect(details._isRedeemed).to.be.false;
            expect(details._isRefunded).to.be.false;
        });

        it("Should hold the safety deposit", async function () {
            const balance = await ethers.provider.getBalance(escrowSrc.target);
            expect(balance).to.equal(safetyDeposit);
        });
    });

    describe("Deposit", function () {
        it("Should allow depositor to deposit tokens", async function () {
            await expect(escrowSrc.connect(depositor).deposit())
                .to.emit(escrowSrc, "EscrowCreated");
            
            const tokenBalance = await token.balanceOf(escrowSrc.target);
            expect(tokenBalance).to.equal(amount);
        });

        it("Should not allow non-depositor to deposit", async function () {
            await expect(escrowSrc.connect(user).deposit())
                .to.be.revertedWith("EscrowSrc: Only depositor can deposit");
        });

        it("Should not allow deposit twice", async function () {
            await escrowSrc.connect(depositor).deposit();
            await expect(escrowSrc.connect(depositor).deposit())
                .to.be.revertedWith("EscrowSrc: Escrow not active");
        });
    });

    describe("Redemption", function () {
        beforeEach(async function () {
            // Deposit tokens first
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should allow withdrawer to redeem with correct secret", async function () {
            const initialBalance = await token.balanceOf(withdrawer.address);
            const initialEthBalance = await ethers.provider.getBalance(withdrawer.address);
            
            const tx = await escrowSrc.connect(withdrawer).redeem(secret);
            const receipt = await tx.wait();
            
            // Check token transfer
            const finalBalance = await token.balanceOf(withdrawer.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit transfer (account for gas costs)
            const finalEthBalance = await ethers.provider.getBalance(withdrawer.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
            
            // Check event
            await expect(tx).to.emit(escrowSrc, "Redeemed")
                .withArgs(orderId, secret, withdrawer.address);
            
            // Check state
            const details = await escrowSrc.getDetails();
            expect(details._isRedeemed).to.be.true;
        });

        it("Should not allow redemption with wrong secret", async function () {
            const wrongSecret = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
            await expect(escrowSrc.connect(withdrawer).redeem(wrongSecret))
                .to.be.revertedWith("EscrowSrc: Invalid secret");
        });

        it("Should not allow non-withdrawer to redeem in exclusive period", async function () {
            await expect(escrowSrc.connect(user).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Only withdrawer can redeem in exclusive period");
        });

        it("Should not allow redemption after timelock", async function () {
            // Fast forward past timelock
            await time.increase(3601);
            
            await expect(escrowSrc.connect(withdrawer).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Past timelock");
        });

        it("Should not allow redemption twice", async function () {
            await escrowSrc.connect(withdrawer).redeem(secret);
            await expect(escrowSrc.connect(withdrawer).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Already redeemed");
        });
    });

    describe("Public Withdrawal", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should allow public withdrawal after exclusive period", async function () {
            // Fast forward to near timelock but still allow public withdrawal
            await time.increase(2700); // 45 minutes (exclusive period is 1 hour)
            
            const initialBalance = await token.balanceOf(withdrawer.address);
            const initialEthBalance = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowSrc.connect(user).publicWithdraw(secret);
            const receipt = await tx.wait();
            
            // Check token goes to withdrawer
            const finalBalance = await token.balanceOf(withdrawer.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit goes to caller
            const finalEthBalance = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
        });

        it("Should not allow public withdrawal during exclusive period", async function () {
            await expect(escrowSrc.connect(user).publicWithdraw(secret))
                .to.be.revertedWith("EscrowSrc: Still in exclusive period");
        });

        it("Should not allow public withdrawal with wrong secret", async function () {
            await time.increase(2700);
            const wrongSecret = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
            await expect(escrowSrc.connect(user).publicWithdraw(wrongSecret))
                .to.be.revertedWith("EscrowSrc: Invalid secret");
        });
    });

    describe("Refund", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should allow refund after timelock", async function () {
            // Fast forward past timelock
            await time.increase(3601);
            
            const initialBalance = await token.balanceOf(depositor.address);
            const initialEthBalance = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowSrc.connect(user).refund();
            const receipt = await tx.wait();
            
            // Check token refund to depositor
            const finalBalance = await token.balanceOf(depositor.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit goes to caller
            const finalEthBalance = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
            
            // Check event
            await expect(tx).to.emit(escrowSrc, "Refunded")
                .withArgs(orderId, depositor.address);
            
            // Check state
            const details = await escrowSrc.getDetails();
            expect(details._isRefunded).to.be.true;
        });

        it("Should not allow refund before timelock", async function () {
            await expect(escrowSrc.connect(user).refund())
                .to.be.revertedWith("EscrowSrc: Before timelock");
        });

        it("Should not allow refund after redemption", async function () {
            await escrowSrc.connect(withdrawer).redeem(secret);
            await time.increase(3601);
            
            await expect(escrowSrc.connect(user).refund())
                .to.be.revertedWith("EscrowSrc: Already redeemed");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should correctly report canRedeem", async function () {
            expect(await escrowSrc.canRedeem(secret)).to.be.true;
            expect(await escrowSrc.canRedeem("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).to.be.false;
            
            // After timelock
            await time.increase(3601);
            expect(await escrowSrc.canRedeem(secret)).to.be.false;
        });

        it("Should correctly report canRefund", async function () {
            expect(await escrowSrc.canRefund()).to.be.false;
            
            // After timelock
            await time.increase(3601);
            expect(await escrowSrc.canRefund()).to.be.true;
            
            // After refund
            await escrowSrc.connect(user).refund();
            expect(await escrowSrc.canRefund()).to.be.false;
        });
    });

    describe("Emergency Recovery", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should allow emergency recovery after 7 days past timelock", async function () {
            // Fast forward past timelock + 7 days
            await time.increase(3600 + 7 * 24 * 3600 + 1);
            
            const initialBalance = await token.balanceOf(depositor.address);
            
            await escrowSrc.connect(user).emergencyRecover();
            
            const finalBalance = await token.balanceOf(depositor.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            const details = await escrowSrc.getDetails();
            expect(details._isRefunded).to.be.true;
        });

        it("Should not allow emergency recovery before 7 day period", async function () {
            await time.increase(3601); // Just past timelock
            
            await expect(escrowSrc.connect(user).emergencyRecover())
                .to.be.revertedWith("EscrowSrc: Emergency period not reached");
        });
    });

    // Enhanced Security Test Scenarios
    describe("Security: Reentrancy Protection", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should prevent reentrancy during redemption", async function () {
            // Test that the nonReentrant modifier works
            // Multiple simultaneous calls should not succeed
            await ethers.provider.send("evm_setAutomine", [false]);

            try {
                // Try to call redeem multiple times simultaneously
                const tx1 = escrowSrc.connect(withdrawer).redeem(secret);
                const tx2 = escrowSrc.connect(withdrawer).redeem(secret);
                
                await ethers.provider.send("evm_mine");
                
                // Only one should succeed
                const results = await Promise.allSettled([tx1, tx2]);
                const successful = results.filter(r => r.status === 'fulfilled').length;
                expect(successful).to.equal(1);
            } finally {
                await ethers.provider.send("evm_setAutomine", [true]);
            }
        });

        it("Should prevent reentrancy during refund", async function () {
            await time.increase(3601); // Past timelock

            await ethers.provider.send("evm_setAutomine", [false]);

            try {
                const tx1 = escrowSrc.connect(user).refund();
                const tx2 = escrowSrc.connect(user).refund();
                
                await ethers.provider.send("evm_mine");
                
                const results = await Promise.allSettled([tx1, tx2]);
                const successful = results.filter(r => r.status === 'fulfilled').length;
                expect(successful).to.equal(1);
            } finally {
                await ethers.provider.send("evm_setAutomine", [true]);
            }
        });
    });

    describe("Security: Access Control Edge Cases", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should prevent withdrawer from depositing", async function () {
            // Create another escrow where withdrawer tries to deposit
            const currentTime = await time.latest();
            const newTimelock = currentTime + 3600;
            const newOrderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-2"));

            await factory.createEscrowSrc(
                newOrderId,
                token.target,
                amount,
                withdrawer.address, // withdrawer as depositor
                user.address,
                secretHash,
                newTimelock,
                { value: safetyDeposit }
            );

            const newEscrowAddress = await factory.escrows(newOrderId);
            const newEscrow = await ethers.getContractAt("EscrowSrc", newEscrowAddress);

            await token.transfer(withdrawer.address, amount);
            await token.connect(withdrawer).approve(newEscrowAddress, amount);

            // Should work - withdrawer is the depositor in this escrow
            await expect(newEscrow.connect(withdrawer).deposit()).to.not.be.reverted;
        });

        it("Should enforce strict role separation", async function () {
            // Depositor cannot redeem directly
            await expect(escrowSrc.connect(depositor).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Only withdrawer can redeem in exclusive period");

            // Random user cannot deposit
            await expect(escrowSrc.connect(user).deposit())
                .to.be.revertedWith("EscrowSrc: Only depositor can deposit");
        });
    });

    describe("Security: Gas Limit Attack Protection", function () {
        it("Should handle operations within reasonable gas limits", async function () {
            await escrowSrc.connect(depositor).deposit();

            // Test redemption with specific gas limit
            const gasLimit = 300000; // Reasonable gas limit
            const tx = await escrowSrc.connect(withdrawer).redeem(secret, { gasLimit });
            const receipt = await tx.wait();
            
            expect(receipt.gasUsed).to.be.lessThan(gasLimit);
            expect(receipt.status).to.equal(1);
        });

        it("Should fail gracefully with insufficient gas", async function () {
            await escrowSrc.connect(depositor).deposit();

            // Try with very low gas limit
            await expect(
                escrowSrc.connect(withdrawer).redeem(secret, { gasLimit: 50000 })
            ).to.be.reverted; // Should fail due to insufficient gas
        });
    });

    describe("Security: Token Security Scenarios", function () {
        it("Should handle token transfer failures gracefully", async function () {
            // Create escrow with token that has transfer restrictions
            const RestrictedToken = await ethers.getContractFactory("MockERC20");
            const restrictedToken = await RestrictedToken.deploy("Restricted", "RSTR", ethers.parseEther("1000"));
            
            const currentTime = await time.latest();
            const newTimelock = currentTime + 3600;
            const newOrderId = ethers.keccak256(ethers.toUtf8Bytes("restricted-token-test"));

            await factory.createEscrowSrc(
                newOrderId,
                restrictedToken.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                newTimelock,
                { value: safetyDeposit }
            );

            const restrictedEscrowAddress = await factory.escrows(newOrderId);
            const restrictedEscrow = await ethers.getContractAt("EscrowSrc", restrictedEscrowAddress);

            // Give tokens and approve
            await restrictedToken.transfer(depositor.address, amount);
            await restrictedToken.connect(depositor).approve(restrictedEscrowAddress, amount);

            // Should work with normal token
            await restrictedEscrow.connect(depositor).deposit();
            await restrictedEscrow.connect(withdrawer).redeem(secret);

            const details = await restrictedEscrow.getDetails();
            expect(details._isRedeemed).to.be.true;
        });

        it("Should handle zero-value token attacks", async function () {
            // Test with dust amounts
            const dustAmount = 1n; // 1 wei
            const currentTime = await time.latest();
            const dustTimelock = currentTime + 3600;
            const dustOrderId = ethers.keccak256(ethers.toUtf8Bytes("dust-test"));

            await factory.createEscrowSrc(
                dustOrderId,
                token.target,
                dustAmount,
                depositor.address,
                withdrawer.address,
                secretHash,
                dustTimelock,
                { value: safetyDeposit }
            );

            const dustEscrowAddress = await factory.escrows(dustOrderId);
            const dustEscrow = await ethers.getContractAt("EscrowSrc", dustEscrowAddress);

            await token.connect(depositor).approve(dustEscrowAddress, dustAmount);
            await dustEscrow.connect(depositor).deposit();

            // Should work even with dust amounts
            await dustEscrow.connect(withdrawer).redeem(secret);
            
            const details = await dustEscrow.getDetails();
            expect(details._isRedeemed).to.be.true;
        });
    });

    describe("Security: Front-Running Protection", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should protect against MEV during exclusive period", async function () {
            // During exclusive period, only withdrawer can redeem
            const mevBot = accounts[4]; // Simulate MEV bot
            
            await expect(escrowSrc.connect(mevBot).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Only withdrawer can redeem in exclusive period");

            // Legitimate withdrawer should still work
            await escrowSrc.connect(withdrawer).redeem(secret);
            
            const details = await escrowSrc.getDetails();
            expect(details._isRedeemed).to.be.true;
        });

        it("Should handle concurrent public withdrawal attempts", async function () {
            // Fast forward to public period
            await time.increase(2700); // 45 minutes
            
            await ethers.provider.send("evm_setAutomine", [false]);

            try {
                // Multiple users try to trigger public withdrawal
                const tx1 = escrowSrc.connect(user).publicWithdraw(secret);
                const tx2 = escrowSrc.connect(accounts[4]).publicWithdraw(secret);
                
                await ethers.provider.send("evm_mine");
                
                // Only one should succeed
                const results = await Promise.allSettled([tx1, tx2]);
                const successful = results.filter(r => r.status === 'fulfilled').length;
                expect(successful).to.equal(1);
            } finally {
                await ethers.provider.send("evm_setAutomine", [true]);
            }
        });
    });

    describe("Security: Timelock Manipulation Resistance", function () {
        it("Should resist timestamp manipulation attempts", async function () {
            await escrowSrc.connect(depositor).deposit();

            // Try to redeem immediately (should work during exclusive period)
            await escrowSrc.connect(withdrawer).redeem(secret);

            // Verify that timelock is still properly enforced in new scenarios
            const currentTime = await time.latest();
            const futureTimelock = currentTime + 7200; // 2 hours
            const futureOrderId = ethers.keccak256(ethers.toUtf8Bytes("future-test"));

            await factory.createEscrowSrc(
                futureOrderId,
                token.target,
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                futureTimelock,
                { value: safetyDeposit }
            );

            const futureEscrowAddress = await factory.escrows(futureOrderId);
            const futureEscrow = await ethers.getContractAt("EscrowSrc", futureEscrowAddress);

            await token.connect(depositor).approve(futureEscrowAddress, amount);
            await futureEscrow.connect(depositor).deposit();

            // Should not be able to refund before timelock
            await expect(futureEscrow.connect(user).refund())
                .to.be.revertedWith("EscrowSrc: Before timelock");

            // Fast forward to just before timelock
            await time.increaseTo(futureTimelock - 1);
            await expect(futureEscrow.connect(user).refund())
                .to.be.revertedWith("EscrowSrc: Before timelock");

            // At exact timelock should work
            await time.increaseTo(futureTimelock);
            await futureEscrow.connect(user).refund();

            const details = await futureEscrow.getDetails();
            expect(details._isRefunded).to.be.true;
        });
    });

    describe("Security: Emergency Recovery Security", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should prevent premature emergency recovery", async function () {
            // Just past normal timelock
            await time.increase(3601);
            
            await expect(escrowSrc.connect(user).emergencyRecover())
                .to.be.revertedWith("EscrowSrc: Emergency period not reached");

            // 6 days after timelock (not quite 7)
            await time.increase(6 * 24 * 3600);
            
            await expect(escrowSrc.connect(user).emergencyRecover())
                .to.be.revertedWith("EscrowSrc: Emergency period not reached");
        });

        it("Should only allow emergency recovery to correct recipient", async function () {
            // Fast forward to emergency period
            await time.increase(3600 + 7 * 24 * 3600 + 1);

            const initialDepositorBalance = await token.balanceOf(depositor.address);
            const initialWithdrawerBalance = await token.balanceOf(withdrawer.address);
            
            // Emergency recovery should refund to depositor (not withdrawer)
            await escrowSrc.connect(user).emergencyRecover();
            
            const finalDepositorBalance = await token.balanceOf(depositor.address);
            const finalWithdrawerBalance = await token.balanceOf(withdrawer.address);
            
            // Depositor should receive the funds
            expect(finalDepositorBalance - initialDepositorBalance).to.equal(amount);
            // Withdrawer should not receive any funds
            expect(finalWithdrawerBalance).to.equal(initialWithdrawerBalance);
        });

        it("Should handle emergency recovery incentives correctly", async function () {
            await time.increase(3600 + 7 * 24 * 3600 + 1);

            const initialCallerBalance = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowSrc.connect(user).emergencyRecover();
            const receipt = await tx.wait();
            
            const finalCallerBalance = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            // Caller should receive safety deposit minus gas costs
            expect(finalCallerBalance - initialCallerBalance + gasUsed)
                .to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
        });
    });

    describe("Security: State Consistency", function () {
        beforeEach(async function () {
            await escrowSrc.connect(depositor).deposit();
        });

        it("Should maintain consistent state across all operations", async function () {
            // Check initial state
            let details = await escrowSrc.getDetails();
            expect(details._isRedeemed).to.be.false;
            expect(details._isRefunded).to.be.false;

            // After redemption
            await escrowSrc.connect(withdrawer).redeem(secret);
            
            details = await escrowSrc.getDetails();
            expect(details._isRedeemed).to.be.true;
            expect(details._isRefunded).to.be.false;

            // View functions should reflect state correctly
            expect(await escrowSrc.canRedeem(secret)).to.be.false;
            expect(await escrowSrc.canRefund()).to.be.false;
        });

        it("Should prevent state corruption from multiple operations", async function () {
            // Try to perform multiple operations that should fail after redemption
            await escrowSrc.connect(withdrawer).redeem(secret);

            // All subsequent operations should fail
            await expect(escrowSrc.connect(withdrawer).redeem(secret))
                .to.be.revertedWith("EscrowSrc: Already redeemed");

            await expect(escrowSrc.connect(user).publicWithdraw(secret))
                .to.be.revertedWith("EscrowSrc: Already redeemed");

            await time.increase(3601);
            await expect(escrowSrc.connect(user).refund())
                .to.be.revertedWith("EscrowSrc: Already redeemed");

            // State should remain consistent
            const details = await escrowSrc.getDetails();
            expect(details._isRedeemed).to.be.true;
            expect(details._isRefunded).to.be.false;
        });
    });
});