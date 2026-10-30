-- Phase 3B Step 7C verification — NOT a migration.
-- DO NOT run until 20261028200000_list_sent_push_deliveries_awaiting_receipts.sql
-- has been applied. DO NOT run this file without wrapping Part C in a
-- transaction that ROLLBACKs.
--
-- Safety
--   Parts A–B are catalog / exception checks only.
--   Part C inserts throwaway notifications + push_deliveries, then ROLLBACKs.
--   Never UPDATE or DELETE existing outbox rows.
--   Does not SELECT expo_push_token, recipient_id, title, or body from results.
--   Does not EXECUTE claim/complete/send RPCs.
--
-- Run as postgres / supabase_admin in the SQL editor.

-- =============================================================================
-- Part A — permissions, signature, index (read-only catalog)
-- =============================================================================

SELECT
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
  pg_catalog.pg_get_function_result(p.oid) AS result,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS config
FROM pg_catalog.pg_proc AS p
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'list_sent_push_deliveries_awaiting_receipts';

SELECT
  has_function_privilege(
    'anon',
    'public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer)',
    'EXECUTE'
  ) AS anon_execute,
  has_function_privilege(
    'authenticated',
    'public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer)',
    'EXECUTE'
  ) AS authenticated_execute,
  has_function_privilege(
    'service_role',
    'public.list_sent_push_deliveries_awaiting_receipts(integer, integer, integer)',
    'EXECUTE'
  ) AS service_role_execute,
  has_table_privilege('anon', 'public.push_deliveries', 'SELECT') AS anon_select,
  has_table_privilege('authenticated', 'public.push_deliveries', 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', 'public.push_deliveries', 'SELECT') AS service_role_select;

SELECT
  c.relname AS index_name,
  pg_catalog.pg_get_indexdef(c.oid) AS index_def
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'push_deliveries_awaiting_receipt_idx';

-- Expected:
--   result = TABLE(delivery_id bigint, expo_ticket_id text, push_token_id uuid)
--   security_definer = true, volatility = s (STABLE), search_path empty
--   anon/authenticated execute = false, service_role execute = true
--   all table SELECT = false
--   partial index on (ticketed_at, id) WHERE sent / unchecked / ticket present

-- =============================================================================
-- Part B — invalid arguments
-- =============================================================================

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.list_sent_push_deliveries_awaiting_receipts(0, 900, 86400);
    RAISE EXCEPTION 'expected invalid limit 0';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  BEGIN
    PERFORM * FROM public.list_sent_push_deliveries_awaiting_receipts(1001, 900, 86400);
    RAISE EXCEPTION 'expected invalid limit 1001';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  BEGIN
    PERFORM * FROM public.list_sent_push_deliveries_awaiting_receipts(10, -1, 86400);
    RAISE EXCEPTION 'expected invalid min age';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  BEGIN
    PERFORM * FROM public.list_sent_push_deliveries_awaiting_receipts(10, 900, 30);
    RAISE EXCEPTION 'expected invalid max age';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  BEGIN
    PERFORM * FROM public.list_sent_push_deliveries_awaiting_receipts(10, 3600, 900);
    RAISE EXCEPTION 'expected inverted window';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  RAISE NOTICE 'Part B invalid-argument checks passed.';
END
$$;

-- =============================================================================
-- Part C — filtering (ROLLBACK)
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  recipient uuid;
  notification_id bigint;
  included_id bigint;
  too_young_id bigint;
  too_old_id bigint;
  receipted_id bigint;
  pending_id bigint;
  listed bigint[];
  listed_tickets text[];
BEGIN
  SELECT u.id
  INTO recipient
  FROM auth.users AS u
  ORDER BY u.created_at
  LIMIT 1;

  IF recipient IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for Part C. The script does not create users.';
  END IF;

  INSERT INTO public.notifications (recipient_id, booking_id, type, title, body)
  VALUES (
    recipient,
    0,
    'booking_rescheduled',
    'ZZ7C verify',
    'Verification row. Rollback only.'
  )
  RETURNING id INTO notification_id;

  INSERT INTO public.push_deliveries (
    notification_id, push_token_id, recipient_id, type, status,
    expo_ticket_id, ticketed_at, receipt_checked_at, attempt_count
  )
  VALUES
    (
      notification_id, NULL, recipient, 'booking_rescheduled', 'sent',
      'zz7cverify-included', (pg_catalog.now() - interval '20 minutes'), NULL, 1
    ),
    (
      notification_id, NULL, recipient, 'booking_rescheduled', 'sent',
      'zz7cverify-young', (pg_catalog.now() - interval '1 minute'), NULL, 1
    ),
    (
      notification_id, NULL, recipient, 'booking_rescheduled', 'sent',
      'zz7cverify-old', (pg_catalog.now() - interval '2 days'), NULL, 1
    ),
    (
      notification_id, NULL, recipient, 'booking_rescheduled', 'sent',
      'zz7cverify-receipted', (pg_catalog.now() - interval '20 minutes'),
      pg_catalog.now(), 1
    ),
    (
      notification_id, NULL, recipient, 'booking_rescheduled', 'pending',
      NULL, NULL, NULL, 0
    )
  RETURNING id INTO included_id;
  -- RETURNING INTO on multi-row INSERT keeps the last row. Look up by ticket.

  SELECT d.id INTO included_id
  FROM public.push_deliveries AS d
  WHERE d.expo_ticket_id = 'zz7cverify-included';

  SELECT d.id INTO too_young_id
  FROM public.push_deliveries AS d
  WHERE d.expo_ticket_id = 'zz7cverify-young';

  SELECT d.id INTO too_old_id
  FROM public.push_deliveries AS d
  WHERE d.expo_ticket_id = 'zz7cverify-old';

  SELECT d.id INTO receipted_id
  FROM public.push_deliveries AS d
  WHERE d.expo_ticket_id = 'zz7cverify-receipted';

  SELECT d.id INTO pending_id
  FROM public.push_deliveries AS d
  WHERE d.notification_id = notification_id
    AND d.status = 'pending'
  LIMIT 1;

  IF included_id IS NULL OR too_young_id IS NULL OR too_old_id IS NULL
     OR receipted_id IS NULL OR pending_id IS NULL THEN
    RAISE EXCEPTION 'Part C fixture rows were not inserted.';
  END IF;

  SELECT
    coalesce(array_agg(l.delivery_id ORDER BY l.delivery_id), ARRAY[]::bigint[]),
    coalesce(array_agg(l.expo_ticket_id ORDER BY l.delivery_id), ARRAY[]::text[])
  INTO listed, listed_tickets
  FROM public.list_sent_push_deliveries_awaiting_receipts(100, 900, 86400) AS l
  WHERE l.expo_ticket_id LIKE 'zz7cverify-%';

  IF listed <> ARRAY[included_id] OR listed_tickets <> ARRAY['zz7cverify-included'] THEN
    RAISE EXCEPTION
      'Part C filter mismatch: got delivery_ids %, tickets %',
      listed,
      listed_tickets;
  END IF;

  IF exists (
    SELECT 1
    FROM public.list_sent_push_deliveries_awaiting_receipts(100, 900, 86400) AS l
    WHERE l.expo_ticket_id IN (
      'zz7cverify-young',
      'zz7cverify-old',
      'zz7cverify-receipted'
    )
  ) THEN
    RAISE EXCEPTION 'Part C leaked a row that should be excluded.';
  END IF;

  RAISE NOTICE 'Part C filtering checks passed (included %).', included_id;
END
$$;

ROLLBACK;
