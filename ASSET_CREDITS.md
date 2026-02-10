# Asset Credits And Usage Terms

Last updated: 2026-02-09

This file is the authoritative asset attribution ledger for this repository.
Every non-trivial visual/media asset must be listed here before release.

## Policy
- Do not add third-party assets without adding an entry here.
- Each entry must include:
- asset path(s)
- source URL
- license/usage terms
- attribution requirements
- If terms are unclear, mark the asset as `internal-only` until clarified.

## Visual Assets

| Asset Paths | Source | Usage Terms | Attribution Required | Notes |
|---|---|---|---|---|
| `magiccollection-desktop/public/ui-icons/*.svg` | Tabler Icons (outline set) https://github.com/tabler/tabler-icons | MIT License | Keep source/license listed in project docs. | Imported icons: paw, search, filter, plus, x, sparkles. |
| `magiccollection-desktop/src-tauri/icons/*` | User-provided image from local file: `C:\Users\josep\OneDrive\Pictures\ChatGPT Image Feb 8, 2026, 11_40_50 PM.png` | Usage granted by project owner for this project. Verify rights before public commercial distribution. | No external attribution required if owner has rights. | Generated into platform icon sizes by Tauri tooling. |
| `magiccollection-desktop/public/vite.svg` | Vite project template (`create-vite`) https://vite.dev | MIT license (Vite project). | No | Placeholder/developer asset. |
| `magiccollection-desktop/src/assets/react.svg` | Vite React template asset, derived from React branding https://react.dev | Template/dev usage only. For production branding, review React trademark guidance. | Usually no attribution in app UI, but keep notice in repo. | Keep as placeholder unless explicitly approved for shipped branding. |
| `magiccollection-desktop/src/index.css` font import (`Orbitron`, `Space Grotesk`) | Google Fonts https://fonts.google.com | Open Font License (family-specific terms). | Recommended in project credits/legal section. | Loaded via Google Fonts stylesheet import. |

## Data And API-Sourced Art

| Asset/Data Paths | Source | Usage Terms | Attribution Required | Notes |
|---|---|---|---|---|
| Runtime card metadata/images loaded in app | Scryfall API https://scryfall.com/docs/api | Must comply with Scryfall API terms and rate limits. | Yes: include "Data and images provided by Scryfall" in app/legal screen before release. | Do not bulk-cache card images in ways that violate provider terms. |
| `magiccollection-desktop/public/mock-sync/*` and `magiccollection-desktop/logs/scryfall-test/*` | Derived from Scryfall bulk data for testing | Internal test artifacts. Follow Scryfall terms for redistribution. | Yes when distributed outside private/internal use. | These are mock/test sync payloads, not final production catalog distribution format. |
| CK buylist quote payloads/runtime fetches | Card Kingdom public pricelist endpoint | Use according to Card Kingdom site/API terms. | Recommended in legal/credits screen when used in shipped product. | Current implementation caches payload locally for performance. |

## Planned Free Asset Sources (Approved For Evaluation)

These are approved sources to pull from in upcoming UI refresh work:
- Lucide icons: ISC license - https://lucide.dev
- Tabler icons: MIT license - https://github.com/tabler/tabler-icons
- Google Fonts families (for example Space Grotesk, Orbitron): OFL/Apache per-family - https://fonts.google.com
- Haikei generated SVG shapes: see Haikei terms - https://haikei.app
- NASA imagery: usage guidelines apply - https://www.nasa.gov/multimedia/guidelines/index.html

Before importing from the above list, add concrete path-level entries in this file.
