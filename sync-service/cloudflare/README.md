# MagicCollection Sync Service (Cloudflare Scaffold)

This folder is a production scaffold for serving patch/snapshot artifacts with
Cloudflare Workers + R2.

## What this provides
- A Worker endpoint compatible with current desktop sync expectations:
- `GET /health`
- `GET /sync/status?current=<version>`
- `GET /sync/patch?from=<version>&to=<version>[&expand=1]`
- `GET /sync/snapshot?version=<version>[&includeRecords=1]`
- A `wrangler` config template with required bindings.

## Data contract
Upload `sync-service/data` artifacts to R2 under a single prefix, e.g. `sync/`:
- `sync/manifest.json`
- `sync/versions/*.snapshot.json`
- `sync/patches/*.patch.json`
- `sync/compacted/*.compacted.json`

The Worker reads `manifest.json` and serves patch/snapshot files by path.

## Setup steps
1. Install Wrangler (Node required):
- `npm i -g wrangler`
2. Copy and edit config:
- `copy wrangler.toml.example wrangler.toml`
3. Create R2 bucket and bind it:
- set `SYNC_BUCKET` in `wrangler.toml`
4. Deploy worker:
- `wrangler deploy`

## Upload artifacts
Use Wrangler R2 object commands (examples):
- `wrangler r2 object put <bucket>/sync/manifest.json --file ..\\data\\manifest.json`
- `wrangler r2 object put <bucket>/sync/versions/v260209.snapshot.json --file ..\\data\\versions\\v260209.snapshot.json`

For daily automation, run these from CI after `sync_pipeline.py build-daily`.

## Notes
- This is intentionally token-free for read-only sync endpoints.
- If private access is required later, add an auth layer (Access/JWT/API key).
