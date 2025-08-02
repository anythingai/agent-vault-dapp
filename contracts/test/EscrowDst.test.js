const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EscrowDst", function () {
    let escrowDst;
    let factory;
    let token;
    let owner;
    let depositor; // resolver
    let withdrawer; // user
    let user;
    let accounts;

    const secret = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const secretHash = ethers.sha256(ethers.solidityPacked(["bytes32"], [secret]));
    const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-order-dst-1"));
    const amount = ethers.parseEther("0.5");
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

        // Create destination escrow through factory
        const tx = await factory.createEscrowDst(
            orderId,
            token.target,
            amount,
            depositor.address, // resolver deposits
            withdrawer.address, // user withdraws
            secretHash,
            timelock,
            { value: safetyDeposit }
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment?.name === "EscrowDstCreated");
        const escrowAddress = event.args.escrowAddress;

        escrowDst = await ethers.getContractAt("EscrowDst", escrowAddress);

        // Give tokens to depositor (resolver) and approve escrow
        await token.transfer(depositor.address, amount);
        await token.connect(depositor).approve(escrowAddress, amount);
    });

    describe("Initialization", function () {
        it("Should be initialized with correct parameters", async function () {
            const details = await escrowDst.getDetails();
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
            const balance = await ethers.provider.getBalance(escrowDst.target);
            expect(balance).to.equal(safetyDeposit);
        });
    });

    describe("Deposit", function () {
        it("Should allow depositor (resolver) to deposit tokens", async function () {
            await escrowDst.connect(depositor).deposit();
            
            const tokenBalance = await token.balanceOf(escrowDst.target);
            expect(tokenBalance).to.equal(amount);
        });

        it("Should not allow non-depositor to deposit", async function () {
            await expect(escrowDst.connect(user).deposit())
                .to.be.revertedWith("EscrowDst: Only depositor can deposit");
        });

        it("Should not allow deposit twice", async function () {
            await escrowDst.connect(depositor).deposit();
            await expect(escrowDst.connect(depositor).deposit())
                .to.be.revertedWith("EscrowDst: Already deposited");
        });
    });

    describe("Redemption by User", function () {
        beforeEach(async function () {
            // Deposit tokens first
            await escrowDst.connect(depositor).deposit();
        });

        it("Should allow user (withdrawer) to redeem with correct secret", async function () {
            const initialBalance = await token.balanceOf(withdrawer.address);
            const initialEthBalance = await ethers.provider.getBalance(withdrawer.address);
            
            const tx = await escrowDst.connect(withdrawer).redeem(secret);
            const receipt = await tx.wait();
            
            // Check token transfer to user
            const finalBalance = await token.balanceOf(withdrawer.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit transfer to user
            const finalEthBalance = await ethers.provider.getBalance(withdrawer.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
            
            // Check event
            await expect(tx).to.emit(escrowDst, "Redeemed")
                .withArgs(orderId, secret, withdrawer.address);
            
            // Check state
            const details = await escrowDst.getDetails();
            expect(details._isRedeemed).to.be.true;
        });

        it("Should not allow redemption with wrong secret", async function () {
            const wrongSecret = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
            await expect(escrowDst.connect(withdrawer).redeem(wrongSecret))
                .to.be.revertedWith("EscrowDst: Invalid secret");
        });

        it("Should not allow non-user to redeem directly", async function () {
            await expect(escrowDst.connect(user).redeem(secret))
                .to.be.revertedWith("EscrowDst: Only user can redeem directly");
        });

        it("Should not allow redemption after timelock", async function () {
            // Fast forward past timelock
            await time.increase(3601);
            
            await expect(escrowDst.connect(withdrawer).redeem(secret))
                .to.be.revertedWith("EscrowDst: Past timelock");
        });

        it("Should not allow redemption twice", async function () {
            await escrowDst.connect(withdrawer).redeem(secret);
            await expect(escrowDst.connect(withdrawer).redeem(secret))
                .to.be.revertedWith("EscrowDst: Already redeemed");
        });
    });

    describe("Public Withdrawal", function () {
        beforeEach(async function () {
            await escrowDst.connect(depositor).deposit();
        });

        it("Should allow user to withdraw via publicWithdraw", async function () {
            const initialBalance = await token.balanceOf(withdrawer.address);
            const initialEthBalance = await ethers.provider.getBalance(withdrawer.address);
            
            const tx = await escrowDst.connect(withdrawer).publicWithdraw(secret);
            const receipt = await tx.wait();
            
            // Check token goes to user
            const finalBalance = await token.balanceOf(withdrawer.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit goes to user (since they called it)
            const finalEthBalance = await ethers.provider.getBalance(withdrawer.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
        });

        it("Should allow third party to trigger withdrawal for user after delay", async function () {
            // Fast forward to allow public withdrawal
            await time.increase(1800 + 1); // 30 minutes + 1 second (PUBLIC_WITHDRAW_DELAY)
            
            const userInitialBalance = await token.balanceOf(withdrawer.address);
            const thirdPartyInitialEth = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowDst.connect(user).publicWithdraw(secret);
            const receipt = await tx.wait();
            
            // Check token goes to user
            const userFinalBalance = await token.balanceOf(withdrawer.address);
            expect(userFinalBalance - userInitialBalance).to.equal(amount);
            
            // Check safety deposit is split between user and caller
            const thirdPartyFinalEth = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const expectedCallerShare = safetyDeposit / 2n;
            expect(thirdPartyFinalEth - thirdPartyInitialEth + gasUsed).to.be.closeTo(expectedCallerShare, ethers.parseEther("0.0001"));
        });

        it("Should not allow public withdrawal with wrong secret", async function () {
            await time.increase(1800 + 1);
            const wrongSecret = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
            await expect(escrowDst.connect(user).publicWithdraw(wrongSecret))
                .to.be.revertedWith("EscrowDst: Invalid secret");
        });
    });

    describe("Refund", function () {
        beforeEach(async function () {
            await escrowDst.connect(depositor).deposit();
        });

        it("Should allow refund to depositor (resolver) after timelock", async function () {
            // Fast forward past timelock
            await time.increase(3601);
            
            const initialBalance = await token.balanceOf(depositor.address);
            const initialEthBalance = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowDst.connect(user).refund();
            const receipt = await tx.wait();
            
            // Check token refund to depositor (resolver)
            const finalBalance = await token.balanceOf(depositor.address);
            expect(finalBalance - initialBalance).to.equal(amount);
            
            // Check safety deposit goes to caller
            const finalEthBalance = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(finalEthBalance - initialEthBalance + gasUsed).to.be.closeTo(safetyDeposit, ethers.parseEther("0.0001"));
            
            // Check event
            await expect(tx).to.emit(escrowDst, "Refunded")
                .withArgs(orderId, depositor.address);
            
            // Check state
            const details = await escrowDst.getDetails();
            expect(details._isRefunded).to.be.true;
        });

        it("Should not allow refund before timelock", async function () {
            await expect(escrowDst.connect(user).refund())
                .to.be.revertedWith("EscrowDst: Before timelock");
        });

        it("Should not allow refund after redemption", async function () {
            await escrowDst.connect(withdrawer).redeem(secret);
            await time.increase(3601);
            
            await expect(escrowDst.connect(user).refund())
                .to.be.revertedWith("EscrowDst: Already redeemed");
        });
    });

    describe("ETH Escrows", function () {
        let ethEscrow;

        beforeEach(async function () {
            const currentTime = await time.latest();
            const timelock = currentTime + 3600;

            // Create ETH escrow (token = address(0))
            const tx = await factory.createEscrowDst(
                ethers.keccak256(ethers.toUtf8Bytes("eth-order")),
                ethers.ZeroAddress, // ETH
                amount,
                depositor.address,
                withdrawer.address,
                secretHash,
                timelock,
                { value: safetyDeposit }
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "EscrowDstCreated");
            const escrowAddress = event.args.escrowAddress;

            ethEscrow = await ethers.getContractAt("EscrowDst", escrowAddress);
        });

        it("Should handle ETH deposits correctly", async function () {
            await ethEscrow.connect(depositor).deposit({ value: amount });
            
            const ethBalance = await ethers.provider.getBalance(ethEscrow.target);
            // Should have both the deposited amount and safety deposit
            expect(ethBalance).to.equal(amount + safetyDeposit);
        });

        it("Should allow ETH redemption", async function () {
            await ethEscrow.connect(depositor).deposit({ value: amount });
            
            const initialBalance = await ethers.provider.getBalance(withdrawer.address);
            const tx = await ethEscrow.connect(withdrawer).redeem(secret);
            const receipt = await tx.wait();
            
            const finalBalance = await ethers.provider.getBalance(withdrawer.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            // Should receive both amount and safety deposit, minus gas
            expect(finalBalance - initialBalance + gasUsed).to.be.closeTo(amount + safetyDeposit, ethers.parseEther("0.0001"));
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await escrowDst.connect(depositor).deposit();
        });

        it("Should correctly report canRedeem", async function () {
            expect(await escrowDst.canRedeem(secret)).to.be.true;
            expect(await escrowDst.canRedeem("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).to.be.false;
            
            // After timelock
            await time.increase(3601);
            expect(await escrowDst.canRedeem(secret)).to.be.false;
        });

        it("Should correctly report canRefund", async function () {
            expect(await escrowDst.canRefund()).to.be.false;
            
            // After timelock
            await time.increase(3601);
            expect(await escrowDst.canRefund()).to.be.true;
            
            // After refund
            await escrowDst.connect(user).refund();
            expect(await escrowDst.canRefund()).to.be.false;
        });

        it("Should correctly report canPublicWithdraw", async function () {
            expect(await escrowDst.canPublicWithdraw(secret)).to.be.false;
            
            // After delay
            await time.increase(1800 + 1); // PUBLIC_WITHDRAW_DELAY + 1
            expect(await escrowDst.canPublicWithdraw(secret)).to.be.true;
            
            // After timelock
            await time.increase(1800);
            expect(await escrowDst.canPublicWithdraw(secret)).to.be.false;
        });
    });

    describe("Emergency Recovery", function () {
        beforeEach(async function () {
            await escrowDst.connect(depositor).deposit();
        });

        it("Should allow emergency recovery after 7 days past timelock", async function () {
            // Fast forward past timelock + 7 days
            await time.increase(3600 + 7 * 24 * 3600 + 1);
            
            const userInitialBalance = await token.balanceOf(withdrawer.address);
            const callerInitialEth = await ethers.provider.getBalance(user.address);
            
            const tx = await escrowDst.connect(user).emergencyRecover();
            const receipt = await tx.wait();
            
            // Check tokens go to user (withdrawer)
            const userFinalBalance = await token.balanceOf(withdrawer.address);
            expect(userFinalBalance - userInitialBalance).to.equal(amount);
            
            // Check safety deposit split between user and caller
            const callerFinalEth = await ethers.provider.getBalance(user.address);
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const expectedCallerShare = safetyDeposit / 2n;
            expect(callerFinalEth - callerInitialEth + gasUsed).to.be.closeTo(expectedCallerShare, ethers.parseEther("0.0001"));
            
            const details = await escrowDst.getDetails();
            expect(details._isRedeemed).to.be.true;
        });

        it("Should not allow emergency recovery before 7 day period", async function () {
            await time.increase(3601); // Just past timelock
            
            await expect(escrowDst.connect(user).emergencyRecover())
                .to.be.revertedWith("EscrowDst: Emergency period not reached");
        });
    });
});