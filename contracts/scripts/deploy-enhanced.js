const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("=".repeat(50));
  console.log("🚀 ENHANCED CONTRACT DEPLOYMENT");
  console.log("=".repeat(50));
  console.log(`Network: ${network.name} (${network.chainId})`);
  console.log(`Deploying with account: ${deployer.address}`);
  
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance < ethers.parseEther("0.01")) {
    console.warn("⚠️  Low balance detected. Make sure you have sufficient ETH for deployment.");
  }

  console.log("\n📋 Deployment Plan:");
  console.log("1. Deploy EscrowFactory (includes implementation contracts)");
  console.log("2. Deploy Test Token (for testing purposes)");
  console.log("3. Verify basic functionality");
  console.log("4. Save deployment records");
  console.log("5. Generate verification commands");

  // Track deployment metrics
  const deploymentMetrics = {
    startTime: Date.now(),
    gasUsed: {},
    deploymentCosts: {}
  };

  try {
    // Deploy EscrowFactory
    console.log("\n🔨 Deploying EscrowFactory...");
    const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
    const factory = await EscrowFactory.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    console.log(`✅ EscrowFactory deployed to: ${factoryAddress}`);

    // Get implementation addresses
    const stats = await factory.getFactoryStats();
    console.log(`   EscrowSrc implementation: ${stats._escrowSrcImplementation}`);
    console.log(`   EscrowDst implementation: ${stats._escrowDstImplementation}`);

    // Deploy Test Token
    console.log("\n🪙 Deploying Test Token...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const testToken = await MockERC20.deploy(
      "Test Token",
      "TEST",
      ethers.parseEther("1000000") // 1M tokens
    );
    await testToken.waitForDeployment();

    const testTokenAddress = await testToken.getAddress();
    console.log(`✅ Test Token deployed to: ${testTokenAddress}`);

    // Create deployment record
    const deploymentRecord = {
      network: {
        name: network.name,
        chainId: network.chainId.toString()
      },
      deployer: deployer.address,
      deployedAt: new Date().toISOString(),
      contracts: {
        EscrowFactory: {
          address: factoryAddress,
          verified: false,
          constructorArgs: []
        },
        EscrowSrcImplementation: {
          address: stats._escrowSrcImplementation,
          verified: false,
          constructorArgs: []
        },
        EscrowDstImplementation: {
          address: stats._escrowDstImplementation,
          verified: false,
          constructorArgs: []
        },
        TestToken: {
          address: testTokenAddress,
          verified: false,
          constructorArgs: [
            "Test Token",
            "TEST",
            ethers.parseEther("1000000").toString()
          ]
        }
      },
      factoryConfiguration: {
        minimumSafetyDeposit: stats._minimumSafetyDeposit.toString(),
        maximumTimelock: stats._maximumTimelock.toString(),
        minimumTimelock: stats._minimumTimelock.toString()
      },
      deploymentMetrics: {
        totalContracts: 4,
        deploymentDuration: `${Date.now() - deploymentMetrics.startTime}ms`
      }
    };

    // Verify basic functionality
    console.log("\n🧪 Testing factory functionality...");
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const timelock = currentTime + 3600; // 1 hour
      const orderId = ethers.keccak256(ethers.toUtf8Bytes(`test-${network.name}-${Date.now()}`));
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes("test-secret-123"));
      const amount = ethers.parseEther("1.0");
      const safetyDeposit = ethers.parseEther("0.001");

      const tx = await factory.createEscrowSrc(
        orderId,
        testTokenAddress,
        amount,
        deployer.address,
        deployer.address,
        secretHash,
        timelock,
        { value: safetyDeposit }
      );
      
      const receipt = await tx.wait();
      const escrowAddress = await factory.escrows(orderId);
      
      console.log("✅ Factory test successful!");
      console.log(`   Transaction hash: ${receipt.hash}`);
      console.log(`   Test escrow address: ${escrowAddress}`);
      console.log(`   Gas used: ${receipt.gasUsed}`);

      // Add test transaction to deployment record
      deploymentRecord.testTransaction = {
        hash: receipt.hash,
        escrowAddress: escrowAddress,
        gasUsed: receipt.gasUsed.toString(),
        status: "success"
      };

    } catch (error) {
      console.error("❌ Factory test failed:", error.message);
      deploymentRecord.testTransaction = {
        status: "failed",
        error: error.message
      };
    }

    // Save deployment record
    const deploymentDir = path.join(__dirname, '../../deployment');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const filename = `${network.name}-addresses.json`;
    const filepath = path.join(deploymentDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(deploymentRecord, null, 2));
    console.log(`\n💾 Deployment record saved to: ${filename}`);

    // Generate verification commands
    console.log("\n🔍 Contract Verification Commands:");
    if (network.name !== 'hardhat' && network.name !== 'localhost') {
      console.log("Run these commands to verify contracts on Etherscan:");
      console.log(`npx hardhat verify --network ${network.name} ${factoryAddress}`);
      console.log(`npx hardhat verify --network ${network.name} ${stats._escrowSrcImplementation}`);
      console.log(`npx hardhat verify --network ${network.name} ${stats._escrowDstImplementation}`);
      console.log(`npx hardhat verify --network ${network.name} ${testTokenAddress} "Test Token" "TEST" "${ethers.parseEther("1000000")}"`);
    } else {
      console.log("Local network detected - Etherscan verification not available");
    }

    console.log("\n🎉 Deployment completed successfully!");
    console.log("\n📊 Summary:");
    console.log(`Network: ${network.name}`);
    console.log(`EscrowFactory: ${factoryAddress}`);
    console.log(`Test Token: ${testTokenAddress}`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance after deployment: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

    return deploymentRecord;

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment script failed:", error);
      process.exit(1);
    });
}

module.exports = { main };