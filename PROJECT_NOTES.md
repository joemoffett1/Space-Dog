# MagicCollection Project Notes

This file tracks the active product direction and implementation plan so future sessions can continue without re-discovery.

## Product Direction (updated 2026-02-09)
- Build a desktop-first MTG collection tracker similar to Archidekt, with fast local performance.
- Keep a path to a web app by sharing frontend/domain logic and using a portable API layer.
- Treat current CLI scripts as reference logic, not product constraints.

## Core Product Goals
- Full collection management (fast add/remove/move/edit, tags, conditions, foil, language, purchase data).
- Full-market card browser (all cards), not just owned cards.
- Scryfall-first card metadata and images.
- Rich pricing and buylist analytics (Card Kingdom market and buylist, plus additional vendors later).
- All useful `cardBuy.py` stats available as first-class sortable/filterable fields in the UI.
- Collection overlays in card grid/list (icons/badges indicating owned quantity, finish, location, wishlist, etc.).
- Ability to add cards directly from market browser into collection when user is authenticated/profile-selected.

## UX Direction
- Desktop app should feel instant for large collections:
  - keyboard-first quick add/remove flows
  - virtualized tables/grids
  - in-memory optimistic updates with durable SQLite writes
- Main navigation should include:
  - Collection
  - Market (all cards)
  - Reports / Analytics
  - Imports / Settings
- Market view should support:
  - powerful search + filters
  - card images from Scryfall
  - current price badges
  - collection state icons directly on card tiles

## Data Sources
- Scryfall API/Bulk Data:
  - canonical card metadata
  - image URLs and card faces
  - identifiers (oracle_id, scryfall_id, collector_number, set code, etc.)
- Card Kingdom API:
  - market/retail pricing
  - buylist pricing and buy quantity caps
- Optional later:
  - TCG / SCG / CardMarket / CardHoarder adapters

## Technical Architecture (target)
- Client runtime: Tauri + React + TypeScript (desktop-first).
- Local DB: SQLite as source of truth.
- Domain layer: shared stats engine (used by desktop now, reusable by future web app).
- Background jobs:
  - scheduled price refresh
  - snapshotting price history
  - cache invalidation and stale-data indicators
- Future web path:
  - same React UI patterns
  - shared calculation module
  - API layer over the same core schema concepts

## Required Stat Parity (from cardBuy logic)
Expose as visible/reportable/filterable fields:
- `ck_cash`, `ck_credit`
- `pct_cash`, `pct_credit`
- `tcg_low`, `pct_tcg_low`, `low_mkt_pct`
- `ck_buy_qty`, `sell_qty`
- `source_cost`, `arb_profit`, `arb_roi`
- aggregate totals (cash/credit/profit/card count)

## Authentication / Identity Direction
- Phase 1: local profiles (single-user desktop default).
- Phase 2: optional account login for cloud sync and multi-device use.
- Gate market-to-collection write actions behind active profile/auth state.

## Current Legacy Assets
- CLI tools available for reference/transforms: `cardBuy.py`, `cardPuller.py`, `cardCheck`, `cardUI.py`.
- Existing caches and exports (`ck_pricelist.json`, `tcglow_reference.txt`, Archidekt CSV exports) remain useful for import/testing.

## Build Plan (execution order)
1. Scaffold Tauri + React + TypeScript app (Windows runtime target).
2. Define SQLite schema for cards, printings, owned items, transactions, locations, tags, price snapshots, buylist offers.
3. Implement Scryfall ingestion (bulk + on-demand refresh) and image strategy.
4. Implement collection CRUD + fast grid UI + keyboard actions.
5. Implement market browser with collection-overlay icons and add-to-collection action.
6. Implement CK pricing/buylist adapters and scheduled refresh.
7. Implement analytics/reports page with full stat parity from `cardBuy`.
8. Add optional sync/auth layer for web-capable expansion.

## Progress Update (2026-02-09)
- Created app scaffold at `magiccollection-desktop` (Tauri + React + TypeScript).
- Implemented local profile gate and made **Collection** the default view when profile is opened.
- Implemented separate lazy-loaded **Market** section:
  - loads only when tab is opened
  - uses Scryfall search endpoint
  - supports add nonfoil/foil directly to collection
  - shows collection overlay badges (owned/foil counts) on card tiles
- Added starter analytics and settings pages for baseline navigation flow.
- Added initial SQLite schema migration:
  `magiccollection-desktop/src-tauri/migrations/0001_initial.sql`
- Added Rust/Tauri DB backend (`magiccollection-desktop/src-tauri/src/lib.rs`) with commands for:
  profiles, collection CRUD, market snapshot recording, and price trend retrieval.
- Added frontend backend adapter (`magiccollection-desktop/src/lib/backend.ts`) that uses:
  - Tauri command invoke in desktop runtime
  - local fallback in non-Tauri browser dev.
- Collection and Market views now show richer card context:
  - tag chips (including owned/foil/playset derived tags)
  - price trend indicators (`^`, `v`, `=`) and deltas
  - market snapshot sync from Scryfall search prices.
- Project is now mirrored to Windows-native path:
  `C:\Users\josep\MagicCollectionProject`
