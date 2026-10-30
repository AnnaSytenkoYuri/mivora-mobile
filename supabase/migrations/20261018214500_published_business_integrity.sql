-- Mivora Phase 6C: Published business integrity (profile, services, weekly hours)
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on (already in the repo, assumed applied in production):
--   20261016185300_providers_published.sql
--     public.provider_meets_publish_requirements(...)
--     public.providers_enforce_publish_completeness
--     public.services_unpublish_if_none_remain
--   20261018142500_provider_working_hours.sql
--     public.provider_working_hours (weekday 0–6, opens_at < closes_at)
--
-- This file has NOT been applied. Revise in place rather than adding a
-- follow-up migration until this one is reviewed.
--
-- Final publication requirements (drafts exempt):
--   1. Trimmed name, city, area, bio, image_url are non-empty
--   2. kind IN ('salon', 'specialist')
--   3. EXISTS at least one public.services row
--   4. EXISTS at least one public.provider_working_hours row
--      with opens_at < closes_at (also a table CHECK)
--   Date exceptions are NOT part of publication eligibility.
--
-- Why BEFORE ROW last-item checks are not enough
--   PostgreSQL BEFORE ROW DELETE/UPDATE triggers see the statement snapshot.
--   Rows removed earlier in the same command still appear in EXISTS.
--   DELETE FROM services WHERE provider_id = $1 of every row can therefore
--   let every BEFORE ROW trigger observe “another service still exists”,
--   then all rows disappear. Same for weekly hours.
--   Enforcement is therefore AFTER STATEMENT with transition tables, after
--   the command’s final table state is visible, plus FOR UPDATE on every
--   affected provider (published or not) in id order.
--
-- This migration
--   1. Extends provider_meets_publish_requirements with weekly hours (same
--      signature).
--   2. Enforces completeness on any providers UPDATE that leaves published
--      true (name/kind/city/area/bio/image_url/published). Drafts/unpublish OK.
--   3. Drops last-service auto-unpublish. Never auto-unpublish.
--   4. AFTER STATEMENT DELETE + AFTER STATEMENT UPDATE (separate triggers:
--      transition tables cannot be used with event OR, nor with UPDATE OF
--      column_name). Both use OLD TABLE only (no join on row id), then check
--      the command’s final table state. A published provider named in OLD
--      must still have a service / valid weekday, including after id+provider_id
--      rewrites. Harmless same-provider UPDATEs still pass that EXISTS check.
--
-- Locking / concurrency
--   DELETE and UPDATE statement triggers SELECT providers.id ... ORDER BY id
--   FOR UPDATE for every distinct OLD.provider_id (including drafts). That
--   serializes publish (which row-locks providers) with bulk service/hours
--   writes so two sessions cannot each remove one of the last two rows.
--   Trigger functions are SECURITY DEFINER (bypass RLS) and not GRANTed
--   to anon/authenticated.
--   PostgreSQL: REFERENCING is AFTER STATEMENT only; not with event OR;
--   not with UPDATE OF columns; not constraint triggers.
--
-- Already-published businesses with no weekly hours
--   Stay published. No backfill. Required-field UPDATEs fail until they
--   INSERT hours or unpublish. INSERT hours does not write published.
--
-- Manual SQL regression (not run by this repo):
--   * DELETE all services of a published provider in one statement → fail
--   * DELETE all weekly-hours rows of a published provider in one statement → fail
--   * Draft: DELETE all services / hours → succeed
--   * Unpublish, then DELETE all → succeed
--   * Two sessions each DELETE one of two last services → one fails
--   * Publish concurrent with last-service DELETE → one fails; not 0 services published
--   * Hours: upsert remaining weekday, then DELETE closed weekdays → succeed
--
-- Bookings, booking RPCs, exceptions, and RLS SELECT policies are untouched.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.providers') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.providers does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.services') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.services does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.provider_working_hours') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_working_hours is missing. Apply 20261018142500_provider_working_hours.sql first.';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.provider_meets_publish_requirements(text, text, text, text, text, text, text)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_meets_publish_requirements(...) is missing.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'services'
      AND a.attname IN ('id', 'provider_id')
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) <> 2 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.services must have id and provider_id.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'provider_working_hours'
      AND a.attname IN ('id', 'provider_id')
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) <> 2 THEN
    RAISE EXCEPTION
      'Refusing to continue: public.provider_working_hours must have id and provider_id.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.provider_meets_publish_requirements(
  p_id text,
  p_name text,
  p_kind text,
  p_city text,
  p_area text,
  p_bio text,
  p_image_url text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_id IS NOT NULL
    AND pg_catalog.btrim(COALESCE(p_name, '')) <> ''
    AND p_kind IN ('salon', 'specialist')
    AND pg_catalog.btrim(COALESCE(p_city, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_area, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_bio, '')) <> ''
    AND pg_catalog.btrim(COALESCE(p_image_url, '')) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.services AS s
      WHERE s.provider_id = p_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.provider_working_hours AS h
      WHERE h.provider_id = p_id
        AND h.opens_at < h.closes_at
    );
