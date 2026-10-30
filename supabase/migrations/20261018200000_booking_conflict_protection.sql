-- Mivora: Phase 4d part 1 — server-side booking conflict protection
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- SAFE TO APPLY BEFORE the app switch if (and only if) every preflight query
-- below returns zero rows / the expected empty result, and btree_gist is
-- available. Client INSERT stays enabled. Live createBooking() keeps working:
-- a BEFORE INSERT trigger snapshots duration_minutes from public.services
-- (FOR SHARE) and enforces hours / horizon / past. Concurrent overlaps are
-- rejected by a GiST exclusion constraint.
--
-- Occupancy range:
--   booking_date + booking_time are already Asia/Bangkok civil values (not
--   timestamptz). A generated tstzrange using AT TIME ZONE 'Asia/Bangkok' is
--   NOT a legal generated-column expression: named-zone conversion is STABLE
--   (IANA tzdata can change), and generated columns require IMMUTABLE
--   expressions. This migration stores an immutable tsrange of those local
--   timestamps instead. Bangkok has no DST, so local-tsrange overlap matches
--   timestamptz overlap for these columns. Clients cannot write occupancy_range
--   (GENERATED ALWAYS).
--
-- Depends on:
--   20261016185300_providers_published.sql
--     provider_is_published(text), service_belongs_to_provider(text, text)
--   20261018023800_pending_bookings.sql
--     INSERT policy bookings_insert_own_published_service (status = pending)
--     cancel_my_booking(bigint), reschedule_my_booking(bigint, date, time)
--   20261018142500_provider_working_hours.sql
--     provider_working_hours, provider_schedule_exceptions
--   20261018190000_list_provider_occupied_intervals.sql
--     list_provider_occupied_intervals(text, date)
--
-- This part:
--   1. bookings.duration_minutes snapshot + backfill from services for ALL rows
--   2. Generated occupancy_range tsrange (local Bangkok civil time, [start, end))
--   3. btree_gist exclusion on (provider_id, occupancy_range) for
--      pending|confirmed only
--   4. Hours / exceptions / 14-day horizon / not-in-the-past trigger
--   5. create_my_booking RPC (auth.uid(), status pending, no client user_id)
--   6. reschedule_my_booking: same hours/conflict rules; same-row update is
--      ignored by exclusion (self)
--   7. list_provider_occupied_intervals reads the snapshot, not live services
--
-- Does not:
--   Revoke client INSERT (see 20261018210000_revoke_bookings_client_insert.sql)
--   Change confirm/decline/complete or cancel_my_booking bodies
--   Change SELECT policies on bookings
--   Delete historical bookings or invent durations
--   Change existing date/time/status
--
-- Hosted Supabase: btree_gist is typically installable into schema extensions.
--
-- Preflight (SQL editor, BEFORE this migration). Do not apply if A–D return
-- any rows, or if E does not show btree_gist available.
--
--   -- A. ANY booking (including cancelled, declined, completed) that cannot
--   --    receive a valid duration snapshot. duration_minutes becomes NOT NULL
--   --    on every row. Do not delete these bookings or invent minutes.
--   SELECT b.id, b.status, b.provider_id, b.service_id, b.booking_date,
--          s.duration_minutes AS service_duration_minutes
--   FROM public.bookings AS b
--   LEFT JOIN public.services AS s
--     ON s.id = b.service_id
--    AND s.provider_id = b.provider_id
--   WHERE s.id IS NULL
--      OR s.duration_minutes IS NULL
--      OR s.duration_minutes::integer <= 0
--      OR s.duration_minutes::integer > 1440;
--
--   -- B. Overlapping pending/confirmed intervals (half-open local tsrange),
--   --    using current service duration until the snapshot exists.
--   SELECT a.id AS id_a, b.id AS id_b, a.provider_id, a.booking_date,
--          a.booking_time AS time_a, b.booking_time AS time_b,
--          sa.duration_minutes AS duration_a, sb.duration_minutes AS duration_b
--   FROM public.bookings AS a
--   JOIN public.bookings AS b
--     ON a.provider_id = b.provider_id
--    AND a.id < b.id
--    AND a.status IN ('pending', 'confirmed')
--    AND b.status IN ('pending', 'confirmed')
--   JOIN public.services AS sa
--     ON sa.id = a.service_id AND sa.provider_id = a.provider_id
--   JOIN public.services AS sb
--     ON sb.id = b.service_id AND sb.provider_id = b.provider_id
--   WHERE tsrange(
--           (a.booking_date + a.booking_time),
--           (a.booking_date + a.booking_time)
--             + (sa.duration_minutes::integer * interval '1 minute'),
--           '[)'
--         ) && tsrange(
--           (b.booking_date + b.booking_time),
--           (b.booking_date + b.booking_time)
--             + (sb.duration_minutes::integer * interval '1 minute'),
--           '[)'
--         );
--
--   -- C. Part 1 columns must not already exist (partial apply).
--   SELECT a.attname
--   FROM pg_catalog.pg_attribute AS a
--   JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
--   JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname = 'bookings'
--     AND a.attnum > 0
--     AND NOT a.attisdropped
--     AND a.attname IN ('duration_minutes', 'occupancy_range');
--
--   -- D. create_my_booking must not already exist.
--   SELECT p.oid::regprocedure
--   FROM pg_catalog.pg_proc AS p
--   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = 'create_my_booking';
--
--   -- E. btree_gist must be installed or installable (expect one row).
--   SELECT e.name, e.installed_version, e.default_version
--   FROM pg_catalog.pg_available_extensions AS e
--   WHERE e.name = 'btree_gist';
--
-- Rollback (manual, only if part 2 was NOT applied):
--   DROP TRIGGER bookings_enforce_availability ON public.bookings;
--   DROP FUNCTION public.bookings_enforce_availability();
--   DROP FUNCTION public.booking_slot_is_allowed(text, date, time, integer);
--   DROP FUNCTION public.create_my_booking(text, text, date, time);
--   Restore prior reschedule_my_booking / list_provider_occupied_intervals
--     from 20261018023800 / 20261018190000.
--   ALTER TABLE public.bookings DROP CONSTRAINT bookings_pending_confirmed_occupancy_excl;
--   ALTER TABLE public.bookings DROP COLUMN occupancy_range;
--   ALTER TABLE public.bookings DROP COLUMN duration_minutes;
--   Exclusion/hours protection is then gone; client INSERT remains.

