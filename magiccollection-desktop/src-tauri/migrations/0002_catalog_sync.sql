CREATE TABLE IF NOT EXISTS catalog_cards (
  scryfall_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_code TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  image_url TEXT,
  market_price NUMERIC NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_cards_name
  ON catalog_cards(name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_catalog_cards_set_collector
  ON catalog_cards(set_code, collector_number);

CREATE TABLE IF NOT EXISTS catalog_sync_state (
  dataset TEXT PRIMARY KEY,
  current_version TEXT,
  state_hash TEXT,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_patch_history (
  id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT NOT NULL,
  strategy TEXT NOT NULL,
  patch_hash TEXT,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  total_records INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_patch_history_dataset_time
  ON catalog_patch_history(dataset, applied_at DESC);
