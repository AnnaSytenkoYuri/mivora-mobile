-- Mivora Phase 3B step 5A/5B: per-device remote push delivery outbox
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already applied on the live project):
--   public.notifications (event types + reminder types)
--   public.push_tokens, register_my_push_token / unregister_my_push_token
--   bookings_enqueue_notifications / enqueue_booking_notification
--
-- Does not:
--   Change booking RPCs, notification generation, or reminder cron
--   INSERT/backfill rows for notifications that already exist
--   Install pg_net, create Database Webhooks, or schedule a delivery worker
--   Grant clients any access to the outbox
--   Send Expo pushes (Edge Function comes later)
--
-- Source of truth
--   public.notifications remains the inbox. This outbox is delivery state only.
--   AFTER INSERT on notifications copies eligible rows onto push_deliveries.
--   booking_reminder_24h / booking_reminder_2h are never enqueued.
--
-- Per-device grain
--   One row per (notification_id, push_token_id) at enqueue time (tokens
--   currently registered to recipient_id). Unique on that pair.
--   Devices registered later do not receive this notification (no backfill).
--   Token DELETE sets push_token_id NULL.
--   pending rows, and sending rows whose lease has already expired, become
--   skipped and are never sent. A live lease is not skipped, so an in-flight
--   worker can still complete with its claim_nonce; it cannot be reclaimed.
--
-- Failure isolation
--   The enqueue trigger traps every exception. A failed outbox write cannot
--   abort the notification INSERT. Warnings log SQLSTATE only, never SQLERRM.
--
-- Leases and stale workers
--   Claim uses FOR UPDATE SKIP LOCKED and replaces claim_nonce on every lease.
--   complete_* updates only WHERE status = 'sending' AND claim_nonce matches.
--   After another worker claims, the previous nonce is gone, so a late
--   complete cannot overwrite sent / skipped / failed_permanent / a new lease.
--   complete does not require claimed_until > now(): if the lease clock
--   expired but nobody else claimed yet, the original worker may still finish.
--
-- Unavoidable Expo / database split
--   Expo Push Service has no send idempotency key. If a worker POSTs successfully
--   (ticket issued) and then complete_claimed_push_delivery fails or never runs,
--   the row stays sending until the lease expires and can be claimed again.
--   That device may receive a duplicate. The database records at most one
--   status=sent ticket (the worker that successfully completes). The earlier
--   Expo ticket is not stored. This is at-least-once delivery, not exactly-once.
--
-- Workers (not in this migration)
--   Future Edge Functions call claim / complete / record_receipt / forget
--   token as service_role. pg_cron is already available; do not attach a
--   delivery job here.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.notifications does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.push_tokens') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.push_tokens does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.push_deliveries') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.push_deliveries already exists.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.enqueue_booking_notification(uuid, bigint, text, text, text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('public.process_due_booking_reminders()') IS NULL
     OR pg_catalog.to_regprocedure('public.register_my_push_token(text, text)') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: notifications, reminders, or push-token RPCs are missing.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.push_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id bigint NOT NULL
    REFERENCES public.notifications (id) ON DELETE CASCADE,
  push_token_id uuid
    REFERENCES public.push_tokens (id) ON DELETE SET NULL,
  recipient_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  claimed_at timestamp with time zone,
  claimed_until timestamp with time zone,
  claim_nonce uuid,
  expo_ticket_id text,
  ticketed_at timestamp with time zone,
  receipt_status text,
  receipt_error_code text,
  receipt_checked_at timestamp with time zone,
  last_error_code text,
  last_error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT push_deliveries_type_check
    CHECK (type IN (
      'booking_created',
      'booking_confirmed',
      'booking_declined',
      'booking_cancelled',
      'booking_rescheduled'
    )),
  CONSTRAINT push_deliveries_status_check
    CHECK (status IN (
      'pending',
      'sending',
      'sent',
      'skipped',
      'failed_permanent'
    )),
  CONSTRAINT push_deliveries_attempt_check
    CHECK (attempt_count >= 0 AND max_attempts >= 1 AND attempt_count <= 32 AND max_attempts <= 32),
  CONSTRAINT push_deliveries_sent_ticket_check
    CHECK (
      (status = 'sent' AND expo_ticket_id IS NOT NULL AND pg_catalog.btrim(expo_ticket_id) <> '')
      OR (status <> 'sent')
    ),
  CONSTRAINT push_deliveries_receipt_status_check
    CHECK (receipt_status IS NULL OR receipt_status IN ('ok', 'error')),
  CONSTRAINT push_deliveries_error_message_len_check
    CHECK (last_error_message IS NULL OR pg_catalog.char_length(last_error_message) <= 500),
  CONSTRAINT push_deliveries_receipt_error_len_check
    CHECK (receipt_error_code IS NULL OR pg_catalog.char_length(receipt_error_code) <= 100),
  CONSTRAINT push_deliveries_last_error_code_len_check
    CHECK (last_error_code IS NULL OR pg_catalog.char_length(last_error_code) <= 100),
  CONSTRAINT push_deliveries_ticket_len_check
    CHECK (expo_ticket_id IS NULL OR pg_catalog.char_length(expo_ticket_id) <= 128),
  CONSTRAINT push_deliveries_notification_token_key
    UNIQUE (notification_id, push_token_id)
);

