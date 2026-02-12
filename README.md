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

## Staff keygen desktop build
```bash
npm run desktop:keygen:build
```

## QA and operations
```bash
npm run desktop:runtime:start
npm run desktop:smoke
npm run desktop:db:migrate
npm run desktop:release:metadata
```

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
