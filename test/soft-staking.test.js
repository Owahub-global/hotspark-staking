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
  const DURATION = 30 * 24 * 60 * 60; // 30 days

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock HOT token (use your actual token contract)
    const Token = await ethers.getContractFactory("HotSpark"); // Assuming you have this
    token = await Token.deploy();
    await token.waitForDeployment();

    // Deploy soft staking
    const SoftStaking = await ethers.getContractFactory("HotSparkSoftStaking");
    softStaking = await SoftStaking.deploy(await token.getAddress());
    await softStaking.waitForDeployment();

    // Mint tokens for testing
    const mintAmount = MILLION_HOT * 10n;
    await token.mint(owner.address, mintAmount);
    await token.mint(user1.address, mintAmount);
    await token.mint(user2.address, mintAmount);
    await token.mint(user3.address, mintAmount);

    // Approve staking contract
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

    it("Should emit Staked event", async function () {
      await expect(softStaking.connect(user1).stake(THOUSAND_HOT))
        .to.emit(softStaking, "Staked")
        .withArgs(user1.address, THOUSAND_HOT);
    });

    it("Should not allow staking zero", async function () {
      await expect(softStaking.connect(user1).stake(0))
        .to.be.revertedWithCustomError(softStaking, "ZeroAmount");
    });

    it("Should not allow staking when paused", async function () {
      await softStaking.connect(owner).pause();
      
      await expect(softStaking.connect(user1).stake(THOUSAND_HOT))
        .to.be.revertedWithCustomError(softStaking, "EnforcedPause");
    });

    it("Should track multiple stakers correctly", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await softStaking.connect(user2).stake(THOUSAND_HOT * 2n);
      await softStaking.connect(user3).stake(THOUSAND_HOT * 3n);

      expect(await softStaking.totalStaked()).to.equal(THOUSAND_HOT * 6n);
      expect(await softStaking.balances(user1.address)).to.equal(THOUSAND_HOT);
      expect(await softStaking.balances(user2.address)).to.equal(THOUSAND_HOT * 2n);
      expect(await softStaking.balances(user3.address)).to.equal(THOUSAND_HOT * 3n);
    });
  });

  describe("Withdrawal", function () {
    beforeEach(async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
    });

    it("Should allow users to withdraw", async function () {
      await softStaking.connect(user1).withdraw(THOUSAND_HOT / 2n);

      expect(await softStaking.balances(user1.address)).to.equal(THOUSAND_HOT / 2n);
      expect(await softStaking.totalStaked()).to.equal(THOUSAND_HOT / 2n);
    });

    it("Should emit Withdrawn event", async function () {
      await expect(softStaking.connect(user1).withdraw(THOUSAND_HOT / 2n))
        .to.emit(softStaking, "Withdrawn")
        .withArgs(user1.address, THOUSAND_HOT / 2n);
    });

    it("Should not allow withdrawing zero", async function () {
      await expect(softStaking.connect(user1).withdraw(0))
        .to.be.revertedWithCustomError(softStaking, "ZeroAmount");
    });

    it("Should not allow withdrawing more than balance", async function () {
      await expect(softStaking.connect(user1).withdraw(THOUSAND_HOT + 1n))
        .to.be.revertedWithCustomError(softStaking, "InsufficientBalance");
    });

    it("Should allow full withdrawal", async function () {
      await softStaking.connect(user1).withdraw(THOUSAND_HOT);

      expect(await softStaking.balances(user1.address)).to.equal(0);
      expect(await softStaking.totalStaked()).to.equal(0);
    });
  });

  describe("Reward Funding", function () {
    it("Should allow owner to fund rewards", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);

      expect(await softStaking.rewardRate()).to.be.gt(0);
      expect(await softStaking.rewardPool()).to.equal(REWARD_AMOUNT);
      expect(await softStaking.rewardReserved()).to.equal(REWARD_AMOUNT);
      expect(await softStaking.periodFinish()).to.be.gt(await time.latest());
    });

    it("Should emit RewardAdded event", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      
      await expect(softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION))
        .to.emit(softStaking, "RewardAdded")
        .withArgs(REWARD_AMOUNT, DURATION);
    });

    it("Should not allow non-owner to fund rewards", async function () {
      await token.connect(user1).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      
      await expect(softStaking.connect(user1).notifyRewardAmount(REWARD_AMOUNT, DURATION))
        .to.be.revertedWithCustomError(softStaking, "OwnableUnauthorizedAccount");
    });

    it("Should revert with zero duration", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      
      await expect(softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, 0))
        .to.be.revertedWithCustomError(softStaking, "InvalidDuration");
    });

    it("Should revert with zero reward", async function () {
      await expect(softStaking.connect(owner).notifyRewardAmount(0, DURATION))
        .to.be.revertedWithCustomError(softStaking, "ZeroAmount");
    });
  });

  describe("Reward Calculations", function () {
    beforeEach(async function () {
      // Stake
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      
      // Fund rewards
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
    });

    it("Should calculate earned rewards correctly", async function () {
      // Wait 10 days
      await time.increase(10 * 24 * 60 * 60);

      const earned = await softStaking.earned(user1.address);
      expect(earned).to.be.gt(0);
      
      // Should be roughly (10/30) of reward
      const expected = (REWARD_AMOUNT * 10n * 24n * 60n * 60n) / BigInt(DURATION);
      const diff = earned > expected ? earned - expected : expected - earned;
      expect(diff).to.be.lt(ethers.parseEther("0.001"));
    });

    it("Should update rewards after claiming", async function () {
      // Wait 10 days
      await time.increase(10 * 24 * 60 * 60);
      
      const earnedBefore = await softStaking.earned(user1.address);
      await softStaking.connect(user1).claimReward();
      
      expect(await softStaking.rewards(user1.address)).to.equal(0);
      
      // Wait 5 more days
      await time.increase(5 * 24 * 60 * 60);
      
      const earnedAfter = await softStaking.earned(user1.address);
      expect(earnedAfter).to.be.gt(0);
    });

    it("Should calculate APR correctly", async function () {
      const apr = await softStaking.getAPR();
      
      // With 1000 staked and 100k/year reward, APR should be ~10,000%
      // APR in basis points: (rewardRate * 365 days * 10000) / totalStaked
      expect(apr).to.be.gt(0);
    });

    it("Should handle multiple stakers proportionally", async function () {
      // User2 stakes double
      await softStaking.connect(user2).stake(THOUSAND_HOT * 2n);
      
      // Wait 15 days
      await time.increase(15 * 24 * 60 * 60);
      
      const earned1 = await softStaking.earned(user1.address);
      const earned2 = await softStaking.earned(user2.address);
      
      // User2 should have double the rewards
      expect(earned2).to.be.closeTo(earned1 * 2n, earned1 / 100n);
    });
  });

  describe("Claiming Rewards", function () {
    beforeEach(async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      await time.increase(15 * 24 * 60 * 60);
    });

    it("Should allow users to claim rewards", async function () {
      const earned = await softStaking.earned(user1.address);
      const balanceBefore = await token.balanceOf(user1.address);
      
      await softStaking.connect(user1).claimReward();
      
      expect(await token.balanceOf(user1.address)).to.be.gt(balanceBefore);
      expect(await softStaking.rewards(user1.address)).to.equal(0);
    });

    it("Should emit RewardPaid event", async function () {
      const earned = await softStaking.earned(user1.address);
      
      await expect(softStaking.connect(user1).claimReward())
        .to.emit(softStaking, "RewardPaid")
        .withArgs(user1.address, earned);
    });

    it("Should update rewardReserved on claim", async function () {
      const reservedBefore = await softStaking.rewardReserved();
      const earned = await softStaking.earned(user1.address);
      
      await softStaking.connect(user1).claimReward();
      
      const reservedAfter = await softStaking.rewardReserved();
      expect(reservedAfter).to.equal(reservedBefore - earned);
    });
  });

  describe("Exit Function", function () {
    it("Should withdraw and claim in one transaction", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      await time.increase(15 * 24 * 60 * 60);
      
      const balanceBefore = await token.balanceOf(user1.address);
      const stakedBalance = await softStaking.balances(user1.address);
      const earned = await softStaking.earned(user1.address);
      
      await softStaking.connect(user1).exit();
      
      // Should have original stake + rewards
      expect(await token.balanceOf(user1.address)).to.equal(
        balanceBefore + stakedBalance + earned
      );
      expect(await softStaking.balances(user1.address)).to.equal(0);
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should allow emergency withdrawal without rewards", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      await time.increase(15 * 24 * 60 * 60);
      
      const balanceBefore = await token.balanceOf(user1.address);
      const stakedBalance = await softStaking.balances(user1.address);
      const earned = await softStaking.earned(user1.address);
      
      await softStaking.connect(user1).emergencyWithdraw();
      
      // Should only get stake back, no rewards
      expect(await token.balanceOf(user1.address)).to.equal(balanceBefore + stakedBalance);
      expect(await softStaking.rewards(user1.address)).to.equal(0);
      expect(await softStaking.balances(user1.address)).to.equal(0);
    });

    it("Should emit EmergencyWithdraw event", async function () {
      await softStaking.connect(user1).stake(THOUSAND_HOT);
      
      await expect(softStaking.connect(user1).emergencyWithdraw())
        .to.emit(softStaking, "EmergencyWithdraw")
        .withArgs(user1.address, THOUSAND_HOT);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to withdraw unused rewards", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT / 2n, DURATION);
      
      const available = await softStaking.availableRewardBalance();
      expect(available).to.equal(REWARD_AMOUNT / 2n);
      
      const ownerBalanceBefore = await token.balanceOf(owner.address);
      await softStaking.connect(owner).withdrawUnusedRewards(available);
      
      expect(await token.balanceOf(owner.address)).to.equal(ownerBalanceBefore + available);
    });

    it("Should not allow withdrawing reserved rewards", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      
      await expect(softStaking.connect(owner).withdrawUnusedRewards(1))
        .to.be.revertedWithCustomError(softStaking, "CannotRecoverReservedRewards");
    });

    it("Should allow owner to pause/unpause", async function () {
      await softStaking.connect(owner).pause();
      expect(await softStaking.paused()).to.be.true;
      
      await softStaking.connect(owner).unpause();
      expect(await softStaking.paused()).to.be.false;
    });
  });

  describe("View Functions", function () {
    it("Should return correct remaining reward time", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT, DURATION);
      
      const remaining = await softStaking.getRemainingRewardTime();
      expect(remaining).to.be.closeTo(DURATION, 5); // Within 5 seconds
      
      await time.increase(DURATION + 1000);
      expect(await softStaking.getRemainingRewardTime()).to.equal(0);
    });

    it("Should return correct available reward balance", async function () {
      await token.connect(owner).transfer(await softStaking.getAddress(), REWARD_AMOUNT);
      await softStaking.connect(owner).notifyRewardAmount(REWARD_AMOUNT / 2n, DURATION);
      
      const available = await softStaking.availableRewardBalance();
      expect(available).to.equal(REWARD_AMOUNT / 2n);
    });
  });
});