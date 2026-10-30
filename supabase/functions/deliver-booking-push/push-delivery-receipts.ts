import {
  FORGET_TOKEN_RPC,
  LIST_AWAITING_RECEIPTS_RPC,
  LIST_AWAITING_RECEIPTS_RPC_ARGS,
  RECORD_RECEIPT_RPC,
  missingPushDeliveryConfig,
  type PushDeliveryEnv,
} from './push-delivery-dry-run.ts';
import { classifyExpoHttpFailure } from './push-delivery-expo.ts';
import type { PushDeliveryHttpResult } from './push-delivery-http.ts';
import type { PushDeliveryRpcClient } from './push-delivery-live.ts';
import {
  EXPO_MAX_RECEIPT_IDS_PER_REQUEST,
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_REQUEST_TIMEOUT_MS,
  type AwaitingReceipt,
  type ExpoReceipt,
  type ExpoReceiptsResult,
  type ForgetUnregisteredPushTokenArgs,
  type RecordPushDeliveryReceiptArgs,
} from './push-delivery-types.ts';

export type PushReceiptWorkerSummary = {
  ok: true;
  mode: 'receipts';
  listed: number;
  recorded_ok: number;
  recorded_error: number;
  forgotten: number;
  pending: number;
  retryable: number;
  record_failed: number;
};

export type PushReceiptWorkerDeps = {
  list: () => Promise<AwaitingReceipt[]>;
  record: (args: RecordPushDeliveryReceiptArgs) => Promise<boolean>;
  forget: (args: ForgetUnregisteredPushTokenArgs) => Promise<boolean>;
  getReceipts: (ticketIds: string[]) => Promise<ExpoReceiptsResult>;
};

export function chunkReceiptIds(
  ids: string[],
  size = EXPO_MAX_RECEIPT_IDS_PER_REQUEST,
): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

export function parseExpoReceipts(payload: unknown): Record<string, ExpoReceipt> | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const data = (payload as { data?: unknown }).data;
  if (data === null || data === undefined) {
    return {};
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }

  const receipts: Record<string, ExpoReceipt> = {};
  for (const [ticketId, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const status = (value as { status?: unknown }).status;
    if (status !== 'ok' && status !== 'error') {
      continue;
    }

    const message = (value as { message?: unknown }).message;
    const details = (value as { details?: unknown }).details;
    const errorCode =
      details !== null && typeof details === 'object' && !Array.isArray(details)
        ? (details as { error?: unknown }).error
        : undefined;

    receipts[ticketId] = {
      status,
      message: typeof message === 'string' ? message : undefined,
      details: typeof errorCode === 'string' ? { error: errorCode } : undefined,
    };
  }

  return receipts;
}

export function parseAwaitingReceipt(row: unknown): AwaitingReceipt | undefined {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return undefined;
  }

  const record = row as Record<string, unknown>;
  const delivery_id =
    typeof record.delivery_id === 'number' && Number.isFinite(record.delivery_id)
      ? record.delivery_id
      : typeof record.delivery_id === 'string' && record.delivery_id.trim().length > 0
        ? Number(record.delivery_id)
        : undefined;
  const expo_ticket_id =
    typeof record.expo_ticket_id === 'string' ? record.expo_ticket_id.trim() : undefined;
  const push_token_id =
    typeof record.push_token_id === 'string' && record.push_token_id.length > 0
      ? record.push_token_id
      : null;

  if (delivery_id === undefined || !Number.isFinite(delivery_id) || expo_ticket_id === undefined || expo_ticket_id.length === 0) {
    return undefined;
  }

  return { delivery_id, expo_ticket_id, push_token_id };
}

export function parseAwaitingReceipts(data: unknown): AwaitingReceipt[] {
  if (data === null || data === undefined) {
    return [];
  }

  if (!Array.isArray(data)) {
    throw new Error('receipt_list_shape');
  }

  const rows: AwaitingReceipt[] = [];
  for (const item of data) {
    const parsed = parseAwaitingReceipt(item);
    if (parsed !== undefined) {
      rows.push(parsed);
    }
  }

  return rows;
}

function receiptErrorCode(receipt: ExpoReceipt): string {
  const code = receipt.details?.error?.trim();
  if (code !== undefined && code.length > 0) {
    return code.length > 100 ? code.slice(0, 100) : code;
  }

  return 'receipt_error';
}

export async function postExpoGetReceipts(input: {
  ticketIds: string[];
  accessToken: string | undefined;
  fetchImpl: typeof fetch;
}): Promise<ExpoReceiptsResult> {
  if (input.ticketIds.length === 0) {
    return { kind: 'receipts', receipts: {} };
  }

  if (input.ticketIds.length > EXPO_MAX_RECEIPT_IDS_PER_REQUEST) {
    return { kind: 'http_failure', status: 400, errorCode: 'PUSH_TOO_MANY_RECEIPTS' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (input.accessToken !== undefined && input.accessToken.length > 0) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPO_REQUEST_TIMEOUT_MS);

  try {
    const response = await input.fetchImpl(EXPO_PUSH_RECEIPTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: input.ticketIds }),
      signal: controller.signal,
    });

    if (response.status !== 200) {
      const classified = classifyExpoHttpFailure(response.status);
      return { kind: 'http_failure', status: response.status, errorCode: classified.errorCode };
    }

    const payload: unknown = await response.json();
    const receipts = parseExpoReceipts(payload);
    if (receipts === undefined) {
      return { kind: 'http_failure', status: 200, errorCode: 'receipt_parse' };
    }

    return { kind: 'receipts', receipts };
  } catch {
    return { kind: 'http_failure', status: 0, errorCode: 'expo_network' };
  } finally {
    clearTimeout(timer);
  }
}

