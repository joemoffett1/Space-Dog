# MagicCollection Sync Service (Local Scaffold)

This folder contains the Group B sync pipeline and local API service.

## Implemented
- `sync_pipeline.py`
  - `build-daily`: ingest source + normalize + rebuild version index + incremental patches + compacted patches + manifest
  - `ingest`: normalize one source snapshot
  - `diff`: generate one incremental patch
  - `compact`: generate one compacted patch
  - `manifest`: rebuild manifest from `versions_index.json`
- `server.py`
  - `GET /health`
  - `GET /metrics`
  - `GET /sync/status?current=<version>`
  - `GET /sync/patch?from=<version>&to=<version>[&expand=1]`
  - `GET /sync/snapshot?version=<version>[&includeRecords=1]`
  - in-memory per-IP rate limiting
- `cloudflare/`
  - Worker + R2 deployment scaffold for hosted sync endpoints
  - `wrangler.toml.example` and `src/worker.ts`
  - compatible endpoint contract for desktop sync client

## Local smoke test (already validated)
1. Copy two snapshot versions into `sync-service/data/versions/`.
2. Create `sync-service/data/versions_index.json`.
3. Run:
- `py -3 sync-service/sync_pipeline.py diff --data-root sync-service/data --from-snapshot versions/v250204.snapshot.json --to-snapshot versions/v260209.snapshot.json --from-version v250204 --to-version v260209`
- `py -3 sync-service/sync_pipeline.py compact --data-root sync-service/data --from-snapshot versions/v250204.snapshot.json --to-snapshot versions/v260209.snapshot.json --from-version v250204 --to-version v260209`
- `py -3 sync-service/sync_pipeline.py manifest --data-root sync-service/data`

## Daily build example
- `py -3 sync-service/sync_pipeline.py build-daily --data-root sync-service/data --source-file <default_cards.json|default_cards.json.gz> --version v260209`

## Production blockers
- Hosting target not selected yet.
- Object storage + retention lifecycle not configured.
- Auth and secret management for production endpoints not configured.
