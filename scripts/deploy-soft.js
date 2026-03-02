const hre = require("hardhat");

async function main() {
  console.log("\n🔥 HotSpark Soft Staking Deployment");
  console.log("=====================================");
  
  // Get HOT token address from environment
  const hotTokenAddress = process.env.HOT_TOKEN_ADDRESS;
  if (!hotTokenAddress) {
    console.error("❌ Please set HOT_TOKEN_ADDRESS in .env file");
    console.log("\n📝 Add this to your .env file:");
    console.log("HOT_TOKEN_ADDRESS=0x...");
    process.exit(1);
  }

  console.log("📝 HOT Token Address:", hotTokenAddress);

  // Get deployer info
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "BNB");

  // Check if we're on testnet/mainnet
  const network = hre.network.name;
  console.log("🌐 Network:", network);
  console.log("🔗 Chain ID:", hre.network.config.chainId);

  // Deploy soft staking
  console.log("\n📄 Deploying HotSparkSoftStaking...");
  
  const SoftStaking = await ethers.getContractFactory("HotSparkSoftStaking");
  const softStaking = await SoftStaking.deploy(hotTokenAddress);

  await softStaking.waitForDeployment();
  const softAddress = await softStaking.getAddress();

  console.log("✅ Soft Staking deployed to:", softAddress);
  
  if (network === "bscTestnet") {
    console.log("🔍 BSCScan: https://testnet.bscscan.com/address/" + softAddress);
  }

  // Verify contract info
  console.log("\n📊 Contract Info:");
  console.log("   - Staking Token:", await softStaking.stakingToken());
  console.log("   - Rewards Token:", await softStaking.rewardsToken());
  console.log("   - Owner:", await softStaking.owner());

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: network,
    chainId: hre.network.config.chainId,
    contract: "HotSparkSoftStaking",
    address: softAddress,
    hotToken: hotTokenAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    explorer: network === "bscTestnet" 
      ? `https://testnet.bscscan.com/address/${softAddress}`
      : `Local deployment`
  };

  if (!fs.existsSync("deployments")) {
    fs.mkdirSync("deployments");
  }

  const filename = `deployments/soft-staking-${network}.json`;
  fs.writeFileSync(
    filename,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n💾 Deployment info saved to:", filename);

  // Verification instructions
  console.log("\n📝 To verify contract on BSCScan:");
  console.log(`npx hardhat verify --network ${network} ${softAddress} ${hotTokenAddress}`);
  
  console.log("\n🎉 Deployment complete!");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error);
  process.exitCode = 1;
});