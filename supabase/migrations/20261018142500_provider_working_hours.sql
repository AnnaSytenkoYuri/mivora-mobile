-- Mivora: Phase 4a — provider working hours and date exceptions
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   20261016185300_providers_published.sql
--     public.provider_is_published(text)
--     public.provider_owned_by_me(text)
--
-- Purpose
--   Store weekly hours and per-date exceptions in Asia/Bangkok local date/time
--   (not timestamptz, not device-local). One bookable resource per provider.
--   Empty tables are valid: existing booking slots stay as they are until a
--   later phase reads this data.
--
-- Does not:
--   Change bookings, booking RPCs, INSERT policies, or services
--   Backfill hours for existing providers
--   Add staff_id (later: extra unique key on staff; these rows stay business-level)
--
-- Weekday: 0 = Sunday … 6 = Saturday (ISO-adjacent; JS Date.getDay()).
-- Closed weekday: no row in provider_working_hours.
-- Exception overrides weekly hours for that Bangkok calendar date.
--
-- Helpers reused (SECURITY DEFINER, search_path '', (text) → boolean):
--   provider_is_published: published IS TRUE
--   provider_owned_by_me: owner_id = auth.uid() (Draft or Published)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  published_oid oid;
  owned_oid oid;
  published_result text;
  owned_result text;
