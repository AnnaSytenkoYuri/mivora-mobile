-- Mivora: notification unread / mark-all / mark-by-booking (recipient only)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Does not:
--   Alter public.notifications columns, RLS, or SELECT-only grants
--   Change booking RPCs, status transitions, or enqueue triggers
--   Grant INSERT/UPDATE/DELETE on public.notifications
--
-- Adds SECURITY DEFINER RPCs that only touch read_at for auth.uid().

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.notifications does not exist.';
  END IF;

  IF pg_catalog.to_regprocedure('public.mark_my_notification_read(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.mark_my_notification_read(bigint) does not exist.';
  END IF;
END
$$;

CREATE FUNCTION public.mark_my_notification_unread(p_notification_id bigint)
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
  SET read_at = NULL
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

COMMENT ON FUNCTION public.mark_my_notification_unread(bigint) IS
  'Authenticated recipient clears read_at on one of their notifications. Empty if not found or not owner.';

ALTER FUNCTION public.mark_my_notification_unread(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_my_notification_unread(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notification_unread(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notification_unread(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_my_notification_unread(bigint) TO authenticated;

CREATE FUNCTION public.mark_my_notifications_read()
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
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND n.recipient_id = (SELECT auth.uid())
    AND n.read_at IS NULL
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

COMMENT ON FUNCTION public.mark_my_notifications_read() IS
  'Authenticated recipient marks all of their unread notifications read. Does not affect other users.';

ALTER FUNCTION public.mark_my_notifications_read() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_my_notifications_read() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notifications_read() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_notifications_read() FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_my_notifications_read() TO authenticated;

CREATE FUNCTION public.mark_my_booking_notifications_read(p_booking_id bigint)
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
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND n.recipient_id = (SELECT auth.uid())
    AND n.booking_id = p_booking_id
    AND n.read_at IS NULL
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

COMMENT ON FUNCTION public.mark_my_booking_notifications_read(bigint) IS
  'Authenticated recipient marks unread notifications for one booking. Empty if none or not owner. Does not change booking status.';

ALTER FUNCTION public.mark_my_booking_notifications_read(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_my_booking_notifications_read(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_booking_notifications_read(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_booking_notifications_read(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_my_booking_notifications_read(bigint) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'DELETE')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT') THEN
    RAISE EXCEPTION
      'Refusing to continue: notifications must stay SELECT-only for authenticated, no anon access.';
  END IF;

  IF has_function_privilege('anon', 'public.mark_my_notification_unread(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_my_notifications_read()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_my_booking_notifications_read(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Refusing to continue: anon must not change notification read state.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.mark_my_notification_unread(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mark_my_notifications_read()', 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       'public.mark_my_booking_notifications_read(bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Refusing to continue: authenticated missing EXECUTE on new mark-read RPCs.';
  END IF;
END
$$;

COMMIT;
