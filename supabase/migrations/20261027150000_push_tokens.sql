-- Mivora Phase 3B step 2: Expo push token storage + register/unregister RPCs
-- DO NOT apply until reviewed. This file is not executed by the app.
--
-- Depends on:
--   auth.users (Supabase Auth)
--
-- Does not:
--   Send push notifications, store APNs/FCM native tokens, or create Edge Functions
--   Change local appointment reminders, OS permission, or booking RPCs
--   Grant anon any access; grant authenticated INSERT/UPDATE/DELETE on tokens
--
-- Design
--   One row per Expo push token. Unique token globally so a device is not
--   fanned out to two accounts. One user may have many rows (multi-device).
--   Clients SELECT only their own rows (RLS). All writes go through
--   register_my_push_token / unregister_my_push_token (SECURITY DEFINER).
--   user_id is always auth.uid() on INSERT (trigger) and is immutable on UPDATE.
--   Reassignment (same token, new account) DELETEs the old row then INSERTs.
--   It never UPDATE user_id (the ownership trigger would reject that).
--
-- Concurrency
--   register_my_push_token and unregister_my_push_token take
--   pg_advisory_xact_lock(hashtextextended(token, 0)) for the transaction.
--   Sessions that touch the same token wait; different tokens run in parallel.
--   After the lock, SELECT ... FOR UPDATE sees a stable row (or none), then
--   heartbeat UPDATE, DELETE+INSERT, INSERT, or DELETE. No check-then-insert
--   race and no retry loop. Unique(expo_push_token) remains a backstop.
--
-- Bearer limit
--   Presenting a valid Expo token string is the only device proof. A leaked
--   token plus a session can move that device to the attacker account.
--
-- Delivery
--   Future Edge Functions use the Supabase service role (BYPASSRLS). This
--   migration does not GRANT or REVOKE service_role, matching notifications.

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Refusing to continue: auth.users does not exist.';
  END IF;

  IF pg_catalog.to_regclass('public.push_tokens') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to continue: public.push_tokens already exists.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT push_tokens_platform_check
    CHECK (platform IN ('ios', 'android')),
  CONSTRAINT push_tokens_token_format_check
    CHECK (
      expo_push_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
      OR expo_push_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$'
    ),
  CONSTRAINT push_tokens_expo_push_token_key UNIQUE (expo_push_token)
);

COMMENT ON TABLE public.push_tokens IS
  'Expo push tokens. Client SELECT own rows only. Writes only via register/unregister RPCs. Service role reads for delivery.';

COMMENT ON COLUMN public.push_tokens.user_id IS
  'Owning auth.users.id. Set from auth.uid() on INSERT. Cannot be changed on UPDATE.';

COMMENT ON COLUMN public.push_tokens.expo_push_token IS
  'Expo Push Service token (ExponentPushToken[…] / ExpoPushToken[…]). Globally unique. Not an APNs or FCM native token.';

COMMENT ON COLUMN public.push_tokens.platform IS
  'ios or android. Web does not register. Used for diagnostics, not authorization.';

COMMENT ON COLUMN public.push_tokens.last_seen_at IS
  'Set on register/refresh. Stale rows may be pruned after DeviceNotRegistered receipts.';

CREATE INDEX push_tokens_user_id_idx
  ON public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Ownership: force user_id on INSERT; freeze user_id on UPDATE
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.push_tokens_protect_ownership()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := (SELECT auth.uid());

  IF TG_OP = 'INSERT' THEN
    -- JWT present (register RPC): ignore supplied user_id, use auth.uid().
    -- JWT absent (service role / SQL owner): allow an explicit user_id.
    IF uid IS NOT NULL THEN
      NEW.user_id := uid;
    ELSIF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'push_tokens.user_id is required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'push_tokens.user_id cannot be changed';
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.push_tokens_protect_ownership() IS
  'INSERT stamps user_id from auth.uid() when a JWT is present. UPDATE cannot change user_id. Not executable by clients.';

ALTER FUNCTION public.push_tokens_protect_ownership() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_tokens_protect_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_tokens_protect_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_tokens_protect_ownership() FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_tokens_protect_ownership() FROM authenticated;

CREATE TRIGGER push_tokens_protect_ownership
BEFORE INSERT OR UPDATE ON public.push_tokens
FOR EACH ROW
EXECUTE FUNCTION public.push_tokens_protect_ownership();

