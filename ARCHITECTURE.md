# MagicCollection Architecture

Date: 2026-02-09
Status: Alpha Desktop Architecture (Local-First)

## 1) Architecture Scope
This document defines the current full stack for the desktop prototype and the intended evolution path.

Current focus:
1. Windows desktop app.
2. Local storage and local sync service.
3. No cloud deployment dependency for prototype completion.

## 2) System Overview
The system is split into 4 runtime layers:
1. Desktop UI layer (React + TypeScript).
2. Native bridge/runtime layer (Tauri).
3. Local data/service layer (Rust commands + SQLite + optional local Python sync service).
4. External data providers (Scryfall, CK public buylist).

## 3) Runtime Components

## 3.1 Desktop Client (`magiccollection-desktop`)
Frontend:
1. React 19 + TypeScript.
2. Vite bundling.
3. Views:
- Collection
- Market
- Reports
- Settings

Desktop shell:
1. Tauri v2.
2. Command bridge via `@tauri-apps/api` invoke.

Local persistence:
1. SQLite via Rust (`rusqlite`, bundled SQLite).
2. Browser fallback localStorage only for non-Tauri contexts.

## 3.2 Local Sync Service (`sync-service`)
Purpose:
1. Build and serve versioned catalog snapshots/patches locally.

Components:
1. `sync_pipeline.py`:
- ingest/normalize Scryfall bulk data
- generate incremental patches
- generate compacted patches
- emit manifest and version index
2. `server.py`:
- local HTTP endpoints for status/patch/snapshot
- basic health/metrics/rate limiting

Note:
Cloudflare worker scaffold exists but is deferred for prototype priorities.

## 3.3 Shared Contracts (`shared-core`)
Current state:
1. Documentation-level scaffolding exists.
2. Planned extraction target for sync/domain contracts across desktop/web/mobile.

## 4) Data Stores

## 4.1 Primary Store (Desktop)
SQLite database file in Tauri app data directory.

Key domains:
1. Profiles.
2. Owned items and metadata.
3. Tags and locations.
4. Price snapshots.
5. Catalog sync state + patch history.

## 4.2 Local Service Artifacts
`sync-service/data`:
1. versioned snapshots.
2. patches/compacted patches.
3. manifest and version index.

## 5) External Provider Integrations

## 5.1 Scryfall
Used for:
1. card metadata.
2. image URLs/fallbacks.
3. collection price refresh/fetch.
4. bulk data source for local pipeline.

## 5.2 Card Kingdom (Public Buylist)
Used for:
1. buylist quote ingestion via desktop backend command.
2. cached pricelist to reduce repeated network calls.

Design note:
CK data should be one selectable source within broader pricing strategy, not the only report path.

## 6) Core App Flows

## 6.1 Startup/Auth/Profile
1. Launch app.
2. Local auth gate (login-first UI).
3. Select/open collection profile.
4. Load collection state from SQLite.

## 6.2 Collection Mutation Flow
1. User action (+/-/tag/edit/remove).
2. Optimistic UI update where applicable.
3. Tauri command writes SQLite transaction.
4. UI refreshes from authoritative DB response.
5. Undo history records reversible state snapshot.

## 6.3 Catalog Sync Flow (Current)
1. UI requests sync status.
2. Sync engine resolves strategy (`noop/chain/compacted/full`).
3. Patch/snapshot applied transactionally to catalog tables.
4. Post-apply diagnostics updated.
5. Collection prices refreshed from local catalog + provider fallback.

## 6.4 Pricing Flow
1. Provider data fetched (Scryfall and/or CK).
2. Price snapshots recorded.
3. Collection/market/reports consume normalized price view.
4. Provider source selection will be user-configurable (in progress).

## 7) Dependency Inventory

## 7.1 Frontend Dependencies (`magiccollection-desktop/package.json`)
Runtime:
1. `react`
2. `react-dom`
3. `@tauri-apps/api`

Build/Tooling:
1. `vite`
2. `typescript`
3. `eslint` + `typescript-eslint`
4. `@vitejs/plugin-react`
5. `@tauri-apps/cli`
6. React/Node type packages

## 7.2 Rust/Tauri Dependencies (`magiccollection-desktop/src-tauri/Cargo.toml`)
Core:
1. `tauri`
2. `tauri-plugin-log`
3. `serde`
4. `serde_json`
5. `log`

Data + IDs:
1. `rusqlite` (bundled SQLite)
2. `uuid`
3. `chrono`
4. `sha2`

Network:
1. `reqwest` (blocking + rustls)

## 7.3 Sync Service Dependencies
Language/runtime:
1. Python 3 (standard library modules used).

Optional deferred runtime:
1. Cloudflare Worker stack (`wrangler`, TS worker) under `sync-service/cloudflare`.

## 8) Local Deployment Model (Prototype)

## 8.1 Desktop-Only
1. Run Tauri app.
2. Use local SQLite as source of truth.

## 8.2 Desktop + Local Sync Server
1. Run `sync_pipeline.py` to generate/update artifacts.
2. Run `server.py` locally.
3. Point desktop sync endpoint to local server.

## 9) Non-Goals (Current Phase)
1. No mandatory cloud hosting.
2. No mandatory cloud auth.
3. No cross-device account sync requirement for prototype acceptance.

## 10) Future Evolution (After Prototype Sign-Off)
1. Harden shared-core contracts.
2. Add hosted sync server deployment.
3. Add cloud account linking on top of local offline-first auth.
4. Extend same contracts to web/mobile clients.

## 11) Engineering Conventions
1. Keep Windows-native workflows first.
2. Keep changelog and roadmap current after each major feature group.
3. Favor transactional DB writes and deterministic recovery paths.
4. Add concise comments for non-obvious logic in sync, pricing, and mutation pipelines.
