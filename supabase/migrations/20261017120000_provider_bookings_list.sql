-- Mivora: owner-scoped incoming bookings (read-only)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on: 20261016185300_providers_published.sql
--   (public.provider_owned_by_me must already exist)
--
-- Purpose
--   Let an authenticated owner list bookings for providers they own, including
--   when the business is Draft. Customer INSERT / SELECT / cancel / reschedule
--   are unchanged. Published rules are unchanged.
--
-- Approach (narrower than a table SELECT policy)
--   SECURITY DEFINER RPC public.list_owned_provider_bookings().
--   The function joins public.bookings → public.providers WHERE owner_id =
--   auth.uid(). It does not check published. It does not return email/phone.
--   Customer display name is profiles.full_name only (null if missing).
--
--   Why not ADD POLICY FOR SELECT ON public.bookings?
--   Customer fetchMyBookings uses .from('bookings').eq('user_id', me).
--   An extra owner SELECT policy would still be RLS-safe, but PostgREST would
--   then allow any unfiltered owner query of bookings for those providers.
--   An RPC keeps table SELECT as the customer path and returns only the
--   columns this screen needs. Owners cannot read other businesses' rows.
--
-- Does not:
--   DROP or replace bookings policies
--   Change cancel_my_booking / reschedule_my_booking
--   Change bookings INSERT
--   Grant SELECT on auth.users or profiles to owners
--   Touch Storage or published helpers
--
-- Confirm before execute:
--   1. public.provider_owned_by_me(text) exists
--   2. public.bookings has no permissive FOR ALL (*) policy
--   3. public.profiles.id type equals public.bookings.user_id (uuid in this app)
--   4. public.profiles.full_name exists
--
-- RETURNS TABLE types (no table%TYPE — invalid in RETURNS TABLE):
--   id              bigint
--   created_at      timestamp with time zone
--   provider_id     text
--   service_id      text
--   booking_date    date
--   booking_time    time without time zone
--   status          text
--   updated_at      timestamp with time zone
--   customer_full_name text
-- SELECT list casts to these types so the function body matches RETURNS TABLE
-- if bookings.id is integer (not bigint) or booking_time is text.

BEGIN;

-- Fail if the published-migration helper is missing.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.provider_owned_by_me(text)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_owned_by_me(text) is missing. Apply 20261016185300_providers_published.sql first.';
  END IF;
END
$$;

-- Permissive FOR ALL on bookings would OR with existing INSERT/SELECT and
-- could widen access beyond this RPC. Do not continue if any remain.
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
    AND cmd = '*';

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover public.bookings FOR ALL policies: %',
      leftover;
  END IF;
END
$$;

-- Required columns + profiles.id type must equal bookings.user_id (join target).
DO $$
DECLARE
  booking_user_type text;
  profile_id_type text;
BEGIN
  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.profiles does not exist.';
  END IF;

  IF to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  PERFORM 1
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN (
      'id',
      'created_at',
      'user_id',
      'provider_id',
      'service_id',
      'booking_date',
      'booking_time',
      'status',
      'updated_at'
    )
  HAVING pg_catalog.count(*) = 9;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings is missing one of id, created_at, user_id, provider_id, service_id, booking_date, booking_time, status, updated_at.';
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO booking_user_type
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attname = 'user_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO profile_id_type
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'profiles'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF booking_user_type IS NULL OR profile_id_type IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings.user_id or profiles.id is missing.';
  END IF;

  IF booking_user_type IS DISTINCT FROM profile_id_type THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings.user_id (%) does not match profiles.id (%).',
      booking_user_type,
      profile_id_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND a.attname = 'full_name'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: public.profiles.full_name does not exist.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.list_owned_provider_bookings()
RETURNS TABLE (
  id bigint,
  created_at timestamp with time zone,
  provider_id text,
  service_id text,
  booking_date date,
  booking_time time without time zone,
  status text,
  updated_at timestamp with time zone,
  customer_full_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    b.id::bigint,
    b.created_at::timestamp with time zone,
    b.provider_id::text,
    b.service_id::text,
    b.booking_date::date,
    b.booking_time::time without time zone,
    b.status::text,
    b.updated_at::timestamp with time zone,
    NULLIF(pg_catalog.btrim(COALESCE(pr.full_name, '')), '')::text
  FROM public.bookings AS b
  INNER JOIN public.providers AS p
    ON p.id = b.provider_id
   AND p.owner_id = (SELECT auth.uid())
  LEFT JOIN public.profiles AS pr
    ON pr.id = b.user_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND b.provider_id IS NOT NULL
  ORDER BY b.booking_date ASC, b.booking_time ASC, b.id ASC;
$$;

COMMENT ON FUNCTION public.list_owned_provider_bookings() IS
  'Returns bookings for providers owned by auth.uid(), including draft businesses. Display name from profiles.full_name only; no email or phone.';

ALTER FUNCTION public.list_owned_provider_bookings() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_owned_provider_bookings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_owned_provider_bookings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_owned_provider_bookings() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_owned_provider_bookings() TO authenticated;

-- Defense in depth: same ownership predicate as the join above, using the
-- existing helper. Not used by the RPC body (the join is sufficient). Kept
-- documented so a later table SELECT — if ever added — can reuse it:
--   USING (public.provider_owned_by_me(provider_id))
-- Do not add that policy in this migration.

COMMIT;
