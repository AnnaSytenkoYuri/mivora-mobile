import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseClaimBatch, parseClaimedDeliveries } from './push-delivery-claim.ts';
import {
  CLAIM_RPC,
  CLAIM_RPC_ARGS,
  COMPLETE_RPC,
  FORGET_TOKEN_RPC,
  RECORD_RECEIPT_RPC,
  runDeliverBookingPush,
} from './push-delivery-dry-run.ts';
import {
  chunkExpoMessages,
  classifyTicket,
  isValidExpoPushToken,
  parseExpoTicket,
  parseExpoTickets,
  postExpoPushMessages,
  sanitizePushErrorMessage,
} from './push-delivery-expo.ts';
import { handleDeliverBookingPushHttp } from './push-delivery-http.ts';
import { createLivePushDeliveryRunner } from './push-delivery-live.ts';
import {
  EXPO_MAX_MESSAGES_PER_REQUEST as TYPES_BATCH_LIMIT,
  EXPO_PUSH_SEND_URL,
  isLiveDeliveryEnabled,
  type ClaimedDelivery,
  type CompleteClaimedPushDeliveryArgs,
  type ExpoPushMessage,
  type ExpoSendResult,
} from './push-delivery-types.ts';
import { runPushDeliveryWorker } from './push-delivery-worker.ts';

const SECRET = 'delivery-secret-ok';

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name: string) {
      return map.get(name.toLowerCase()) ?? null;
    },
  };
}

function claimed(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    delivery_id: 11,
    notification_id: 22,
    push_token_id: '11111111-1111-1111-1111-111111111111',
    expo_push_token: 'ExponentPushToken[abcdEFGH1234]',
    platform: 'ios',
    recipient_id: '22222222-2222-2222-2222-222222222222',
    type: 'booking_created',
    title: 'New booking',
    body: 'You have a new booking.',
    attempt_count: 1,
    claim_nonce: '33333333-3333-3333-3333-333333333333',
    claimed_until: '2026-10-28T15:00:00.000Z',
    ...overrides,
  };
}

test('live delivery flag is disabled unless exactly true', () => {
  assert.equal(isLiveDeliveryEnabled(undefined), false);
  assert.equal(isLiveDeliveryEnabled(''), false);
  assert.equal(isLiveDeliveryEnabled('TRUE'), false);
  assert.equal(isLiveDeliveryEnabled('1'), false);
  assert.equal(isLiveDeliveryEnabled('true'), true);
});

test('Expo token format matches the SQL worker contract', () => {
  assert.equal(isValidExpoPushToken('ExponentPushToken[abcdEFGH1234]'), true);
  assert.equal(isValidExpoPushToken('ExpoPushToken[abcdEFGH1234]'), true);
  assert.equal(isValidExpoPushToken('not-a-token'), false);
  assert.equal(TYPES_BATCH_LIMIT, 100);
});

test('tickets classify sent, retryable, and permanent without treating ok as device delivery', () => {
  assert.deepEqual(classifyTicket({ status: 'ok', id: 'ticket-1' }), {
    outcome: 'sent',
    ticketId: 'ticket-1',
    errorCode: null,
    errorMessage: null,
  });
  assert.equal(classifyTicket({ status: 'ok' }).outcome, 'retryable');
  assert.equal(
    classifyTicket({
      status: 'error',
      message: '"ExponentPushToken[abcdEFGH1234]" is not registered',
      details: { error: 'DeviceNotRegistered' },
    }).outcome,
    'permanent',
  );
  assert.equal(
    sanitizePushErrorMessage('"ExponentPushToken[abcdEFGH1234]" is not registered'),
    '"[token]" is not registered',
  );
  assert.equal(chunkExpoMessages(new Array(101).fill({} as ExpoPushMessage)).length, 2);
});

