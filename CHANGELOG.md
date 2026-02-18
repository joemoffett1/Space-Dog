# CHANGELOG

All notable changes to this project are documented in this file.

Versioning policy for alpha:
- Format: `1.x.x-alpha`
- Increment `minor` (`x` in `1.x.0-alpha`) for new features.
- Increment `patch` (`x` in `1.0.x-alpha`) for updates/fixes to existing features.
- Use engineering discretion on feature vs update.

## [1.20.22-alpha] - 2026-02-18
### Changed
- Updated `docs/FRONTEND_BACKEND_SQL_MAP.md` Part 3 to organize SQL inventory by call location:
  - startup/app bootstrap
  - collection/profile flows
  - collection search/sort/pricing view calls
  - market page calls
  - global sync/catalog pipeline calls
- Refreshed frontend/backend command mapping and SQL call catalog consistency for current runtime command paths.

## [1.20.20-alpha] - 2026-02-15
### Changed
- Updated unified sync pipeline to run in explicit 3-step order:
  - `TCGTracking` pricing sync first
  - `Card Kingdom` pricing sync second
  - `Scryfall` full `default_cards` metadata/oracle upsert third
- Removed Scryfall price writing from unified sync (Scryfall is now metadata/oracle only in this flow).
- Added cooperative throttling during long sync loops to reduce sustained CPU spikes:
  - short periodic sleeps every N rows/sets while processing global updates
- Added CK sync safety guard for missing printings in global runs:
  - CK rows without an existing `card_data_printings.id` are skipped instead of causing FK failures.
- Updated frontend sync status text and error fallback so it no longer reports Scryfall pricing refresh failures.

## [1.20.21-alpha] - 2026-02-15
### Changed
- Added migration tracking table `_app_migrations` and switched startup migration execution to apply-once semantics.
- Added `0008_compact_price_rows.sql`:
  - migrates `card_data_card_prices` from provider/channel row model to compact per-card rows
  - adds compact price columns (`tcg_low`, `tcg_market`, `tcg_high`, `ck_sell`, `ck_buylist`, `ck_buylist_quantity_cap`)
  - adds `condition_group_id` on `card_data_condition_codes` for cross-provider condition mapping
- Refactored backend price reads/writes to use compact row model:
  - sync, trend reads, catalog snapshot/patch apply, and market snapshot ingestion now target compact columns
  - collection source trend lookup now maps source keys to compact columns.
- Updated `DATABASE_SCHEMA.md` and `SQL_MIG.md` for the compact pricing model and new migration order/state.

## [1.20.19-alpha] - 2026-02-15
### Changed
- Expanded unified sync scope to global-card server behavior:
  - Scryfall now syncs from `bulk-data -> default_cards` (all cards), not only cards currently in a collection.
  - TCGTracking now scans all available sets from `/tcgapi/v1/1/sets` and writes matched TCG channels globally.
  - CK sync remains global via CK pricelist and is executed as part of the same run.
- Scryfall oracle/card updates now explicitly return unchanged vs changed semantics suitable for global diff-style processing.

## [1.20.18-alpha] - 2026-02-15
### Added
- Added unified backend sync command `sync_all_sources_now` (Tauri) to run source ingestion in one action:
  - Scryfall collection metadata/oracle refresh against local printings
  - TCGTracking TCGplayer channel refresh (market/low/high where available)
  - Card Kingdom sync reuse for buylist/sell channels
- Added sync source/version bookkeeping writes for runtime sync runs in `system_data_sync_*` tables.

### Changed
- Updated app refresh flow to use unified backend sync command instead of mock patch-only flow.
- Refresh button is now always clickable (still acts as cancel while a sync is running).
- Refresh completion summary now reports source-level counts from the unified sync result.

## [1.20.15-alpha] - 2026-02-11
### Changed
- Completed full legacy migration cleanup:
  - removed `magiccollection-desktop/src-tauri/migrations/0001_initial.sql`
  - removed `magiccollection-desktop/src-tauri/migrations/0002_catalog_sync.sql`
  - removed `magiccollection-desktop/src-tauri/migrations/0003_filter_tokens.sql`
