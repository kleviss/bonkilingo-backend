-- =====================================================
-- Keyboard tokens (Bonkilingo iOS keyboard, roadmap Phase 3)
-- =====================================================
--
-- The keyboard extension can't use the app's Supabase session: refresh
-- tokens are single-use, so the app and the keyboard refreshing the same
-- session would sign each other out. Instead the app asks the backend for
-- a long-lived, revocable keyboard token after sign-in and shares it with
-- the keyboard through the Keychain.
--
-- Only a SHA-256 hash of each token is stored. Only the backend (service
-- role) reads or writes this table, so RLS is on with no policies.
--
-- Run once in the Supabase SQL editor (safe to run again).

create table if not exists keyboard_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_keyboard_tokens_user_active
  on keyboard_tokens (user_id)
  where revoked_at is null;

alter table keyboard_tokens enable row level security;
