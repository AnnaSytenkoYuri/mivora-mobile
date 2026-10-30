import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  authorizePushDeliveryRequest,
  presentedPushDeliverySecret,
  PUSH_DELIVERY_SECRET_MIN_LENGTH,
  secretsEqual,
} from './push-delivery-auth.ts';
import {
  CLAIM_RPC,
  CLAIM_RPC_ARGS,
  resolveDeliveryMode,
  runDeliverBookingPush,
} from './push-delivery-dry-run.ts';
import { handleDeliverBookingPushHttp } from './push-delivery-http.ts';

const SECRET = 'delivery-secret-ok';

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name: string) {
      return map.get(name.toLowerCase()) ?? null;
    },
  };
}

const configuredEnv = {
  pushDeliverySecret: SECRET,
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'service-role-key',
};

test('rejects missing or short function secrets as misconfigured', () => {
  assert.ok(SECRET.length >= PUSH_DELIVERY_SECRET_MIN_LENGTH);
  assert.deepEqual(
    authorizePushDeliveryRequest({
      configuredSecret: undefined,
      presentedSecret: SECRET,
    }),
    { ok: false, status: 503, error: 'misconfigured' },
  );
  assert.deepEqual(
    authorizePushDeliveryRequest({
      configuredSecret: 'short-secret',
      presentedSecret: 'short-secret',
    }),
    { ok: false, status: 503, error: 'misconfigured' },
  );
});

test('rejects ordinary bearer JWTs, empty presentations, and wrong secrets', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature';
  assert.deepEqual(
    authorizePushDeliveryRequest({
      configuredSecret: SECRET,
      presentedSecret: jwt,
    }),
    { ok: false, status: 401, error: 'unauthorized' },
  );
  assert.deepEqual(
    authorizePushDeliveryRequest({
      configuredSecret: SECRET,
      presentedSecret: undefined,
    }),
    { ok: false, status: 401, error: 'unauthorized' },
  );
  assert.deepEqual(
    authorizePushDeliveryRequest({
      configuredSecret: SECRET,
      presentedSecret: 'wrong-secret-value',
    }),
    { ok: false, status: 401, error: 'unauthorized' },
  );
});

test('accepts the dedicated secret from the custom header or Bearer token', () => {
  assert.equal(
    presentedPushDeliverySecret(headers({ 'x-mivora-push-delivery-secret': SECRET })),
    SECRET,
  );
  assert.equal(presentedPushDeliverySecret(headers({ authorization: `Bearer ${SECRET}` })), SECRET);
  assert.equal(
    authorizePushDeliveryRequest({
      configuredSecret: SECRET,
      presentedSecret: SECRET,
    }).ok,
    true,
  );
  assert.equal(secretsEqual(SECRET, SECRET), true);
  assert.equal(secretsEqual(SECRET, 'delivery-secret-xx'), false);
});

test('user JWT on Authorization is ignored when the dedicated header is present', () => {
  assert.equal(
    presentedPushDeliverySecret(
      headers({
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature',
        'x-mivora-push-delivery-secret': SECRET,
      }),
    ),
    SECRET,
  );
});

test('dry-run never claims and live mode cannot send', () => {
  const dryRun = runDeliverBookingPush({ mode: 'dry_run', env: configuredEnv });
  assert.equal(dryRun.status, 200);
  assert.deepEqual(dryRun.body, {
    ok: true,
    mode: 'dry_run',
    mutated: false,
    claimed: false,
    expo: false,
    supabaseConfigured: true,
    claimRpc: CLAIM_RPC,
    missing: [],
  });
  assert.deepEqual(CLAIM_RPC_ARGS, { p_limit: 50, p_lease_seconds: 120 });

  const live = runDeliverBookingPush({ mode: 'live', env: configuredEnv });
  assert.equal(live.status, 501);
  assert.equal(live.body.error, 'live_delivery_not_enabled');
  assert.equal(live.body.mutated, false);
  assert.equal(live.body.claimed, false);
  assert.equal(live.body.expo, false);
});

test('dry-run reports missing supabase env without leaking secrets or service-role keys', () => {
  const result = runDeliverBookingPush({
    mode: 'dry_run',
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: undefined,
      supabaseServiceRoleKey: 'super-secret-service-role',
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.supabaseConfigured, false);
  assert.deepEqual(result.body.missing, ['SUPABASE_URL']);
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes('super-secret-service-role'), false);
});

test('request body defaults to dry-run and rejects unknown modes', () => {
  assert.equal(resolveDeliveryMode(undefined), 'dry_run');
  assert.equal(resolveDeliveryMode({}), 'dry_run');
  assert.equal(resolveDeliveryMode({ mode: 'dry_run' }), 'dry_run');
  assert.equal(resolveDeliveryMode({ mode: 'live' }), 'live');
  assert.equal(resolveDeliveryMode({ mode: 'receipts' }), 'receipts');
  assert.equal(resolveDeliveryMode({ mode: 'send' }), undefined);
  assert.equal(resolveDeliveryMode('dry_run'), undefined);
});

test('only POST is allowed; OPTIONS is not an open CORS preflight', async () => {
  for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE']) {
    const result = await handleDeliverBookingPushHttp({
      method,
      headers: headers({}),
      env: configuredEnv,
      readJson: async () => {
        throw new Error('must not parse body');
      },
    });
    assert.equal(result.status, 405);
    assert.equal(result.body?.error, 'method_not_allowed');
    assert.equal(JSON.stringify(result.body ?? {}).includes('Access-Control'), false);
  }
});

test('does not parse JSON or mention secrets before authentication succeeds', async () => {
  let parsed = 0;
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature',
    }),
    env: configuredEnv,
    readJson: async () => {
      parsed += 1;
      return { mode: 'live' };
    },
  });
  assert.equal(parsed, 0);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, error: 'unauthorized' });
  assert.equal(JSON.stringify(result.body).includes(SECRET), false);
});

test('authenticated dry-run POST does not enter live delivery', async () => {
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: configuredEnv,
    readJson: async () => ({ mode: 'dry_run' }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body?.mode, 'dry_run');
  assert.equal(result.body?.claimed, false);
  assert.equal(result.body?.mutated, false);
});