- Trimmed `0004_schema_groups_v2.sql` to v2-only schema/seed content (legacy backfill and compatibility trigger sections removed).
- Kept and wired `0005_drop_legacy_tables.sql` as cleanup safety migration for existing legacy DBs.
- Updated startup migration order to v2-only (`0004`, then `0005`).

### Docs
- Updated `SQL_MIG.md`, `DATABASE_SCHEMA.md`, `ARCHITECTURE.md`, `magiccollection-desktop/BASELINE.md`, and root `README.md` to reflect the v2-only SQL state.

## [1.20.16-alpha] - 2026-02-11
### Added
- Added a collection import wizard for delimited files in Collection view:
  - file picker supports `.csv`, `.tsv`, and `.txt`
  - delimiter selection (`auto`, `comma`, `tab`, `semicolon`, `pipe`, `custom`)
  - column mapping UI for required and optional fields
  - preview table before import
  - tolerant row handling (invalid/unsupported rows are skipped)
- Added generic delimited importer module:
  - `magiccollection-desktop/src/lib/importers/delimited.ts`
  - supports mapping-driven conversion into `CollectionImportRow[]`
  - supports optional "use first tag as location when location column is empty"

### Changed
- Replaced strict `Import Archidekt CSV` action with `Import Collection File` wizard flow in `CollectionPage`.
- Updated import row model to carry optional metadata fields:
  - `locationName`, `conditionCode`, `language`, `notes`, `purchasePrice`, `dateAdded`, `imageUrl`
- Updated Rust `import_collection_rows` handling to persist mapped metadata on import rows (including location resolution).

## [1.20.17-alpha] - 2026-02-11
### Changed
- Import wizard enrichment now resolves identity in both directions:
  - fills missing `scryfallId` from `setCode + collectorNumber`
  - fills missing `setCode + collectorNumber` from `scryfallId`
- Added backend upsert guard so placeholder import values do not overwrite known printing identity fields:
  - keeps existing set when incoming set is `unknown`
  - keeps existing collector number when incoming value is `0`
- Collection UI now hides system-derived tags (`owned`, `foil`, `playset`) from visible tag chips and user tag filters.
- Filter token generation excludes system tags from `tag:` suggestions and guidance text now points to user tags.
- Added bulk delete action for selected rows with confirmation:
  - `Remove Selected Rows` button below the visible-row count
  - backend bulk remove command (`remove_cards_from_collection`) for fast multi-row deletion.

## [1.20.14-alpha] - 2026-02-11
### Added
- Added cleanup migration: `magiccollection-desktop/src-tauri/migrations/0005_drop_legacy_tables.sql`.
  - Drops legacy compatibility triggers from `0004`.
  - Drops legacy tables (`profiles`, `cards`, `printings`, `locations`, `owned_items`, `tags`, `owned_item_tags`, `transactions`, `price_snapshots`, `buylist_offers`, `catalog_cards`, `catalog_sync_state`, `catalog_patch_history`, `filter_tokens`).

### Changed
- Wired `0005_drop_legacy_tables.sql` into DB init in `magiccollection-desktop/src-tauri/src/lib.rs`.
- Updated migration documentation (`SQL_MIG.md`, `DATABASE_SCHEMA.md`) to reflect full cleanup stage.

## [1.20.13-alpha] - 2026-02-10
### Changed
- Migrated Rust runtime SQL in `magiccollection-desktop/src-tauri/src/lib.rs` from legacy tables to grouped v2 tables:
  - collection flows now use `collection_data_*`
  - card metadata/pricing flows now use `card_data_*`
  - catalog sync state/history now use `system_data_sync_*`
