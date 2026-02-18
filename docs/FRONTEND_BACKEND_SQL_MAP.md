# Frontend/Backend/SQL Map

Last updated: 2026-02-17

This document maps UI/front-end calls to backend commands and catalogs SQL used by the Rust runtime.

## 1. UI To Backend Action Map

| UI Element | Frontend Handler/Component | Backend API (TS) | Tauri Command | Rust Function | Purpose |
|---|---|---|---|---|---|
| Profile create/open | `App.tsx` profile gates | `createProfile`, `listProfiles`, `getCollection` | `create_profile`, `list_profiles`, `get_collection` | `create_profile`, `list_profiles`, `get_collection` | Open/create collection profile and load cards. |
| Add card | `CollectionPage` add flow | `addCardToCollection` | `add_card_to_collection` | `add_card_to_collection` | Insert/increment card in collection. |
| Quantity + / - | `CollectionPage` qty buttons | `updateCardQuantity` | `update_card_quantity` | `update_card_quantity` | Adjust nonfoil/foil quantities. |
| Remove / Remove selected | `CollectionPage` actions | `removeCardFromCollection`, `removeCardsFromCollection` | `remove_card_from_collection`, `remove_cards_from_collection` | `remove_card_from_collection`, `remove_cards_from_collection` | Delete one or many collection rows. |
| Import wizard | `ImportWizardModal` callback | `importCollectionRows` | `import_collection_rows` | `import_collection_rows` | Import mapped CSV rows. |
| Metadata edits | `CollectionPage` metadata controls | `updateOwnedCardMetadata` | `update_owned_card_metadata` | `update_owned_card_metadata` | Update condition/language/location/notes/date/purchase. |
| Tag updates | `CollectionPage` tag controls | `bulkUpdateTags` | `bulk_update_tags` | `bulk_update_tags` | Apply user tags to selected cards. |
| Undo | `CollectionPage` undo action | `setOwnedCardState` / `removeCardFromCollection` | `set_owned_card_state` / `remove_card_from_collection` | `set_owned_card_state` / `remove_card_from_collection` | Restore prior card states. |
| Search token autocomplete | `CollectionPage` search | `syncFilterTokens`, `getFilterTokens` | `sync_filter_tokens`, `get_filter_tokens` | `sync_filter_tokens`, `get_filter_tokens` | Refresh/query token suggestions. |
| Collection trends by source | `CollectionPage` price source controls | `getCollectionPriceTrendsBySource` | `get_collection_price_trends_by_source` | `get_collection_price_trends_by_source` | Load selected source trend data. |
| Market price snapshots/trends | `MarketPage` effects | `recordMarketSnapshots`, `getMarketPriceTrends` | `record_market_snapshots`, `get_market_price_trends` | `record_market_snapshots`, `get_market_price_trends` | Persist/read market trend snapshots. |
| Top sync/refresh | `App.tsx` refresh flow | `syncAllSourcesNow`, `syncCkPricesIntoCardData` | `sync_all_sources_now`, `sync_ck_prices_into_card_data` | `sync_all_sources_now`, `sync_ck_prices_into_card_data` | Run global sync pipeline. |

## 2. TypeScript Backend API To Rust Command Map

| TS Backend Function | Tauri Command | Rust Function | Rust Line | Frontend Call Sites |
|---|---|---|---:|---|
| `listProfiles` | `list_profiles` | `list_profiles` | 3005 | App.tsx:370, App.tsx:498 |
| `createProfile` | `create_profile` | `create_profile` | 3034 | App.tsx:493 |
| `getCollection` | `get_collection` | `get_collection` | 3101 | App.tsx:203, App.tsx:387, App.tsx:499, App.tsx:524, App.tsx:824, App.tsx:856 |
| `addCardToCollection` | `add_card_to_collection` | `add_card_to_collection` | 3108 | App.tsx:618 |
| `updateCardQuantity` | `update_card_quantity` | `update_card_quantity` | 3202 | App.tsx:645, App.tsx:675 |
| `removeCardFromCollection` | `remove_card_from_collection` | `remove_card_from_collection` | 3260 | App.tsx:705, App.tsx:859 |
| `removeCardsFromCollection` | `remove_cards_from_collection` | `remove_cards_from_collection` | 3280 | App.tsx:734 |
| `recordMarketSnapshots` | `record_market_snapshots` | `record_market_snapshots` | 4247 | App.tsx:247, App.tsx:297, MarketPage.tsx:207 |
| `getMarketPriceTrends` | `get_market_price_trends` | `get_market_price_trends` | 4280 | MarketPage.tsx:208 |
| `getCollectionPriceTrendsBySource` | `get_collection_price_trends_by_source` | `get_collection_price_trends_by_source` | 4304 | CollectionPage.tsx:1151 |
| `syncCkPricesIntoCardData` | `sync_ck_prices_into_card_data` | `sync_ck_prices_into_card_data` | 4315 | App.tsx:306 |
| `syncAllSourcesNow` | `sync_all_sources_now` | `sync_all_sources_now` | 4422 | App.tsx:901 |
| `importCollectionRows` | `import_collection_rows` | `import_collection_rows` | 3322 | App.tsx:958 |
| `bulkUpdateTags` | `bulk_update_tags` | `bulk_update_tags` | 3532 | App.tsx:763 |
| `updateOwnedCardMetadata` | `update_owned_card_metadata` | `update_owned_card_metadata` | 3595 | App.tsx:794, App.tsx:826 |
| `setOwnedCardState` | `set_owned_card_state` | `set_owned_card_state` | 3702 | App.tsx:865 |
| `syncFilterTokens` | `sync_filter_tokens` | `sync_filter_tokens` | 4207 | CollectionPage.tsx:1395 |
| `getFilterTokens` | `get_filter_tokens` | `get_filter_tokens` | 4216 | CollectionPage.tsx:1423 |
| `hydrateProfileCardMetadata` | `hydrate_profile_card_metadata` | `hydrate_profile_card_metadata` | 3497 | App.tsx:331 |

