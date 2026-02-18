PRAGMA foreign_keys = OFF;

ALTER TABLE card_data_card_prices RENAME TO card_data_card_prices_legacy_0009;
DROP INDEX IF EXISTS idx_card_data_card_prices_unique_snapshot;
DROP INDEX IF EXISTS idx_card_data_card_prices_printing_time;
DROP INDEX IF EXISTS idx_card_data_card_prices_sync_version;

CREATE TABLE card_data_card_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  printing_id TEXT NOT NULL REFERENCES card_data_printings(id) ON DELETE CASCADE,
  condition_id INTEGER REFERENCES card_data_condition_codes(id) ON DELETE RESTRICT,
  finish_id INTEGER REFERENCES card_data_finish_codes(id) ON DELETE RESTRICT,
  tcg_low NUMERIC,
  tcg_market NUMERIC,
  tcg_high NUMERIC,
  ck_sell NUMERIC,
  ck_buylist NUMERIC,
  ck_buylist_quantity_cap INTEGER,
  sync_version TEXT NOT NULL,
  captured_ymd INTEGER,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_card_data_card_prices_unique_snapshot
  ON card_data_card_prices(
    printing_id,
    IFNULL(condition_id, 0),
    IFNULL(finish_id, 0),
    sync_version
  );

CREATE INDEX idx_card_data_card_prices_printing_time
  ON card_data_card_prices(printing_id, captured_ymd DESC);

CREATE INDEX idx_card_data_card_prices_sync_version
  ON card_data_card_prices(sync_version, captured_ymd DESC);

INSERT INTO card_data_card_prices (
  printing_id,
  condition_id,
  finish_id,
  tcg_low,
  tcg_market,
  tcg_high,
  ck_sell,
  ck_buylist,
  ck_buylist_quantity_cap,
  sync_version,
  captured_ymd,
  captured_at,
  created_at
)
SELECT
  printing_id,
  condition_id,
  finish_id,
  tcg_low,
  COALESCE(tcg_market, tcg_mid),
  tcg_high,
  ck_sell,
  ck_buylist,
  ck_buylist_quantity_cap,
  sync_version,
  captured_ymd,
  captured_at,
  created_at
FROM card_data_card_prices_legacy_0009;

DROP TABLE card_data_card_prices_legacy_0009;

PRAGMA foreign_keys = ON;