BEGIN;

SET LOCAL search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  published_oid oid;
  service_oid oid;
  occupancy_oid oid;
  leftover text;
  existing_cols text;
BEGIN
  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.services does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.provider_working_hours') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_working_hours does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.provider_schedule_exceptions') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_schedule_exceptions does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_available_extensions AS e
    WHERE e.name = 'btree_gist'
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: extension btree_gist is not available.';
  END IF;

  published_oid := pg_catalog.to_regprocedure('public.provider_is_published(text)');
  service_oid := pg_catalog.to_regprocedure('public.service_belongs_to_provider(text, text)');
  occupancy_oid := pg_catalog.to_regprocedure('public.list_provider_occupied_intervals(text, date)');

  IF published_oid IS NULL OR pg_catalog.pg_get_function_result(published_oid) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_is_published(text) is missing or not boolean.';
  END IF;

  IF service_oid IS NULL OR pg_catalog.pg_get_function_result(service_oid) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION
      'Refusing to continue: public.service_belongs_to_provider(text, text) is missing or not boolean.';
  END IF;

  IF occupancy_oid IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.list_provider_occupied_intervals(text, date) is missing.';
  END IF;

  IF pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time without time zone)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time)') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.create_my_booking already exists.';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
  INTO existing_cols
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN ('duration_minutes', 'occupancy_range');

  IF existing_cols IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings already has % — refuse partial re-apply.',
      existing_cols;
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
-- 2. Duration snapshot — nullable, backfill ALL statuses, then NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN duration_minutes integer;

COMMENT ON COLUMN public.bookings.duration_minutes IS
  'Minutes occupied by this booking, copied from public.services at INSERT under FOR SHARE. Service edits after create do not change this value. Occupancy for pending/confirmed uses this snapshot.';

UPDATE public.bookings AS b
SET duration_minutes = s.duration_minutes::integer
FROM public.services AS s
WHERE b.duration_minutes IS NULL
  AND s.id = b.service_id
  AND s.provider_id = b.provider_id
  AND s.duration_minutes IS NOT NULL
  AND s.duration_minutes::integer > 0
  AND s.duration_minutes::integer <= 1440;

DO $$
DECLARE
  missing text;
  overlap_ids text;
