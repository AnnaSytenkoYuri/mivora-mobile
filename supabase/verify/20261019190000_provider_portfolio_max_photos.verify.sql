-- Phase 8C verification — NOT a migration. Do not put this in supabase/migrations.
-- DO NOT run until 20261019190000_provider_portfolio_max_photos.sql has been applied.
-- DO NOT run this file without wrapping in a transaction that ROLLBACKs.
--
-- Safety
--   * Creates only providers/portfolio whose id / provider_id start with
--     zz8cverify-
--   * Never UPDATE or DELETE rows that do not use that prefix
--   * Never touches Storage, bookings, notifications, or 6C functions
--   * Ends in ROLLBACK so throwaway rows never commit
--
-- Run as postgres / supabase_admin in the SQL editor (bypasses RLS).
-- Authenticated/anon sessions will not insert providers and must not be used.
--
-- Concurrency (13th insert racing another session) CANNOT be proven here.
-- See the two-session section at the bottom; those steps are not in this txn.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  suffix text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  owner uuid;
  provider_a text := 'zz8cverify-a-' || suffix;
  provider_b text := 'zz8cverify-b-' || suffix;
  inserted integer;
  moved integer;
BEGIN
  IF to_regclass('public.provider_portfolio') IS NULL
     OR to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Missing providers or provider_portfolio.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger AS t
    INNER JOIN pg_class AS c ON c.oid = t.tgrelid
    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_portfolio'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'provider_portfolio_enforce_max_photos_row',
        'provider_portfolio_enforce_max_photos_insert',
        'provider_portfolio_enforce_max_photos_update'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'Phase 8C triggers are missing. Apply 20261019190000_provider_portfolio_max_photos.sql first.';
  END IF;

  SELECT u.id
  INTO owner
  FROM auth.users AS u
  ORDER BY u.created_at
  LIMIT 1;

  IF owner IS NULL THEN
    RAISE EXCEPTION
      'No auth.users row to reference as owner_id. The script does not create users.';
  END IF;

  INSERT INTO public.providers (
    id, owner_id, kind, name, bio, area, city, rating, review_count, featured, published
  )
  VALUES
    (
      provider_a,
      owner,
      'salon',
      'ZZ8C Verify A ' || suffix,
      'Verification draft. Rollback only.',
      'Verify',
      'bangkok',
      0,
      0,
      false,
      false
    ),
    (
      provider_b,
      owner,
      'specialist',
      'ZZ8C Verify B ' || suffix,
      'Verification draft. Rollback only.',
      'Verify',
      'bangkok',
      0,
      0,
      false,
      false
    );

  IF EXISTS (
    SELECT 1
    FROM public.providers
    WHERE id IN (provider_a, provider_b)
      AND id NOT LIKE 'zz8cverify-%'
  ) THEN
    RAISE EXCEPTION 'Refusing to continue: test provider id lost zz8cverify- prefix.';
  END IF;

  -- 12th insert succeeds
  INSERT INTO public.provider_portfolio (provider_id, image_url)
  SELECT provider_a, 'https://example.invalid/zz8cverify/' || g::text
  FROM generate_series(1, 12) AS g;

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_a;

  IF inserted <> 12 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 12 photos on A, found %.', inserted;
  END IF;

  -- Sequential 13th insert is rejected
  BEGIN
    INSERT INTO public.provider_portfolio (provider_id, image_url)
    VALUES (provider_a, 'https://example.invalid/zz8cverify/13');

    RAISE EXCEPTION 'TEST FAIL: sequential 13th insert succeeded.';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_a;

  IF inserted <> 12 THEN
    RAISE EXCEPTION 'TEST FAIL: A should still have 12 after rejected 13th, found %.', inserted;
  END IF;

  -- Independent provider still accepts photos
  INSERT INTO public.provider_portfolio (provider_id, image_url)
  VALUES (provider_b, 'https://example.invalid/zz8cverify/b1');

  -- Bulk INSERT of 13 on B (currently 1) must fail as one statement
  BEGIN
    INSERT INTO public.provider_portfolio (provider_id, image_url)
    SELECT provider_b, 'https://example.invalid/zz8cverify/bulk-' || g::text
    FROM generate_series(1, 13) AS g;

    RAISE EXCEPTION 'TEST FAIL: bulk 13-row insert succeeded.';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_b;

  IF inserted <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: bulk reject must leave B at 1 photo, found %.', inserted;
  END IF;

  -- image_url-only UPDATE on a full provider must still succeed
  UPDATE public.provider_portfolio
  SET image_url = 'https://example.invalid/zz8cverify/updated'
  WHERE provider_id = provider_a
    AND provider_id LIKE 'zz8cverify-%'
    AND id = (
      SELECT p.id
      FROM public.provider_portfolio AS p
      WHERE p.provider_id = provider_a
        AND p.provider_id LIKE 'zz8cverify-%'
      ORDER BY p.id
      LIMIT 1
    );

  -- Moving a B photo onto full A must fail
  BEGIN
    UPDATE public.provider_portfolio
    SET provider_id = provider_a
    WHERE provider_id = provider_b
      AND provider_id LIKE 'zz8cverify-%'
      AND id = (
        SELECT p.id
        FROM public.provider_portfolio AS p
        WHERE p.provider_id = provider_b
          AND p.provider_id LIKE 'zz8cverify-%'
        ORDER BY p.id
        LIMIT 1
      );

    RAISE EXCEPTION 'TEST FAIL: provider_id move onto a full provider succeeded.';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  SELECT count(*)::integer
  INTO moved
  FROM public.provider_portfolio
  WHERE provider_id = provider_b;

  IF moved <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: B should still own its photo after rejected move, found %.', moved;
  END IF;

  -- After delete, a 12th-slot insert on A succeeds (A had 12)
  -- Bulk INSERT of 12 on an empty provider succeeds
  DELETE FROM public.provider_portfolio
  WHERE provider_id = provider_b
    AND provider_id LIKE 'zz8cverify-%';

  INSERT INTO public.provider_portfolio (provider_id, image_url)
  SELECT provider_b, 'https://example.invalid/zz8cverify/bulk12-' || g::text
  FROM generate_series(1, 12) AS g;

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_b;

  IF inserted <> 12 THEN
    RAISE EXCEPTION 'TEST FAIL: bulk 12-row insert should succeed, found %.', inserted;
  END IF;

  DELETE FROM public.provider_portfolio
  WHERE provider_id = provider_a
    AND provider_id LIKE 'zz8cverify-%'
    AND id = (
      SELECT p.id
      FROM public.provider_portfolio AS p
      WHERE p.provider_id = provider_a
        AND p.provider_id LIKE 'zz8cverify-%'
      ORDER BY p.id
      LIMIT 1
    );

  INSERT INTO public.provider_portfolio (provider_id, image_url)
  VALUES (provider_a, 'https://example.invalid/zz8cverify/after-delete');

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_a;

  IF inserted <> 12 THEN
    RAISE EXCEPTION 'TEST FAIL: after delete+insert A should have 12, found %.', inserted;
  END IF;

  -- Reassignment onto a provider with a free slot succeeds
  DELETE FROM public.provider_portfolio
  WHERE provider_id = provider_a
    AND provider_id LIKE 'zz8cverify-%'
    AND id = (
      SELECT p.id
      FROM public.provider_portfolio AS p
      WHERE p.provider_id = provider_a
        AND p.provider_id LIKE 'zz8cverify-%'
      ORDER BY p.id
      LIMIT 1
    );

  UPDATE public.provider_portfolio
  SET provider_id = provider_a
  WHERE provider_id = provider_b
    AND provider_id LIKE 'zz8cverify-%'
    AND id = (
      SELECT p.id
      FROM public.provider_portfolio AS p
      WHERE p.provider_id = provider_b
        AND p.provider_id LIKE 'zz8cverify-%'
      ORDER BY p.id
      LIMIT 1
    );

  SELECT count(*)::integer
  INTO inserted
  FROM public.provider_portfolio
  WHERE provider_id = provider_a;

  SELECT count(*)::integer
  INTO moved
  FROM public.provider_portfolio
  WHERE provider_id = provider_b;

  IF inserted <> 12 OR moved <> 11 THEN
    RAISE EXCEPTION
      'TEST FAIL: after allowed move A should have 12 and B 11, found A=% B=%.',
      inserted,
      moved;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.provider_portfolio
    WHERE provider_id NOT LIKE 'zz8cverify-%'
      AND image_url LIKE 'https://example.invalid/zz8cverify/%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: verification rows escaped zz8cverify- provider ids.';
  END IF;

  RAISE NOTICE 'Phase 8C single-session verification passed. Rolling back throwaway rows.';
