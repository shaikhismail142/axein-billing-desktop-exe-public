-- 20260211_rbac_multibusiness_foundation.sql
-- Foundation for desktop-first AxEin platform: business grouping, RBAC, approvals, licensing, diagnostics.

BEGIN;

CREATE TABLE IF NOT EXISTS businesses (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  user_limit INTEGER NOT NULL DEFAULT 1,
  license_plan_intent TEXT,
  usage_mode TEXT NOT NULL DEFAULT 'standalone',
  template_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  is_system_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_business_email_uq ON users (business_id, lower(email));
CREATE INDEX IF NOT EXISTS users_business_status_idx ON users (business_id, status);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  revenue_visible BOOLEAN NOT NULL DEFAULT FALSE,
  default_for_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_scope_code_uq ON roles ((COALESCE(business_id, 0)), lower(code));

CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  allow BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_role_map (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by BIGINT,
  decided_by BIGINT,
  decided_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS approvals_business_status_idx ON approvals (business_id, status);

CREATE TABLE IF NOT EXISTS module_policies (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, module_key)
);

CREATE TABLE IF NOT EXISTS invoice_custom_fields (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'text',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 100,
  applies_to TEXT NOT NULL DEFAULT 'invoice',
  preset_scope TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, field_key)
);

CREATE TABLE IF NOT EXISTS licenses (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  license_key TEXT NOT NULL,
  license_type TEXT NOT NULL,
  user_limit INTEGER NOT NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  installation_scope TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, license_key)
);

CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  level TEXT NOT NULL,
  source TEXT,
  event_code TEXT,
  message TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_logs_created_idx ON app_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

INSERT INTO businesses (id, code, name, business_type, user_limit, license_plan_intent, usage_mode)
VALUES (1, 'default-local', 'Default Business', 'General Store', 5, 'starter', 'standalone')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('businesses', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM businesses), 1));

INSERT INTO permissions (code, label, description)
VALUES
  ('perm.users.manage', 'Manage users', 'Create/update users and assign roles'),
  ('perm.users.approve', 'Approve users', 'Approve/reject signup requests'),
  ('perm.roles.manage', 'Manage roles', 'Edit role and permission mappings'),
  ('perm.license.manage', 'Manage license', 'Activate and update license details'),
  ('perm.settings.manage', 'Manage settings', 'Update business and invoice settings'),
  ('perm.logs.view', 'View logs', 'Read diagnostics and application logs'),
  ('perm.logs.export', 'Export logs', 'Download support log bundles'),
  ('perm.audit.view', 'View audit logs', 'Read audit trail entries'),
  ('perm.reports.view', 'View reports', 'Access reports and analytics modules'),
  ('perm.view.revenue_summary', 'View revenue summary', 'View full revenue/profit totals'),
  ('perm.inventory.manage', 'Manage inventory', 'Manage stock, batches, adjustments'),
  ('perm.products.manage', 'Manage products', 'Manage products and categories'),
  ('perm.customers.manage', 'Manage customers', 'Manage customer records'),
  ('perm.sales.manage', 'Manage sales', 'Create/edit invoices and sales entries'),
  ('perm.payments.manage', 'Manage payments', 'Record partial/full payments and settlements'),
  ('perm.purchases.manage', 'Manage purchases', 'Create/manage purchase entries'),
  ('perm.quotations.manage', 'Manage quotations', 'Create/manage quotation entries'),
  ('perm.invoice.custom_fields.manage', 'Manage invoice custom fields', 'Define custom invoice fields per business'),
  ('perm.backup.manage', 'Manage backup/restore', 'Create backup and restore data'),
  ('perm.export.manage', 'Manage exports', 'Export invoices/products/reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (business_id, code, name, is_system, revenue_visible)
SELECT NULL, v.code, v.name, TRUE, v.revenue_visible
FROM (
  VALUES
    ('owner', 'Owner', FALSE),
    ('admin', 'Admin', TRUE),
    ('manager', 'Manager', FALSE),
    ('accountant', 'Accountant', FALSE),
    ('billing_staff', 'Billing Staff', FALSE),
    ('viewer', 'Viewer', FALSE)
) AS v(code, name, revenue_visible)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.business_id IS NULL AND lower(r.code) = lower(v.code)
);

WITH admin_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'admin' LIMIT 1
), all_perms AS (
  SELECT id FROM permissions
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT ar.id, p.id, TRUE
FROM admin_role ar
CROSS JOIN all_perms p
ON CONFLICT DO NOTHING;

WITH owner_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'owner' LIMIT 1
), owner_perms AS (
  SELECT id FROM permissions WHERE code <> 'perm.view.revenue_summary'
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
FROM owner_role r
CROSS JOIN owner_perms p
ON CONFLICT DO NOTHING;

WITH target_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'manager' LIMIT 1
), target_perm AS (
  SELECT id FROM permissions WHERE code IN (
    'perm.reports.view',
    'perm.inventory.manage',
    'perm.products.manage',
    'perm.customers.manage',
    'perm.sales.manage',
    'perm.payments.manage',
    'perm.purchases.manage',
    'perm.quotations.manage',
    'perm.export.manage'
  )
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
FROM target_role r
CROSS JOIN target_perm p
ON CONFLICT DO NOTHING;

WITH target_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'accountant' LIMIT 1
), target_perm AS (
  SELECT id FROM permissions WHERE code IN (
    'perm.reports.view',
    'perm.payments.manage',
    'perm.purchases.manage',
    'perm.sales.manage',
    'perm.audit.view',
    'perm.export.manage'
  )
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
FROM target_role r
CROSS JOIN target_perm p
ON CONFLICT DO NOTHING;

WITH target_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'billing_staff' LIMIT 1
), target_perm AS (
  SELECT id FROM permissions WHERE code IN (
    'perm.sales.manage',
    'perm.payments.manage',
    'perm.customers.manage',
    'perm.products.manage',
    'perm.quotations.manage',
    'perm.purchases.manage'
  )
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
FROM target_role r
CROSS JOIN target_perm p
ON CONFLICT DO NOTHING;

WITH target_role AS (
  SELECT id FROM roles WHERE business_id IS NULL AND lower(code) = 'viewer' LIMIT 1
), target_perm AS (
  SELECT id FROM permissions WHERE code IN (
    'perm.reports.view',
    'perm.logs.view'
  )
)
INSERT INTO role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
FROM target_role r
CROSS JOIN target_perm p
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'settings',
    'customers',
    'products',
    'sales',
    'sale_items',
    'sale_payments',
    'quotations',
    'quotation_items',
    'purchases',
    'purchase_items',
    'inventory_adjustments',
    'inventory_adjustment_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS business_id BIGINT', t);
      EXECUTE format('UPDATE public.%I SET business_id = 1 WHERE business_id IS NULL', t);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN business_id SET NOT NULL', t);
      EXCEPTION WHEN others THEN
        -- Keep backward compatibility if historical rows or table design block this constraint.
        NULL;
      END;
      BEGIN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT',
          t,
          t || '_business_fk'
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id)', t || '_business_idx', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
