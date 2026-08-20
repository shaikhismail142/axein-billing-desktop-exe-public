BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS customers_business_email_idx
  ON customers (business_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

COMMIT;
