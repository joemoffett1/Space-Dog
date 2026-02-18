# SQL Migration State (V2-Only)

Last updated: 2026-02-15

## Active migration files
- `magiccollection-desktop/src-tauri/migrations/schema_current.sql` (fresh install master schema)
- `magiccollection-desktop/src-tauri/migrations/0004_schema_groups_v2.sql`
- `magiccollection-desktop/src-tauri/migrations/0005_drop_legacy_tables.sql`
- `magiccollection-desktop/src-tauri/migrations/0006_price_channels_expand.sql`
- `magiccollection-desktop/src-tauri/migrations/0007_price_backfill_tcg_channels.sql`
- `magiccollection-desktop/src-tauri/migrations/0008_compact_price_rows.sql`
- `magiccollection-desktop/src-tauri/migrations/0009_drop_tcg_mid.sql`
- `magiccollection-desktop/src-tauri/migrations/0010_price_lookup_index.sql`

## Execution order
1. Fresh install path:
   - `schema_current.sql`
2. Upgrade path:
   - `0004_schema_groups_v2.sql`
   - `0005_drop_legacy_tables.sql`
   - `0006_price_channels_expand.sql`
   - `0007_price_backfill_tcg_channels.sql`
   - `0008_compact_price_rows.sql`
   - `0009_drop_tcg_mid.sql`
   - `0010_price_lookup_index.sql`

## What this means
- The app runtime is fully on grouped v2 tables:
  - `collection_data_*`
  - `card_data_*`
  - `system_data_sync_*`
- Legacy table migrations are removed from the code path.
- Legacy tables are dropped by `0005` if present.

## Startup wiring
- `magiccollection-desktop/src-tauri/src/lib.rs`
  - detects fresh DBs and installs `schema_current.sql` directly
  - applies incremental migrations once using `_app_migrations` tracking for non-fresh DBs
  - includes `MIGRATION_SQL_0004` through `MIGRATION_SQL_0010`

## Runtime SQL verification
- Legacy SQL callsites in runtime command SQL: `0`
- Runtime command SQL targets only v2 groups.

## Backup and rollback
- Backup folder created before cleanup:
  - `Backup/sql_cleanup_20260211_142111`
- DB backup file:
  - `Backup/sql_cleanup_20260211_142111/magiccollection_20260211_142133.db.bak`
- Restore path (if needed):
  - `%APPDATA%\com.tauri.dev\magiccollection.db`

## Scope note
- This document now tracks only the active v2 migration state.
- Historical legacy-field mapping docs were intentionally removed during cleanup.

## Runtime sync SQL note
- Full runtime sync command (`sync_all_sources_now`) currently executes in 3 phases:
  1. TCGTracking pricing rows -> `card_data_card_prices`
  2. Card Kingdom pricing rows -> `card_data_card_prices`
  3. Scryfall `default_cards` metadata/oracle upsert -> `card_data_printings` / card metadata tables
- Scryfall pricing is not written in this flow.
- Pricing is compacted into one row per `printing_id + condition_id + finish_id + sync_version`.
- TCG and CK updates write into different columns on that same row.
