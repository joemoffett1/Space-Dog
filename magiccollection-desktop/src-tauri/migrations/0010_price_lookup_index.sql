CREATE INDEX IF NOT EXISTS idx_card_data_card_prices_printing_captured_at
  ON card_data_card_prices(printing_id, captured_at DESC);
