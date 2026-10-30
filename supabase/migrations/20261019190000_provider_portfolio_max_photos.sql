-- Mivora Phase 8C: at most 12 public.provider_portfolio rows per provider_id
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already applied):
--   public.providers, public.provider_portfolio
--   provider_portfolio SELECT published/owner/booked (Phase 6A)
--
-- Does not:
--   Modify Storage policies or buckets
--   Change owner INSERT/UPDATE/DELETE RLS on provider_portfolio
--   Change SELECT visibility
--   Modify booking RPCs, 7A notification triggers, or 6C publish integrity
--   Delete or rewrite existing portfolio rows
--
-- Concurrency (READ COMMITTED)
--   BEFORE ROW only COUNTs. It must not lock providers: a multi-row INSERT that
--   touches providers B then A would take locks in row visit order and can
--   deadlock another session locking A then B.
--   AFTER STATEMENT locks every affected public.providers.id in ORDER BY id
--   FOR NO KEY UPDATE, then COUNTs remaining rows in a second SQL command.
--   VOLATILE SPI takes a new snapshot per command, so a waiter’s COUNT sees
--   the first session’s committed rows. Do not merge lock and COUNT.
--
--   FOR NO KEY UPDATE, not FOR UPDATE:
--   INSERT/UPDATE of provider_portfolio takes FOR KEY SHARE on the referenced
--   providers row (FK). KEY SHARE is compatible with KEY SHARE, so two
--   concurrent inserts both hold it. FOR UPDATE conflicts with KEY SHARE, so
--   both AFTER triggers wait on each other (lock-upgrade deadlock).
--   FOR NO KEY UPDATE does not conflict with KEY SHARE and is self-exclusive,
--   so the first trigger proceeds and the second waits for commit.
--   Phase 6C still uses FOR UPDATE on providers, also ORDER BY id. That mode
--   waits for our NO KEY UPDATE / KEY SHARE; we wait for their FOR UPDATE.
--   Same lock order, no KEY SHARE upgrade in 8C.
--
-- Existing data
--   Providers who already have more than 12 keep those photos. New inserts
--   for them fail until they delete extras.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.provider_portfolio') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_portfolio does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND a.attname IN ('id', 'provider_id')
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) <> 2 THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_portfolio is missing id or provider_id.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.provider_portfolio_enforce_max_photos_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  photo_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id THEN
    RETURN NEW;
  END IF;

  IF NEW.provider_id IS NULL THEN
    RAISE EXCEPTION 'A portfolio photo must belong to a provider.'
      USING ERRCODE = 'not_null_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.providers AS p
    WHERE p.id = NEW.provider_id
  ) THEN
    RAISE EXCEPTION 'Cannot add a portfolio photo because the provider does not exist.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Fail-fast for the sequential 13th photo. Do not lock here (lock order
  -- would follow INSERT row order). AFTER STATEMENT serializes concurrent
  -- sessions with ORDER BY providers.id FOR NO KEY UPDATE.
  SELECT pg_catalog.count(*)::integer
  INTO photo_count
  FROM public.provider_portfolio AS pp
  WHERE pp.provider_id = NEW.provider_id;

  IF photo_count >= 12 THEN
    RAISE EXCEPTION 'A provider can have at most 12 portfolio photos.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.provider_portfolio_enforce_max_photos_row() IS
  'BEFORE ROW. Fail-fast COUNT when 12 photos already exist. Does not lock; does not delete rows.';

ALTER FUNCTION public.provider_portfolio_enforce_max_photos_row() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_portfolio_enforce_max_photos_row() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_row() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_row() FROM anon;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_row() FROM authenticated;

CREATE OR REPLACE FUNCTION public.provider_portfolio_enforce_max_photos_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.providers AS p
  WHERE p.id IN (
    SELECT DISTINCT r.provider_id
    FROM new_rows AS r
    WHERE r.provider_id IS NOT NULL
  )
  ORDER BY p.id
  FOR NO KEY UPDATE;

  -- Separate command: fresh READ COMMITTED snapshot after any lock wait.
  IF EXISTS (
    SELECT 1
    FROM public.provider_portfolio AS pp
    WHERE pp.provider_id IN (
      SELECT DISTINCT r.provider_id
      FROM new_rows AS r
      WHERE r.provider_id IS NOT NULL
    )
    GROUP BY pp.provider_id
    HAVING pg_catalog.count(*) > 12
  ) THEN
    RAISE EXCEPTION 'A provider can have at most 12 portfolio photos.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.provider_portfolio_enforce_max_photos_stmt() IS
  'AFTER INSERT STATEMENT. FOR NO KEY UPDATE on providers.id in id order, then COUNT. Not FOR UPDATE: INSERT already holds FOR KEY SHARE.';

