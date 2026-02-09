# Web Client Bootstrap (Planned)

This folder tracks the web client handoff for MagicCollection.

## Current status
- Desktop and sync-service now share the same manifest/patch contract shape.
- Local sync service exposes `/sync/status`, `/sync/patch`, `/sync/snapshot`.

## Next implementation target
1. Scaffold React web shell that reuses collection domain model.
2. Add login/profile selection against server profile API (alpha optional).
3. Bootstrap catalog sync on startup:
- call `/sync/status`
- choose `noop|chain|compacted|full`
- apply SQL/IndexedDB patch transaction.
4. Enable drag/drop from Scryfall browser tabs into Market search/add flow.

## Local test loop
- Run desktop app for local DB behavior.
- Run `sync-service/server.py` for manifest/patch endpoints.
- Point web client runtime to same sync base URL.