END
$$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Two-session concurrency (NOT in the transaction above)
-- Requires a committed throwaway provider, then prefix-scoped DELETE.
-- Do this only after the rollback-only tests pass.
-- Never use a real provider id.
--
-- Setup (session 1, then COMMIT):
--   Insert unpublished provider zz8cverify-c-<suffix> (same columns as above).
--   INSERT 11 portfolio rows. COMMIT so both sessions see 11 photos.
--
-- Concurrent 12th + 13th insert (must not deadlock):
--   INSERT already holds FOR KEY SHARE on providers. AFTER STATEMENT then
--   takes FOR NO KEY UPDATE (compatible with KEY SHARE, self-exclusive).
--   FOR UPDATE here would deadlock: both sessions hold KEY SHARE and wait
--   to upgrade.
--
-- Session 1:
--   BEGIN;
--   SET lock_timeout = '10s';
--   INSERT the 12th portfolio row for zz8cverify-c-<suffix>;
--   -- Keep the transaction OPEN (holds FOR NO KEY UPDATE).
--
-- Session 2:
--   BEGIN;
--   SET lock_timeout = '10s';
--   INSERT another portfolio row for the same provider_id;
--   -- Must block, not fail with deadlock_detected.
--   -- Must not return success before session 1 commits.
--
-- Session 1:
--   COMMIT;  -- 12 rows committed
--
-- Session 2:
--   -- COUNT is a later command than the lock wait; must see 12 and fail
--   -- check_violation. ROLLBACK even if it unexpectedly succeeded.
--
-- Race both INSERTs after 11 committed (no session holding the lock first):
--   Two sessions BEGIN; both INSERT at once. One commits 12 photos; the
--   other must get check_violation. Neither may get deadlock_detected.
--
-- Cleanup (after both sessions finish):
--   DELETE FROM public.provider_portfolio WHERE provider_id LIKE 'zz8cverify-c-%';
--   DELETE FROM public.providers WHERE id LIKE 'zz8cverify-c-%';
-- ---------------------------------------------------------------------------
