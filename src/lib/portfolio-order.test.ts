import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PORTFOLIO_REORDER_DENIED,
  PORTFOLIO_REORDER_SIGN_IN,
  assignInsertedSortOrders,
  canMovePortfolioPhoto,
  comparePortfolioOrder,
  mapPortfolioReorderError,
  moveOwnedPortfolioPhoto,
  parsePortfolioPhotoId,
  providerLockOrder,
  sortPortfolioPhotos,
  type OrderedPortfolioPhoto,
} from './portfolio-order.ts';

function photo(
  id: string,
  sortOrder: number,
  providerId = 'p1',
): OrderedPortfolioPhoto {
  return { id, providerId, sortOrder };
}

test('photos sort by sort_order then id', () => {
  const ordered = sortPortfolioPhotos([
    photo('9', 2),
    photo('2', 1),
    photo('3', 1),
    photo('1', 3),
  ]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['2', '3', '9', '1'],
  );
  assert.equal(comparePortfolioOrder(photo('2', 1), photo('3', 1)) < 0, true);
});

test('duplicate sort_order values still have a stable id order', () => {
  assert.deepEqual(
    sortPortfolioPhotos([photo('8', 6), photo('5', 6), photo('7', 5)]).map((item) => item.id),
    ['7', '5', '8'],
  );
});

test('new photos with max+1 appear last', () => {
  const existing = [photo('1', 1), photo('2', 2)];
  const uploaded = photo('99', 3);
  assert.deepEqual(
    sortPortfolioPhotos([...existing, uploaded]).map((item) => item.id),
    ['1', '2', '99'],
  );
});

test('move left and right swap neighbors and renumber', () => {
  const items = [photo('a', 1), photo('b', 2), photo('c', 3)];

  const right = moveOwnedPortfolioPhoto(items, 'a', 'right', 'p1');
  assert.equal(right.ok, true);
  if (!right.ok) {
    return;
  }
  assert.deepEqual(
    right.items.map((item) => [item.id, item.sortOrder]),
    [
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ],
  );

  const left = moveOwnedPortfolioPhoto(right.items, 'c', 'left', 'p1');
  assert.equal(left.ok, true);
  if (!left.ok) {
    return;
  }
  assert.deepEqual(
    left.items.map((item) => [item.id, item.sortOrder]),
    [
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ],
  );
});

test('boundary moves are rejected and controls disable at ends', () => {
  const items = [photo('a', 1), photo('b', 2)];

  assert.equal(canMovePortfolioPhoto(items, 'a', 'left'), false);
  assert.equal(canMovePortfolioPhoto(items, 'a', 'right'), true);
  assert.equal(canMovePortfolioPhoto(items, 'b', 'right'), false);
  assert.equal(canMovePortfolioPhoto(items, 'b', 'left'), true);
  assert.deepEqual(moveOwnedPortfolioPhoto(items, 'a', 'left', 'p1'), {
    ok: false,
    reason: 'boundary',
  });
  assert.deepEqual(moveOwnedPortfolioPhoto(items, 'b', 'right', 'p1'), {
    ok: false,
    reason: 'boundary',
  });
});

test('only the owning provider can reorder a photo', () => {
  const items = [photo('a', 1, 'mine'), photo('b', 1, 'other')];

  assert.deepEqual(moveOwnedPortfolioPhoto(items, 'b', 'left', 'mine'), {
    ok: false,
    reason: 'not-owner',
  });
  assert.deepEqual(moveOwnedPortfolioPhoto(items, 'a', 'right', null), {
    ok: false,
    reason: 'signed-out',
  });
  assert.deepEqual(moveOwnedPortfolioPhoto(items, 'missing', 'left', 'mine'), {
    ok: false,
    reason: 'not-found',
  });
});

test('a locked provider cannot apply a second reorder until the first finishes', () => {
  const locked = new Set<string>();

  function acquireInOrder(providerIds: readonly string[]): 'ok' | 'blocked' {
    const ordered = providerLockOrder(providerIds);
    if (ordered.some((id) => locked.has(id))) {
      return 'blocked';
    }

    for (const id of ordered) {
      locked.add(id);
    }

    return 'ok';
  }

  assert.deepEqual(providerLockOrder(['b', 'a', 'b']), ['a', 'b']);
  assert.equal(acquireInOrder(['p1']), 'ok');
  assert.equal(acquireInOrder(['p1']), 'blocked');
  assert.equal(acquireInOrder(['p2']), 'ok');
  locked.delete('p1');
  assert.equal(acquireInOrder(['p1']), 'ok');
});

test('multi-row inserts get consecutive sort_order values after the current max', () => {
  const existing = [photo('1', 2, 'p1'), photo('2', 4, 'p1'), photo('9', 1, 'p2')];
  const assigned = assignInsertedSortOrders(existing, {
    p1: ['30', '20'],
    p2: ['40'],
  });

  assert.deepEqual(
    assigned.map((item) => [item.providerId, item.id, item.sortOrder]),
    [
      ['p1', '20', 5],
      ['p1', '30', 6],
      ['p2', '40', 2],
    ],
  );
});

test('locking providers in id order avoids opposite-order insert deadlocks', () => {
  assert.deepEqual(providerLockOrder(['salon-b', 'salon-a']), ['salon-a', 'salon-b']);
  assert.deepEqual(providerLockOrder(['salon-a', 'salon-b']), ['salon-a', 'salon-b']);
});

test('database reorder errors map to owner-facing messages', () => {
  assert.equal(mapPortfolioReorderError(PORTFOLIO_REORDER_DENIED), PORTFOLIO_REORDER_DENIED);
  assert.equal(mapPortfolioReorderError(PORTFOLIO_REORDER_SIGN_IN), PORTFOLIO_REORDER_SIGN_IN);
  assert.equal(mapPortfolioReorderError('Could not move this photo.'), undefined);
});

test('portfolio photo ids sent to the RPC must be non-negative integers', () => {
  assert.equal(parsePortfolioPhotoId('12'), 12);
  assert.equal(parsePortfolioPhotoId('12.5'), undefined);
  assert.equal(parsePortfolioPhotoId('-1'), undefined);
  assert.equal(parsePortfolioPhotoId('abc'), undefined);
});
