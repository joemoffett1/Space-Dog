# MagicCollection Desktop Baseline

Created: 2026-02-09

## What is implemented
- Tauri + React + TypeScript scaffold in `magiccollection-desktop`.
- Local profile gate (acts as lightweight login until full auth/sync exists).
- Default post-profile view is **Collection**.
- Top-level sections:
  - Collection
  - Market
  - Reports
  - Settings
- Market section is lazy-loaded and only initialized when opened.
- Scryfall-backed Market search with add-to-collection actions.
- Collection state overlays on Market cards (`Owned`, `Foil` badges).
- Price movement badges (`^`, `v`, `=`) and delta tracking in Collection and Market cards.
- Tag chips shown on cards/tables (owned/foil/playset + stored tags).
- Frontend backend API layer (`src/lib/backend.ts`) with:
  - Tauri invoke mode (desktop DB-backed)
  - browser fallback mode (local storage) for non-Tauri dev.

## Data foundation
- Initial SQLite migration at `src-tauri/migrations/0001_initial.sql`.
- Includes starter schema for:
  - profiles
  - cards / printings
  - locations
  - owned_items
  - tags / owned_item_tags
  - transactions
  - price_snapshots
  - buylist_offers

## Backend Commands
- Implemented in `src-tauri/src/lib.rs`:
  - `list_profiles`
  - `create_profile`
  - `get_collection`
  - `add_card_to_collection`
  - `update_card_quantity`
  - `remove_card_from_collection`
  - `record_market_snapshots`
  - `get_market_price_trends`

These commands now persist collection and market snapshot data in SQLite and compute
per-card price movement.

## Notes
- This baseline is intentionally desktop-first with clear separation between Collection and Market.
- Market data is fetched on demand and not preloaded while in Collection view.
- Rust-side SQLite execution + migration runner are now wired in setup.
- Next major step is adding scheduled/background vendor refresh jobs (CK/TCG/MTGJSON) and
  exposing richer cardBuy-equivalent analytics.
- Current Tauri/Cargo dependency graph requires a newer Rust toolchain (`rustc`/`cargo` 1.88+).

## Windows-only Workflow
- Portable Node runtime is expected at `tools/node`.
- Windows Rust + C++ prerequisites are expected:
  - Rust toolchain (`rustup`, `cargo`) in `%USERPROFILE%\.cargo\bin`
  - Visual Studio 2022 Build Tools with C++ workload
- Wrapper scripts:
  - `scripts/win-npm.cmd`: runs npm with Windows PATH set for local Node and optional Rust cargo bin.
    - Also loads Visual Studio developer environment and sets stable cargo defaults for dev startup.
  - `scripts/start-magiccollection.cmd`: launches `tauri:dev` using the wrapper.
  - `scripts/create-desktop-shortcut.ps1`: creates a Desktop shortcut to the launcher.
- Package scripts for Windows wrappers:
  - `npm run win:install`
  - `npm run win:lint`
  - `npm run win:build`
  - `npm run win:tauri:dev`
  - `npm run win:tauri:build`

### Startup behavior
- First desktop launch may take several minutes while Rust crates compile.
- Subsequent launches are usually fast (seconds) unless dependencies change.
