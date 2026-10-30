import type { Href } from 'expo-router';

import type { OwnedProviderProfile } from '@/data/repositories/provider-setup';
import type { WeekdayHoursDraft } from '@/data/repositories/provider-working-hours';

const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isHourMinute(value: string): boolean {
  return HOUR_MINUTE.test(value);
}

export type BusinessSetupStepId = 'profile' | 'service' | 'hours' | 'publish';

export type BusinessSetupStep = {
  id: BusinessSetupStepId;
  label: string;
  done: boolean;
  href?: Href;
  detail?: string;
};

export type BookableServiceSnapshot = {
  name: string;
  durationMinutes: number;
  priceThb: number;
};

/**
 * Completion is derived from persisted provider, services, and working-hours rows.
 *
 * Profile: non-empty name, kind salon|specialist, city, area, bio, and cover image.
 *   City may be Bangkok or Phuket (or any non-empty stored city). Matches
 *   provider_meets_publish_requirements except the service EXISTS check.
 * Service: at least one mapped service with a name, durationMinutes > 0, and priceThb > 0.
 * Hours: at least one open weekday with HH:MM opensAt < closesAt (Asia/Bangkok ICT).
 *   Required to publish. Date exceptions are not publication requirements.
 * Publish: providers.published === true. Never auto-set.
 */
export type MissingProfileField = 'name' | 'kind' | 'city' | 'area' | 'bio' | 'cover';

const PROFILE_FIELD_NOUN: Record<MissingProfileField, string> = {
  name: 'business name',
  kind: 'provider type',
  city: 'city',
  area: 'area',
  bio: 'bio',
  cover: 'cover photo',
};

export function listMissingProfileFields(provider: OwnedProviderProfile): MissingProfileField[] {
  const missing: MissingProfileField[] = [];
  if (provider.name.trim().length === 0) {
    missing.push('name');
  }
  if (provider.kind !== 'salon' && provider.kind !== 'specialist') {
    missing.push('kind');
  }
  if (provider.city.trim().length === 0) {
    missing.push('city');
  }
  if (provider.area.trim().length === 0) {
    missing.push('area');
  }
  if (provider.bio.trim().length === 0) {
    missing.push('bio');
  }
  if (provider.imageUrl.trim().length === 0) {
    missing.push('cover');
  }
  return missing;
}

export function isBusinessProfileComplete(provider: OwnedProviderProfile): boolean {
  return listMissingProfileFields(provider).length === 0;
}

export function hasBookableService(services: readonly BookableServiceSnapshot[]): boolean {
  return services.some(
    (service) =>
      service.name.trim().length > 0 &&
      Number.isInteger(service.durationMinutes) &&
      service.durationMinutes > 0 &&
      Number.isInteger(service.priceThb) &&
      service.priceThb > 0,
  );
}

export function hasConfiguredWeeklyHours(days: readonly WeekdayHoursDraft[]): boolean {
  return days.some(
    (day) =>
      day.isOpen &&
      isHourMinute(day.opensAt) &&
      isHourMinute(day.closesAt) &&
      day.opensAt < day.closesAt,
  );
}

export type BusinessOnboarding = {
  stepId: BusinessSetupStepId;
  title: string;
  message: string;
  actionLabel?: string;
  href?: Href;
};

/**
 * Next-step priority from verified checklist data:
 * 1. Incomplete profile
 * 2. No valid bookable service (only if services were loaded)
 * 3. No weekly hours (only if hours were loaded) — including published businesses
 * 4. Draft / unpublished — never before profile and service are complete
 *
 * Unverified service/hours steps are skipped so we do not tell owners to add
 * data that may already exist. Returns undefined when every step is done, or
 * when remaining gaps cannot be confirmed.
 */
