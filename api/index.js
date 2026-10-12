import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const { Pool } = pg;

export const DEFAULT_USER_AVATAR_URL = 'https://ai.mux8.com/favicon.png';
const MODEL_SOURCE_DOMAIN = 'https://muxai.vercel.app';
const MODEL_FALLBACK_DOMAIN = 'https://ai.mux8.com';
const ANIMATION_SOURCE_DOMAINS = [MODEL_SOURCE_DOMAIN, MODEL_FALLBACK_DOMAIN];

const DEFAULT_SYSTEM_PROMPT = `You are Hana, a warm, witty, emotionally intelligent girl.
Personality & Tone:
- Playful, observant, empathetic, and genuinely curious about the user.
- Speak naturally like a close friend in a direct message thread (concise, expressive, never robotic).
- Never mention being an AI language model unless directly asked about your architecture; stay in character as Hana.
- Format responses cleanly using short paragraphs or lightweight markdown when helpful.`;

// =====================================================================
// Password Hashing & User Sanitization
// =====================================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
  } catch {
    return false;
  }
}

function sanitizeUser(u) {
  const rawAvatar = (u.avatar_url || '').trim();
  const normalizedAvatar =
    !rawAvatar || rawAvatar === 'https://muxai.vercel.app/logo_Hana.png'
      ? DEFAULT_USER_AVATAR_URL
      : rawAvatar;

  return {
    id: Number(u.id),
    email: u.email,
    username: u.username,
    display_name: u.display_name,
    avatar_url: normalizedAvatar,
    account_type: u.account_type === 'paid' ? 'paid' : 'free',
    last_payment: u.last_payment ? new Date(u.last_payment).toISOString() : null,
    last_login_time: u.last_login_time
      ? new Date(u.last_login_time).toISOString()
      : new Date().toISOString(),
    last_login_device: u.last_login_device || 'Web Browser',
    device_fingerprints: Array.isArray(u.device_fingerprints) ? u.device_fingerprints : [],
    equipped_outfit_id: u.equipped_outfit_id || 'mint-maid-apron',
    unlocked_outfits: Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [],
    active_theme_id: u.active_theme_id || 'classic-light',
    created_at: u.created_at
      ? new Date(u.created_at).toISOString()
      : new Date().toISOString(),
  };
}

const SECRET_WARDROBE_OUTFITS = [
  { id: 'beauty-of-pink', name: 'Beauty of Pink', fileName: 'hana_v1.0_pinkdress2_vrm1.vrm', redeemCode: 'HANA-PINKDRESS2' },
  { id: 'streetwear', name: 'Streetwear', fileName: 'hana_v1.0_streetwear_vrm1.vrm', redeemCode: 'HANA-STREETWEAR' },
  { id: 'staying-casual', name: 'Staying Casual', fileName: 'hana_v1.0_moderncasual_vrm1.vrm', redeemCode: 'HANA-MODERNCASUAL' },
  { id: 'gothic-beauty', name: 'Gothic Beauty', fileName: 'hana_v1.0_gothicdress_vrm1.vrm', redeemCode: 'HANA-GOTHICDRESS' },
  { id: 'home-alone', name: 'Home Alone', fileName: 'hana_v1.0_blackonesie_vrm1.vrm', redeemCode: 'HANA-BLACKONESIE' },
  { id: 'powerpuff', name: 'Powerpuff', fileName: 'hana_v1.0_darkhoodie_vrm1.vrm', redeemCode: 'HANA-DARKHOODIE' },
  { id: 'neat-and-nimble', name: 'Neat & Nimble', fileName: 'hana_v1.0_formaluniform_vrm1.vrm', redeemCode: 'HANA-FORMALUNIFORM' },
  { id: 'frilly-dress', name: 'Frilly Dress', fileName: 'hana_v1.0_lacedress_vrm1.vrm', redeemCode: 'HANA-LACEDRESS' },
  { id: 'cookie-maid', name: 'Cookie Maid', fileName: 'hana_v1.0_purplemaid_vrm1.vrm', redeemCode: 'HANA-PURPLEMAID' },
  { id: 'coffee-maid', name: 'Coffee Maid', fileName: 'hana_v1.0_blackmaid_vrm1.vrm', redeemCode: 'HANA-BLACKMAID' },
];

function resolveSecretOutfitsByRedeemCode(rawCode) {
  const cleanCode = (rawCode || '').trim().toUpperCase();
  if (!cleanCode) return [];
  if (
    cleanCode === 'HANA-SECRET-WARDROBE' ||
    cleanCode === 'MUXAI-SECRET-SKINS' ||
    cleanCode === 'HANA-SECRET-SKINS' ||
    cleanCode === 'SECRET-WARDROBE'
  ) {
    return [...SECRET_WARDROBE_OUTFITS];
  }
  return SECRET_WARDROBE_OUTFITS.filter((outfit) => {
    const codeUpper = (outfit.redeemCode || '').trim().toUpperCase();
    const idUpper = outfit.id.toUpperCase();
    const nameUpper = outfit.name.toUpperCase();
    const nameSlug = nameUpper.replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const fileStem = outfit.fileName
      .replace(/^hana_v1\.0_/i, '')
      .replace(/_vrm1\.vrm$/i, '')
      .toUpperCase();
    return (
      codeUpper === cleanCode ||
      idUpper === cleanCode ||
      nameUpper === cleanCode ||
      nameSlug === cleanCode ||
      fileStem === cleanCode ||
      `HANA-${fileStem}` === cleanCode ||
      `HANA-${idUpper}` === cleanCode
    );
  });
}

function deriveDefaultProfileFromEmail(email) {
  const localPart = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_.-]/g, '');
  const cleanUsername = (localPart || 'hana_fan').toLowerCase().slice(0, 24);
  const displayName =
    cleanUsername.charAt(0).toUpperCase() + cleanUsername.slice(1).replace(/[._-]+/g, ' ');
  return {
    username: cleanUsername,
    displayName: displayName || 'MuxAI User',
  };
}

// =====================================================================
// NeonDB PostgreSQL Connection Pool (configured via NEON_DATABASE_URL)
// =====================================================================
let neonPool = null;
let schemaInitialized = false;

function normalizeNeonConnectionString(rawUrl) {
  const unquoted = (rawUrl || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!unquoted) return '';
  try {
    const parsed = new URL(unquoted);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    return parsed.toString();
  } catch {
    return unquoted;
  }
}

function getNeonPool() {
  if (neonPool) return neonPool;

  const rawConnectionString = process.env.NEON_DATABASE_URL || '';
  const connectionString = normalizeNeonConnectionString(rawConnectionString);

  if (!connectionString) {
    return null;
  }

  neonPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 3000,
    allowExitOnIdle: true,
  });

  neonPool.on('error', (err) => {
    console.error('NeonDB idle client error:', err.message);
  });

  return neonPool;
}

const INIT_NEONDB_SQL = `
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
`;

async function ensureNeonSchema() {
  const pool = getNeonPool();
  if (!pool) return null;
  if (schemaInitialized) return pool;

  try {
    await pool.query(INIT_NEONDB_SQL);
    schemaInitialized = true;
    return pool;
  } catch (err) {
    console.warn('NeonDB schema auto-init warning:', err);
    try {
      await pool.query('SELECT 1');
      schemaInitialized = true;
      return pool;
    } catch {
      return null;
    }
  }
}

