import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PORTFOLIO_PHOTO_LIMIT,
  PORTFOLIO_PHOTO_LIMIT_MESSAGE,
  createPortfolioLimitStore,
  mapPortfolioLimitError,
} from './portfolio-limit.ts';

test('inserting the 12th photo succeeds', () => {
  const store = createPortfolioLimitStore();
  store.setCount('p1', PORTFOLIO_PHOTO_LIMIT - 1);
  const insert = store.beginInsert('p1');
  assert.equal(insert.blocked, false);
  assert.equal(insert.allowed, true);
  if (insert.blocked || !insert.allowed) {
    return;
  }

  insert.commit();
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);
});

test('inserting the 13th photo fails', () => {
  const store = createPortfolioLimitStore();
  store.setCount('p1', PORTFOLIO_PHOTO_LIMIT);
  const insert = store.beginInsert('p1');
  assert.deepEqual(insert, { blocked: false, allowed: false });
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);

  const bulk = store.insertMany('p1', 1);
  assert.deepEqual(bulk, { ok: false, count: PORTFOLIO_PHOTO_LIMIT });
});

test('concurrent uploads cannot exceed 12', () => {
  const store = createPortfolioLimitStore();
  store.setCount('p1', PORTFOLIO_PHOTO_LIMIT - 1);

  const first = store.beginInsert('p1');
  assert.equal(first.blocked, false);
  assert.equal(first.allowed, true);
  if (first.blocked || !first.allowed) {
    return;
  }

  assert.deepEqual(store.beginInsert('p1'), { blocked: true });

  first.commit();
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);
  assert.deepEqual(store.beginInsert('p1'), { blocked: false, allowed: false });
});

test('different providers have independent limits', () => {
  const store = createPortfolioLimitStore();
  store.setCount('p1', PORTFOLIO_PHOTO_LIMIT);

  const other = store.beginInsert('p2');
  assert.equal(other.blocked, false);
  assert.equal(other.allowed, true);
  if (other.blocked || !other.allowed) {
    return;
  }

  other.commit();
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);
  assert.equal(store.count('p2'), 1);

  const bulk = store.insertMany('p2', PORTFOLIO_PHOTO_LIMIT);
  assert.deepEqual(bulk, { ok: false, count: 1 });
  assert.deepEqual(store.insertMany('p2', PORTFOLIO_PHOTO_LIMIT - 1), { ok: true, count: PORTFOLIO_PHOTO_LIMIT });
});

test('deleting a photo allows another upload', () => {
  const store = createPortfolioLimitStore();
  store.setCount('p1', PORTFOLIO_PHOTO_LIMIT);
  assert.deepEqual(store.beginInsert('p1'), { blocked: false, allowed: false });

  store.deleteOne('p1');
  const insert = store.beginInsert('p1');
  assert.equal(insert.blocked, false);
  assert.equal(insert.allowed, true);
  if (insert.blocked || !insert.allowed) {
    return;
  }

  insert.commit();
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);
});

test('a bulk insert that would exceed 12 rolls back the whole statement', () => {
  const store = createPortfolioLimitStore();
  assert.deepEqual(store.insertMany('p1', PORTFOLIO_PHOTO_LIMIT), {
    ok: true,
    count: PORTFOLIO_PHOTO_LIMIT,
  });
  assert.deepEqual(store.insertMany('p1', 13), { ok: false, count: PORTFOLIO_PHOTO_LIMIT });
  assert.equal(store.count('p1'), PORTFOLIO_PHOTO_LIMIT);
});

test('database limit errors map to the existing app message', () => {
  assert.equal(
    mapPortfolioLimitError(PORTFOLIO_PHOTO_LIMIT_MESSAGE),
    `You can add up to ${PORTFOLIO_PHOTO_LIMIT} portfolio photos.`,
  );
  assert.equal(mapPortfolioLimitError('Could not save the portfolio photo.'), undefined);
});
