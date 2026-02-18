PRAGMA foreign_keys = ON;

-- Final cleanup after runtime moved fully to v2 table groups.
-- This migration removes legacy compatibility triggers and legacy tables.

DROP TRIGGER IF EXISTS trg_profiles_ai_to_collection_data;
DROP TRIGGER IF EXISTS trg_profiles_au_to_collection_data;
DROP TRIGGER IF EXISTS trg_profiles_ad_to_collection_data;

DROP TRIGGER IF EXISTS trg_locations_ai_to_collection_data;
DROP TRIGGER IF EXISTS trg_locations_au_to_collection_data;
DROP TRIGGER IF EXISTS trg_locations_ad_to_collection_data;

DROP TRIGGER IF EXISTS trg_cards_ai_to_card_data;
DROP TRIGGER IF EXISTS trg_cards_au_to_card_data;

DROP TRIGGER IF EXISTS trg_printings_ai_to_card_data;
DROP TRIGGER IF EXISTS trg_printings_au_to_card_data;
DROP TRIGGER IF EXISTS trg_printings_ad_to_card_data;

DROP TRIGGER IF EXISTS trg_owned_items_ai_to_collection_data;
DROP TRIGGER IF EXISTS trg_owned_items_au_to_collection_data;
DROP TRIGGER IF EXISTS trg_owned_items_ad_to_collection_data;

DROP TRIGGER IF EXISTS trg_tags_ai_to_collection_data;
DROP TRIGGER IF EXISTS trg_tags_au_to_collection_data;
DROP TRIGGER IF EXISTS trg_tags_ad_to_collection_data;

DROP TRIGGER IF EXISTS trg_owned_item_tags_ai_to_collection_data;
DROP TRIGGER IF EXISTS trg_owned_item_tags_ad_to_collection_data;

DROP TRIGGER IF EXISTS trg_transactions_ai_to_collection_data;

DROP TRIGGER IF EXISTS trg_catalog_sync_state_ai_to_system_data_sync;
DROP TRIGGER IF EXISTS trg_catalog_sync_state_au_to_system_data_sync;
DROP TRIGGER IF EXISTS trg_catalog_patch_history_ai_to_system_data_sync;

DROP TRIGGER IF EXISTS trg_price_snapshots_ai_to_card_data_card_prices;
DROP TRIGGER IF EXISTS trg_buylist_offers_ai_to_card_data_card_prices;

-- Drop v1 tables in dependency-safe order.
DROP TABLE IF EXISTS owned_item_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS price_snapshots;
DROP TABLE IF EXISTS buylist_offers;
DROP TABLE IF EXISTS owned_items;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS printings;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS profiles;

DROP TABLE IF EXISTS catalog_patch_history;
DROP TABLE IF EXISTS catalog_sync_state;
DROP TABLE IF EXISTS catalog_cards;
DROP TABLE IF EXISTS filter_tokens;