BEGIN
  SELECT string_agg(b.id::text || '(' || b.status || ')', ', ' ORDER BY b.id)
  INTO missing
  FROM public.bookings AS b
  WHERE b.duration_minutes IS NULL
     OR b.duration_minutes <= 0
     OR b.duration_minutes > 1440;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings of any status missing a valid duration_minutes snapshot (deleted service or invalid duration). Historical rows were not deleted or invented. ids: %',
      missing;
  END IF;

  SELECT string_agg(a.id::text || '+' || b.id::text, ', ' ORDER BY a.id, b.id)
  INTO overlap_ids
  FROM public.bookings AS a
  JOIN public.bookings AS b
    ON a.provider_id = b.provider_id
   AND a.id < b.id
   AND a.status IN ('pending', 'confirmed')
   AND b.status IN ('pending', 'confirmed')
  WHERE tsrange(
          (a.booking_date + a.booking_time),
          (a.booking_date + a.booking_time) + (a.duration_minutes * interval '1 minute'),
          '[)'
        ) && tsrange(
          (b.booking_date + b.booking_time),
          (b.booking_date + b.booking_time) + (b.duration_minutes * interval '1 minute'),
          '[)'
        );

  IF overlap_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: overlapping pending/confirmed bookings exist; none were deleted or rewritten. Resolve manually, then retry. id pairs: %',
      overlap_ids;
  END IF;
END
$$;

ALTER TABLE public.bookings
  ALTER COLUMN duration_minutes SET NOT NULL;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_duration_minutes_check
  CHECK (duration_minutes > 0 AND duration_minutes <= 1440);

-- ---------------------------------------------------------------------------
-- 3. Occupancy range + exclusion (adjacent [start, end) allowed)
--    Local tsrange is IMMUTABLE. Named-zone AT TIME ZONE is not.
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN occupancy_range tsrange
  GENERATED ALWAYS AS (
    tsrange(
      (booking_date + booking_time),
      (booking_date + booking_time) + pg_catalog.make_interval(mins => duration_minutes),
      '[)'
    )
  ) STORED;

