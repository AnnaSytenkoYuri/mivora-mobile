-- Mivora: Phase 3 — pending customer bookings
-- DO NOT apply until the app inserts status = 'pending'.
-- Today createBooking still sends status = 'confirmed'; applying this first
-- will reject new customer bookings.
--
-- This file is not executed by the app. Do not run against production until
-- the application change is ready to deploy in the same release.
--
-- Depends on:
--   20261016185300_providers_published.sql
--     bookings_insert_own_published_service
--     provider_is_published(text), service_belongs_to_provider(text, text)
--   20261018020500_provider_booking_management.sql
--     bookings_status_check includes pending; client UPDATE revoked
--
-- Purpose
--   1. INSERT WITH CHECK requires status = 'pending' (plus existing ownership,
--      published provider, matching service).
--   2. cancel_my_booking: owner may cancel pending or confirmed only.
--   3. reschedule_my_booking: owner may move pending or confirmed; status
--      unchanged; new slot must be in the future in Asia/Bangkok.
--
-- CREATE OR REPLACE is refused unless each customer RPC:
--   - has exactly one overload
--   - argument types match (bigint) and (bigint, date, time)
--   - return type is SETOF public.bookings (pg_get_function_result SETOF bookings)
-- Replacing a TABLE(...) return type would fail in PostgreSQL; this migration
-- fails closed before that.
--
-- Does not:
--   UPDATE existing rows / rewrite confirmed → pending
--   Change confirm_owned_booking / decline_owned_booking / complete_owned_booking
--   Restore UPDATE grants or UPDATE RLS for anon/authenticated
--   Change SELECT policies
--
-- Confirm before execute:
--   1. INSERT policy name is still bookings_insert_own_published_service
--   2. App is ready to insert pending
--   3. Customer RPC owners remain a role that can UPDATE bookings (postgres)
--   4. No BEFORE INSERT trigger forces status away from pending
--   5. service_role / postgres can still insert any status (RLS bypass) — expected

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preconditions: helpers, unique RPC overloads, SETOF bookings return type
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  cancel_count integer;
  reschedule_count integer;
  cancel_result text;
  reschedule_result text;
  cancel_args text;
  reschedule_args text;
BEGIN
  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF pg_catalog.to_regprocedure('public.provider_is_published(text)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) is missing.';
  END IF;

  IF pg_catalog.to_regprocedure('public.service_belongs_to_provider(text, text)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.service_belongs_to_provider(text, text) is missing.';
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
      'Refusing to continue: cancel_my_booking returns %; this migration replaces SETOF bookings only. Inspect pg_get_functiondef before retrying.',
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
      'Refusing to continue: reschedule_my_booking returns %; this migration replaces SETOF bookings only. Inspect pg_get_functiondef before retrying.',
      reschedule_result;
  END IF;
END
$$;

-- Permissive UPDATE/ALL would restore client PATCH. Restrictive INSERT/ALL
-- are AND'd with the new policy and can silently reject pending inserts.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(
    CASE WHEN permissive = 'PERMISSIVE' THEN 'PERMISSIVE ' ELSE 'RESTRICTIVE ' END
      || policyname || ' [' || cmd || ']',
    ', '
    ORDER BY policyname
  )
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND (
      (permissive = 'PERMISSIVE' AND cmd IN ('UPDATE', '*'))
      OR (permissive = 'RESTRICTIVE' AND cmd IN ('INSERT', 'UPDATE', '*'))
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: blocking leftover public.bookings policies: %',
      leftover;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Column default: omitted status must not become confirmed.
--    Does not rewrite existing rows.
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ALTER COLUMN status SET DEFAULT 'pending';

-- ---------------------------------------------------------------------------
-- 3. Replace INSERT policy. Exact name (not IF EXISTS). Abort leftover
--    permissive INSERT/ALL (OR bypass) and any remaining INSERT policy.
-- ---------------------------------------------------------------------------

DROP POLICY "bookings_insert_own_published_service" ON public.bookings;

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(
    CASE WHEN permissive = 'PERMISSIVE' THEN 'PERMISSIVE ' ELSE 'RESTRICTIVE ' END
      || policyname || ' [' || cmd || ']',
    ', '
    ORDER BY policyname
  )
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND cmd IN ('INSERT', '*');

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover public.bookings INSERT/ALL policies would bypass or AND-block pending insert: %',
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
  AND status = 'pending'
  AND public.provider_is_published(provider_id)
  AND public.service_belongs_to_provider(service_id, provider_id)
);

DO $$
DECLARE
  insert_policies text;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || '/' || permissive || ']', ', ' ORDER BY policyname)
  INTO insert_policies
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND cmd IN ('INSERT', '*');

  IF insert_policies IS DISTINCT FROM 'bookings_insert_own_published_service [INSERT/PERMISSIVE]' THEN
    RAISE EXCEPTION
      'Refusing to continue: expected only PERMISSIVE INSERT bookings_insert_own_published_service, found: %',
      insert_policies;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Customer cancel — pending or confirmed. Same identity (bigint) / SETOF.
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
  RETURNING b.*;