- Reworked catalog sync command SQL to store and read market snapshot versions from `card_data_card_prices` instead of `catalog_cards`.
- Replaced SQL-backed `filter_tokens` usage with dynamic token generation from current collection/card data (no runtime dependency on legacy `filter_tokens` table).
- Updated `SQL_MIG.md` execution status and table migration state to reflect runtime completion.

## [1.20.12-alpha] - 2026-02-10
### Added
- Added `magiccollection-desktop/src-tauri/migrations/0004_schema_groups_v2.sql` implementing the full SQL transition foundation:
  - new grouped tables across `collection_data_*`, `card_data_*`, `system_data_sync_*`
  - compact unified pricing model in `card_data_card_prices`
  - compact dictionary tables (`provider/channel/currency/condition/finish`)
  - `sync_version` + `captured_ymd` fields for patch-build based ingest
  - one-time backfill from legacy tables
  - legacy -> v2 compatibility triggers so current app write paths mirror into v2 tables
- Added transition runbook: `SQL_SCHEMA_TRANSITION_PLAN.md`.

### Changed
- Wired migration `0004_schema_groups_v2.sql` into Rust DB initialization in `magiccollection-desktop/src-tauri/src/lib.rs`.
- Updated `DATABASE_SCHEMA.md` source-of-truth migration list to include `0004`.
- Updated `NEXT_STEPS.md` to reflect that DB-layer v2 migration is implemented and app-layer query migration is next.

## [1.20.11-alpha] - 2026-02-10
### Changed
- Updated target pricing schema in `DATABASE_SCHEMA.md` to use a compact unified pricing model:
  - replaced separate target `card_data.prices` + `card_data.buylist_offers` with one target `card_data.card_prices` fact table
  - added dictionary/code tables for compact storage and transport:
    - `card_data.price_providers`
    - `card_data.price_channels`
    - `card_data.currency_codes`
    - `card_data.condition_codes`
    - `card_data.finish_codes`
- Added compact patch payload guidance for daily phone-friendly sync records using coded dimensions and `captured_ymd` + `build_version`.
- Updated `NEXT_STEPS.md` Phase 3 to align pricing roadmap with the unified compact pricing model.

## [1.20.10-alpha] - 2026-02-10
### Changed
- Expanded `DATABASE_SCHEMA.md` with a forward production blueprint using requested logical schema groups:
  - `collection_data`
  - `card_data`
  - `system_data_sync`
- Added a concrete auth/profile/collection separation model with offline-local support and password-hash storage guidance.
- Added lightweight-collection/heavy-catalog FK strategy and minimal cross-schema FK policy.
- Added explicit search operator policy for custom tags vs external tags:
  - user tags: `ctag:`
  - external tags: `otag:`
  - Scryfall operator precedence when conflicts exist.
- Added migration strategy for SQLite now and service DB later, including prefixed table naming guidance (`collection_data_*`, `card_data_*`, `system_data_sync_*`).
- Added generated Scryfall field inventory artifact:
  - `docs/scryfall_default_cards_field_inventory_2026-02-10.json`
  - sourced from local `default_cards.json` to ground schema design in real payload coverage.

## [1.20.9-alpha] - 2026-02-10
### Changed
- Reworked `DATABASE_SCHEMA.md` into a human-friendly format with:
- quick-start summary
- domain overview table
- Mermaid system map + ER map + flow sequence diagrams
- schema-group based nested collapsible table reference
- cross-group foreign key map + physical-vs-logical schema clarification
- Mermaid schema group map and preview/render guidance for VS Code
- Added workspace markdown preview styling for sharper in-IDE docs:
- `.vscode/settings.json` markdown preview defaults
- `docs/markdown-preview.css` for typography, table, code block, and details styling
- Reworked `ARCHITECTURE.md` into a modern reader-focused format with:
- executive summary and runtime layer matrix
- Mermaid architecture and flow diagrams
- clearer scope boundaries (current vs deferred)
- direct cross-linking to `DATABASE_SCHEMA.md` for deep data details

