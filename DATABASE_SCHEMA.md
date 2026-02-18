# MagicCollection Database Schema (V2)

Last updated: 2026-02-15

## Source of truth
- `magiccollection-desktop/src-tauri/migrations/0004_schema_groups_v2.sql`
- `magiccollection-desktop/src-tauri/migrations/0005_drop_legacy_tables.sql`
- `magiccollection-desktop/src-tauri/migrations/0006_price_channels_expand.sql`
- `magiccollection-desktop/src-tauri/migrations/0007_price_backfill_tcg_channels.sql`
- `magiccollection-desktop/src-tauri/migrations/0008_compact_price_rows.sql`

## Database location
- File: `magiccollection.db`
- Typical path: `C:\Users\<you>\AppData\Roaming\com.tauri.dev\magiccollection.db`

## At a glance
- One SQLite DB file.
- Logical schema groups are represented by table-name prefixes:
  - `collection_data_*`
  - `card_data_*`
  - `system_data_sync_*`

## Key identity rules
- Collection card identity uses printing-level Scryfall ID.
- `card_data_printings.id` = Scryfall printing UUID.
- `collection_data_collection_items.printing_id` and `card_data_card_prices.printing_id` both reference that ID.

## Pricing model summary
- Unified pricing fact table: `card_data_card_prices`
- One row per unique tuple:
  - `printing_id`
  - `IFNULL(condition_id, 0)`
  - `IFNULL(finish_id, 0)`
  - `sync_version`
- Source prices are compacted into columns on the same row:
  - `tcg_low`, `tcg_market`, `tcg_high`
  - `ck_sell`, `ck_buylist`, `ck_buylist_quantity_cap`

## Full table reference

<details>
<summary><strong>collection_data_*</strong></summary>

<details>
<summary><code>collection_data_auth_accounts</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Account ID (UUID/text). |
| `email` | TEXT (UNIQUE) | Yes | Optional account email. |
| `username` | TEXT (UNIQUE) | Yes | Optional account username. |
| `password_hash` | TEXT | Yes | Stored password hash. |
| `password_algo` | TEXT | No | Hash algorithm label (default `sha256`). |
| `is_local_only` | INTEGER | No | `1` for local-only account mode. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |
| `last_login_at` | TEXT | Yes | Last login timestamp. |
| `disabled_at` | TEXT | Yes | Soft-disable timestamp. |

</details>

<details>
<summary><code>collection_data_auth_sessions</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Session row ID. |
| `account_id` | TEXT (FK) | No | FK -> `collection_data_auth_accounts.id`. |
| `session_token_hash` | TEXT | No | Hashed session token. |
| `device_label` | TEXT | Yes | Optional device label. |
| `created_at` | TEXT | No | Session creation time. |
| `expires_at` | TEXT | Yes | Session expiry time. |
| `revoked_at` | TEXT | Yes | Session revocation time. |
| `last_seen_at` | TEXT | Yes | Last-seen heartbeat. |

</details>

<details>
<summary><code>collection_data_profiles</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Profile/collection owner ID. |
| `display_name` | TEXT | No | User-facing profile name. |
| `owner_account_id` | TEXT (FK) | Yes | FK -> `collection_data_auth_accounts.id`. |
| `is_local_profile` | INTEGER | No | `1` means local profile, not cloud-linked. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>collection_data_collections</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Collection ID (currently same as profile in app flow). |
| `profile_id` | TEXT (FK) | No | FK -> `collection_data_profiles.id`. |
| `name` | TEXT | No | Collection display name. |
| `description` | TEXT | Yes | Optional collection description. |
| `visibility` | TEXT | No | Visibility flag (`private`, etc.). |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>collection_data_locations</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Location ID. |
| `collection_id` | TEXT (FK) | No | FK -> `collection_data_collections.id`. |
| `name` | TEXT | No | Location name (binder/box/shelf). |
| `kind` | TEXT | No | Location kind label (default `box`). |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>collection_data_collection_items</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Owned-item row ID. |
| `collection_id` | TEXT (FK) | No | FK -> `collection_data_collections.id`. |
| `printing_id` | TEXT (FK) | No | FK -> `card_data_printings.id` (Scryfall printing UUID). |
| `quantity_nonfoil` | INTEGER | No | Owned nonfoil quantity. |
| `quantity_foil` | INTEGER | No | Owned foil quantity. |
| `condition_code` | TEXT | No | Condition code (`NM`, etc.). |
| `language` | TEXT | No | Language code (`en`, etc.). |
| `purchase_price` | NUMERIC | Yes | Optional acquisition cost. |
| `acquired_at` | TEXT | Yes | Optional date/time acquired. |
| `location_id` | TEXT (FK) | Yes | FK -> `collection_data_locations.id`. |
| `notes` | TEXT | Yes | User notes for this inventory row. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>collection_data_tags</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Tag ID. |
| `collection_id` | TEXT (FK) | No | FK -> `collection_data_collections.id`. |
| `name` | TEXT | No | User-defined tag text. |
| `color_hex` | TEXT | Yes | Optional UI color for tag. |
| `created_at` | TEXT | No | Creation timestamp. |

