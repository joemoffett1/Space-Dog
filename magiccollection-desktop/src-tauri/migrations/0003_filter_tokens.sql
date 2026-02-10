CREATE TABLE IF NOT EXISTS filter_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, token)
);

CREATE INDEX IF NOT EXISTS idx_filter_tokens_token
  ON filter_tokens(token COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_filter_tokens_label
  ON filter_tokens(label COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_filter_tokens_priority
  ON filter_tokens(priority, token COLLATE NOCASE);
