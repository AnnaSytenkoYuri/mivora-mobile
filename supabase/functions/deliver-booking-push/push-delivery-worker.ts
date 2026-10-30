import {
  buildExpoPushMessage,
  chunkExpoMessages,
  classifyTicket,
  deliveryIsSendable,
} from './push-delivery-expo.ts';
import type {
  ClaimedDelivery,
  CompleteClaimedPushDeliveryArgs,
  ExpoPushMessage,
  ExpoSendResult,
} from './push-delivery-types.ts';

export type PushDeliveryWorkerSummary = {
  ok: true;
  mode: 'live';
  claimed: number;
  sent: number;
  retryable: number;
  permanent: number;
  skipped: number;
  complete_failed: number;
};

export type PushDeliveryWorkerDeps = {
  claim: () => Promise<ClaimedDelivery[]>;
  complete: (args: CompleteClaimedPushDeliveryArgs) => Promise<boolean>;
  sendExpo: (messages: ExpoPushMessage[]) => Promise<ExpoSendResult>;
};

function emptySummary(claimed: number): PushDeliveryWorkerSummary {
  return {
    ok: true,
    mode: 'live',
    claimed,
    sent: 0,
    retryable: 0,
    permanent: 0,
    skipped: 0,
    complete_failed: 0,
  };
}

function tally(
  summary: PushDeliveryWorkerSummary,
  outcome: CompleteClaimedPushDeliveryArgs['p_outcome'],
): void {
  if (outcome === 'sent') {
    summary.sent += 1;
  } else if (outcome === 'retryable') {
    summary.retryable += 1;
  } else if (outcome === 'permanent') {
    summary.permanent += 1;
  } else {
    summary.skipped += 1;
  }
}

async function completeRow(
  deps: PushDeliveryWorkerDeps,
  row: Pick<ClaimedDelivery, 'delivery_id' | 'claim_nonce'>,
  args: Omit<CompleteClaimedPushDeliveryArgs, 'p_delivery_id' | 'p_claim_nonce'>,
  summary: PushDeliveryWorkerSummary,
): Promise<void> {
  try {
    const completed = await deps.complete({
      p_delivery_id: row.delivery_id,
      p_claim_nonce: row.claim_nonce,
      ...args,
    });
    if (completed) {
      tally(summary, args.p_outcome);
    } else {
      summary.complete_failed += 1;
    }
  } catch {
    summary.complete_failed += 1;
  }
}

export async function runPushDeliveryWorker(
  deps: PushDeliveryWorkerDeps,
): Promise<PushDeliveryWorkerSummary> {
  const claimed = await deps.claim();
  const summary = emptySummary(claimed.length);
  const sendable: { row: ClaimedDelivery; message: ExpoPushMessage }[] = [];

  for (const row of claimed) {
    const check = deliveryIsSendable(row);
    if (!check.ok) {
      await completeRow(
        deps,
        row,
        {
          p_outcome: check.outcome,
          p_expo_ticket_id: null,
          p_error_code: check.errorCode,
          p_error_message: check.errorMessage,
        },
        summary,
      );
      continue;
    }

    sendable.push({ row, message: buildExpoPushMessage(row) });
  }

  const batches = chunkExpoMessages(sendable.map((item) => item.message));
  let offset = 0;

  for (const batch of batches) {
    const slice = sendable.slice(offset, offset + batch.length);
    offset += batch.length;

    const expoResult = await deps.sendExpo(batch);
    if (expoResult.kind === 'http_failure' || expoResult.tickets.length !== slice.length) {
      const errorCode =
        expoResult.kind === 'http_failure' ? expoResult.errorCode : 'ticket_count_mismatch';
      const errorMessage =
        expoResult.kind === 'http_failure'
          ? 'Expo push request failed.'
          : 'Expo ticket count does not match the send batch.';
      for (const item of slice) {
        await completeRow(
          deps,
          item.row,
          {
            p_outcome: 'retryable',
            p_expo_ticket_id: null,
            p_error_code: errorCode,
            p_error_message: errorMessage,
          },
          summary,
        );
      }
      continue;
    }

    for (let index = 0; index < slice.length; index += 1) {
      const classified = classifyTicket(expoResult.tickets[index]);
      await completeRow(
        deps,
        slice[index].row,
        {
          p_outcome: classified.outcome,
          p_expo_ticket_id: classified.ticketId,
          p_error_code: classified.errorCode,
          p_error_message: classified.errorMessage,
        },
        summary,
      );
    }
  }

  return summary;
}
