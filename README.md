# MagicCollection Remote Update Board

This README is currently the primary remote update surface for project progress.
It includes a quick summary, blockers, test focus, and a full changelog mirror.

Last updated: 2026-02-09
Current stage: `1.x.x-alpha`

## Features Added (This Run)
- Added `ARCHITECTURE.md` with full stack design, dependency inventory, and runtime data flows.
- Rewrote `NEXT_STEPS.md` for desktop-prototype-first priorities with local-only sync focus.

## Features Updated (This Run)
- Added targeted code comments in complex paths (`App.tsx`, `catalogSync.ts`, `src-tauri/src/lib.rs`) to improve maintainability.
- Kept prior auth/undo/CK features intact and validated with lint/build/check.

## Blockers (Logged And Bypassed)
- Group F blocker: cloud account server and mobile-store design are still pending.
- Cloudflare deployment is intentionally deferred until desktop prototype sign-off.

## Things You Need To Test
- Local auth flow:
  - create local account on first launch
  - sign out account from header
  - sign back in and confirm collection profiles still load
- Undo flow:
  - perform quantity edits/remove/tag/metadata edits
  - click `Undo` in Collection
  - confirm the previous card state restores correctly
- CK public buylist flow:
  - open Reports
  - click `Refresh CK Quotes`
  - confirm provider shows `public` and payout totals populate

## Group Status
1. Group A: `completed`
2. Group B: `in_progress` (cloud deployment credentials pending)
3. Group C: `completed`
4. Group D: `completed`
5. Group E: `completed`
6. Group F: `in_progress` (cloud auth + mobile store pending)

## Full Changelog
# CHANGELOG

All notable changes to this project are documented in this file.

Versioning policy for alpha:
- Format: `1.x.x-alpha`
- Increment `minor` (`x` in `1.x.0-alpha`) for new features.
- Increment `patch` (`x` in `1.0.x-alpha`) for updates/fixes to existing features.
- Use engineering discretion on feature vs update.

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

