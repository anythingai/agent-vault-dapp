const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer, user1, user2] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("=".repeat(50));
  console.log("🧪 POST-DEPLOYMENT FUNCTIONAL TESTS");
  console.log("=".repeat(50));
  console.log(`Network: ${network.name} (${network.chainId})`);
  console.log(`Test runner: ${deployer.address}`);

  // Load deployment record
  const deploymentFile = path.join(__dirname, `../../deployment/${network.name}-addresses.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.log("Please deploy contracts first using:");
    console.log(`npx hardhat run scripts/deploy-enhanced.js --network ${network.name}`);
    return;
  }

  const deploymentRecord = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  const contracts = deploymentRecord.contracts;
  
  console.log("📋 Loading deployed contracts...");
  console.log(`EscrowFactory: ${contracts.EscrowFactory.address}`);
  console.log(`TestToken: ${contracts.TestToken.address}`);

  // Get contract instances
  const factory = await ethers.getContractAt("EscrowFactory", contracts.EscrowFactory.address);
  const testToken = await ethers.getContractAt("MockERC20", contracts.TestToken.address);

  const testResults = {
    network: network.name,
    testRunAt: new Date().toISOString(),
    testRunner: deployer.address,
    tests: {}
  };

  console.log("\n🔍 Running comprehensive functionality tests...\n");

  try {
    // Test 1: Factory Configuration
    console.log("1. Testing factory configuration...");
    const stats = await factory.getFactoryStats();
    console.log(`   ✅ Total escrows created: ${stats._totalEscrowsCreated}`);
    console.log(`   ✅ Minimum safety deposit: ${ethers.formatEther(stats._minimumSafetyDeposit)} ETH`);
    console.log(`   ✅ Maximum timelock: ${stats._maximumTimelock} seconds`);
    console.log(`   ✅ Minimum timelock: ${stats._minimumTimelock} seconds`);
    
    testResults.tests.factoryConfiguration = {
      status: "passed",
      details: {
        totalEscrows: stats._totalEscrowsCreated.toString(),
        minimumSafetyDeposit: stats._minimumSafetyDeposit.toString(),
        maximumTimelock: stats._maximumTimelock.toString(),
        minimumTimelock: stats._minimumTimelock.toString()
      }
    };

    // Test 2: ERC20 Token Functionality
    console.log("\n2. Testing ERC20 token functionality...");
    const tokenName = await testToken.name();
    const tokenSymbol = await testToken.symbol();
    const totalSupply = await testToken.totalSupply();
    const deployerBalance = await testToken.balanceOf(deployer.address);
    
    console.log(`   ✅ Token name: ${tokenName}`);
    console.log(`   ✅ Token symbol: ${tokenSymbol}`);
    console.log(`   ✅ Total supply: ${ethers.formatEther(totalSupply)}`);
    console.log(`   ✅ Deployer balance: ${ethers.formatEther(deployerBalance)}`);
    
    testResults.tests.tokenFunctionality = {
      status: "passed",
      details: {
        name: tokenName,
        symbol: tokenSymbol,
        totalSupply: totalSupply.toString(),
        deployerBalance: deployerBalance.toString()
      }
    };

    // Test 3: Source Escrow Creation with ETH
    console.log("\n3. Testing source escrow creation with ETH...");
    const currentTime = Math.floor(Date.now() / 1000);
    const timelock = currentTime + 3600; // 1 hour
    const orderId1 = ethers.keccak256(ethers.toUtf8Bytes(`test-eth-${Date.now()}`));
    const secretHash = ethers.keccak256(ethers.toUtf8Bytes("secret-123"));
    const ethAmount = ethers.parseEther("0.1");
    const safetyDeposit = ethers.parseEther("0.001");

    const tx1 = await factory.createEscrowSrc(
      orderId1,
      ethers.ZeroAddress, // ETH
      ethAmount,
      deployer.address,
      user1.address,
      secretHash,
      timelock,
      { value: safetyDeposit }
    );
    
    const receipt1 = await tx1.wait();
    const escrowAddress1 = await factory.escrows(orderId1);
    
    console.log(`   ✅ ETH escrow created at: ${escrowAddress1}`);
    console.log(`   ✅ Transaction hash: ${receipt1.hash}`);
    console.log(`   ✅ Gas used: ${receipt1.gasUsed}`);
    
    testResults.tests.ethEscrowCreation = {
      status: "passed",
      details: {
        orderId: orderId1,
        escrowAddress: escrowAddress1,
        txHash: receipt1.hash,
        gasUsed: receipt1.gasUsed.toString()
      }
    };

    // Test 4: Source Escrow Creation with ERC20
    console.log("\n4. Testing source escrow creation with ERC20...");
    const orderId2 = ethers.keccak256(ethers.toUtf8Bytes(`test-token-${Date.now()}`));
    const tokenAmount = ethers.parseEther("100");
    
    const tx2 = await factory.createEscrowSrc(
      orderId2,
      await testToken.getAddress(),
      tokenAmount,
      deployer.address,
      user2.address,
      secretHash,
      timelock,
      { value: safetyDeposit }
    );
    
    const receipt2 = await tx2.wait();
    const escrowAddress2 = await factory.escrows(orderId2);
    
    console.log(`   ✅ Token escrow created at: ${escrowAddress2}`);
    console.log(`   ✅ Transaction hash: ${receipt2.hash}`);
    console.log(`   ✅ Gas used: ${receipt2.gasUsed}`);
    
    testResults.tests.tokenEscrowCreation = {
      status: "passed", 
      details: {
        orderId: orderId2,
        escrowAddress: escrowAddress2,
        txHash: receipt2.hash,
        gasUsed: receipt2.gasUsed.toString()
      }
    };

    // Test 5: Destination Escrow Creation
    console.log("\n5. Testing destination escrow creation...");
    const orderId3 = ethers.keccak256(ethers.toUtf8Bytes(`test-dst-${Date.now()}`));
    
    const tx3 = await factory.createEscrowDst(
      orderId3,
      await testToken.getAddress(),
      tokenAmount,
      deployer.address, // resolver deposits
      user1.address, // user withdraws
      secretHash,
      timelock,
      { value: safetyDeposit }
    );
    
    const receipt3 = await tx3.wait();
    const escrowAddress3 = await factory.escrows(orderId3);
    
    console.log(`   ✅ Destination escrow created at: ${escrowAddress3}`);
    console.log(`   ✅ Transaction hash: ${receipt3.hash}`);
    console.log(`   ✅ Gas used: ${receipt3.gasUsed}`);
    
    testResults.tests.destinationEscrowCreation = {
      status: "passed",
      details: {
        orderId: orderId3,
        escrowAddress: escrowAddress3,
        txHash: receipt3.hash,
        gasUsed: receipt3.gasUsed.toString()
      }
    };

    // Test 6: Escrow Address Prediction
    console.log("\n6. Testing deterministic address prediction...");
    const orderId4 = ethers.keccak256(ethers.toUtf8Bytes(`test-prediction-${Date.now()}`));
    const predictedSrcAddress = await factory.getEscrowSrcAddress(orderId4);
    const predictedDstAddress = await factory.getEscrowDstAddress(orderId4);
    
    console.log(`   ✅ Predicted source address: ${predictedSrcAddress}`);
    console.log(`   ✅ Predicted destination address: ${predictedDstAddress}`);
    
    testResults.tests.addressPrediction = {
      status: "passed",
      details: {
        orderId: orderId4,
        predictedSrcAddress: predictedSrcAddress,
        predictedDstAddress: predictedDstAddress
      }
    };

    // Test 7: Escrow Details Retrieval
    console.log("\n7. Testing escrow details retrieval...");
    const escrow1 = await ethers.getContractAt("EscrowSrc", escrowAddress1);
    const details = await escrow1.getDetails();
    
    console.log(`   ✅ Order ID: ${details[0]}`);
    console.log(`   ✅ Token: ${details[1]}`);
    console.log(`   ✅ Amount: ${ethers.formatEther(details[2])}`);
    console.log(`   ✅ Depositor: ${details[3]}`);
    console.log(`   ✅ Withdrawer: ${details[4]}`);
    
    testResults.tests.escrowDetailsRetrieval = {
      status: "passed",
      details: {
        orderId: details[0],
        token: details[1],
        amount: details[2].toString(),
        depositor: details[3],
        withdrawer: details[4]
      }
    };

    // Calculate total gas used
    const totalGasUsed = receipt1.gasUsed + receipt2.gasUsed + receipt3.gasUsed;
    console.log(`\n📊 Gas Usage Summary:`);
    console.log(`   ETH Escrow Creation: ${receipt1.gasUsed} gas`);
    console.log(`   Token Escrow Creation: ${receipt2.gasUsed} gas`);
    console.log(`   Destination Escrow Creation: ${receipt3.gasUsed} gas`);
    console.log(`   Total Gas Used: ${totalGasUsed} gas`);

    testResults.gasUsage = {
      ethEscrowCreation: receipt1.gasUsed.toString(),
      tokenEscrowCreation: receipt2.gasUsed.toString(),
      destinationEscrowCreation: receipt3.gasUsed.toString(),
      totalGasUsed: totalGasUsed.toString()
    };

    testResults.overallStatus = "passed";
    console.log("\n🎉 All tests passed successfully!");

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    testResults.overallStatus = "failed";
    testResults.error = error.message;
    throw error;
  }

  // Save test results
  const testResultsFile = path.join(__dirname, `../../deployment/${network.name}-test-results.json`);
  fs.writeFileSync(testResultsFile, JSON.stringify(testResults, null, 2));
  console.log(`\n💾 Test results saved to: ${network.name}-test-results.json`);

  return testResults;
}

// Execute tests
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Post-deployment testing failed:", error);
      process.exit(1);
    });
}

module.exports = { main };