test('parseClaimedDeliveries follows claim_due_push_deliveries column names', () => {
  const rows = parseClaimedDeliveries([
    {
      delivery_id: '11',
      notification_id: '22',
      push_token_id: '11111111-1111-1111-1111-111111111111',
      expo_push_token: 'ExponentPushToken[abcdEFGH1234]',
      platform: 'ios',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'booking_confirmed',
      title: 'Confirmed',
      body: 'Your booking is confirmed.',
      attempt_count: 1,
      claim_nonce: '33333333-3333-3333-3333-333333333333',
      claimed_until: '2026-10-28T15:00:00.000Z',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.delivery_id, 11);
  assert.equal(rows[0]?.type, 'booking_confirmed');
  assert.deepEqual(parseClaimedDeliveries(null), []);
});

test('worker sends a valid booking event and completes with the claim nonce', async () => {
  const completes: CompleteClaimedPushDeliveryArgs[] = [];
  const sentBatches: ExpoPushMessage[][] = [];
  const row = claimed();

  const summary = await runPushDeliveryWorker({
    claim: async () => [row],
    complete: async (args) => {
      completes.push(args);
      return true;
    },
    sendExpo: async (messages) => {
      sentBatches.push(messages);
      return { kind: 'tickets', tickets: [{ status: 'ok', id: 'ticket-ok' }] };
    },
  });

  assert.deepEqual(summary, {
    ok: true,
    mode: 'live',
    claimed: 1,
    sent: 1,
    retryable: 0,
    permanent: 0,
    skipped: 0,
    complete_failed: 0,
  });
  assert.equal(sentBatches.length, 1);
  assert.equal(sentBatches[0]?.[0]?.to, row.expo_push_token);
  assert.equal(sentBatches[0]?.[0]?.title, row.title);
  assert.equal(sentBatches[0]?.[0]?.body, row.body);
  assert.deepEqual(sentBatches[0]?.[0]?.data, {
    source: 'remote_booking',
    notificationId: '22',
    type: 'booking_created',
  });
  assert.deepEqual(completes, [
    {
      p_delivery_id: 11,
      p_claim_nonce: row.claim_nonce,
      p_outcome: 'sent',
      p_expo_ticket_id: 'ticket-ok',
      p_error_code: null,
      p_error_message: null,
    },
  ]);
});

test('worker marks retryable Expo HTTP failures without a second local retry loop', async () => {
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed()],
    complete: async () => true,
    sendExpo: async () => ({ kind: 'http_failure', status: 429, errorCode: 'TOO_MANY_REQUESTS' }),
  });
  assert.equal(summary.retryable, 1);
  assert.equal(summary.sent, 0);
});

test('worker marks DeviceNotRegistered tickets permanent and does not forget tokens', async () => {
  const completes: CompleteClaimedPushDeliveryArgs[] = [];
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed()],
    complete: async (args) => {
      completes.push(args);
      return true;
    },
    sendExpo: async () => ({
      kind: 'tickets',
      tickets: [
        {
          status: 'error',
          details: { error: 'DeviceNotRegistered' },
          message: 'not registered',
        },
      ],
    }),
  });
  assert.equal(summary.permanent, 1);
  assert.equal(completes[0]?.p_outcome, 'permanent');
  assert.equal(completes[0]?.p_error_code, 'DeviceNotRegistered');
});

