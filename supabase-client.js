// =====================================================
// Supabase Client for Backend
// =====================================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("⚠️ Supabase credentials not set - database features disabled");
}

// Create Supabase client with service role key (bypasses RLS)
export const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// =====================================================
// Reward Configuration Cache
// =====================================================
let rewardConfigCache = null;
let configLastFetched = 0;
const CONFIG_CACHE_TTL = 60000; // 1 minute

export async function getRewardConfig() {
  const now = Date.now();

  if (rewardConfigCache && now - configLastFetched < CONFIG_CACHE_TTL) {
    return rewardConfigCache;
  }

  try {
    const { data, error } = await supabase.from("reward_config").select("*").eq("active", true);

    if (error) throw error;

    rewardConfigCache = data.reduce((acc, item) => {
      acc[item.id] = item.amount;
      return acc;
    }, {});
    configLastFetched = now;

    return rewardConfigCache;
  } catch (error) {
    console.error("Failed to fetch reward config:", error);
    // Return defaults if fetch fails
    return {
      correction_small: 100,
      correction_medium: 250,
      correction_large: 500,
      lesson_complete: 200,
      lesson_save: 100,
      daily_streak_bonus: 150,
      weekly_streak_bonus: 1000,
      referral_bonus: 5000,
      min_withdrawal: 10000,
    };
  }
}

// =====================================================
// User Reward Functions
// =====================================================

/**
 * Add a reward for a user
 */
export async function addReward(userId, amount, reason, metadata = {}) {
  try {
    const { data, error } = await supabase.rpc("add_token_reward", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_token_type: "BONK",
      p_metadata: metadata,
    });

    if (error) throw error;
    return { success: true, rewardId: data };
  } catch (error) {
    console.error("Failed to add reward:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's token balance
 */
export async function getUserBalance(userId) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("pending_token_balance, total_tokens_earned, total_tokens_withdrawn, solana_wallet_address")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return {
      pendingBalance: data.pending_token_balance || 0,
      totalEarned: data.total_tokens_earned || 0,
      totalWithdrawn: data.total_tokens_withdrawn || 0,
      walletAddress: data.solana_wallet_address,
    };
  } catch (error) {
    console.error("Failed to get user balance:", error);
    return null;
  }
}

/**
 * Get user's reward history
 */
export async function getRewardHistory(userId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from("token_rewards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Failed to get reward history:", error);
    return [];
  }
}

/**
 * Update user's wallet address
 */
export async function updateWalletAddress(userId, walletAddress) {
  try {
    const { error } = await supabase.from("profiles").update({ solana_wallet_address: walletAddress }).eq("id", userId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error("Failed to update wallet address:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Create withdrawal request
 */
export async function createWithdrawalRequest(userId, walletAddress, amount) {
  try {
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .insert({
        user_id: userId,
        wallet_address: walletAddress,
        amount: amount,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, request: data };
  } catch (error) {
    console.error("Failed to create withdrawal request:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update withdrawal status
 */
export async function updateWithdrawalStatus(requestId, status, txSignature = null, errorMessage = null) {
  try {
    const updates = {
      status,
      processed_at: status === "completed" || status === "failed" ? new Date().toISOString() : null,
    };

    if (txSignature) updates.tx_signature = txSignature;
    if (errorMessage) updates.error_message = errorMessage;

    const { error } = await supabase.from("withdrawal_requests").update(updates).eq("id", requestId);

    if (error) throw error;

    // If completed, update user balance
    if (status === "completed" && txSignature) {
      await supabase.rpc("complete_withdrawal", {
        p_withdrawal_id: requestId,
        p_tx_signature: txSignature,
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update withdrawal status:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get pending withdrawals (for processing)
 */
export async function getPendingWithdrawals() {
  try {
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Failed to get pending withdrawals:", error);
    return [];
  }
}

/**
 * Get user's withdrawal history
 */
export async function getWithdrawalHistory(userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Failed to get withdrawal history:", error);
    return [];
  }
}

// =====================================================
// Rate Limiting Functions
// =====================================================

/**
 * Check if user can perform action (rate limiting)
 */
export async function checkRateLimit(userId, actionType, maxActions = 10, windowMinutes = 60) {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action_type: actionType,
      p_max_actions: maxActions,
      p_window_minutes: windowMinutes,
    });

    if (error) throw error;
    return data; // true if allowed, false if rate limited
  } catch (error) {
    console.error("Rate limit check failed:", error);
    return true; // Allow on error (fail open)
  }
}

/**
 * Record an action for rate limiting
 */
export async function recordRateLimitAction(userId, actionType) {
  try {
    await supabase.rpc("record_rate_limit_action", {
      p_user_id: userId,
      p_action_type: actionType,
    });
  } catch (error) {
    console.error("Failed to record rate limit action:", error);
  }
}
