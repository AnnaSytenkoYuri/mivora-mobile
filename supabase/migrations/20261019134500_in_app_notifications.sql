-- Mivora Phase 7A step 1: in-app notifications (schema + generation)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already applied):
--   public.bookings, public.providers, public.services
--   create_my_booking / confirm_owned_booking / decline_owned_booking
--   cancel_my_booking / reschedule_my_booking
--
-- Does not:
--   Modify or reapply 20261018214500_published_business_integrity.sql
--   Change booking RPC signatures, status transitions, or occupancy rules
--   Grant clients INSERT/UPDATE/DELETE on public.notifications
--   Store customer names, email, or phone in title/body
--
-- Generation (same transaction as the booking write)
--   INSERT pending           → provider owner  booking_created
--   pending → confirmed      → customer        booking_confirmed
--   pending → declined       → customer        booking_declined
--   pending|confirmed → cancelled → provider owner  booking_cancelled
--   date/time change while pending|confirmed → provider owner  booking_rescheduled
--   completed: no notification
--   Recipient = actor (auth.uid()) is skipped (self-booking, self-confirm).
--   created/confirmed/declined/cancelled are unique per booking_id.
--   rescheduled may repeat (each successful slot change).
--
-- Clients cannot forge rows: no INSERT policy, no INSERT grant, enqueue RPC
-- is not GRANTed. Mark-read is the only authenticated write path.
-- Actor identity is not stored. Notification errors are trapped in the AFTER
-- trigger so they cannot abort a booking write that already passed validation.

BEGIN;

DO $$
DECLARE
  booking_id_type text;
  booking_user_type text;
  owner_type text;
BEGIN
  IF pg_catalog.to_regclass('public.notifications') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.notifications already exists.';
  END IF;

  IF pg_catalog.to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.bookings does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.services does not exist.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'bookings'
      AND a.attname IN (
        'id', 'user_id', 'provider_id', 'service_id',
        'booking_date', 'booking_time', 'status'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) <> 7 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.bookings is missing required columns.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'providers'
      AND a.attname IN ('id', 'owner_id', 'name')
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) <> 3 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.providers is missing id, owner_id, or name.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'services'
      AND a.attname = 'name'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: public.services.name is missing.';
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

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO booking_user_type
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'bookings'
    AND a.attname = 'user_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
  INTO owner_type
  FROM pg_catalog.pg_attribute AS a
  INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'providers'
    AND a.attname = 'owner_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF booking_user_type IS DISTINCT FROM 'uuid' OR owner_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION
      'Refusing to continue: bookings.user_id (%) and providers.owner_id (%) must be uuid.',
      booking_user_type,
      owner_type;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.confirm_owned_booking(bigint)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.decline_owned_booking(bigint)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.cancel_my_booking(bigint)'
     ) IS NULL
     OR (
       pg_catalog.to_regprocedure(
         'public.reschedule_my_booking(bigint, date, time without time zone)'
       ) IS NULL
       AND pg_catalog.to_regprocedure(
         'public.reschedule_my_booking(bigint, date, time)'
       ) IS NULL
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: required booking RPCs are missing.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id uuid NOT NULL,
  booking_id bigint NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT notifications_type_check
    CHECK (type IN (
      'booking_created',
      'booking_confirmed',
      'booking_declined',
      'booking_cancelled',
      'booking_rescheduled'
    )),
  CONSTRAINT notifications_title_check
    CHECK (pg_catalog.btrim(title) <> ''),
  CONSTRAINT notifications_body_check
    CHECK (pg_catalog.btrim(body) <> '')
);

COMMENT ON TABLE public.notifications IS
  'In-app inbox rows. Recipient-only SELECT. Inserts only from booking triggers.';

COMMENT ON COLUMN public.notifications.body IS
  'Service name and Asia/Bangkok civil date/time only. Never customer identity.';

CREATE INDEX notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX notifications_recipient_unread_idx
  ON public.notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE UNIQUE INDEX notifications_booking_type_once_idx
  ON public.notifications (booking_id, type)
  WHERE type IN (
    'booking_created',
    'booking_confirmed',
    'booking_declined',
    'booking_cancelled'
  );

ALTER TABLE public.notifications OWNER TO postgres;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notifications FROM PUBLIC;
REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE ALL ON TABLE public.notifications FROM authenticated;
REVOKE ALL ON SEQUENCE public.notifications_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.notifications_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.notifications_id_seq FROM authenticated;

GRANT SELECT ON TABLE public.notifications TO authenticated;

CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO authenticated
USING (recipient_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Internal enqueue (not callable by clients)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_booking_notification(
  p_recipient_id uuid,
  p_booking_id bigint,
  p_type text,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_recipient_id IS NULL
     OR p_booking_id IS NULL
     OR p_type IS NULL
     OR p_recipient_id IS NOT DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN;
  END IF;

  IF p_type = 'booking_rescheduled' THEN
    INSERT INTO public.notifications (
      recipient_id,
      booking_id,
      type,
      title,
      body
    )
    VALUES (
      p_recipient_id,
      p_booking_id,
      p_type,
      p_title,
      p_body
    );
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    recipient_id,
    booking_id,
    type,
    title,
    body
  )
  VALUES (
    p_recipient_id,
    p_booking_id,
    p_type,
    p_title,
    p_body
  )
  ON CONFLICT (booking_id, type)
  WHERE type IN (
    'booking_created',
    'booking_confirmed',
    'booking_declined',
    'booking_cancelled'
  )
  DO NOTHING;
EXCEPTION
  WHEN unique_violation THEN
    NULL;
END;
$$;

COMMENT ON FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) IS
  'Internal. Inserts one inbox row unless recipient is the current actor. Not executable by clients.';

