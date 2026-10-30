export const CLAIM_RPC = 'claim_due_push_deliveries' as const;
export const CLAIM_RPC_ARGS = {
  p_limit: 50,
  p_lease_seconds: 120,
} as const;
export const COMPLETE_RPC = 'complete_claimed_push_delivery' as const;
export const RECORD_RECEIPT_RPC = 'record_push_delivery_receipt' as const;
export const FORGET_TOKEN_RPC = 'forget_unregistered_push_token' as const;
export const LIST_AWAITING_RECEIPTS_RPC =
  'list_sent_push_deliveries_awaiting_receipts' as const;
export const LIST_AWAITING_RECEIPTS_RPC_ARGS = {
  p_limit: 100,
  p_min_age_seconds: 900,
  p_max_age_seconds: 86400,
} as const;

export type PushDeliveryMode = 'dry_run' | 'live' | 'receipts';

export type PushDeliveryEnv = {
  pushDeliverySecret: string | undefined;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  liveDeliveryEnabled?: string;
  receiptsEnabled?: string;
  expoAccessToken?: string;
};

export type DryRunResponse = {
  ok: true;
  mode: 'dry_run';
  mutated: false;
  claimed: false;
  expo: false;
  supabaseConfigured: boolean;
  claimRpc: typeof CLAIM_RPC;
  missing: string[];
};

export function resolveDeliveryMode(body: unknown): PushDeliveryMode | undefined {
  if (body === null || body === undefined) {
    return 'dry_run';
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const mode = (body as { mode?: unknown }).mode;
  if (mode === undefined || mode === 'dry_run') {
    return 'dry_run';
  }

  if (mode === 'live') {
    return 'live';
  }

  if (mode === 'receipts') {
    return 'receipts';
  }

  return undefined;
}

export function missingPushDeliveryConfig(env: PushDeliveryEnv): string[] {
  const missing: string[] = [];
  if (env.supabaseUrl === undefined || env.supabaseUrl.trim().length === 0) {
    missing.push('SUPABASE_URL');
  }

  if (
    env.supabaseServiceRoleKey === undefined ||
    env.supabaseServiceRoleKey.trim().length === 0
  ) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  return missing;
}

export function buildDryRunResponse(env: PushDeliveryEnv): DryRunResponse {
  const missing = missingPushDeliveryConfig(env);

  return {
    ok: true,
    mode: 'dry_run',
    mutated: false,
    claimed: false,
    expo: false,
    supabaseConfigured: missing.length === 0,
    claimRpc: CLAIM_RPC,
    missing,
  };
}

export function runDeliverBookingPush(input: {
  mode: PushDeliveryMode;
  env: PushDeliveryEnv;
}): { status: number; body: Record<string, unknown> } {
  if (input.mode === 'live') {
    return {
      status: 501,
      body: {
        ok: false,
        error: 'live_delivery_not_enabled',
        mutated: false,
        claimed: false,
        expo: false,
      },
    };
  }

  if (input.mode === 'receipts') {
    return {
      status: 501,
      body: {
        ok: false,
        error: 'receipts_not_enabled',
        mutated: false,
        claimed: false,
        expo: false,
      },
    };
  }

  return {
    status: 200,
    body: buildDryRunResponse(input.env),
  };
}
