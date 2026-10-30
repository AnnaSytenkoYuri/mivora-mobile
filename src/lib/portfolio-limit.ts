export const PORTFOLIO_PHOTO_LIMIT = 12;

export const PORTFOLIO_PHOTO_LIMIT_MESSAGE = 'A provider can have at most 12 portfolio photos.';

export function mapPortfolioLimitError(message: string | undefined): string | undefined {
  const text = message ?? '';
  if (/at most 12 portfolio photos/i.test(text)) {
    return `You can add up to ${PORTFOLIO_PHOTO_LIMIT} portfolio photos.`;
  }

  return undefined;
}

type BeginInsert =
  | { blocked: true }
  | { blocked: false; allowed: false }
  | {
      blocked: false;
      allowed: true;
      commit: () => void;
      rollback: () => void;
    };

export function createPortfolioLimitStore(limit: number = PORTFOLIO_PHOTO_LIMIT) {
  const counts = new Map<string, number>();
  const locked = new Set<string>();

  function countOf(providerId: string): number {
    return counts.get(providerId) ?? 0;
  }

  return {
    count: countOf,
    setCount(providerId: string, count: number) {
      counts.set(providerId, count);
    },
    deleteOne(providerId: string) {
      counts.set(providerId, Math.max(0, countOf(providerId) - 1));
    },
    beginInsert(providerId: string): BeginInsert {
      if (locked.has(providerId)) {
        return { blocked: true };
      }

      locked.add(providerId);
      if (countOf(providerId) >= limit) {
        locked.delete(providerId);
        return { blocked: false, allowed: false };
      }

      let settled = false;
      return {
        blocked: false,
        allowed: true,
        commit() {
          if (settled) {
            return;
          }

          settled = true;
          counts.set(providerId, countOf(providerId) + 1);
          locked.delete(providerId);
        },
        rollback() {
          if (settled) {
            return;
          }

          settled = true;
          locked.delete(providerId);
        },
      };
    },
    insertMany(providerId: string, quantity: number): { ok: true; count: number } | { ok: false; count: number } {
      if (locked.has(providerId)) {
        return { ok: false, count: countOf(providerId) };
      }

      locked.add(providerId);
      const next = countOf(providerId) + quantity;
      if (next > limit) {
        locked.delete(providerId);
        return { ok: false, count: countOf(providerId) };
      }

      counts.set(providerId, next);
      locked.delete(providerId);
      return { ok: true, count: next };
    },
  };
}
