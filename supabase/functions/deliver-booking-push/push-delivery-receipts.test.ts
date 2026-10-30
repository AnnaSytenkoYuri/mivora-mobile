import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLAIM_RPC,
  COMPLETE_RPC,
  FORGET_TOKEN_RPC,
  LIST_AWAITING_RECEIPTS_RPC,
  LIST_AWAITING_RECEIPTS_RPC_ARGS,
  RECORD_RECEIPT_RPC,
} from './push-delivery-dry-run.ts';
import { handleDeliverBookingPushHttp } from './push-delivery-http.ts';
import {
  chunkReceiptIds,
  createReceiptProcessingRunner,
  parseAwaitingReceipts,
  parseExpoReceipts,
  postExpoGetReceipts,
  runPushReceiptWorker,
} from './push-delivery-receipts.ts';
import {
  EXPO_MAX_RECEIPT_IDS_PER_REQUEST,
  EXPO_PUSH_RECEIPTS_URL,
  isReceiptsEnabled,
  type AwaitingReceipt,
  type ForgetUnregisteredPushTokenArgs,
  type RecordPushDeliveryReceiptArgs,
} from './push-delivery-types.ts';

const SECRET = 'delivery-secret-ok';

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name: string) {
      return map.get(name.toLowerCase()) ?? null;
    },
  };
}

function awaiting(overrides: Partial<AwaitingReceipt> = {}): AwaitingReceipt {
  return {
    delivery_id: 44,
    expo_ticket_id: 'ticket-1',
    push_token_id: '11111111-1111-1111-1111-111111111111',
    ...overrides,
  };
}

test('receipt batches stay at Expo getReceipts limit of 1000', () => {
  assert.equal(EXPO_MAX_RECEIPT_IDS_PER_REQUEST, 1000);
  assert.equal(chunkReceiptIds(new Array(1001).fill('t')).length, 2);
  assert.equal(chunkReceiptIds(new Array(1000).fill('t')).length, 1);
});

test('parseAwaitingReceipts uses ticket id, delivery id, and optional token id', () => {
  assert.deepEqual(
    parseAwaitingReceipts([
      {
        delivery_id: '44',
        expo_ticket_id: ' ticket-1 ',
        push_token_id: '11111111-1111-1111-1111-111111111111',
      },
    ]),
    [awaiting()],
  );
  assert.deepEqual(parseAwaitingReceipts(null), []);
  assert.deepEqual(parseAwaitingReceipts([{ delivery_id: 1 }]), []);
});

test('ok receipts record matching ticket ids and never forget tokens', async () => {
  const records: RecordPushDeliveryReceiptArgs[] = [];
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async (args) => {
      records.push(args);
      return true;
    },
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({ kind: 'receipts', receipts: { 'ticket-1': { status: 'ok' } } }),
  });
  assert.deepEqual(summary, {
    ok: true,
    mode: 'receipts',
    listed: 1,
    recorded_ok: 1,
    recorded_error: 0,
    forgotten: 0,
    pending: 0,
    retryable: 0,
    record_failed: 0,
  });
  assert.deepEqual(records, [
    {
      p_delivery_id: 44,
      p_expo_ticket_id: 'ticket-1',
      p_receipt_status: 'ok',
      p_error_code: null,
    },
  ]);
  assert.equal(forgets, 0);
});

test('DeviceNotRegistered receipts record then forget using the SQL identity triple', async () => {
  const records: RecordPushDeliveryReceiptArgs[] = [];
  const forgets: ForgetUnregisteredPushTokenArgs[] = [];
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async (args) => {
      records.push(args);
      return true;
    },
    forget: async (args) => {
      forgets.push(args);
      return true;
    },
    getReceipts: async () => ({
      kind: 'receipts',
      receipts: {
        'ticket-1': {
          status: 'error',
          details: { error: 'DeviceNotRegistered' },
          message: '"ExponentPushToken[abcd]" is not registered',
        },
      },
    }),
  });
  assert.equal(summary.recorded_error, 1);
  assert.equal(summary.forgotten, 1);
  assert.deepEqual(records[0], {
    p_delivery_id: 44,
    p_expo_ticket_id: 'ticket-1',
    p_receipt_status: 'error',
    p_error_code: 'DeviceNotRegistered',
  });
  assert.deepEqual(forgets[0], {
    p_delivery_id: 44,
    p_push_token_id: '11111111-1111-1111-1111-111111111111',
    p_expo_ticket_id: 'ticket-1',
  });
});

test('other permanent receipt errors are recorded and do not delete tokens', async () => {
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async () => true,
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({
      kind: 'receipts',
      receipts: {
        'ticket-1': { status: 'error', details: { error: 'MessageTooBig' } },
      },
    }),
  });
  assert.equal(summary.recorded_error, 1);
  assert.equal(forgets, 0);
});

