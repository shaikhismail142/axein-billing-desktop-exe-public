BEGIN;

-- SaaS settings are tenant-scoped. This legacy index allowed only one row for
-- a key across the entire installation and blocked every tenant after the first.
DROP INDEX IF EXISTS public.idx_settings_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS settings_business_key_uq
  ON public.settings (business_id, key);

COMMIT;
