-- Event participation boundary + gift-delivery feed summary support

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS participation_scope TEXT NULL;

COMMENT ON COLUMN public.events.participation_scope IS
  'Event boundary / who can participate, e.g. Entire family, Branches, Households, Custom';

-- Backfill from legacy audience when empty
UPDATE public.events
SET participation_scope = audience
WHERE participation_scope IS NULL
  AND audience IS NOT NULL
  AND audience <> '';