## 3. SQL Query Catalog (Organized By Call Location)

Source: `magiccollection-desktop/src-tauri/src/lib.rs` (SQL string literals in runtime code).

Total SQL query literals cataloged: **93** across **44** functions.

Grouping model: startup/bootstrap, collection/profile actions, collection search/pricing views, market interactions, and global sync pipeline.

### 3A. Startup / App Bootstrap Calls

Functions in this group: **10**

#### `init_database`
- Purpose: Initialize DB file, create migration ledger, and apply schema/migrations.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:534`
- SQL statements: 2
- Primary tables: (none)

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:541`
   - Tables: (none)
```sql
PRAGMA foreign_keys = ON;
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:545`
   - Tables: (none)
```sql
CREATE TABLE IF NOT EXISTS _app_migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )
```
</details>

#### `is_fresh_database`
- Purpose: Detect whether database is empty (besides sqlite internals and migration table).
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:582`
- SQL statements: 1
- Primary tables: sqlite_master

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:585`
   - Tables: sqlite_master
```sql
SELECT COUNT(*)
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> '_app_migrations'
```
</details>

#### `mark_migration_applied`
- Purpose: Record migration as applied in _app_migrations.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:597`
- SQL statements: 1
- Primary tables: _app_migrations

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:600`
   - Tables: _app_migrations
```sql
INSERT OR IGNORE INTO _app_migrations (name, applied_at) VALUES (?1, ?2)
```
</details>

#### `apply_migration_once`
- Purpose: Run migration SQL once and mark it applied.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:607`
- SQL statements: 2
- Primary tables: _app_migrations

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:610`
   - Tables: _app_migrations
```sql
SELECT name FROM _app_migrations WHERE name = ?1 LIMIT 1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:622`
   - Tables: _app_migrations
```sql
INSERT INTO _app_migrations (name, applied_at) VALUES (?1, ?2)
```
</details>

#### `open_database`
- Purpose: Open SQLite connection with foreign keys enabled.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:629`
- SQL statements: 1
- Primary tables: (none)

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:632`
   - Tables: (none)
```sql
PRAGMA foreign_keys = ON;
```
</details>

#### `list_profiles`
- Purpose: List profiles for profile gate/startup.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3005`
- SQL statements: 1
- Primary tables: collection_data_profiles

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:3009`
   - Tables: collection_data_profiles
```sql
SELECT id, display_name, created_at
       FROM collection_data_profiles
       ORDER BY display_name COLLATE NOCASE
```
</details>

#### `read_catalog_sync_row`
- Purpose: Read local sync state for catalog dataset/version.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:693`
- SQL statements: 1
- Primary tables: system_data_sync_client_sync_state

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:699`
   - Tables: system_data_sync_client_sync_state
```sql
SELECT current_version, state_hash, synced_at
       FROM system_data_sync_client_sync_state
       WHERE client_id = ?1
         AND dataset_name = ?2
       LIMIT 1
```
</details>

#### `apply_catalog_snapshot`
- Purpose: Apply full catalog snapshot for a target version.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3950`
- SQL statements: 1
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3971`
   - Tables: card_data_card_prices
```sql
DELETE FROM card_data_card_prices
     WHERE sync_version = ?1
```
</details>

#### `write_catalog_sync_state`
- Purpose: Upsert sync state and dataset version metadata.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:746`
- SQL statements: 2
- Primary tables: system_data_sync_client_sync_state, system_data_sync_dataset_versions

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:755`
   - Tables: system_data_sync_client_sync_state
```sql
INSERT INTO system_data_sync_client_sync_state
         (client_id, dataset_name, current_version, state_hash, synced_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(client_id, dataset_name) DO UPDATE SET
         current_version = excluded.current_version,
         state_hash = excluded.state_hash,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:773`
   - Tables: system_data_sync_dataset_versions
```sql
INSERT INTO system_data_sync_dataset_versions
             (id, source_id, dataset_name, build_version, state_hash, record_count, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(id) DO UPDATE SET
             state_hash = excluded.state_hash,
             record_count = excluded.record_count,
             created_at = excluded.created_at
```
</details>

#### `count_catalog_records_for_version`
- Purpose: Count catalog records for a version.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:713`
- SQL statements: 1
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:716`
   - Tables: card_data_card_prices
```sql
SELECT COUNT(DISTINCT printing_id)
       FROM card_data_card_prices
       WHERE sync_version = ?1
         AND tcg_market IS NOT NULL
```
</details>

### 3B. Collection Page / Profile Flows

Functions in this group: **18**

