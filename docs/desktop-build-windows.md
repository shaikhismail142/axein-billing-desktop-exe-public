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

## Database mode for desktop runtime
- Default desktop runtime mode uses embedded local DB (PGlite path) for first-run/install simplicity.
- You can still migrate/connect to external/local Postgres when needed:
```bash
npm run desktop:db:migrate
```

Postgres notes:
- The migration runner auto-tries safe local fallback connections when a local role/db mismatch occurs (for example `role "app" does not exist`).
- Applied migrations are tracked in `public.schema_migrations`, so reruns are safe.

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
- Includes both customer app and staff keygen installers in the same artifact folder.
- `desktop/release/SHA256SUMS.txt`
- `desktop/release/release-manifest.json`
- `desktop/release/installer-verification.json`

## Staff keygen
```bash
npm run desktop:keygen:build
```

Security:
- Keygen endpoint/UI must stay disabled in customer runtime (enabled only in keygen build path).
- Set `AXEIN_SUPER_KEYGEN_PASSWORD` before build.
- Internal fallback currently in code: `AxEin!K3yG3n#2026@Sup3r-Only` (override for production).

## Runtime env notes
Desktop runtime supports:
- Embedded local DB mode (default desktop path)
- External/local Postgres via `DATABASE_URL` or `PG*` envs

## Important
- Customer runtime does not require Docker.
- This build uses local embedded web runtime inside desktop shell (no browser usage for customers).
