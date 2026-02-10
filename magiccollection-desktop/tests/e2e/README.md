# Playwright E2E

## What this covers
- Login-first gate (`Local Sign In` / `Create Account`)
- Local account creation
- Collection profile creation and entry to app shell

## Run modes
1. Web mode (auto-starts Vite on `http://127.0.0.1:4173`)
```powershell
npm run test:e2e
```

2. Desktop/Tauri mode
- Terminal A:
```powershell
npm run tauri:dev
```
- Terminal B:
```powershell
npm run test:e2e:tauri
```

Notes:
- In Tauri mode, tests target `http://127.0.0.1:1420` by default.
- Override with `PW_TAURI_BASE_URL` if needed.
