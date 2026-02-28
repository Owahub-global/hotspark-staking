// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title HotSparkStaking
 * @dev Professional staking contract with fixed APR, time-based rewards
 * 
 * Features:
 * - Stake HOT tokens to earn rewards
 * - Rewards calculated per second
 * - No inflation - rewards funded by owner
 * - Pausable for emergencies
 * - Reentrancy protected
 */
contract HotSparkStaking is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // Tokens
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    // Reward parameters
    uint256 public rewardRate;           // Tokens per second
    uint256 public lastUpdateTime;        // Last time rewards were updated
    uint256 public rewardPerTokenStored;  // Accumulated rewards per token (scaled by 1e18)
    uint256 public periodFinish;          // End of current reward period

    // Staking totals
    uint256 public totalStaked;

    // User data
    mapping(address => uint256) public balances;                    // Amount staked by user
    mapping(address => uint256) public userRewardPerTokenPaid;      // User's stored reward per token
    mapping(address => uint256) public rewards;                      // User's pending rewards

    // Events
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 duration);
    event RewardsRecovered(address token, uint256 amount);

    // Custom errors
    error HotSparkStaking__ZeroAmount();
    error HotSparkStaking__InsufficientBalance();
    error HotSparkStaking__InvalidDuration();
    error HotSparkStaking__InsufficientRewardBalance();

    /**
     * @dev Constructor
     * @param _stakingToken Address of token to stake (HOT)
     */
    constructor(address _stakingToken) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        rewardsToken = IERC20(_stakingToken); // Same token for rewards
    }

    /**
     * @dev Modifier to update rewards for an account
     */
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @dev Returns the last time rewards were applicable
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * @dev Returns the current reward per token accumulated
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }

        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) 
            * rewardRate 
            * 1e18 
            / totalStaked
        );
    }

    /**
     * @dev Returns the earned rewards for an account
     * @param account Address to check
     */
    function earned(address account) public view returns (uint256) {
        return (
            balances[account] 
            * (rewardPerToken() - userRewardPerTokenPaid[account]) 
            / 1e18
        ) + rewards[account];
    }

    /**
     * @dev Stake tokens
     * @param amount Amount of tokens to stake
     */
    function stake(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        updateReward(msg.sender) 
    {
        if (amount == 0) revert HotSparkStaking__ZeroAmount();

        totalStaked += amount;
        balances[msg.sender] += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Withdraw staked tokens
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) 
        public 
        nonReentrant 
        updateReward(msg.sender) 
    {
        if (amount == 0) revert HotSparkStaking__ZeroAmount();
        if (balances[msg.sender] < amount) revert HotSparkStaking__InsufficientBalance();

        totalStaked -= amount;
        balances[msg.sender] -= amount;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Claim earned rewards
     */
    function claimReward() 
        public 
        nonReentrant 
        updateReward(msg.sender) 
    {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @dev Withdraw all tokens and claim rewards
     */
    function exit() external {
        withdraw(balances[msg.sender]);
        claimReward();
    }

    /**
     * @dev Add rewards to the staking contract
     * @param reward Amount of rewards to add
     * @param duration Duration in seconds for reward distribution
     */
    function notifyRewardAmount(uint256 reward, uint256 duration) 
        external 
        onlyOwner 
        updateReward(address(0)) 
    {
        if (duration == 0) revert HotSparkStaking__InvalidDuration();

        // Transfer rewards to contract
        rewardsToken.safeTransferFrom(msg.sender, address(this), reward);

        // Calculate new reward rate
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / duration;
        }

        // Check if we have enough balance
        uint256 balance = rewardsToken.balanceOf(address(this));
        if (rewardRate > balance / duration) {
            revert HotSparkStaking__InsufficientRewardBalance();
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(reward, duration);
    }

    /**
     * @dev Recover accidentally sent tokens (not rewards)
     * @param token Address of token to recover
     */
    function recoverERC20(address token) external onlyOwner {
        IERC20(token).safeTransfer(
            owner(), 
            IERC20(token).balanceOf(address(this))
        );
        emit RewardsRecovered(token, IERC20(token).balanceOf(address(this)));
    }

    /**
     * @dev Pause staking (emergency)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause staking
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Returns staked balance of user
     */
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    /**
     * @dev Returns current APR in basis points (1% = 100 basis points)
     */
    function getAPR() external view returns (uint256) {
        if (totalStaked == 0 || rewardRate == 0) return 0;
        
        // APR = (rewardRate * 365 days * 1e4) / totalStaked
        // Multiply by 10000 for basis points
        return (rewardRate * 365 days * 10000) / totalStaked;
    }
}