#### `create_profile`
- Purpose: Create a new profile/collection row.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3034`
- SQL statements: 3
- Primary tables: collection_data_collections, collection_data_profiles

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3043`
   - Tables: collection_data_profiles
```sql
SELECT id, display_name, created_at
       FROM collection_data_profiles
       WHERE lower(display_name) = lower(?1)
       LIMIT 1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3067`
   - Tables: collection_data_profiles
```sql
INSERT INTO collection_data_profiles
         (id, display_name, owner_account_id, is_local_profile, created_at, updated_at)
       VALUES (?1, ?2, 'local-account', 1, ?3, ?3)
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3075`
   - Tables: collection_data_collections
```sql
INSERT INTO collection_data_collections
         (id, profile_id, name, description, visibility, created_at, updated_at)
       VALUES (
         ?1,
         ?1,
         CASE
           WHEN instr(lower(?2), 'collection') > 0 THEN ?2
           ELSE ?2 || ' Collection'
         END,
         NULL,
         'private',
         ?3,
         ?3
       )
```
</details>

#### `ensure_profile_exists`
- Purpose: Guarantee profile exists before writes.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1034`
- SQL statements: 3
- Primary tables: collection_data_collections, collection_data_profiles

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:1037`
   - Tables: collection_data_profiles
```sql
SELECT display_name
       FROM collection_data_profiles
       WHERE id = ?1
       LIMIT 1
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:1053`
   - Tables: collection_data_collections
```sql
SELECT id
       FROM collection_data_collections
       WHERE id = ?1
       LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1073`
   - Tables: collection_data_collections
```sql
INSERT INTO collection_data_collections
           (id, profile_id, name, description, visibility, created_at, updated_at)
         VALUES (?1, ?1, ?2, NULL, 'private', ?3, ?3)
```
</details>

#### `load_collection_rows`
- Purpose: Load collection rows with joined card/printing metadata.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:2886`
- SQL statements: 1
- Primary tables: card_data_cards, card_data_printings, collection_data_collection_items, collection_data_locations

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:2889`
   - Tables: card_data_cards, card_data_printings, collection_data_collection_items, collection_data_locations
```sql
SELECT
         ci.id,
         p.id,
         c.name,
         p.set_code,
         p.collector_number,
         p.image_normal_url,
         c.type_line,
         c.color_identity_json,
         c.cmc,
         p.rarity,
         ci.quantity_nonfoil,
         ci.quantity_foil,
         ci.updated_at,
         ci.condition_code,
         ci.language,
         l.name,
         ci.notes,
         ci.purchase_price,
         ci.acquired_at
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       LEFT JOIN collection_data_locations l ON l.id = ci.location_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
       ORDER BY c.name COLLATE NOCASE
```
</details>

#### `load_tags_for_owned_item`
- Purpose: Load user tags attached to a collection item.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1278`
- SQL statements: 1
- Primary tables: collection_data_collection_item_tags, collection_data_tags

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:1281`
   - Tables: collection_data_collection_item_tags, collection_data_tags
```sql
SELECT t.name
       FROM collection_data_collection_item_tags oit
       JOIN collection_data_tags t ON t.id = oit.tag_id
       WHERE oit.collection_item_id = ?1
       ORDER BY t.name COLLATE NOCASE
```
</details>

#### `add_card_to_collection`
- Purpose: Insert/increment collection quantities for a printing.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3108`
- SQL statements: 3
- Primary tables: collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3130`
   - Tables: collection_data_collection_items
```sql
SELECT id, quantity_nonfoil, quantity_foil
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3155`
   - Tables: collection_data_collection_items
```sql
UPDATE collection_data_collection_items
         SET quantity_nonfoil = ?1, quantity_foil = ?2, updated_at = ?3
         WHERE id = ?4
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3170`
   - Tables: collection_data_collection_items
```sql
INSERT INTO collection_data_collection_items (
           id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
           purchase_price, acquired_at, location_id, notes, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, 'NM', 'en', NULL, ?6, NULL, NULL, ?6, ?6)
```
</details>

#### `update_card_quantity`
- Purpose: Increment/decrement foil/nonfoil quantities.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3202`
- SQL statements: 3
- Primary tables: collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3212`
   - Tables: collection_data_collection_items
```sql
SELECT id, quantity_nonfoil, quantity_foil
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3239`
   - Tables: collection_data_collection_items
```sql
DELETE FROM collection_data_collection_items WHERE id = ?1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3246`
   - Tables: collection_data_collection_items
```sql
UPDATE collection_data_collection_items
           SET quantity_nonfoil = ?1, quantity_foil = ?2, updated_at = ?3
           WHERE id = ?4
```
</details>

#### `remove_card_from_collection`
- Purpose: Delete one card printing from collection.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3260`
- SQL statements: 1
- Primary tables: collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3270`
   - Tables: collection_data_collection_items
```sql
DELETE FROM collection_data_collection_items WHERE collection_id = ?1 AND printing_id = ?2
```
</details>

#### `remove_cards_from_collection`
- Purpose: Bulk delete multiple selected cards.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3280`
- SQL statements: 1
- Primary tables: collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:3291`
   - Tables: collection_data_collection_items
```sql
DELETE FROM collection_data_collection_items
         WHERE collection_id = ?1
           AND printing_id = ?2
```
</details>