ALTER FUNCTION public.provider_portfolio_enforce_max_photos_stmt() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_portfolio_enforce_max_photos_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_stmt() FROM anon;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_stmt() FROM authenticated;

DROP TRIGGER IF EXISTS provider_portfolio_enforce_max_photos_row ON public.provider_portfolio;
DROP TRIGGER IF EXISTS provider_portfolio_enforce_max_photos_insert ON public.provider_portfolio;
DROP TRIGGER IF EXISTS provider_portfolio_enforce_max_photos_update ON public.provider_portfolio;

CREATE TRIGGER provider_portfolio_enforce_max_photos_row
BEFORE INSERT OR UPDATE ON public.provider_portfolio
FOR EACH ROW
EXECUTE FUNCTION public.provider_portfolio_enforce_max_photos_row();

CREATE TRIGGER provider_portfolio_enforce_max_photos_insert
AFTER INSERT ON public.provider_portfolio
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.provider_portfolio_enforce_max_photos_stmt();

CREATE OR REPLACE FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Ignore image_url-only updates so existing over-limit rows stay editable.
  PERFORM 1
  FROM public.providers AS p
  WHERE p.id IN (
    SELECT DISTINCT n.provider_id
    FROM new_rows AS n
    INNER JOIN old_rows AS o ON o.id = n.id
    WHERE n.provider_id IS DISTINCT FROM o.provider_id
      AND n.provider_id IS NOT NULL
  )
  ORDER BY p.id
  FOR NO KEY UPDATE;

  -- Separate command: fresh READ COMMITTED snapshot after any lock wait.
  IF EXISTS (
    SELECT 1
    FROM public.provider_portfolio AS pp
    WHERE pp.provider_id IN (
      SELECT DISTINCT n.provider_id
      FROM new_rows AS n
      INNER JOIN old_rows AS o ON o.id = n.id
      WHERE n.provider_id IS DISTINCT FROM o.provider_id
        AND n.provider_id IS NOT NULL
    )
    GROUP BY pp.provider_id
    HAVING pg_catalog.count(*) > 12
  ) THEN
    RAISE EXCEPTION 'A provider can have at most 12 portfolio photos.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() IS
  'AFTER UPDATE STATEMENT. FOR NO KEY UPDATE on destination providers.id in id order only when provider_id changes, then COUNT.';

ALTER FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() FROM anon;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt() FROM authenticated;

CREATE TRIGGER provider_portfolio_enforce_max_photos_update
AFTER UPDATE ON public.provider_portfolio
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.provider_portfolio_enforce_max_photos_update_stmt();

DO $$
DECLARE
  leftover_exec text;
BEGIN
  IF pg_catalog.to_regprocedure('public.provider_portfolio_enforce_max_photos_row()') IS NULL
     OR pg_catalog.to_regprocedure('public.provider_portfolio_enforce_max_photos_stmt()') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.provider_portfolio_enforce_max_photos_update_stmt()'
     ) IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: portfolio limit functions were not created.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'provider_portfolio_enforce_max_photos_row',
        'provider_portfolio_enforce_max_photos_insert',
        'provider_portfolio_enforce_max_photos_update'
      )
    HAVING pg_catalog.count(*) = 3
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: expected three portfolio limit triggers.';
  END IF;

  SELECT string_agg(proname, ', ' ORDER BY proname)
  INTO leftover_exec
  FROM pg_catalog.pg_proc AS p
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'provider_portfolio_enforce_max_photos_row',
      'provider_portfolio_enforce_max_photos_stmt',
      'provider_portfolio_enforce_max_photos_update_stmt'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF leftover_exec IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: portfolio limit functions must not be client-executable: %',
      leftover_exec;
  END IF;
END
$$;

COMMIT;
