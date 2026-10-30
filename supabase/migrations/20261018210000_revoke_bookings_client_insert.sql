-- Mivora: Phase 4d part 2 — revoke client INSERT on public.bookings
-- DO NOT apply until:
--   1. 20261018200000_booking_conflict_protection.sql is applied
--   2. The app createBooking() path uses public.create_my_booking RPC
--      (no supabase.from('bookings').insert)
--   3. That app version is shipped to every client you still support
--
-- Applying this while the live app still INSERTs into bookings will reject
-- every new customer booking.
--
-- Purpose
--   After create_my_booking is the only write path, drop the INSERT RLS
--   policy and REVOKE INSERT from anon/authenticated so PostgREST cannot
--   bypass hours/conflict checks by omitting columns or forging duration.
--   SECURITY DEFINER create_my_booking (owner postgres) still inserts.
--
-- Does not:
--   Change SELECT policies (customers still read their own rows)
--   Revoke INSERT from postgres / service_role
--   Change cancel / reschedule / owner confirm-decline-complete

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time without time zone)') IS NULL
     AND pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.create_my_booking is missing. Apply 20261018200000_booking_conflict_protection.sql and ship the RPC app first.';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.create_my_booking(text, text, date, time without time zone)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'public.create_my_booking(text, text, date, time)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated cannot EXECUTE create_my_booking.';
  END IF;
END
$$;

DROP POLICY IF EXISTS "bookings_insert_own_published_service" ON public.bookings;

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
      'Refusing to continue: leftover public.bookings INSERT/ALL policies: %',
      leftover;
  END IF;
END
$$;

REVOKE INSERT ON TABLE public.bookings FROM PUBLIC;
REVOKE INSERT ON TABLE public.bookings FROM anon;
REVOKE INSERT ON TABLE public.bookings FROM authenticated;

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
      'REVOKE INSERT (%I) ON public.bookings FROM PUBLIC',
      rec.column_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE INSERT (%I) ON public.bookings FROM anon',
      rec.column_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE INSERT (%I) ON public.bookings FROM authenticated',
      rec.column_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
  INTO leftover
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (
      has_column_privilege('anon', c.oid, a.attname, 'INSERT')
      OR has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: remaining column INSERT on public.bookings: %',
      leftover;
  END IF;

  IF has_table_privilege('authenticated', 'public.bookings', 'INSERT') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated still has table INSERT on public.bookings.';
  END IF;
END
$$;

COMMIT;