#### `import_collection_rows`
- Purpose: Import mapped rows into collection tables.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3322`
- SQL statements: 5
- Primary tables: collection_data_collection_items, collection_data_locations

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3382`
   - Tables: collection_data_locations
```sql
SELECT id
               FROM collection_data_locations
               WHERE collection_id = ?1
                 AND LOWER(name) = LOWER(?2)
               LIMIT 1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3398`
   - Tables: collection_data_locations
```sql
INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
               VALUES (?1, ?2, ?3, 'general', ?4, ?4)
```
3. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3410`
   - Tables: collection_data_collection_items
```sql
SELECT id, quantity_nonfoil, quantity_foil
           FROM collection_data_collection_items
           WHERE collection_id = ?1
             AND printing_id = ?2
             AND condition_code = ?3
             AND language = ?4
             AND IFNULL(location_id, '') = IFNULL(?5, '')
           LIMIT 1
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3434`
   - Tables: collection_data_collection_items
```sql
UPDATE collection_data_collection_items
           SET quantity_nonfoil = ?1,
               quantity_foil = ?2,
               purchase_price = COALESCE(?3, purchase_price),
               acquired_at = COALESCE(?4, acquired_at),
               notes = COALESCE(?5, notes),
               updated_at = ?6
           WHERE id = ?7
```
5. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3457`
   - Tables: collection_data_collection_items
```sql
INSERT INTO collection_data_collection_items (
             id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
             purchase_price, acquired_at, location_id, notes, created_at, updated_at
           )
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
```
</details>

#### `bulk_update_tags`
- Purpose: Replace/update tag assignments for selected cards.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3532`
- SQL statements: 1
- Primary tables: collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3557`
   - Tables: collection_data_collection_items
```sql
SELECT id, quantity_nonfoil, quantity_foil
           FROM collection_data_collection_items
           WHERE collection_id = ?1
             AND printing_id = ?2
             AND condition_code = 'NM'
             AND language = 'en'
             AND location_id IS NULL
           LIMIT 1
```
</details>

#### `update_owned_card_metadata`
- Purpose: Update location/condition/language/notes/date/purchase metadata.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3595`
- SQL statements: 4
- Primary tables: collection_data_collection_items, collection_data_locations

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3605`
   - Tables: collection_data_collection_items
```sql
SELECT id
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
       ORDER BY updated_at DESC
       LIMIT 1
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3627`
   - Tables: collection_data_locations
```sql
SELECT id FROM collection_data_locations WHERE collection_id = ?1 AND lower(name) = lower(?2) LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3640`
   - Tables: collection_data_locations
```sql
INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'box', ?4, ?4)
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3675`
   - Tables: collection_data_collection_items
```sql
UPDATE collection_data_collection_items
       SET condition_code = ?1,
           language = ?2,
           location_id = ?3,
           notes = ?4,
           purchase_price = ?5,
           acquired_at = ?6,
           updated_at = ?7
       WHERE id = ?8
```
</details>

#### `set_owned_card_state`
- Purpose: Restore card state (undo replay path).
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3702`
- SQL statements: 6
- Primary tables: collection_data_collection_items, collection_data_locations

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3716`
   - Tables: collection_data_collection_items
```sql
DELETE FROM collection_data_collection_items WHERE collection_id = ?1 AND printing_id = ?2
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3739`
   - Tables: collection_data_collection_items
```sql
SELECT id
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
       ORDER BY updated_at DESC
       LIMIT 1
```
3. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:3757`
   - Tables: collection_data_locations
```sql
SELECT id FROM collection_data_locations WHERE collection_id = ?1 AND lower(name) = lower(?2) LIMIT 1
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3770`
   - Tables: collection_data_locations
```sql
INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'box', ?4, ?4)
```
5. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3811`
   - Tables: collection_data_collection_items
