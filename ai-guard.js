// =====================================================
// Guard for the AI endpoints: who is calling, and how often
// =====================================================
//
// Every AI request costs OpenAI money, and the API URL ships inside the app,
// so these endpoints cannot be open to anyone who finds them.
//
// - A request with `Authorization: Bearer <Supabase access token>` is tied to
//   that user and limited per user in the database (reward_rate_limits, the
//   same table the rewards routes use), so the limit holds across serverless
//   instances. A token that does not verify is rejected, not downgraded.
// - The iOS keyboard sends a keyboard token (`Bearer kb_...`, see
//   keyboard-tokens.js) instead; it maps to the same user and the same limits.
// - A request without a token is anonymous. The app still lets signed-out
//   users try corrections, so anonymous requests are allowed but limited per
//   IP address. That count lives in memory, so on a serverless host it is per
//   instance and only a speed bump. Set ANON_AI_REQUESTS_PER_HOUR=0 to require
//   sign-in for every AI request.

import { supabase, isSupabaseConfigured, checkRateLimit, recordRateLimitAction } from "./supabase-client.js";
import { isKeyboardToken, userForKeyboardToken } from "./keyboard-tokens.js";

const HOUR_MS = 60 * 60 * 1000;

function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const limits = {
  userPerHour: intFromEnv("AI_REQUESTS_PER_HOUR", 120),
  anonPerHour: intFromEnv("ANON_AI_REQUESTS_PER_HOUR", 20),
  maxTextChars: intFromEnv("MAX_TEXT_CHARS", 5000),
};

let warnedNoSupabase = false;

/** Sets req.user when a valid Supabase access token or keyboard token is sent. */
export async function identifyUser(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return next();

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Invalid authorization header" });
  }

  if (!isSupabaseConfigured) {
    // Local development without Supabase keys: nothing to verify against.
    if (!warnedNoSupabase) {
      console.warn("⚠️ Bearer token received but Supabase is not configured; treating AI requests as anonymous");
      warnedNoSupabase = true;
    }
    return next();
  }

  const token = header.substring(7);
  if (isKeyboardToken(token)) {
    const user = await userForKeyboardToken(token);
    if (!user) {
      // Revoked (signed out in the app) or unknown.
      return res.status(401).json({ error: "Open Bonkilingo and sign in again to keep using Correct." });
    }
    req.user = user;
    return next();
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ error: "Authentication failed" });
  }
}

// "bucket:ip" -> timestamps of requests in the last hour
const anonymousHits = new Map();

function allowAnonymous(key, max, now = Date.now()) {
  const recent = (anonymousHits.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= max) {
    anonymousHits.set(key, recent);
    return false;
  }
  recent.push(now);
  anonymousHits.set(key, recent);
  return true;
}

// Keep the map from growing without bound on a long-running server.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of anonymousHits) {
    if (!hits.some((t) => now - t < HOUR_MS)) anonymousHits.delete(key);
  }
}, 10 * 60 * 1000).unref();

/**
 * Limits requests per signed-in user (in the database), or per IP for
 * anonymous callers (in memory). Each endpoint gets its own bucket, scaled by
 * `multiplier`: language detection runs while the user types, so it needs a
 * bigger allowance than corrections.
 */
function limitAiRequests(bucket, multiplier) {
  const userMax = limits.userPerHour * multiplier;
  const anonMax = limits.anonPerHour * multiplier;
  const action = `ai:${bucket}`;

  return async function limit(req, res, next) {
    if (req.user) {
      const allowed = await checkRateLimit(req.user.id, action, userMax, 60);
      if (!allowed) {
        return res.status(429).json({ error: "You've reached the hourly limit. Please try again later." });
      }
      // Count the request without making the caller wait for the insert.
      recordRateLimitAction(req.user.id, action);
      return next();
    }

    if (anonMax === 0) {
      return res.status(401).json({ error: "Please sign in to use this feature." });
    }
    if (!allowAnonymous(`${bucket}:${req.ip}`, anonMax)) {
      return res.status(429).json({ error: "Too many requests. Sign in for a higher limit, or try again later." });
    }
    next();
  };
}

/** Middleware for an AI route: app.post(path, ...aiGuard("correct"), handler). */
export function aiGuard(bucket, { multiplier = 1 } = {}) {
  return [identifyUser, limitAiRequests(bucket, multiplier)];
}

/** Origins allowed to call the API from a browser. Native apps don't send one. */
export function corsOrigins() {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Language names come from the client and go into a prompt, so accept only
// plain names like "german" or "brazilian portuguese".
export function cleanLanguage(language) {
  if (typeof language !== "string") return null;
  const value = language.trim().toLowerCase();
  if (!value || value === "auto" || value === "unknown") return null;
  return /^[a-z][a-z -]{1,39}$/.test(value) ? value : null;
}
