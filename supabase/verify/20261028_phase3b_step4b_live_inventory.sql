-- Mivora Phase 3B Step 4B — live Supabase inventory
-- NOT a migration. Do not put this in supabase/migrations.
-- READ ONLY. Do not execute from the app or CI.
--
-- Purpose
--   Confirm deployed notifications, push_tokens, reminder processor, pg_cron,
--   pg_net/webhooks, and whether any push-delivery objects already exist.
--
-- Safety
--   SELECT against pg_catalog / information_schema, plus aggregate counts.
--   No INSERT/UPDATE/DELETE/CREATE/ALTER/DROP.
--   Does not SELECT notification title/body, recipient_id, booking_id,
--   expo_push_token, user_id, Vault secrets, or webhook headers/URLs.
--   Does not EXECUTE process_due_booking_reminders or any delivery function.
--   Does not call pg_get_triggerdef / pg_get_functiondef (webhook triggers
--   can embed Authorization headers and URLs in those strings).
--
-- How to run
--   1. Open the live project's Supabase Dashboard → SQL Editor.
--   2. Paste this whole file (or run Part A, then only the optional parts
--      whose existence queries returned true).
--   3. Run as a role that can read catalogs (Dashboard SQL Editor / postgres).
--   4. Copy the result grids. Do not export cron.command, trigger definitions,
--      or net.http_request_queue payloads if you add ad-hoc queries.
--
-- Optional schemas
--   PostgreSQL parses relation names at statement start. Queries against
--   cron.job, net.*, and vault.* will ERROR if that schema is missing.
--   Part A is always safe. Parts B–D say when to skip them.

-- =============================================================================
-- Part A — always safe (pg_catalog / information_schema / public aggregates)
-- =============================================================================

-- A1. Installed extensions (pg_cron, pg_net, vault, http, pgmq, …)
SELECT
  e.extname AS extension_name,
  e.extversion AS extension_version,
  n.nspname AS extension_schema
FROM pg_catalog.pg_extension AS e
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
ORDER BY e.extname;

-- A2. Optional schemas used by cron, pg_net, Vault, and Edge Function webhooks
SELECT
  n.nspname AS schema_name,
  TRUE AS present
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname IN (
  'cron',
  'net',
  'vault',
  'supabase_functions',
  'pgmq',
  'extensions'
)
ORDER BY n.nspname;

-- A3. Optional relations (jobs, request queue, vault tables) — names only
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('cron', 'net', 'vault', 'supabase_functions', 'pgmq')
  AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
  AND c.relname IN (
    'job',
    'job_run_details',
    'http_request_queue',
    '_http_response',
    'secrets',
    'decrypted_secrets',
    'hooks',
    'meta'
  )
ORDER BY n.nspname, c.relname;

-- A4. public.notifications / public.push_tokens / possible delivery tables exist?
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
FROM pg_catalog.pg_class AS c
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
ORDER BY c.relname;

-- A5. Columns on those tables (names/types only; no values)
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  a.attidentity AS identity,
  a.attnum AS ordinal
FROM pg_catalog.pg_attribute AS a
INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- A6. Table check / unique / FK constraints (definitions contain types, not rows)
SELECT
  c.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS constraint_def
FROM pg_catalog.pg_constraint AS con
INNER JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
ORDER BY c.relname, con.contype, con.conname;

-- A7. Indexes (index expressions only; no table data)
SELECT
  c.relname AS table_name,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  ix.indisprimary AS is_primary,
  pg_catalog.pg_get_indexdef(ix.indexrelid) AS index_def
FROM pg_catalog.pg_index AS ix
INNER JOIN pg_catalog.pg_class AS c ON c.oid = ix.indrelid
INNER JOIN pg_catalog.pg_class AS i ON i.oid = ix.indexrelid
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
ORDER BY c.relname, i.relname;

-- A8. RLS policies (predicate SQL, not row values)
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
ORDER BY tablename, policyname, cmd;

-- A9. Table privileges for anon / authenticated / public (no service_role dump of secrets)
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN (
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts',
    'push_tickets',
    'push_receipts'
  )
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- A10. Notification-related and push-related functions (identity only; no source)
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner
FROM pg_catalog.pg_proc AS p
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'cron', 'net', 'supabase_functions')
  AND (
    p.proname ILIKE '%notification%'
    OR p.proname ILIKE '%push%'
    OR p.proname ILIKE '%remind%'
    OR p.proname ILIKE '%deliver%'
    OR p.proname IN (
      'http_request',
      'http_post',
      'http_get',
      'schedule',
      'unschedule'
    )
  )
ORDER BY n.nspname, p.proname, 3;

-- A11. process_due_booking_reminders() exists? Client EXECUTE?
SELECT
  'public.process_due_booking_reminders()' AS signature,
  pg_catalog.to_regprocedure('public.process_due_booking_reminders()') IS NOT NULL
    AS procedure_exists,
  COALESCE(
    has_function_privilege(
      'anon',
      'public.process_due_booking_reminders()',
      'EXECUTE'
    ),
    false
  ) AS anon_execute,
  COALESCE(
    has_function_privilege(
      'authenticated',
      'public.process_due_booking_reminders()',
      'EXECUTE'
    ),
    false
  ) AS authenticated_execute