</details>

<details>
<summary><code>collection_data_collection_item_tags</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `collection_item_id` | TEXT (PK/FK) | No | FK -> `collection_data_collection_items.id`. |
| `tag_id` | TEXT (PK/FK) | No | FK -> `collection_data_tags.id`. |
| `created_at` | TEXT | No | Assignment timestamp. |

</details>

<details>
<summary><code>collection_data_item_events</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Event row ID. |
| `collection_id` | TEXT (FK) | No | FK -> `collection_data_collections.id`. |
| `collection_item_id` | TEXT (FK) | Yes | FK -> `collection_data_collection_items.id` (nullable for deletions). |
| `printing_id` | TEXT (FK) | No | FK -> `card_data_printings.id`. |
| `event_type` | TEXT | No | Event label (`add`, `remove`, etc.). |
| `quantity_nonfoil_delta` | INTEGER | No | Nonfoil quantity change. |
| `quantity_foil_delta` | INTEGER | No | Foil quantity change. |
| `metadata_json` | TEXT | Yes | Optional event metadata payload. |
| `occurred_at` | TEXT | No | Logical event time. |
| `created_at` | TEXT | No | Insert timestamp. |

</details>

</details>

<details>
<summary><strong>card_data_*</strong></summary>

<details>
<summary><code>card_data_sets</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `set_code` | TEXT (PK) | No | Set code (`mh3`, `neo`, etc.). |
| `set_name` | TEXT | No | Set display name. |
| `set_type` | TEXT | Yes | Set category/type. |
| `released_at` | TEXT | Yes | Set release date. |
| `card_count` | INTEGER | Yes | Card count for set. |
| `icon_svg_uri` | TEXT | Yes | Set icon URI. |
| `scryfall_set_uri` | TEXT | Yes | Scryfall set API URI. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_cards</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Card identity row ID (currently mapped to printing ID in app helpers). |
| `oracle_id` | TEXT (UNIQUE) | Yes | Scryfall oracle identity. |
| `name` | TEXT | No | Card name. |
| `mana_cost` | TEXT | Yes | Mana cost string. |
| `cmc` | REAL | Yes | Converted mana value. |
| `type_line` | TEXT | Yes | Type line. |
| `oracle_text` | TEXT | Yes | Oracle text body. |
| `reserved` | INTEGER | No | Reserved-list flag. |
| `keywords_json` | TEXT | Yes | JSON array of keywords. |
| `colors_json` | TEXT | Yes | JSON array of face colors. |
| `color_identity_json` | TEXT | Yes | JSON array of color identity. |
| `latest_released_at` | TEXT | Yes | Latest release date seen for card. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_printings</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Scryfall printing UUID (primary card ID used by app inventory/prices). |
| `card_id` | TEXT (FK) | No | FK -> `card_data_cards.id`. |
| `oracle_id` | TEXT | Yes | Oracle ID for grouping printings. |
| `set_code` | TEXT (FK) | No | FK -> `card_data_sets.set_code`. |
| `collector_number` | TEXT | No | Collector number in set. |
| `lang` | TEXT | No | Printing language. |
| `rarity` | TEXT | Yes | Rarity string. |
| `layout` | TEXT | Yes | Layout (`normal`, `transform`, etc.). |
| `released_at` | TEXT | Yes | Printing release date. |
| `artist` | TEXT | Yes | Artist. |
| `image_normal_url` | TEXT | Yes | Normal image URL. |
| `image_small_url` | TEXT | Yes | Small image URL. |
| `image_art_crop_url` | TEXT | Yes | Art-crop image URL. |
| `image_png_url` | TEXT | Yes | PNG image URL. |
| `is_token` | INTEGER | No | Token flag. |
| `is_digital` | INTEGER | No | Digital-only flag. |
| `is_foil_available` | INTEGER | No | Foil availability flag. |
| `is_nonfoil_available` | INTEGER | No | Nonfoil availability flag. |
| `tcgplayer_id` | INTEGER | Yes | TCGplayer product ID. |
| `cardmarket_id` | INTEGER | Yes | Cardmarket ID. |
| `mtgo_id` | INTEGER | Yes | MTGO ID. |
| `mtgo_foil_id` | INTEGER | Yes | MTGO foil ID. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_card_faces</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Face row ID. |
| `printing_id` | TEXT (FK) | No | FK -> `card_data_printings.id`. |
| `face_index` | INTEGER | No | Face order index (0,1,...). |
| `name` | TEXT | Yes | Face name. |
| `mana_cost` | TEXT | Yes | Face mana cost. |
| `type_line` | TEXT | Yes | Face type line. |
| `oracle_text` | TEXT | Yes | Face oracle text. |
| `colors_json` | TEXT | Yes | Face colors JSON. |
| `power` | TEXT | Yes | Face power. |
| `toughness` | TEXT | Yes | Face toughness. |
| `loyalty` | TEXT | Yes | Face loyalty. |
| `defense` | TEXT | Yes | Face defense (battle). |
| `image_uris_json` | TEXT | Yes | Face image URI map JSON. |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_printing_parts</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `printing_id` | TEXT (PK/FK) | No | FK -> `card_data_printings.id`. |
| `related_scryfall_id` | TEXT (PK) | No | Related card/part Scryfall ID. |
| `component` | TEXT | Yes | Relationship component kind (`token`, `meld_part`, etc.). |
| `name` | TEXT | Yes | Related part name. |
| `type_line` | TEXT | Yes | Related part type line. |
| `uri` | TEXT | Yes | Related URI. |
| `created_at` | TEXT | No | Creation timestamp. |

