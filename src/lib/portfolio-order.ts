export type PortfolioOrderDirection = 'left' | 'right';

export type OrderedPortfolioPhoto = {
  id: string;
  providerId: string;
  sortOrder: number;
};

export const PORTFOLIO_REORDER_DENIED = 'Not allowed to move this photo.';
export const PORTFOLIO_REORDER_SIGN_IN = 'Sign in to reorder portfolio photos.';
export const PORTFOLIO_REORDER_INVALID = 'A valid photo and direction (left or right) are required.';

export function comparePortfolioOrder(
  left: Pick<OrderedPortfolioPhoto, 'id' | 'sortOrder'>,
  right: Pick<OrderedPortfolioPhoto, 'id' | 'sortOrder'>,
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

export function sortPortfolioPhotos<T extends Pick<OrderedPortfolioPhoto, 'id' | 'sortOrder'>>(
  items: readonly T[],
): T[] {
  return [...items].sort(comparePortfolioOrder);
}

export function canMovePortfolioPhoto(
  items: readonly Pick<OrderedPortfolioPhoto, 'id' | 'sortOrder'>[],
  photoId: string,
  direction: PortfolioOrderDirection,
): boolean {
  const ordered = sortPortfolioPhotos([...items]);
  const index = ordered.findIndex((item) => item.id === photoId);
  if (index < 0) {
    return false;
  }

  if (direction === 'left') {
    return index > 0;
  }

  return index < ordered.length - 1;
}

export function moveOwnedPortfolioPhoto(
  items: readonly OrderedPortfolioPhoto[],
  photoId: string,
  direction: PortfolioOrderDirection,
  ownerProviderId: string | null | undefined,
):
  | { ok: true; items: OrderedPortfolioPhoto[] }
  | { ok: false; reason: 'signed-out' | 'not-found' | 'not-owner' | 'invalid' | 'boundary' } {
  if (!ownerProviderId) {
    return { ok: false, reason: 'signed-out' };
  }

  if (photoId.trim().length === 0 || (direction !== 'left' && direction !== 'right')) {
    return { ok: false, reason: 'invalid' };
  }

  const target = items.find((item) => item.id === photoId);
  if (!target) {
    return { ok: false, reason: 'not-found' };
  }

  if (target.providerId !== ownerProviderId) {
    return { ok: false, reason: 'not-owner' };
  }

  const owned = sortPortfolioPhotos(items.filter((item) => item.providerId === ownerProviderId));
  const index = owned.findIndex((item) => item.id === photoId);
  if (index < 0) {
    return { ok: false, reason: 'not-found' };
  }

  const swapWith = direction === 'left' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= owned.length) {
    return { ok: false, reason: 'boundary' };
  }

  const next = [...owned];
  const current = next[index];
  const neighbor = next[swapWith];
  if (!current || !neighbor) {
    return { ok: false, reason: 'boundary' };
  }

  next[index] = neighbor;
  next[swapWith] = current;

  return {
    ok: true,
    items: next.map((item, orderIndex) => ({
      ...item,
      sortOrder: orderIndex + 1,
    })),
  };
}

export function mapPortfolioReorderError(message: string | undefined): string | undefined {
  const text = message ?? '';
  if (/not allowed to move this photo/i.test(text)) {
    return PORTFOLIO_REORDER_DENIED;
  }
  if (/sign in to reorder portfolio photos/i.test(text)) {
    return PORTFOLIO_REORDER_SIGN_IN;
  }
  if (/valid photo and direction/i.test(text)) {
    return PORTFOLIO_REORDER_INVALID;
  }

  return undefined;
}

export function providerLockOrder(providerIds: readonly string[]): string[] {
  return [...new Set(providerIds.filter((id) => id.length > 0))].sort();
}

export function assignInsertedSortOrders(
  existing: readonly OrderedPortfolioPhoto[],
  insertedIdsByProvider: Readonly<Record<string, readonly string[]>>,
): OrderedPortfolioPhoto[] {
  const assigned: OrderedPortfolioPhoto[] = [];

  for (const providerId of providerLockOrder(Object.keys(insertedIdsByProvider))) {
    const incoming = [...(insertedIdsByProvider[providerId] ?? [])].sort();
    const maxOrder = existing
      .filter((item) => item.providerId === providerId)
      .reduce((max, item) => Math.max(max, item.sortOrder), 0);

    incoming.forEach((id, index) => {
      assigned.push({
        id,
        providerId,
        sortOrder: maxOrder + index + 1,
      });
    });
  }

  return assigned;
}

export function parsePortfolioPhotoId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    return undefined;
  }

  return parsed;
}
