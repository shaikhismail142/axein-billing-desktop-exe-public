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
8. Added LAN host/client foundation with secure pairing, client approval, role assignment, and sync event APIs.
9. Added template-aware navigation API and runtime sidebar loading.
10. Added invoice custom field management API/UI and wired custom fields into billing save + invoice print/PDF/export outputs.
11. Added RBAC administration module for admin-created users, user listing, and editable role-permission mappings.
12. Added downloadable support bundle endpoint for diagnostics (app logs + audit logs + LAN/activation snapshot).
13. Hardened business data isolation for customer/product/quotation APIs, including quotation conversion/export/PDF/bulk-delete flows with business-aware safeguards.
14. Hardened invoice and sales APIs with business-aware filters/inserts for list/export/PDF/bulk actions, invoice updates, sales create/update, and related stock/payment writes.
15. Scoped product support endpoints (search, import/export, low-stock, bulk delete, product detail updates) to business context with mixed-schema fallback handling.
16. Hardened purchases APIs (list/create/detail/update/delete/PDF) with business-aware filters, inserts, joins, and mixed-schema compatibility checks.
17. Hardened inventory stock APIs (batches, adjustments, stock adjust, inventory settings/expiry) with RBAC gates and business-aware scoping in both route and stock service layers.
18. Hardened accounting/support APIs (debts, alerts, categories, legacy expiry, generic settings) with permission checks and business-aware data filtering/upserts.
19. Strengthened admin/support endpoints by adding RBAC-backed backup/restore access controls, business-scoped backup exports, and business-isolated logo upload paths.
20. Hardened license mutation endpoints (verify key, start trial, toggle trial, deactivate) with explicit license/settings permission checks and business mismatch safeguards.
21. Resolved Next build TypeScript narrowing issues across guarded API routes by standardizing route guard response checks.
22. Added LAN auth type-safe unauthorized handling and updated timing-safe comparison implementation for Node 25 type compatibility.
23. Verified desktop validation workflow locally:
   - `npm run desktop:preflight`
   - `npm run desktop:lan:selftest`
   - `npm run desktop:web:build`
   - `npm run desktop:smoke`
24. Moved Settings UI under Profile route namespace (`/profile/settings`, `/profile/settings/invoice-fields`) and kept legacy `/settings*` routes as compatibility redirects.
25. Added shared seat-limit resolution (`users + LAN clients`) and enforced it across signup, admin create/approve user flows, LAN pair/approve flows, and profile user-access UI seat visibility.

## Pending (Next phase)
1. Run Tauri native build on Windows build machine and produce signed NSIS installer artifacts.
2. Validate installer upgrade/uninstall flows on clean Windows 10 and Windows 11 machines.
3. Implement local DB bootstrap service packaging strategy (embedded Postgres distribution path).
4. Add LAN host/client pairing UX and secure transport setup.
5. Harden RBAC enforcement in every API route (current foundation is partial).

## Notes
- Rust toolchain is now installed and preflight checks pass in local development.
- Full `npm run desktop:build` is currently blocked in this environment by upstream crates index DNS/network resolution (`index.crates.io`), not by application compile errors.
