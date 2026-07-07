-- ============================================================
-- QingH Studio — Cloudflare D1 Database Schema
-- 运行方式：npx wrangler d1 execute qingh-db --file=./schema.sql
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE DEFAULT NULL,
  username      TEXT UNIQUE DEFAULT NULL,
  role          TEXT DEFAULT 'user',
  password_hash TEXT NOT NULL,
  api_key          TEXT DEFAULT '',
  api_provider     TEXT DEFAULT 'anthropic',
  model            TEXT DEFAULT 'claude-sonnet-4-6',
  baidu_secret_key TEXT DEFAULT '',
  custom_api_url   TEXT DEFAULT '',
  vip_level        INTEGER DEFAULT 0,          -- 0=免费, 1=月费会员
  vip_expires_at TEXT DEFAULT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- 聊天会话表
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT DEFAULT '新的对话',
  mode       TEXT DEFAULT 'chat',            -- 'chat' | 'novel'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,                   -- 'user' | 'assistant' | 'system'
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

-- 世界观表
CREATE TABLE IF NOT EXISTS worlds (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#7c5cfc',
  description TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_worlds_user ON worlds(user_id);

-- 角色卡表
CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  world_id    TEXT DEFAULT '',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);

-- 补充设定表（per-session）
CREATE TABLE IF NOT EXISTS supplements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supplements_session ON supplements(session_id);

-- 上传文件暂存表（文件内容，不存储二进制）
CREATE TABLE IF NOT EXISTS uploaded_files (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  content TEXT NOT NULL,
  size    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_user ON uploaded_files(user_id);
