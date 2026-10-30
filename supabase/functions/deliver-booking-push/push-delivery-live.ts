import { parseClaimBatch } from './push-delivery-claim.ts';
import {
  CLAIM_RPC,
  CLAIM_RPC_ARGS,
  COMPLETE_RPC,
  missingPushDeliveryConfig,
  type PushDeliveryEnv,
} from './push-delivery-dry-run.ts';
import { postExpoPushMessages } from './push-delivery-expo.ts';
import type { PushDeliveryHttpResult } from './push-delivery-http.ts';
import type { CompleteClaimedPushDeliveryArgs } from './push-delivery-types.ts';
import { runPushDeliveryWorker } from './push-delivery-worker.ts';

export type PushDeliveryRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type PushDeliveryRpcClient = {
  rpc(fn: string, args: Record<string, unknown>): Promise<PushDeliveryRpcResult>;
};

export function createLivePushDeliveryRunner(input: {
  env: PushDeliveryEnv;
  createServiceClient: (url: string, serviceRoleKey: string) => PushDeliveryRpcClient;
  fetchImpl: typeof fetch;
}): () => Promise<PushDeliveryHttpResult> {
  return async () => {
    const missing = missingPushDeliveryConfig(input.env);
    if (missing.length > 0) {
      return {
        status: 503,
        body: { ok: false, error: 'live_misconfigured', missing },
      };
    }

    const url = input.env.supabaseUrl;
    const serviceRoleKey = input.env.supabaseServiceRoleKey;
    if (url === undefined || serviceRoleKey === undefined) {
      return {
        status: 503,
        body: { ok: false, error: 'live_misconfigured', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] },
      };
    }

    const client = input.createServiceClient(url, serviceRoleKey);

    try {
      const summary = await runPushDeliveryWorker({
        claim: async () => {
          const result = await client.rpc(CLAIM_RPC, { ...CLAIM_RPC_ARGS });
          if (result.error !== null) {
            throw new Error('claim_failed');
          }

          const batch = parseClaimBatch(result.data);
          for (const lease of batch.recover) {
            try {
              await client.rpc(COMPLETE_RPC, {
                p_delivery_id: lease.delivery_id,
                p_claim_nonce: lease.claim_nonce,
                p_outcome: 'retryable',
                p_expo_ticket_id: null,
                p_error_code: 'malformed_claim',
                p_error_message: 'Claimed delivery is missing required fields.',
              });
            } catch {
              // Leave the lease to expire if this nonce-protected complete fails.
            }
          }

          return batch.rows;
        },
        complete: async (args: CompleteClaimedPushDeliveryArgs) => {
          const result = await client.rpc(COMPLETE_RPC, {
            p_delivery_id: args.p_delivery_id,
            p_claim_nonce: args.p_claim_nonce,
            p_outcome: args.p_outcome,
            p_expo_ticket_id: args.p_expo_ticket_id,
            p_error_code: args.p_error_code,
            p_error_message: args.p_error_message,
          });
          if (result.error !== null) {
            throw new Error('complete_failed');
          }

          return result.data === true;
        },
        sendExpo: (messages) =>
          postExpoPushMessages({
            messages,
            accessToken: input.env.expoAccessToken,
            fetchImpl: input.fetchImpl,
          }),
      });

      return { status: 200, body: summary };
    } catch {
      return { status: 500, body: { ok: false, error: 'live_delivery_failed' } };
    }
  };
}