COMMENT ON COLUMN public.bookings.occupancy_range IS
  'Generated half-open local interval [start, start+duration) from Bangkok civil date+time columns. Immutable; not a timestamptz. Used only for exclusion. Clients cannot write this column.';

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pending_confirmed_occupancy_excl
  EXCLUDE USING gist (
    provider_id WITH =,
    occupancy_range WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'));

-- ---------------------------------------------------------------------------
-- 4. Hours / exceptions / horizon helper (no bookings PII)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_slot_is_allowed(
  p_provider_id text,
  p_date date,
  p_time time without time zone,
  p_duration_minutes integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bangkok_today date;
  start_mins integer;
  end_mins integer;
  open_mins integer;
  close_mins integer;
  weekly_exists boolean;
  exception_closed boolean;
  exception_opens time without time zone;
  exception_closes time without time zone;
  weekly_opens time without time zone;
  weekly_closes time without time zone;
  dow integer;
BEGIN
  IF p_provider_id IS NULL OR pg_catalog.btrim(p_provider_id) = ''
     OR p_date IS NULL OR p_time IS NULL
     OR p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RETURN false;
  END IF;

  IF NOT public.provider_is_published(p_provider_id) THEN
    RETURN false;
  END IF;

  bangkok_today := (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date;
  IF p_date < bangkok_today OR p_date >= (bangkok_today + 14) THEN
    RETURN false;
  END IF;

  IF ((p_date + p_time) AT TIME ZONE 'Asia/Bangkok') <= pg_catalog.now() THEN
    RETURN false;
  END IF;

  start_mins := (EXTRACT(HOUR FROM p_time)::integer * 60)
    + EXTRACT(MINUTE FROM p_time)::integer;
  end_mins := start_mins + p_duration_minutes;
  IF end_mins > 1440 THEN
    RETURN false;
  END IF;

  SELECT e.is_closed, e.opens_at, e.closes_at
  INTO exception_closed, exception_opens, exception_closes
  FROM public.provider_schedule_exceptions AS e
  WHERE e.provider_id = p_provider_id
    AND e.exception_date = p_date;

  IF FOUND THEN
    IF exception_closed IS TRUE THEN
      RETURN false;
    END IF;

    IF exception_opens IS NULL OR exception_closes IS NULL OR exception_opens >= exception_closes THEN
      RETURN false;
    END IF;

    open_mins := (EXTRACT(HOUR FROM exception_opens)::integer * 60)
      + EXTRACT(MINUTE FROM exception_opens)::integer;
    close_mins := (EXTRACT(HOUR FROM exception_closes)::integer * 60)
      + EXTRACT(MINUTE FROM exception_closes)::integer;
    RETURN start_mins >= open_mins AND end_mins <= close_mins;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.provider_working_hours AS h
    WHERE h.provider_id = p_provider_id
  )
  INTO weekly_exists;

  IF weekly_exists IS NOT TRUE THEN
    RETURN false;
  END IF;

  dow := EXTRACT(DOW FROM p_date)::integer;

  SELECT h.opens_at, h.closes_at
  INTO weekly_opens, weekly_closes
  FROM public.provider_working_hours AS h
  WHERE h.provider_id = p_provider_id
    AND h.weekday = dow;

  IF NOT FOUND OR weekly_opens IS NULL OR weekly_closes IS NULL OR weekly_opens >= weekly_closes THEN
    RETURN false;
  END IF;

  open_mins := (EXTRACT(HOUR FROM weekly_opens)::integer * 60)
    + EXTRACT(MINUTE FROM weekly_opens)::integer;
  close_mins := (EXTRACT(HOUR FROM weekly_closes)::integer * 60)
    + EXTRACT(MINUTE FROM weekly_closes)::integer;
  RETURN start_mins >= open_mins AND end_mins <= close_mins;
END;
$$;

COMMENT ON FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) IS
  'STABLE. True when a published provider can take a pending/confirmed booking at this Bangkok local date/time for this duration. Unconfigured weekly hours, closed weekdays/exceptions, overnight wrap, past instants, and dates outside a 14-day Bangkok horizon are false. Does not check occupancy (exclusion constraint does). Not executable by clients.';

ALTER FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.booking_slot_is_allowed(text, date, time without time zone, integer) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Trigger: snapshot duration on INSERT and service/provider change
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bookings_enforce_availability()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  service_duration integer;
  should_snapshot boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    should_snapshot :=
      NEW.service_id IS DISTINCT FROM OLD.service_id
      OR NEW.provider_id IS DISTINCT FROM OLD.provider_id;

    IF NOT should_snapshot AND NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
      NEW.duration_minutes := OLD.duration_minutes;
    END IF;
  END IF;

  IF should_snapshot THEN
    SELECT s.duration_minutes::integer
    INTO service_duration
    FROM public.services AS s
    WHERE s.id = NEW.service_id
      AND s.provider_id = NEW.provider_id
    FOR SHARE OF s;

    IF service_duration IS NULL OR service_duration <= 0 OR service_duration > 1440 THEN
      RAISE EXCEPTION 'bookings_enforce_availability: service duration is missing'
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.duration_minutes := service_duration;
  END IF;

  IF NEW.status IN ('pending', 'confirmed') THEN
    IF NOT public.booking_slot_is_allowed(
      NEW.provider_id,
      NEW.booking_date,
      NEW.booking_time,
      NEW.duration_minutes
    ) THEN
      RAISE EXCEPTION 'bookings_enforce_availability: slot is not bookable'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bookings_enforce_availability() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bookings_enforce_availability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bookings_enforce_availability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bookings_enforce_availability() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bookings_enforce_availability() FROM authenticated;

DROP TRIGGER IF EXISTS bookings_enforce_availability ON public.bookings;

CREATE TRIGGER bookings_enforce_availability
BEFORE INSERT OR UPDATE OF booking_date, booking_time, duration_minutes, provider_id, service_id
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.bookings_enforce_availability();

-- ---------------------------------------------------------------------------
-- 6. create_my_booking — authenticated, pending, identity from auth.uid()
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.create_my_booking(
  p_provider_id text,
  p_service_id text,
  p_date date,
  p_time time without time zone
)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid;
  service_duration integer;
BEGIN
  uid := (SELECT auth.uid());
  IF uid IS NULL THEN
    RAISE EXCEPTION 'create_my_booking: sign in required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_provider_id IS NULL OR pg_catalog.btrim(p_provider_id) = ''
     OR p_service_id IS NULL OR pg_catalog.btrim(p_service_id) = ''
     OR p_date IS NULL OR p_time IS NULL THEN
    RAISE EXCEPTION 'create_my_booking: provider, service, date, and time are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT public.provider_is_published(p_provider_id) THEN
    RAISE EXCEPTION 'create_my_booking: provider is not published'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.service_belongs_to_provider(p_service_id, p_provider_id) THEN
    RAISE EXCEPTION 'create_my_booking: service does not belong to provider'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Hold the service row so a concurrent duration edit cannot diverge the
  -- hours check from the INSERT snapshot (trigger takes the same FOR SHARE).
  SELECT s.duration_minutes::integer
  INTO service_duration
  FROM public.services AS s
  WHERE s.id = p_service_id
    AND s.provider_id = p_provider_id
  FOR SHARE OF s;

  IF service_duration IS NULL OR service_duration <= 0 OR service_duration > 1440 THEN
    RAISE EXCEPTION 'create_my_booking: service duration is missing'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.booking_slot_is_allowed(p_provider_id, p_date, p_time, service_duration) THEN
    RAISE EXCEPTION 'create_my_booking: slot is not bookable'
      USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    RETURN QUERY
    INSERT INTO public.bookings (
      user_id,
      provider_id,
      service_id,
      booking_date,
      booking_time,
      status,
      duration_minutes
    )
    VALUES (
      uid,
      p_provider_id,
      p_service_id,
      p_date,
      p_time,
      'pending',
      service_duration
    )
    RETURNING public.bookings.*;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'create_my_booking: this time is no longer available'
        USING ERRCODE = 'exclusion_violation';
  END;
END;
$$;

COMMENT ON FUNCTION public.create_my_booking(text, text, date, time without time zone) IS
  'Authenticated customer insert. user_id = auth.uid(), status = pending, duration snapshotted from services under FOR SHARE. Rejects unpublished providers, mismatched services, hours/exceptions, past Bangkok times, dates outside 14-day horizon, and overlapping pending/confirmed occupancy. Does not accept user_id or status from the client.';

ALTER FUNCTION public.create_my_booking(text, text, date, time without time zone) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_my_booking(text, text, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_my_booking(text, text, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_my_booking(text, text, date, time without time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_booking(text, text, date, time without time zone) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. reschedule — same slot rules; status and duration unchanged; self excluded
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
    RETURNING b.*;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'reschedule_my_booking: this time is no longer available'
        USING ERRCODE = 'exclusion_violation';
  END;
END;
$$;

COMMENT ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) IS
  'Customer-only: reschedule own pending or confirmed booking. Status and duration_minutes unchanged. Trigger enforces hours/horizon/past; exclusion enforces occupancy and ignores this row as self. Empty if not owner or wrong status.';

ALTER FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_my_booking(bigint, date, time without time zone) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Occupancy RPC reads snapshots (deleted services still occupy)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_provider_occupied_intervals(
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

  RETURN QUERY
  SELECT
    b.booking_time::time without time zone,
    b.duration_minutes
  FROM public.bookings AS b
  WHERE b.provider_id = p_provider_id
    AND b.booking_date = p_date
    AND b.status IN ('pending', 'confirmed')
    AND public.provider_is_published(p_provider_id)
    AND b.duration_minutes > 0
  ORDER BY 1 ASC, 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.list_provider_occupied_intervals(text, date) IS
  'Anonymous occupied intervals from bookings.duration_minutes snapshots. Pending and confirmed only. Empty for unpublished providers. No user_id, names, booking ids, or full rows.';

ALTER FUNCTION public.list_provider_occupied_intervals(text, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_provider_occupied_intervals(text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_provider_occupied_intervals(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_provider_occupied_intervals(text, date) TO anon, authenticated;

-- Owner / cancel RPCs unchanged. Resolve function oids so privilege checks
-- do not fail closed on time vs time without time zone identity text.
DO $$
DECLARE
  create_oid oid;
  slot_oid oid;
  trigger_oid oid;
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.cancel_my_booking(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated lost EXECUTE on cancel_my_booking.';
  END IF;

  create_oid := COALESCE(
    pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time without time zone)'),
    pg_catalog.to_regprocedure('public.create_my_booking(text, text, date, time)')
  );
  slot_oid := COALESCE(
    pg_catalog.to_regprocedure('public.booking_slot_is_allowed(text, date, time without time zone, integer)'),
    pg_catalog.to_regprocedure('public.booking_slot_is_allowed(text, date, time, integer)')
  );
  trigger_oid := pg_catalog.to_regprocedure('public.bookings_enforce_availability()');

  IF create_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.create_my_booking was not created.';
  END IF;

  IF slot_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.booking_slot_is_allowed was not created.';
  END IF;

  IF trigger_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings_enforce_availability was not created.';
  END IF;

  IF has_function_privilege('anon', create_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: anon must not EXECUTE create_my_booking.';
  END IF;

  IF NOT has_function_privilege('authenticated', create_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated missing EXECUTE on create_my_booking.';
  END IF;

  IF has_function_privilege('anon', slot_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', slot_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: clients must not EXECUTE booking_slot_is_allowed.';
  END IF;

  IF has_function_privilege('anon', trigger_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', trigger_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: clients must not EXECUTE bookings_enforce_availability.';
  END IF;
END
$$;

COMMIT;
