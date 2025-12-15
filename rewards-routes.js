// =====================================================
// Rewards API Routes
// =====================================================

import express from "express";
import { solanaService } from "./solana.js";
import {
  supabase,
  getRewardConfig,
  addReward,
  getUserBalance,
  getRewardHistory,
  updateWalletAddress,
  createWithdrawalRequest,
  updateWithdrawalStatus,
  getWithdrawalHistory,
  checkRateLimit,
  recordRateLimitAction,
} from "./supabase-client.js";

const router = express.Router();

// =====================================================
// Middleware: Verify user authentication
// =====================================================
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.substring(7);

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: "Authentication failed" });
  }
}

// =====================================================
// GET /api/rewards/balance - Get user's token balance
// =====================================================
router.get("/balance", requireAuth, async (req, res) => {
  try {
    const balance = await getUserBalance(req.user.id);

    if (!balance) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get hot wallet status for client
    const withdrawalsEnabled = solanaService.isWithdrawalsEnabled();
    const config = await getRewardConfig();

    res.json({
      pendingBalance: balance.pendingBalance,
      totalEarned: balance.totalEarned,
      totalWithdrawn: balance.totalWithdrawn,
      walletAddress: balance.walletAddress,
      withdrawalsEnabled,
      minWithdrawal: config.min_withdrawal || 10000,
    });
  } catch (error) {
    console.error("Error getting balance:", error);
    res.status(500).json({ error: "Failed to get balance" });
  }
});

// =====================================================
// GET /api/rewards/history - Get reward history
// =====================================================
router.get("/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const history = await getRewardHistory(req.user.id, limit);
    res.json({ rewards: history });
  } catch (error) {
    console.error("Error getting history:", error);
    res.status(500).json({ error: "Failed to get reward history" });
  }
});

// =====================================================
// GET /api/rewards/config - Get reward configuration
// =====================================================
router.get("/config", async (req, res) => {
  try {
    const config = await getRewardConfig();
    res.json({ config });
  } catch (error) {
    console.error("Error getting config:", error);
    res.status(500).json({ error: "Failed to get reward config" });
  }
});

// =====================================================
// POST /api/rewards/earn - Record a reward (called after actions)
// =====================================================
router.post("/earn", requireAuth, async (req, res) => {
  try {
    const { reason, metadata } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Reason is required" });
    }

    // Rate limiting based on action type
    const rateLimits = {
      correction: { max: 50, window: 60 }, // 50 corrections per hour
      lesson_complete: { max: 20, window: 60 }, // 20 lessons per hour
      lesson_save: { max: 30, window: 60 }, // 30 saves per hour
    };

    const limit = rateLimits[reason] || { max: 100, window: 60 };
    const allowed = await checkRateLimit(req.user.id, reason, limit.max, limit.window);

    if (!allowed) {
      return res.status(429).json({
        error: "Rate limited",
        message: "Too many actions. Please try again later.",
      });
    }

    // Get reward amount from config
    const config = await getRewardConfig();
    let amount = 0;

    switch (reason) {
      case "correction":
        // Determine reward based on text length
        const wordCount = metadata?.wordCount || 0;
        if (wordCount < 10) {
          amount = config.correction_small || 100;
        } else if (wordCount < 50) {
          amount = config.correction_medium || 250;
        } else {
          amount = config.correction_large || 500;
        }
        break;
      case "lesson_complete":
        amount = config.lesson_complete || 200;
        break;
      case "lesson_save":
        amount = config.lesson_save || 100;
        break;
      case "daily_streak":
        amount = config.daily_streak_bonus || 150;
        break;
      case "weekly_streak":
        amount = config.weekly_streak_bonus || 1000;
        break;
      default:
        return res.status(400).json({ error: "Invalid reward reason" });
    }

    // Add the reward
    const result = await addReward(req.user.id, amount, reason, metadata || {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Record for rate limiting
    await recordRateLimitAction(req.user.id, reason);

    // Get updated balance
    const balance = await getUserBalance(req.user.id);

    res.json({
      success: true,
      rewardId: result.rewardId,
      amount,
      reason,
      newBalance: balance?.pendingBalance || 0,
    });
  } catch (error) {
    console.error("Error earning reward:", error);
    res.status(500).json({ error: "Failed to record reward" });
  }
});

// =====================================================
// POST /api/rewards/wallet - Update wallet address
// =====================================================
router.post("/wallet", requireAuth, async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address is required" });
    }

    // Validate Solana address
    if (!solanaService.isValidAddress(walletAddress)) {
      return res.status(400).json({ error: "Invalid Solana wallet address" });
    }

    const result = await updateWalletAddress(req.user.id, walletAddress);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, walletAddress });
  } catch (error) {
    console.error("Error updating wallet:", error);
    res.status(500).json({ error: "Failed to update wallet address" });
  }
});

