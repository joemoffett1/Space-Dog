# MagicCollection Next Steps Plan

Date: 2026-02-09
Status: Active
Target stage: `1.x.x-alpha`

## Product Goal
Build a desktop-first MTG collection app that competes with Archidekt in feature depth, speed, and usability, then ship the same core model to web and mobile through a shared sync/version system.

## What Is Already Done
1. Windows-native desktop foundation exists: Tauri + React + TypeScript + SQLite.
2. Local profiles exist with create/open flow and collection-first landing page.
3. Collection supports text, compact, and image modes with basic quantity actions.
4. Archidekt CSV import works and writes to local SQLite.
5. Market tab exists and is lazy-loaded.
6. Tag chips, trend indicators, and sync status UI are present.
7. Mock sync/version framework exists with manifest, patch artifacts, and refresh flow.
8. Changelog process exists and is using `1.x.x-alpha`.

## What Is Explicitly Requested But Not Finished
1. Real server-managed patch system (not mock-only) with SQL transactional apply.
2. Daily patch policy enforcement:
`missed <= 4` apply chained incrementals
`missed 5..20` apply compacted patch
`missed >= 21` force full snapshot
3. Catalog sync truth moved fully to SQLite state tables.
4. Rich Scryfall syntax search and dynamic query UX.
5. Full CK buylist integration and collection-level buylist analytics.
6. "Sell to CK" workflow (deep link/cart handoff where provider supports).
7. High-scale performance polish for very large collections.
8. Image mode reliability and richer controls parity with compact mode.
9. Card edit depth (condition/language/location/notes/cost) to Archidekt-level.
10. Cross-platform sync-ready architecture (desktop first, then web/mobile).
11. Drag card handoff from web context into app (practical first via URL/text drop).

## Design Direction (Theme + UX)
1. Keep the cosmic/space identity as first-class branding.
2. Continue high-contrast glass panels, glowing accent lines, and subtle starfield motion.
3. Maintain fast operator UX:
keyboard-first actions
bulk operations
non-blocking sync
4. Prioritize compact mode + card detail panel for large collections.
5. Keep image mode as high-signal, not image-only:
visible quantity controls
foil toggle
selected-tag apply behavior
trend badges

## Roadmap by Milestone

## Milestone 1: Desktop Reliability and Data Truth (`1.8.x-alpha`)
1. Move catalog version/build/sync state into SQLite.
2. Add backend commands:
`get_sync_state`
`apply_catalog_patch`
`apply_catalog_snapshot`
`reset_sync_state_for_test` (dev-only)
3. Ensure refresh status ("Synced/Not Synced") is derived from DB state only.
4. Add sync job locking and timeout handling to avoid stuck "Syncing...".
5. Add deterministic progress phases:
`Checking server`
`Downloading payload`
`Applying patch`
`Rebuilding indexes`
`Complete`
Acceptance:
refresh can complete end-to-end repeatedly, survives restart, no stuck state.

## Milestone 2: Real Server Patch Pipeline (`1.9.x-alpha`)
1. Daily server worker downloads Scryfall `default_cards`.
2. Normalize snapshots to canonical rows keyed by `scryfall_id`.
3. Generate daily incremental patch:
`added`, `updated`, `removed`.
4. Generate compacted rolling patches for each version in last 21 days.
5. Publish manifest with:
`latestVersion`
`latestHash`
`availableVersions`
`compactedCoverage`.
6. Expose API endpoints:
`GET /sync/status`
`GET /sync/patch?from=...&to=...`
`GET /sync/snapshot?version=...`
Acceptance:
desktop client can sync from old version to latest using policy rules.

## Milestone 3: Patch Apply Procedure in Client SQL (`1.10.x-alpha`)
1. Schema additions:
`catalog_cards`
`catalog_sync_state`
`catalog_patch_history`.
2. Single transaction apply algorithm:
validate `fromVersion`
upsert `added/updated`
delete `removed`
write `toVersion` + hash
append patch history row.
3. Hash verification after apply; fallback to snapshot on mismatch.
4. Index rebuild strategy and vacuum policy for large patch days.
Acceptance:
no partial apply state is possible; either full success or rollback.

## Milestone 4: Search and Market Depth (`1.11.x-alpha`)
1. Syntax-first search bar (Scryfall query compatible where possible).
2. Query helper UI:
operator chips
examples
validation hints
saved searches.
3. Dynamic result loading:
paged/virtualized result list
debounced query updates
cancel in-flight requests.
4. Unified card detail panel:
all printings by release date
owned highlighted
unowned dimmed
fast add/remove/tag actions.
Acceptance:
power users can run advanced filters without leaving app.

## Milestone 5: Collection Operations and Archidekt Parity (`1.12.x-alpha`)
1. Add per-copy metadata editing:
condition, language, location, notes, acquisition cost/date.
2. Add bulk edit workflow:
multi-select rows/cards
apply tag/location/condition
bulk quantity adjustments.
3. Preserve performance for 10k+ unique cards:
virtualized tables
windowed image rendering
search/index optimizations.
4. Keep owned cards pinned to top in compact and image views where requested.
Acceptance:
collection management speed equals or exceeds current Archidekt flows.

## Milestone 6: CK Pricing + Buylist + Sell Intent (`1.13.x-alpha`)
1. CK adapter service for market + buylist snapshots.
2. Report metrics:
cash payout
credit payout
buylist qty caps
coverage across owned collection.
3. Action flow:
select cards
preview expected payout
export/launch CK handoff link if supported.
4. Add provider feature flag so app can run with or without CK credentials.
Acceptance:
user can evaluate and initiate selling workflow from reports/collection.