test('worker completes partial ticket batches independently', async () => {
  const completes: CompleteClaimedPushDeliveryArgs[] = [];
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed({ delivery_id: 1, claim_nonce: 'n1' }), claimed({ delivery_id: 2, claim_nonce: 'n2' })],
    complete: async (args) => {
      completes.push(args);
      return true;
    },
    sendExpo: async () => ({
      kind: 'tickets',
      tickets: [
        { status: 'ok', id: 't-ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }),
  });
  assert.equal(summary.sent, 1);
  assert.equal(summary.permanent, 1);
  assert.equal(completes[0]?.p_outcome, 'sent');
  assert.equal(completes[1]?.p_outcome, 'permanent');
});

test('worker skips invalid tokens and reminder types without calling Expo', async () => {
  let expoCalls = 0;
  const completes: CompleteClaimedPushDeliveryArgs[] = [];
  const summary = await runPushDeliveryWorker({
    claim: async () => [
      claimed({ delivery_id: 1, claim_nonce: 'n1', expo_push_token: 'bad-token' }),
      claimed({
        delivery_id: 2,
        claim_nonce: 'n2',
        type: 'booking_reminder_24h',
      }),
    ],
    complete: async (args) => {
      completes.push(args);
      return true;
    },
    sendExpo: async () => {
      expoCalls += 1;
      return { kind: 'tickets', tickets: [] };
    },
  });
  assert.equal(expoCalls, 0);
  assert.equal(summary.skipped, 2);
  assert.equal(completes[0]?.p_error_code, 'invalid_token');
  assert.equal(completes[1]?.p_error_code, 'unsupported_type');
});

test('network failures complete the leased batch as retryable', async () => {
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed()],
    complete: async () => true,
    sendExpo: async () => ({ kind: 'http_failure', status: 0, errorCode: 'expo_network' }),
  });
  assert.equal(summary.retryable, 1);
});

test('empty claim returns zero counts and does not send', async () => {
  let expoCalls = 0;
  const summary = await runPushDeliveryWorker({
    claim: async () => [],
    complete: async () => {
      throw new Error('complete must not run');
    },
    sendExpo: async () => {
      expoCalls += 1;
      return { kind: 'tickets', tickets: [] };
    },
  });
  assert.equal(expoCalls, 0);
  assert.deepEqual(summary, {
    ok: true,
    mode: 'live',
    claimed: 0,
    sent: 0,
    retryable: 0,
    permanent: 0,
    skipped: 0,
    complete_failed: 0,
  });
});

test('live HTTP stays 501 when the feature flag is off and never runs the worker', async () => {
  let liveCalls = 0;
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      liveDeliveryEnabled: 'false',
    },
    readJson: async () => ({ mode: 'live' }),
    runLiveDelivery: async () => {
      liveCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(liveCalls, 0);
  assert.equal(result.status, 501);
  assert.equal(result.body?.error, 'live_delivery_not_enabled');
});

test('dry-run never initializes live delivery even when the flag is on', async () => {
  let liveCalls = 0;
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      liveDeliveryEnabled: 'true',
    },
    readJson: async () => ({ mode: 'dry_run' }),
    runLiveDelivery: async () => {
      liveCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(liveCalls, 0);
  assert.equal(result.status, 200);
  assert.equal(result.body?.mode, 'dry_run');
  assert.equal(result.body?.claimed, false);
  assert.equal(result.body?.expo, false);
});

test('enabled live mode claims and completes through the exact RPC names only', async () => {
  const rpcNames: string[] = [];
  const row = claimed();
  let createdClients = 0;
  const runLive = createLivePushDeliveryRunner({
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      liveDeliveryEnabled: 'true',
    },
    createServiceClient: () => {
      createdClients += 1;
      return {
        rpc: async (fn, args) => {
          rpcNames.push(fn);
          if (fn === CLAIM_RPC) {
            assert.deepEqual(args, { p_limit: 50, p_lease_seconds: 120 });
            return { data: [row], error: null };
          }
          if (fn === COMPLETE_RPC) {
            assert.equal(args.p_delivery_id, row.delivery_id);
            assert.equal(args.p_claim_nonce, row.claim_nonce);
            assert.equal(args.p_outcome, 'sent');
            return { data: true, error: null };
          }
          throw new Error(`unexpected rpc ${fn}`);
        },
      };
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ data: [{ status: 'ok', id: 'ticket-live' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      liveDeliveryEnabled: 'true',
    },
    readJson: async () => ({ mode: 'live' }),
    runLiveDelivery: runLive,
  });

  assert.equal(createdClients, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body?.sent, 1);
  assert.deepEqual(rpcNames, [CLAIM_RPC, COMPLETE_RPC]);
  assert.equal(rpcNames.includes(RECORD_RECEIPT_RPC), false);
  assert.equal(rpcNames.includes(FORGET_TOKEN_RPC), false);
  assert.deepEqual(CLAIM_RPC_ARGS, { p_limit: 50, p_lease_seconds: 120 });
});

test('enabled live mode does not construct a client when Supabase env is missing', async () => {
  let createdClients = 0;
  const runLive = createLivePushDeliveryRunner({
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: undefined,
      supabaseServiceRoleKey: undefined,
      liveDeliveryEnabled: 'true',
    },
    createServiceClient: () => {
      createdClients += 1;
      throw new Error('client must not be created');
    },
    fetchImpl: async () => {
      throw new Error('expo must not be called');
    },
  });

  const result = await runLive();
  assert.equal(createdClients, 0);
  assert.equal(result.status, 503);
  assert.equal(result.body?.error, 'live_misconfigured');
});