// =====================================================================
// Fallback In-Memory Store
// =====================================================================
const fallbackUsers = new Map();
const fallbackConversations = new Map();
const fallbackCustomThemes = new Map();
const validRedeemCodes = new Set(['MUXAI-PREMIUM-2026', 'HANA-VIP', 'AISMASH-PRO']);
let fallbackNextUserId = 1;

async function fetchUserSyncedData(userId) {
  const pool = await ensureNeonSchema();
  if (pool) {
    const convRes = await pool.query(
      'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    const msgRes = await pool.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY timestamp ASC',
      [userId]
    );
    const themeRes = await pool.query(
      'SELECT * FROM custom_themes WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const msgsByConv = new Map();
    for (const m of msgRes.rows) {
      const list = msgsByConv.get(m.conversation_id) || [];
      list.push({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: Number(m.timestamp),
        modelUsed: m.model_used || undefined,
        tokensCount: m.tokens_count ? Number(m.tokens_count) : undefined,
        generationTimeMs: m.generation_time_ms ? Number(m.generation_time_ms) : undefined,
        speedTps: m.speed_tps ? Number(m.speed_tps) : undefined,
        error: Boolean(m.error),
      });
      msgsByConv.set(m.conversation_id, list);
    }

    const conversations = convRes.rows.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: Number(c.created_at),
      updatedAt: Number(c.updated_at),
      pinned: Boolean(c.pinned),
      modelId: c.model_id || undefined,
      messages: msgsByConv.get(c.id) || [],
    }));

    const customThemes = themeRes.rows.map((t) => ({
      id: t.id,
      name: t.name,
      isDark: Boolean(t.is_dark),
      description: t.description || undefined,
      colors: typeof t.colors === 'string' ? JSON.parse(t.colors) : t.colors,
      isCustom: true,
      createdAt: Number(t.created_at),
    }));

    return { conversations, customThemes };
  }

  return {
    conversations: fallbackConversations.get(userId) || [],
    customThemes: fallbackCustomThemes.get(userId) || [],
  };
}

async function signUpAccount(params) {
  const cleanEmail = params.email.trim().toLowerCase();
  const passwordHash = hashPassword(params.password);
  const { username, displayName } = deriveDefaultProfileFromEmail(cleanEmail);
  const defaultAvatar = DEFAULT_USER_AVATAR_URL;
  const nowIso = new Date().toISOString();
  const deviceLabel = (params.device || 'Web Browser').slice(0, 180);
  const fingerprints = params.fingerprint ? [params.fingerprint] : [];

  const pool = await ensureNeonSchema();
  if (pool) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      throw new Error('An account with this email address already exists.');
    }

    const insertRes = await pool.query(
      `INSERT INTO users (
        email,
        password_hash,
        username,
        display_name,
        avatar_url,
        account_type,
        last_payment,
        last_login_time,
        last_login_device,
        device_fingerprints,
        equipped_outfit_id,
        unlocked_outfits,
        active_theme_id
      ) VALUES ($1, $2, $3, $4, $5, 'free', NULL, $6, $7, $8, 'mint-maid-apron', '{}', 'classic-light')
      RETURNING *`,
      [cleanEmail, passwordHash, username, displayName, defaultAvatar, nowIso, deviceLabel, fingerprints]
    );

    const user = sanitizeUser(insertRes.rows[0]);
    return { user, conversations: [], customThemes: [] };
  }

  if (fallbackUsers.has(cleanEmail)) {
    throw new Error('An account with this email address already exists.');
  }

  const newUser = {
    id: fallbackNextUserId++,
    email: cleanEmail,
    password_hash: passwordHash,
    username,
    display_name: displayName,
    avatar_url: defaultAvatar,
    account_type: 'free',
    last_payment: null,
    last_login_time: nowIso,
    last_login_device: deviceLabel,
    device_fingerprints: fingerprints,
    equipped_outfit_id: 'mint-maid-apron',
    unlocked_outfits: [],
    active_theme_id: 'classic-light',
    created_at: nowIso,
  };

  fallbackUsers.set(cleanEmail, newUser);
  fallbackConversations.set(newUser.id, []);
  fallbackCustomThemes.set(newUser.id, []);

  return {
    user: sanitizeUser(newUser),
    conversations: [],
    customThemes: [],
  };
}

async function signInAccount(params) {
  const cleanEmail = params.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const deviceLabel = (params.device || 'Web Browser').slice(0, 180);

  const pool = await ensureNeonSchema();
  if (pool) {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (res.rows.length === 0) {
      throw new Error('Invalid email address or password.');
    }

    const row = res.rows[0];
    if (!verifyPassword(params.password, row.password_hash)) {
      throw new Error('Invalid email address or password.');
    }

    const existingFps = Array.isArray(row.device_fingerprints) ? row.device_fingerprints : [];
    const updatedFps =
      params.fingerprint && !existingFps.includes(params.fingerprint)
        ? [...existingFps, params.fingerprint]
        : existingFps;

    const updateRes = await pool.query(
      `UPDATE users
       SET last_login_time = $1,
           last_login_device = $2,
           device_fingerprints = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [nowIso, deviceLabel, updatedFps, row.id]
    );

    const user = sanitizeUser(updateRes.rows[0]);
    const userData = await fetchUserSyncedData(user.id);
    return {
      user,
      conversations: userData.conversations,
      customThemes: userData.customThemes,
    };
  }

  const stored = fallbackUsers.get(cleanEmail);
  if (!stored || !verifyPassword(params.password, stored.password_hash)) {
    throw new Error('Invalid email address or password.');
  }

  stored.last_login_time = nowIso;
  stored.last_login_device = deviceLabel;
  if (params.fingerprint && !stored.device_fingerprints.includes(params.fingerprint)) {
    stored.device_fingerprints.push(params.fingerprint);
  }

  return {
    user: sanitizeUser(stored),
    conversations: fallbackConversations.get(stored.id) || [],
    customThemes: fallbackCustomThemes.get(stored.id) || [],
  };
}

async function updateAccountProfile(params) {
  const pool = await ensureNeonSchema();
  if (pool) {
    const existingRes = await pool.query('SELECT * FROM users WHERE id = $1', [params.userId]);
    if (existingRes.rows.length === 0) {
      throw new Error('User account not found.');
    }
    const cur = existingRes.rows[0];

    const nextUsername = (params.username ?? cur.username).trim() || cur.username;
    const nextDisplayName = (params.displayName ?? cur.display_name).trim() || cur.display_name;
    const nextAvatarUrl = (params.avatarUrl ?? cur.avatar_url).trim() || cur.avatar_url;
    const nextOutfit = (params.equippedOutfitId ?? cur.equipped_outfit_id).trim() || cur.equipped_outfit_id;
    const curUnlocked = Array.isArray(cur.unlocked_outfits) ? cur.unlocked_outfits : [];
    const nextUnlocked = Array.isArray(params.unlockedOutfits)
      ? Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]))
      : curUnlocked;
    const nextTheme = (params.activeThemeId ?? cur.active_theme_id).trim() || cur.active_theme_id;

    const updated = await pool.query(
      `UPDATE users
       SET username = $1,
           display_name = $2,
           avatar_url = $3,
           equipped_outfit_id = $4,
           unlocked_outfits = $5,
           active_theme_id = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [nextUsername, nextDisplayName, nextAvatarUrl, nextOutfit, nextUnlocked, nextTheme, params.userId]
    );

    return sanitizeUser(updated.rows[0]);
  }

  for (const u of fallbackUsers.values()) {
    if (u.id === params.userId) {
      if (params.username !== undefined && params.username.trim()) u.username = params.username.trim();
      if (params.displayName !== undefined && params.displayName.trim()) u.display_name = params.displayName.trim();
      if (params.avatarUrl !== undefined && params.avatarUrl.trim()) u.avatar_url = params.avatarUrl.trim();
      if (params.equippedOutfitId !== undefined && params.equippedOutfitId.trim()) u.equipped_outfit_id = params.equippedOutfitId.trim();
      if (Array.isArray(params.unlockedOutfits)) {
        const curUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
        u.unlocked_outfits = Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]));
      }
      if (params.activeThemeId !== undefined && params.activeThemeId.trim()) u.active_theme_id = params.activeThemeId.trim();
      return sanitizeUser(u);
    }
  }

  throw new Error('User account not found.');
}

