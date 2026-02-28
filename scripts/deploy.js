const hre = require("hardhat");

async function main() {
  console.log("🔥 Deploying HotSpark Staking Contract...");
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", hre.network.config.chainId);

  // Get HOT token address from env
  const hotTokenAddress = process.env.HOT_TOKEN_ADDRESS;
  if (!hotTokenAddress) {
    console.error("❌ Please set HOT_TOKEN_ADDRESS in .env file");
    process.exit(1);
  }

  console.log("📝 HOT Token Address:", hotTokenAddress);

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

  // Deploy staking contract
  console.log("\n📄 Deploying HotSparkStaking...");
  const Staking = await ethers.getContractFactory("HotSparkStaking");
  const staking = await Staking.deploy(hotTokenAddress);

  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();

  console.log("✅ Staking contract deployed to:", stakingAddress);
  console.log("🔍 BSCScan: https://testnet.bscscan.com/address/" + stakingAddress);

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    stakingContract: stakingAddress,
    hotToken: hotTokenAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    bscscan: `https://testnet.bscscan.com/address/${stakingAddress}`
  };

  if (!fs.existsSync("deployments")) {
    fs.mkdirSync("deployments");
  }

  fs.writeFileSync(
    `deployments/${hre.network.name}-staking.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n💾 Deployment info saved to:", `deployments/${hre.network.name}-staking.json`);
  console.log("\n📝 To verify contract:");
  console.log(`npx hardhat verify --network bscTestnet ${stakingAddress} ${hotTokenAddress}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});