export function resolveBusinessOnboarding(
  steps: readonly BusinessSetupStep[],
  verified: { services: boolean; hours: boolean },
  provider: OwnedProviderProfile,
): BusinessOnboarding | undefined {
  if (steps.length === 0 || steps.every((step) => step.done)) {
    return undefined;
  }

  const profile = steps.find((step) => step.id === 'profile');
  const service = steps.find((step) => step.id === 'service');
  const hours = steps.find((step) => step.id === 'hours');
  const publish = steps.find((step) => step.id === 'publish');

  if (profile && !profile.done) {
    return profileOnboarding(provider);
  }

  if (service && !service.done) {
    if (!verified.services) {
      return undefined;
    }

    return {
      stepId: 'service',
      title: 'Welcome to your business',
      message: 'Add at least one service with a duration and price so customers have something to book.',
      actionLabel: 'Add a service',
      href: '/business/services',
    };
  }

  if (hours && !hours.done && verified.hours) {
    return {
      stepId: 'hours',
      title: publish?.done ? 'Set your availability' : 'Welcome to your business',
      message:
        'Customers cannot choose an appointment time until weekly hours are set. You also need at least one open weekday before publishing. Times use Asia/Bangkok (ICT) in Bangkok and Phuket.',
      actionLabel: 'Set working hours',
      href: '/business/hours',
    };
  }

  if (publish && !publish.done) {
    return {
      stepId: 'publish',
      title: 'Welcome to your business',
      message: 'Your listing is a draft. Customers will not find it in Home or Search until you publish.',
      actionLabel: 'Publish',
    };
  }

  return undefined;
}

function profileOnboarding(provider: OwnedProviderProfile): BusinessOnboarding {
  const missing = listMissingProfileFields(provider);
  const action = {
    stepId: 'profile' as const,
    actionLabel: 'Complete profile',
    href: '/business/edit' as const,
  };

  if (missing.length === 1 && missing[0] === 'cover') {
    return {
      ...action,
      title: 'Add a cover photo',
      message: 'Upload a cover photo to complete your business profile.',
    };
  }

  if (missing.length === 1) {
    const field = missing[0];
    if (field === 'kind') {
      return {
        ...action,
        title: 'Choose a provider type',
        message: 'Choose salon or specialist to complete your business profile.',
      };
    }

    const noun = PROFILE_FIELD_NOUN[field];
    return {
      ...action,
      title: `Add a ${noun}`,
      message: `Add a ${noun} to complete your business profile.`,
    };
  }

  const nouns = missing.map((field) => PROFILE_FIELD_NOUN[field]);
  return {
    ...action,
    title: 'Finish your profile',
    message: `Add your ${joinNatural(nouns)} to complete your business profile.`,
  };
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function buildBusinessSetupChecklist(input: {
  provider: OwnedProviderProfile;
  services: readonly BookableServiceSnapshot[] | undefined;
  hours: readonly WeekdayHoursDraft[] | undefined;
}): BusinessSetupStep[] {
  const profileDone = isBusinessProfileComplete(input.provider);
  const serviceDone = input.services !== undefined && hasBookableService(input.services);
  const hoursDone = input.hours !== undefined && hasConfiguredWeeklyHours(input.hours);
  const publishDone = input.provider.published === true;

  return [
    {
      id: 'profile',
      label: 'Complete business profile',
      done: profileDone,
      href: '/business/edit',
      detail: profileDone
        ? undefined
        : 'Name, type, city, area, bio, and cover photo.',
    },
    {
      id: 'service',
      label: 'Add at least one service',
      done: serviceDone,
      href: '/business/services',
      detail: serviceDone ? undefined : 'A named service with duration and price.',
    },
    {
      id: 'hours',
      label: 'Configure weekly working hours',
      done: hoursDone,
      href: '/business/hours',
      detail: hoursDone
        ? undefined
        : 'Customers cannot book until at least one weekday is open. Times are Asia/Bangkok (ICT) for Bangkok and Phuket.',
    },
    {
      id: 'publish',
      label: 'Publish the business',
      done: publishDone,
      detail: publishDone
        ? undefined
        : 'Visible in Search and Home after you publish. Weekly hours are required.',
    },
  ];
}
