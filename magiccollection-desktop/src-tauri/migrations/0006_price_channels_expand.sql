PRAGMA foreign_keys = ON;

-- Expand provider/channel dictionary to support UI price-source targets.
-- Existing IDs are preserved for backward compatibility.

INSERT OR IGNORE INTO card_data_price_channels
  (id, provider_id, channel_code, channel_name, direction_code, needs_condition, needs_finish, updated_at)
VALUES
  (6, 3, 'low', 'Low', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (7, 3, 'mid', 'Mid', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (8, 3, 'high', 'High', 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (11, 2, 'sell', 'Sell', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

