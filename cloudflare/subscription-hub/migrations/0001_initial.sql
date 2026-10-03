PRAGMA foreign_keys=ON;
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 100,
  refresh_minutes INTEGER NOT NULL DEFAULT 360,
  last_success_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  protocol TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_id,fingerprint)
);
CREATE INDEX nodes_source ON nodes(source_id,sort_order);
CREATE TABLE subscriptions (
  token_hash TEXT PRIMARY KEY,
  encrypted_token TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  last_access_at INTEGER
);
CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  rule_sha TEXT,
  node_count INTEGER,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