## [1.20.8-alpha] - 2026-02-10
### Added
- Added root `DATABASE_SCHEMA.md` with a full SQL reference:
- physical DB location and startup/migration lifecycle
- complete table and column catalog with field meaning
- key constraints/indexes for each table
- relationship map (logical ERD)
- runtime flow map for profile, CSV import, metadata hydration, pricing, and catalog sync
- near-term schema extension recommendations (sets normalization, transaction ledger activation, migration tracking)

## [1.20.7-alpha] - 2026-02-10
### Changed
- Added Scryfall metadata hydration pipeline for owned cards with missing metadata (`type_line`, color identity, CMC, rarity, image URLs):
  - new backend command `hydrate_profile_card_metadata`
  - batch fetches via Scryfall collection endpoint (75 IDs/request)
  - updates local SQLite `cards` and `printings` rows
  - re-syncs filter tokens after hydration
- Wired Collection type-search flow (`t:` / `type:`) to auto-trigger metadata hydration when type metadata is missing in the active profile.
- Added in-UI status messaging when type metadata is missing/hydrating so type-filter behavior is transparent.

## [1.20.6-alpha] - 2026-02-10
### Changed
- Fixed inline search token UX so bare prefix terms (for example `set:` / `t:`) continue to drive contextual suggestions without requiring a click back into that token box.
- Added prefix carryover behavior: typing in the next draft slot now fills the trailing bare prefix token instead of creating a disconnected free-text token.
- Improved `t:` search behavior:
  - `t:` now always maps to type search (Scryfall-style alias of `type:`).
  - type suggestions now include canonical MTG type vocabulary even when collection metadata is sparse.
- Updated inline token box sizing to be content-driven (`ch` width) so term boxes and draft input expand/contract with entered text.

## [1.20.5-alpha] - 2026-02-10
### Added
- Added Playwright E2E test harness in `magiccollection-desktop`:
- `playwright.config.ts` with dual run mode support:
  - web mode (auto-start Vite on `127.0.0.1:4173`)
  - Tauri-attached mode (`PW_USE_TAURI=1`, target `127.0.0.1:1420`)
- Added baseline smoke tests for:
  - login-first gate visibility
  - local account creation
  - collection profile creation/open flow
- Added `npm` scripts:
  - `test:e2e`
  - `test:e2e:headed`
  - `test:e2e:ui`
  - `test:e2e:tauri`
- Added `tests/e2e/README.md` runbook and `.gitignore` entries for Playwright artifacts.

## [1.20.4-alpha] - 2026-02-10
### Changed
- Reworked Collection search into an inline token editor:
- active terms now appear inside the search control as editable colored boxes (instead of non-editable chips below).
- each term can be edited directly or removed inline.
- Added draft-term tokenization behavior so typing a space commits the current term box.
- Updated suggestion targeting so autocomplete follows the currently active search box/draft input.
- Hardened `t:` search matching to use:
- inferred primary type
- full `type_line` text
- normalized tags fallback (for imports with sparse type metadata)

## [1.20.3-alpha] - 2026-02-10
### Changed
- Completed the final open UI mockup delta item by adding token-kind color coding to active search chips (`set`, `tag`, `type`, `color`, `rarity`, `language`, `condition`, `mana`, `state`).
- Upgraded token suggestion rows with token-kind accents for faster visual scan in the dropdown.
- Added contextual filter-option suggestion mode for partial token prefixes so non-technical users get selectable options while typing:
- `set:`
- `tag:`
- `t:` / `type:`
- `c:` / `id:`
- `lang:`
- `cond:`
- `rarity:`
- Added context-aware empty-state messaging in the token dropdown (`No options match this filter...`) during prefix option mode.

## [1.20.2-alpha] - 2026-02-10
### Changed
- Fixed image-view versions modal visibility/layering by rendering the modal overlay through a portal to `document.body`.
- Hardened modal stacking with explicit modal positioning/z-index so the versions dialog reliably renders above blurred overlay state.

