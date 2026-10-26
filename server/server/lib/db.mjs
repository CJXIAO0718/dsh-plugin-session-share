// SQLite 存储（node:sqlite DatabaseSync，无原生依赖）。单进程写入，WAL 模式。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = resolve(here, '..', '..')

export const DEFAULTS = {
  dbPath: resolve(PROJECT_ROOT, 'data', 'margin.db'),
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  persistent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  suffix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner_id);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  expires_at TEXT,
  snapshot_bytes INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  redactions INTEGER,
  tools INTEGER,
  turns INTEGER,
  user_messages INTEGER,
  context_messages INTEGER,
  assistant_messages INTEGER,
  tool_calls INTEGER,
  source_generator TEXT,
  source_session_id TEXT,
  json TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_shares_created ON shares(created_at);
CREATE INDEX IF NOT EXISTS idx_shares_cleanup_expiry ON shares(expires_at, id) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shares_owner_created_live ON shares(owner_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shares_created_live ON shares(created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function openDatabase(dbPath = DEFAULTS.dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

export function nowIso() {
  return new Date().toISOString()
}

/** A bounded batch; active sessions and all share data remain untouched. */
export function pruneExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at <= ? LIMIT 1000)').run(nowIso()).changes
}

export function audit(db, actor, action, detail = null) {
  db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
    nowIso(),
    actor ?? null,
    action,
    detail === null ? null : JSON.stringify(detail),
  )
}

export function metaGet(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : null
}

export function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
