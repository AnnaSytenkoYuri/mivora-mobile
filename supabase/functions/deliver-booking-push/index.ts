import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  PUSH_DELIVERY_SECRET_ENV,
} from './push-delivery-auth.ts';
import { handleDeliverBookingPushHttp } from './push-delivery-http.ts';
import {
  createLivePushDeliveryRunner,
  type PushDeliveryRpcClient,
} from './push-delivery-live.ts';
import { createReceiptProcessingRunner } from './push-delivery-receipts.ts';
import {
  EXPO_ACCESS_TOKEN_ENV,
  PUSH_LIVE_DELIVERY_ENABLED_ENV,
  PUSH_RECEIPTS_ENABLED_ENV,
} from './push-delivery-types.ts';

function json(body: Record<string, unknown> | null, status: number): Response {
  if (body === null) {
    return new Response(null, { status });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value === undefined || value.length === 0 ? undefined : value;
}

Deno.serve(async (request) => {
  try {
    const env = {
      pushDeliverySecret: readEnv(PUSH_DELIVERY_SECRET_ENV),
      supabaseUrl: readEnv('SUPABASE_URL'),
      supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
      liveDeliveryEnabled: readEnv(PUSH_LIVE_DELIVERY_ENABLED_ENV),
      receiptsEnabled: readEnv(PUSH_RECEIPTS_ENABLED_ENV),
      expoAccessToken: readEnv(EXPO_ACCESS_TOKEN_ENV),
    };

    const createServiceClient = (url: string, serviceRoleKey: string) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as PushDeliveryRpcClient;

    const result = await handleDeliverBookingPushHttp({
      method: request.method,
      headers: request.headers,
      env,
      readJson: () => request.json(),
      runLiveDelivery: createLivePushDeliveryRunner({
        env,
        fetchImpl: fetch,
        createServiceClient,
      }),
      runReceiptProcessing: createReceiptProcessingRunner({
        env,
        fetchImpl: fetch,
        createServiceClient,
      }),
    });
    return json(result.body, result.status);
  } catch {
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