```sql
UPDATE collection_data_collection_items
         SET quantity_nonfoil = ?1,
             quantity_foil = ?2,
             condition_code = ?3,
             language = ?4,
             location_id = ?5,
             notes = ?6,
             purchase_price = ?7,
             acquired_at = ?8,
             updated_at = ?9
         WHERE id = ?10
```
6. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:3841`
   - Tables: collection_data_collection_items
```sql
INSERT INTO collection_data_collection_items (
           id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
           purchase_price, acquired_at, location_id, notes, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
```
</details>

#### `upsert_tags_for_owned_item`
- Purpose: Normalize and upsert user tags for one owned item.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1225`
- SQL statements: 4
- Primary tables: collection_data_collection_item_tags, collection_data_tags

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1233`
   - Tables: collection_data_collection_item_tags
```sql
DELETE FROM collection_data_collection_item_tags WHERE collection_item_id = ?1
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:1241`
   - Tables: collection_data_tags
```sql
SELECT id
         FROM collection_data_tags
         WHERE collection_id = ?1
           AND lower(name) = lower(?2)
         LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1258`
   - Tables: collection_data_tags
```sql
INSERT INTO collection_data_tags (id, collection_id, name, color_hex, created_at)
           VALUES (?1, ?2, ?3, NULL, ?4)
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1268`
   - Tables: collection_data_collection_item_tags
```sql
INSERT OR IGNORE INTO collection_data_collection_item_tags (collection_item_id, tag_id, created_at)
         VALUES (?1, ?2, ?3)
```
</details>

#### `ensure_card_and_printing`
- Purpose: Ensure card + printing rows exist before collection links.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1084`
- SQL statements: 4
- Primary tables: card_data_cards, card_data_printings, card_data_sets

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1140`
   - Tables: card_data_sets
```sql
INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = excluded.set_name,
         updated_at = excluded.updated_at
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:1151`
   - Tables: card_data_printings
```sql
SELECT card_id
       FROM card_data_printings
       WHERE id = ?1
       LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1164`
   - Tables: card_data_cards
```sql
INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, NULL, ?2, NULL, ?3, ?4, NULL, 0, NULL, NULL, ?5, NULL, ?6, ?6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type_line = COALESCE(excluded.type_line, card_data_cards.type_line),
         color_identity_json = COALESCE(excluded.color_identity_json, card_data_cards.color_identity_json),
         cmc = COALESCE(excluded.cmc, card_data_cards.cmc),
         updated_at = excluded.updated_at
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1188`
   - Tables: card_data_printings
```sql
INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, NULL, ?3, ?4, 'en', ?5, NULL, NULL, NULL, ?6, ?6, ?6, NULL, 0, 0, 1, 1, NULL, NULL, NULL, NULL, ?7, ?7)
        ON CONFLICT(id) DO UPDATE SET
          card_id = COALESCE(card_data_printings.card_id, excluded.card_id),
          set_code = CASE
            WHEN excluded.set_code = 'unknown' THEN card_data_printings.set_code
            ELSE excluded.set_code
          END,
          collector_number = CASE
            WHEN excluded.collector_number = '0' THEN card_data_printings.collector_number
            ELSE excluded.collector_number
          END,
          rarity = COALESCE(excluded.rarity, card_data_printings.rarity),
          image_normal_url = COALESCE(excluded.image_normal_url, card_data_printings.image_normal_url),
          image_small_url = COALESCE(excluded.image_small_url, card_data_printings.image_small_url),
          image_art_crop_url = COALESCE(excluded.image_art_crop_url, card_data_printings.image_art_crop_url),
          updated_at = excluded.updated_at
```
</details>

#### `count_missing_metadata_rows`
- Purpose: Count missing metadata rows to hydrate.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1815`
- SQL statements: 1
- Primary tables: card_data_cards, card_data_printings, collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:1818`
   - Tables: card_data_cards, card_data_printings, collection_data_collection_items
```sql
SELECT count(*)
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
         AND (
           c.type_line IS NULL OR trim(c.type_line) = ''
           OR c.color_identity_json IS NULL
           OR c.cmc IS NULL
           OR p.rarity IS NULL OR trim(p.rarity) = ''
         )
```
</details>

#### `list_missing_metadata_scryfall_ids`
- Purpose: List Scryfall IDs that still need metadata hydration.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1781`
- SQL statements: 1
- Primary tables: card_data_cards, card_data_printings, collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:1788`
   - Tables: card_data_cards, card_data_printings, collection_data_collection_items
```sql
SELECT DISTINCT ci.printing_id
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
         AND (
           c.type_line IS NULL OR trim(c.type_line) = ''
           OR c.color_identity_json IS NULL
           OR c.cmc IS NULL
           OR p.rarity IS NULL OR trim(p.rarity) = ''
         )
       LIMIT ?2
```
</details>

#### `hydrate_printing_metadata_batch`
- Purpose: Write fetched metadata fields for a batch of printings.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:2494`
- SQL statements: 2
- Primary tables: card_data_cards, card_data_printings

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2568`
   - Tables: card_data_cards, card_data_printings
```sql
UPDATE card_data_cards
         SET type_line = COALESCE(?1, type_line),
             color_identity_json = COALESCE(?2, color_identity_json),
             cmc = COALESCE(?3, cmc),
             updated_at = ?4
         WHERE id = (SELECT card_id FROM card_data_printings WHERE id = ?5 LIMIT 1)
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2580`
   - Tables: card_data_printings
```sql
UPDATE card_data_printings
         SET rarity = COALESCE(?1, rarity),
             image_normal_url = COALESCE(?2, image_normal_url),
             image_small_url = COALESCE(?3, image_small_url),
             image_art_crop_url = COALESCE(?4, image_art_crop_url),
             updated_at = ?5
         WHERE id = ?6
```
</details>

#### `upsert_scryfall_oracle_if_changed`
- Purpose: Upsert Scryfall oracle/card metadata only when changed.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1997`
- SQL statements: 7
- Primary tables: card_data_cards, card_data_printings, card_data_sets

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2132`
   - Tables: card_data_sets
```sql
INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = excluded.set_name,
         updated_at = excluded.updated_at
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:2143`
   - Tables: card_data_printings
```sql
SELECT card_id FROM card_data_printings WHERE id = ?1 LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2154`
   - Tables: card_data_cards
```sql
INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(id) DO NOTHING
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2180`
   - Tables: card_data_printings
```sql
INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, 0, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)
        ON CONFLICT(id) DO NOTHING
```
5. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:2216`
   - Tables: card_data_cards, card_data_printings