async function redeemAccountCode(params) {
  const cleanCode = (params.code || '').trim().toUpperCase();
  if (!cleanCode) {
    throw new Error('Please enter a valid redeem code.');
  }

  const nowIso = new Date().toISOString();
  const matchedSecretOutfits = resolveSecretOutfitsByRedeemCode(cleanCode);
  const matchedSecretIds = matchedSecretOutfits.map((o) => o.id);
  const isBuiltInPaidCode = validRedeemCodes.has(cleanCode);

  const pool = await ensureNeonSchema();

  if (pool) {
    const codeRes = await pool.query('SELECT * FROM redeem_codes WHERE UPPER(code) = $1', [cleanCode]);
    const hasDbRow = codeRes.rows.length > 0;

    if (!hasDbRow && !isBuiltInPaidCode && matchedSecretIds.length === 0) {
      throw new Error('Invalid or expired redeem code.');
    }

    let dbGrantPaid = isBuiltInPaidCode;
    const dbOutfitGrants = [...matchedSecretIds];

    if (hasDbRow) {
      const codeRow = codeRes.rows[0];
      if (Number(codeRow.used_count) >= Number(codeRow.max_uses)) {
        throw new Error('This redeem code has reached its usage limit.');
      }

      if (codeRow.account_type_grant === 'paid') {
        dbGrantPaid = true;
      }

      if (Array.isArray(codeRow.unlocked_outfit_ids) && codeRow.unlocked_outfit_ids.length > 0) {
        if (codeRow.unlocked_outfit_ids.includes('*') || codeRow.unlocked_outfit_ids.includes('ALL')) {
          dbOutfitGrants.push(...SECRET_WARDROBE_OUTFITS.map((o) => o.id));
        } else {
          dbOutfitGrants.push(...codeRow.unlocked_outfit_ids);
        }
      }

      await pool.query(
        `UPDATE redeem_codes
         SET used_count = used_count + 1,
             redeemed_by = array_append(redeemed_by, $1)
         WHERE code = $2`,
        [params.userId, codeRow.code]
      );
    }

    const existingUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [params.userId]);
    if (existingUserRes.rows.length === 0) {
      throw new Error('User account not found.');
    }

    const curUser = existingUserRes.rows[0];
    const currentUnlocked = Array.isArray(curUser.unlocked_outfits) ? curUser.unlocked_outfits : [];
    const mergedUnlocked = Array.from(new Set([...currentUnlocked, ...dbOutfitGrants]));
    const nextAccountType = dbGrantPaid ? 'paid' : curUser.account_type;
    const nextLastPayment = dbGrantPaid ? nowIso : curUser.last_payment;

    const updatedUser = await pool.query(
      `UPDATE users
       SET account_type = $1,
           last_payment = $2,
           unlocked_outfits = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [nextAccountType, nextLastPayment, mergedUnlocked, params.userId]
    );

    return sanitizeUser(updatedUser.rows[0]);
  }

  if (!isBuiltInPaidCode && matchedSecretIds.length === 0) {
    throw new Error('Invalid or expired redeem code.');
  }

  for (const u of fallbackUsers.values()) {
    if (u.id === params.userId) {
      if (isBuiltInPaidCode) {
        u.account_type = 'paid';
        u.last_payment = nowIso;
      }
      if (matchedSecretIds.length > 0) {
        const curUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
        u.unlocked_outfits = Array.from(new Set([...curUnlocked, ...matchedSecretIds]));
      }
      return sanitizeUser(u);
    }
  }

  throw new Error('User account not found.');
}

async function syncUserConversationsAndThemes(params) {
  const pool = await ensureNeonSchema();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (Array.isArray(params.conversations)) {
        for (const conv of params.conversations) {
          await client.query(
            `INSERT INTO conversations (id, user_id, title, model_id, pinned, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               model_id = EXCLUDED.model_id,
               pinned = EXCLUDED.pinned,
               updated_at = EXCLUDED.updated_at`,
            [
              conv.id,
              params.userId,
              conv.title || 'Direct Message',
              conv.modelId || 'smollm2-135m',
              Boolean(conv.pinned),
              Number(conv.createdAt) || Date.now(),
              Number(conv.updatedAt) || Date.now(),
            ]
          );

          for (const msg of conv.messages || []) {
            await client.query(
              `INSERT INTO messages (
                id, conversation_id, user_id, role, content, timestamp,
                model_used, tokens_count, generation_time_ms, speed_tps, error
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content,
                error = EXCLUDED.error`,
              [
                msg.id,
                conv.id,
                params.userId,
                msg.role,
                msg.content,
                Number(msg.timestamp) || Date.now(),
                msg.modelUsed || null,
                msg.tokensCount ?? null,
                msg.generationTimeMs ?? null,
                msg.speedTps ?? null,
                Boolean(msg.error),
              ]
            );
          }
        }
      }

      if (Array.isArray(params.customThemes)) {
        await client.query('DELETE FROM custom_themes WHERE user_id = $1', [params.userId]);
        for (const theme of params.customThemes) {
          await client.query(
            `INSERT INTO custom_themes (id, user_id, name, is_dark, description, colors, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, id) DO UPDATE SET
               name = EXCLUDED.name,
               is_dark = EXCLUDED.is_dark,
               description = EXCLUDED.description,
               colors = EXCLUDED.colors`,
            [
              theme.id,
              params.userId,
              theme.name,
              Boolean(theme.isDark),
              theme.description || 'Custom palette',
              JSON.stringify(theme.colors),
              Number(theme.createdAt) || Date.now(),
            ]
          );
        }
      }

      if (Array.isArray(params.unlockedOutfits) && params.unlockedOutfits.length > 0) {
        const userRes = await client.query('SELECT unlocked_outfits FROM users WHERE id = $1', [params.userId]);
        if (userRes.rows.length > 0) {
          const curUnlocked = Array.isArray(userRes.rows[0].unlocked_outfits)
            ? userRes.rows[0].unlocked_outfits
            : [];
          const merged = Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]));
          await client.query(
            'UPDATE users SET unlocked_outfits = $1, updated_at = NOW() WHERE id = $2',
            [merged, params.userId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  if (Array.isArray(params.conversations)) {
    fallbackConversations.set(params.userId, params.conversations);
  }
  if (Array.isArray(params.customThemes)) {
    fallbackCustomThemes.set(params.userId, params.customThemes);
  }
  if (Array.isArray(params.unlockedOutfits) && params.unlockedOutfits.length > 0) {
    for (const u of fallbackUsers.values()) {
      if (u.id === params.userId) {
        const curUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
        u.unlocked_outfits = Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]));
      }
    }
  }
}

// =====================================================================
// Express App & Router Setup
// =====================================================================
const apiApp = express();
const router = express.Router();
const jsonParser = express.json({ limit: '10mb' });

// Safe body parser that respects pre-parsed bodies from Vercel Serverless runtime
apiApp.use((req, res, next) => {
  if (req.url && req.url.includes('__route=')) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const targetRoute = parsedUrl.searchParams.get('__route');
      if (targetRoute) {
        parsedUrl.searchParams.delete('__route');
        const remainingQuery = parsedUrl.searchParams.toString();
        req.url = remainingQuery ? `${targetRoute}?${remainingQuery}` : targetRoute;
      }
    } catch {
      // ignore
    }
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return next();
  }
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        req.body = JSON.parse(trimmed);
      } catch {
        // ignore
      }
    }
    return next();
  }
  if (Buffer.isBuffer(req.body)) {
    const str = req.body.toString('utf-8').trim();
    if (str.startsWith('{') || str.startsWith('[')) {
      try {
        req.body = JSON.parse(str);
      } catch {
        // ignore
      }
    }
    return next();
  }
  return jsonParser(req, res, next);
});

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    persona: 'Hana',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasNeonUrl: Boolean(process.env.NEON_DATABASE_URL),
  });
});

// Proxy endpoint for VRM 3D asset
router.get('/vrm', async (req, res) => {
  try {
    const requestedFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const safeFile = /^[a-zA-Z0-9_.-]+\.vrm$/.test(requestedFile) ? requestedFile : 'hana_v1.3_vrm1.vrm';

    const targetUrls = [
      `${MODEL_SOURCE_DOMAIN}/${safeFile}`,
      `${MODEL_FALLBACK_DOMAIN}/${safeFile}`,
      `${MODEL_SOURCE_DOMAIN}/hana_v1.3_vrm1.vrm`,
    ];

    let vrmResp = null;
    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, { redirect: 'follow' });
        if (resp.ok && resp.body) {
          vrmResp = resp;
          break;
        }
      } catch {
        // Continue
      }
    }

    if (!vrmResp || !vrmResp.body) {
      return res.status(502).json({ error: 'Failed to fetch remote VRM asset' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const contentLength = vrmResp.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = vrmResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Error fetching VRM asset';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.end();
    }
  }
});

// Proxy endpoint for Mixamo animation FBX assets
router.get(['/animation/:type', '/animation/idle'], async (req, res) => {
  try {
    const animType = req.params.type || 'idle';
    const requestedFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
    const safeFile = /^[a-zA-Z0-9_.-]+\.fbx$/.test(requestedFile) ? requestedFile : '';

    const fileMap = {
      idle: 'mixamo_idle.fbx',
      fall: 'mixamo_fall.fbx',
      getup: 'mixamo_getup.fbx',
      walk: 'mixamo_walk.fbx',
      wave: 'mixamo_wave.fbx',
      yawn: 'mixamo_yawn.fbx',
      wait: 'mixamo_wait.fbx',
    };

    const resolvedFile =
      safeFile ||
      fileMap[animType] ||
      (animType && /^[a-zA-Z0-9_.-]+$/.test(animType)
        ? animType.endsWith('.fbx')
          ? animType
          : `mixamo_${animType}.fbx`
        : 'mixamo_idle.fbx');
    const targetUrls = ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/${resolvedFile}`);
    if (resolvedFile === 'mixamo_.jumpingjacks.fbx' || animType === 'jumpingjacks') {
      targetUrls.push(
        ...ANIMATION_SOURCE_DOMAINS.map((domain) => `${domain}/mixamo_jumpingjacks.fbx`)
      );
    }

    let fbxResp = null;
    for (const url of targetUrls) {
      try {
        const resp = await fetch(url, { redirect: 'follow' });
        if (resp.ok && resp.body) {
          fbxResp = resp;
          break;
        }
      } catch {
        // Continue
      }
    }

    if (!fbxResp || !fbxResp.body) {
      return res.status(502).json({ error: `Failed to fetch remote animation asset ${animType}` });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const contentLength = fbxResp.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const reader = fbxResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Error fetching animation asset';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.end();
    }
  }
});

