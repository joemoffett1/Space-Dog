# MagicCollection Next Steps (Desktop Prototype First)

Date: 2026-02-09
Status: Active
Stage: `1.x.x-alpha`

## Direction Lock (Current)
1. Build and polish the desktop prototype first.
2. Keep sync/data workflow local-only for now.
3. Do not prioritize Cloudflare deployment yet.
4. Focus on app UX + local webserver workflow until prototype quality is high.

## Prototype Goal
Deliver a fast, reliable Windows desktop app that can:
1. Manage large MTG collections with Archidekt-like depth.
2. Browse market cards, add quickly, tag quickly, and edit metadata quickly.
3. Sync catalog/pricing from local patch pipeline without cloud dependencies.
4. Support configurable price sources (not CK-only views).

## Current Completed Areas
1. Desktop foundation: Tauri + React + TypeScript + SQLite.
2. Local auth gate and collection profile flow.
3. Collection views: text, compact, image.
4. Metadata editing + bulk metadata updates.
5. Undo stack for card-level operations.
6. Market tab with Scryfall-driven add flow.
7. Sync diagnostics/progress + patch engine wiring.
8. CK buylist public ingestion path (desktop backend).
9. UI refresh pass 1 completed:
- grouped collection toolbar
- search token autocomplete
- token chips
- row density controls
- text-row mini art thumbnails
10. Drafted v2 database blueprint for hosted-service transition (`collection_data`, `card_data`, `system_data_sync`) with operator policy (`ctag` vs `otag`) and migration strategy in `DATABASE_SCHEMA.md`.
11. Implemented database-layer v2 transition migration (`0004_schema_groups_v2.sql`) with:
- grouped v2 tables
- compact unified pricing table + code dictionaries
- legacy backfill
- legacy -> v2 compatibility triggers

## UI Mockup Alignment Audit (New)
Target reference: the space-themed mockup style and interaction model discussed in chat.

Estimated UI elements to update for closer parity: `27` total.

Current status roll-up:
1. Done: `27 / 27`
2. In Progress / Partial: `0 / 27`
3. Planned / Not Started: `0 / 27`

Status key:
1. `[x]` done
2. `[-]` in progress / partial
3. `[ ]` planned

### Group A: Global Shell and Navigation (5)
1. `[x]` Header brand lockup (logo/title/subtitle spacing and scale).
2. `[x]` Primary nav treatment (Collection/Market/Reports/Settings visual language).
3. `[x]` Header right utility cluster (sync state, refresh, profile/avatar grouping).
4. `[x]` Top-level panel framing (outer glow/border rhythm and spacing consistency).
5. `[x]` Shared button system polish (size scale + icon/text pairing across all primary actions).

### Group B: Collection Toolbar and Search UX (6)
1. `[x]` View-mode control bar visual style (table/image/filter grouping feel).
2. `[x]` Search field shell with richer syntax/tag autosuggest styling.
3. `[x]` Active filter/token chip presentation (color coding by token kind).
4. `[x]` Quick-filter controls (type/set/color shortcuts as first-class pills/dropdowns).
5. `[x]` Sort/source control visual hierarchy (price source + sort alignment).
6. `[x]` Secondary action row (`Add`, `Import`, `Export`, overflow menu) style unification.

### Group C: Table and Dense Data Readability (6)
1. `[x]` Column header typography and separators (less blocky, higher contrast legibility).
2. `[x]` Row density typography tuning (line-height, numeric alignment, sticky affordances).
3. `[x]` Card identity cell composition (thumbnail, title, metadata stack balance).
4. `[x]` Price/trend cell treatment (compact trend badges and directional indicators).
5. `[x]` Actions cluster ergonomics (`+/-`, foil toggle, edit/remove spacing and consistency).
6. `[x]` Table footer/status strip (results count, pagination/load strategy visuals).

### Group D: Image/Gallery View Polish (4)
1. `[x]` Card tile framing, hover states, and shadow depth consistency.
2. `[x]` Overlay badges for owned/foil/tags with clearer priority.
3. `[x]` Inline quantity/action controls on card edges (visibility and hit area tuning).
4. `[x]` Gallery density + spacing rhythm to match the sleeker mockup aesthetic.

### Group E: Modal / Submenu Flow (4)
1. `[x]` Multi-step header treatment (`Add Card -> Versions`) with clearer progress state.
2. `[x]` Modal content layout proportions (left/right emphasis and whitespace).
3. `[x]` Search/add results card presentation consistency with main collection style.
4. `[x]` Versions view visual distinction for owned vs unowned printings (contrast/tone system).

### Group F: Visual Effects and Micro-Interactions (2)
1. `[x]` Motion pass (subtle transitions, hover, and focus states across controls).
2. `[x]` Scrollbars, focus rings, and accessibility affordances themed to match visual language.