COMMENT ON TABLE public.push_deliveries IS
  'Per-device Expo push outbox. One row per (notification, registered token) at enqueue. Server-only. Inbox rows are independent. Delivery is at-least-once: an Expo success without a matching complete_* can be sent again after lease expiry.';

COMMENT ON COLUMN public.push_deliveries.push_token_id IS
  'FK to push_tokens. ON DELETE SET NULL. Pending or expired-lease rows with a NULL or foreign token are skipped and never sent. Live leases are left sending so the original claim_nonce can still complete.';

COMMENT ON COLUMN public.push_deliveries.status IS
  'pending=eligible; sending=leased; sent=Expo ticket stored (never reclaim); skipped=no usable token; failed_permanent=give up.';

COMMENT ON COLUMN public.push_deliveries.claim_nonce IS
  'Random per-lease id. complete_* applies only when status=sending AND nonce matches. A newer claim replaces the nonce, so a stale worker cannot overwrite newer results.';

COMMENT ON COLUMN public.push_deliveries.expo_ticket_id IS
  'Ticket id from the worker that successfully completed. Not an Expo send idempotency key. status=sent forbids another send from this outbox row.';

COMMENT ON COLUMN public.push_deliveries.last_error_message IS
  'Truncated worker error. Must not store Expo push tokens, SQLERRM, or authorization headers.';

CREATE INDEX push_deliveries_claim_idx
  ON public.push_deliveries (next_attempt_at, id)
  WHERE status IN ('pending', 'sending');

CREATE INDEX push_deliveries_ticket_idx
  ON public.push_deliveries (expo_ticket_id)
  WHERE expo_ticket_id IS NOT NULL;

ALTER TABLE public.push_deliveries OWNER TO postgres;

ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC;
REVOKE ALL ON TABLE public.push_deliveries FROM anon;
REVOKE ALL ON TABLE public.push_deliveries FROM authenticated;
REVOKE ALL ON TABLE public.push_deliveries FROM service_role;
REVOKE ALL ON SEQUENCE public.push_deliveries_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.push_deliveries_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.push_deliveries_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.push_deliveries_id_seq FROM service_role;

-- No policies: even service_role uses SECURITY DEFINER functions, not table DML.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.push_deliveries_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.push_deliveries_touch_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_deliveries_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_touch_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_touch_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_touch_updated_at() FROM service_role;

CREATE TRIGGER push_deliveries_touch_updated_at
BEFORE UPDATE ON public.push_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.push_deliveries_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Enqueue from notifications INSERT (eligible types only; trap all errors)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.notifications_enqueue_push_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.type IS NULL OR NEW.type NOT IN (
      'booking_created',
      'booking_confirmed',
      'booking_declined',
      'booking_cancelled',
      'booking_rescheduled'
    ) THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.push_deliveries (
      notification_id,
      push_token_id,
      recipient_id,
      type
    )
    SELECT
      NEW.id,
      t.id,
      NEW.recipient_id,
      NEW.type
    FROM public.push_tokens AS t
    WHERE t.user_id = NEW.recipient_id
    ON CONFLICT ON CONSTRAINT push_deliveries_notification_token_key DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      -- SQLSTATE only. SQLERRM can include values from the failing statement.
      RAISE WARNING 'notifications_enqueue_push_deliveries failed (%)', SQLSTATE;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.notifications_enqueue_push_deliveries() IS
  'AFTER INSERT on notifications. Enqueues one outbox row per current device for booking-event types. Traps errors so inbox INSERT still commits. Logs SQLSTATE only. Never enqueues reminder types. Does not backfill.';

