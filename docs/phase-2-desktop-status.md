# Phase 2 Status - Desktop Foundation

## Completed
1. Added Tauri desktop shell scaffold (`desktop/src-tauri`).
2. Added desktop runtime host process to launch local Next runtime in production.
3. Added Next standalone desktop build path (`AXEIN_DESKTOP=1` => `output: standalone`).
4. Added desktop build scripts for:
   - standalone web build
   - runtime staging
   - node runtime bundling
   - local DB migration runner
   - toolchain preflight
5. Added desktop UI bridge for runtime detection and desktop-safe drag/drop handling.
6. Added health endpoint for desktop runtime checks.
7. Added Windows build documentation and command flow.

## Pending (Next phase)
1. Install/verify Rust toolchain and run actual Tauri builds on Windows.
2. Produce signed NSIS installer artifacts and validate install/uninstall flow.
3. Implement local DB bootstrap service packaging strategy (embedded Postgres distribution path).
4. Add LAN host/client pairing UX and secure transport setup.
5. Harden RBAC enforcement in every API route (current foundation is partial).

## Notes
- Current local environment cannot compile Tauri because `cargo/rustc` are not installed.
- Desktop scaffolding is code-complete and ready for Windows build machine execution.