test('missing receipts stay pending and do not mutate tokens or receipt columns', async () => {
  let records = 0;
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async () => {
      records += 1;
      return true;
    },
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({ kind: 'receipts', receipts: {} }),
  });
  assert.equal(summary.pending, 1);
  assert.equal(records, 0);
  assert.equal(forgets, 0);
});

test('retryable Expo receipt HTTP failures do not record or forget', async () => {
  let records = 0;
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting(), awaiting({ delivery_id: 45, expo_ticket_id: 'ticket-2' })],
    record: async () => {
      records += 1;
      return true;
    },
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({ kind: 'http_failure', status: 503, errorCode: 'expo_http' }),
  });
  assert.equal(summary.retryable, 2);
  assert.equal(records, 0);
  assert.equal(forgets, 0);
});

test('DeviceNotRegistered without a token id records and skips forget', async () => {
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting({ push_token_id: null })],
    record: async () => true,
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({
      kind: 'receipts',
      receipts: {
        'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }),
  });
  assert.equal(summary.recorded_error, 1);
  assert.equal(summary.forgotten, 0);
  assert.equal(forgets, 0);
});

test('extra Expo receipt ids are ignored', async () => {
  const records: RecordPushDeliveryReceiptArgs[] = [];
  await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async (args) => {
      records.push(args);
      return true;
    },
    forget: async () => true,
    getReceipts: async () => ({
      kind: 'receipts',
      receipts: {
        'ticket-1': { status: 'ok' },
        'other-ticket': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.p_expo_ticket_id, 'ticket-1');
});

test('empty list does not call Expo', async () => {
  let expoCalls = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [],
    record: async () => {
      throw new Error('record must not run');
    },
    forget: async () => {
      throw new Error('forget must not run');
    },
    getReceipts: async () => {
      expoCalls += 1;
      return { kind: 'receipts', receipts: {} };
    },
  });
  assert.equal(expoCalls, 0);
  assert.equal(summary.listed, 0);
});

test('postExpoGetReceipts posts ids to the receipts URL', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const result = await postExpoGetReceipts({
    ticketIds: ['ticket-1'],
    accessToken: undefined,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ data: { 'ticket-1': { status: 'ok' } } }), {
        status: 200,
      });
    },
  });
  assert.equal(calls[0]?.url, EXPO_PUSH_RECEIPTS_URL);
  assert.deepEqual(calls[0]?.body, { ids: ['ticket-1'] });
  assert.equal(result.kind, 'receipts');
});

test('parseExpoReceipts reads the Expo map format', () => {
  const parsed = parseExpoReceipts({
    data: {
      'ticket-1': { status: 'ok' },
      'ticket-2': {
        status: 'error',
        message: 'too big',
        details: { error: 'MessageTooBig' },
      },
    },
  });
  assert.equal(parsed?.['ticket-1']?.status, 'ok');
  assert.equal(parsed?.['ticket-2']?.details?.error, 'MessageTooBig');
});

test('receipts flag is disabled unless exactly true', () => {
  assert.equal(isReceiptsEnabled(undefined), false);
  assert.equal(isReceiptsEnabled('TRUE'), false);
  assert.equal(isReceiptsEnabled('true'), true);
});

test('receipts HTTP stays 501 when the flag is off and never runs workers', async () => {
  let liveCalls = 0;
  let receiptCalls = 0;
  let createdClients = 0;
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
      receiptsEnabled: 'false',
    },
    readJson: async () => ({ mode: 'receipts' }),
    runLiveDelivery: async () => {
      liveCalls += 1;
      return { status: 200, body: { ok: true } };
    },
    runReceiptProcessing: async () => {
      receiptCalls += 1;
      createdClients += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(liveCalls, 0);
  assert.equal(receiptCalls, 0);
  assert.equal(createdClients, 0);
  assert.equal(result.status, 501);
  assert.equal(result.body?.error, 'receipts_not_enabled');
  assert.equal(result.body?.expo, false);
  assert.equal(result.body?.mutated, false);
});

test('unauthorized receipts requests do not parse JSON or start processing', async () => {
  let parsed = 0;
  let receiptCalls = 0;
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature',
    }),
    env: {
      pushDeliverySecret: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      receiptsEnabled: 'true',
    },
    readJson: async () => {
      parsed += 1;
      return { mode: 'receipts' };
    },
    runReceiptProcessing: async () => {
      receiptCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(parsed, 0);
  assert.equal(receiptCalls, 0);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, error: 'unauthorized' });
});