// =====================================================
// POST /api/rewards/withdraw - Request withdrawal
// =====================================================
router.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Check if withdrawals are enabled
    if (!solanaService.isWithdrawalsEnabled()) {
      return res.status(503).json({ error: "Withdrawals are temporarily disabled" });
    }

    // Rate limit withdrawals (max 5 per day)
    const allowed = await checkRateLimit(req.user.id, "withdrawal", 5, 1440);
    if (!allowed) {
      return res.status(429).json({ error: "Maximum withdrawal requests exceeded. Try again tomorrow." });
    }

    // Get user balance and wallet
    const balance = await getUserBalance(req.user.id);

    if (!balance) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!balance.walletAddress) {
      return res.status(400).json({ error: "No wallet address set. Please add your Solana wallet first." });
    }

    // Check minimum withdrawal
    const config = await getRewardConfig();
    const minWithdrawal = config.min_withdrawal || 10000;

    if (amount < minWithdrawal) {
      return res.status(400).json({ error: `Minimum withdrawal is ${minWithdrawal} BONK` });
    }

    // Check sufficient balance
    if (amount > balance.pendingBalance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create withdrawal request
    const request = await createWithdrawalRequest(req.user.id, balance.walletAddress, amount);

    if (!request.success) {
      return res.status(500).json({ error: request.error });
    }

    // Record for rate limiting
    await recordRateLimitAction(req.user.id, "withdrawal");

    // Process withdrawal immediately (or queue for batch processing)
    processWithdrawal(request.request);

    res.json({
      success: true,
      requestId: request.request.id,
      amount,
      walletAddress: balance.walletAddress,
      status: "pending",
      message: "Withdrawal request submitted. Processing may take a few minutes.",
    });
  } catch (error) {
    console.error("Error requesting withdrawal:", error);
    res.status(500).json({ error: "Failed to process withdrawal request" });
  }
});

// =====================================================
// GET /api/rewards/withdrawals - Get withdrawal history
// =====================================================
router.get("/withdrawals", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await getWithdrawalHistory(req.user.id, limit);
    res.json({ withdrawals: history });
  } catch (error) {
    console.error("Error getting withdrawals:", error);
    res.status(500).json({ error: "Failed to get withdrawal history" });
  }
});

// =====================================================
// GET /api/rewards/status - System status (public)
// =====================================================
router.get("/status", async (req, res) => {
  try {
    const withdrawalsEnabled = solanaService.isWithdrawalsEnabled();
    let hotWalletBalance = null;

    if (withdrawalsEnabled) {
      hotWalletBalance = await solanaService.getHotWalletBonkBalance();
    }

    res.json({
      withdrawalsEnabled,
      hotWalletBalance: hotWalletBalance !== null ? Math.floor(hotWalletBalance) : null,
      network: process.env.SOLANA_NETWORK || "mainnet",
    });
  } catch (error) {
    console.error("Error getting status:", error);
    res.status(500).json({ error: "Failed to get system status" });
  }
});

// =====================================================
// Background: Process withdrawal
// =====================================================
async function processWithdrawal(withdrawalRequest) {
  const { id, wallet_address, amount } = withdrawalRequest;

  try {
    // Mark as processing
    await updateWithdrawalStatus(id, "processing");

    // Convert internal BONK units to actual BONK tokens
    // Assuming 1 internal unit = 1 BONK token (adjust if using different scaling)
    const tokenAmount = amount;

    // Transfer tokens
    const result = await solanaService.transferBonk(wallet_address, tokenAmount);

    if (result.success) {
      await updateWithdrawalStatus(id, "completed", result.signature);
      console.log(`✓ Withdrawal ${id} completed: ${result.signature}`);
    } else {
      await updateWithdrawalStatus(id, "failed", null, result.error);
      console.error(`✗ Withdrawal ${id} failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`Error processing withdrawal ${id}:`, error);
    await updateWithdrawalStatus(id, "failed", null, error.message);
  }
}

export default router;