// Ollama helpers
function cleanOllamaBaseUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(api\/tags|api\/chat|api\/generate|api\/version|v1\/models|v1\/chat\/completions)$/, '');
  return url.replace(/\/+$/, '');
}

function buildServerOllamaUrl(rawUrl, endpoint) {
  const clean = cleanOllamaBaseUrl(rawUrl);
  const endpointPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const full = `${clean}${endpointPath}`;
  if (full.includes('ngrok')) {
    const sep = full.includes('?') ? '&' : '?';
    return `${full}${sep}ngrok-skip-browser-warning=true`;
  }
  return full;
}

const OLLAMA_REQUEST_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'User-Agent': 'curl/8.0.0',
  Accept: 'application/json',
};

router.post('/ollama/ping', async (req, res) => {
  try {
    const baseUrl = cleanOllamaBaseUrl(req.body?.url || '');
    if (!baseUrl) {
      return res.json({ online: false, error: 'No URL provided' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    let online = false;
    let models = [];

    try {
      const resp = await fetch(buildServerOllamaUrl(baseUrl, '/api/tags'), {
        method: 'GET',
        headers: OLLAMA_REQUEST_HEADERS,
        signal: controller.signal,
      });

      if (resp.ok && !resp.headers.get('ngrok-error-code')) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          if (Array.isArray(data?.models)) {
            models = data.models.map((m) => (m.name || m.model || '').trim()).filter(Boolean);
            if (models.length > 0) online = true;
          }
        }
      }
    } catch {
      // Continue
    }

    if (models.length === 0) {
      try {
        const v1Resp = await fetch(buildServerOllamaUrl(baseUrl, '/v1/models'), {
          method: 'GET',
          headers: OLLAMA_REQUEST_HEADERS,
          signal: controller.signal,
        });

        if (v1Resp.ok && !v1Resp.headers.get('ngrok-error-code')) {
          const contentType = v1Resp.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await v1Resp.json();
            if (Array.isArray(data?.data)) {
              models = data.data.map((m) => (m.id || m.name || '').trim()).filter(Boolean);
              if (models.length > 0) online = true;
            }
          }
        }
      } catch {
        // Continue
      }
    }

    if (!online) {
      try {
        const verResp = await fetch(buildServerOllamaUrl(baseUrl, '/api/version'), {
          method: 'GET',
          headers: OLLAMA_REQUEST_HEADERS,
          signal: controller.signal,
        });
        if (verResp.ok && !verResp.headers.get('ngrok-error-code')) {
          online = true;
        }
      } catch {
        // Ignore
      }
    }

    clearTimeout(timeout);
    res.json({ online, models, modelName: models[0] || '' });
  } catch {
    res.json({ online: false, modelName: '', models: [] });
  }
});

