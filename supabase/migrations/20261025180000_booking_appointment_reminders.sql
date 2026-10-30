-- Mivora Phase 1: in-app appointment reminders (24h and 2h)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   public.notifications, public.bookings, public.services
--   20261019134500_in_app_notifications.sql
--
-- Does not:
--   Change booking RPC signatures, grants, or status transitions
--   Grant INSERT/UPDATE/DELETE on public.notifications to clients
--   Delete existing inbox rows on cancel or reschedule
--   Enable pg_cron (availability is not established in this repository)
--
-- Design
--   Customer recipient = bookings.user_id. Confirmed bookings only.
--   Appointment instant = (booking_date + booking_time) AT TIME ZONE 'Asia/Bangkok'
--   Fire 24h = appointment - 24 hours; fire 2h = appointment - 2 hours
--   Slot eligibility timestamp = COALESCE(updated_at, created_at).
--   confirm_owned_booking and reschedule_my_booking both SET updated_at = now().
--   process_due_booking_reminders() inserts when:
--     status = confirmed
--     appointment > now()
--     fire_at <= now()                                    -- due
--     fire_at > now() - interval '1 hour'                  -- not late (incl. existing rows)
--     fire_at >= COALESCE(updated_at, created_at)          -- not late vs confirm/reschedule
--   Dedup: UNIQUE (booking_id, type, appointment_at) for reminder types.
--   A delivered reminder for an old slot keeps its appointment_at and does not
--   block a later reminder after reschedule to a different instant.
--   Reschedule back to the original date/time reuses appointment_at; ON CONFLICT
--   keeps the original inbox row and does not insert a duplicate.
--
-- Manual schedule (Dashboard, only if pg_cron is available on the project):
--   SELECT cron.schedule(
--     'mivora-booking-reminders',
--     '*/10 * * * *',
--     $$SELECT public.process_due_booking_reminders();$$
--   );

BEGIN;

DO $$
DECLARE
  booking_id_type text;
  booking_service_type text;
  service_id_type text;
BEGIN
  IF pg_catalog.to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.notifications does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.services does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'notifications'
      AND a.attname = 'appointment_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: public.notifications.appointment_at already exists.';
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO booking_id_type
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF booking_id_type IS NULL OR booking_id_type NOT IN ('bigint', 'integer') THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings.id is %; expected integer or bigint.',
      booking_id_type;
  END IF;

  PERFORM 1
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN ('user_id', 'service_id', 'booking_date', 'booking_time', 'status', 'updated_at', 'created_at')
  HAVING pg_catalog.count(*) = 7;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings is missing user_id, service_id, booking_date, booking_time, status, updated_at, or created_at.';
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO booking_service_type
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attname = 'service_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO service_id_type
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'services'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF booking_service_type IS NULL OR service_id_type IS NULL
     OR booking_service_type IS DISTINCT FROM service_id_type THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings.service_id (%) must match services.id (%).',
      booking_service_type,
      service_id_type;
  END IF;
END
$$;

ALTER TABLE public.notifications
  ADD COLUMN appointment_at timestamp with time zone;

COMMENT ON COLUMN public.notifications.appointment_at IS
  'Bangkok appointment instant for reminder rows. NULL for non-reminder types. Dedup key with booking_id and type.';

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'booking_created',
    'booking_confirmed',
    'booking_declined',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_reminder_24h',
    'booking_reminder_2h'
  ));

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_reminder_appointment_check
  CHECK (
    (
      type IN ('booking_reminder_24h', 'booking_reminder_2h')
      AND appointment_at IS NOT NULL
    )
    OR (
      type NOT IN ('booking_reminder_24h', 'booking_reminder_2h')
      AND appointment_at IS NULL
    )
  );

CREATE UNIQUE INDEX notifications_reminder_once_idx
  ON public.notifications (booking_id, type, appointment_at)
  WHERE type IN ('booking_reminder_24h', 'booking_reminder_2h');

CREATE FUNCTION public.process_due_booking_reminders()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted integer := 0;
  batch integer := 0;
BEGIN
  INSERT INTO public.notifications (
    recipient_id,
    booking_id,
    type,
    title,
    body,
    appointment_at
  )
  SELECT
    b.user_id,
    b.id::bigint,
    'booking_reminder_24h',
    'Appointment in 24 hours',
    COALESCE(NULLIF(pg_catalog.btrim(COALESCE(s.name, '')), ''), 'a service')
      || ' on '
      || pg_catalog.to_char(b.booking_date, 'YYYY-MM-DD')
      || ' at '
      || pg_catalog.to_char(b.booking_time, 'HH24:MI'),
    ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
  FROM public.bookings AS b
  LEFT JOIN public.services AS s ON s.id = b.service_id
  WHERE b.status = 'confirmed'
    AND b.user_id IS NOT NULL
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok') > pg_catalog.now()
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '24 hours' <= pg_catalog.now()
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '24 hours' > pg_catalog.now() - INTERVAL '1 hour'
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '24 hours' >= COALESCE(b.updated_at, b.created_at)
  ON CONFLICT (booking_id, type, appointment_at)
    WHERE type IN ('booking_reminder_24h', 'booking_reminder_2h')
  DO NOTHING;

  GET DIAGNOSTICS batch = ROW_COUNT;
  inserted := inserted + batch;

  INSERT INTO public.notifications (
    recipient_id,
    booking_id,
    type,
    title,
    body,
    appointment_at
  )
  SELECT
    b.user_id,
    b.id::bigint,
    'booking_reminder_2h',
    'Appointment in 2 hours',
    COALESCE(NULLIF(pg_catalog.btrim(COALESCE(s.name, '')), ''), 'a service')
      || ' on '
      || pg_catalog.to_char(b.booking_date, 'YYYY-MM-DD')
      || ' at '
      || pg_catalog.to_char(b.booking_time, 'HH24:MI'),
    ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
  FROM public.bookings AS b
  LEFT JOIN public.services AS s ON s.id = b.service_id
  WHERE b.status = 'confirmed'
    AND b.user_id IS NOT NULL
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok') > pg_catalog.now()
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '2 hours' <= pg_catalog.now()
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '2 hours' > pg_catalog.now() - INTERVAL '1 hour'
    AND ((b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Bangkok')
          - INTERVAL '2 hours' >= COALESCE(b.updated_at, b.created_at)
  ON CONFLICT (booking_id, type, appointment_at)
    WHERE type IN ('booking_reminder_24h', 'booking_reminder_2h')
  DO NOTHING;

  GET DIAGNOSTICS batch = ROW_COUNT;
  inserted := inserted + batch;

  RETURN inserted;
END;
$$;

COMMENT ON FUNCTION public.process_due_booking_reminders() IS
  'Internal. Inserts due 24h/2h customer reminder inbox rows for confirmed Bangkok appointments. Catch-up window is 1 hour. Idempotent per booking_id, type, and appointment instant. Not executable by clients. Does not delete inbox history.';

ALTER FUNCTION public.process_due_booking_reminders() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_due_booking_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_due_booking_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_due_booking_reminders() FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_due_booking_reminders() FROM authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'DELETE')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT') THEN
    RAISE EXCEPTION
      'Refusing to continue: notifications must stay SELECT-only for authenticated, no anon access.';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.process_due_booking_reminders()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.process_due_booking_reminders()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: process_due_booking_reminders must not be client-executable.';
  END IF;

  IF pg_catalog.to_regprocedure('public.confirm_owned_booking(bigint)') IS NULL
     OR pg_catalog.to_regprocedure('public.cancel_my_booking(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: booking RPCs disappeared during migration.';
  END IF;
END
$$;

COMMIT;
