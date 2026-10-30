-- Mivora Phase 8D: persistent portfolio photo order (sort_order + owner RPC)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already applied):
--   public.providers, public.provider_portfolio
--   public.provider_owned_by_me(text)
--   Phase 8C max-12 triggers (left unchanged)
--
-- Does not:
--   Alter 8C trigger functions or the 12-photo cap
--   Modify Storage policies or buckets
--   Add or change SELECT/INSERT/DELETE RLS on provider_portfolio
--   Grant table UPDATE to anon/authenticated (there is no UPDATE policy)
--   Modify booking RPCs, 7A notifications, or 6C publish integrity
--
-- New photos:
--   Column DEFAULT 0 lets existing clients omit sort_order (NOT NULL).
--   AFTER INSERT STATEMENT assigns max(existing)+row_number() per provider,
--   ignoring any client-supplied sort_order, so new photos land last.
--   It locks providers.id FOR NO KEY UPDATE in id order (same mode and order
--   as 8C AFTER). Do not lock in BEFORE ROW: that follows INSERT row order
--   and deadlocks a multi-provider INSERT of B then A against A then B.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.provider_portfolio') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_portfolio does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  IF pg_catalog.to_regprocedure('public.provider_owned_by_me(text)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_owned_by_me(text) is missing.';
  END IF;

  IF pg_catalog.to_regprocedure('public.provider_portfolio_enforce_max_photos_row()') IS NULL
     OR pg_catalog.to_regprocedure('public.provider_portfolio_enforce_max_photos_stmt()') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.provider_portfolio_enforce_max_photos_update_stmt()'
     ) IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: Phase 8C portfolio limit functions are missing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND a.attname = 'sort_order'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: public.provider_portfolio.sort_order already exists.';
  END IF;

  IF (
    SELECT a.atttypid
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) NOT IN ('pg_catalog.int4'::regtype, 'pg_catalog.int8'::regtype) THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_portfolio.id must be integer or bigint.';
  END IF;
END
$$;

ALTER TABLE public.provider_portfolio
  ADD COLUMN sort_order integer;

UPDATE public.provider_portfolio AS pp
SET sort_order = ranked.n
FROM (
  SELECT
    inner_pp.id,
    pg_catalog.row_number() OVER (
      PARTITION BY inner_pp.provider_id
      ORDER BY inner_pp.id
    )::integer AS n
  FROM public.provider_portfolio AS inner_pp
) AS ranked
WHERE pp.id = ranked.id;

ALTER TABLE public.provider_portfolio
  ALTER COLUMN sort_order SET NOT NULL;

ALTER TABLE public.provider_portfolio
  ALTER COLUMN sort_order SET DEFAULT 0;

COMMENT ON COLUMN public.provider_portfolio.sort_order IS
  'Display rank within provider_id. Lower first. AFTER INSERT assigns max+1 per new row. Not unique.';

CREATE INDEX provider_portfolio_provider_sort_idx
  ON public.provider_portfolio (provider_id, sort_order, id);

CREATE OR REPLACE FUNCTION public.provider_portfolio_assign_sort_order_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same lock mode and id order as Phase 8C AFTER INSERT. Separate command
  -- from the UPDATE below so a waiter takes a fresh READ COMMITTED snapshot.
  PERFORM 1
  FROM public.providers AS p
  WHERE p.id IN (
    SELECT DISTINCT r.provider_id
    FROM new_rows AS r
    WHERE r.provider_id IS NOT NULL
  )
  ORDER BY p.id
  FOR NO KEY UPDATE;

  UPDATE public.provider_portfolio AS pp
  SET sort_order = assigned.sort_order
  FROM (
    SELECT
      n.id,
      mx.max_order + pg_catalog.row_number() OVER (
        PARTITION BY n.provider_id
        ORDER BY n.id
      ) AS sort_order
    FROM new_rows AS n
    INNER JOIN (
      SELECT
        affected.provider_id,
        COALESCE(pg_catalog.max(existing.sort_order), 0) AS max_order
      FROM (
        SELECT DISTINCT r.provider_id
        FROM new_rows AS r
        WHERE r.provider_id IS NOT NULL
      ) AS affected
      LEFT JOIN public.provider_portfolio AS existing
        ON existing.provider_id = affected.provider_id
        AND NOT EXISTS (
          SELECT 1
          FROM new_rows AS incoming
          WHERE incoming.id = existing.id
        )
      GROUP BY affected.provider_id
    ) AS mx
      ON mx.provider_id = n.provider_id
    WHERE n.provider_id IS NOT NULL
  ) AS assigned
  WHERE pp.id = assigned.id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.provider_portfolio_assign_sort_order_stmt() IS
  'AFTER INSERT STATEMENT. Locks providers.id in id order, then assigns distinct sort_order values to new rows. Ignores client-supplied sort_order.';