$$;

COMMENT ON FUNCTION public.provider_meets_publish_requirements(text, text, text, text, text, text, text) IS
  'True when a provider may be published: complete profile, at least one service, and at least one weekly-hours row with opens_at < closes_at. Exceptions are ignored. Not executable by clients.';

ALTER FUNCTION public.provider_meets_publish_requirements(text, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_meets_publish_requirements(text, text, text, text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.providers_enforce_publish_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Drafts may be incomplete. Explicit unpublish is always allowed.
  IF NEW.published IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT public.provider_meets_publish_requirements(
    NEW.id,
    NEW.name,
    NEW.kind,
    NEW.city,
    NEW.area,
    NEW.bio,
    NEW.image_url
  ) THEN
    RAISE EXCEPTION
      'Provider % cannot be published until name, type (salon/specialist), city, area, bio, cover image, at least one service, and weekly working hours are set',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.providers_enforce_publish_completeness() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.providers_enforce_publish_completeness() FROM PUBLIC;

DROP TRIGGER IF EXISTS providers_enforce_publish_completeness ON public.providers;

CREATE TRIGGER providers_enforce_publish_completeness
BEFORE INSERT OR UPDATE OF published, name, kind, city, area, bio, image_url
ON public.providers
FOR EACH ROW
EXECUTE FUNCTION public.providers_enforce_publish_completeness();

DROP TRIGGER IF EXISTS services_unpublish_if_none_remain ON public.services;
DROP FUNCTION IF EXISTS public.services_unpublish_if_none_remain();

DROP TRIGGER IF EXISTS services_prevent_last_service_while_published ON public.services;
DROP FUNCTION IF EXISTS public.services_prevent_last_service_while_published();

CREATE OR REPLACE FUNCTION public.services_enforce_published_has_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Lock every affected provider, including drafts, so a concurrent
  -- published=true UPDATE cannot race a bulk DELETE.
  PERFORM 1
  FROM public.providers AS p
  WHERE p.id IN (
    SELECT DISTINCT r.provider_id
    FROM old_rows AS r
    WHERE r.provider_id IS NOT NULL
  )
  ORDER BY p.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.providers AS p
    WHERE p.published IS TRUE
      AND p.id IN (
        SELECT DISTINCT r.provider_id
        FROM old_rows AS r
        WHERE r.provider_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.services AS s
        WHERE s.provider_id = p.id
      )
  ) THEN
    RAISE EXCEPTION
      'Published provider cannot have zero services. Unpublish first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.services_enforce_published_has_service() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.services_enforce_published_has_service() FROM PUBLIC;

DROP TRIGGER IF EXISTS services_enforce_published_has_service ON public.services;
DROP TRIGGER IF EXISTS services_enforce_published_has_service_delete ON public.services;
DROP TRIGGER IF EXISTS services_enforce_published_has_service_update ON public.services;
DROP FUNCTION IF EXISTS public.services_enforce_published_has_service_update();

CREATE TRIGGER services_enforce_published_has_service_delete
AFTER DELETE ON public.services
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.services_enforce_published_has_service();

CREATE TRIGGER services_enforce_published_has_service_update
AFTER UPDATE ON public.services
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.services_enforce_published_has_service();

DROP TRIGGER IF EXISTS working_hours_prevent_last_weekday_while_published ON public.provider_working_hours;
DROP FUNCTION IF EXISTS public.working_hours_prevent_last_weekday_while_published();

CREATE OR REPLACE FUNCTION public.working_hours_enforce_published_has_weekday()
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
    FROM old_rows AS r
    WHERE r.provider_id IS NOT NULL
  )
  ORDER BY p.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.providers AS p
    WHERE p.published IS TRUE
      AND p.id IN (
        SELECT DISTINCT r.provider_id
        FROM old_rows AS r
        WHERE r.provider_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.provider_working_hours AS h
        WHERE h.provider_id = p.id
          AND h.opens_at < h.closes_at
      )
  ) THEN
    RAISE EXCEPTION
      'Published provider cannot have zero open weekdays. Unpublish first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.working_hours_enforce_published_has_weekday() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.working_hours_enforce_published_has_weekday() FROM PUBLIC;

DROP TRIGGER IF EXISTS working_hours_enforce_published_has_weekday ON public.provider_working_hours;
DROP TRIGGER IF EXISTS working_hours_enforce_published_has_weekday_delete ON public.provider_working_hours;
DROP TRIGGER IF EXISTS working_hours_enforce_published_has_weekday_update ON public.provider_working_hours;
DROP FUNCTION IF EXISTS public.working_hours_enforce_published_has_weekday_update();

CREATE TRIGGER working_hours_enforce_published_has_weekday_delete
AFTER DELETE ON public.provider_working_hours
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.working_hours_enforce_published_has_weekday();

CREATE TRIGGER working_hours_enforce_published_has_weekday_update
AFTER UPDATE ON public.provider_working_hours
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.working_hours_enforce_published_has_weekday();

COMMIT;
