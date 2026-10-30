-- Mivora: Draft / Published providers
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Order
--   1. Add public.providers.published
--   2. Backfill published = true for providers that already have a service
--      (same rule as today’s client filter). Trigger is not installed yet, so
--      incomplete seeded profiles are NOT unpublished and are NOT rejected.
--   3. SECURITY DEFINER helpers with search_path = '' and qualified names
--   4. Trigger: completeness only when published changes to true
--   5. AFTER DELETE/reassign on services: unpublish if zero services remain
--      (does not block deletes, does not touch bookings)
--   6. Explicit DROP of known public SELECT / bookings INSERT policies, then
--      abort if any other SELECT (or bookings INSERT) policy remains
--   7. Replacement SELECT + bookings INSERT + owner UPDATE policies
--
-- Known policy names:
--   SELECT: "Enable read access for all users" on providers and related tables
--   bookings INSERT: "Enable insert for users based on user_id"
-- Confirm in Dashboard / pg_policies before execute. A leftover permissive
-- INSERT policy on bookings would OR with the new check and skip published.
--
-- Does not change cancel_my_booking, reschedule_my_booking, Storage, or other tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Column (must exist before any function references it)
-- ---------------------------------------------------------------------------

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.providers.published IS
  'When true, the provider is in the public catalog. Default false (draft).';

-- ---------------------------------------------------------------------------
-- 2. Backfill current public listings
--    Incomplete profiles (e.g. missing cover) stay published if they have a
--    service. Later edits to other columns do not auto-unpublish. Completeness
--    is required only on the next false → true transition.
-- ---------------------------------------------------------------------------

UPDATE public.providers AS p
SET published = true
WHERE p.published IS FALSE
  AND EXISTS (
    SELECT 1
    FROM public.services AS s
    WHERE s.provider_id = p.id
  );

