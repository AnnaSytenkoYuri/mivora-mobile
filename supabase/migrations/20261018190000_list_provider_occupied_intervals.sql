-- Mivora: Phase 4c Step 2 — public occupancy intervals (read-only RPC)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   20261016185300_providers_published.sql
--     public.provider_is_published(text) → boolean
--     GRANT EXECUTE to anon, authenticated
--   20261018023800_pending_bookings.sql
--     bookings_status_check includes pending | confirmed
--
-- Purpose
--   Let the availability calculator load occupied chair time for one published
--   provider on one Asia/Bangkok calendar date, without exposing customers.
--
--   SECURITY DEFINER RPC public.list_provider_occupied_intervals(text, date)
--   returns only:
--     start_time        time without time zone  (bookings.booking_time)
--     duration_minutes  integer                 (services.duration_minutes)
--
--   Why an RPC instead of SELECT on public.bookings?
--   Customer SELECT is scoped to user_id = auth.uid(). A public/anon SELECT
--   policy on bookings would leak user_id, service_id, and full rows.
--   This function bypasses RLS as postgres, then returns anonymous intervals
--   only after public.provider_is_published(p_provider_id).
--
-- Duration source (temporary)
--   duration_minutes is joined from public.services at read time, not stored
--   on the booking. If an owner later edits a service’s duration, occupancy
--   for existing pending/confirmed bookings changes. Snapshot duration onto
--   bookings (or a booking_services table) before using this RPC as the
--   final conflict check at INSERT / reschedule.
--
-- Privacy
--   Does not return user_id, names, email, phone, booking id, service_id,
--   provider_id, or status. Unpublished / unknown providers return zero rows
--   (same as a published idle day), so existence of a draft business is not
--   confirmed by this RPC.
--
--   Residual inference (acceptable for marketplace availability, document it):
--   - Each row is one blocking booking. Row count ≈ how many pending+confirmed
--     appointments that day (bookings whose service row is missing are omitted).
--   - start_time + duration reveals when the chair is taken.
--   - Repeated identical (start, duration) pairs imply multiple bookings in
--     the same slot (data error or future multi-resource; MVP is one chair).
--   - Combining with public catalog services can guess which duration (hence
--     which service) is likely, not which customer.
--
-- Does not:
--   Change SELECT / INSERT / UPDATE policies on public.bookings
--   Change cancel_my_booking, reschedule_my_booking, owner confirm/decline/
--     complete RPCs, or list_owned_provider_bookings
--   Grant table SELECT on bookings to anon or authenticated
--
-- Confirm before execute:
--   1. public.provider_is_published(text) returns boolean; anon+authenticated EXECUTE
--   2. public.bookings has provider_id, service_id, booking_date, booking_time, status
--   3. public.services has id, provider_id, duration_minutes
--   4. No leftover FOR ALL (*) policy on public.bookings
--   5. Function does not already exist

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  published_oid oid;
  published_result text;
  leftover text;
  booking_cols integer;
  service_cols integer;
BEGIN
  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.services does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  published_oid := pg_catalog.to_regprocedure('public.provider_is_published(text)');
  IF published_oid IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) is missing.';
  END IF;

  published_result := pg_catalog.pg_get_function_result(published_oid);
  IF published_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) returns %, expected boolean.',
      published_result;
  END IF;

  IF NOT has_function_privilege('anon', published_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: anon cannot EXECUTE public.provider_is_published(text).';
  END IF;

  IF NOT has_function_privilege('authenticated', published_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated cannot EXECUTE public.provider_is_published(text).';
  END IF;

  IF pg_catalog.to_regprocedure('public.list_provider_occupied_intervals(text, date)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.list_provider_occupied_intervals(text, date) already exists.';
  END IF;

  SELECT pg_catalog.count(*)
  INTO booking_cols
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN (
      'provider_id',
      'service_id',
      'booking_date',
      'booking_time',
      'status'
    );

  IF booking_cols IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings is missing provider_id, service_id, booking_date, booking_time, or status.';
  END IF;

  SELECT pg_catalog.count(*)
  INTO service_cols
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'services'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN ('id', 'provider_id', 'duration_minutes');

  IF service_cols IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.services is missing id, provider_id, or duration_minutes.';
  END IF;

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

-- ---------------------------------------------------------------------------
-- 2. RPC — published providers only; anonymous intervals
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.list_provider_occupied_intervals(
  p_provider_id text,
  p_date date
)
RETURNS TABLE (
  start_time time without time zone,
  duration_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_provider_id IS NULL OR pg_catalog.btrim(p_provider_id) = '' THEN
    RAISE EXCEPTION 'list_provider_occupied_intervals: p_provider_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'list_provider_occupied_intervals: p_date is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unpublished, missing, or idle published providers all return zero rows.
  RETURN QUERY
  SELECT
    b.booking_time::time without time zone,
    s.duration_minutes::integer
  FROM public.bookings AS b
  INNER JOIN public.services AS s
    ON s.id = b.service_id
   AND s.provider_id = b.provider_id
  WHERE b.provider_id = p_provider_id
    AND b.booking_date = p_date
    AND b.status IN ('pending', 'confirmed')
    AND public.provider_is_published(p_provider_id)
    AND s.duration_minutes IS NOT NULL
    AND s.duration_minutes::integer > 0
  ORDER BY 1 ASC, 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.list_provider_occupied_intervals(text, date) IS
  'Anonymous occupied intervals (start_time, duration_minutes) for one published provider on one Bangkok calendar date. Pending and confirmed only. Duration is live services.duration_minutes (not snapshotted). No user_id, names, booking ids, or full booking rows. Empty for unpublished or unknown providers.';

ALTER FUNCTION public.list_provider_occupied_intervals(text, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_provider_occupied_intervals(text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_provider_occupied_intervals(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_provider_occupied_intervals(text, date) TO anon, authenticated;

COMMIT;
