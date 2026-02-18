PRAGMA foreign_keys = ON;

-- =====================================================
-- v2 logical schema groups in SQLite-safe table names.
-- =====================================================

-- ------------------------------
-- collection_data_* tables
-- ------------------------------

CREATE TABLE IF NOT EXISTS collection_data_auth_accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT,
  password_algo TEXT NOT NULL DEFAULT 'sha256',
  is_local_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS collection_data_auth_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES collection_data_auth_accounts(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  device_label TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_data_auth_sessions_account
  ON collection_data_auth_sessions(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_data_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  owner_account_id TEXT REFERENCES collection_data_auth_accounts(id) ON DELETE SET NULL,
  is_local_profile INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_data_profiles_display_name
  ON collection_data_profiles(display_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collection_data_collections (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES collection_data_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_data_collections_profile
  ON collection_data_collections(profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_data_collections_profile_name
  ON collection_data_collections(profile_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collection_data_locations (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection_data_collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'box',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_data_locations_collection_name
  ON collection_data_locations(collection_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collection_data_collection_items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection_data_collections(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  quantity_nonfoil INTEGER NOT NULL DEFAULT 0,
  quantity_foil INTEGER NOT NULL DEFAULT 0,
  condition_code TEXT NOT NULL DEFAULT 'NM',
  language TEXT NOT NULL DEFAULT 'en',
  purchase_price NUMERIC,
  acquired_at TEXT,
  location_id TEXT REFERENCES collection_data_locations(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_data_items_unique_row
  ON collection_data_collection_items(collection_id, printing_id, condition_code, language, IFNULL(location_id, ''));

CREATE INDEX IF NOT EXISTS idx_collection_data_items_collection
  ON collection_data_collection_items(collection_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_data_items_printing
  ON collection_data_collection_items(printing_id);

CREATE TABLE IF NOT EXISTS collection_data_tags (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection_data_collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color_hex TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_data_tags_collection_name
  ON collection_data_tags(collection_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collection_data_collection_item_tags (
  collection_item_id TEXT NOT NULL REFERENCES collection_data_collection_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES collection_data_tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collection_data_item_events (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collection_data_collections(id) ON DELETE CASCADE,
  collection_item_id TEXT REFERENCES collection_data_collection_items(id) ON DELETE SET NULL,
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  quantity_nonfoil_delta INTEGER NOT NULL,
  quantity_foil_delta INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_data_item_events_collection_time
  ON collection_data_item_events(collection_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_data_item_events_printing
  ON collection_data_item_events(printing_id, occurred_at DESC);

-- ------------------------------
-- card_data_* tables
-- ------------------------------

CREATE TABLE IF NOT EXISTS card_data_sets (
  set_code TEXT PRIMARY KEY,
  set_name TEXT NOT NULL,
  set_type TEXT,
  released_at TEXT,
  card_count INTEGER,
  icon_svg_uri TEXT,
  scryfall_set_uri TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_data_cards (
  id TEXT PRIMARY KEY,
  oracle_id TEXT UNIQUE,
  name TEXT NOT NULL,
  mana_cost TEXT,
  cmc REAL,
  type_line TEXT,
  oracle_text TEXT,
  reserved INTEGER NOT NULL DEFAULT 0,
  keywords_json TEXT,
  colors_json TEXT,
  color_identity_json TEXT,
  latest_released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_data_cards_name
  ON card_data_cards(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS card_data_printings (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES card_data_cards(id) ON DELETE CASCADE,
  oracle_id TEXT,
  set_code TEXT NOT NULL REFERENCES card_data_sets(set_code) ON DELETE RESTRICT,
  collector_number TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  rarity TEXT,
  layout TEXT,
  released_at TEXT,
  artist TEXT,
  image_normal_url TEXT,
  image_small_url TEXT,
  image_art_crop_url TEXT,
  image_png_url TEXT,
  is_token INTEGER NOT NULL DEFAULT 0,
  is_digital INTEGER NOT NULL DEFAULT 0,
  is_foil_available INTEGER NOT NULL DEFAULT 1,
  is_nonfoil_available INTEGER NOT NULL DEFAULT 1,
  tcgplayer_id INTEGER,
  cardmarket_id INTEGER,
  mtgo_id INTEGER,
  mtgo_foil_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_data_printings_card
  ON card_data_printings(card_id);

CREATE INDEX IF NOT EXISTS idx_card_data_printings_set_collector
  ON card_data_printings(set_code, collector_number);

CREATE INDEX IF NOT EXISTS idx_card_data_printings_oracle_release
  ON card_data_printings(oracle_id, released_at DESC);

CREATE TABLE IF NOT EXISTS card_data_card_faces (
  id TEXT PRIMARY KEY,
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  face_index INTEGER NOT NULL,
  name TEXT,
  mana_cost TEXT,
  type_line TEXT,
  oracle_text TEXT,
  colors_json TEXT,
  power TEXT,
  toughness TEXT,
  loyalty TEXT,
  defense TEXT,
  image_uris_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(printing_id, face_index)
);

CREATE TABLE IF NOT EXISTS card_data_printing_parts (
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  related_scryfall_id TEXT NOT NULL,
  component TEXT,
  name TEXT,
  type_line TEXT,
  uri TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (printing_id, related_scryfall_id)
);

CREATE TABLE IF NOT EXISTS card_data_legalities (
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  format_code TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (printing_id, format_code)
);

CREATE TABLE IF NOT EXISTS card_data_price_providers (
  id INTEGER PRIMARY KEY,
  provider_code TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  supports_sell INTEGER NOT NULL DEFAULT 1,
  supports_buylist INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_data_price_channels (
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES card_data_price_providers(id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  direction_code INTEGER NOT NULL,
  needs_condition INTEGER NOT NULL DEFAULT 0,
  needs_finish INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, channel_code)
);

CREATE TABLE IF NOT EXISTS card_data_currency_codes (
  id INTEGER PRIMARY KEY,
  currency_code TEXT NOT NULL UNIQUE,
  symbol TEXT
);

CREATE TABLE IF NOT EXISTS card_data_condition_codes (
  id INTEGER PRIMARY KEY,
  condition_code TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_data_finish_codes (
  id INTEGER PRIMARY KEY,
  finish_code TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_data_card_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES card_data_price_providers(id) ON DELETE RESTRICT,
  channel_id INTEGER NOT NULL REFERENCES card_data_price_channels(id) ON DELETE RESTRICT,
  currency_id INTEGER NOT NULL REFERENCES card_data_currency_codes(id) ON DELETE RESTRICT,
  condition_id INTEGER REFERENCES card_data_condition_codes(id) ON DELETE RESTRICT,
  finish_id INTEGER REFERENCES card_data_finish_codes(id) ON DELETE RESTRICT,
  amount NUMERIC,
  credit_amount NUMERIC,
  credit_multiplier NUMERIC,
  quantity_cap INTEGER,
  sync_version TEXT NOT NULL,
  captured_ymd INTEGER,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_data_card_prices_unique_snapshot
  ON card_data_card_prices(
    printing_id,
    provider_id,
    channel_id,
    currency_id,
    IFNULL(condition_id, 0),
    IFNULL(finish_id, 0),
    sync_version
  );

CREATE INDEX IF NOT EXISTS idx_card_data_card_prices_printing_time
  ON card_data_card_prices(printing_id, captured_ymd DESC);

CREATE INDEX IF NOT EXISTS idx_card_data_card_prices_provider_channel_time
  ON card_data_card_prices(provider_id, channel_id, captured_ymd DESC);

CREATE TABLE IF NOT EXISTS card_data_otags (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  tag_code TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(source, tag_code)
);

CREATE TABLE IF NOT EXISTS card_data_printing_otags (
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  otag_id TEXT NOT NULL REFERENCES card_data_otags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (printing_id, otag_id)
);

-- ------------------------------
-- system_data_sync_* tables
-- ------------------------------

CREATE TABLE IF NOT EXISTS system_data_sync_data_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  refresh_window_utc TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_data_sync_dataset_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES system_data_sync_data_sources(id) ON DELETE CASCADE,
  dataset_name TEXT NOT NULL,
  build_version TEXT NOT NULL,
  state_hash TEXT,
  record_count INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, dataset_name, build_version)
);

CREATE TABLE IF NOT EXISTS system_data_sync_patches (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES system_data_sync_data_sources(id) ON DELETE CASCADE,
  dataset_name TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT NOT NULL,
  patch_hash TEXT,
  strategy TEXT NOT NULL,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  artifact_uri TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_data_sync_patches_dataset_time
  ON system_data_sync_patches(dataset_name, created_at DESC);

CREATE TABLE IF NOT EXISTS system_data_sync_client_sync_state (
  client_id TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  current_version TEXT,
  state_hash TEXT,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, dataset_name)
);

CREATE TABLE IF NOT EXISTS system_data_sync_patch_apply_history (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT NOT NULL,
  strategy TEXT NOT NULL,
  duration_ms INTEGER,
  result TEXT NOT NULL,
  error_message TEXT,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_data_sync_patch_apply_dataset_time
  ON system_data_sync_patch_apply_history(dataset_name, applied_at DESC);

-- =====================================================
-- Seed compact dictionaries and sources.
-- =====================================================

INSERT OR IGNORE INTO card_data_price_providers
  (id, provider_code, provider_name, supports_sell, supports_buylist, is_active, updated_at)
VALUES
  (1, 'scryfall', 'Scryfall', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 'ck', 'Card Kingdom', 0, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, 'tcgplayer', 'TCGplayer', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (4, 'cardmarket', 'Cardmarket', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (99, 'unknown', 'Unknown Provider', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO card_data_price_channels
  (id, provider_id, channel_code, channel_name, direction_code, needs_condition, needs_finish, updated_at)
VALUES
  (1, 1, 'mkt', 'Market', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 1, 'low', 'Low', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, 1, 'dlow', 'Direct Low', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (4, 3, 'mkt', 'Market', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (5, 4, 'mkt', 'Market', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (10, 2, 'buy', 'Buylist', 2, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (97, 99, 'other', 'Other', 1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO card_data_currency_codes (id, currency_code, symbol)
VALUES
  (1, 'USD', '$'),
  (2, 'EUR', 'EUR'),
  (3, 'TIX', 'TIX'),
  (99, 'UNK', NULL);

INSERT OR IGNORE INTO card_data_condition_codes (id, condition_code, sort_order)
VALUES
  (1, 'NM', 1),
  (2, 'LP', 2),
  (3, 'MP', 3),
  (4, 'HP', 4),
  (5, 'DMG', 5),
  (99, 'UNK', 99);

INSERT OR IGNORE INTO card_data_finish_codes (id, finish_code, sort_order)
VALUES
  (1, 'N', 1),
  (2, 'F', 2),
  (3, 'E', 3),
  (99, 'U', 99);

INSERT OR IGNORE INTO system_data_sync_data_sources
  (id, kind, base_url, enabled, refresh_window_utc, updated_at)
VALUES
  ('scryfall_default_cards', 'snapshot', 'https://api.scryfall.com/bulk-data', 1, '22:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ck_buylist', 'snapshot', 'https://api.cardkingdom.com/api/v2/pricelist', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO collection_data_auth_accounts
  (id, email, username, password_hash, password_algo, is_local_only, created_at, updated_at)
VALUES
  ('local-account', NULL, 'local', NULL, 'none', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- =====================================================

-- Legacy backfill/triggers removed in v2-only cleanup.
