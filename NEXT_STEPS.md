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
2. Add per-view source selection:
- Collection value source
- Market list source
- Reports source
3. Add provider health states:
- available
- stale
- disabled
4. Add provider-specific refresh cadence controls.

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
7. Harden image fallback and log failures to diagnostics.
8. Add transaction batching for bulk metadata operations.
9. Add regression checklist script for import/edit/undo/sync paths.
10. Add docs for daily local sync runbook (Task Scheduler + scripts).

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