## [1.20.1-alpha] - 2026-02-10
### Changed
- Fixed Versions modal layout regression by restoring the full-width versions grid for Step 2 (removed thumbnail-style side summary in that step).
- Added explicit `Versions` action button on image-view cards for clearer/openable version access.
- Fixed image-view click-through reliability by making overlay badges non-interactive (`pointer-events: none`).

## [1.20.0-alpha] - 2026-02-10
### Added
- Completed major UI batch sweep across shell, collection views, modal flow, and interaction polish:
- global top frame + branded header lockup
- refined nav cards with glyph+label hierarchy
- quick filter row (set/type/color) plus sort and price-source controls
- table status strip (visible count, sort, density, source)
- modal step progress rail + guided side panels for Add/Versions flows
- versions side summary card with printing/ownership rollups
- gallery overlays for quantity/foil/version badges
- Added stronger accessibility affordances:
- global focus-visible ring treatment
- themed scrollbars
- reduced-motion fallback behavior

### Changed
- Tightened table typography and spacing for better dense-data readability.
- Upgraded action cluster ergonomics in table and modal cards (`+N/+F/-N/-F`, edit/remove grouping).
- Updated image-card and version-card hover/focus motion to feel more intentional.
- Updated `NEXT_STEPS.md` UI A-F groups and marked 4 UI batches complete with one remaining partial item.

## [1.19.1-alpha] - 2026-02-09
### Changed
- Refined Collection toolbar layout into grouped controls for cleaner spacing and improved readability.
- Added row density control (`Comfortable`, `Balanced`, `Dense`) that updates virtual row height and image-grid density.
- Added active search-token chips under search (click to remove token quickly).
- Added responsive polish for the new toolbar/search layout on smaller viewports.

## [1.19.0-alpha] - 2026-02-09
### Added
- Added Collection search token autocomplete backed by SQLite `filter_tokens` + fallback seed tokens:
- supports suggestions for `set:`, `t:`, `tag:`, `c:`, `id:`, `rarity:`, `lang:`, `cond:`, `mv>=`, `is:foil`, `is:nonfoil`
- keyboard navigation for suggestions (`Up/Down`, `Enter`, `Tab`, `Esc`)
- Added syntax-aware Collection filtering parser (Scryfall-style subset + internal fields) on top of existing quick filters.
- Added text-view mini art thumbnails in the first column to improve scanability in dense table mode.
- Added resilient card-image fallback rendering in image/text/modal cards to avoid broken-image tiles.

### Changed
- Hooked frontend token query payload to Tauri command input shape (`get_filter_tokens` now receives `input` object).
- Added/finished filter-token sync updates in Rust mutation flows, including `set_owned_card_state`.
- Updated Collection search placeholder/help text to advertise supported syntax operators.

## [1.18.0-alpha] - 2026-02-09
### Added
- Added free UI icon asset pack from Tabler Icons into `magiccollection-desktop/public/ui-icons`.
- Added Archidekt-style popup submenu flow in Collection:
- modal overlay with step-style tabs (`Add Card`, `Versions`)
- quick add search submenu with Scryfall-backed query + +N/+F actions
- versions submenu with owned-first sorting and direct +/- quantity controls
- Added in-app `Credits And Licenses` section in Settings with source + usage-term summary.

### Changed
- Refreshed UI typography to `Space Grotesk` + `Orbitron` (Google Fonts).
- Updated collection controls to use icon-assisted buttons and sleeker modal layout.
- Expanded attribution ledger with concrete path-level entries for icon and font assets.

## [1.17.1-alpha] - 2026-02-09
### Added
- Added root `ASSET_CREDITS.md` as the canonical source/terms ledger for assets and API-sourced media/data.
- Documented explicit source + usage terms for:
- app icon assets generated from user-provided artwork
- Vite/React template assets
- Scryfall and CK sourced runtime data/media
- Added attribution policy requiring new third-party assets to be registered before release.

### Changed
- Added paw-theme visual treatment classes (`paw-pill`, `paw-icon-button`) and applied them to key controls.

