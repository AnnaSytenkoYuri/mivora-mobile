import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UNPUBLISH_TO_CLEAR_HOURS,
  UNPUBLISH_TO_CLEAR_REQUIRED,
  UNPUBLISH_TO_REMOVE_COVER,
  UNPUBLISH_TO_REMOVE_LAST_SERVICE,
  canClearWeeklyHoursWhilePublished,
  canDeleteServiceWhilePublished,
  canRemoveCoverWhilePublished,
  mapPublishedIntegrityError,
} from './published-integrity.ts';

test('published businesses cannot remove a cover photo', () => {
  assert.equal(canRemoveCoverWhilePublished(true), false);
  assert.equal(canRemoveCoverWhilePublished(false), true);
});

test('published businesses cannot delete their last service', () => {
  assert.equal(canDeleteServiceWhilePublished(true, 0), false);
  assert.equal(canDeleteServiceWhilePublished(true, 1), true);
  assert.equal(canDeleteServiceWhilePublished(false, 0), true);
});

test('bulk removal is judged by remaining count after the whole statement', () => {
  const remainingAfterDeletingAll = (currentCount: number) => Math.max(0, currentCount - currentCount);
  assert.equal(canDeleteServiceWhilePublished(true, remainingAfterDeletingAll(3)), false);
  assert.equal(canClearWeeklyHoursWhilePublished(true, remainingAfterDeletingAll(5)), false);
  assert.equal(canDeleteServiceWhilePublished(true, 3 - 2), true);
});

test('published businesses cannot clear all weekly hours', () => {
  assert.equal(canClearWeeklyHoursWhilePublished(true, 0), false);
  assert.equal(canClearWeeklyHoursWhilePublished(true, 1), true);
  assert.equal(canClearWeeklyHoursWhilePublished(false, 0), true);
});

test('database integrity errors map to unpublish-first messages', () => {
  assert.equal(
    mapPublishedIntegrityError('Cannot remove the last service from a published provider'),
    UNPUBLISH_TO_REMOVE_LAST_SERVICE,
  );
  assert.equal(
    mapPublishedIntegrityError('Published provider cannot have zero services. Unpublish first.'),
    UNPUBLISH_TO_REMOVE_LAST_SERVICE,
  );
  assert.equal(
    mapPublishedIntegrityError('Published provider cannot have zero open weekdays. Unpublish first.'),
    UNPUBLISH_TO_CLEAR_HOURS,
  );
  assert.equal(
    mapPublishedIntegrityError(
      'Provider p1 cannot be published until name, type (salon/specialist), city, area, bio, cover image, and at least one service are set',
    ),
    UNPUBLISH_TO_CLEAR_REQUIRED,
  );
  assert.equal(
    mapPublishedIntegrityError(
      'Cannot remove the last open weekday from a published provider. Unpublish first.',
    ),
    UNPUBLISH_TO_CLEAR_HOURS,
  );
  assert.equal(
    mapPublishedIntegrityError(
      'Provider p1 cannot be published until name, type (salon/specialist), city, area, bio, cover image, at least one service, and weekly working hours are set',
    ),
    UNPUBLISH_TO_CLEAR_REQUIRED,
  );
  assert.equal(mapPublishedIntegrityError('network down'), undefined);
  assert.equal(UNPUBLISH_TO_REMOVE_COVER.includes('Unpublish'), true);
});