ALTER FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_booking_notification(uuid, bigint, text, text, text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Booking trigger — ROW AFTER, no transition tables (INSERT OR UPDATE OF is valid)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.bookings_enqueue_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_provider_name text;
  v_service_name text;
  v_slot text;
BEGIN
  -- Inner subtransaction: a notification failure rolls back only inbox
  -- writes, not the booking row. BEFORE triggers and RPC RAISE still abort.
  BEGIN
    SELECT
      p.owner_id,
      NULLIF(pg_catalog.btrim(COALESCE(p.name, '')), '')
    INTO v_owner, v_provider_name
    FROM public.providers AS p
    WHERE p.id = NEW.provider_id;

    SELECT NULLIF(pg_catalog.btrim(COALESCE(s.name, '')), '')
    INTO v_service_name
    FROM public.services AS s
    WHERE s.id = NEW.service_id;

    v_service_name := COALESCE(v_service_name, 'a service');
    v_provider_name := COALESCE(v_provider_name, 'the business');
    v_slot :=
      pg_catalog.to_char(NEW.booking_date, 'YYYY-MM-DD')
      || ' at '
      || pg_catalog.to_char(NEW.booking_time, 'HH24:MI');

    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'pending' THEN
        PERFORM public.enqueue_booking_notification(
          v_owner,
          NEW.id::bigint,
          'booking_created',
          'New booking request',
          v_service_name || ' on ' || v_slot
        );
      END IF;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
        PERFORM public.enqueue_booking_notification(
          NEW.user_id,
          NEW.id::bigint,
          'booking_confirmed',
          'Booking confirmed',
          v_provider_name || ' confirmed ' || v_service_name || ' on ' || v_slot
        );
      ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
        PERFORM public.enqueue_booking_notification(
          NEW.user_id,
          NEW.id::bigint,
          'booking_declined',
          'Booking declined',
          v_provider_name || ' declined ' || v_service_name || ' on ' || v_slot
        );
      ELSIF OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled' THEN
        PERFORM public.enqueue_booking_notification(
          v_owner,
          NEW.id::bigint,
          'booking_cancelled',
          'Booking cancelled',
          v_service_name || ' on ' || v_slot || ' was cancelled'
        );
      END IF;
    ELSIF NEW.status IN ('pending', 'confirmed')
       AND (
         OLD.booking_date IS DISTINCT FROM NEW.booking_date
         OR OLD.booking_time IS DISTINCT FROM NEW.booking_time
       ) THEN
      PERFORM public.enqueue_booking_notification(
        v_owner,
        NEW.id::bigint,
        'booking_rescheduled',
        'Booking rescheduled',
        v_service_name || ' moved to ' || v_slot
      );
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'bookings_enqueue_notifications: % (%)', SQLERRM, SQLSTATE;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.bookings_enqueue_notifications() IS
  'AFTER ROW on bookings. Writes inbox rows; never changes booking columns. Traps notification errors so valid booking writes still commit.';

ALTER FUNCTION public.bookings_enqueue_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_enqueue_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bookings_enqueue_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bookings_enqueue_notifications() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bookings_enqueue_notifications() FROM authenticated;

DROP TRIGGER IF EXISTS bookings_enqueue_notifications ON public.bookings;

CREATE TRIGGER bookings_enqueue_notifications
AFTER INSERT OR UPDATE OF status, booking_date, booking_time
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.bookings_enqueue_notifications();

-- ---------------------------------------------------------------------------
-- Mark read — recipient only, read_at only
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.mark_my_notification_read(p_notification_id bigint)
RETURNS TABLE (
  id bigint,
  recipient_id uuid,
  booking_id bigint,
  type text,
  title text,
  body text,
  read_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.notifications AS n
  SET read_at = COALESCE(n.read_at, pg_catalog.now())
  WHERE n.id = p_notification_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND n.recipient_id = (SELECT auth.uid())
  RETURNING
    n.id,
    n.recipient_id,
    n.booking_id,
    n.type,
    n.title,
    n.body,
    n.read_at,
    n.created_at;
$$;

COMMENT ON FUNCTION public.mark_my_notification_read(bigint) IS
  'Authenticated recipient marks one of their notifications read. Empty if not found or not owner. Idempotent.';

ALTER FUNCTION public.mark_my_notification_read(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_my_notification_read(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notification_read(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notification_read(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_my_notification_read(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Privilege assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notifications'
    AND (
      cmd IN ('INSERT', 'UPDATE', 'DELETE', '*')
      OR (cmd = 'SELECT' AND policyname IS DISTINCT FROM 'notifications_select_own')
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: unexpected public.notifications policies: %',
      leftover;
  END IF;

  IF has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'DELETE')
     OR has_table_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'UPDATE')
     OR has_table_privilege('anon', 'public.notifications', 'DELETE')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT') THEN
    RAISE EXCEPTION
      'Refusing to continue: notifications must be SELECT-only for authenticated, no anon access.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.notifications', 'SELECT') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated missing SELECT on public.notifications.';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.enqueue_booking_notification(uuid, bigint, text, text, text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.enqueue_booking_notification(uuid, bigint, text, text, text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.bookings_enqueue_notifications()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.mark_my_notification_read(bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: notification enqueue/trigger must not be client-executable; anon must not mark read.';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.mark_my_notification_read(bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated missing EXECUTE on mark_my_notification_read.';
  END IF;

  IF pg_catalog.to_regprocedure('public.confirm_owned_booking(bigint)') IS NULL
     OR pg_catalog.to_regprocedure('public.cancel_my_booking(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: booking RPCs disappeared during migration.';
  END IF;
END
$$;

COMMIT;