$$;

COMMENT ON FUNCTION public.cancel_my_booking(bigint) IS
  'Customer-only: cancel own pending or confirmed booking. Empty if not owner or wrong status.';

ALTER FUNCTION public.cancel_my_booking(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cancel_my_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_my_booking(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_my_booking(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_booking(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Customer reschedule — pending or confirmed; status unchanged;
--    new date+time must be in the future in Asia/Bangkok.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reschedule_my_booking(
  p_booking_id bigint,
  p_date date,
  p_time time without time zone
)
RETURNS SETOF public.bookings
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.bookings AS b
  SET
    booking_date = p_date,
    booking_time = p_time,
    updated_at = pg_catalog.now()
  WHERE b.id = p_booking_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND b.user_id = (SELECT auth.uid())
    AND b.status IN ('pending', 'confirmed')
    AND p_date IS NOT NULL
    AND p_time IS NOT NULL
    AND ((p_date + p_time) AT TIME ZONE 'Asia/Bangkok') > pg_catalog.now()
  RETURNING b.*;
$$;

COMMENT ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) IS
  'Customer-only: reschedule own pending or confirmed booking. Does not change status. New slot must be in the future in Asia/Bangkok.';

ALTER FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) TO authenticated;

-- Strip leftover EXECUTE from roles other than authenticated / table-owner admins.
-- GRANT cannot run as a PL/pgSQL statement; revoke here, then GRANT in SQL.
DO $$
DECLARE
  rec record;
  acl record;
  rol text;
  func text;
  allowed constant text[] := ARRAY[
    'authenticated',
    'postgres',
    'service_role',
    'supabase_admin'
  ];
BEGIN
  FOR rec IN
    SELECT
      p.oid,
      p.proacl,
      n.nspname || '.' || p.proname || '('
        || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS func
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('cancel_my_booking', 'reschedule_my_booking')
  LOOP
    func := rec.func;
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || func || ' FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || func || ' FROM anon';

    IF rec.proacl IS NULL THEN
      CONTINUE;
    END IF;

    FOR acl IN
      SELECT x.grantee, x.privilege_type AS priv
      FROM pg_catalog.aclexplode(rec.proacl) AS x
    LOOP
      IF acl.priv <> 'EXECUTE' OR acl.grantee = 0 THEN
        CONTINUE;
      END IF;

      SELECT r.rolname INTO rol
      FROM pg_catalog.pg_roles AS r
      WHERE r.oid = acl.grantee;

      IF rol IS NULL OR rol = ANY (allowed) THEN
        CONTINUE;
      END IF;

      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || func || ' FROM ' || pg_catalog.quote_ident(rol);
    END LOOP;
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.cancel_my_booking(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.cancel_my_booking(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: anon still has EXECUTE on cancel_my_booking.';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.reschedule_my_booking(bigint, date, time without time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: anon still has EXECUTE on reschedule_my_booking.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.cancel_my_booking(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated lost EXECUTE on cancel_my_booking.';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.reschedule_my_booking(bigint, date, time without time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated lost EXECUTE on reschedule_my_booking.';
  END IF;
END
$$;

COMMIT;
