-- Mivora: optional provider street address and coordinates
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Does not:
--   Change publication completeness, auto-unpublish, or working-hours rules
--   Alter RLS on public.providers (owner UPDATE / published SELECT unchanged)
--   Require address or coordinates for existing or new businesses
--
-- Adds nullable public.providers.address, latitude, and longitude.
-- Coordinates must be both present or both null, within WGS 84 ranges.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;
END
$$;

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.providers.address IS
  'Optional street address. Not required to publish.';

COMMENT ON COLUMN public.providers.latitude IS
  'Optional WGS 84 latitude. Must be set together with longitude.';

COMMENT ON COLUMN public.providers.longitude IS
  'Optional WGS 84 longitude. Must be set together with latitude.';

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_coordinates_pair;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_coordinates_pair
  CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_latitude_range;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_latitude_range
  CHECK (latitude IS NULL OR (latitude >= -90::double precision AND latitude <= 90::double precision));

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_longitude_range;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_longitude_range
  CHECK (longitude IS NULL OR (longitude >= -180::double precision AND longitude <= 180::double precision));

COMMIT;
