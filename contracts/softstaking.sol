// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract HotSparkSoftStaking is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                TOKENS
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    /*//////////////////////////////////////////////////////////////
                          REWARD STATE
    //////////////////////////////////////////////////////////////*/

    uint256 public rewardRate;              // rewards per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public periodFinish;

    uint256 public totalStaked;

    // Reward accounting protection
    uint256 public rewardPool;              // total funded
    uint256 public rewardReserved;          // reserved for emission period

    /*//////////////////////////////////////////////////////////////
                             USER STATE
    //////////////////////////////////////////////////////////////*/

    mapping(address => uint256) public balances;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 duration);
    event RewardRecovered(uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAmount();
    error InsufficientBalance();
    error InvalidDuration();
    error InsufficientRewardPool();
    error CannotRecoverStakingToken();
    error CannotRecoverReservedRewards();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _stakingToken) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid token");
        stakingToken = IERC20(_stakingToken);
        rewardsToken = IERC20(_stakingToken);
    }

    /*//////////////////////////////////////////////////////////////
                          MODIFIER
    //////////////////////////////////////////////////////////////*/

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish
            ? block.timestamp
            : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;

        return rewardPerTokenStored +
            (
                (lastTimeRewardApplicable() - lastUpdateTime)
                * rewardRate
                * 1e18
                / totalStaked
            );
    }

    function earned(address account) public view returns (uint256) {
        return (
            balances[account]
            * (rewardPerToken() - userRewardPerTokenPaid[account])
            / 1e18
        ) + rewards[account];
    }

    function getAPR() external view returns (uint256) {
        if (totalStaked == 0 || rewardRate == 0) return 0;
        return (rewardRate * 365 days * 10000) / totalStaked; // basis points
    }

    function getRemainingRewardTime() external view returns (uint256) {
        if (block.timestamp >= periodFinish) return 0;
        return periodFinish - block.timestamp;
    }

    function availableRewardBalance() public view returns (uint256) {
        return rewardPool - rewardReserved;
    }

    /*//////////////////////////////////////////////////////////////
                          USER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function stake(uint256 amount)
        external
        nonReentrant
        whenNotPaused
        updateReward(msg.sender)
    {
        if (amount == 0) revert ZeroAmount();

        totalStaked += amount;
        balances[msg.sender] += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount)
        public
        nonReentrant
        updateReward(msg.sender)
    {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        totalStaked -= amount;
        balances[msg.sender] -= amount;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function claimReward()
        public
        nonReentrant
        updateReward(msg.sender)
    {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardReserved -= reward;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(balances[msg.sender]);
        claimReward();
    }

    /*//////////////////////////////////////////////////////////////
                          ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function notifyRewardAmount(uint256 reward, uint256 duration)
        external
        onlyOwner
        updateReward(address(0))
    {
        if (duration == 0) revert InvalidDuration();
        if (reward == 0) revert ZeroAmount();

        rewardsToken.safeTransferFrom(msg.sender, address(this), reward);

        rewardPool += reward;

        if (block.timestamp >= periodFinish) {
            rewardRate = reward / duration;
            rewardReserved = reward;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;

            rewardRate = (reward + leftover) / duration;
            rewardReserved = reward + leftover;
        }

        if (rewardReserved > rewardPool)
            revert InsufficientRewardPool();

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(reward, duration);
    }

    function withdrawUnusedRewards(uint256 amount)
        external
        onlyOwner
    {
        if (amount > availableRewardBalance())
            revert CannotRecoverReservedRewards();

        rewardPool -= amount;
        rewardsToken.safeTransfer(owner(), amount);

        emit RewardRecovered(amount);
    }

    function emergencyWithdraw()
        external
        nonReentrant
    {
        uint256 balance = balances[msg.sender];
        if (balance == 0) revert ZeroAmount();

        totalStaked -= balance;
        balances[msg.sender] = 0;
        rewards[msg.sender] = 0;

        stakingToken.safeTransfer(msg.sender, balance);

        emit EmergencyWithdraw(msg.sender, balance);
    }

    function recoverERC20(address token, uint256 amount)
        external
        onlyOwner
    {
        if (token == address(stakingToken))
            revert CannotRecoverStakingToken();

        IERC20(token).safeTransfer(owner(), amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}