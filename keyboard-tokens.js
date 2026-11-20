// =====================================================
// Keyboard tokens: how the iOS keyboard extension signs in
// =====================================================
//
// The app (signed in with Supabase) asks for a token with
// POST /api/keyboard/token and stores it in the Keychain it shares with the
// keyboard. The keyboard sends it as `Authorization: Bearer kb_...` on the AI
// endpoints. Sign-out revokes it with DELETE /api/keyboard/token.
//
// Tokens are random 256-bit values; only their SHA-256 hash is stored
// (supabase/keyboard_tokens.sql). A plain hash is enough for values with
// that much entropy, and it allows a direct lookup.

import crypto from "node:crypto";
import express from "express";
import { supabase, isSupabaseConfigured } from "./supabase-client.js";

export const KEYBOARD_TOKEN_PREFIX = "kb_";

// A user can have the keyboard on a few devices; beyond this the oldest
// active tokens are revoked when a new one is issued.
const MAX_ACTIVE_TOKENS_PER_USER = 5;

// last_used_at is only rewritten when it is older than this, so a busy
// keyboard doesn't write to the database on every correction.
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return KEYBOARD_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function isKeyboardToken(token) {
  return typeof token === "string" && token.startsWith(KEYBOARD_TOKEN_PREFIX);
}

/**
 * The user a keyboard token belongs to, or null if it is unknown or revoked.
 * @returns {Promise<{id: string} | null>}
 */
export async function userForKeyboardToken(token) {
  if (!isSupabaseConfigured || !isKeyboardToken(token)) return null;

  const { data, error } = await supabase
    .from("keyboard_tokens")
    .select("id, user_id, last_used_at")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("Keyboard token lookup failed:", error.message);
    return null;
  }
  if (!data) return null;

  const lastUsed = data.last_used_at ? Date.parse(data.last_used_at) : 0;
  if (Date.now() - lastUsed > LAST_USED_RESOLUTION_MS) {
    // Not awaited: the request doesn't depend on it.
    supabase
      .from("keyboard_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(({ error: updateError }) => {
        if (updateError) console.error("Keyboard token last_used_at update failed:", updateError.message);
      });
  }
  return { id: data.user_id };
}

function bearer(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.substring(7) : null;
}

const router = express.Router();

router.use((req, res, next) => {
  if (!isSupabaseConfigured) {
    return res.status(503).json({ error: "Keyboard sign-in is not configured on the server" });
  }
  next();
});

// POST /api/keyboard/token: issue a token for the signed-in user.
// Needs the user's Supabase access token (not a keyboard token).
router.post("/token", async (req, res) => {
  const accessToken = bearer(req);
  if (!accessToken || isKeyboardToken(accessToken)) {
    return res.status(401).json({ error: "Sign in to Bonkilingo first." });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }

    const token = newToken();
    const { error: insertError } = await supabase
      .from("keyboard_tokens")
      .insert({ user_id: user.id, token_hash: hashToken(token) });
    if (insertError) throw insertError;

    // Keep only the newest few active tokens.
    const { data: active, error: listError } = await supabase
      .from("keyboard_tokens")
      .select("id")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (listError) throw listError;
    const stale = (active ?? []).slice(MAX_ACTIVE_TOKENS_PER_USER).map((row) => row.id);
    if (stale.length > 0) {
      await supabase
        .from("keyboard_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", stale);
    }

    // The only time the token is ever returned.
    res.status(201).json({ token });
  } catch (error) {
    console.error("Issuing keyboard token failed:", error.message);
    res.status(500).json({ error: "Couldn't set up the keyboard. Try again." });
  }
});

// DELETE /api/keyboard/token: revoke the presented keyboard token
// (the app calls this on sign-out). Unknown tokens succeed too, so the call
// is safe to repeat.
router.delete("/token", async (req, res) => {
  const token = bearer(req);
  if (!isKeyboardToken(token)) {
    return res.status(400).json({ error: "Send the keyboard token to revoke." });
  }

  try {
    const { error } = await supabase
      .from("keyboard_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashToken(token))
      .is("revoked_at", null);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error("Revoking keyboard token failed:", error.message);
    res.status(500).json({ error: "Couldn't revoke the keyboard token." });
  }
});

export default router;
