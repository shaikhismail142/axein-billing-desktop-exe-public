-- 20260212_lan_mode_foundation.sql
-- LAN host/client foundation for desktop multi-PC operation.

BEGIN;

CREATE TABLE IF NOT EXISTS lan_host_configs (
  business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  host_uid TEXT NOT NULL UNIQUE,
  host_name TEXT NOT NULL,
  host_secret TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standalone',
  allow_pairing BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  bind_address TEXT NOT NULL DEFAULT '0.0.0.0',
  port INTEGER NOT NULL DEFAULT 3199,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lan_pairing_sessions (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pairing_uid TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_uses INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, pairing_uid)
);
CREATE INDEX IF NOT EXISTS lan_pairing_sessions_active_idx
  ON lan_pairing_sessions (business_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS lan_clients (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_uid TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  device_fingerprint TEXT,
  role_code TEXT NOT NULL DEFAULT 'billing_staff',
  status TEXT NOT NULL DEFAULT 'active',
  token_hash TEXT NOT NULL,
  paired_by BIGINT,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  last_ip TEXT,
  notes TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lan_clients_business_status_idx
  ON lan_clients (business_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS lan_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_client_uid TEXT,
  target_client_uid TEXT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_text TEXT
);
CREATE INDEX IF NOT EXISTS lan_sync_jobs_business_status_idx
  ON lan_sync_jobs (business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS lan_sync_events (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_uid TEXT,
  source_event_uid TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lan_sync_events_business_created_idx
  ON lan_sync_events (business_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lan_sync_events_source_uid_uq
  ON lan_sync_events (business_id, client_uid, source_event_uid)
  WHERE source_event_uid IS NOT NULL;

INSERT INTO lan_host_configs (business_id, host_uid, host_name, host_secret, mode, allow_pairing, require_approval)
SELECT
  b.id,
  'host-' || b.id::text,
  COALESCE(NULLIF(b.name, ''), 'AxEin Host ' || b.id::text),
  md5(random()::text || clock_timestamp()::text || b.id::text),
  CASE WHEN lower(COALESCE(b.usage_mode, 'standalone')) = 'lan_host' THEN 'lan_host' ELSE 'standalone' END,
  TRUE,
  TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM lan_host_configs h WHERE h.business_id = b.id
);

COMMIT;