test('postExpoPushMessages uses the Expo send URL, optional access token, and classifies HTTP failures', async () => {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const ok = await postExpoPushMessages({
    messages: [
      {
        to: 'ExponentPushToken[abcdEFGH1234]',
        title: 't',
        body: 'b',
        sound: 'default',
        data: { source: 'remote_booking', notificationId: '1', type: 'booking_created' },
      },
    ],
    accessToken: 'expo-access-token',
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ data: [{ status: 'ok', id: 't1' }] }), { status: 200 });
    },
  });
  assert.equal(ok.kind, 'tickets');
  assert.equal(calls[0]?.url, EXPO_PUSH_SEND_URL);
  assert.equal(calls[0]?.headers.get('Authorization'), 'Bearer expo-access-token');

  const failed: ExpoSendResult = await postExpoPushMessages({
    messages: [
      {
        to: 'ExponentPushToken[abcdEFGH1234]',
        title: 't',
        body: 'b',
        sound: 'default',
        data: { source: 'remote_booking', notificationId: '1', type: 'booking_created' },
      },
    ],
    accessToken: undefined,
    fetchImpl: async () => new Response('nope', { status: 503 }),
  });
  assert.deepEqual(failed, { kind: 'http_failure', status: 503, errorCode: 'expo_http' });

  const malformed = await postExpoPushMessages({
    messages: [
      {
        to: 'ExponentPushToken[abcdEFGH1234]',
        title: 't',
        body: 'b',
        sound: 'default',
        data: { source: 'remote_booking', notificationId: '1', type: 'booking_created' },
      },
    ],
    accessToken: undefined,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 99 }] }), { status: 200 }),
  });
  assert.deepEqual(malformed, { kind: 'http_failure', status: 200, errorCode: 'ticket_parse' });
});

test('runDeliverBookingPush live path remains 501 without worker side effects', () => {
  const live = runDeliverBookingPush({
    mode: 'live',
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  });
  assert.equal(live.status, 501);
  assert.equal(live.body.error, 'live_delivery_not_enabled');
});

test('malformed Expo tickets are rejected instead of being assigned', () => {
  assert.equal(parseExpoTicket('ok'), undefined);
  assert.equal(parseExpoTicket({ status: 'OK', id: 't1' }), undefined);
  assert.equal(parseExpoTicket({ status: 'ok', id: 12 }), undefined);
  assert.equal(parseExpoTicket({ status: 'error', details: { error: 1 } }), undefined);
  assert.deepEqual(parseExpoTicket({ status: 'ok', id: 't1' }), { status: 'ok', id: 't1' });
  assert.equal(parseExpoTickets({ data: [{ status: 'ok', id: 't1' }, 'nope'] }), undefined);
  assert.equal(parseExpoTickets({ data: [{ status: 'ok', id: 't1' }] })?.length, 1);
});

