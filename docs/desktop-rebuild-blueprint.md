# AxEin Billing Desktop Rebuild Blueprint (Phase 1)

## Scope
This document defines the migration foundation from Docker-first web deployment to a desktop-first installable application for Windows 10/11, with architecture compatibility for macOS in the next phase.

## Product Objectives
1. Ship standalone desktop installer (`.exe`) with no Docker dependency for customer runtime.
2. Preserve current invoice/billing logic and module behavior.
3. Introduce business-type onboarding and template-driven defaults.
4. Introduce business-grouped RBAC and approval-based user onboarding.
5. Enforce offline, plan-based licensing with seat limits.
6. Keep resource usage low for minimum-spec systems.

## Current Codebase Inventory
Detected modules and capabilities already present in code:
- Billing and invoices (`/invoices`, `/api/invoices`, bulk PDF/export/delete)
- Quotations (`/quotations`, convert to sale, export, PDF)
- Products (`/products`, import/export, bulk delete)
- Customers (`/api/customers`, search)
- Inventory (`/inventory`, low-stock, expiry, adjustments, batches, purchases)
- Purchase flows (`/api/purchases`, purchase payment fields)
- Accounting and debt tracking (`/accounting`, `/api/accounting/debts`)
- Reports and analytics (`/reports`, movers, dead-stock, retention, GST tax)
- GST/tax computation and reporting APIs
- Backup/restore admin APIs
- License activation and trial mode APIs
- Existing offline keygen tooling (`tools/license-keygen`)

## Architecture Decision
### Desktop Shell
- Use **Tauri** as desktop host to reduce RAM/CPU footprint and keep Windows/macOS portability.
- Keep Next.js app as business/UI layer in the first migration stage.

### Runtime Modes
1. Standalone Mode:
- Single device, local DB + local app runtime.
2. Business LAN Mode:
- One host instance serves business data on LAN.
- Client instances connect using business code + license policy constraints.

### Database
- Keep PostgreSQL compatibility at schema level for existing logic.
- Introduce business-aware schema entities in this phase.
- In desktop packaging phase, finalize runtime choice:
  - Embedded Postgres bundle for larger deployments OR
  - SQLite+compat layer for low footprint SKUs.

## New Foundation (implemented in this phase)
1. Business templates config library.
2. Business/group-aware schema for:
- businesses
- users
- roles
- permissions
- user-role mapping
- approvals
- module policies
- licenses
- audit logs
- diagnostics logs
- invoice custom fields
3. API foundations for:
- register business
- in-app signup
- admin approval flow
- profile access/permissions summary
- diagnostics log ingestion/export
- business template discovery

## Security and Access Rules
- Default roles:
  - Owner
  - Admin
  - Manager
  - Accountant
  - Billing Staff
  - Viewer
- Revenue/profit summary visibility defaults to **Admin only**.
- All other role permissions are editable through policy mapping (UI phase pending).

## Template Strategy
Business templates are configuration-driven (not separate apps):
- Clinic
- General Store
- Spa/Saloon
- Hardware Store
- Mobile Store
- Hotel
- Restaurant
- School/Institute

Template impact surface:
- invoice field defaults and labels
- workflow toggles
- navigation labels/order where needed

Non-template-sensitive modules remain unchanged to avoid regressions.

## Licensing Strategy (offline)
- Continue Ed25519 signatures.
- Introduce v2 payload claims in keygen to include:
  - business details
  - business type
  - user limits
  - license type and validity
  - usage mode and install scope
- App validation remains backward-compatible with existing keys.
- Staff keygen gated by staff password.

## Diagnostics and Support
- App logs table (`app_logs`) captures operational failures and key events.
- Log export endpoint supports NDJSON download for support sharing.
- Audit logs table captures sensitive admin actions and approvals.

## Phase Plan
1. Phase 1 (this commit set): schema + API + access/log foundations.
2. Phase 2: Tauri shell scaffolding + installer pipeline + desktop process wiring.
3. Phase 3: onboarding UI + template application engine + profile module refinement.
4. Phase 4: RBAC UI, approval UI, seat enforcement UI.
5. Phase 5: dashboard/reports unification + parity pass + performance hardening.

## Open Decisions
1. Final embedded DB distribution strategy for desktop SKU tiers.
2. LAN host discovery and secure pairing UX.
3. macOS notarization pipeline details for release stage.
