# deliver-booking-push

Edge Function for Mivora booking-event Expo push delivery.

`mode: "dry_run"` is **read-only**. It does not create a database client, does not call worker RPCs, and does not contact Expo.

`mode: "live"` sends Expo tickets only when `PUSH_LIVE_DELIVERY_ENABLED=true`. Any other value (including unset) returns HTTP 501 `live_delivery_not_enabled` and does not claim or send.

`mode: "receipts"` processes Expo push receipts only when `PUSH_RECEIPTS_ENABLED=true`. Any other value (including unset) returns HTTP 501 `receipts_not_enabled` and does not create a client or call Expo. This flag does **not** enable live send.

There is no read-only due-queue RPC (`push_deliveries` has no client or service-role table grants). Dry-run therefore returns a readiness payload instead of inspecting or leasing rows.

## Required secrets (Dashboard → Edge Functions → Secrets)

Set values in the project; do not commit them.

| Name | Purpose |
|---|---|
| `PUSH_DELIVERY_SECRET` | Dedicated invoke secret, at least 16 characters. Callers must send it as `x-mivora-push-delivery-secret` or `Authorization: Bearer <secret>`. User JWTs are not accepted. Never put this in the Expo app or `EXPO_PUBLIC_*` env. |
| `PUSH_LIVE_DELIVERY_ENABLED` | Live-delivery feature flag. Must be the exact string `true` to send. Disabled by default. Independent of receipts. |
| `PUSH_RECEIPTS_ENABLED` | Receipt-processing feature flag. Must be the exact string `true` to list/getReceipts/record. Disabled by default. Independent of live send. |
| `EXPO_ACCESS_TOKEN` | Optional Expo Push access token (`Authorization: Bearer …` on Expo Push HTTP APIs). Required only if Expo Push security is enabled for the project. |
| `SUPABASE_URL` | Provided automatically on hosted functions. Used only after auth on enabled live or receipts paths. |
| `SUPABASE_SERVICE_ROLE_KEY` | Provided automatically on hosted functions. Used only after auth on enabled live or receipts paths. Never expose to the app. |

`verify_jwt` is false **only** for `deliver-booking-push` in `supabase/config.toml`. The handler still requires `PUSH_DELIVERY_SECRET` before any privileged work. POST is the only method; OPTIONS is not a CORS preflight (no browser `Access-Control-*` headers).

## Live worker (Step 7A)

After auth and `PUSH_LIVE_DELIVERY_ENABLED=true`:

1. Claim due rows with `claim_due_push_deliveries(p_limit := 50, p_lease_seconds := 120)`.
2. Skip reminder types and malformed tokens (`skipped`); do not POST them to Expo.
3. POST at most 100 messages per request to Expo, one request at a time.
4. Map tickets: `ok` + ticket id → `sent`; `DeviceNotRegistered` / `MessageTooBig` → `permanent`; HTTP 429/5xx/network/timeout/other ticket errors → `retryable`.
5. Finish each row with `complete_claimed_push_delivery` using that row's `claim_nonce`.

`sent` means Expo **accepted a ticket**, not that APNs/FCM delivered to the device.

## Receipt worker (Step 7D, local wiring)

After auth and `PUSH_RECEIPTS_ENABLED=true`, the handler creates a service-role client and:

1. Lists due tickets with `list_sent_push_deliveries_awaiting_receipts(p_limit := 100, p_min_age_seconds := 900, p_max_age_seconds := 86400)`.
2. POSTs those ticket ids to Expo `getReceipts` (max 1000, sequential, 20s timeout). One pass per invocation.
3. Records and forgets using the existing RPCs as below.

When a list of `{ delivery_id, expo_ticket_id, push_token_id }` is supplied:

1. `POST https://exp.host/--/api/v2/push/getReceipts` with `{ ids }` (max 1000, sequential batches, 20s timeout). One pass per invocation; no polling loop.
2. Missing IDs (receipt not ready): leave the row unchecked (`pending`). Do not record or forget.
3. HTTP 429/5xx/network/timeout: `retryable` for that batch. Do not record or forget.
4. Receipt `ok`: `record_push_delivery_receipt(p_delivery_id, p_expo_ticket_id, 'ok', NULL)`.
5. Receipt `error`: `record_push_delivery_receipt(..., 'error', p_error_code)`. SQL requires an error code; Expo `details.error` is used, else `receipt_error`. SQL does **not** accept `p_error_message`.
6. `forget_unregistered_push_token(p_delivery_id, p_push_token_id, p_expo_ticket_id)` only after a `DeviceNotRegistered` receipt and only when `push_token_id` is present. SQL also requires `status=sent`, matching ticket, recorded error, and recipient ownership.

First receipt wins (`receipt_checked_at IS NULL`). Recording does not move a row off `sent`. Tokens are never deleted for missing receipts or HTTP failures.

## Existing RPC signatures (do not invent extras)

```
list_sent_push_deliveries_awaiting_receipts(
  p_limit integer DEFAULT 100,
  p_min_age_seconds integer DEFAULT 900,
  p_max_age_seconds integer DEFAULT 86400
) RETURNS TABLE (delivery_id bigint, expo_ticket_id text, push_token_id uuid)

record_push_delivery_receipt(
  p_delivery_id bigint,
  p_expo_ticket_id text,
  p_receipt_status text,        -- 'ok' | 'error'
  p_error_code text DEFAULT NULL
) RETURNS boolean

forget_unregistered_push_token(
  p_delivery_id bigint,
  p_push_token_id uuid,
  p_expo_ticket_id text
) RETURNS boolean
```

## Receipt list RPC

`list_sent_push_deliveries_awaiting_receipts` is applied on production. This function is **not** redeployed in this step. `push_deliveries` still has no table SELECT. The list RPC returns `delivery_id`, `expo_ticket_id`, and `push_token_id` only. Age uses `ticketed_at`.

## Invoke (do not enable live on production in this step)

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/deliver-booking-push" \
  -H "Content-Type: application/json" \
  -H "x-mivora-push-delivery-secret: <PUSH_DELIVERY_SECRET>" \
  -d '{"mode":"dry_run"}'
```

`mode: "live"` returns 501 until `PUSH_LIVE_DELIVERY_ENABLED=true`.
`mode: "receipts"` returns 501 `receipts_not_enabled` until `PUSH_RECEIPTS_ENABLED=true`.

## Remaining work before deployment

- Deploy this Edge Function after review (currently production is still dry-run-only).
- Set `PUSH_RECEIPTS_ENABLED=true` only when ready; leave live send off until 7A is reviewed.
- Scheduler / pg_cron after live send + receipts are reviewed.
- Client handling of `source: remote_booking` notification data.
