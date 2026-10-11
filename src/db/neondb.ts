import pg, { type Pool as PoolType } from 'pg';
import crypto from 'crypto';
import type { Conversation, ThemeDefinition } from '../types';
import { SECRET_WARDROBE_OUTFITS, resolveSecretOutfitsByRedeemCode } from '../constants';

const { Pool } = pg;

export const DEFAULT_USER_AVATAR_URL = 'https://ai.mux8.com/favicon.png';

export interface DbUserRecord {
  id: number;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string;
  account_type: 'free' | 'paid';
  last_payment: string | null;
  last_login_time: string;
  last_login_device: string;
  device_fingerprints: string[];
  equipped_outfit_id: string;
  unlocked_outfits: string[];
  active_theme_id: string;
  created_at: string;
}

interface InternalUserRecord extends DbUserRecord {
  password_hash: string;
}

// ---------------------------------------------------------------------
// Password Hashing Helpers (Node built-in crypto.scryptSync)
// ---------------------------------------------------------------------
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// In-Memory Active User Passwords & AES-256-GCM Message Encryption
// Encrypts conversations and messages so NeonDB only stores encrypted data
// ---------------------------------------------------------------------
export const activeUserPasswords = new Map<number, string>();

function deriveEncryptionKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32);
}

export function encryptWithPassword(plainText: string, password?: string): string {
  if (!plainText || !password) return plainText;
  if (plainText.startsWith('enc::')) return plainText; // avoid double-encryption
  try {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveEncryptionKey(password, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc::${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.warn('Message encryption failed, keeping content:', err);
    return plainText;
  }
}

export function decryptWithPassword(cipherText: string, password?: string): string {
  if (!cipherText || !cipherText.startsWith('enc::') || !password) return cipherText;
  try {
    const parts = cipherText.split(':');
    if (parts.length < 6) return cipherText;
    const salt = Buffer.from(parts[2], 'hex');
    const iv = Buffer.from(parts[3], 'hex');
    const tag = Buffer.from(parts[4], 'hex');
    const encryptedData = Buffer.from(parts[5], 'hex');
    const key = deriveEncryptionKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return cipherText;
  }
}

function sanitizeUser(u: InternalUserRecord | DbUserRecord): DbUserRecord {
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

// ---------------------------------------------------------------------
// NeonDB PostgreSQL Connection Pool (configured via NEON_DATABASE_URL)
// ---------------------------------------------------------------------
let neonPool: PoolType | null = null;
let schemaInitialized = false;

function normalizeNeonConnectionString(rawUrl: string): string {
  const unquoted = rawUrl.trim().replace(/^["']+|["']+$/g, '').trim();
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

function getNeonPool(): PoolType | null {
  if (neonPool) return neonPool;

  const rawConnectionString = process.env.NEON_DATABASE_URL || '';
  const connectionString = normalizeNeonConnectionString(rawConnectionString);

  if (!connectionString) {
    return null;
  }

  neonPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 3000,
    allowExitOnIdle: true,
  });

  neonPool.on('error', (err) => {
    console.error('NeonDB idle client error:', err.message);
  });

  return neonPool;
}

export async function checkNeonDbConnected(): Promise<boolean> {
  const pool = getNeonPool();
  if (!pool) return false;
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch (err) {
    return false;
  }
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

CREATE TABLE IF NOT EXISTS user_redeemed_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_user_redeemed_codes_user ON user_redeemed_codes(user_id);

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
`;

async function ensureNeonSchema(): Promise<PoolType | null> {
  const pool = getNeonPool();
  if (!pool) return null;
  if (schemaInitialized) return pool;

  try {
    await pool.query(INIT_NEONDB_SQL);
    schemaInitialized = true;
    return pool;
  } catch (err) {
    console.warn('NeonDB schema auto-init warning:', err);
    // Test basic connectivity so if tables already exist in NeonDB we still use the pool
    try {
      await pool.query('SELECT 1');
      schemaInitialized = true;
      return pool;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------
// Fallback In-Memory Store (Used when NeonDB env vars are not yet set)
// ---------------------------------------------------------------------
const fallbackUsers = new Map<string, InternalUserRecord>();
const fallbackConversations = new Map<number, Conversation[]>();
const fallbackCustomThemes = new Map<number, ThemeDefinition[]>();
const fallbackRedeemedByUser = new Map<number, Set<string>>();
const validPaidRedeemCodes = new Set<string>([
  'MUXAI-PREMIUM-2026',
  'HANA-VIP',
  'AISMASH-PRO',
]);
let fallbackNextUserId = 1;

function deriveDefaultProfileFromEmail(email: string) {
  const localPart = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_.-]/g, '');
  const cleanUsername = (localPart || 'hana_fan').toLowerCase().slice(0, 24);
  const displayName =
    cleanUsername.charAt(0).toUpperCase() + cleanUsername.slice(1).replace(/[._-]+/g, ' ');
  return {
    username: cleanUsername,
    displayName: displayName || 'MuxAI User',
  };
}

// ---------------------------------------------------------------------
// Auth & Account Operations
// ---------------------------------------------------------------------
export async function signUpAccount(params: {
  email: string;
  password: string;
  device: string;
  fingerprint: string;
}): Promise<{ user: DbUserRecord; conversations: Conversation[]; customThemes: ThemeDefinition[] }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const passwordHash = hashPassword(params.password);
  const { username, displayName } = deriveDefaultProfileFromEmail(cleanEmail);
  const defaultAvatar = DEFAULT_USER_AVATAR_URL;
  const nowIso = new Date().toISOString();
  const deviceLabel = (params.device || 'Web Browser').slice(0, 180);
  const fingerprints = params.fingerprint ? [params.fingerprint] : [];

  const pool = await ensureNeonSchema();
  if (pool) {
    try {
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
      activeUserPasswords.set(user.id, params.password);
      return { user, conversations: [], customThemes: [] };
    } catch (err: any) {
      if (err.message && err.message.includes('already exists')) {
        throw err;
      }
      console.warn('NeonDB query error, falling back to in-memory storage:', err?.message);
    }
  }

  // Fallback when NeonDB env vars are not configured yet
  if (fallbackUsers.has(cleanEmail)) {
    throw new Error('An account with this email address already exists.');
  }

  const newUser: InternalUserRecord = {
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
  activeUserPasswords.set(newUser.id, params.password);

  return {
    user: sanitizeUser(newUser),
    conversations: [],
    customThemes: [],
  };
}

export async function signInAccount(params: {
  email: string;
  password: string;
  device: string;
  fingerprint: string;
}): Promise<{ user: DbUserRecord; conversations: Conversation[]; customThemes: ThemeDefinition[] }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const deviceLabel = (params.device || 'Web Browser').slice(0, 180);

  const pool = await ensureNeonSchema();
  if (pool) {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (res.rows.length === 0) {
      throw new Error('Invalid email address or password.');
    }

    const row = res.rows[0] as InternalUserRecord;
    if (!verifyPassword(params.password, row.password_hash)) {
      throw new Error('Invalid email address or password.');
    }

    const existingFps: string[] = Array.isArray(row.device_fingerprints) ? row.device_fingerprints : [];
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
    activeUserPasswords.set(user.id, params.password);
    const userData = await fetchUserSyncedData(user.id, params.password);
    return {
      user,
      conversations: userData.conversations,
      customThemes: userData.customThemes,
    };
  }

  // Fallback store
  const stored = fallbackUsers.get(cleanEmail);
  if (!stored || !verifyPassword(params.password, stored.password_hash)) {
    throw new Error('Invalid email address or password.');
  }

  stored.last_login_time = nowIso;
  stored.last_login_device = deviceLabel;
  if (params.fingerprint && !stored.device_fingerprints.includes(params.fingerprint)) {
    stored.device_fingerprints.push(params.fingerprint);
  }

  activeUserPasswords.set(stored.id, params.password);
  const rawConvs = fallbackConversations.get(stored.id) || [];
  const decryptedConvs: Conversation[] = rawConvs.map((conv) => ({
    ...conv,
    title: decryptWithPassword(conv.title, params.password),
    messages: (conv.messages || []).map((m) => ({
      ...m,
      content: decryptWithPassword(m.content, params.password),
    })),
  }));

  return {
    user: sanitizeUser(stored),
    conversations: decryptedConvs,
    customThemes: fallbackCustomThemes.get(stored.id) || [],
  };
}

export async function updateAccountProfile(params: {
  userId: number;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  equippedOutfitId?: string;
  unlockedOutfits?: string[];
  activeThemeId?: string;
}): Promise<DbUserRecord> {
  const pool = await ensureNeonSchema();
  if (pool) {
    const existingRes = await pool.query('SELECT * FROM users WHERE id = $1', [params.userId]);
    if (existingRes.rows.length === 0) {
      throw new Error('User account not found.');
    }
    const cur = existingRes.rows[0] as InternalUserRecord;

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
      if (params.username !== undefined && params.username.trim()) {
        u.username = params.username.trim();
      }
      if (params.displayName !== undefined && params.displayName.trim()) {
        u.display_name = params.displayName.trim();
      }
      if (params.avatarUrl !== undefined && params.avatarUrl.trim()) {
        u.avatar_url = params.avatarUrl.trim();
      }
      if (params.equippedOutfitId !== undefined && params.equippedOutfitId.trim()) {
        u.equipped_outfit_id = params.equippedOutfitId.trim();
      }
      if (Array.isArray(params.unlockedOutfits)) {
        const curUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
        u.unlocked_outfits = Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]));
      }
      if (params.activeThemeId !== undefined && params.activeThemeId.trim()) {
        u.active_theme_id = params.activeThemeId.trim();
      }
      return sanitizeUser(u);
    }
  }

  throw new Error('User account not found.');
}

export async function redeemAccountCode(params: {
  userId: number;
  code: string;
}): Promise<DbUserRecord> {
  const cleanCode = (params.code || '').trim().toUpperCase();
  if (!cleanCode) {
    throw new Error('Please enter a valid redeem code.');
  }

  const nowIso = new Date().toISOString();
  const matchedSecretOutfits = resolveSecretOutfitsByRedeemCode(cleanCode);
  const matchedSecretIds = matchedSecretOutfits.map((o) => o.id);
  const isBuiltInPaidCode = validPaidRedeemCodes.has(cleanCode);

  const pool = await ensureNeonSchema();

  if (pool) {
    const alreadyRedeemedRes = await pool.query(
      'SELECT 1 FROM user_redeemed_codes WHERE user_id = $1 AND UPPER(code) = $2',
      [params.userId, cleanCode]
    );
    if (alreadyRedeemedRes.rows.length > 0) {
      throw new Error('You have already applied this redeem code.');
    }

    const codeRes = await pool.query('SELECT * FROM redeem_codes WHERE UPPER(code) = $1', [cleanCode]);
    const hasDbRow = codeRes.rows.length > 0;

    if (!hasDbRow && !isBuiltInPaidCode && matchedSecretIds.length === 0) {
      throw new Error('Invalid or expired redeem code.');
    }

    let dbGrantPaid = isBuiltInPaidCode;
    let dbOutfitGrants: string[] = [...matchedSecretIds];

    if (hasDbRow) {
      const codeRow = codeRes.rows[0];
      if (Array.isArray(codeRow.redeemed_by) && codeRow.redeemed_by.includes(params.userId)) {
        throw new Error('You have already applied this redeem code.');
      }

      if (Number(codeRow.used_count) >= Number(codeRow.max_uses)) {
        throw new Error('This redeem code has reached its usage limit.');
      }

      if (codeRow.account_type_grant === 'paid') {
        dbGrantPaid = true;
      }

      if (Array.isArray(codeRow.unlocked_outfit_ids) && codeRow.unlocked_outfit_ids.length > 0) {
        if (
          codeRow.unlocked_outfit_ids.includes('*') ||
          codeRow.unlocked_outfit_ids.includes('ALL')
        ) {
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

    await pool.query(
      `INSERT INTO user_redeemed_codes (user_id, code) VALUES ($1, $2) ON CONFLICT (user_id, code) DO NOTHING`,
      [params.userId, cleanCode]
    );

    const existingUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [params.userId]);
    if (existingUserRes.rows.length === 0) {
      throw new Error('User account not found.');
    }

    const curUser = existingUserRes.rows[0] as InternalUserRecord;
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

  // Fallback verification when NeonDB is not configured
  const userRedeemed = fallbackRedeemedByUser.get(params.userId);
  if (userRedeemed && userRedeemed.has(cleanCode)) {
    throw new Error('You have already applied this redeem code.');
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
      if (!fallbackRedeemedByUser.has(params.userId)) {
        fallbackRedeemedByUser.set(params.userId, new Set());
      }
      fallbackRedeemedByUser.get(params.userId)!.add(cleanCode);
      return sanitizeUser(u);
    }
  }

  throw new Error('User account not found.');
}

export async function fetchUserSyncedData(userId: number, password?: string): Promise<{
  conversations: Conversation[];
  customThemes: ThemeDefinition[];
  unlockedOutfits: string[];
}> {
  const effectivePassword = password || activeUserPasswords.get(userId);
  const pool = await ensureNeonSchema();
  if (pool) {
    const userRes = await pool.query('SELECT unlocked_outfits FROM users WHERE id = $1', [userId]);
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

    const msgsByConv = new Map<string, Conversation['messages']>();
    for (const m of msgRes.rows) {
      const list = msgsByConv.get(m.conversation_id) || [];
      const decryptedContent = effectivePassword
        ? decryptWithPassword(m.content, effectivePassword)
        : m.content;
      list.push({
        id: m.id,
        role: m.role,
        content: decryptedContent,
        timestamp: Number(m.timestamp),
        modelUsed: m.model_used || undefined,
        tokensCount: m.tokens_count ? Number(m.tokens_count) : undefined,
        generationTimeMs: m.generation_time_ms ? Number(m.generation_time_ms) : undefined,
        speedTps: m.speed_tps ? Number(m.speed_tps) : undefined,
        error: Boolean(m.error),
      });
      msgsByConv.set(m.conversation_id, list);
    }

    const conversations: Conversation[] = convRes.rows.map((c) => ({
      id: c.id,
      title: effectivePassword ? decryptWithPassword(c.title, effectivePassword) : c.title,
      createdAt: Number(c.created_at),
      updatedAt: Number(c.updated_at),
      pinned: Boolean(c.pinned),
      modelId: c.model_id || undefined,
      messages: msgsByConv.get(c.id) || [],
    }));

    const customThemes: ThemeDefinition[] = themeRes.rows.map((t) => ({
      id: t.id,
      name: t.name,
      isDark: Boolean(t.is_dark),
      description: t.description || undefined,
      colors: typeof t.colors === 'string' ? JSON.parse(t.colors) : t.colors,
      isCustom: true,
      createdAt: Number(t.created_at),
    }));

    const unlockedOutfits: string[] = Array.isArray(userRes.rows[0]?.unlocked_outfits)
      ? userRes.rows[0].unlocked_outfits
      : [];

    return { conversations, customThemes, unlockedOutfits };
  }

  let fallbackUnlocked: string[] = [];
  for (const u of fallbackUsers.values()) {
    if (u.id === userId) {
      fallbackUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
      break;
    }
  }

  const rawConvs = fallbackConversations.get(userId) || [];
  const decryptedConvs: Conversation[] = rawConvs.map((conv) => ({
    ...conv,
    title: effectivePassword ? decryptWithPassword(conv.title, effectivePassword) : conv.title,
    messages: (conv.messages || []).map((m) => ({
      ...m,
      content: effectivePassword ? decryptWithPassword(m.content, effectivePassword) : m.content,
    })),
  }));

  return {
    conversations: decryptedConvs,
    customThemes: fallbackCustomThemes.get(userId) || [],
    unlockedOutfits: fallbackUnlocked,
  };
}

export async function syncUserConversationsAndThemes(params: {
  userId: number;
  conversations?: Conversation[];
  customThemes?: ThemeDefinition[];
  unlockedOutfits?: string[];
  password?: string;
}): Promise<void> {
  const effectivePassword = params.password || activeUserPasswords.get(params.userId);
  const pool = await ensureNeonSchema();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (Array.isArray(params.unlockedOutfits) && params.unlockedOutfits.length > 0) {
        const userRes = await client.query('SELECT unlocked_outfits FROM users WHERE id = $1', [
          params.userId,
        ]);
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

      if (Array.isArray(params.conversations)) {
        for (const conv of params.conversations) {
          const encTitle = effectivePassword
            ? encryptWithPassword(conv.title || 'Direct Message', effectivePassword)
            : conv.title || 'Direct Message';

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
              encTitle,
              conv.modelId || 'smollm2-135m',
              Boolean(conv.pinned),
              Number(conv.createdAt) || Date.now(),
              Number(conv.updatedAt) || Date.now(),
            ]
          );

          for (const msg of conv.messages || []) {
            const encContent = effectivePassword
              ? encryptWithPassword(msg.content, effectivePassword)
              : msg.content;

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
                encContent,
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

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  if (Array.isArray(params.unlockedOutfits) && params.unlockedOutfits.length > 0) {
    for (const u of fallbackUsers.values()) {
      if (u.id === params.userId) {
        const curUnlocked = Array.isArray(u.unlocked_outfits) ? u.unlocked_outfits : [];
        u.unlocked_outfits = Array.from(new Set([...curUnlocked, ...params.unlockedOutfits]));
        break;
      }
    }
  }
  if (Array.isArray(params.conversations)) {
    const encConvs = effectivePassword
      ? params.conversations.map((c) => ({
          ...c,
          title: encryptWithPassword(c.title || 'Direct Message', effectivePassword),
          messages: (c.messages || []).map((m) => ({
            ...m,
            content: encryptWithPassword(m.content, effectivePassword),
          })),
        }))
      : params.conversations;
    fallbackConversations.set(params.userId, encConvs);
  }
  if (Array.isArray(params.customThemes)) {
    fallbackCustomThemes.set(params.userId, params.customThemes);
  }
}

// =====================================================================
// AUTONOMOUS AI INTERVIEWS & RECRUITING SUITE (NeonDB Persistence)
// =====================================================================

export interface InterviewRecord {
  id: string;
  title: string;
  target_role: string;
  company_name: string;
  description: string;
  created_by_user_id?: number | null;
  created_by_email?: string | null;
  config: {
    openQuestionSilenceSeconds?: number;
    qaSilenceSeconds?: number;
    activeSilenceVoiceline?: string;
    showHana3DModel?: boolean;
    recruiterPersonaName?: string;
  };
  questions: Array<{
    id: string;
    phase: string;
    prompt: string;
    description?: string;
  }>;
  tasks: {
    requireResumeUpload?: boolean;
    requireWrittenReflection?: boolean;
    writtenPrompt?: string;
    minWrittenChars?: number;
    requirePressureRating?: boolean;
    requireSnapshotCheck?: boolean;
  };
  company_qa_knowledge?: Array<{
    title: string;
    keywords: string[];
    content: string;
  }>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InterviewSubmissionRecord {
  id: string;
  interview_id: string;
  candidate_name: string;
  candidate_email?: string;
  status: 'completed' | 'in_progress' | 'reviewed';
  score: number;
  responses: Array<{
    phase: string;
    question: string;
    answer: string;
    timestamp: string;
  }>;
  snapshots: Array<{
    id: string;
    angle: string;
    label: string;
    dataUrl: string;
    timestamp: string;
  }>;
  resume_data?: {
    fileName: string;
    fileSize: string;
    uploadedAt: string;
  } | null;
  written_task?: string;
  pressure_rating?: string;
  ai_evaluation?: {
    strengths: string[];
    areas_for_growth: string[];
    summary: string;
    recommendation: 'Strong Hire' | 'Hire' | 'Borderline' | 'Reject';
  };
  completed_at: string;
}

export const DEFAULT_DEMO_INTERVIEW: InterviewRecord = {
  id: 'demo',
  title: 'Senior Full Stack & AI Systems Engineer',
  target_role: 'Senior Full Stack & AI Systems Engineer',
  company_name: 'MuxAI',
  description: 'Autonomous technical screening with Hana covering core engineering background, complex architecture, written reflection, situational performance, and interactive Q&A.',
  created_by_user_id: null,
  created_by_email: 'recruiting@muxai.com',
  config: {
    openQuestionSilenceSeconds: 3.0,
    qaSilenceSeconds: 5.0,
    activeSilenceVoiceline: "I am assuming you have nothing else to say for now so let's move on to the next step.",
    showHana3DModel: true,
    recruiterPersonaName: 'Hana',
  },
  questions: [
    {
      id: 'q1',
      phase: 'question_1',
      prompt: "Let's begin with a quick introduction. Could you tell me a bit about yourself, your background, and what drives your passion for this role?",
      description: 'Introduction & Background',
    },
    {
      id: 'q2',
      phase: 'question_2',
      prompt: "Thank you. Now, could you walk me through a challenging technical problem or project you tackled recently? How did you approach resolving it?",
      description: 'Technical Problem Solving',
    },
  ],
  tasks: {
    requireResumeUpload: true,
    requireWrittenReflection: true,
    writtenPrompt: 'Please share three things you like about yourself and why. (Min 100 characters)',
    minWrittenChars: 100,
    requirePressureRating: true,
    requireSnapshotCheck: true,
  },
  company_qa_knowledge: [],
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export const fallbackInterviews = new Map<string, InterviewRecord>([
  ['demo', DEFAULT_DEMO_INTERVIEW],
]);
export const fallbackInterviewSubmissions = new Map<string, InterviewSubmissionRecord[]>();

export async function createInterviewInDb(interview: InterviewRecord): Promise<InterviewRecord> {
  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      const res = await pool.query(
        `INSERT INTO interviews (
          id, title, target_role, company_name, description,
          created_by_user_id, created_by_email, config, questions, tasks,
          company_qa_knowledge, active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          target_role = EXCLUDED.target_role,
          company_name = EXCLUDED.company_name,
          description = EXCLUDED.description,
          config = EXCLUDED.config,
          questions = EXCLUDED.questions,
          tasks = EXCLUDED.tasks,
          company_qa_knowledge = EXCLUDED.company_qa_knowledge,
          active = EXCLUDED.active,
          updated_at = NOW()
        RETURNING *`,
        [
          interview.id,
          interview.title,
          interview.target_role,
          interview.company_name || 'MuxAI',
          interview.description || '',
          interview.created_by_user_id || null,
          interview.created_by_email || null,
          JSON.stringify(interview.config || {}),
          JSON.stringify(interview.questions || []),
          JSON.stringify(interview.tasks || {}),
          JSON.stringify(interview.company_qa_knowledge || []),
          interview.active !== false,
        ]
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        const record: InterviewRecord = {
          id: row.id,
          title: row.title,
          target_role: row.target_role,
          company_name: row.company_name,
          description: row.description,
          created_by_user_id: row.created_by_user_id,
          created_by_email: row.created_by_email,
          config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {},
          questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions || [],
          tasks: typeof row.tasks === 'string' ? JSON.parse(row.tasks) : row.tasks || {},
          company_qa_knowledge: typeof row.company_qa_knowledge === 'string' ? JSON.parse(row.company_qa_knowledge) : row.company_qa_knowledge || [],
          active: row.active,
          created_at: new Date(row.created_at).toISOString(),
          updated_at: new Date(row.updated_at).toISOString(),
        };
        fallbackInterviews.set(record.id, record);
        return record;
      }
    } catch (err) {
      console.warn('NeonDB createInterview error, using in-memory store:', err);
    }
  }

  // Fallback in-memory
  const record: InterviewRecord = {
    ...interview,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  fallbackInterviews.set(record.id, record);
  return record;
}

export async function getInterviewByIdFromDb(id: string): Promise<InterviewRecord | null> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;

  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM interviews WHERE id = $1 LIMIT 1', [cleanId]);
      if (res.rows[0]) {
        const row = res.rows[0];
        const record: InterviewRecord = {
          id: row.id,
          title: row.title,
          target_role: row.target_role,
          company_name: row.company_name,
          description: row.description,
          created_by_user_id: row.created_by_user_id,
          created_by_email: row.created_by_email,
          config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {},
          questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions || [],
          tasks: typeof row.tasks === 'string' ? JSON.parse(row.tasks) : row.tasks || {},
          company_qa_knowledge: typeof row.company_qa_knowledge === 'string' ? JSON.parse(row.company_qa_knowledge) : row.company_qa_knowledge || [],
          active: row.active,
          created_at: new Date(row.created_at).toISOString(),
          updated_at: new Date(row.updated_at).toISOString(),
        };
        fallbackInterviews.set(record.id, record);
        return record;
      }
    } catch (err) {
      console.warn('NeonDB getInterview error, checking in-memory store:', err);
    }
  }

  return fallbackInterviews.get(cleanId) || (cleanId === 'demo' ? DEFAULT_DEMO_INTERVIEW : null);
}

export async function listInterviewsFromDb(userId?: number): Promise<InterviewRecord[]> {
  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      const query = userId
        ? 'SELECT * FROM interviews WHERE (created_by_user_id = $1 OR id = \'demo\') AND active = TRUE ORDER BY created_at DESC'
        : 'SELECT * FROM interviews WHERE active = TRUE ORDER BY created_at DESC';
      const params = userId ? [userId] : [];
      const res = await pool.query(query, params);
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          id: row.id,
          title: row.title,
          target_role: row.target_role,
          company_name: row.company_name,
          description: row.description,
          created_by_user_id: row.created_by_user_id,
          created_by_email: row.created_by_email,
          config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {},
          questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions || [],
          tasks: typeof row.tasks === 'string' ? JSON.parse(row.tasks) : row.tasks || {},
          company_qa_knowledge: typeof row.company_qa_knowledge === 'string' ? JSON.parse(row.company_qa_knowledge) : row.company_qa_knowledge || [],
          active: row.active,
          created_at: new Date(row.created_at).toISOString(),
          updated_at: new Date(row.updated_at).toISOString(),
        }));
      }
    } catch (err) {
      console.warn('NeonDB listInterviews error, using in-memory store:', err);
    }
  }

  const items = Array.from(fallbackInterviews.values()).filter((i) => i.active);
  if (!items.some((i) => i.id === 'demo')) {
    items.unshift(DEFAULT_DEMO_INTERVIEW);
  }
  return items;
}

export async function deleteInterviewFromDb(id: string, userId?: number): Promise<boolean> {
  const cleanId = String(id || '').trim();
  if (!cleanId || cleanId === 'demo') return false; // Protect default demo template

  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      if (userId) {
        await pool.query('DELETE FROM interviews WHERE id = $1 AND created_by_user_id = $2', [cleanId, userId]);
      } else {
        await pool.query('DELETE FROM interviews WHERE id = $1', [cleanId]);
      }
    } catch (err) {
      console.warn('NeonDB deleteInterview error:', err);
    }
  }

  fallbackInterviews.delete(cleanId);
  return true;
}

export async function submitInterviewSessionToDb(
  submission: InterviewSubmissionRecord
): Promise<InterviewSubmissionRecord> {
  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO interview_submissions (
          id, interview_id, candidate_name, candidate_email, status, score,
          responses, snapshots, resume_data, written_task, pressure_rating,
          ai_evaluation, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          submission.id,
          submission.interview_id,
          submission.candidate_name,
          submission.candidate_email || null,
          submission.status || 'completed',
          submission.score ?? 85,
          JSON.stringify(submission.responses || []),
          JSON.stringify(submission.snapshots || []),
          submission.resume_data ? JSON.stringify(submission.resume_data) : null,
          submission.written_task || '',
          submission.pressure_rating || '',
          submission.ai_evaluation ? JSON.stringify(submission.ai_evaluation) : null,
        ]
      );
    } catch (err) {
      console.warn('NeonDB submitInterviewSession error, using in-memory store:', err);
    }
  }

  const list = fallbackInterviewSubmissions.get(submission.interview_id) || [];
  list.unshift(submission);
  fallbackInterviewSubmissions.set(submission.interview_id, list);
  return submission;
}

export async function listInterviewSubmissionsFromDb(
  interviewId?: string
): Promise<InterviewSubmissionRecord[]> {
  const pool = await ensureNeonSchema();
  if (pool) {
    try {
      const query = interviewId
        ? 'SELECT * FROM interview_submissions WHERE interview_id = $1 ORDER BY completed_at DESC LIMIT 50'
        : 'SELECT * FROM interview_submissions ORDER BY completed_at DESC LIMIT 50';
      const params = interviewId ? [interviewId] : [];
      const res = await pool.query(query, params);
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          id: row.id,
          interview_id: row.interview_id,
          candidate_name: row.candidate_name,
          candidate_email: row.candidate_email,
          status: row.status,
          score: Number(row.score) || 85,
          responses: typeof row.responses === 'string' ? JSON.parse(row.responses) : row.responses || [],
          snapshots: typeof row.snapshots === 'string' ? JSON.parse(row.snapshots) : row.snapshots || [],
          resume_data: typeof row.resume_data === 'string' ? JSON.parse(row.resume_data) : row.resume_data,
          written_task: row.written_task,
          pressure_rating: row.pressure_rating,
          ai_evaluation: typeof row.ai_evaluation === 'string' ? JSON.parse(row.ai_evaluation) : row.ai_evaluation,
          completed_at: new Date(row.completed_at).toISOString(),
        }));
      }
    } catch (err) {
      console.warn('NeonDB listInterviewSubmissions error, using in-memory store:', err);
    }
  }

  if (interviewId) {
    return fallbackInterviewSubmissions.get(interviewId) || [];
  }
  const all: InterviewSubmissionRecord[] = [];
  for (const list of fallbackInterviewSubmissions.values()) {
    all.push(...list);
  }
  return all.sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));
}

