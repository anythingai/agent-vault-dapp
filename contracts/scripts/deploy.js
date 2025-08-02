const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // Deploy EscrowFactory (which also deploys implementation contracts)
  const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
  const factory = await EscrowFactory.deploy();
  await factory.waitForDeployment();

  console.log("EscrowFactory deployed to:", await factory.getAddress());

  // Get implementation addresses
  const stats = await factory.getFactoryStats();
  console.log("EscrowSrc implementation:", stats._escrowSrcImplementation);
  console.log("EscrowDst implementation:", stats._escrowDstImplementation);

  // Deploy a test ERC20 token for testing
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const testToken = await MockERC20.deploy(
    "Test Token",
    "TEST",
    ethers.parseEther("1000000") // 1M tokens
  );
  await testToken.waitForDeployment();

  console.log("Test Token deployed to:", await testToken.getAddress());

  // Save deployment addresses
  const deployments = {
    network: await ethers.provider.getNetwork(),
    deployer: deployer.address,
    contracts: {
      EscrowFactory: await factory.getAddress(),
      EscrowSrcImplementation: stats._escrowSrcImplementation,
      EscrowDstImplementation: stats._escrowDstImplementation,
      TestToken: await testToken.getAddress()
    },
    deployedAt: new Date().toISOString()
  };

  console.log("\nDeployment Summary:");
  console.log(JSON.stringify(deployments, null, 2));

  // Verify basic functionality
  console.log("\nVerifying factory functionality...");
  const currentTime = Math.floor(Date.now() / 1000);
  const timelock = currentTime + 3600; // 1 hour
  const orderId = ethers.keccak256(ethers.toUtf8Bytes("test-deployment"));
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes("test-secret"));
  const amount = ethers.parseEther("1.0");
  const safetyDeposit = ethers.parseEther("0.001");

  try {
    const tx = await factory.createEscrowSrc(
      orderId,
      await testToken.getAddress(),
      amount,
      deployer.address,
      deployer.address,
      secretHash,
      timelock,
      { value: safetyDeposit }
    );
    
    const receipt = await tx.wait();
    console.log("✅ Test escrow created successfully");
    console.log("Transaction hash:", receipt.hash);
    
    const escrowAddress = await factory.escrows(orderId);
    console.log("Test escrow address:", escrowAddress);
    
  } catch (error) {
    console.error("❌ Factory verification failed:", error.message);
  }

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\nTo verify contracts on Etherscan, run:");
  console.log(`npx hardhat verify --network ${(await ethers.provider.getNetwork()).name} ${await factory.getAddress()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });