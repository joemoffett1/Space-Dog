PRAGMA foreign_keys = ON;

-- Backfill existing Scryfall market snapshots into TCG channels so
-- existing local DBs immediately have data for TCG source selectors.

INSERT OR IGNORE INTO card_data_card_prices (
  printing_id, provider_id, channel_id, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
)
SELECT
  printing_id, 3, 4, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
FROM card_data_card_prices
WHERE provider_id = 1 AND channel_id = 1;

INSERT OR IGNORE INTO card_data_card_prices (
  printing_id, provider_id, channel_id, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
)
SELECT
  printing_id, 3, 6, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
FROM card_data_card_prices
WHERE provider_id = 1 AND channel_id = 1;

INSERT OR IGNORE INTO card_data_card_prices (
  printing_id, provider_id, channel_id, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
)
SELECT
  printing_id, 3, 7, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
FROM card_data_card_prices
WHERE provider_id = 1 AND channel_id = 1;

INSERT OR IGNORE INTO card_data_card_prices (
  printing_id, provider_id, channel_id, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
)
SELECT
  printing_id, 3, 8, currency_id, condition_id, finish_id,
  amount, credit_amount, credit_multiplier, quantity_cap,
  sync_version, captured_ymd, captured_at, created_at
FROM card_data_card_prices
WHERE provider_id = 1 AND channel_id = 1;

