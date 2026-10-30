export const UNPUBLISH_TO_REMOVE_COVER =
  'Unpublish this business before removing the cover photo.';

export const UNPUBLISH_TO_REMOVE_LAST_SERVICE =
  'Unpublish this business before removing your last service.';

export const UNPUBLISH_TO_CLEAR_REQUIRED =
  'Unpublish this business before removing required profile information.';

export const UNPUBLISH_TO_CLEAR_HOURS =
  'Unpublish this business before removing all weekly working hours.';

export const SET_HOURS_BEFORE_PUBLISHING =
  'Set weekly working hours before publishing. Open Working Hours and add at least one weekday.';

export function canRemoveCoverWhilePublished(published: boolean): boolean {
  return published !== true;
}

export function canDeleteServiceWhilePublished(
  published: boolean,
  remainingServiceCount: number,
): boolean {
  if (published !== true) {
    return true;
  }

  return remainingServiceCount > 0;
}

export function canClearWeeklyHoursWhilePublished(
  published: boolean,
  remainingOpenWeekdays: number,
): boolean {
  if (published !== true) {
    return true;
  }

  return remainingOpenWeekdays > 0;
}

export function mapPublishedIntegrityError(message: string | undefined): string | undefined {
  const text = message ?? '';
  if (/last service|zero services/i.test(text)) {
    return UNPUBLISH_TO_REMOVE_LAST_SERVICE;
  }

  if (/last open weekday|zero open weekdays/i.test(text)) {
    return UNPUBLISH_TO_CLEAR_HOURS;
  }

  if (/cover image|image_url|required profile|cannot be published/i.test(text)) {
    return UNPUBLISH_TO_CLEAR_REQUIRED;
  }

  return undefined;
}