```sql
SELECT
         COALESCE(c.name, ''),
         COALESCE(c.mana_cost, ''),
         COALESCE(c.type_line, ''),
         COALESCE(c.oracle_text, ''),
         COALESCE(c.cmc, -1),
         COALESCE(c.reserved, 0),
         COALESCE(c.keywords_json, ''),
         COALESCE(c.colors_json, ''),
         COALESCE(c.color_identity_json, ''),
         COALESCE(c.latest_released_at, ''),
         COALESCE(p.set_code, ''),
         COALESCE(p.collector_number, ''),
         COALESCE(p.lang, ''),
         COALESCE(p.rarity, ''),
         COALESCE(p.layout, ''),
         COALESCE(p.released_at, ''),
         COALESCE(p.artist, ''),
         COALESCE(p.image_normal_url, ''),
         COALESCE(p.image_small_url, ''),
         COALESCE(p.image_art_crop_url, ''),
         COALESCE(p.is_digital, 0),
         COALESCE(p.is_foil_available, 0),
         COALESCE(p.is_nonfoil_available, 0),
         COALESCE(p.tcgplayer_id, -1),
         COALESCE(p.cardmarket_id, -1),
         COALESCE(p.mtgo_id, -1),
         COALESCE(p.mtgo_foil_id, -1)
       FROM card_data_printings p
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE p.id = ?1
       LIMIT 1
```
6. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2411`
   - Tables: card_data_cards
```sql
UPDATE card_data_cards
       SET oracle_id = ?1,
           name = ?2,
           mana_cost = ?3,
           cmc = ?4,
           type_line = ?5,
           oracle_text = ?6,
           reserved = ?7,
           keywords_json = ?8,
           colors_json = ?9,
           color_identity_json = ?10,
           latest_released_at = ?11,
           updated_at = ?12
       WHERE id = ?13
```
7. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:2445`
   - Tables: card_data_printings
```sql
UPDATE card_data_printings
       SET oracle_id = ?1,
           set_code = ?2,
           collector_number = ?3,
           lang = ?4,
           rarity = ?5,
           layout = ?6,
           released_at = ?7,
           artist = ?8,
           image_normal_url = ?9,
           image_small_url = ?10,
           image_art_crop_url = ?11,
           is_digital = ?12,
           is_foil_available = ?13,
           is_nonfoil_available = ?14,
           tcgplayer_id = ?15,
           cardmarket_id = ?16,
           mtgo_id = ?17,
           mtgo_foil_id = ?18,
           updated_at = ?19
       WHERE id = ?20
```
</details>

### 3C. Collection Search, Sort, and Pricing Views

Functions in this group: **3**

#### `collect_filter_tokens`
- Purpose: Collect and return filter token suggestions from card/collection data.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:2704`
- SQL statements: 3
- Primary tables: card_data_cards, card_data_printings, collection_data_collection_items, collection_data_tags

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:2739`
   - Tables: card_data_printings, collection_data_collection_items
```sql
SELECT DISTINCT lower(p.set_code)
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       WHERE (?1 IS NULL OR ci.collection_id = ?1)
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
```
2. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:2766`
   - Tables: collection_data_tags
```sql
SELECT DISTINCT lower(t.name), t.name
       FROM collection_data_tags t
       WHERE (?1 IS NULL OR t.collection_id = ?1)
         AND lower(t.name) NOT IN ('owned', 'foil', 'playset')
       ORDER BY t.name COLLATE NOCASE
```
3. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:2792`
   - Tables: card_data_cards, card_data_printings, collection_data_collection_items
```sql
SELECT DISTINCT c.type_line, c.color_identity_json, p.rarity, ci.language, ci.condition_code
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE (?1 IS NULL OR ci.collection_id = ?1)
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
```
</details>

#### `load_collection_price_trends_by_source`
- Purpose: Load per-card pricing trends for selected price source.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1387`
- SQL statements: 1
- Primary tables: card_data_card_prices, collection_data_collection_items

<details>
<summary>Show SQL statements</summary>

1. `sql_literal` at `magiccollection-desktop/src-tauri/src/lib.rs:1394`
   - Tables: card_data_card_prices, collection_data_collection_items
```sql
SELECT DISTINCT
       ci.printing_id,
       (
         SELECT cp.{col}
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1
       ) AS current_price,
       (
         SELECT cp.{col}
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1 OFFSET 1
       ) AS previous_price,
       (
         SELECT cp.captured_at
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1
       ) AS last_price_at
     FROM collection_data_collection_items ci
     WHERE ci.collection_id = ?1
       AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
```
</details>

#### `build_price_trend_by_column`
- Purpose: Build trend values from compact price columns.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1337`
- SQL statements: 1
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `sql_literal` at `magiccollection-desktop/src-tauri/src/lib.rs:1343`
   - Tables: card_data_card_prices
```sql
SELECT {col}, captured_at
     FROM card_data_card_prices
     WHERE printing_id = ?1
       AND {col} IS NOT NULL
     ORDER BY captured_at DESC
     LIMIT 2
```
</details>

### 3D. Market Page and Price Snapshot Calls

Functions in this group: **2**

#### `upsert_compact_price_row`
- Purpose: Upsert compact daily price row for printing/condition/finish.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1523`
- SQL statements: 1
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1558`
   - Tables: card_data_card_prices