## [1.17.0-alpha] - 2026-02-09
### Added
- Added richer collection filtering with quick multi-select dropdown filters:
- set
- primary type
- color identity
- tags
- condition
- language
- Added text-view field visibility toggles (show/hide columns for set, number, tags, price, trend).
- Added direct version-panel quantity controls (`+N`, `+F`, `-N`, `-F`) for printings shown in the card-version drawer.
- Added compact mode as a checkbox toggle (`Compact Rows`) rather than a separate view tab.

### Changed
- Collection image cards now show type/color identity hints (`type · color`) for faster scanability.
- Market add/import pipelines now carry metadata fields (`typeLine`, `colorIdentity`, `manaValue`, `rarity`) into owned card records.
- Rust backend now persists and returns owned-card metadata needed for richer local filtering.

## [1.16.2-alpha] - 2026-02-09
### Added
- Added root `ARCHITECTURE.md` covering:
- full stack layers
- local-first deployment model
- dependency inventory
- core runtime data flows

### Changed
- Rewrote `NEXT_STEPS.md` to prioritize desktop prototype quality and local sync workflow before cloud deployment.
- Added targeted code comments in complex paths:
- undo snapshot/restore flow in `App.tsx`
- sync single-flight/runtime strategy in `catalogSync.ts`
- restore + CK quote logic in `src-tauri/src/lib.rs`

## [1.16.1-alpha] - 2026-02-09
### Changed
- Local auth entry flow is now login-first with explicit `Login` / `Create Account` mode switch.
- Account creation is now behind the create tab instead of being the default initial screen.

## [1.16.0-alpha] - 2026-02-09
### Added
- Added collection action-history undo flow (Group D task 26):
- new `Undo` action in Collection toolbar
- per-action reversible snapshots for quantity edits, remove, tag updates, and metadata edits
- Added backend card-state restore API for deterministic undo:
- frontend API: `setOwnedCardState` in `src/lib/backend.ts`
- Tauri command: `set_owned_card_state` in `src-tauri/src/lib.rs`

### Changed
- Collection mutation handlers now record undo entries and restore previous card state safely.

## [1.15.0-alpha] - 2026-02-09
### Added
- Added offline-first local account login gate before collection profile access:
- local account register/sign-in UI in `magiccollection-desktop/src/components/LocalAuthGate.tsx`
- local sign-out action in header
- local auth status surfaced in Settings with `syncPending` visibility
- Added direct Card Kingdom public buylist integration in Tauri backend:
- `get_ck_buylist_quotes` command now fetches and caches CK public pricelist (12h cache)
- Reports buylist provider now supports `public` mode
- Added Cloudflare deployment scaffold for sync service:
- `sync-service/cloudflare/src/worker.ts`
- `sync-service/cloudflare/wrangler.toml.example`
- `sync-service/cloudflare/README.md`

### Changed
- `ReportsPage` provider typing expanded to include `public`.
- Sync service docs now include Cloudflare Worker + R2 hosting path.

## [1.14.0-alpha] - 2026-02-09
### Added
- Added cross-platform handoff scaffolding docs:
- `shared-core/README.md`
- `web-client/README.md`
- Added desktop drag/drop and paste handoff support for Scryfall URLs into Market search.

### Notes
- Auth strategy and mobile local-store architecture remain open decisions.

## [1.13.0-alpha] - 2026-02-09
### Added
- Added CK adapter scaffold in `src/lib/ckAdapter.ts` with feature flags:
- `VITE_ENABLE_CK`
- optional `VITE_CK_PROXY_URL`
- Added CK buylist analytics and sell-intent flow to Reports:
- cash/credit payout metrics
- coverage percentage
- top quote list
- sell-intent link launch

### Notes
- Live CK integration requires a configured proxy/API endpoint; fallback mock mode is active by default.