test('mismatched Expo ticket counts complete the whole batch as retryable', async () => {
  const completes: CompleteClaimedPushDeliveryArgs[] = [];
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed({ delivery_id: 1, claim_nonce: 'n1' }), claimed({ delivery_id: 2, claim_nonce: 'n2' })],
    complete: async (args) => {
      completes.push(args);
      return true;
    },
    sendExpo: async () => ({
      kind: 'tickets',
      tickets: [{ status: 'ok', id: 'only-one' }],
    }),
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.retryable, 2);
  assert.equal(summary.complete_failed, 0);
  assert.equal(completes.every((args) => args.p_outcome === 'retryable'), true);
  assert.equal(completes.every((args) => args.p_error_code === 'ticket_count_mismatch'), true);
  assert.equal(completes.every((args) => args.p_expo_ticket_id === null), true);
});

test('stale complete RPC results are not counted as sent', async () => {
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed()],
    complete: async () => false,
    sendExpo: async () => ({ kind: 'tickets', tickets: [{ status: 'ok', id: 'ticket-ok' }] }),
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.retryable, 0);
  assert.equal(summary.permanent, 0);
  assert.equal(summary.complete_failed, 1);
});

test('thrown complete RPC is not counted as a persisted retryable outcome', async () => {
  const summary = await runPushDeliveryWorker({
    claim: async () => [claimed()],
    complete: async () => {
      throw new Error('complete_failed');
    },
    sendExpo: async () => ({ kind: 'tickets', tickets: [{ status: 'ok', id: 'ticket-ok' }] }),
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.retryable, 0);
  assert.equal(summary.complete_failed, 1);
});

test('malformed claim rows with a nonce are completed retryable; others are left leased', () => {
  const batch = parseClaimBatch([
    {
      delivery_id: 11,
      notification_id: 22,
      push_token_id: '11111111-1111-1111-1111-111111111111',
      expo_push_token: 'ExponentPushToken[abcdEFGH1234]',
      platform: 'ios',
      recipient_id: '22222222-2222-2222-2222-222222222222',
      type: 'booking_created',
      title: 'New booking',
      body: 'You have a new booking.',
      attempt_count: 1,
      claim_nonce: '33333333-3333-3333-3333-333333333333',
      claimed_until: '2026-10-28T15:00:00.000Z',
    },
    { delivery_id: 12, claim_nonce: 'lease-only' },
    { delivery_id: 13 },
    null,
  ]);
  assert.equal(batch.rows.length, 1);
  assert.deepEqual(batch.recover, [{ delivery_id: 12, claim_nonce: 'lease-only' }]);
});

test('live runner completes malformed claim leases with the nonce and does not send them', async () => {
  const rpcNames: string[] = [];
  const outcomes: unknown[] = [];
  let expoCalls = 0;
  const runLive = createLivePushDeliveryRunner({
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      liveDeliveryEnabled: 'true',
    },
    createServiceClient: () => ({
      rpc: async (fn, args) => {
        rpcNames.push(fn);
        if (fn === CLAIM_RPC) {
          return {
            data: [{ delivery_id: 12, claim_nonce: 'lease-only' }],
            error: null,
          };
        }
        if (fn === COMPLETE_RPC) {
          outcomes.push(args.p_outcome);
          assert.equal(args.p_claim_nonce, 'lease-only');
          assert.equal(args.p_error_code, 'malformed_claim');
          return { data: true, error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
    }),
    fetchImpl: async () => {
      expoCalls += 1;
      return new Response('nope', { status: 500 });
    },
  });

  const result = await runLive();
  assert.equal(result.status, 200);
  assert.equal(expoCalls, 0);
  assert.deepEqual(outcomes, ['retryable']);
  assert.equal(rpcNames.includes(CLAIM_RPC), true);
  assert.equal(rpcNames.includes(COMPLETE_RPC), true);
});