-- ---------------------------------------------------------------------------
-- Privileges — SELECT own rows only; writes via RPCs
-- ---------------------------------------------------------------------------

ALTER TABLE public.push_tokens OWNER TO postgres;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.push_tokens FROM anon;
REVOKE ALL ON TABLE public.push_tokens FROM authenticated;

GRANT SELECT ON TABLE public.push_tokens TO authenticated;

CREATE POLICY "push_tokens_select_own"
ON public.push_tokens
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- register_my_push_token — current user only; reassign by DELETE+INSERT
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.register_my_push_token(p_token text, p_platform text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid;
  existing_id uuid;
  existing_user uuid;
  new_id uuid;
BEGIN
  uid := (SELECT auth.uid());
  IF uid IS NULL THEN
    RAISE EXCEPTION 'register_my_push_token: sign in required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'register_my_push_token: platform must be ios or android'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_token IS NULL
     OR NOT (
       p_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
       OR p_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$'
     ) THEN
    RAISE EXCEPTION 'register_my_push_token: invalid Expo push token'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Transaction-scoped lock: one session mutates this token at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token, 0));

  SELECT t.id, t.user_id
  INTO existing_id, existing_user
  FROM public.push_tokens AS t
  WHERE t.expo_push_token = p_token
  FOR UPDATE;

  IF existing_id IS NOT NULL AND existing_user = uid THEN
    UPDATE public.push_tokens AS t
    SET
      platform = p_platform,
      last_seen_at = pg_catalog.now()
    WHERE t.id = existing_id;
    RETURN existing_id;
  END IF;

  IF existing_id IS NOT NULL THEN
    DELETE FROM public.push_tokens AS t
    WHERE t.id = existing_id;
  END IF;

  INSERT INTO public.push_tokens (user_id, expo_push_token, platform)
  VALUES (uid, p_token, p_platform)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION public.register_my_push_token(text, text) IS
  'Registers p_token for auth.uid(). Heartbeats an existing own row. If another account holds the token, deletes that row then inserts (never UPDATE user_id). Serialized per token via advisory xact lock.';

ALTER FUNCTION public.register_my_push_token(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_my_push_token(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_my_push_token(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_my_push_token(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_my_push_token(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- unregister_my_push_token — own row only; idempotent
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.unregister_my_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := (SELECT auth.uid());
  IF uid IS NULL THEN
    RETURN;
  END IF;

  IF p_token IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token, 0));

  DELETE FROM public.push_tokens AS t
  WHERE t.expo_push_token = p_token
    AND t.user_id = uid;
END;
$$;

COMMENT ON FUNCTION public.unregister_my_push_token(text) IS
  'Deletes auth.uid()''s row for p_token if present. No-op when signed out, missing, or owned by someone else. Does not delete other devices.';

ALTER FUNCTION public.unregister_my_push_token(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.unregister_my_push_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unregister_my_push_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unregister_my_push_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.unregister_my_push_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Privilege assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname, cmd)
  INTO leftover
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'push_tokens'
    AND (
      cmd = '*'
      OR policyname IS DISTINCT FROM 'push_tokens_select_own'
      OR cmd IS DISTINCT FROM 'SELECT'
    );

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to continue: unexpected public.push_tokens policies: %',
      leftover;
  END IF;

  IF has_table_privilege('anon', 'public.push_tokens', 'SELECT')
     OR has_table_privilege('anon', 'public.push_tokens', 'INSERT')
     OR has_table_privilege('anon', 'public.push_tokens', 'UPDATE')
     OR has_table_privilege('anon', 'public.push_tokens', 'DELETE') THEN
    RAISE EXCEPTION
      'Refusing to continue: anon must have no access to public.push_tokens.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.push_tokens', 'SELECT') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated missing SELECT on public.push_tokens.';
  END IF;

  IF has_table_privilege('authenticated', 'public.push_tokens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.push_tokens', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.push_tokens', 'DELETE') THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated must not INSERT/UPDATE/DELETE public.push_tokens.';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.push_tokens_protect_ownership()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.push_tokens_protect_ownership()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.register_my_push_token(text, text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.unregister_my_push_token(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: trigger must not be client-executable; anon must not register or unregister tokens.';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.register_my_push_token(text, text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.unregister_my_push_token(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Refusing to continue: authenticated missing EXECUTE on push token RPCs.';
  END IF;
END
$$;

COMMIT;