```sql
INSERT INTO card_data_card_prices (
         printing_id, condition_id, finish_id,
         tcg_low, tcg_market, tcg_high,
         ck_sell, ck_buylist, ck_buylist_quantity_cap,
         sync_version, captured_ymd, captured_at, created_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(
         printing_id,
         IFNULL(condition_id, 0),
         IFNULL(finish_id, 0),
         sync_version
       ) DO UPDATE SET
         tcg_low = COALESCE(excluded.tcg_low, card_data_card_prices.tcg_low),
         tcg_market = COALESCE(excluded.tcg_market, card_data_card_prices.tcg_market),
         tcg_high = COALESCE(excluded.tcg_high, card_data_card_prices.tcg_high),
         ck_sell = COALESCE(excluded.ck_sell, card_data_card_prices.ck_sell),
         ck_buylist = COALESCE(excluded.ck_buylist, card_data_card_prices.ck_buylist),
         ck_buylist_quantity_cap = COALESCE(excluded.ck_buylist_quantity_cap, card_data_card_prices.ck_buylist_quantity_cap),
         captured_ymd = excluded.captured_ymd,
         captured_at = excluded.captured_at,
         created_at = excluded.created_at
```
</details>

#### `get_catalog_price_records`
- Purpose: Fetch catalog price rows by Scryfall IDs.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:3884`
- SQL statements: 1
- Primary tables: card_data_card_prices, card_data_cards, card_data_printings

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:3906`
   - Tables: card_data_card_prices, card_data_cards, card_data_printings
```sql
SELECT p.id, c.name, p.set_code, p.collector_number, p.image_normal_url, cp.tcg_market, cp.captured_at
       FROM card_data_card_prices cp
       JOIN card_data_printings p ON p.id = cp.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE p.id = ?1
         AND cp.sync_version = ?2
         AND cp.tcg_market IS NOT NULL
       ORDER BY cp.captured_at DESC
       LIMIT 1
```
</details>

### 3E. Global Sync / Catalog Pipeline Calls

Functions in this group: **11**

#### `sync_all_sources_now`
- Purpose: Run full source sync pipeline (TCGTracking, CK, Scryfall).
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:4422`
- SQL statements: 1
- Primary tables: card_data_printings

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:4491`
   - Tables: card_data_printings
```sql
SELECT 1 FROM card_data_printings WHERE id = ?1 LIMIT 1
```
</details>

#### `sync_ck_prices_into_card_data`
- Purpose: Sync CK prices into compact card_data price rows.
- Tauri command entrypoint: Yes
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:4315`
- SQL statements: 1
- Primary tables: card_data_printings

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:4350`
   - Tables: card_data_printings
```sql
SELECT 1 FROM card_data_printings WHERE id = ?1 LIMIT 1
```
</details>

#### `append_catalog_patch_history`
- Purpose: Append patch metadata/apply history rows.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:962`
- SQL statements: 2
- Primary tables: system_data_sync_patch_apply_history, system_data_sync_patches

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:978`
   - Tables: system_data_sync_patches
```sql
INSERT INTO system_data_sync_patches (
         id, source_id, dataset_name, from_version, to_version, patch_hash,
         strategy, added_count, updated_count, removed_count, artifact_uri, created_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1001`
   - Tables: system_data_sync_patch_apply_history
```sql
INSERT INTO system_data_sync_patch_apply_history (
         id, client_id, dataset_name, from_version, to_version, strategy,
         duration_ms, result, error_message, applied_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'success', NULL, ?7)
```
</details>

#### `apply_catalog_patch`
- Purpose: Apply incremental catalog patch changes.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:4027`
- SQL statements: 3
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4059`
   - Tables: card_data_card_prices
```sql
DELETE FROM card_data_card_prices
     WHERE sync_version = ?1
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4065`
   - Tables: card_data_card_prices
```sql
INSERT INTO card_data_card_prices (
       printing_id, condition_id, finish_id,
       tcg_low, tcg_market, tcg_high,
       ck_sell, ck_buylist, ck_buylist_quantity_cap,
       sync_version, captured_ymd, captured_at, created_at
     )
     SELECT
       printing_id, condition_id, finish_id,
       tcg_low, tcg_market, tcg_high,
       ck_sell, ck_buylist, ck_buylist_quantity_cap,
       ?1, ?2, ?3, ?3
     FROM card_data_card_prices
     WHERE sync_version = ?4
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4084`
   - Tables: card_data_card_prices
```sql
DELETE FROM card_data_card_prices
       WHERE sync_version = ?1
         AND printing_id = ?2
```
</details>

#### `upsert_catalog_record`
- Purpose: Upsert card/printing/set + compact price fields during catalog ingestion.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:796`
- SQL statements: 4
- Primary tables: card_data_cards, card_data_printings, card_data_sets

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:832`
   - Tables: card_data_sets