</details>

<details>
<summary><code>card_data_legalities</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `printing_id` | TEXT (PK/FK) | No | FK -> `card_data_printings.id`. |
| `format_code` | TEXT (PK) | No | Format code (`commander`, `modern`, etc.). |
| `status` | TEXT | No | Legality status (`legal`, `banned`, etc.). |
| `created_at` | TEXT | No | Creation timestamp. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_price_providers</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK) | No | Numeric provider ID used by price rows. |
| `provider_code` | TEXT (UNIQUE) | No | Stable provider code (`tcgplayer`, `ck`, etc.). |
| `provider_name` | TEXT | No | Display name. |
| `supports_sell` | INTEGER | No | Whether provider has sell-side channels. |
| `supports_buylist` | INTEGER | No | Whether provider has buylist channels. |
| `is_active` | INTEGER | No | Active provider flag. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_price_channels</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK) | No | Numeric channel ID used by price rows. |
| `provider_id` | INTEGER (FK) | No | FK -> `card_data_price_providers.id`. |
| `channel_code` | TEXT | No | Channel code (`market`, `low`, `high`, `buylist`, `sell`). |
| `channel_name` | TEXT | No | Display channel name. |
| `direction_code` | INTEGER | No | Direction enum (sell-side/buylist-side). |
| `needs_condition` | INTEGER | No | Whether condition is required for this channel. |
| `needs_finish` | INTEGER | No | Whether finish is required for this channel. |
| `updated_at` | TEXT | No | Last update timestamp. |

Notes:
- Migration `0006_price_channels_expand.sql` adds channel IDs:
  - `6` TCG Low
  - `7` (legacy) TCG Mid
  - `8` TCG High
  - `11` CK Sell

</details>

<details>
<summary><code>card_data_currency_codes</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK) | No | Numeric currency ID. |
| `currency_code` | TEXT (UNIQUE) | No | Currency code (`USD`, etc.). |
| `symbol` | TEXT | Yes | Currency symbol. |

</details>

<details>
<summary><code>card_data_condition_codes</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK) | No | Numeric condition ID. |
| `condition_code` | TEXT (UNIQUE) | No | Condition code (`NM`, etc.). |
| `sort_order` | INTEGER | No | Ordering rank for UI/sorting. |
| `condition_group_id` | INTEGER | No | Canonical condition bucket for cross-provider mapping (NM=1, LP/EX=2, MP/VG=3, HP/G=4, DMG=5). |

</details>

<details>
<summary><code>card_data_finish_codes</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK) | No | Numeric finish ID. |
| `finish_code` | TEXT (UNIQUE) | No | Finish code (`nonfoil`, `foil`, etc.). |
| `sort_order` | INTEGER | No | Ordering rank for UI/sorting. |

</details>