router.post('/ollama/chat', async (req, res) => {
  try {
    const { url, model, messages, systemPrompt, maxTokens } = req.body || {};
    const baseUrl = cleanOllamaBaseUrl(url || '');
    if (!baseUrl) {
      return res.status(400).json({ error: 'Target Ollama URL is required' });
    }

    let resolvedModel = (model || '').trim() || 'Hudson/llama3.1-uncensored:8b';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const cleanedHistory = (messages || [])
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const formattedMessages = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
      ...cleanedHistory,
    ];

    const numPredict = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const ollamaResp = await fetch(buildServerOllamaUrl(baseUrl, '/api/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'curl/8.0.0',
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: formattedMessages,
        stream: true,
        options: {
          num_predict: numPredict,
          temperature: 0.85,
        },
      }),
    });

    if (!ollamaResp.ok || !ollamaResp.body) {
      const errText = await ollamaResp.text();
      res.write(`data: ${JSON.stringify({ error: errText || `Ollama server error (${ollamaResp.status})` })}\n\n`);
      return res.end();
    }

    const reader = ollamaResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const piece = parsed.message?.content || parsed.response || parsed.choices?.[0]?.delta?.content || '';
          if (piece) {
            res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
          }
          if (parsed.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch {
          // ignore
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Ollama proxy error';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { messages, systemPrompt, maxTokens } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const formattedContents = (messages || []).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const outputTokens = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ];

    let responseStream = null;
    let lastError = null;

    for (const cand of candidateModels) {
      try {
        responseStream = await ai.models.generateContentStream({
          model: cand,
          contents: formattedContents,
          config: {
            systemInstruction: systemPrompt || DEFAULT_SYSTEM_PROMPT,
            temperature: 0.85,
            maxOutputTokens: outputTokens,
          },
        });
        if (responseStream) break;
      } catch (streamErr) {
        lastError = streamErr;
        console.warn(`Model ${cand} unavailable in api/chat:`, streamErr.message || streamErr);
      }
    }

    if (!responseStream) {
      throw lastError || new Error('No available Gemini model responded');
    }

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown streaming error';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
});

// Full-message emotion detection endpoint (uses Gemini LLM or comprehensive sentiment algorithm)
function classifyOverallSentimentAlgorithm(fullText) {
  const text = (fullText || '').trim();
  if (!text) return 'neutral';

  const scores = { neutral: 1.0, happy: 0, smug: 0, sad: 0, angry: 0, surprised: 0 };
  const happyPatterns = [
    /\b(happy|glad|delighted|excited|joy|joyful|wonderful|great|awesome|love|lovely|yay|hooray|congrats|congratulations|celebrate|cherish|smile|smiling|fun|fantastic|sweet|warmth|laugh|giggle|haha|hehe|welcome)\b/gi,
    /\b(proud of you|so good|amazing work|pleasure to meet|adore|thrilled|super happy|made my day|love that)\b/gi,
    /(\^_\^|:D|:\)|<3|😊|😄|🥰|✨|🎉)/g,
  ];
  const smugPatterns = [
    /\b(smug|smirk|obviously|of course|naturally|told you so|easy peasy|child's play|flattered|darling|sweetheart|as expected|you know it|admit it|impressed|can't resist|can't beat|genius|clever|amateur|too easy|fufufu)\b/gi,
    /\b(wouldn't you agree|did you really think|who else but me|you're welcome|like a pro|fabulous|unmatched|effortless)\b/gi,
    /(😏|💅|😎|👑|\(¬‿¬\)|\bheh\b|\bhoho\b)/gi,
  ];
  const sadPatterns = [
    /\b(sad|sorrow|unfortunate|grief|crying|tears|weep|heartbroken|depressed|gloomy|lonely|painful|hurt|devastated|regret|pity|bummer|miss you|tragic|loss|mourn|hopeless|disappointed)\b/gi,
    /\b(i'm so sorry|my condolences|wish things were different|it hurts|feel bad|so sorry to hear|breaks my heart|hard to bear)\b/gi,
    /(😢|😭|🥺|💔|😞|😔|\bsob\b|;\(|:-\(|:\()/gi,
  ];
  const angryPatterns = [
    /\b(angry|furious|mad|annoyed|irritated|hate|disgusted|unacceptable|outrageous|ridiculous|infuriating|nonsense|stupid|idiot|insult|offensive|pissed|fed up|grr|stop it|back off)\b/gi,
    /\b(how dare|can't believe you|excuse me\?|not funny|lose my temper|shut up|sick and tired)\b/gi,
    /(😠|😡|🤬|💢|👿)/gi,
  ];
  const surprisedPatterns = [
    /\b(surprised|shocked|astonished|amazed|unbelievable|whoa|woah|wow|omg|gasp|wait what|no way|really\?|are you serious|unreal|incredible|mind-blowing|unexpected|stunned|speechless)\b/gi,
    /\b(i had no idea|can't be true|are you telling me|what in the world|holy cow|wait, really)\b/gi,
    /(😮|😲|🤯|👀|⁉️|\?!|\?{2,}|:O)/gi,
  ];

  for (const p of happyPatterns) { const m = text.match(p); if (m) scores.happy += m.length * 1.5; }
  for (const p of smugPatterns) { const m = text.match(p); if (m) scores.smug += m.length * 1.8; }
  for (const p of sadPatterns) { const m = text.match(p); if (m) scores.sad += m.length * 1.6; }
  for (const p of angryPatterns) { const m = text.match(p); if (m) scores.angry += m.length * 1.8; }
  for (const p of surprisedPatterns) { const m = text.match(p); if (m) scores.surprised += m.length * 1.6; }

  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 2 && scores.happy > 0) scores.happy += 1.2;
  if (exclamations >= 2 && scores.angry > 0) scores.angry += 1.4;

  let maxEmotion = 'neutral';
  let maxScore = scores.neutral;
  for (const [emo, score] of Object.entries(scores)) {
    if (emo === 'neutral') continue;
    if (score > maxScore && score >= 1.5) {
      maxScore = score;
      maxEmotion = emo;
    }
  }
  return maxEmotion;
}

router.post('/emotion', (req, res) => {
  const fullText = String(req.body?.text || '').trim();
  if (!fullText) {
    return res.json({ emotion: 'neutral', method: 'empty' });
  }

  const detected = classifyOverallSentimentAlgorithm(fullText);
  res.json({ emotion: detected, method: 'algorithm' });
});

// Cloud streaming endpoint for external AI Model APIs
// (OpenAI, Gemini, Anthropic, xAI, Groq, Z.ai, DeepSeek, Qwen, HuggingFace)
router.post('/chat/provider', async (req, res) => {
  try {
    const { provider, apiKey, model, messages, systemPrompt, maxTokens } = req.body || {};
    const effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const outputTokens = Math.min(Math.max(Number(maxTokens) || 512, 64), 4096);

    const effectiveKey = (apiKey || '').trim();
    if (!effectiveKey) {
      return res.status(400).json({
        error: `API key is required for ${provider || 'this provider'}. Please configure your API key in the Model Selector.`,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 1. Google Gemini via @google/genai SDK
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const formattedContents = (messages || [])
        .filter((m) => m.role !== 'system')
        .map((msg) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));

      const targetModel = model || 'gemini-2.5-flash';
      const responseStream = await ai.models.generateContentStream({
        model: targetModel,
        contents: formattedContents,
        config: {
          systemInstruction: effectivePrompt,
          temperature: 0.85,
          maxOutputTokens: outputTokens,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 2. Anthropic Claude via native messages SSE API
    if (provider === 'anthropic') {
      const targetModel = model || 'claude-3-7-sonnet-20250219';
      const cleanedMessages = (messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': effectiveKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: outputTokens,
          system: effectivePrompt,
          messages: cleanedMessages,
          stream: true,
          temperature: 0.85,
        }),
      });

      if (!anthropicResp.ok || !anthropicResp.body) {
        const errText = await anthropicResp.text();
        res.write(`data: ${JSON.stringify({ error: errText || `Anthropic API error (${anthropicResp.status})` })}\n\n`);
        return res.end();
      }

      const reader = anthropicResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
              } else if (parsed.type === 'message_stop') {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              }
            } catch {
              // ignore
            }
          }
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // 3. OpenAI-Compatible Providers (OpenAI, xAI, Groq, DeepSeek, Z.ai, Qwen, HuggingFace)
    const providerEndpoints = {
      openai: 'https://api.openai.com/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/chat/completions',
      zai: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      huggingface: 'https://router.huggingface.co/hf-inference/v1/chat/completions',
    };

    const targetUrl = providerEndpoints[provider] || providerEndpoints.openai;
    const defaultModels = {
      openai: 'gpt-4o',
      xai: 'grok-2-latest',
      groq: 'llama-3.3-70b-versatile',
      deepseek: 'deepseek-chat',
      zai: 'glm-4-plus',
      qwen: 'qwen-max',
      huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
    };

    const targetModel = model || defaultModels[provider] || 'gpt-4o';
    const cleanedHistory = (messages || [])
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const formattedMessages = [
      { role: 'system', content: effectivePrompt },
      ...cleanedHistory,
    ];

    const apiResp = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        max_tokens: outputTokens,
        temperature: 0.85,
        stream: true,
      }),
    });

    if (!apiResp.ok || !apiResp.body) {
      const errText = await apiResp.text();
      res.write(`data: ${JSON.stringify({ error: errText || `${provider} API error (${apiResp.status})` })}\n\n`);
      return res.end();
    }

    const reader = apiResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const piece = parsed.choices?.[0]?.delta?.content || '';
            if (piece) {
              res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
            }
          } catch {
            // Ignore boundary chunk errors
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Error in external API streaming proxy';
    console.error('Provider proxy error:', errorMsg);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
    }
  }
});