ALTER FUNCTION public.notifications_enqueue_push_deliveries() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notifications_enqueue_push_deliveries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notifications_enqueue_push_deliveries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notifications_enqueue_push_deliveries() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notifications_enqueue_push_deliveries() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.notifications_enqueue_push_deliveries() FROM service_role;

CREATE TRIGGER notifications_enqueue_push_deliveries
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notifications_enqueue_push_deliveries();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.push_deliveries_trim_error(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_value, '')), p_max), '');
$$;

ALTER FUNCTION public.push_deliveries_trim_error(text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_deliveries_trim_error(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_trim_error(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_trim_error(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_trim_error(text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_trim_error(text, integer) FROM service_role;

CREATE FUNCTION public.push_deliveries_lease_expired(p_claimed_until timestamp with time zone)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_claimed_until IS NOT NULL AND p_claimed_until < pg_catalog.now();
$$;

ALTER FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.push_deliveries_lease_expired(timestamp with time zone) FROM service_role;

-- ---------------------------------------------------------------------------
-- Claim due rows (atomic lease, SKIP LOCKED)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.claim_due_push_deliveries(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  delivery_id bigint,
  notification_id bigint,
  push_token_id uuid,
  expo_push_token text,
  platform text,
  recipient_id uuid,
  type text,
  title text,
  body text,
  attempt_count integer,
  claim_nonce uuid,
  claimed_until timestamp with time zone
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_lease integer;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_lease := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600));

  -- Missing token: skip only queued work and expired leases. Do not skip a
  -- live sending lease (the worker may still complete with the original nonce).
  UPDATE public.push_deliveries AS d
  SET
    status = 'skipped',
    claimed_at = NULL,
    claimed_until = NULL,
    claim_nonce = NULL,
    last_error_code = 'token_missing',
    last_error_message = 'Push token is no longer registered on this device.'
  WHERE d.push_token_id IS NULL
    AND (
      d.status = 'pending'
      OR (
        d.status = 'sending'
        AND public.push_deliveries_lease_expired(d.claimed_until)
      )
    );

  -- Token exists but is not owned by the notification recipient (reassigned
  -- row should already have been deleted; this is a backstop). Same lease rule.
  UPDATE public.push_deliveries AS d
  SET
    status = 'skipped',
    claimed_at = NULL,
    claimed_until = NULL,
    claim_nonce = NULL,
    last_error_code = 'token_recipient_mismatch',
    last_error_message = 'Push token is not registered to this recipient.'
  WHERE d.push_token_id IS NOT NULL
    AND (
      d.status = 'pending'
      OR (
        d.status = 'sending'
        AND public.push_deliveries_lease_expired(d.claimed_until)
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.push_tokens AS t
      WHERE t.id = d.push_token_id
        AND t.user_id = d.recipient_id
    );

  -- Exhausted attempts after due pending or expired sending lease.
  UPDATE public.push_deliveries AS d
  SET
    status = 'failed_permanent',
    claimed_at = NULL,
    claimed_until = NULL,
    claim_nonce = NULL,
    last_error_code = COALESCE(d.last_error_code, 'max_attempts'),
    last_error_message = COALESCE(
      d.last_error_message,
      'Exceeded max push delivery attempts.'
    )
  WHERE d.attempt_count >= d.max_attempts
    AND (
      (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
      OR (
        d.status = 'sending'
        AND public.push_deliveries_lease_expired(d.claimed_until)
      )
    );

  RETURN QUERY
  WITH picked AS (
    SELECT d.id
    FROM public.push_deliveries AS d
    INNER JOIN public.push_tokens AS t
      ON t.id = d.push_token_id
     AND t.user_id = d.recipient_id
    INNER JOIN public.notifications AS n ON n.id = d.notification_id
    WHERE d.status IN ('pending', 'sending')
      AND d.attempt_count < d.max_attempts
      AND d.type IN (
        'booking_created',
        'booking_confirmed',
        'booking_declined',
        'booking_cancelled',
        'booking_rescheduled'
      )
      AND n.type = d.type
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
        OR (
          d.status = 'sending'
          AND public.push_deliveries_lease_expired(d.claimed_until)
        )
      )
    ORDER BY d.next_attempt_at ASC, d.id ASC
    LIMIT v_limit
    FOR UPDATE OF d SKIP LOCKED
  ),
  leased AS (
    UPDATE public.push_deliveries AS d
    SET
      status = 'sending',
      attempt_count = d.attempt_count + 1,
      claimed_at = pg_catalog.now(),
      claimed_until = pg_catalog.now() + pg_catalog.make_interval(secs => v_lease),
      claim_nonce = pg_catalog.gen_random_uuid(),
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_lease)
    FROM picked
    WHERE d.id = picked.id
      AND d.status IN ('pending', 'sending')
      AND d.push_token_id IS NOT NULL
    RETURNING
      d.id,
      d.notification_id,
      d.push_token_id,
      d.recipient_id,
      d.type,
      d.attempt_count,
      d.claim_nonce,
      d.claimed_until
  )
  SELECT
    l.id,
    l.notification_id,
    l.push_token_id,
    t.expo_push_token,
    t.platform,
    l.recipient_id,
    l.type,
    n.title,
    n.body,
    l.attempt_count,
    l.claim_nonce,
    l.claimed_until
  FROM leased AS l
  INNER JOIN public.push_tokens AS t
    ON t.id = l.push_token_id
   AND t.user_id = l.recipient_id
  INNER JOIN public.notifications AS n ON n.id = l.notification_id;
END;
$$;

COMMENT ON FUNCTION public.claim_due_push_deliveries(integer, integer) IS
  'Leases due per-device outbox rows. SKIP LOCKED. Replaces claim_nonce. status=sent is never claimed. Live sending leases are not skipped on token delete. Expired sending leases are reclaimable. Duplicate Expo sends are possible only if a prior POST succeeded and complete_* did not.';

ALTER FUNCTION public.claim_due_push_deliveries(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_due_push_deliveries(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_deliveries(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_deliveries(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_deliveries(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_push_deliveries(integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Complete a claimed send
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.complete_claimed_push_delivery(
  p_delivery_id bigint,
  p_claim_nonce uuid,
  p_outcome text,
  p_expo_ticket_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outcome text;
  v_ticket text;
  v_code text;
  v_message text;
  v_updated integer;
BEGIN
  IF p_delivery_id IS NULL OR p_claim_nonce IS NULL THEN
    RETURN false;
  END IF;

  v_outcome := pg_catalog.btrim(COALESCE(p_outcome, ''));
  IF v_outcome NOT IN ('sent', 'retryable', 'permanent', 'skipped') THEN
    RAISE EXCEPTION 'complete_claimed_push_delivery: invalid outcome'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ticket := public.push_deliveries_trim_error(p_expo_ticket_id, 128);
  v_code := public.push_deliveries_trim_error(p_error_code, 100);
  v_message := public.push_deliveries_trim_error(p_error_message, 500);

  IF v_outcome = 'sent' AND v_ticket IS NULL THEN
    RAISE EXCEPTION 'complete_claimed_push_delivery: sent requires expo ticket id'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- All branches require status=sending AND claim_nonce. A newer lease or a
  -- terminal status makes this a no-op (returns false).
  IF v_outcome = 'sent' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'sent',
      expo_ticket_id = v_ticket,
      ticketed_at = pg_catalog.now(),
      claimed_at = NULL,
      claimed_until = NULL,
      claim_nonce = NULL,
      last_error_code = NULL,
      last_error_message = NULL
    WHERE d.id = p_delivery_id
      AND d.claim_nonce = p_claim_nonce
      AND d.status = 'sending'
      AND d.expo_ticket_id IS NULL;
  ELSIF v_outcome = 'skipped' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'skipped',
      claimed_at = NULL,
      claimed_until = NULL,
      claim_nonce = NULL,
      last_error_code = COALESCE(v_code, 'skipped'),
      last_error_message = v_message
    WHERE d.id = p_delivery_id
      AND d.claim_nonce = p_claim_nonce
      AND d.status = 'sending';
  ELSIF v_outcome = 'permanent' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'failed_permanent',
      claimed_at = NULL,
      claimed_until = NULL,
      claim_nonce = NULL,
      last_error_code = COALESCE(v_code, 'permanent'),
      last_error_message = v_message
    WHERE d.id = p_delivery_id
      AND d.claim_nonce = p_claim_nonce
      AND d.status = 'sending';
  ELSE
    UPDATE public.push_deliveries AS d
    SET
      status = CASE
        WHEN d.attempt_count >= d.max_attempts THEN 'failed_permanent'
        ELSE 'pending'
      END,
      claimed_at = NULL,
      claimed_until = NULL,
      claim_nonce = NULL,
      last_error_code = COALESCE(v_code, 'retryable'),
      last_error_message = v_message,
      next_attempt_at = pg_catalog.now()
        + pg_catalog.make_interval(
          secs => LEAST(
            3600,
            (
              60::numeric
              * pg_catalog.power(
                2::numeric,
                LEAST(GREATEST(d.attempt_count - 1, 0), 10)::numeric
              )
            )::integer
          )
        )
    WHERE d.id = p_delivery_id
      AND d.claim_nonce = p_claim_nonce
      AND d.status = 'sending';
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) IS
  'Finishes a leased delivery only when status=sending and claim_nonce matches. Stale workers cannot overwrite a newer lease or status=sent. If Expo accepted a send and this function never runs, another worker may send again after lease expiry (unavoidable at-least-once).';

ALTER FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Receipts (after Expo getReceipts; does not re-queue a successful ticket)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.record_push_delivery_receipt(
  p_delivery_id bigint,
  p_expo_ticket_id text,
  p_receipt_status text,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_ticket text;
  v_code text;
  v_updated integer;
BEGIN
  v_ticket := public.push_deliveries_trim_error(p_expo_ticket_id, 128);
  v_status := pg_catalog.btrim(COALESCE(p_receipt_status, ''));
  v_code := public.push_deliveries_trim_error(p_error_code, 100);

  IF v_ticket IS NULL OR p_delivery_id IS NULL OR v_status NOT IN ('ok', 'error') THEN
    RETURN false;
  END IF;

  IF v_status = 'error' AND v_code IS NULL THEN
    RETURN false;
  END IF;

  -- First receipt wins. Never moves status off sent, so receipts cannot retry.
  UPDATE public.push_deliveries AS d
  SET
    receipt_status = v_status,
    receipt_error_code = CASE WHEN v_status = 'error' THEN v_code ELSE NULL END,
    receipt_checked_at = pg_catalog.now()
  WHERE d.id = p_delivery_id
    AND d.status = 'sent'
    AND d.expo_ticket_id = v_ticket
    AND d.receipt_checked_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) IS
  'Stores the first Expo push receipt for a status=sent row with a matching ticket. Never re-queues. DeviceNotRegistered deletion requires forget_unregistered_push_token after this succeeds.';

ALTER FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_push_delivery_receipt(bigint, text, text, text) TO service_role;

CREATE FUNCTION public.forget_unregistered_push_token(
  p_delivery_id bigint,
  p_push_token_id uuid,
  p_expo_ticket_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket text;
  v_deleted integer;
BEGIN
  v_ticket := public.push_deliveries_trim_error(p_expo_ticket_id, 128);

  IF p_delivery_id IS NULL OR p_push_token_id IS NULL OR v_ticket IS NULL THEN
    RETURN false;
  END IF;

  -- Delete only the token still attached to this sent delivery, owned by the
  -- same recipient, after a DeviceNotRegistered receipt for this ticket.
  -- Re-register/reassign deletes the old push_tokens row (new uuid). This
  -- delivery then has push_token_id NULL and the DELETE matches zero rows.
  DELETE FROM public.push_tokens AS t
  USING public.push_deliveries AS d
  WHERE d.id = p_delivery_id
    AND d.status = 'sent'
    AND d.expo_ticket_id = v_ticket
    AND d.receipt_status = 'error'
    AND d.receipt_error_code = 'DeviceNotRegistered'
    AND d.receipt_checked_at IS NOT NULL
    AND d.push_token_id IS NOT NULL
    AND d.push_token_id = p_push_token_id
    AND t.id = d.push_token_id
    AND t.id = p_push_token_id
    AND t.user_id = d.recipient_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) IS
  'Deletes one push_tokens row only when a matching sent delivery has this ticket, this token id, recipient ownership, and a recorded DeviceNotRegistered receipt. Does not delete by token uuid alone. Other devices are untouched. Pending deliveries for a deleted token SET NULL and are skipped.';

ALTER FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forget_unregistered_push_token(bigint, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Privilege assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  leftover text;
  client_execute text;
  missing text;
  role_name text;
  fn record;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname, cmd)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'push_deliveries';

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.push_deliveries must have no RLS policies (got %).',
      leftover;
  END IF;

  IF has_table_privilege('anon', 'public.push_deliveries', 'SELECT')
     OR has_table_privilege('anon', 'public.push_deliveries', 'INSERT')
     OR has_table_privilege('anon', 'public.push_deliveries', 'UPDATE')
     OR has_table_privilege('anon', 'public.push_deliveries', 'DELETE')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'DELETE')
     OR has_table_privilege('service_role', 'public.push_deliveries', 'SELECT')
     OR has_table_privilege('service_role', 'public.push_deliveries', 'INSERT')
     OR has_table_privilege('service_role', 'public.push_deliveries', 'UPDATE')
     OR has_table_privilege('service_role', 'public.push_deliveries', 'DELETE') THEN
    RAISE EXCEPTION
      'Refusing to continue: push_deliveries must not be readable or writable by anon, authenticated, or service_role table DML.';
  END IF;

  SELECT string_agg(expected.proname, ', ' ORDER BY expected.proname)
  INTO missing
  FROM (
    VALUES
      ('push_deliveries_touch_updated_at'),
      ('notifications_enqueue_push_deliveries'),
      ('push_deliveries_trim_error'),
      ('push_deliveries_lease_expired'),
      ('claim_due_push_deliveries'),
      ('complete_claimed_push_delivery'),
      ('record_push_delivery_receipt'),
      ('forget_unregistered_push_token')
  ) AS expected(proname)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.proname
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to continue: missing function(s) %.', missing;
  END IF;

  FOR fn IN
    SELECT
      p.oid,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'push_deliveries_touch_updated_at',
        'notifications_enqueue_push_deliveries',
        'push_deliveries_trim_error',
        'push_deliveries_lease_expired',
        'claim_due_push_deliveries',
        'complete_claimed_push_delivery',
        'record_push_delivery_receipt',
        'forget_unregistered_push_token'
      )
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF has_function_privilege(role_name, fn.oid, 'EXECUTE') THEN
        client_execute :=
          COALESCE(client_execute || ', ', '')
          || role_name || ' '
          || fn.proname || '(' || fn.args || ')';
      END IF;
    END LOOP;
  END LOOP;

  IF client_execute IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: clients must not execute push delivery functions: %',
      client_execute;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'push_deliveries_touch_updated_at',
        'notifications_enqueue_push_deliveries',
        'push_deliveries_trim_error',
        'push_deliveries_lease_expired'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: service_role must not EXECUTE trigger/helper functions.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_due_push_deliveries',
        'complete_claimed_push_delivery',
        'record_push_delivery_receipt',
        'forget_unregistered_push_token'
      )
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'Refusing to continue: service_role missing EXECUTE on push delivery worker functions.';
  END IF;

  IF has_table_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.push_tokens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.push_tokens', 'INSERT') THEN
    RAISE EXCEPTION
      'Refusing to continue: notifications/push_tokens client INSERT grants changed.';
  END IF;

  IF pg_catalog.to_regprocedure('public.process_due_booking_reminders()') IS NULL
     OR pg_catalog.to_regprocedure('public.confirm_owned_booking(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: booking reminder or confirm RPC disappeared.';
  END IF;
END
$$;

COMMIT;