<details>
<summary><code>card_data_card_prices</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | INTEGER (PK AUTOINCREMENT) | No | Surrogate row ID. |
| `printing_id` | TEXT (FK) | No | FK -> `card_data_printings.id` (Scryfall printing UUID). |
| `condition_id` | INTEGER (FK) | Yes | FK -> `card_data_condition_codes.id`. |
| `finish_id` | INTEGER (FK) | Yes | FK -> `card_data_finish_codes.id`. |
| `tcg_low` | NUMERIC | Yes | TCGplayer low price snapshot. |
| `tcg_market` | NUMERIC | Yes | TCGplayer market price snapshot. |
| `tcg_high` | NUMERIC | Yes | TCGplayer high price snapshot. |
| `ck_sell` | NUMERIC | Yes | Card Kingdom sell price snapshot. |
| `ck_buylist` | NUMERIC | Yes | Card Kingdom buylist cash snapshot. |
| `ck_buylist_quantity_cap` | INTEGER | Yes | Card Kingdom buylist quantity wanted/cap. |
| `sync_version` | TEXT | No | Build/version label for snapshot lineage. |
| `captured_ymd` | INTEGER | Yes | Date key `YYYYMMDD` for partition-like filtering. |
| `captured_at` | TEXT | No | Capture timestamp for ordering/history. |
| `created_at` | TEXT | No | Insert timestamp. |

</details>

<details>
<summary><code>card_data_otags</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Otag ID. |
| `source` | TEXT | No | Otag source namespace. |
| `tag_code` | TEXT | No | Otag code. |
| `description` | TEXT | Yes | Optional otag description. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>card_data_printing_otags</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `printing_id` | TEXT (PK/FK) | No | FK -> `card_data_printings.id`. |
| `otag_id` | TEXT (PK/FK) | No | FK -> `card_data_otags.id`. |
| `created_at` | TEXT | No | Assignment timestamp. |

</details>

</details>

<details>
<summary><strong>system_data_sync_*</strong></summary>

<details>
<summary><code>system_data_sync_data_sources</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Source ID (`scryfall_default_cards`, etc.). |
| `kind` | TEXT | No | Source kind/category. |
| `base_url` | TEXT | Yes | Source base URL. |
| `enabled` | INTEGER | No | Source enabled flag. |
| `refresh_window_utc` | TEXT | Yes | Expected refresh window metadata. |
| `updated_at` | TEXT | No | Last update timestamp. |

</details>

<details>
<summary><code>system_data_sync_dataset_versions</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Version row ID. |
| `source_id` | TEXT (FK) | No | FK -> `system_data_sync_data_sources.id`. |
| `dataset_name` | TEXT | No | Dataset name (`default_cards`). |
| `build_version` | TEXT | No | Build version string. |
| `state_hash` | TEXT | Yes | Dataset hash/checksum. |
| `record_count` | INTEGER | Yes | Record count for this version. |
| `created_at` | TEXT | No | Creation timestamp. |

</details>

<details>
<summary><code>system_data_sync_patches</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Patch row ID. |
| `source_id` | TEXT (FK) | No | FK -> `system_data_sync_data_sources.id`. |
| `dataset_name` | TEXT | No | Dataset name. |
| `from_version` | TEXT | Yes | Starting version of patch. |
| `to_version` | TEXT | No | Target version of patch. |
| `patch_hash` | TEXT | Yes | Patch hash/checksum. |
| `strategy` | TEXT | No | Patch strategy label. |
| `added_count` | INTEGER | No | Added rows count. |
| `updated_count` | INTEGER | No | Updated rows count. |
| `removed_count` | INTEGER | No | Removed rows count. |
| `artifact_uri` | TEXT | Yes | URI/path to patch artifact. |
| `created_at` | TEXT | No | Creation timestamp. |

</details>

<details>
<summary><code>system_data_sync_client_sync_state</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `client_id` | TEXT (PK part) | No | Client identity (desktop local instance id). |
| `dataset_name` | TEXT (PK part) | No | Dataset name. |
| `current_version` | TEXT | Yes | Last applied version. |
| `state_hash` | TEXT | Yes | Last known state hash. |
| `synced_at` | TEXT | No | Last successful sync time. |
| `updated_at` | TEXT | No | Last state row update time. |

</details>

<details>
<summary><code>system_data_sync_patch_apply_history</code></summary>

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | TEXT (PK) | No | Apply-attempt row ID. |
| `client_id` | TEXT | No | Client identity. |
| `dataset_name` | TEXT | No | Dataset name. |
| `from_version` | TEXT | Yes | Starting version. |
| `to_version` | TEXT | No | Target version. |
| `strategy` | TEXT | No | Apply strategy used. |
| `duration_ms` | INTEGER | Yes | Apply duration in ms. |
| `result` | TEXT | No | Outcome (`success`, `error`, etc.). |
| `error_message` | TEXT | Yes | Failure details if any. |
| `applied_at` | TEXT | No | Apply timestamp. |

</details>

</details>

## Notes on visibility and usage
- Some columns are metadata-ready even if UI is not using them yet.
- Current runtime uses many but not all columns in every table.
- This doc is schema-complete (all active tables/columns), not only UI-complete.