## [1.12.0-alpha] - 2026-02-09
### Added
- Added per-card metadata editing (condition, language, location, notes, purchase price, date added).
- Added bulk metadata operations for selected cards in Collection view.
- Added local performance metric recorder (`tab:<name>` timings) and Settings diagnostics display.
- Added backend/frontend metadata fields parity for owned cards.

### Changed
- Collection rows and image cards now include metadata-driven edit actions.

## [1.11.0-alpha] - 2026-02-09
### Added
- Added Market keyboard actions:
- `Enter` opens detail drawer
- `+` adds nonfoil
- `F` adds foil
- Added query validation warnings and saved-query UX refinements.

### Changed
- Market card interactions are now keyboard-first and focusable.

## [1.10.0-alpha] - 2026-02-09
### Added
- Added production-shaped sync pipeline scaffold in `sync-service/`:
- daily build command (`build-daily`)
- snapshot normalization
- incremental patch generation
- compacted patch generation
- manifest generation from version index
- Added local sync API hardening:
- `/health` and `/metrics`
- strategy-aware `/sync/status`
- `/sync/patch` and `/sync/snapshot` improvements
- per-IP rate limiting

### Changed
- Pipeline JSON reading is BOM-safe for Windows-generated files.

## [1.9.0-alpha] - 2026-02-09
### Added
- Added sync cancel support in desktop app:
- cancelable refresh path in header action
- cancel-aware network fetch and diagnostics tracking
- Added sync diagnostics extensions:
- canceled outcome support
- cancel counters
- in-flight join tracking

### Changed
- Refresh button now doubles as cancel action during active sync.
- Added backend storage optimization hook after heavy/full sync applies.

## [1.8.2-alpha] - 2026-02-09
### Added
- Initialized Git version control for the project and published `main` to `joemoffett1/Space-Dog`.

### Changed
- Added root `.gitignore` rules to exclude large local datasets/caches/backups from repository history.

## [1.8.3-alpha] - 2026-02-09
### Added
- Added root `README.md` as the remote update board with:
- short feature-added summary
- short feature-updated summary
- explicit user test checklist
- full changelog mirror
- Added explicit remaining big-task backlog to `NEXT_STEPS.md` with a fixed count for execution gating.

## [1.8.4-alpha] - 2026-02-09
### Changed
- Consolidated the 35 remaining tasks into 6 feature groups in `NEXT_STEPS.md`.
- Added grouped commit cadence to reduce commit volume (target: 7-12 commits for the backlog).

## [1.8.1-alpha] - 2026-02-09
### Changed
- Refresh hover text now includes both relative time remaining and exact local unlock timestamp.

## [1.8.0-alpha] - 2026-02-09
### Added
- SQLite-backed catalog sync foundation for `default_cards`:
- new schema migration `src-tauri/migrations/0002_catalog_sync.sql`
- `catalog_cards`, `catalog_sync_state`, and `catalog_patch_history` tables
- New Tauri sync commands:
- `get_catalog_sync_state`
- `get_catalog_price_records`
- `apply_catalog_snapshot`
- `apply_catalog_patch`
- `reset_catalog_sync_state_for_test`
- Transactional patch/snapshot apply with rollback-safe behavior and version checks.
- Deterministic catalog state hashing (`sha2`) persisted in sync state/history.

### Changed
- `catalogSync.ts` now uses backend DB sync state/patch apply in Tauri runtime, with browser localStorage fallback retained.
- Collection price refresh now reads catalog prices via one batched lookup (`getCatalogPriceRecords`) instead of per-card local reads.

## [1.7.2-alpha] - 2026-02-09
### Changed
- Added per-milestone delivery estimates in `NEXT_STEPS.md` with build + self-test ranges.
- Added a concrete "need from user" validation list for each major milestone.
- Added a testing dependencies checklist to unblock implementation sequencing.

## [1.7.1-alpha] - 2026-02-09
### Changed
- Reworked `NEXT_STEPS.md` into a full implementation roadmap with:
- explicit done vs not-done tracking from current alpha state
- server-managed patch architecture and policy (`chain`, `compacted`, `full`)
- desktop-first milestone sequencing through cross-platform delivery
- priority scope for Scryfall syntax search, CK buylist/sell flow, and drag/drop strategy