test('dry-run does not enter receipt processing', async () => {
  let receiptCalls = 0;
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
      receiptsEnabled: 'true',
    },
    readJson: async () => ({ mode: 'dry_run' }),
    runReceiptProcessing: async () => {
      receiptCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(receiptCalls, 0);
  assert.equal(result.status, 200);
  assert.equal(result.body?.mode, 'dry_run');
});

test('receipt worker RPCs match existing SQL names and never claim or complete', async () => {
  assert.equal(RECORD_RECEIPT_RPC, 'record_push_delivery_receipt');
  assert.equal(FORGET_TOKEN_RPC, 'forget_unregistered_push_token');
  assert.equal(LIST_AWAITING_RECEIPTS_RPC, 'list_sent_push_deliveries_awaiting_receipts');
  assert.deepEqual(LIST_AWAITING_RECEIPTS_RPC_ARGS, {
    p_limit: 100,
    p_min_age_seconds: 900,
    p_max_age_seconds: 86400,
  });
  assert.equal(CLAIM_RPC, 'claim_due_push_deliveries');
  assert.equal(COMPLETE_RPC, 'complete_claimed_push_delivery');
});

const enabledReceiptsEnv = {
  pushDeliverySecret: SECRET,
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'service-role-key',
  liveDeliveryEnabled: 'false',
  receiptsEnabled: 'true',
};

test('enabled receipts mode lists, records ok receipts, and never claims', async () => {
  const rpcNames: string[] = [];
  const row = awaiting();
  let createdClients = 0;
  const runReceipts = createReceiptProcessingRunner({
    env: enabledReceiptsEnv,
    createServiceClient: () => {
      createdClients += 1;
      return {
        rpc: async (fn, args) => {
          rpcNames.push(fn);
          if (fn === LIST_AWAITING_RECEIPTS_RPC) {
            assert.deepEqual(args, { ...LIST_AWAITING_RECEIPTS_RPC_ARGS });
            return { data: [row], error: null };
          }
          if (fn === RECORD_RECEIPT_RPC) {
            assert.equal(args.p_delivery_id, row.delivery_id);
            assert.equal(args.p_expo_ticket_id, row.expo_ticket_id);
            assert.equal(args.p_receipt_status, 'ok');
            assert.equal(args.p_error_code, null);
            return { data: true, error: null };
          }
          throw new Error(`unexpected rpc ${fn}`);
        },
      };
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { 'ticket-1': { status: 'ok' } } }), { status: 200 }),
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: enabledReceiptsEnv,
    readJson: async () => ({ mode: 'receipts' }),
    runReceiptProcessing: runReceipts,
  });

  assert.equal(createdClients, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body?.recorded_ok, 1);
  assert.equal(result.body?.forgotten, 0);
  assert.deepEqual(rpcNames, [LIST_AWAITING_RECEIPTS_RPC, RECORD_RECEIPT_RPC]);
  assert.equal(rpcNames.includes(CLAIM_RPC), false);
  assert.equal(rpcNames.includes(COMPLETE_RPC), false);
  assert.equal(JSON.stringify(result.body).includes(row.push_token_id ?? ''), false);
});

test('enabled receipts mode records DeviceNotRegistered then forgets with the SQL triple', async () => {
  const rpcNames: string[] = [];
  const row = awaiting();
  const runReceipts = createReceiptProcessingRunner({
    env: enabledReceiptsEnv,
    createServiceClient: () => ({
      rpc: async (fn, args) => {
        rpcNames.push(fn);
        if (fn === LIST_AWAITING_RECEIPTS_RPC) {
          return { data: [row], error: null };
        }
        if (fn === RECORD_RECEIPT_RPC) {
          assert.equal(args.p_error_code, 'DeviceNotRegistered');
          return { data: true, error: null };
        }
        if (fn === FORGET_TOKEN_RPC) {
          assert.equal(args.p_delivery_id, row.delivery_id);
          assert.equal(args.p_push_token_id, row.push_token_id);
          assert.equal(args.p_expo_ticket_id, row.expo_ticket_id);
          return { data: true, error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
    }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
          },
        }),
        { status: 200 },
      ),
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: enabledReceiptsEnv,
    readJson: async () => ({ mode: 'receipts' }),
    runReceiptProcessing: runReceipts,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body?.recorded_error, 1);
  assert.equal(result.body?.forgotten, 1);
  assert.deepEqual(rpcNames, [LIST_AWAITING_RECEIPTS_RPC, RECORD_RECEIPT_RPC, FORGET_TOKEN_RPC]);
});

test('false record RPC results are not counted as recorded', async () => {
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async () => false,
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({ kind: 'receipts', receipts: { 'ticket-1': { status: 'ok' } } }),
  });
  assert.equal(summary.recorded_ok, 0);
  assert.equal(summary.record_failed, 1);
  assert.equal(forgets, 0);
});