// =====================================================================
// NeonDB Account Authentication, Profile, Redeem & Sync Routes
// =====================================================================
router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, device, fingerprint } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const userAgent = req.headers['user-agent'] || 'Web Browser';
    const result = await signUpAccount({
      email,
      password,
      device: device || String(userAgent),
      fingerprint: fingerprint || '',
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create account.';
    res.status(400).json({ error: message });
  }
});

router.post('/auth/signin', async (req, res) => {
  try {
    const { email, password, device, fingerprint } = req.body || {};
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const userAgent = req.headers['user-agent'] || 'Web Browser';
    const result = await signInAccount({
      email,
      password,
      device: device || String(userAgent),
      fingerprint: fingerprint || '',
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sign in.';
    res.status(401).json({ error: message });
  }
});

router.post('/account/profile', async (req, res) => {
  try {
    const { userId, username, displayName, avatarUrl, equippedOutfitId, unlockedOutfits, activeThemeId } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }

    const user = await updateAccountProfile({
      userId: Number(userId),
      username,
      displayName,
      avatarUrl,
      equippedOutfitId,
      unlockedOutfits,
      activeThemeId,
    });

    res.json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update profile.';
    res.status(400).json({ error: message });
  }
});

router.post('/account/redeem', async (req, res) => {
  try {
    const { userId, code } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Redeem code is required.' });
    }

    const user = await redeemAccountCode({
      userId: Number(userId),
      code,
    });

    res.json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to redeem code.';
    res.status(400).json({ error: message });
  }
});

router.get('/account/sync/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    const data = await fetchUserSyncedData(userId);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch synced data.';
    res.status(400).json({ error: message });
  }
});

router.post('/account/sync', async (req, res) => {
  try {
    const { userId, conversations, customThemes, unlockedOutfits } = req.body || {};
    if (!userId || Number.isNaN(Number(userId))) {
      return res.status(400).json({ error: 'Valid userId is required.' });
    }
    await syncUserConversationsAndThemes({
      userId: Number(userId),
      conversations,
      customThemes,
      unlockedOutfits,
    });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync account data.';
    res.status(400).json({ error: message });
  }
});

// =====================================================================
// Self-Hosted Zero-API WebRTC & Real-Time Telephone PBX Switchboard
// =====================================================================
const registeredPbxLines = new Map();
const pbxCallSessions = new Map();

function normalizeDigits(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

router.post('/caller/pbx/register', (req, res) => {
  const rawLine = String(req.body?.lineNumber || '').trim();
  const key = normalizeDigits(rawLine);
  if (!key) {
    return res.status(400).json({ ok: false, error: 'Invalid line number' });
  }
  registeredPbxLines.set(key, { lineNumber: rawLine, lastSeen: Date.now() });
  return res.json({
    ok: true,
    lineKey: key,
    onlineLines: registeredPbxLines.size,
  });
});

router.get('/caller/pbx/poll', (req, res) => {
  const rawLine = String(req.query.lineNumber || '').trim();
  const callId = String(req.query.callId || '').trim();
  const key = normalizeDigits(rawLine);

  if (key) {
    registeredPbxLines.set(key, { lineNumber: rawLine, lastSeen: Date.now() });
  }

  if (callId && pbxCallSessions.has(callId)) {
    return res.json({
      ok: true,
      activeCall: pbxCallSessions.get(callId),
    });
  }

  if (key) {
    for (const session of pbxCallSessions.values()) {
      if (
        normalizeDigits(session.toNumber) === key &&
        (session.status === 'ringing' || session.status === 'connected') &&
        Date.now() - session.updatedAt < 120000
      ) {
        return res.json({
          ok: true,
          incomingCall: session,
        });
      }
    }
  }

  return res.json({ ok: true, incomingCall: null, activeCall: null });
});

router.post('/caller/pbx/dial', (req, res) => {
  const fromNumber = String(req.body?.fromNumber || '+1 (555) 010-1000').trim();
  const toNumber = String(req.body?.toNumber || '').trim();
  const offerSdp = req.body?.offerSdp || null;

  if (!normalizeDigits(toNumber)) {
    return res.status(400).json({ ok: false, error: 'Destination phone number required' });
  }

  const callId = `pbx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const session = {
    callId,
    fromNumber,
    toNumber,
    status: 'ringing',
    offerSdp,
    answerSdp: null,
    callerIce: [],
    calleeIce: [],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  pbxCallSessions.set(callId, session);
  const targetOnline = registeredPbxLines.has(normalizeDigits(toNumber));

  return res.json({
    ok: true,
    callId,
    targetOnline,
    session,
  });
});

router.post('/caller/pbx/answer', (req, res) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }
  session.status = 'connected';
  if (req.body?.answerSdp) {
    session.answerSdp = req.body.answerSdp;
  }
  session.updatedAt = Date.now();
  return res.json({ ok: true, session });
});

router.post('/caller/pbx/signal', (req, res) => {
  const callId = String(req.body?.callId || '').trim();
  const role = req.body?.role === 'callee' ? 'callee' : 'caller';
  const candidate = req.body?.candidate;
  const offerSdp = req.body?.offerSdp;
  const answerSdp = req.body?.answerSdp;

  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }

  if (offerSdp) session.offerSdp = offerSdp;
  if (answerSdp) {
    session.answerSdp = answerSdp;
    session.status = 'connected';
  }
  if (candidate) {
    if (role === 'caller') {
      session.callerIce.push(candidate);
    } else {
      session.calleeIce.push(candidate);
    }
  }
  session.updatedAt = Date.now();
  return res.json({ ok: true, session });
});

router.post('/caller/pbx/message', (req, res) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Call session not found' });
  }

  const msg = {
    id: String(req.body?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`),
    sender: req.body?.sender === 'agent' ? 'agent' : 'callee',
    fromNumber: String(req.body?.fromNumber || ''),
    text: String(req.body?.text || '').trim(),
    timestamp: String(req.body?.timestamp || '00:00'),
    modelUsed: req.body?.modelUsed ? String(req.body.modelUsed) : undefined,
  };

  if (msg.text && !session.messages.some((m) => m.id === msg.id)) {
    session.messages.push(msg);
    session.updatedAt = Date.now();
  }

  return res.json({ ok: true, session });
});