## Milestone 7: Cross-Platform Shared Core (`1.14.x-alpha` and up)
1. Extract shared sync and domain package used by desktop/web/mobile.
2. Build web client that uses same manifest/patch protocol.
3. Define mobile local store + background sync cadence.
4. Keep platform-specific UI while preserving identical data semantics.
Acceptance:
all clients read same profile/catalog versions and converge via same patch policy.

## Estimated Effort and Testing Inputs
Estimates below are for build + implementation + self-test, assuming no major scope changes mid-stream.

1. Milestone 1: Desktop Reliability and Data Truth (`1.8.x-alpha`)
Build/implement: 8-12 hours
Self-test: 3-4 hours
Total: 11-16 hours
Need from you for testing: run the dev app on your machine and confirm real UI behavior for sync states (`Synced`, `Not Synced`, `Syncing`) after restart/reboot.

2. Milestone 2: Real Server Patch Pipeline (`1.9.x-alpha`)
Build/implement: 14-20 hours
Self-test: 4-6 hours
Total: 18-26 hours
Need from you for testing: choose hosting target (`Cloudflare` or `Node server`), provide deployment destination and permission to store daily snapshots/patch artifacts.

3. Milestone 3: Patch Apply Procedure in Client SQL (`1.10.x-alpha`)
Build/implement: 8-12 hours
Self-test: 4-6 hours
Total: 12-18 hours
Need from you for testing: approve destructive local test scenario where old catalog state is replaced so we can validate rollback/full-snapshot recovery paths.

4. Milestone 4: Search and Market Depth (`1.11.x-alpha`)
Build/implement: 16-24 hours
Self-test: 5-8 hours
Total: 21-32 hours
Need from you for testing: provide 10-20 representative Scryfall-style searches you care about most and confirm expected result behavior.

5. Milestone 5: Collection Operations and Archidekt Parity (`1.12.x-alpha`)
Build/implement: 18-28 hours
Self-test: 6-10 hours
Total: 24-38 hours
Need from you for testing: provide at least one large export (10k+ unique preferred) and confirm required edit fields priority order.

6. Milestone 6: CK Pricing + Buylist + Sell Intent (`1.13.x-alpha`)
Build/implement: 14-22 hours
Self-test: 5-8 hours
Total: 19-30 hours
Need from you for testing: CK API access details (or sample payloads), desired payout source preference (cash vs credit), and expected sell-flow UX.

7. Milestone 7: Cross-Platform Shared Core (`1.14.x-alpha` and up)
Build/implement: 24-40 hours
Self-test: 8-14 hours
Total: 32-54 hours
Need from you for testing: confirm mobile target (`React Native` vs `PWA-first`) and confirm login/sync expectations across devices.

## Testing Dependencies Checklist
1. Keep one stable “baseline” Archidekt CSV for repeatable regression tests.
2. Keep one large “stress” CSV for performance validation.
3. Decide hosting stack for sync service before Milestone 2 starts.
4. Decide CK integration mode (`read-only analytics first` or `sell flow immediately`) before Milestone 6 starts.
5. Confirm whether cloud login is required during alpha or postponed to beta.

## Sync Policy Specification (Agreed)
1. Version format uses date stamp, e.g. `v250204`, `v260209`.
2. Client sends `{ currentVersion, stateHash }`.
3. Server chooses strategy:
`noop`
`chain`
`compacted`
`full`.
4. Rule engine:
if `missed <= 4`: `chain`
if `5 <= missed <= 20`: `compacted`
if `missed >= 21`: `full`.
5. If version/hash mismatch is invalid, bypass patch and force full snapshot.
6. Compacted patches retained for 21 days.

## Drag-and-Drop Strategy
1. Desktop short-term:
accept dropped text/URL payloads into market/collection panel
parse Scryfall URL or card ID
open add dialog prefilled.
2. Desktop medium-term:
register `magiccollection://card/<id>` URI protocol for direct opens.
3. Web phase:
native browser drag/drop and clipboard paste from Scryfall tabs.

## Immediate Next Session Task List
1. Implement SQL sync state tables + migrations.
2. Replace mock in-memory version truth with DB-backed sync state.
3. Implement backend patch apply command with transaction + rollback.
4. Wire refresh button to real patch/snapshot handler contract.
5. Add hover tooltip countdown + exact next window timestamp in local time.
6. Harden image-mode missing-image fallback and logging.
7. Add perf instrumentation for tab-switch and first-render timings.

## Progress Update (2026-02-09, Session 2)
1. Completed SQL sync schema migration for catalog state/history (`0002_catalog_sync.sql`).
2. Implemented Tauri sync commands for state read, record lookup, snapshot apply, patch apply, and test reset.
3. Switched catalog sync engine to backend DB path in Tauri runtime with browser fallback retained.
4. Updated collection refresh to use batched catalog price record lookup.
5. Added exact local unlock timestamp to refresh tooltip.

## Open Decisions to Finalize
1. Hosted backend stack for sync service:
Cloudflare Workers + R2
or Node + Postgres + object storage.
2. Auth model phase order:
local profile only until beta
or early optional cloud account.
3. CK integration order:
read-only analytics first
or direct sell-handoff in first CK milestone.
4. Mobile target:
React Native
or PWA first then native wrapper.

## Change Control
1. Keep `CHANGELOG.md` updated every work session.
2. Keep `PROJECT_NOTES.md` as product-direction source of truth.
3. Use `NEXT_STEPS.md` as actionable implementation roadmap.
