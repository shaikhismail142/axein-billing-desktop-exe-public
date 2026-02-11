# AxEin Desktop Workspace

## Purpose
Desktop shell and release pipeline for AxEin Billing EXE builds.

## Structure
- `src-tauri/`: Tauri host process and installer config.
- `scripts/`: desktop build/runtime/release scripts.
- `runtime/`: generated local app runtime artifacts (gitignored).
- `release/`: installer metadata outputs (checksums, manifests).

## Core workflow
```bash
npm run desktop:preflight
npm run desktop:web:build
npm run desktop:prepare-runtime
npm run desktop:bundle-node
npm run desktop:lan:selftest
npm run desktop:smoke
npm run desktop:build
npm run desktop:release:metadata
```
