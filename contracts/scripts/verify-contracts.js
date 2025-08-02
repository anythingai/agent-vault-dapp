const { run, ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const network = await ethers.provider.getNetwork();
  console.log("=".repeat(50));
  console.log("🔍 CONTRACT VERIFICATION");
  console.log("=".repeat(50));
  console.log(`Network: ${network.name} (${network.chainId})`);

  // Check if we're on a supported network
  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log("❌ Cannot verify contracts on local network");
    return;
  }

  // Load deployment record
  const deploymentFile = path.join(__dirname, `../../deployment/${network.name}-addresses.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.log("Please deploy contracts first using:");
    console.log(`npx hardhat run scripts/deploy-enhanced.js --network ${network.name}`);
    return;
  }

  const deploymentRecord = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  console.log(`📂 Loaded deployment record from: ${network.name}-addresses.json`);

  const contracts = deploymentRecord.contracts;
  const verificationResults = {};

  console.log("\n🔍 Starting contract verification...");

  try {
    // Verify EscrowFactory
    console.log("\n1. Verifying EscrowFactory...");
    try {
      await run("verify:verify", {
        address: contracts.EscrowFactory.address,
        constructorArguments: contracts.EscrowFactory.constructorArgs
      });
      console.log("✅ EscrowFactory verified successfully");
      verificationResults.EscrowFactory = { status: "success", verified: true };
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ EscrowFactory already verified");
        verificationResults.EscrowFactory = { status: "already_verified", verified: true };
      } else {
        console.error(`❌ EscrowFactory verification failed: ${error.message}`);
        verificationResults.EscrowFactory = { status: "failed", verified: false, error: error.message };
      }
    }

    // Verify EscrowSrc Implementation
    console.log("\n2. Verifying EscrowSrc Implementation...");
    try {
      await run("verify:verify", {
        address: contracts.EscrowSrcImplementation.address,
        constructorArguments: contracts.EscrowSrcImplementation.constructorArgs
      });
      console.log("✅ EscrowSrc Implementation verified successfully");
      verificationResults.EscrowSrcImplementation = { status: "success", verified: true };
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ EscrowSrc Implementation already verified");
        verificationResults.EscrowSrcImplementation = { status: "already_verified", verified: true };
      } else {
        console.error(`❌ EscrowSrc Implementation verification failed: ${error.message}`);
        verificationResults.EscrowSrcImplementation = { status: "failed", verified: false, error: error.message };
      }
    }

    // Verify EscrowDst Implementation
    console.log("\n3. Verifying EscrowDst Implementation...");
    try {
      await run("verify:verify", {
        address: contracts.EscrowDstImplementation.address,
        constructorArguments: contracts.EscrowDstImplementation.constructorArgs
      });
      console.log("✅ EscrowDst Implementation verified successfully");
      verificationResults.EscrowDstImplementation = { status: "success", verified: true };
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ EscrowDst Implementation already verified");
        verificationResults.EscrowDstImplementation = { status: "already_verified", verified: true };
      } else {
        console.error(`❌ EscrowDst Implementation verification failed: ${error.message}`);
        verificationResults.EscrowDstImplementation = { status: "failed", verified: false, error: error.message };
      }
    }

    // Verify Test Token
    console.log("\n4. Verifying Test Token...");
    try {
      await run("verify:verify", {
        address: contracts.TestToken.address,
        constructorArguments: contracts.TestToken.constructorArgs
      });
      console.log("✅ Test Token verified successfully");
      verificationResults.TestToken = { status: "success", verified: true };
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Test Token already verified");
        verificationResults.TestToken = { status: "already_verified", verified: true };
      } else {
        console.error(`❌ Test Token verification failed: ${error.message}`);
        verificationResults.TestToken = { status: "failed", verified: false, error: error.message };
      }
    }

    // Update deployment record with verification status
    Object.keys(contracts).forEach(contractName => {
      if (verificationResults[contractName]) {
        contracts[contractName].verified = verificationResults[contractName].verified;
        contracts[contractName].verificationStatus = verificationResults[contractName].status;
        if (verificationResults[contractName].error) {
          contracts[contractName].verificationError = verificationResults[contractName].error;
        }
      }
    });

    deploymentRecord.verifiedAt = new Date().toISOString();
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentRecord, null, 2));

    console.log("\n📊 Verification Summary:");
    let successCount = 0;
    let alreadyVerifiedCount = 0;
    let failedCount = 0;

    Object.keys(verificationResults).forEach(contractName => {
      const result = verificationResults[contractName];
      const status = result.status === "success" ? "✅ Success" : 
                    result.status === "already_verified" ? "✅ Already Verified" : 
                    "❌ Failed";
      console.log(`${contractName}: ${status}`);
      
      if (result.status === "success") successCount++;
      else if (result.status === "already_verified") alreadyVerifiedCount++;
      else failedCount++;
    });

    console.log(`\nTotal: ${successCount} successful, ${alreadyVerifiedCount} already verified, ${failedCount} failed`);

    if (failedCount === 0) {
      console.log("\n🎉 All contracts verified successfully!");
    } else {
      console.log("\n⚠️  Some contracts failed verification. Check the errors above.");
    }

    console.log(`\n💾 Updated deployment record saved to: ${network.name}-addresses.json`);

  } catch (error) {
    console.error("❌ Verification process failed:", error);
    throw error;
  }
}

// Execute verification
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Verification script failed:", error);
      process.exit(1);
    });
}

module.exports = { main };