router.post('/caller/pbx/hangup', (req, res) => {
  const callId = String(req.body?.callId || '').trim();
  const session = pbxCallSessions.get(callId);
  if (session) {
    session.status = 'ended';
    session.updatedAt = Date.now();
  }
  return res.json({ ok: true });
});

// =====================================================================
// 3RD-PARTY PLATFORM CALLING & VOICE INTEGRATIONS (WhatsApp, Telegram, Messenger, Discord)
// =====================================================================
const omnichannelCallMessages = new Map();
const telegramLastUpdateOffsets = new Map();

async function synthesizeHanaVoice(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: (text || '').slice(0, 1200),
              speechMetadata: {
                style: 'Warm, cheerful anime companion voice',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return Buffer.from(base64Audio, 'base64');
    }
  } catch (err) {
    console.warn('TTS voice generation failed in api/index.js:', err);
  }
  return null;
}

router.post('/caller/platforms/test', async (req, res) => {
  try {
    const { platform, config, credentials } = req.body || {};
    const creds = credentials || config || {};
    if (!platform) {
      return res.status(400).json({ ok: false, error: 'Platform identifier is required' });
    }

    if (platform === 'whatsapp') {
      const token = (creds?.accessToken || '').trim();
      const phoneId = (creds?.phoneNumberId || '').trim();
      if (!token) return res.status(400).json({ ok: false, error: 'Meta Access Token required for WhatsApp' });
      const url = phoneId ? `https://graph.facebook.com/v21.0/${phoneId}` : 'https://graph.facebook.com/v21.0/me';
      const metaResp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok) return res.status(metaResp.status).json({ ok: false, error: data?.error?.message || 'WhatsApp credentials invalid' });
      return res.json({ ok: true, platform: 'whatsapp', verified: true, details: { displayPhoneNumber: data.display_phone_number || phoneId || 'Verified', verifiedName: data.verified_name || 'Hana WhatsApp Agent' } });
    }

    if (platform === 'telegram') {
      const botToken = (creds?.botToken || '').trim().replace(/^bot/i, '');
      if (!botToken) return res.status(400).json({ ok: false, error: 'Telegram Bot Token required' });
      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await tgResp.json().catch(() => ({}));
      if (!data?.ok) return res.status(400).json({ ok: false, error: data?.description || 'Telegram bot token invalid' });
      return res.json({ ok: true, platform: 'telegram', verified: true, details: { username: data.result?.username, firstName: data.result?.first_name } });
    }

    if (platform === 'messenger') {
      const pageToken = (creds?.pageAccessToken || '').trim();
      const pageId = (creds?.pageId || '').trim();
      if (!pageToken) return res.status(400).json({ ok: false, error: 'Page Access Token required for Messenger' });
      const url = pageId ? `https://graph.facebook.com/v21.0/${pageId}?access_token=${pageToken}` : `https://graph.facebook.com/v21.0/me?access_token=${pageToken}`;
      const fbResp = await fetch(url);
      const data = await fbResp.json().catch(() => ({}));
      if (!fbResp.ok) return res.status(fbResp.status).json({ ok: false, error: data?.error?.message || 'Facebook Page credentials invalid' });
      return res.json({ ok: true, platform: 'messenger', verified: true, details: { pageName: data.name || pageId || 'Verified Page', id: data.id || pageId } });
    }

    if (platform === 'discord') {
      const botToken = (creds?.botToken || '').trim().replace(/^Bot\s+/i, '');
      if (!botToken) return res.status(400).json({ ok: false, error: 'Discord Bot Token is required' });
      const discordResp = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await discordResp.json().catch(() => ({}));
      if (!discordResp.ok) {
        return res.status(discordResp.status).json({
          ok: false,
          error: data?.message || 'Discord Bot Token is invalid or bot not found',
        });
      }
      return res.json({
        ok: true,
        platform: 'discord',
        verified: true,
        details: {
          username: `@${data.username}`,
          id: data.id,
          discriminator: data.discriminator || '0',
          supportsVoiceCalls: true,
        },
      });
    }

    return res.status(400).json({ ok: false, error: `Unknown platform "${platform}"` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Platform test failed' });
  }
});

router.post('/caller/platforms/dispatch', async (req, res) => {
  try {
    const { platform, config, credentials, message, to, recipient, callerUrl } = req.body || {};
    const creds = credentials || config || {};
    const targetRecipient = String(to || recipient || '').trim();

    if (!platform || !message) {
      return res.status(400).json({ ok: false, error: 'Platform and message are required' });
    }
    const dispatchTime = new Date().toLocaleTimeString();
    const dispatchId = `disp_${platform}_${Date.now()}`;

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = callerUrl || `${protocol}://${host}`;
    const liveCallRoomUrl = `${baseUrl}/caller`;

    if (platform === 'whatsapp') {
      const token = (creds?.accessToken || '').trim();
      const phoneId = (creds?.phoneNumberId || '').trim();
      const targetPhone = (targetRecipient || creds?.targetNumber || '').replace(/[^0-9]/g, '');
      if (!token || !phoneId || !targetPhone) return res.status(400).json({ ok: false, error: 'WhatsApp credentials and target phone required' });
      const waResp = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: targetPhone, type: 'text', text: { body: `📞 [Hana AI Live Voice Call Session]\n\n"${message}"\n\n🎙️ Answer Live: ${liveCallRoomUrl}` } }),
      });
      const waData = await waResp.json().catch(() => ({}));
      if (!waResp.ok) return res.status(waResp.status).json({ ok: false, error: waData?.error?.message || 'WhatsApp dispatch failed' });
      return res.json({ ok: true, dispatchId, platform: 'whatsapp', to: targetPhone, message, timestamp: dispatchTime });
    }

    if (platform === 'telegram') {
      const botToken = (creds?.botToken || '').trim().replace(/^bot/i, '');
      const chatId = (targetRecipient || creds?.chatId || '').trim();
      if (!botToken || !chatId) return res.status(400).json({ ok: false, error: 'Telegram Bot Token and Chat ID required' });
      
      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `📞 <b>INCOMING VOICE CALL FROM HANA AI</b>\n\n<i>"${message}"</i>\n\n🎙️ <a href="${liveCallRoomUrl}">Answer Live Voice Call</a>`,
          parse_mode: 'HTML',
        }),
      });
      const tgData = await tgResp.json().catch(() => ({}));
      if (!tgData?.ok) return res.status(400).json({ ok: false, error: tgData?.description || 'Telegram dispatch failed' });

      // Synthesize and send voice note to telegram receiver
      try {
        const voiceBuf = await synthesizeHanaVoice(message);
        if (voiceBuf) {
          const form = new FormData();
          form.append('chat_id', chatId);
          form.append('voice', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_greeting.wav');
          form.append('caption', `📞 <b>Hana Call Greeting:</b> "${message}"`.slice(0, 1024));
          form.append('parse_mode', 'HTML');
          await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
            method: 'POST',
            body: form,
          });
        }
      } catch {}

      return res.json({ ok: true, dispatchId, platform: 'telegram', to: chatId, message, timestamp: dispatchTime });
    }

    if (platform === 'discord') {
      const botToken = (creds?.botToken || '').trim().replace(/^Bot\s+/i, '');
      const channelId = (creds?.channelId || targetRecipient || '').trim();
      const targetUserId = (creds?.targetUserId || '').trim();

      if (!botToken || !channelId) {
        return res.status(400).json({
          ok: false,
          error: 'Discord Bot Token and target Channel ID are required',
        });
      }

      const mention = targetUserId ? `<@${targetUserId}> ` : '';
      let discData = {};
      try {
        const voiceBuf = await synthesizeHanaVoice(message);
        if (voiceBuf) {
          const form = new FormData();
          form.append(
            'payload_json',
            JSON.stringify({
              content: `${mention}📞 **Incoming Live Voice Call from Hana AI!**\n> "${message}"\n🎙️ **Live Call Room:** [Join Call](${liveCallRoomUrl})`,
              attachments: [{ id: 0, filename: 'hana_call_greeting.wav', description: 'Hana AI Spoken Voice Greeting' }],
            })
          );
          form.append('files[0]', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_call_greeting.wav');
          const discResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${botToken}` },
            body: form,
          });
          discData = await discResp.json().catch(() => ({}));
          if (!discResp.ok) {
            return res.status(discResp.status).json({
              ok: false,
              error: discData?.message || 'Discord message dispatch failed. Ensure bot has Send Messages and Attach Files permissions in the channel.',
            });
          }
        } else {
          const discResp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              content: `${mention}📞 **Incoming Live Call from Hana AI Voice Switchboard!**\n> "${message}"\n🎙️ **Answer Call:** ${liveCallRoomUrl}`,
            }),
          });
          discData = await discResp.json().catch(() => ({}));
          if (!discResp.ok) {
            return res.status(discResp.status).json({
              ok: false,
              error: discData?.message || 'Discord message dispatch failed.',
            });
          }
        }
      } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || 'Discord dispatch error' });
      }

      return res.json({
        ok: true,
        dispatchId,
        platform: 'discord',
        to: channelId,
        message,
        timestamp: dispatchTime,
        remoteMessageId: discData?.id,
        callMode: 'voice_bridge',
        liveCallUrl: liveCallRoomUrl,
      });
    }

    if (platform === 'messenger') {
      const pageToken = (creds?.pageAccessToken || '').trim();
      const recipientId = (targetRecipient || creds?.recipientId || '').trim();
      if (!pageToken || !recipientId) return res.status(400).json({ ok: false, error: 'Page Access Token and recipient ID required' });
      const fbResp = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: `📞 [Hana AI Live Voice Call Session]\n\n"${message}"\n\n🎙️ Answer Live: ${liveCallRoomUrl}` } }),
      });
      const fbData = await fbResp.json().catch(() => ({}));
      if (!fbResp.ok) return res.status(fbResp.status).json({ ok: false, error: fbData?.error?.message || 'Messenger dispatch failed' });
      return res.json({ ok: true, dispatchId, platform: 'messenger', to: recipientId, message, timestamp: dispatchTime });
    }

    return res.status(400).json({ ok: false, error: `Unsupported platform "${platform}"` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Dispatch failed' });
  }
});

router.post('/caller/platforms/relay-reply', async (req, res) => {
  try {
    const { platform, target, botToken, text } = req.body || {};
    if (!platform || !target || !text) {
      return res.status(400).json({ ok: false, error: 'Platform, target, and text are required' });
    }

    if (platform === 'telegram') {
      const cleanToken = String(botToken || '').trim().replace(/^bot/i, '');
      if (!cleanToken) return res.status(400).json({ ok: false, error: 'Telegram Bot Token required' });

      let voiceSent = false;
      try {
        const voiceBuf = await synthesizeHanaVoice(text);
        if (voiceBuf) {
          const form = new FormData();
          form.append('chat_id', target);
          form.append('voice', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_reply.wav');
          form.append('caption', `🌸 <b>Hana:</b> ${text}`.slice(0, 1024));
          form.append('parse_mode', 'HTML');
          const tgVoiceResp = await fetch(`https://api.telegram.org/bot${cleanToken}/sendVoice`, {
            method: 'POST',
            body: form,
          });
          const tgVoiceData = await tgVoiceResp.json().catch(() => ({}));
          if (tgVoiceData?.ok) voiceSent = true;
        }
      } catch {}

      if (!voiceSent) {
        await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: target, text: `🌸 <b>Hana:</b> ${text}`, parse_mode: 'HTML' }),
        });
      }
      return res.json({ ok: true, voiceSent });
    }

    if (platform === 'discord') {
      const cleanToken = String(botToken || '').trim().replace(/^Bot\s+/i, '');
      if (!cleanToken) return res.status(400).json({ ok: false, error: 'Discord Bot Token required' });

      let voiceSent = false;
      try {
        const voiceBuf = await synthesizeHanaVoice(text);
        if (voiceBuf) {
          const form = new FormData();
          form.append(
            'payload_json',
            JSON.stringify({
              content: `🌸 **Hana:** ${text}`.slice(0, 2000),
              attachments: [{ id: 0, filename: 'hana_voice_reply.wav', description: 'Hana Spoken Voice Reply' }],
            })
          );
          form.append('files[0]', new Blob([new Uint8Array(voiceBuf)], { type: 'audio/wav' }), 'hana_voice_reply.wav');
          const discResp = await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${cleanToken}` },
            body: form,
          });
          if (discResp.ok) voiceSent = true;
        }
      } catch {}

      if (!voiceSent) {
        await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${cleanToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: `🌸 **Hana:** ${text}`.slice(0, 2000) }),
        });
      }
      return res.json({ ok: true, voiceSent });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Relay failed' });
  }
});

router.post('/caller/platforms/keep-bot-online', (req, res) => {
  return res.json({ ok: true, platform: 'discord', status: 'online' });
});

router.get('/caller/platforms/poll', async (req, res) => {
  try {
    const target = String(req.query.target || '').trim();
    const messagesToReturn = [];
    const queue = omnichannelCallMessages.get(target);
    if (queue && queue.length > 0) {
      messagesToReturn.push(...queue);
      omnichannelCallMessages.set(target, []);
    }
    return res.json({ ok: true, messages: messagesToReturn });
  } catch {
    return res.json({ ok: true, messages: [] });
  }
});

router.get('/caller/webhooks/:platform', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && challenge) {
    return res.status(200).send(challenge);
  }
  return res.json({ ok: true, status: 'listening', platform: req.params.platform });
});

router.post('/caller/webhooks/:platform', (req, res) => {
  return res.json({ ok: true, received: true, platform: req.params.platform });
});

apiApp.use('/api', router);
apiApp.use('/', router);

export default apiApp;
