-- 20260213_add_computer_limits.sql
-- Adds computer-limit controls for license and LAN device capacity enforcement.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS computer_limit INTEGER;

UPDATE businesses
   SET computer_limit = CASE
     WHEN lower(COALESCE(usage_mode, 'standalone')) = 'lan_host'
       THEN GREATEST(1, COALESCE(user_limit, 1))
     ELSE 1
   END
 WHERE computer_limit IS NULL;

ALTER TABLE businesses
  ALTER COLUMN computer_limit SET DEFAULT 1;

ALTER TABLE businesses
  ALTER COLUMN computer_limit SET NOT NULL;

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS computer_limit INTEGER;

UPDATE licenses
   SET computer_limit = CASE
     WHEN lower(COALESCE(installation_scope, 'single_pc')) = 'business_lan'
       THEN GREATEST(1, COALESCE(user_limit, 1))
     ELSE 1
   END
 WHERE computer_limit IS NULL;

ALTER TABLE licenses
  ALTER COLUMN computer_limit SET DEFAULT 1;

ALTER TABLE licenses
  ALTER COLUMN computer_limit SET NOT NULL;

COMMIT;
