import type { ClaimedDelivery } from './push-delivery-types.ts';

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return undefined;
}

export type RecoverableClaimLease = {
  delivery_id: number;
  claim_nonce: string;
};

export type ParsedClaimBatch = {
  rows: ClaimedDelivery[];
  recover: RecoverableClaimLease[];
};

export function parseClaimLease(row: unknown): RecoverableClaimLease | undefined {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return undefined;
  }

  const record = row as Record<string, unknown>;
  const delivery_id = coerceFiniteNumber(record.delivery_id);
  const claim_nonce = coerceString(record.claim_nonce);
  if (delivery_id === undefined || claim_nonce === undefined || claim_nonce.length === 0) {
    return undefined;
  }

  return { delivery_id, claim_nonce };
}

export function parseClaimedDelivery(row: unknown): ClaimedDelivery | undefined {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return undefined;
  }

  const record = row as Record<string, unknown>;
  const delivery_id = coerceFiniteNumber(record.delivery_id);
  const notification_id = coerceFiniteNumber(record.notification_id);
  const push_token_id = coerceString(record.push_token_id);
  const expo_push_token = coerceString(record.expo_push_token);
  const platform = coerceString(record.platform);
  const recipient_id = coerceString(record.recipient_id);
  const type = coerceString(record.type);
  const title = coerceString(record.title);
  const body = coerceString(record.body);
  const attempt_count = coerceFiniteNumber(record.attempt_count);
  const claim_nonce = coerceString(record.claim_nonce);
  const claimed_until = coerceString(record.claimed_until);

  if (
    delivery_id === undefined ||
    notification_id === undefined ||
    push_token_id === undefined ||
    expo_push_token === undefined ||
    platform === undefined ||
    recipient_id === undefined ||
    type === undefined ||
    title === undefined ||
    body === undefined ||
    attempt_count === undefined ||
    claim_nonce === undefined ||
    claimed_until === undefined
  ) {
    return undefined;
  }

  return {
    delivery_id,
    notification_id,
    push_token_id,
    expo_push_token,
    platform,
    recipient_id,
    type,
    title,
    body,
    attempt_count,
    claim_nonce,
    claimed_until,
  };
}

export function parseClaimBatch(data: unknown): ParsedClaimBatch {
  if (data === null || data === undefined) {
    return { rows: [], recover: [] };
  }

  if (!Array.isArray(data)) {
    throw new Error('claim_shape');
  }

  const rows: ClaimedDelivery[] = [];
  const recover: RecoverableClaimLease[] = [];
  for (const item of data) {
    const parsed = parseClaimedDelivery(item);
    if (parsed !== undefined) {
      rows.push(parsed);
      continue;
    }

    const lease = parseClaimLease(item);
    if (lease !== undefined) {
      recover.push(lease);
    }
  }

  return { rows, recover };
}

export function parseClaimedDeliveries(data: unknown): ClaimedDelivery[] {
  return parseClaimBatch(data).rows;
}
