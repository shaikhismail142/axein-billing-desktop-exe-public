# AxEin Desktop Build Guide (Windows)

## Goal
Build AxEin Billing as an installable Windows desktop application (`.exe`) using Tauri + local Next runtime.

## Prerequisites
1. Node.js 20+
2. npm 10+
3. Rust + Cargo (stable)
4. Visual Studio Build Tools (Desktop C++ workload)

## Install dependencies
```bash
npm install
```

## Validate desktop toolchain
```bash
npm run desktop:preflight
```

## Build desktop web runtime
```bash
npm run desktop:web:build
npm run desktop:prepare-runtime
```

## Optional: bundle Node runtime into installer resources
```bash
npm run desktop:bundle-node
```

## Apply DB migrations to local Postgres
Use either `DATABASE_URL` or PG env vars:
```bash
set PGHOST=127.0.0.1
set PGPORT=5432
set PGUSER=app
set PGPASSWORD=app
set PGDATABASE=app
npm run desktop:db:migrate
```

Notes:
- The migration runner auto-tries safe local fallback connections when the target host is local, including cases where `PG*` or `DATABASE_URL` point to a missing local role (for example `role "app" does not exist`).
- It tracks applied files in `public.schema_migrations`, so reruns are safe and only apply pending migrations.

## Run desktop app in dev mode (Tauri + local web runtime)
```bash
npm run desktop:dev
```

## Validate packaged runtime locally (without browser shell)
```bash
npm run desktop:runtime:start
```

## Build Windows installer
```bash
npm run desktop:build
npm run desktop:release:metadata
npm run desktop:release:verify -- --strict
```

One-shot release pipeline (Windows machine):
```bash
npm run desktop:release:windows
```

GitHub Actions option:
- Run workflow `Desktop Windows Release` (manual trigger) to build installer and upload release artifacts.

Output artifact:
- `desktop/src-tauri/target/release/bundle/nsis/*.exe`
- `desktop/release/SHA256SUMS.txt`
- `desktop/release/release-manifest.json`
- `desktop/release/installer-verification.json`

## Runtime env notes
Desktop runtime expects DB connectivity via:
- `DATABASE_URL`
- or `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

For desktop mode, app defaults `PGHOST` to `127.0.0.1` when `AXEIN_DESKTOP=1`.
If local credentials are missing/mismatched, desktop runtime now auto-tries safe local fallback candidates (OS-user socket/localhost profiles) before failing.

## Important
- Customer runtime does not require Docker.
- This build uses local embedded web runtime inside desktop shell (no browser usage for customers).
