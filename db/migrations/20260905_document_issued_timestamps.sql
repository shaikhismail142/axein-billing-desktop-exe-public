-- Preserve the actual issue time independently from a user-selected document date.
-- This keeps backdated accounting documents auditable without changing their date.
BEGIN;

ALTER TABLE IF EXISTS public.sales
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.quotations
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.purchases
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

UPDATE public.sales
   SET issued_at = COALESCE(issued_at, created_at, NOW())
 WHERE issued_at IS NULL;
UPDATE public.quotations
   SET issued_at = COALESCE(issued_at, created_at, NOW())
 WHERE issued_at IS NULL;
UPDATE public.purchases
   SET issued_at = COALESCE(issued_at, created_at, NOW())
 WHERE issued_at IS NULL;

ALTER TABLE IF EXISTS public.sales
  ALTER COLUMN issued_at SET DEFAULT NOW(),
  ALTER COLUMN issued_at SET NOT NULL;
ALTER TABLE IF EXISTS public.quotations
  ALTER COLUMN issued_at SET DEFAULT NOW(),
  ALTER COLUMN issued_at SET NOT NULL;
ALTER TABLE IF EXISTS public.purchases
  ALTER COLUMN issued_at SET DEFAULT NOW(),
  ALTER COLUMN issued_at SET NOT NULL;

COMMIT;
