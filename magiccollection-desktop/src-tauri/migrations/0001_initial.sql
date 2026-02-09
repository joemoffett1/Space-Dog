PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  oracle_id TEXT,
  name TEXT NOT NULL,
  mana_cost TEXT,
  cmc REAL,
  colors_json TEXT,
  color_identity_json TEXT,
  type_line TEXT,
  oracle_text TEXT,
  reserved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS printings (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  scryfall_id TEXT NOT NULL UNIQUE,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  rarity TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  is_token INTEGER NOT NULL DEFAULT 0,
  image_normal_url TEXT,
  image_small_url TEXT,
  image_art_crop_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_printings_card ON printings(card_id);
CREATE INDEX IF NOT EXISTS idx_printings_set_collector ON printings(set_code, collector_number);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'box',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, name)
);

CREATE TABLE IF NOT EXISTS owned_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL REFERENCES printings(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  foil_quantity INTEGER NOT NULL DEFAULT 0,
  condition_code TEXT NOT NULL DEFAULT 'NM',
  language TEXT NOT NULL DEFAULT 'en',
  purchase_price NUMERIC,
  date_added TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, printing_id, condition_code, language, location_id)
);

CREATE INDEX IF NOT EXISTS idx_owned_profile ON owned_items(profile_id);
CREATE INDEX IF NOT EXISTS idx_owned_printing ON owned_items(printing_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(profile_id, name)
);

CREATE TABLE IF NOT EXISTS owned_item_tags (
  owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owned_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL REFERENCES printings(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  foil_quantity_delta INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC,
  source TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_profile_time ON transactions(profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_printing ON transactions(printing_id);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  printing_id TEXT NOT NULL REFERENCES printings(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  channel TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  condition_code TEXT NOT NULL DEFAULT 'NM',
  is_foil INTEGER NOT NULL DEFAULT 0,
  market_price NUMERIC,
  low_price NUMERIC,
  direct_low_price NUMERIC,
  source_market_url TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_printing_time
  ON price_snapshots(printing_id, vendor, channel, condition_code, is_foil, captured_at DESC);

CREATE TABLE IF NOT EXISTS buylist_offers (
  id TEXT PRIMARY KEY,
  printing_id TEXT NOT NULL REFERENCES printings(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  condition_code TEXT NOT NULL DEFAULT 'NM',
  is_foil INTEGER NOT NULL DEFAULT 0,
  buy_price_cash NUMERIC,
  buy_price_credit NUMERIC,
  credit_multiplier NUMERIC,
  quantity_cap INTEGER,
  buylist_url TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buylist_offers_printing_time
  ON buylist_offers(printing_id, vendor, condition_code, is_foil, captured_at DESC);