## [1.7.0-alpha] - 2026-02-09
### Added
- Real-world diff test pipeline between two Scryfall `default_cards` dumps (2025-02-04 to 2026-02-09).
- Generated compacted patch artifact and summary artifact under `magiccollection-desktop/logs/scryfall-test`.
- Field-level change analysis in summary output (prices, oracle text, image, set/collector changes).

## [1.6.2-alpha] - 2026-02-09
### Changed
- Header sync indicator now supports live progress with percent and phase text.
- Sync pill now shows yellow-to-green progress fill while refresh is running.

### Fixed
- Reduced "stuck syncing" UX by resetting progress state on completion/failure.

## [1.6.1-alpha] - 2026-02-09
### Fixed
- Sync status logic now enables refresh whenever local build is behind latest.
- First-run status no longer reports `local build none` as a false unsynced state.
- Consolidated status display to a single state pill (`Synced` / `Not Synced` / `Syncing...`).

## [1.6.0-alpha] - 2026-02-09
### Added
- Mock versioned catalog sync system with manifest, snapshots, incremental patches, and compacted patches.
- Sync policy support for:
- compacted mode when missed updates are high
- force full snapshot after stale threshold
- retention metadata for compacted patches
- Mock sync artifacts in `magiccollection-desktop/public/mock-sync`.
- Catalog sync engine (`src/lib/catalogSync.ts`) with strategy resolution (`noop`, `chain`, `compacted`, `full`).
- Data build status in app header with refresh lock logic based on publish window + lag.

### Changed
- Collection refresh path now applies mock patch data first, then falls back to Scryfall for missing IDs.

## [1.5.0-alpha] - 2026-02-09
### Added
- Advanced image-view interactions:
- side `+/-` controls
- per-card foil mode toggle
- selectable tag chips with highlight
- apply selected tag on card adjust actions
- Bulk and per-card tag persistence through backend APIs.

### Changed
- Tag workflows shifted from generic auto-tag focus to fast per-card tagging during quantity actions.

## [1.4.1-alpha] - 2026-02-09
### Fixed
- Image loading fallback for collection/version cards via Scryfall image endpoint when local image URL is missing.
- Version panel sorting to keep owned printings at top.

## [1.4.0-alpha] - 2026-02-09
### Added
- Collection view modes:
- Text
- Image
- Compact
- Virtualized rendering for large collections in text/compact modes.
- Incremental image loading in image mode.
- Version detail panel (owned highlighted, unowned dimmed).

### Changed
- Collection interactions now support optimistic quantity updates to improve responsiveness at high card counts.

## [1.3.0-alpha] - 2026-02-09
### Added
- Archidekt CSV import parser and import UI flow.
- Backend import command and transaction-based ingestion into SQLite.

## [1.2.0-alpha] - 2026-02-09
### Added
- Market tab lazy-loaded from Collection shell.
- Scryfall-driven market search with add-to-collection actions.
- Price snapshot recording and trend retrieval.
- Tag and trend indicators in Collection and Market views.

## [1.1.0-alpha] - 2026-02-09
### Added
- SQLite-backed Tauri command layer for profiles, collection CRUD, tags, and market snapshots.
- Local profile gate with create/open flows and optional local passcode protection.
- Initial schema migration in `src-tauri/migrations/0001_initial.sql`.

## [1.0.1-alpha] - 2026-02-09
### Added
- Windows-first launcher/tooling scripts for local dev workflow.
- Desktop shortcut and custom icon setup for MagicCollection.

## [1.0.0-alpha] - 2026-02-09
### Added
- Initial `magiccollection-desktop` scaffold (Tauri + React + TypeScript).
- Desktop-first app shell with primary tabs:
- Collection
- Market
- Reports
- Settings
- Space-themed UI baseline and project migration foundation.
