-- Mivora Phase 3B step 7C: read-only RPC to list sent push deliveries
-- awaiting Expo receipts.
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already applied on the live project):
--   public.push_deliveries
--   public.claim_due_push_deliveries
--   public.complete_claimed_push_delivery
--   public.record_push_delivery_receipt
--   public.forget_unregistered_push_token
--
-- Does not:
--   Change booking RPCs, reminder cron, push token registration, or
--   notification enqueue triggers
--   Grant table DML on push_deliveries
--   Call Expo or mutate outbox rows
--
-- Age window uses ticketed_at (set when status becomes sent). There is no
-- sent_at column.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.push_deliveries') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.push_deliveries does not exist.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.record_push_delivery_receipt(bigint, text, text, text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.forget_unregistered_push_token(bigint, uuid, text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: receipt worker RPCs are missing.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: list_sent_push_deliveries_awaiting_receipts already exists.';
  END IF;
END
$$;

-- Partial index for the awaiting-receipt scan. Existing indexes are
-- claim (pending/sending) and ticket id lookup, which do not cover
-- status=sent AND receipt_checked_at IS NULL ordered by ticketed_at.
CREATE INDEX push_deliveries_awaiting_receipt_idx
  ON public.push_deliveries (ticketed_at ASC, id ASC)
  WHERE status = 'sent'
    AND receipt_checked_at IS NULL
    AND expo_ticket_id IS NOT NULL;

COMMENT ON INDEX public.push_deliveries_awaiting_receipt_idx IS
  'Sent rows still waiting for an Expo receipt, ordered for list_sent_push_deliveries_awaiting_receipts.';

CREATE FUNCTION public.list_sent_push_deliveries_awaiting_receipts(
  p_limit integer DEFAULT 100,
  p_min_age_seconds integer DEFAULT 900,
  p_max_age_seconds integer DEFAULT 86400
)
RETURNS TABLE (
  delivery_id bigint,
  expo_ticket_id text,
  push_token_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_min_age integer;
  v_max_age integer;
BEGIN
  v_limit := COALESCE(p_limit, 100);
  v_min_age := COALESCE(p_min_age_seconds, 900);
  v_max_age := COALESCE(p_max_age_seconds, 86400);

  IF v_limit < 1 OR v_limit > 1000 THEN
    RAISE EXCEPTION 'list_sent_push_deliveries_awaiting_receipts: invalid limit'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_min_age < 0 OR v_min_age > 86400 THEN
    RAISE EXCEPTION 'list_sent_push_deliveries_awaiting_receipts: invalid min age'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_max_age < 60 OR v_max_age > 172800 THEN
    RAISE EXCEPTION 'list_sent_push_deliveries_awaiting_receipts: invalid max age'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_min_age > v_max_age THEN
    RAISE EXCEPTION 'list_sent_push_deliveries_awaiting_receipts: inverted age window'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.expo_ticket_id,
    d.push_token_id
  FROM public.push_deliveries AS d
  WHERE d.status = 'sent'
    AND d.expo_ticket_id IS NOT NULL
    AND pg_catalog.btrim(d.expo_ticket_id) <> ''
    AND d.receipt_checked_at IS NULL
    AND d.ticketed_at IS NOT NULL
    AND d.ticketed_at <= (pg_catalog.now() - pg_catalog.make_interval(secs => v_min_age))
    AND d.ticketed_at >= (pg_catalog.now() - pg_catalog.make_interval(secs => v_max_age))
  ORDER BY d.ticketed_at ASC, d.id ASC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) IS
  'Read-only. Lists sent outbox rows whose Expo ticket is old enough for getReceipts and still unchecked. Returns delivery_id, ticket id, and push_token_id only. No tokens, user ids, or notification text. service_role only.';

ALTER FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer) TO service_role;

DO $$
DECLARE
  leftover text;
  client_execute text;
  role_name text;
  fn_oid oid;
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

  fn_oid := pg_catalog.to_regprocedure(
    'public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer)'
  );

  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: list RPC missing after CREATE.';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_function_privilege(role_name, fn_oid, 'EXECUTE') THEN
      client_execute :=
        COALESCE(client_execute || ', ', '')
        || role_name || ' list_sent_push_deliveries_awaiting_receipts';
    END IF;
  END LOOP;

  IF client_execute IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: clients must not execute the receipt list RPC: %',
      client_execute;
  END IF;

  IF NOT has_function_privilege('service_role', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Refusing to continue: service_role missing EXECUTE on list_sent_push_deliveries_awaiting_receipts.';
  END IF;

  IF pg_catalog.to_regprocedure('public.claim_due_push_deliveries(integer, integer)') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.complete_claimed_push_delivery(bigint, uuid, text, text, text, text)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.record_push_delivery_receipt(bigint, text, text, text)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.forget_unregistered_push_token(bigint, uuid, text)'
        ) IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: push delivery or receipt worker RPC disappeared.';
  END IF;
END
$$;

COMMIT;
