import { createHash, timingSafeEqual } from 'node:crypto';

export const PUSH_DELIVERY_SECRET_HEADER = 'x-mivora-push-delivery-secret';
export const PUSH_DELIVERY_SECRET_ENV = 'PUSH_DELIVERY_SECRET';
export const PUSH_DELIVERY_SECRET_MIN_LENGTH = 16;

export type PushDeliveryAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: 'unauthorized' | 'misconfigured' };

function readBearerToken(authorization: string | null): string | undefined {
  if (authorization === null) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}

export function presentedPushDeliverySecret(headers: {
  get(name: string): string | null;
}): string | undefined {
  const fromHeader = headers.get(PUSH_DELIVERY_SECRET_HEADER);
  if (fromHeader !== null && fromHeader.length > 0) {
    return fromHeader;
  }

  return readBearerToken(headers.get('authorization'));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function secretsEqual(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

export function authorizePushDeliveryRequest(input: {
  configuredSecret: string | undefined;
  presentedSecret: string | undefined;
}): PushDeliveryAuthResult {
  const configured = input.configuredSecret ?? '';
  if (configured.length < PUSH_DELIVERY_SECRET_MIN_LENGTH) {
    return { ok: false, status: 503, error: 'misconfigured' };
  }

  const presented = input.presentedSecret ?? '';
  if (!secretsEqual(presented, configured)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  return { ok: true };
}