test('DeviceNotRegistered still forgets after a false record when SQL identity can match', async () => {
  let forgets = 0;
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async () => false,
    forget: async () => {
      forgets += 1;
      return true;
    },
    getReceipts: async () => ({
      kind: 'receipts',
      receipts: {
        'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }),
  });
  assert.equal(summary.recorded_error, 0);
  assert.equal(summary.record_failed, 1);
  assert.equal(summary.forgotten, 1);
  assert.equal(forgets, 1);
});

test('thrown record RPC is not counted as a persisted receipt', async () => {
  const summary = await runPushReceiptWorker({
    list: async () => [awaiting()],
    record: async () => {
      throw new Error('record_failed');
    },
    forget: async () => true,
    getReceipts: async () => ({ kind: 'receipts', receipts: { 'ticket-1': { status: 'ok' } } }),
  });
  assert.equal(summary.recorded_ok, 0);
  assert.equal(summary.retryable, 0);
  assert.equal(summary.record_failed, 1);
});

test('missing Expo receipts stay pending without record or forget', async () => {
  const rpcNames: string[] = [];
  const runReceipts = createReceiptProcessingRunner({
    env: enabledReceiptsEnv,
    createServiceClient: () => ({
      rpc: async (fn) => {
        rpcNames.push(fn);
        if (fn === LIST_AWAITING_RECEIPTS_RPC) {
          return { data: [awaiting()], error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
    }),
    fetchImpl: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: enabledReceiptsEnv,
    readJson: async () => ({ mode: 'receipts' }),
    runReceiptProcessing: runReceipts,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body?.pending, 1);
  assert.deepEqual(rpcNames, [LIST_AWAITING_RECEIPTS_RPC]);
});

test('list RPC errors return 500 without Expo or mutations', async () => {
  let expoCalls = 0;
  let createdClients = 0;
  const runReceipts = createReceiptProcessingRunner({
    env: enabledReceiptsEnv,
    createServiceClient: () => {
      createdClients += 1;
      return {
        rpc: async () => ({ data: null, error: { message: 'boom' } }),
      };
    },
    fetchImpl: async () => {
      expoCalls += 1;
      return new Response('nope', { status: 500 });
    },
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: enabledReceiptsEnv,
    readJson: async () => ({ mode: 'receipts' }),
    runReceiptProcessing: runReceipts,
  });

  assert.equal(createdClients, 1);
  assert.equal(expoCalls, 0);
  assert.equal(result.status, 500);
  assert.equal(result.body?.error, 'receipts_failed');
});

test('invalid list RPC payload returns 500 without Expo', async () => {
  let expoCalls = 0;
  const runReceipts = createReceiptProcessingRunner({
    env: enabledReceiptsEnv,
    createServiceClient: () => ({
      rpc: async () => ({ data: { unexpected: true }, error: null }),
    }),
    fetchImpl: async () => {
      expoCalls += 1;
      return new Response('nope', { status: 200 });
    },
  });

  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: enabledReceiptsEnv,
    readJson: async () => ({ mode: 'receipts' }),
    runReceiptProcessing: runReceipts,
  });

  assert.equal(expoCalls, 0);
  assert.equal(result.status, 500);
  assert.equal(result.body?.error, 'receipts_failed');
});

test('receipts flag does not enable live send', async () => {
  let liveCalls = 0;
  let receiptCalls = 0;
  const result = await handleDeliverBookingPushHttp({
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      'x-mivora-push-delivery-secret': SECRET,
    }),
    env: {
      ...enabledReceiptsEnv,
      liveDeliveryEnabled: undefined,
      receiptsEnabled: 'true',
    },
    readJson: async () => ({ mode: 'live' }),
    runLiveDelivery: async () => {
      liveCalls += 1;
      return { status: 200, body: { ok: true } };
    },
    runReceiptProcessing: async () => {
      receiptCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(result.status, 501);
  assert.equal(result.body?.error, 'live_delivery_not_enabled');
  assert.equal(liveCalls, 0);
  assert.equal(receiptCalls, 0);
});

test('live-send flag does not enable receipts', async () => {
  let liveCalls = 0;
  let receiptCalls = 0;
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
      receiptsEnabled: undefined,
    },
    readJson: async () => ({ mode: 'receipts' }),
    runLiveDelivery: async () => {
      liveCalls += 1;
      return { status: 200, body: { ok: true } };
    },
    runReceiptProcessing: async () => {
      receiptCalls += 1;
      return { status: 200, body: { ok: true } };
    },
  });
  assert.equal(result.status, 501);
  assert.equal(result.body?.error, 'receipts_not_enabled');
  assert.equal(liveCalls, 0);
  assert.equal(receiptCalls, 0);
});