function emptySummary(listed: number): PushReceiptWorkerSummary {
  return {
    ok: true,
    mode: 'receipts',
    listed,
    recorded_ok: 0,
    recorded_error: 0,
    forgotten: 0,
    pending: 0,
    retryable: 0,
    record_failed: 0,
  };
}

export async function runPushReceiptWorker(
  deps: PushReceiptWorkerDeps,
): Promise<PushReceiptWorkerSummary> {
  const listed = await deps.list();
  const summary = emptySummary(listed.length);
  const byTicket = new Map<string, AwaitingReceipt[]>();

  for (const row of listed) {
    const group = byTicket.get(row.expo_ticket_id) ?? [];
    group.push(row);
    byTicket.set(row.expo_ticket_id, group);
  }

  const ticketIds = [...byTicket.keys()];
  const batches = chunkReceiptIds(ticketIds);

  for (const batch of batches) {
    const expoResult = await deps.getReceipts(batch);
    if (expoResult.kind === 'http_failure') {
      summary.retryable += batch.reduce(
        (count, ticketId) => count + (byTicket.get(ticketId)?.length ?? 0),
        0,
      );
      continue;
    }

    for (const ticketId of batch) {
      const rows = byTicket.get(ticketId) ?? [];
      const receipt = expoResult.receipts[ticketId];
      if (receipt === undefined) {
        summary.pending += rows.length;
        continue;
      }

      for (const row of rows) {
        try {
          if (receipt.status === 'ok') {
            const recorded = await deps.record({
              p_delivery_id: row.delivery_id,
              p_expo_ticket_id: row.expo_ticket_id,
              p_receipt_status: 'ok',
              p_error_code: null,
            });
            if (recorded) {
              summary.recorded_ok += 1;
            } else {
              summary.record_failed += 1;
            }
            continue;
          }

          const errorCode = receiptErrorCode(receipt);
          const recorded = await deps.record({
            p_delivery_id: row.delivery_id,
            p_expo_ticket_id: row.expo_ticket_id,
            p_receipt_status: 'error',
            p_error_code: errorCode,
          });
          if (recorded) {
            summary.recorded_error += 1;
          } else {
            summary.record_failed += 1;
          }

          if (errorCode === 'DeviceNotRegistered' && row.push_token_id !== null) {
            const forgotten = await deps.forget({
              p_delivery_id: row.delivery_id,
              p_push_token_id: row.push_token_id,
              p_expo_ticket_id: row.expo_ticket_id,
            });
            if (forgotten) {
              summary.forgotten += 1;
            }
          }
        } catch {
          summary.record_failed += 1;
        }
      }
    }
  }

  return summary;
}

export function createReceiptProcessingRunner(input: {
  env: PushDeliveryEnv;
  createServiceClient: (url: string, serviceRoleKey: string) => PushDeliveryRpcClient;
  fetchImpl: typeof fetch;
}): () => Promise<PushDeliveryHttpResult> {
  return async () => {
    const missing = missingPushDeliveryConfig(input.env);
    if (missing.length > 0) {
      return {
        status: 503,
        body: { ok: false, error: 'receipts_misconfigured', missing },
      };
    }

    const url = input.env.supabaseUrl;
    const serviceRoleKey = input.env.supabaseServiceRoleKey;
    if (url === undefined || serviceRoleKey === undefined) {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'receipts_misconfigured',
          missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        },
      };
    }

    const client = input.createServiceClient(url, serviceRoleKey);

    try {
      const summary = await runPushReceiptWorker({
        list: async () => {
          const result = await client.rpc(LIST_AWAITING_RECEIPTS_RPC, {
            ...LIST_AWAITING_RECEIPTS_RPC_ARGS,
          });
          if (result.error !== null) {
            throw new Error('list_failed');
          }

          return parseAwaitingReceipts(result.data);
        },
        record: async (args) => {
          const result = await client.rpc(RECORD_RECEIPT_RPC, {
            p_delivery_id: args.p_delivery_id,
            p_expo_ticket_id: args.p_expo_ticket_id,
            p_receipt_status: args.p_receipt_status,
            p_error_code: args.p_error_code,
          });
          if (result.error !== null) {
            throw new Error('record_failed');
          }

          return result.data === true;
        },
        forget: async (args) => {
          const result = await client.rpc(FORGET_TOKEN_RPC, {
            p_delivery_id: args.p_delivery_id,
            p_push_token_id: args.p_push_token_id,
            p_expo_ticket_id: args.p_expo_ticket_id,
          });
          if (result.error !== null) {
            throw new Error('forget_failed');
          }

          return result.data === true;
        },
        getReceipts: (ticketIds) =>
          postExpoGetReceipts({
            ticketIds,
            accessToken: input.env.expoAccessToken,
            fetchImpl: input.fetchImpl,
          }),
      });

      return { status: 200, body: summary };
    } catch {
      return { status: 500, body: { ok: false, error: 'receipts_failed' } };
    }
  };
}
