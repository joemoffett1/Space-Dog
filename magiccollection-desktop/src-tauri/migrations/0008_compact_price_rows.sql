PRAGMA foreign_keys = OFF;

ALTER TABLE card_data_condition_codes ADD COLUMN condition_group_id INTEGER NOT NULL DEFAULT 99;

UPDATE card_data_condition_codes
SET condition_group_id = CASE upper(condition_code)
  WHEN 'NM' THEN 1
  WHEN 'EX' THEN 2
  WHEN 'LP' THEN 2
  WHEN 'VG' THEN 3
  WHEN 'MP' THEN 3
  WHEN 'G' THEN 4
  WHEN 'HP' THEN 4
  WHEN 'DMG' THEN 5
  ELSE 99
END;

INSERT OR IGNORE INTO card_data_condition_codes (id, condition_code, sort_order, condition_group_id)
VALUES
  (6, 'EX', 2, 2),
  (7, 'VG', 3, 3),
  (8, 'G', 4, 4);

ALTER TABLE card_data_card_prices RENAME TO card_data_card_prices_legacy_0008;
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
  tcg_mid NUMERIC,
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
  tcg_mid,
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
  COALESCE(condition_id, 1) AS condition_id,
  COALESCE(finish_id, 1) AS finish_id,
  MAX(CASE WHEN provider_id = 3 AND channel_id = 6 THEN amount END) AS tcg_low,
  MAX(CASE WHEN provider_id = 3 AND channel_id = 4 THEN amount END) AS tcg_market,
  MAX(CASE WHEN provider_id = 3 AND channel_id = 7 THEN amount END) AS tcg_mid,
  MAX(CASE WHEN provider_id = 3 AND channel_id = 8 THEN amount END) AS tcg_high,
  MAX(CASE WHEN provider_id = 2 AND channel_id = 11 THEN amount END) AS ck_sell,
  MAX(CASE WHEN provider_id = 2 AND channel_id = 10 THEN amount END) AS ck_buylist,
  MAX(CASE WHEN provider_id = 2 AND channel_id = 10 THEN quantity_cap END) AS ck_buylist_quantity_cap,
  sync_version,
  MAX(captured_ymd) AS captured_ymd,
  MAX(captured_at) AS captured_at,
  MAX(created_at) AS created_at
FROM card_data_card_prices_legacy_0008
GROUP BY printing_id, COALESCE(condition_id, 1), COALESCE(finish_id, 1), sync_version;

DROP TABLE card_data_card_prices_legacy_0008;

PRAGMA foreign_keys = ON;