```sql
INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = COALESCE(NULLIF(excluded.set_name, ''), card_data_sets.set_name),
         updated_at = excluded.updated_at
```
2. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:843`
   - Tables: card_data_printings
```sql
SELECT card_id
       FROM card_data_printings
       WHERE id = ?1
       LIMIT 1
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:856`
   - Tables: card_data_cards
```sql
INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, NULL, ?2, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:870`
   - Tables: card_data_printings
```sql
INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, NULL, ?3, ?4, 'en', NULL, NULL, NULL, NULL, ?5, NULL, NULL, NULL, 0, 0, 1, 1, NULL, NULL, NULL, NULL, ?6, ?6)
        ON CONFLICT(id) DO UPDATE SET
          card_id = COALESCE(card_data_printings.card_id, excluded.card_id),
          set_code = excluded.set_code,
          collector_number = excluded.collector_number,
          image_normal_url = COALESCE(excluded.image_normal_url, card_data_printings.image_normal_url),
          updated_at = excluded.updated_at
```
</details>

#### `write_source_sync_record`
- Purpose: Record source sync run metadata and counts.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1950`
- SQL statements: 2
- Primary tables: system_data_sync_client_sync_state, system_data_sync_dataset_versions

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1962`
   - Tables: system_data_sync_dataset_versions
```sql
INSERT INTO system_data_sync_dataset_versions
         (id, source_id, dataset_name, build_version, state_hash, record_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         state_hash = excluded.state_hash,
         record_count = excluded.record_count,
         created_at = excluded.created_at
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1983`
   - Tables: system_data_sync_client_sync_state
```sql
INSERT INTO system_data_sync_client_sync_state
         (client_id, dataset_name, current_version, state_hash, synced_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(client_id, dataset_name) DO UPDATE SET
         current_version = excluded.current_version,
         state_hash = excluded.state_hash,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at
```
</details>

#### `count_catalog_records`
- Purpose: Count all catalog rows in current dataset/version.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:726`
- SQL statements: 1
- Primary tables: card_data_card_prices

<details>
<summary>Show SQL statements</summary>

1. `query_row` at `magiccollection-desktop/src-tauri/src/lib.rs:736`
   - Tables: card_data_card_prices
```sql
SELECT COUNT(DISTINCT printing_id)
       FROM card_data_card_prices
       WHERE sync_version = ?1
         AND tcg_market IS NOT NULL
```
</details>

#### `compute_catalog_state_hash`
- Purpose: Compute deterministic state hash for catalog payload/version.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:915`
- SQL statements: 1
- Primary tables: card_data_card_prices, card_data_cards, card_data_printings

<details>
<summary>Show SQL statements</summary>

1. `prepare` at `magiccollection-desktop/src-tauri/src/lib.rs:926`
   - Tables: card_data_card_prices, card_data_cards, card_data_printings
```sql
SELECT p.id, c.name, p.set_code, p.collector_number, COALESCE(p.image_normal_url, ''), cp.tcg_market, cp.captured_at
       FROM card_data_card_prices cp
       JOIN card_data_printings p ON p.id = cp.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE cp.sync_version = ?1
         AND cp.tcg_market IS NOT NULL
       ORDER BY p.id
```
</details>

#### `ensure_sync_source`
- Purpose: Ensure source row exists in sync source registry.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:1927`
- SQL statements: 1
- Primary tables: system_data_sync_data_sources

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:1936`
   - Tables: system_data_sync_data_sources
```sql
INSERT INTO system_data_sync_data_sources (id, kind, base_url, enabled, refresh_window_utc, updated_at)
       VALUES (?1, ?2, ?3, 1, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         base_url = excluded.base_url,
         enabled = 1,
         refresh_window_utc = excluded.refresh_window_utc,
         updated_at = excluded.updated_at
```
</details>

#### `optimize_catalog_storage`
- Purpose: Run cleanup/vacuum/index-oriented optimization.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:4181`
- SQL statements: 1
- Primary tables: (none)

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4190`
   - Tables: (none)
```sql
PRAGMA optimize;
      ANALYZE card_data_card_prices;
      ANALYZE card_data_printings;
      ANALYZE card_data_cards;
      REINDEX idx_card_data_card_prices_printing_time;
      REINDEX idx_card_data_card_prices_sync_version;
      REINDEX idx_card_data_printings_set_collector;
      VACUUM;
```
</details>

#### `reset_catalog_sync_state_for_test`
- Purpose: Reset catalog sync tables for local testing.
- Tauri command entrypoint: No
- Rust function location: `magiccollection-desktop/src-tauri/src/lib.rs:4137`
- SQL statements: 5
- Primary tables: card_data_card_prices, system_data_sync_client_sync_state, system_data_sync_dataset_versions, system_data_sync_patch_apply_history, system_data_sync_patches

<details>
<summary>Show SQL statements</summary>

1. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4146`
   - Tables: card_data_card_prices
```sql
DELETE FROM card_data_card_prices
```
2. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4151`
   - Tables: system_data_sync_client_sync_state
```sql
DELETE FROM system_data_sync_client_sync_state
     WHERE client_id = ?1
       AND dataset_name = ?2
```
3. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4158`
   - Tables: system_data_sync_patch_apply_history
```sql
DELETE FROM system_data_sync_patch_apply_history
     WHERE client_id = ?1
       AND dataset_name = ?2
```
4. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4165`
   - Tables: system_data_sync_patches
```sql
DELETE FROM system_data_sync_patches WHERE dataset_name = ?1
```
5. `execute` at `magiccollection-desktop/src-tauri/src/lib.rs:4170`
   - Tables: system_data_sync_dataset_versions
```sql
DELETE FROM system_data_sync_dataset_versions WHERE dataset_name = ?1
```
</details>

