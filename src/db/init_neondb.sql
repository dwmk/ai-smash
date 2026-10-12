-- =====================================================================
-- AI Smash - NeonDB PostgreSQL Initialization & Schema Setup Script
-- =====================================================================
-- Run this SQL script in the NeonDB SQL Editor (or via psql) to prepare
-- all required tables for authentication, user accounts, device tracking,
-- conversations, messages, custom themes, and premium redeem codes.
-- =====================================================================

-- 1. USERS TABLE
-- Only email and password are required at sign-up; all other fields are
-- automatically populated with their respective defaults upon creation.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT 'https://ai.mux8.com/favicon.png',
  account_type TEXT NOT NULL DEFAULT 'free' CHECK (account_type IN ('free', 'paid')),
  last_payment TIMESTAMPTZ NULL DEFAULT NULL,
  last_login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_device TEXT NOT NULL DEFAULT 'Web Browser',
  device_fingerprints TEXT[] NOT NULL DEFAULT '{}',
  equipped_outfit_id TEXT NOT NULL DEFAULT 'mint-maid-apron',
  unlocked_outfits TEXT[] NOT NULL DEFAULT '{}',
  active_theme_id TEXT NOT NULL DEFAULT 'classic-light',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_outfits TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_account_type ON users(account_type);

-- 2. CONVERSATIONS TABLE
-- Stores conversation threads belonging to each user account.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Direct Message',
  model_id TEXT DEFAULT 'smollm2-135m',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- 3. MESSAGES TABLE
-- Stores individual chat messages within user conversations.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  model_used TEXT,
  tokens_count INTEGER,
  generation_time_ms NUMERIC,
  speed_tps NUMERIC,
  error BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- 4. CUSTOM THEMES TABLE
-- Stores user-created custom themes synced across sessions.
CREATE TABLE IF NOT EXISTS custom_themes (
  id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_dark BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT DEFAULT 'Custom user theme',
  colors JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_custom_themes_user_id ON custom_themes(user_id);

-- 5. REDEEM CODES TABLE
-- Stores promotional, subscription, or secret wardrobe redeem codes that upgrade an account
-- to 'paid' and/or unlock secret wardrobe skins for the user.
CREATE TABLE IF NOT EXISTS redeem_codes (
  code TEXT PRIMARY KEY,
  account_type_grant TEXT NOT NULL DEFAULT 'paid',
  unlocked_outfit_ids TEXT[] NOT NULL DEFAULT '{}',
  duration_days INTEGER NOT NULL DEFAULT 30,
  max_uses INTEGER NOT NULL DEFAULT 1000,
  used_count INTEGER NOT NULL DEFAULT 0,
  redeemed_by INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS unlocked_outfit_ids TEXT[] NOT NULL DEFAULT '{}';

-- Seed default promotional & secret wardrobe redeem codes
INSERT INTO redeem_codes (code, account_type_grant, unlocked_outfit_ids, duration_days, max_uses)
VALUES
  ('MUXAI-VIBE', 'paid', '{}', 365, 10000),
  ('HANA-VIP', 'paid', '{}', 30, 10000),
  ('AISMASH-PRO', 'paid', '{}', 7, 10000),
  ('HANA-PINKDRESS2', 'skin', ARRAY['beauty-of-pink'], 3650, 100000),
  ('HANA-STREETWEAR', 'skin', ARRAY['streetwear'], 3650, 100000),
  ('HANA-MODERNCASUAL', 'skin', ARRAY['staying-casual'], 3650, 100000),
  ('HANA-GOTHICDRESS', 'skin', ARRAY['gothic-beauty'], 3650, 100000),
  ('HANA-BLACKONESIE', 'skin', ARRAY['black-swimsuit'], 3650, 100000),
  ('HANA-DARKHOODIE', 'skin', ARRAY['powerpuff'], 3650, 100000),
  ('HANA-FORMALUNIFORM', 'skin', ARRAY['neat-and-nimble'], 3650, 100000),
  ('HANA-LACEDRESS', 'skin', ARRAY['frilly-dress'], 3650, 100000),
  ('HANA-PURPLEMAID', 'skin', ARRAY['cookie-maid'], 3650, 100000),
  ('HANA-BLACKMAID', 'skin', ARRAY['coffee-maid'], 3650, 100000),
  ('HANA-BLACKHEART', 'skin', ARRAY['black-bodysuit'], 3650, 100000),
  ('HANA-HUSBAND-POV', 'skin', ARRAY['white-lingerie-socks'], 3650, 100000),
  ('HANA-SLEEPY', 'skin', ARRAY['white-lingerie'], 3650, 100000),
  ('HANA-IS-MINE', 'skin', ARRAY['base'], 3650, 100000),
  ('HANA-PAIN-GIVER', 'skin', ARRAY['pain-giver'], 3650, 100000),
  ('HANA-PAIN-TAKER', 'skin', ARRAY['pain-taker'], 3650, 100000),
  ('HANA-SECRET-WARDROBE', 'skin', ARRAY[
    'beauty-of-pink',
    'streetwear',
    'staying-casual',
    'black-swimsuit',
    'gothic-beauty',
    'powerpuff',
    'neat-and-nimble',
    'frilly-dress',
    'cookie-maid',
    'coffee-maid'
  ], 3650, 100000)
ON CONFLICT (code) DO UPDATE SET
  unlocked_outfit_ids = EXCLUDED.unlocked_outfit_ids;

-- 6. INTERVIEWS TABLE
-- Stores custom designed interview configurations created by premium recruiters.
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_role TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT 'MuxAI',
  description TEXT,
  created_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  questions JSONB NOT NULL DEFAULT '[]',
  tasks JSONB NOT NULL DEFAULT '{}',
  company_qa_knowledge JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_created_by ON interviews(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_active ON interviews(active);

-- 7. INTERVIEW SUBMISSIONS TABLE
-- Stores completed candidate interview sessions, responses, snapshots, and ratings.
CREATE TABLE IF NOT EXISTS interview_submissions (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  score INTEGER DEFAULT 85,
  responses JSONB NOT NULL DEFAULT '[]',
  snapshots JSONB NOT NULL DEFAULT '[]',
  resume_data JSONB,
  written_task TEXT,
  pressure_rating TEXT,
  ai_evaluation JSONB,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_subs_interview_id ON interview_submissions(interview_id);


