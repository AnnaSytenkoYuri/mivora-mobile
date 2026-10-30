-- Mivora: provider booking management (status transitions)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   20261016185300_providers_published.sql  (public.provider_owned_by_me(text))
--   20261017120000_provider_bookings_list.sql (list RPC; not required at runtime)
--
-- Purpose
--   1. Add 'declined' to bookings_status_check. Existing rows are unchanged.
--   2. Stop PostgREST / client UPDATE on public.bookings so status, dates, and
--      ids cannot be patched directly. Customer cancel/reschedule keep working
--      through cancel_my_booking / reschedule_my_booking (SECURITY DEFINER).
--   3. Owner-only RPCs with compare-and-swap status:
--        pending   → confirmed   confirm_owned_booking(bigint)
--        pending   → declined    decline_owned_booking(bigint)
--        confirmed → completed   complete_owned_booking(bigint)
--          only if booking_date + booking_time is not in the future
--          in Asia/Bangkok (appointment local time ≤ now() as timestamptz)
--      Authorization: auth.uid() owns providers.id = bookings.provider_id.
--      Draft businesses are allowed (no published check).
--
-- Does not:
--   Change customer INSERT (still auto-confirmed in the app)
--   Restrict INSERT status (still a residual risk; later phase)
--   Replace or alter cancel_my_booking / reschedule_my_booking
--   Change SELECT policies or list_owned_provider_bookings()
--   Rewrite existing booking rows
--   Return user_id, email, or phone
--
-- Confirm before execute (Dashboard / SQL):
--   1. Constraint public.bookings.bookings_status_check exists
--   2. UPDATE policy name is exactly "Users can update their own bookings"
--   3. cancel_my_booking(bigint) and reschedule_my_booking(bigint, date, time)
--      are SECURITY DEFINER and owned by a role that still has table UPDATE
--      after REVOKE from anon/authenticated (typically postgres)
--   4. No leftover table- or column-level UPDATE for anon/authenticated
--      (verified with has_column_privilege on every bookings column)
--   5. ALTER DEFAULT PRIVILEGES does not re-grant UPDATE on bookings to
--      anon/authenticated
--   6. public.provider_owned_by_me(text) exists

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.provider_owned_by_me(text)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_owned_by_me(text) is missing.';
  END IF;

  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS rel ON rel.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'bookings'
      AND c.conname = 'bookings_status_check'
      AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings.bookings_status_check is missing.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. CHECK: add declined. No row rewrite. Current values remain valid.
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (
    status IN (
      'pending',
      'confirmed',
      'declined',
      'completed',
      'cancelled'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Close client UPDATE. Exact policy name from live DB (not IF EXISTS).
--    Permissive UPDATE lets PostgREST PATCH status/date/time/ids if the role
--    has UPDATE grants. DEFINER customer RPCs do not need this policy.
-- ---------------------------------------------------------------------------

DROP POLICY "Users can update their own bookings" ON public.bookings;

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
    AND cmd IN ('UPDATE', '*');

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover public.bookings UPDATE/ALL policies would allow client writes: %',
      leftover;
  END IF;
END
$$;

REVOKE UPDATE ON TABLE public.bookings FROM PUBLIC;
REVOKE UPDATE ON TABLE public.bookings FROM anon;
REVOKE UPDATE ON TABLE public.bookings FROM authenticated;

-- Column-level UPDATE is independent of table-level REVOKE. Revoke UPDATE on
-- every remaining column for PUBLIC / anon / authenticated. Revoking a
-- privilege that was never granted is a no-op.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT a.attname AS column_name
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'bookings'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE UPDATE (%I) ON public.bookings FROM PUBLIC',
      rec.column_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE UPDATE (%I) ON public.bookings FROM anon',
      rec.column_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE UPDATE (%I) ON public.bookings FROM authenticated',
      rec.column_name
    );
  END LOOP;
END
$$;

-- has_table_privilege can miss column-only grants. Fail if any column still
-- allows UPDATE for anon or authenticated.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(
    a.attname
      || CASE
           WHEN has_column_privilege('anon', c.oid, a.attname, 'UPDATE')
             AND has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
             THEN ' [anon, authenticated]'
           WHEN has_column_privilege('anon', c.oid, a.attname, 'UPDATE')
             THEN ' [anon]'
           ELSE ' [authenticated]'
         END,
    ', '
    ORDER BY a.attname
  )
  INTO leftover
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (
      has_column_privilege('anon', c.oid, a.attname, 'UPDATE')
      OR has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: remaining column UPDATE on public.bookings: %',
      leftover;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Owner RPCs — VOLATILE, DEFINER, empty search_path, no user_id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_owned_booking(p_booking_id bigint)
RETURNS TABLE (
  id bigint,
  created_at timestamp with time zone,
  provider_id text,
  service_id text,
  booking_date date,
  booking_time time without time zone,
  status text,
  updated_at timestamp with time zone
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.bookings AS b
  SET
    status = 'confirmed',
    updated_at = pg_catalog.now()
  WHERE b.id = p_booking_id
    AND b.status = 'pending'
    AND (SELECT auth.uid()) IS NOT NULL
    AND public.provider_owned_by_me(b.provider_id)
  RETURNING
    b.id,
    b.created_at,
    b.provider_id,
    b.service_id,
    b.booking_date,
    b.booking_time,
    b.status,
    b.updated_at;
$$;

CREATE OR REPLACE FUNCTION public.decline_owned_booking(p_booking_id bigint)
RETURNS TABLE (
  id bigint,
  created_at timestamp with time zone,
  provider_id text,
  service_id text,
  booking_date date,
  booking_time time without time zone,
  status text,
  updated_at timestamp with time zone
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.bookings AS b
  SET
    status = 'declined',
    updated_at = pg_catalog.now()
  WHERE b.id = p_booking_id
    AND b.status = 'pending'
    AND (SELECT auth.uid()) IS NOT NULL
    AND public.provider_owned_by_me(b.provider_id)
  RETURNING
    b.id,
    b.created_at,
    b.provider_id,
    b.service_id,
    b.booking_date,
    b.booking_time,
    b.status,
    b.updated_at;
$$;

CREATE OR REPLACE FUNCTION public.complete_owned_booking(p_booking_id bigint)
RETURNS TABLE (
  id bigint,
  created_at timestamp with time zone,
  provider_id text,
  service_id text,
  booking_date date,
  booking_time time without time zone,
  status text,
  updated_at timestamp with time zone
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.bookings AS b
  SET
    status = 'completed',
    updated_at = pg_catalog.now()
  WHERE b.id = p_booking_id
    AND b.status = 'confirmed'
    AND (SELECT auth.uid()) IS NOT NULL
    AND public.provider_owned_by_me(b.provider_id)
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
      <= pg_catalog.now()
  RETURNING
    b.id,
    b.created_at,
    b.provider_id,
    b.service_id,
    b.booking_date,
    b.booking_time,
    b.status,
    b.updated_at;
$$;

COMMENT ON FUNCTION public.confirm_owned_booking(bigint) IS
  'Owner-only pending → confirmed. Compare-and-swap; empty if not owner or not pending.';

COMMENT ON FUNCTION public.decline_owned_booking(bigint) IS
  'Owner-only pending → declined. Compare-and-swap; empty if not owner or not pending.';

COMMENT ON FUNCTION public.complete_owned_booking(bigint) IS
  'Owner-only confirmed → completed when booking_date + booking_time is not in the future in Asia/Bangkok. Empty if not owner, not confirmed, or still in the future.';

ALTER FUNCTION public.confirm_owned_booking(bigint) OWNER TO postgres;
ALTER FUNCTION public.decline_owned_booking(bigint) OWNER TO postgres;
ALTER FUNCTION public.complete_owned_booking(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_owned_booking(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_owned_booking(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decline_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decline_owned_booking(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_owned_booking(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_owned_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_owned_booking(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_owned_booking(bigint) TO authenticated;

COMMIT;
