-- Mivora: reject cancel/reschedule of confirmed bookings after start
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   20261018023800_pending_bookings.sql
--     cancel_my_booking(bigint)
--   20261018200000_booking_conflict_protection.sql
--     latest reschedule_my_booking(bigint, date, time)
--     occupancy_range, bookings_enforce_availability
--
-- This part:
--   1. cancel_my_booking: confirmed rows only when original Bangkok start > now()
--   2. reschedule_my_booking: same original-start check; keep exclusion handler
--
-- Does not:
--   Change RPC signatures, grants, or SECURITY DEFINER
--   Restrict pending bookings by original start time
--   Restore the older reschedule body that checked only the *new* slot in-RPC
--     (new-slot past / hours / horizon stay on bookings_enforce_availability)
--   Change create_my_booking, occupancy exclusion, reminder processor,
--     notification triggers, or pg_cron
--
-- Appointment instant:
--   (booking_date + booking_time) AT TIME ZONE 'Asia/Bangkok'
--   Reject when that instant is at or before pg_catalog.now() (NOT > now()).

BEGIN;

SET LOCAL search_path = public, pg_catalog;

DO $$
DECLARE
  cancel_count integer;
  cancel_result text;
  cancel_args text;
  reschedule_count integer;
  reschedule_result text;
  reschedule_args text;
BEGIN
  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'bookings'
      AND a.attname = 'occupancy_range'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings.occupancy_range is missing; apply 20261018200000 first.';
  END IF;

  IF pg_catalog.to_regprocedure('public.bookings_enforce_availability()') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings_enforce_availability() is missing; apply 20261018200000 first.';
  END IF;

  SELECT COUNT(*), MIN(pg_catalog.pg_get_function_result(p.oid)),
         MIN(pg_catalog.pg_get_function_identity_arguments(p.oid))
  INTO cancel_count, cancel_result, cancel_args
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'cancel_my_booking';

  IF cancel_count <> 1 THEN
    RAISE EXCEPTION
      'Refusing to continue: expected exactly one public.cancel_my_booking, found %.',
      cancel_count;
  END IF;

  IF cancel_args NOT IN ('bigint', 'p_booking_id bigint') THEN
    RAISE EXCEPTION
      'Refusing to continue: cancel_my_booking identity arguments are %, expected bigint.',
      cancel_args;
  END IF;

  IF cancel_result NOT IN ('SETOF bookings', 'SETOF public.bookings') THEN
    RAISE EXCEPTION
      'Refusing to continue: cancel_my_booking returns %; this migration replaces SETOF bookings only.',
      cancel_result;
  END IF;

  SELECT COUNT(*), MIN(pg_catalog.pg_get_function_result(p.oid)),
         MIN(pg_catalog.pg_get_function_identity_arguments(p.oid))
  INTO reschedule_count, reschedule_result, reschedule_args
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'reschedule_my_booking';

  IF reschedule_count <> 1 THEN
    RAISE EXCEPTION
      'Refusing to continue: expected exactly one public.reschedule_my_booking, found %.',
      reschedule_count;
  END IF;

  IF reschedule_args NOT IN (
    'bigint, date, time without time zone',
    'bigint, date, time',
    'p_booking_id bigint, p_date date, p_time time without time zone',
    'p_booking_id bigint, p_date date, p_time time'
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: reschedule_my_booking identity arguments are %, expected (bigint, date, time without time zone).',
      reschedule_args;
  END IF;

  IF reschedule_result NOT IN ('SETOF bookings', 'SETOF public.bookings') THEN
    RAISE EXCEPTION
      'Refusing to continue: reschedule_my_booking returns %; this migration replaces SETOF bookings only.',
      reschedule_result;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. cancel — pending unchanged; confirmed only before Bangkok start
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_my_booking(p_booking_id bigint)
RETURNS SETOF public.bookings
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.bookings AS b
  SET
    status = 'cancelled',
    updated_at = pg_catalog.now()
  WHERE b.id = p_booking_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND b.user_id = (SELECT auth.uid())
    AND b.status IN ('pending', 'confirmed')
    AND (
      b.status = 'pending'
      OR ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
           > pg_catalog.now()
    )
  RETURNING b.*;
$$;

COMMENT ON FUNCTION public.cancel_my_booking(bigint) IS
  'Customer-only: cancel own pending booking, or own confirmed booking whose Asia/Bangkok start is still after now(). Empty if not owner, wrong status, or confirmed start has passed.';

ALTER FUNCTION public.cancel_my_booking(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cancel_my_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_my_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_my_booking(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_booking(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. reschedule — latest conflict-protection body + original-start gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reschedule_my_booking(
  p_booking_id bigint,
  p_date date,
  p_time time without time zone
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN;
  END IF;

  IF p_booking_id IS NULL OR p_date IS NULL OR p_time IS NULL THEN
    RAISE EXCEPTION 'reschedule_my_booking: booking, date, and time are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  BEGIN
    RETURN QUERY
    UPDATE public.bookings AS b
    SET
      booking_date = p_date,
      booking_time = p_time,
      updated_at = pg_catalog.now()
    WHERE b.id = p_booking_id
      AND b.user_id = (SELECT auth.uid())
      AND b.status IN ('pending', 'confirmed')
      AND (
        b.status = 'pending'
        OR ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
             > pg_catalog.now()
      )
    RETURNING b.*;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'reschedule_my_booking: this time is no longer available'
        USING ERRCODE = 'exclusion_violation';
  END;
END;
$$;

COMMENT ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) IS
  'Customer-only: reschedule own pending booking, or own confirmed booking whose original Asia/Bangkok start is still after now(). Status and duration_minutes unchanged. Trigger enforces hours/horizon/past for the new slot; exclusion enforces occupancy and ignores this row as self. Empty if not owner, wrong status, or confirmed start has passed.';

ALTER FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) TO authenticated;

DO $$
DECLARE
  reschedule_oid oid;
BEGIN
  IF has_function_privilege('anon', 'public.cancel_my_booking(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: anon still has EXECUTE on cancel_my_booking.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.cancel_my_booking(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated lost EXECUTE on cancel_my_booking.';
  END IF;

  reschedule_oid := COALESCE(
    pg_catalog.to_regprocedure('public.reschedule_my_booking(bigint, date, time without time zone)'),
    pg_catalog.to_regprocedure('public.reschedule_my_booking(bigint, date, time)')
  );

  IF reschedule_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.reschedule_my_booking was not replaced.';
  END IF;

  IF has_function_privilege('anon', reschedule_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: anon still has EXECUTE on reschedule_my_booking.';
  END IF;

  IF NOT has_function_privilege('authenticated', reschedule_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated lost EXECUTE on reschedule_my_booking.';
  END IF;
END
$$;

COMMIT;
