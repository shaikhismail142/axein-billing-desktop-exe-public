# AxEin Desktop EXE - Next Session Checklist

## Current status (locked)
- Branch: `codex/desktop-exe-foundation`
- All checks green:
  - `npm run lint`
  - `npm run desktop:web:build`
  - `npm run desktop:db:migrate`
  - `npm run desktop:smoke`
  - `npm run desktop:lan:selftest`

## Next engineering step
1. Windows installer/packaging hardening (Tauri + NSIS output validation).
2. Release artifact flow (build metadata, installer verification, release notes).
3. Permission-boundary regression pass (Admin-only revenue/profit visibility and RBAC edge checks).
4. Low-spec performance pass (startup time, runtime memory, background activity review).

## User runbook for next session
1. Pull latest:
   - `git pull`
2. Re-check baseline:
   - `npm run lint`
   - `npm run desktop:web:build`
   - `npm run desktop:db:migrate`
   - `npm run desktop:smoke`
3. If all green, continue feature work from packaging phase.

## Notes to preserve
- Desktop-first architecture only (no customer Docker runtime).
- License + computer count enforcement is active and must stay intact.
- Keep legacy module parity while hardening desktop UX/reliability.
