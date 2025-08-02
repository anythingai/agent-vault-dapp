const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("=".repeat(50));
  console.log("⚙️  ESCROW FACTORY INITIALIZATION");
  console.log("=".repeat(50));
  console.log(`Network: ${network.name} (${network.chainId})`);
  console.log(`Initializer: ${deployer.address}`);

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
  
  console.log(`📋 Loading EscrowFactory at: ${contracts.EscrowFactory.address}`);

  // Get factory contract instance
  const factory = await ethers.getContractAt("EscrowFactory", contracts.EscrowFactory.address);

  // Check if we're the owner
  const owner = await factory.owner();
  console.log(`Factory owner: ${owner}`);
  
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error(`❌ Not the factory owner. Current owner: ${owner}`);
    return;
  }

  console.log("✅ Confirmed factory ownership");

  try {
    // Get current configuration
    console.log("\n📊 Current Factory Configuration:");
    const stats = await factory.getFactoryStats();
    console.log(`   Total escrows created: ${stats._totalEscrowsCreated}`);
    console.log(`   Total value locked: ${ethers.formatEther(stats._totalValueLocked)} ETH`);
    console.log(`   Minimum safety deposit: ${ethers.formatEther(stats._minimumSafetyDeposit)} ETH`);
    console.log(`   Maximum timelock: ${stats._maximumTimelock} seconds (${Math.floor(stats._maximumTimelock / 3600)} hours)`);
    console.log(`   Minimum timelock: ${stats._minimumTimelock} seconds (${Math.floor(stats._minimumTimelock / 60)} minutes)`);

    // Production-ready configuration parameters
    const productionConfig = {
      minimumSafetyDeposit: ethers.parseEther("0.001"), // 0.001 ETH
      maximumTimelock: 48 * 3600, // 48 hours
      minimumTimelock: 60 * 60 // 1 hour
    };

    console.log("\n⚙️  Recommended Production Configuration:");
    console.log(`   Minimum safety deposit: ${ethers.formatEther(productionConfig.minimumSafetyDeposit)} ETH`);
    console.log(`   Maximum timelock: ${productionConfig.maximumTimelock} seconds (${productionConfig.maximumTimelock / 3600} hours)`);
    console.log(`   Minimum timelock: ${productionConfig.minimumTimelock} seconds (${productionConfig.minimumTimelock / 60} minutes)`);

    // Ask if user wants to update configuration
    console.log("\n🔧 Configuration Update Options:");
    console.log("1. Keep current configuration (recommended for testing)");
    console.log("2. Update to production-ready configuration");
    console.log("3. Set custom configuration");

    // For this script, we'll just show the commands to update
    console.log("\n📝 To update factory configuration, run:");
    console.log(`factory.updateConfig(`);
    console.log(`  "${productionConfig.minimumSafetyDeposit}",`);
    console.log(`  "${productionConfig.maximumTimelock}",`);
    console.log(`  "${productionConfig.minimumTimelock}"`);
    console.log(`);`);

    // Check pause status
    const isPaused = await factory.paused();
    console.log(`\n🚦 Factory Status: ${isPaused ? 'PAUSED' : 'ACTIVE'}`);

    if (isPaused) {
      console.log("⚠️  Factory is currently paused. To unpause, run:");
      console.log("factory.setPaused(false);");
    }

    // Implementation addresses
    console.log("\n🏗️  Implementation Contract Addresses:");
    console.log(`   EscrowSrc: ${stats._escrowSrcImplementation}`);
    console.log(`   EscrowDst: ${stats._escrowDstImplementation}`);

    // Security recommendations
    console.log("\n🔒 Security Recommendations:");
    console.log("1. ✅ Use multi-signature wallet for factory ownership (for mainnet)");
    console.log("2. ✅ Set appropriate timelock limits for your use case");
    console.log("3. ✅ Monitor safety deposit requirements");
    console.log("4. ✅ Implement emergency pause if needed");
    console.log("5. ✅ Regular monitoring of factory statistics");

    // Save initialization record
    const initRecord = {
      network: network.name,
      initializedAt: new Date().toISOString(),
      initializer: deployer.address,
      factoryOwner: owner,
      currentConfiguration: {
        minimumSafetyDeposit: stats._minimumSafetyDeposit.toString(),
        maximumTimelock: stats._maximumTimelock.toString(),
        minimumTimelock: stats._minimumTimelock.toString(),
        totalEscrowsCreated: stats._totalEscrowsCreated.toString(),
        totalValueLocked: stats._totalValueLocked.toString()
      },
      recommendedProductionConfig: {
        minimumSafetyDeposit: productionConfig.minimumSafetyDeposit.toString(),
        maximumTimelock: productionConfig.maximumTimelock.toString(),
        minimumTimelock: productionConfig.minimumTimelock.toString()
      },
      isPaused: isPaused,
      implementationAddresses: {
        escrowSrc: stats._escrowSrcImplementation,
        escrowDst: stats._escrowDstImplementation
      }
    };

    const initFile = path.join(__dirname, `../../deployment/${network.name}-initialization.json`);
    fs.writeFileSync(initFile, JSON.stringify(initRecord, null, 2));
    console.log(`\n💾 Initialization record saved to: ${network.name}-initialization.json`);

    console.log("\n🎉 Factory initialization check completed!");

  } catch (error) {
    console.error(`❌ Initialization failed: ${error.message}`);
    throw error;
  }
}

// Execute initialization
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Factory initialization failed:", error);
      process.exit(1);
    });
}

module.exports = { main };