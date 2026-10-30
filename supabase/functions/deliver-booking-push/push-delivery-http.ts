import {
  authorizePushDeliveryRequest,
  presentedPushDeliverySecret,
} from './push-delivery-auth.ts';
import {
  resolveDeliveryMode,
  runDeliverBookingPush,
  type PushDeliveryEnv,
} from './push-delivery-dry-run.ts';
import { isLiveDeliveryEnabled, isReceiptsEnabled } from './push-delivery-types.ts';

export type PushDeliveryHttpResult = {
  status: number;
  body: Record<string, unknown> | null;
};

function isJsonContentType(contentType: string): boolean {
  return /^application\/json\s*(;|$)/i.test(contentType.trim());
}

export async function handleDeliverBookingPushHttp(input: {
  method: string;
  headers: { get(name: string): string | null };
  env: PushDeliveryEnv;
  readJson: () => Promise<unknown>;
  runLiveDelivery?: () => Promise<PushDeliveryHttpResult>;
  runReceiptProcessing?: () => Promise<PushDeliveryHttpResult>;
}): Promise<PushDeliveryHttpResult> {
  if (input.method !== 'POST') {
    return { status: 405, body: { ok: false, error: 'method_not_allowed' } };
  }

  const auth = authorizePushDeliveryRequest({
    configuredSecret: input.env.pushDeliverySecret,
    presentedSecret: presentedPushDeliverySecret(input.headers),
  });
  if (!auth.ok) {
    return { status: auth.status, body: { ok: false, error: auth.error } };
  }

  const contentType = input.headers.get('content-type') ?? '';
  let body: unknown = undefined;
  if (isJsonContentType(contentType)) {
    try {
      body = await input.readJson();
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid_json' } };
    }
  }

  const mode = resolveDeliveryMode(body);
  if (mode === undefined) {
    return { status: 400, body: { ok: false, error: 'invalid_mode' } };
  }

  if (mode === 'dry_run') {
    return runDeliverBookingPush({
      mode,
      env: input.env,
    });
  }

  if (mode === 'receipts') {
    if (!isReceiptsEnabled(input.env.receiptsEnabled)) {
      return runDeliverBookingPush({
        mode: 'receipts',
        env: input.env,
      });
    }

    if (input.runReceiptProcessing === undefined) {
      return { status: 500, body: { ok: false, error: 'receipts_failed' } };
    }

    return input.runReceiptProcessing();
  }

  if (!isLiveDeliveryEnabled(input.env.liveDeliveryEnabled)) {
    return runDeliverBookingPush({
      mode: 'live',
      env: input.env,
    });
  }

  if (input.runLiveDelivery === undefined) {
    return { status: 500, body: { ok: false, error: 'live_delivery_failed' } };
  }

  return input.runLiveDelivery();
}
