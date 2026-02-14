-- 20260214_keygen_license_history.sql
-- Stores staff keygen issuance history for auditing and customer support.

BEGIN;

CREATE TABLE IF NOT EXISTS keygen_license_issues (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  mode TEXT NOT NULL DEFAULT 'new',
  license_key TEXT NOT NULL,
  email TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  usage_mode TEXT NOT NULL,
  installation_scope TEXT NOT NULL,
  license_type TEXT NOT NULL,
  user_limit INTEGER NOT NULL,
  computer_limit INTEGER NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,

  activation_token TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS keygen_license_issues_created_at_idx
  ON keygen_license_issues (created_at DESC);

CREATE INDEX IF NOT EXISTS keygen_license_issues_expires_at_idx
  ON keygen_license_issues (expires_at DESC);

CREATE INDEX IF NOT EXISTS keygen_license_issues_license_key_idx
  ON keygen_license_issues (license_key);

CREATE INDEX IF NOT EXISTS keygen_license_issues_email_idx
  ON keygen_license_issues (email);

COMMIT;

