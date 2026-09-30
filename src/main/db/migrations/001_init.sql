-- 001_init: 数据方舟索引库核心 Schema
-- 本库是可随时删除重建的派生层；所有 Agent 源数据永不写入。

-- 会话表：软删除(回收站) + 分组 + 收藏 + 幂等键 UNIQUE(source, ext_id)
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  ext_id        TEXT NOT NULL,
  title         TEXT,
  directory     TEXT,
  parent_ext_id TEXT,
  started_at    INTEGER,
  updated_at    INTEGER,
  msg_count     INTEGER DEFAULT 0,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost          REAL,
  starred       INTEGER DEFAULT 0,
  group_id      TEXT,
  deleted_at    INTEGER,
  UNIQUE (source, ext_id)
);

-- 消息表：blocks 为 JSON 文本（ContentBlock[]），FTS 由其落索引
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,
  sent_at       INTEGER,
  agent_name    TEXT,
  model_name    TEXT,
  provider      TEXT,
  finish_reason TEXT,
  blocks        TEXT NOT NULL, -- JSON: ContentBlock[]
  UNIQUE (session_id, seq)
);

-- 会话分组
CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER
);

-- 增量高水位：每 (source, ext_id) 一条游标
CREATE TABLE IF NOT EXISTS read_state (
  source     TEXT NOT NULL,
  ext_id     TEXT NOT NULL,
  high_water INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER,
  PRIMARY KEY (source, ext_id)
);

-- 设置项：value 为 JSON 文本
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 全文索引：独立表 + rowid 对齐 messages.id（trigram 分词器，支持中文子串搜索）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5 (
  text,
  tokenize = 'trigram'
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions (updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages (session_id, seq);
