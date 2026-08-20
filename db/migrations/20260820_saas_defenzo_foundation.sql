BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS tenant_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  IF to_regclass('public.settings') IS NOT NULL THEN
    FOR constraint_name IN
      SELECT conname FROM pg_constraint
       WHERE conrelid='public.settings'::regclass AND contype='u'
         AND pg_get_constraintdef(oid)='UNIQUE (key)'
    LOOP
      EXECUTE format('ALTER TABLE settings DROP CONSTRAINT %I', constraint_name);
    END LOOP;
    CREATE UNIQUE INDEX IF NOT EXISTS settings_business_key_uq ON settings (business_id, key);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  user_limit INTEGER NOT NULL DEFAULT 5 CHECK (user_limit > 0),
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_only_after_expiry BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('draft', 'active', 'read_only', 'suspended', 'expired')),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS integration_clients (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  client_key TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  previous_secret_hash TEXT,
  previous_secret_valid_until TIMESTAMPTZ,
  allowed_return_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider),
  CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS integration_nonces (
  client_id BIGINT NOT NULL REFERENCES integration_clients(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, nonce)
);

CREATE TABLE IF NOT EXISTS integration_events (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES integration_clients(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'received',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, event_id),
  CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
);
CREATE INDEX IF NOT EXISTS integration_events_business_created_idx
  ON integration_events (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_record_links (
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  external_version BIGINT NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (business_id, provider, entity_type, external_id)
);

CREATE TABLE IF NOT EXISTS automotive_vehicles (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  registration_number TEXT NOT NULL,
  vin TEXT,
  engine_number TEXT,
  make TEXT,
  model TEXT,
  variant TEXT,
  model_year INTEGER,
  colour TEXT,
  odometer NUMERIC(12,2),
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS automotive_vehicle_registration_uq
  ON automotive_vehicles (business_id, lower(registration_number));

CREATE TABLE IF NOT EXISTS automotive_jobs (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_id BIGINT REFERENCES automotive_vehicles(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  job_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  service_advisor TEXT,
  assigned_technician TEXT,
  estimated_delivery_at TIMESTAMPTZ,
  actual_delivery_at TIMESTAMPTZ,
  source_system TEXT NOT NULL DEFAULT 'axein',
  source_external_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, job_number)
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_json JSONB NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, document_type, document_id, version)
);

INSERT INTO permissions (code, label, description)
VALUES
  ('perm.automotive.manage', 'Manage automotive jobs', 'Manage vehicles, inspections and job cards'),
  ('perm.platform.tenants.manage', 'Manage SaaS tenants', 'Manage tenant plans, dates, seats and integrations')
ON CONFLICT (code) DO NOTHING;

COMMIT;
