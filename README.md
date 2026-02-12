# AxEin Billing Desktop EXE

Desktop-first AxEin Billing distribution for Windows 10/11 (with macOS-ready architecture path).

## Product posture
- Primary runtime: Tauri desktop shell + local bundled app runtime.
- Customer runtime: no Docker required.

## Core desktop commands
```bash
npm install
npm run desktop:preflight
npm run desktop:web:build
npm run desktop:prepare-runtime
npm run desktop:bundle-node
npm run desktop:build
```

## Quick local run (macOS/Windows dev)
```bash
npm run lint
npm run desktop:web:build
npm run desktop:prepare-runtime
npm run desktop:smoke
npm run desktop:lan:selftest
```

The smoke test runs the desktop runtime with embedded local DB mode, so Postgres is not required for first-run validation.

## Staff keygen desktop build
```bash
npm run desktop:keygen:build
```

Staff keygen must be distributed only to AxEin staff. The billing installer must not expose keygen UI or private keys.

Super password handling:
- Preferred: set `AXEIN_SUPER_KEYGEN_PASSWORD` before building keygen.
- Current fallback (internal use): `AxEin!K3yG3n#2026@Sup3r-Only`
- Production recommendation: override fallback before any public/customer rollout.

## QA and operations
```bash
npm run desktop:runtime:start
npm run desktop:smoke
npm run desktop:db:migrate
npm run desktop:release:metadata
```

## Windows installer release
- Windows NSIS installer generation is Windows-only.
- On macOS, `desktop:release:metadata` fails by design if no NSIS `.exe` exists yet.
- Use GitHub Action `Desktop Windows Release` to generate and upload both installers:
  - `AxEin Billing Desktop_*_setup.exe`
  - `AxEin License Keygen_*_setup.exe`

## Documentation
- `/Users/nadiya/Downloads/Axein-Billing-Exe/axein-billing-desktop-exe/docs/desktop-build-windows.md`
- `/Users/nadiya/Downloads/Axein-Billing-Exe/axein-billing-desktop-exe/docs/desktop-rebuild-blueprint.md`
- `/Users/nadiya/Downloads/Axein-Billing-Exe/axein-billing-desktop-exe/docs/phase-2-desktop-status.md`

## Repo layout
- `app/`: Next.js product UI and APIs.
- `desktop/`: desktop shell, packaging config, runtime scripts.
- `db/`: SQL migrations.
- `tools/license-keygen/`: staff key generation utilities.

## Note
This repository is the dedicated EXE track and is independent from Docker-centric deployment flows.
