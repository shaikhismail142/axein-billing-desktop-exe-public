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
26. Extended LAN status/profile network module with seat usage telemetry and active pairing-session visibility, and blocked pairing/approval actions in UI when seat capacity is exhausted.
27. Added explicit pending-user rejection workflow (`/api/admin/users/[id]/reject`) with audit logging, and standardized pending/approve RBAC checks through shared request-access guards.
28. Added computer-limit licensing model (host + LAN clients) across onboarding, license payload signing/verification, local activation metadata, status/support endpoints, and LAN pair/approve enforcement.
29. Added DB migration `20260213_add_computer_limits.sql` and compatibility fallbacks for environments that have not yet applied the migration.
30. Removed archived legacy Docker/bootstrap assets and stale installer/license artifacts from the EXE repository tree.
31. Hardened desktop migration runner with Postgres connection fallbacks and persistent migration history tracking (`schema_migrations`) so reruns are idempotent on existing customer databases.
32. Added explicit RBAC gates to core customers/products/invoices APIs with LAN-aware access context fallback for business scoping.
33. Removed stale desktop artifacts from runtime source tree (`app/components/ThemeToggle.tsx` unused wrapper and tracked `.DS_Store`).
34. Cleared the lint warning backlog and revalidated desktop build/smoke/selftest on the updated codebase.
35. Hardened desktop migration connection fallback so local shells with `PG*`/`DATABASE_URL` set to missing roles (for example `app`) can still migrate through safe local fallback candidates.
36. Hardened RBAC permissions across remaining core business APIs (products, invoices, purchases, sales, quotations, low-stock) while keeping public/system endpoints intentionally open (health, onboarding/signup, template lookup, profile access snapshot, LAN sync auth routes).

## Pending (Next phase)
1. Run Tauri native build on Windows build machine and produce signed NSIS installer artifacts.
2. Validate installer upgrade/uninstall flows on clean Windows 10 and Windows 11 machines.
3. Implement local DB bootstrap service packaging strategy (embedded Postgres distribution path).
4. Add LAN host/client pairing UX and secure transport setup.
5. Continue RBAC hardening in remaining legacy API routes until full route-level permission coverage is complete.

## Notes
- Rust toolchain is now installed and preflight checks pass in local development.
- Full `npm run desktop:build` is currently blocked in this environment by upstream crates index DNS/network resolution (`index.crates.io`), not by application compile errors.