-- ---------------------------------------------------------------------------
-- 3. Helpers — SECURITY DEFINER, empty search_path, qualified identifiers
--    Owned by the migration role (postgres on hosted Supabase) so FORCE RLS
--    is bypassed inside the function body. Authorization is explicit below.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_is_published(p_provider_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_provider_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.providers AS p
      WHERE p.id = p_provider_id
        AND p.published IS TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.provider_owned_by_me(p_provider_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_provider_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.providers AS p
      WHERE p.id = p_provider_id
        AND p.owner_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.customer_booked_provider(p_provider_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_provider_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.bookings AS b
      WHERE b.user_id = auth.uid()
        AND b.provider_id IS NOT NULL
        AND b.provider_id = p_provider_id
    );
$$;

CREATE OR REPLACE FUNCTION public.service_belongs_to_provider(p_service_id text, p_provider_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_service_id IS NOT NULL
    AND p_provider_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.services AS s
      WHERE s.id = p_service_id
        AND s.provider_id = p_provider_id
    );
$$;

-- Completeness for a publish transition. kind values match the app: salon | specialist.
CREATE OR REPLACE FUNCTION public.provider_meets_publish_requirements(
  p_id text,
  p_name text,
  p_kind text,
  p_city text,
  p_area text,
  p_bio text,
  p_image_url text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_id IS NOT NULL
    AND pg_catalog.btrim(COALESCE(p_name, '')) <> ''
    AND p_kind IN ('salon', 'specialist')
    AND pg_catalog.btrim(COALESCE(p_city, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_area, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_bio, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_image_url, '')) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.services AS s
      WHERE s.provider_id = p_id
    );
$$;

CREATE OR REPLACE FUNCTION public.providers_enforce_publish_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.published IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Already published: allow edits to other fields without unpublishing.
  IF TG_OP = 'UPDATE' AND OLD.published IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT public.provider_meets_publish_requirements(
    NEW.id,
    NEW.name,
    NEW.kind,
    NEW.city,
    NEW.area,
    NEW.bio,
    NEW.image_url
  ) THEN
    RAISE EXCEPTION
      'Provider % cannot be published until name, type (salon/specialist), city, area, bio, cover image, and at least one service are set',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.provider_is_published(text) OWNER TO postgres;
ALTER FUNCTION public.provider_owned_by_me(text) OWNER TO postgres;
ALTER FUNCTION public.customer_booked_provider(text) OWNER TO postgres;
ALTER FUNCTION public.service_belongs_to_provider(text, text) OWNER TO postgres;
ALTER FUNCTION public.provider_meets_publish_requirements(text, text, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.providers_enforce_publish_completeness() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.provider_is_published(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_owned_by_me(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_booked_provider(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_belongs_to_provider(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_meets_publish_requirements(text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.providers_enforce_publish_completeness() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.provider_is_published(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_owned_by_me(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_booked_provider(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_belongs_to_provider(text, text) TO anon, authenticated;

-- Trigger/completeness helpers are not callable by clients.

DROP TRIGGER IF EXISTS providers_enforce_publish_completeness ON public.providers;

CREATE TRIGGER providers_enforce_publish_completeness
BEFORE INSERT OR UPDATE OF published
ON public.providers
FOR EACH ROW
EXECUTE FUNCTION public.providers_enforce_publish_completeness();

-- Last-service removal: set published = false. Does not RAISE, so ordinary
-- service edits/deletes succeed. Existing bookings are unchanged. Completeness
-- trigger allows published → false without re-validating.
CREATE OR REPLACE FUNCTION public.services_unpublish_if_none_remain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id text := OLD.provider_id;
BEGIN
  -- Always the provider that owned the row before this statement.
  -- Never NEW.provider_id (would unpublish the destination on a reassign).
  IF TG_OP = 'UPDATE' AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id THEN
    RETURN NULL;
  END IF;

  IF v_provider_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Only this provider, and only if it now has zero services. No bookings writes.
  UPDATE public.providers AS p
  SET published = false
  WHERE p.id = v_provider_id
    AND p.published IS TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.services AS s
      WHERE s.provider_id = v_provider_id
    );

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.services_unpublish_if_none_remain() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.services_unpublish_if_none_remain() FROM PUBLIC;

DROP TRIGGER IF EXISTS services_unpublish_if_none_remain ON public.services;

CREATE TRIGGER services_unpublish_if_none_remain
AFTER DELETE OR UPDATE OF provider_id
ON public.services
FOR EACH ROW
EXECUTE FUNCTION public.services_unpublish_if_none_remain();

-- ---------------------------------------------------------------------------
-- 4. Replace known public SELECT policies (do not drop INSERT/UPDATE/DELETE)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Enable read access for all users" ON public.providers;
DROP POLICY IF EXISTS "Users can view own provider" ON public.providers;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.services;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.provider_categories;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.provider_portfolio;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.reviews;

-- Permissive SELECT and FOR ALL (*) are OR'd. Abort before replacing SELECT.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname || ' [' || cmd || ']', ', ' ORDER BY tablename, policyname)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'providers',
      'services',
      'provider_categories',
      'provider_portfolio',
      'reviews'
    )
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('SELECT', '*');

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover permissive SELECT/ALL policies would keep drafts public: %',
      leftover;
  END IF;
END
$$;

CREATE POLICY "providers_select_published_owner_or_booked"
ON public.providers
FOR SELECT
TO public
USING (
  published IS TRUE
  OR owner_id = (SELECT auth.uid())
  OR public.customer_booked_provider(id)
);

CREATE POLICY "services_select_published_owner_or_booked"
ON public.services
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
  OR public.customer_booked_provider(provider_id)
);

CREATE POLICY "provider_categories_select_published_owner_or_booked"
ON public.provider_categories
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
  OR public.customer_booked_provider(provider_id)
);

CREATE POLICY "provider_portfolio_select_published_owner_or_booked"
ON public.provider_portfolio
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
  OR public.customer_booked_provider(provider_id)
);

CREATE POLICY "reviews_select_published_owner_or_booked"
ON public.reviews
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
  OR public.customer_booked_provider(provider_id)
);

-- Exact current bookings INSERT policy. Not IF EXISTS: fail if the name differs.
DROP POLICY "Enable insert for users based on user_id" ON public.bookings;

-- Permissive INSERT and FOR ALL (*) are OR'd. Abort if any remain.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('INSERT', '*');

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover public.bookings INSERT/ALL policies would bypass the published-provider check: %',
      leftover;
  END IF;
END
$$;

CREATE POLICY "bookings_insert_own_published_service"
ON public.bookings
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND provider_id IS NOT NULL
  AND service_id IS NOT NULL
  AND public.provider_is_published(provider_id)
  AND public.service_belongs_to_provider(service_id, provider_id)
);

-- UPDATE RLS: at least one PERMISSIVE policy must pass (OR); every RESTRICTIVE
-- policy must pass (AND). Restrictive owner check AND's with any leftover
-- USING (true) permissive UPDATE so only owner_id = auth.uid() can write.
-- Owner edits still pass both USING and WITH CHECK. Anon has auth.uid() null.
CREATE POLICY "providers_update_own_row"
ON public.providers
FOR UPDATE
TO authenticated
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "providers_update_owner_restrictive"
ON public.providers
AS RESTRICTIVE
FOR UPDATE
TO public
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

-- Fail closed if a permissive FOR ALL policy still applies to SELECT/INSERT.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname || ' [' || cmd || ']', ', ' ORDER BY tablename, policyname)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'PERMISSIVE'
    AND (
      (
        tablename IN (
          'providers',
          'services',
          'provider_categories',
          'provider_portfolio',
          'reviews'
        )
        AND cmd = '*'
      )
      OR (tablename = 'bookings' AND cmd = '*')
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover permissive FOR ALL policies would bypass draft or booking INSERT rules: %',
      leftover;
  END IF;
END
$$;

COMMIT;