## UI Implementation Plan (Next)
1. UI Batch 1: Global shell + toolbar + search polish (Groups A+B). `Completed`
2. UI Batch 2: Table readability + compact-mode refinement (Group C). `Completed`
3. UI Batch 3: Gallery polish + modal flow upgrade (Groups D+E). `Completed`
4. UI Batch 4: Motion/accessibility/final visual QA (Group F + regression sweep). `Completed`
5. Remaining UI delta:
- none in the current 27-item mockup alignment batch.

## UI QA Checklist (Per Batch)
1. Desktop resolutions: 1366x768, 1920x1080, ultrawide sanity check.
2. Interaction checks: keyboard navigation, focus visibility, hover states.
3. Large collection perf checks (10k+ rows): scroll, filter, tab switch.
4. Visual consistency checks: button sizing, spacing scale, typography rhythm.
5. Accessibility pass: contrast and hit-targets for dense controls.

## Reprioritized Work Plan (Local-Only)

## Phase 1: Desktop UX and Data Behavior (Now)
1. Convert CK buylist from report-only to configurable price source profile.
2. Add price source selector architecture:
- Market display source
- Collection valuation source
- Report source overlays
3. Add unified per-card price model with source metadata + timestamp.
4. Improve image mode:
- missing image fallback reliability
- maintain owned-first sorting
- preserve fast +/- and foil mode interactions
5. Strengthen card editing UX:
- inline validation for metadata fields
- clearer edit/save success/failure states

## Phase 2: Local Sync Service Workflow
1. Wire desktop sync client to local sync endpoint config (not hardcoded mock only).
2. Keep endpoint options local:
- local static mock files
- local Python sync server (`sync-service/server.py`)
3. Add local sync profile in Settings:
- base URL
- last successful sync endpoint
- connection test
4. Add patch apply audit panel in Settings:
- from/to version
- strategy (`noop/chain/compacted/full`)
- records added/updated/removed

## Phase 3: Pricing Source Architecture
1. Define price provider registry (Scryfall, CK buylist, future providers).
2. Implement compact pricing dictionaries (`provider`, `channel`, `currency`, `condition`, `finish`) with numeric IDs.
3. Consolidate market + buylist snapshots into one `card_prices` fact model (nullable buylist fields).
4. Use compact daily snapshot keying (`captured_ymd`, `build_version`) for patch-friendly transport.
5. Add per-view source selection:
- Collection value source
- Market list source
- Reports source
6. Add provider health states:
- available
- stale
- disabled
7. Add provider-specific refresh cadence controls.

## Phase 4: Performance and Stability
1. Profile and reduce tab-switch lag with large collections.
2. Add stress dataset benchmark script and baseline targets.
3. Improve batch update transaction strategy where needed.
4. Add error recovery paths:
- interrupted refresh
- partial price fetch
- failed sync retries

## Phase 5: Prepare Future Webserver/Web App Split (No Deployment Yet)
1. Keep local service contracts clean and versioned.
2. Extract shared sync/domain contracts into `shared-core` incrementally.
3. Keep auth model offline-first with future cloud-link hooks only.
4. Defer cloud deployment plumbing until desktop prototype sign-off.

## Immediate Task Queue (Next 10)
1. Implement configurable price source selector in Settings.
2. Pipe selected price source into Collection valuation.
3. Pipe selected price source into Market cards and Reports.
4. Add local sync endpoint selector (`mock` vs `http://127.0.0.1:8787`).
5. Add local endpoint health-check button.
6. Add sync audit table UI from diagnostics/history.
7. Migrate Rust query paths from legacy tables to v2 grouped tables (`collection_data_*`, `card_data_*`, `system_data_sync_*`) now that `0004` is in place.
8. Implement search operator migration (`tag:` alias -> `ctag:`, add `otag:` pipeline placeholder).
9. Add transaction batching for bulk metadata operations.
10. Add regression checklist script for import/edit/undo/sync paths.

## Deferred Until After Prototype Quality Gate
1. Cloudflare deployment setup and R2 lifecycle hardening.
2. External auth server integration.
3. Web/mobile client rollout.

## Prototype Quality Gate (Exit Criteria)
1. 10k+ unique collection remains responsive for core actions.
2. Import/edit/undo/sync/refresh flows are stable across restart.
3. Price sources are configurable and consistently reflected in UI.
4. Local sync pipeline can update versioned catalog end-to-end.
5. No blocker-level regressions in changelog test checklist.

## What I Need From You (When Convenient)
1. Preferred default price source order for alpha (example: `Scryfall -> CK buylist`).
2. Your target performance threshold for large collections (acceptable tab switch time).
3. Whether local sync endpoint should auto-start from app later or remain manual for now.
