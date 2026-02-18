# SQL Schema Transition Plan (v1 -> v2 grouped tables)

Date: 2026-02-10
Status: Implemented for database layer (migration + compatibility triggers)

## Goal
Move from legacy flat tables to grouped SQLite-safe names that mirror future service schemas:
- `collection_data_*`
- `card_data_*`
- `system_data_sync_*`

This keeps desktop local-first now and minimizes rework when moving to server DB schemas later.

## What Was Implemented

## 1) New Migration
- Added: `magiccollection-desktop/src-tauri/migrations/0004_schema_groups_v2.sql`
- Wired into startup in `magiccollection-desktop/src-tauri/src/lib.rs`.

## 2) New Table Groups
- Collection domain:
  - `collection_data_auth_accounts`
  - `collection_data_auth_sessions`
  - `collection_data_profiles`
  - `collection_data_collections`
  - `collection_data_locations`
  - `collection_data_collection_items`
  - `collection_data_tags`
  - `collection_data_collection_item_tags`
  - `collection_data_item_events`
- Card domain:
  - `card_data_sets`
  - `card_data_cards`
  - `card_data_printings`
  - `card_data_card_faces`
  - `card_data_printing_parts`
  - `card_data_legalities`
  - `card_data_price_providers`
  - `card_data_price_channels`
  - `card_data_currency_codes`
  - `card_data_condition_codes`
  - `card_data_finish_codes`
  - `card_data_card_prices`
  - `card_data_otags`
  - `card_data_printing_otags`
- Sync domain:
  - `system_data_sync_data_sources`
  - `system_data_sync_dataset_versions`
  - `system_data_sync_patches`
  - `system_data_sync_client_sync_state`
  - `system_data_sync_patch_apply_history`

## 3) Compact Pricing Model (as requested)
- Unified market + buylist history into `card_data_card_prices`.
- Added compact code dictionaries for provider/channel/currency/condition/finish.
- Added `sync_version` and `captured_ymd` to support server patch-build workflow.

## 4) Backfill
`0004` backfills from legacy tables into v2 grouped tables:
- Profiles/collections/locations/items/tags/events
- Sets/cards/printings
- Sync state/history
- Pricing snapshots + buylist into unified `card_data_card_prices`

## 5) Compatibility Triggers
Added legacy -> v2 mirror triggers so current desktop write paths keep v2 tables current without breaking existing app flows.

## Validation Run
- Executed migrations `0001`..`0004` against in-memory SQLite successfully.
- Verified required v2 tables exist.
- Verified trigger creation count (`25`).

## What Still Needs Code Migration (App Layer)
These are now optional next steps, not blockers for DB transition:
1. Move Rust read queries from legacy tables to v2 tables incrementally.
2. Move Rust write paths to v2 tables (then retire mirror triggers).
3. Add explicit `sync_version` input plumbing for server-pushed builds.
4. Add retention policy jobs for `card_data_card_prices` (daily/weekly/monthly rollup).

## Rollback / Safety
- Migration is additive and non-destructive: legacy tables are preserved.
- If needed, app can continue reading legacy tables while v2 stays mirrored.