BEGIN
  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  published_oid := pg_catalog.to_regprocedure('public.provider_is_published(text)');
  owned_oid := pg_catalog.to_regprocedure('public.provider_owned_by_me(text)');

  IF published_oid IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) is missing.';
  END IF;

  IF owned_oid IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_owned_by_me(text) is missing.';
  END IF;

  published_result := pg_catalog.pg_get_function_result(published_oid);
  owned_result := pg_catalog.pg_get_function_result(owned_oid);

  IF published_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) returns %, expected boolean.',
      published_result;
  END IF;

  IF owned_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_owned_by_me(text) returns %, expected boolean.',
      owned_result;
  END IF;

  IF NOT has_function_privilege('anon', published_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: anon cannot EXECUTE public.provider_is_published(text).';
  END IF;

  IF NOT has_function_privilege('authenticated', published_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated cannot EXECUTE public.provider_is_published(text).';
  END IF;

  IF NOT has_function_privilege('authenticated', owned_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated cannot EXECUTE public.provider_owned_by_me(text).';
  END IF;

  IF pg_catalog.to_regclass('public.provider_working_hours') IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_working_hours already exists.';
  END IF;

  IF pg_catalog.to_regclass('public.provider_schedule_exceptions') IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_schedule_exceptions already exists.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Weekly hours — local Bangkok time
-- ---------------------------------------------------------------------------

CREATE TABLE public.provider_working_hours (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  opens_at time without time zone NOT NULL,
  closes_at time without time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT provider_working_hours_weekday_check
    CHECK (weekday >= 0 AND weekday <= 6),
  CONSTRAINT provider_working_hours_open_before_close_check
    CHECK (opens_at < closes_at),
  CONSTRAINT provider_working_hours_provider_weekday_key
    UNIQUE (provider_id, weekday)
);

COMMENT ON TABLE public.provider_working_hours IS
  'Weekly open intervals in Asia/Bangkok local time. No row means closed that weekday. One resource per provider; staff_id can be added later without replacing these business-level rows.';

COMMENT ON COLUMN public.provider_working_hours.weekday IS
  '0 = Sunday, 1 = Monday, … 6 = Saturday.';

COMMENT ON COLUMN public.provider_working_hours.opens_at IS
  'Local Asia/Bangkok time. Overnight ranges are not allowed (opens_at < closes_at).';

-- ---------------------------------------------------------------------------
-- 3. Date exceptions — local Bangkok dates
-- ---------------------------------------------------------------------------

CREATE TABLE public.provider_schedule_exceptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_closed boolean NOT NULL,
  opens_at time without time zone,
  closes_at time without time zone,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT provider_schedule_exceptions_provider_date_key
    UNIQUE (provider_id, exception_date),
  CONSTRAINT provider_schedule_exceptions_hours_check
    CHECK (
      (
        is_closed IS TRUE
        AND opens_at IS NULL
        AND closes_at IS NULL
      )
      OR (
        is_closed IS FALSE
        AND opens_at IS NOT NULL
        AND closes_at IS NOT NULL
        AND opens_at < closes_at
      )
    )
);

COMMENT ON TABLE public.provider_schedule_exceptions IS
  'Per-date override in Asia/Bangkok. Closed: is_closed true and null times. Open with custom hours: is_closed false and both times. Overrides weekly hours for that date.';

COMMENT ON COLUMN public.provider_schedule_exceptions.exception_date IS
  'Asia/Bangkok calendar date, not a timestamptz.';

CREATE INDEX provider_schedule_exceptions_date_idx
  ON public.provider_schedule_exceptions (exception_date);

-- ---------------------------------------------------------------------------
-- 4. Privileges — no writes for anon; SELECT for catalog; DML for authenticated
-- ---------------------------------------------------------------------------

ALTER TABLE public.provider_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_schedule_exceptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_working_hours FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_working_hours FROM anon;
REVOKE ALL ON TABLE public.provider_working_hours FROM authenticated;
REVOKE ALL ON TABLE public.provider_schedule_exceptions FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_schedule_exceptions FROM anon;
REVOKE ALL ON TABLE public.provider_schedule_exceptions FROM authenticated;

GRANT SELECT ON TABLE public.provider_working_hours TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.provider_working_hours TO authenticated;

GRANT SELECT ON TABLE public.provider_schedule_exceptions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.provider_schedule_exceptions TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.provider_working_hours_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.provider_schedule_exceptions_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — SELECT published or owner; writes owner-only
-- ---------------------------------------------------------------------------

CREATE POLICY "provider_working_hours_select_published_or_owner"
ON public.provider_working_hours
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
);

CREATE POLICY "provider_working_hours_insert_owner"
ON public.provider_working_hours
FOR INSERT
TO authenticated
WITH CHECK (public.provider_owned_by_me(provider_id));

CREATE POLICY "provider_working_hours_update_owner"
ON public.provider_working_hours
FOR UPDATE
TO authenticated
USING (public.provider_owned_by_me(provider_id))
WITH CHECK (public.provider_owned_by_me(provider_id));

CREATE POLICY "provider_working_hours_delete_owner"
ON public.provider_working_hours
FOR DELETE
TO authenticated
USING (public.provider_owned_by_me(provider_id));

CREATE POLICY "provider_schedule_exceptions_select_published_or_owner"
ON public.provider_schedule_exceptions
FOR SELECT
TO public
USING (
  public.provider_is_published(provider_id)
  OR public.provider_owned_by_me(provider_id)
);

CREATE POLICY "provider_schedule_exceptions_insert_owner"
ON public.provider_schedule_exceptions
FOR INSERT
TO authenticated
WITH CHECK (public.provider_owned_by_me(provider_id));

CREATE POLICY "provider_schedule_exceptions_update_owner"
ON public.provider_schedule_exceptions
FOR UPDATE
TO authenticated
USING (public.provider_owned_by_me(provider_id))
WITH CHECK (public.provider_owned_by_me(provider_id));

CREATE POLICY "provider_schedule_exceptions_delete_owner"
ON public.provider_schedule_exceptions
FOR DELETE
TO authenticated
USING (public.provider_owned_by_me(provider_id));

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname || ' [' || cmd || ']', ', ' ORDER BY tablename, policyname)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('provider_working_hours', 'provider_schedule_exceptions')
    AND permissive = 'PERMISSIVE'
    AND cmd = '*';

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: leftover FOR ALL policies on schedule tables: %',
      leftover;
  END IF;
END
$$;

COMMIT;
