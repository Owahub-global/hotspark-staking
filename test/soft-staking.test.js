const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HotSparkSoftStaking", function () {
  let softStaking;
  let token;
  let owner, user1, user2, user3;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const ONE_HOT = ethers.parseEther("1");
  const THOUSAND_HOT = ethers.parseEther("1000");
  const MILLION_HOT = ethers.parseEther("1000000");
  const REWARD_AMOUNT = ethers.parseEther("100000");
  const DURATION = 30 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy();
    await token.waitForDeployment();

    const SoftStaking = await ethers.getContractFactory("HotSparkSoftStaking");
    softStaking = await SoftStaking.deploy(await token.getAddress());
    await softStaking.waitForDeployment();

    const mintAmount = MILLION_HOT * 10n;

    await token.mint(owner.address, mintAmount);
    await token.mint(user1.address, mintAmount);
    await token.mint(user2.address, mintAmount);
    await token.mint(user3.address, mintAmount);

    await token.connect(owner).approve(await softStaking.getAddress(), mintAmount);
    await token.connect(user1).approve(await softStaking.getAddress(), mintAmount);
    await token.connect(user2).approve(await softStaking.getAddress(), mintAmount);
    await token.connect(user3).approve(await softStaking.getAddress(), mintAmount);
  });

  describe("Deployment", function () {
    it("Should set correct token addresses", async function () {
      expect(await softStaking.stakingToken()).to.equal(await token.getAddress());
      expect(await softStaking.rewardsToken()).to.equal(await token.getAddress());
    });

    it("Should set correct owner", async function () {
      expect(await softStaking.owner()).to.equal(owner.address);
    });

    it("Should initialize with zero values", async function () {
      expect(await softStaking.totalStaked()).to.equal(0);
      expect(await softStaking.rewardRate()).to.equal(0);
      expect(await softStaking.rewardPool()).to.equal(0);
      expect(await softStaking.rewardReserved()).to.equal(0);
    });

    it("Should revert if zero address", async function () {
      const SoftStaking = await ethers.getContractFactory("HotSparkSoftStaking");
      await expect(SoftStaking.deploy(ZERO_ADDRESS))
        .to.be.revertedWith("Invalid token");
    });
  });

  describe("Staking", function () {
    it("Should allow users to stake", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      expect(await softStaking.balances(user1.address)).to.equal(THOUSAND_HOT);
      expect(await softStaking.totalStaked()).to.equal(THOUSAND_HOT);
    });

    it("Should not allow staking zero", async function () {
      await expect(
        softStaking.connect(user1).stake(0)
      ).to.be.revertedWithCustomError(softStaking, "ZeroAmount");
    });
  });

  describe("Reward Funding", function () {
    it("Should allow owner to fund rewards", async function () {
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);

      expect(await softStaking.rewardRate()).to.be.gt(0);
      expect(await softStaking.rewardPool()).to.equal(REWARD_AMOUNT);
      expect(await softStaking.rewardReserved()).to.equal(REWARD_AMOUNT);
    });
  });

  describe("Reward Calculations", function () {
    beforeEach(async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
    });

    it("Should accumulate rewards over time", async function () {
      await time.increase(10 * 24 * 60 * 60);

      const earned = await softStaking.earned(user1.address);
      expect(earned).to.be.gt(0);
    });

    it("Should allow claiming rewards", async function () {
      await time.increase(10 * 24 * 60 * 60);

      const balanceBefore = await token.balanceOf(user1.address);
      await softStaking.connect(user1).claimReward();
      const balanceAfter = await token.balanceOf(user1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("Exit", function () {
    it("Should withdraw and claim", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      await time.increase(15 * 24 * 60 * 60);

      await softStaking.connect(user1).exit();

      expect(await softStaking.balances(user1.address)).to.equal(0);
    });
  });
});