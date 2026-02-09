# MagicCollection Shared Core (Contract-First)

This folder documents shared cross-platform contracts used by desktop, web, mobile, and sync service.

## Shared contracts
- Dataset: `default_cards`
- Version format: `vYYMMDD`
- Strategy rules:
  - missed `<= 4`: `chain`
  - missed `5..20`: `compacted`
  - missed `>= 21`: `full`
- Hash mismatch rule:
  - if payload hash validation fails, force `full` snapshot recovery.

## Sync payload shape
- `manifest.json`
  - `latestVersion`
  - `latestSnapshot`
  - `latestHash`
  - `versions[]`
  - `compactedPatches[]`
  - `syncPolicy`
- `patch`
  - `fromVersion`
  - `toVersion`
  - `added[]`
  - `updated[]`
  - `removed[]`
  - `patchHash`

## Open cross-platform blockers
- Cloud auth model for multi-device profiles is not finalized.
- Mobile offline storage engine target is not finalized.
- Hosted production sync endpoint is not selected.