WHERE pg_catalog.to_regprocedure('public.process_due_booking_reminders()') IS NOT NULL

UNION ALL

SELECT
  'public.process_due_booking_reminders()' AS signature,
  false AS procedure_exists,
  false AS anon_execute,
  false AS authenticated_execute
WHERE pg_catalog.to_regprocedure('public.process_due_booking_reminders()') IS NULL;

-- A12. Expected push-token RPCs exist? Client EXECUTE?
SELECT
  signature,
  pg_catalog.to_regprocedure(signature) IS NOT NULL AS procedure_exists,
  CASE
    WHEN pg_catalog.to_regprocedure(signature) IS NULL THEN false
    ELSE has_function_privilege('anon', signature, 'EXECUTE')
  END AS anon_execute,
  CASE
    WHEN pg_catalog.to_regprocedure(signature) IS NULL THEN false
    ELSE has_function_privilege('authenticated', signature, 'EXECUTE')
  END AS authenticated_execute
FROM (
  VALUES
    ('public.register_my_push_token(text, text)'),
    ('public.unregister_my_push_token(text)'),
    ('public.enqueue_booking_notification(uuid, bigint, text, text, text)'),
    ('public.bookings_enqueue_notifications()'),
    ('public.mark_my_notification_read(bigint)'),
    ('public.mark_my_notification_unread(bigint)'),
    ('public.mark_my_notifications_read()'),
    ('public.mark_my_booking_notifications_read(bigint)')
) AS expected(signature)
ORDER BY signature;

-- A13. Triggers on bookings / notifications / push_tokens
--      Names and enabled state only — not pg_get_triggerdef (may contain webhook secrets).
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  p.proname AS function_name,
  pn.nspname AS function_schema,
  t.tgenabled AS enabled,
  t.tgtype
FROM pg_catalog.pg_trigger AS t
INNER JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
INNER JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
INNER JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname IN (
    'bookings',
    'notifications',
    'push_tokens',
    'push_delivery_jobs',
    'push_delivery_attempts'
  )
ORDER BY c.relname, t.tgname;

-- A14. Any public trigger that calls supabase_functions.http_request or net.http_*
--      (Database Webhooks). Names only.
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  t.tgenabled AS enabled
FROM pg_catalog.pg_trigger AS t
INNER JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
INNER JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
INNER JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND (
    (pn.nspname = 'supabase_functions' AND p.proname = 'http_request')
    OR (pn.nspname = 'net' AND p.proname IN ('http_post', 'http_get', 'http_delete'))
  )
ORDER BY n.nspname, c.relname, t.tgname;

-- A15. Notification volume by type — skip if A4 did not list public.notifications
--      Aggregates only: no title, body, recipient, or booking id.
SELECT
  type,
  pg_catalog.count(*)::integer AS row_count
FROM public.notifications
GROUP BY type
ORDER BY type;

-- A16. Token volume by platform — skip if A4 did not list public.push_tokens
--      Never select expo_push_token or user_id.
SELECT
  platform,
  pg_catalog.count(*)::integer AS row_count
FROM public.push_tokens
GROUP BY platform
ORDER BY platform;

-- =============================================================================
-- Part B — pg_cron  (SKIP this whole part if A2 has no schema cron)
-- =============================================================================
-- Checks whether mivora-booking-reminders (or any reminder job) is scheduled.
-- Does not SELECT command text (jobs can theoretically store URLs).

-- B1. Job names, schedule, active flag
SELECT
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  (j.command ILIKE '%process_due_booking_reminders%') AS runs_booking_reminders,
  (j.jobname = 'mivora-booking-reminders') AS is_documented_reminder_job_name
FROM cron.job AS j
ORDER BY j.jobid;

-- B2. Recent run outcomes for the reminder job only — no command payload
SELECT
  d.jobid,
  j.jobname,
  d.status,
  d.start_time,
  d.end_time,
  d.return_message IS NOT NULL AS has_return_message
FROM cron.job_run_details AS d
INNER JOIN cron.job AS j ON j.jobid = d.jobid
WHERE j.jobname = 'mivora-booking-reminders'
   OR j.command ILIKE '%process_due_booking_reminders%'
ORDER BY d.start_time DESC
LIMIT 20;

-- =============================================================================
-- Part C — pg_net  (SKIP if A2 has no schema net)
-- =============================================================================
-- Queue depth only. Never SELECT url, headers, body, or response content.

-- C1. Request queue depth (pending HTTP from webhooks / pg_net)
SELECT
  pg_catalog.count(*)::integer AS queued_request_count
FROM net.http_request_queue;

-- C2. Response table row count if present (no body)
SELECT
  pg_catalog.count(*)::integer AS stored_response_count
FROM net._http_response;

-- =============================================================================
-- Part D — Vault existence  (SKIP if A2 has no schema vault)
-- =============================================================================
-- Confirms Vault is installed. Does not read secret names or values.

SELECT
  pg_catalog.count(*)::integer AS vault_secret_row_count
FROM vault.secrets;