ALTER FUNCTION public.provider_portfolio_assign_sort_order_stmt() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_portfolio_assign_sort_order_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_assign_sort_order_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_assign_sort_order_stmt() FROM anon;
REVOKE EXECUTE ON FUNCTION public.provider_portfolio_assign_sort_order_stmt() FROM authenticated;

DROP TRIGGER IF EXISTS provider_portfolio_assign_sort_order ON public.provider_portfolio;
DROP TRIGGER IF EXISTS provider_portfolio_assign_sort_order_insert ON public.provider_portfolio;
DROP FUNCTION IF EXISTS public.provider_portfolio_assign_sort_order();

CREATE TRIGGER provider_portfolio_assign_sort_order_insert
AFTER INSERT ON public.provider_portfolio
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.provider_portfolio_assign_sort_order_stmt();

CREATE OR REPLACE FUNCTION public.move_my_portfolio_photo(
  p_photo_id bigint,
  p_direction text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_provider_id text;
  v_ids bigint[];
  v_n integer;
  v_i integer;
  v_j integer;
  v_swap bigint;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to reorder portfolio photos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_photo_id IS NULL
     OR (
       p_direction IS DISTINCT FROM 'left'
       AND p_direction IS DISTINCT FROM 'right'
     ) THEN
    RAISE EXCEPTION 'A valid photo and direction (left or right) are required.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT pp.provider_id
  INTO v_provider_id
  FROM public.provider_portfolio AS pp
  WHERE pp.id = p_photo_id;

  IF v_provider_id IS NULL OR NOT public.provider_owned_by_me(v_provider_id) THEN
    RAISE EXCEPTION 'Not allowed to move this photo.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1
  FROM public.providers AS p
  WHERE p.id = v_provider_id
  ORDER BY p.id
  FOR NO KEY UPDATE;

  SELECT pg_catalog.array_agg(pp.id::bigint ORDER BY pp.sort_order, pp.id)
  INTO v_ids
  FROM public.provider_portfolio AS pp
  WHERE pp.provider_id = v_provider_id;

  v_n := pg_catalog.cardinality(v_ids);
  v_i := pg_catalog.array_position(v_ids, p_photo_id);

  IF v_i IS NULL THEN
    RAISE EXCEPTION 'Not allowed to move this photo.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_direction = 'left' THEN
    IF v_i <= 1 THEN
      RETURN;
    END IF;
    v_j := v_i - 1;
  ELSE
    IF v_i >= v_n THEN
      RETURN;
    END IF;
    v_j := v_i + 1;
  END IF;

  v_swap := v_ids[v_i];
  v_ids[v_i] := v_ids[v_j];
  v_ids[v_j] := v_swap;

  FOR v_i IN 1..v_n LOOP
    UPDATE public.provider_portfolio AS pp
    SET sort_order = v_i
    WHERE pp.id = v_ids[v_i]
      AND pp.provider_id = v_provider_id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.move_my_portfolio_photo(bigint, text) IS
  'Owner moves one of their portfolio photos one slot left or right. Locks providers.id. Does not change provider_id or image_url.';

ALTER FUNCTION public.move_my_portfolio_photo(bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_my_portfolio_photo(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_my_portfolio_photo(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_my_portfolio_photo(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_my_portfolio_photo(bigint, text) TO authenticated;

DO $$
DECLARE
  leftover_exec text;
  leftover_update text;
  missing_8c integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND a.attname = 'sort_order'
      AND a.attnotnull
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: sort_order was not created as NOT NULL.';
  END IF;

  IF pg_catalog.to_regprocedure('public.move_my_portfolio_photo(bigint, text)') IS NULL
     OR pg_catalog.to_regprocedure('public.provider_portfolio_assign_sort_order_stmt()') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: Phase 8D functions were not created.';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO missing_8c
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
    );

  IF missing_8c <> 3 THEN
    RAISE EXCEPTION 'Refusing to continue: Phase 8C triggers must remain in place.';
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname)
  INTO leftover_update
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'provider_portfolio'
    AND cmd IN ('UPDATE', '*');

  IF leftover_update IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: provider_portfolio must not gain UPDATE/ALL RLS in 8D: %',
      leftover_update;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO leftover_exec
  FROM pg_catalog.pg_proc AS p
  INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'provider_portfolio_assign_sort_order_stmt'
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF leftover_exec IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: sort_order trigger must not be client-executable: %',
      leftover_exec;
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.move_my_portfolio_photo(bigint, text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.move_my_portfolio_photo(bigint, text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: move_my_portfolio_photo must be authenticated-only.';
  END IF;
END
$$;

COMMIT;
