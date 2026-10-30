import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WeekdayHoursDraft } from '../data/repositories/provider-working-hours.ts';
import type { OwnedProviderProfile } from '../data/repositories/provider-setup.ts';
import {
  buildBusinessSetupChecklist,
  hasBookableService,
  hasConfiguredWeeklyHours,
  isBusinessProfileComplete,
  listMissingProfileFields,
  resolveBusinessOnboarding,
} from './business-setup-checklist.ts';

function emptyHours(): WeekdayHoursDraft[] {
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday: weekday as WeekdayHoursDraft['weekday'],
    label: String(weekday),
    isOpen: false,
    opensAt: '09:00',
    closesAt: '18:00',
  }));
}

function provider(overrides: Partial<OwnedProviderProfile> = {}): OwnedProviderProfile {
  return {
    id: 'p1',
    kind: 'specialist',
    name: 'SYANNAYURI',
    bio: 'Nails in Phuket',
    area: 'Rawai',
    city: 'Phuket',
    address: '',
    imageUrl: 'https://example.com/cover.jpg',
    startingPriceThb: 890,
    serviceCount: 1,
    published: false,
    ...overrides,
  };
}

test('profile completion requires name, type, city, area, bio, and cover', () => {
  assert.equal(isBusinessProfileComplete(provider()), true);
  assert.equal(isBusinessProfileComplete(provider({ city: 'Bangkok' })), true);
  assert.equal(isBusinessProfileComplete(provider({ city: '' })), false);
  assert.equal(isBusinessProfileComplete(provider({ imageUrl: '  ' })), false);
  assert.equal(isBusinessProfileComplete(provider({ bio: '' })), false);
});

test('a bookable service needs name, positive duration, and positive price', () => {
  assert.equal(
    hasBookableService([{ name: 'Gel', durationMinutes: 90, priceThb: 890 }]),
    true,
  );
  assert.equal(hasBookableService([]), false);
  assert.equal(
    hasBookableService([{ name: 'Gel', durationMinutes: 0, priceThb: 890 }]),
    false,
  );
  assert.equal(
    hasBookableService([{ name: '  ', durationMinutes: 90, priceThb: 890 }]),
    false,
  );
});

test('weekly hours are configured only when an open weekday has a valid window', () => {
  const empty = emptyHours();
  assert.equal(hasConfiguredWeeklyHours(empty), false);

  const monday = empty.map((day) =>
    day.weekday === 1 ? { ...day, isOpen: true, opensAt: '09:00', closesAt: '18:00' } : day,
  );
  assert.equal(hasConfiguredWeeklyHours(monday), true);

  const inverted = empty.map((day) =>
    day.weekday === 1 ? { ...day, isOpen: true, opensAt: '18:00', closesAt: '09:00' } : day,
  );
  assert.equal(hasConfiguredWeeklyHours(inverted), false);
});

test('checklist is four steps and does not treat unpublished as complete', () => {
  const steps = buildBusinessSetupChecklist({
    provider: provider({ published: false }),
    services: [{ name: 'Gel', durationMinutes: 90, priceThb: 890 }],
    hours: emptyHours().map((day) =>
      day.weekday === 1 ? { ...day, isOpen: true, opensAt: '10:00', closesAt: '16:00' } : day,
    ),
  });

  assert.match(steps.find((step) => step.id === 'publish')?.detail ?? '', /Weekly hours are required/);
  assert.equal(steps.length, 4);
  assert.deepEqual(
    steps.map((step) => step.done),
    [true, true, true, false],
  );
});

function onboardingFor(
  nextProvider: OwnedProviderProfile,
  services: { name: string; durationMinutes: number; priceThb: number }[] | undefined,
  hours: WeekdayHoursDraft[] | undefined,
  verified = { services: true, hours: true },
) {
  return resolveBusinessOnboarding(
    buildBusinessSetupChecklist({ provider: nextProvider, services, hours }),
    verified,
    nextProvider,
  );
}

test('onboarding prefers profile, then service, then hours before publish', () => {
  const bookable = [{ name: 'Gel', durationMinutes: 90, priceThb: 890 }];
  const openHours = emptyHours().map((day) =>
    day.weekday === 1 ? { ...day, isOpen: true, opensAt: '10:00', closesAt: '16:00' } : day,
  );

  assert.equal(
    onboardingFor(provider({ imageUrl: '', published: false }), [], emptyHours())?.stepId,
    'profile',
  );
  assert.equal(onboardingFor(provider({ published: false }), [], emptyHours())?.stepId, 'service');
  assert.equal(
    onboardingFor(provider({ published: false }), bookable, emptyHours())?.stepId,
    'hours',
  );
  assert.equal(onboardingFor(provider({ published: false }), bookable, openHours)?.stepId, 'publish');
  assert.equal(onboardingFor(provider({ published: true }), bookable, openHours), undefined);
});

test('missing cover photo uses a specific profile message', () => {
  const next = provider({ imageUrl: '' });
  assert.deepEqual(listMissingProfileFields(next), ['cover']);
  const onboarding = onboardingFor(next, [], emptyHours());
  assert.equal(onboarding?.title, 'Add a cover photo');
  assert.equal(onboarding?.message, 'Upload a cover photo to complete your business profile.');
  assert.equal(onboarding?.actionLabel, 'Complete profile');
});

test('a single missing profile field is named without listing the rest', () => {
  const next = provider({ bio: '' });
  assert.deepEqual(listMissingProfileFields(next), ['bio']);
  const onboarding = onboardingFor(next, [], emptyHours());
  assert.equal(onboarding?.title, 'Add a bio');
  assert.equal(onboarding?.message, 'Add a bio to complete your business profile.');
});

test('multiple missing profile fields are summarized naturally', () => {
  const next = provider({ area: '', bio: '', imageUrl: '' });
  assert.deepEqual(listMissingProfileFields(next), ['area', 'bio', 'cover']);
  const onboarding = onboardingFor(next, [], emptyHours());
  assert.equal(onboarding?.title, 'Finish your profile');
  assert.equal(
    onboarding?.message,
    'Add your area, bio, and cover photo to complete your business profile.',
  );
});

test('complete profiles do not produce profile onboarding', () => {
  assert.deepEqual(listMissingProfileFields(provider()), []);
  assert.equal(isBusinessProfileComplete(provider()), true);
  assert.notEqual(onboardingFor(provider({ published: false }), [], emptyHours())?.stepId, 'profile');
});

test('published businesses with no hours are sent to working hours, not publish', () => {
  const onboarding = onboardingFor(
    provider({ published: true }),
    [{ name: 'Gel', durationMinutes: 90, priceThb: 890 }],
    emptyHours(),
  );

  assert.equal(onboarding?.stepId, 'hours');
});

test('onboarding does not tell owners to add unverified services or hours', () => {
  assert.equal(
    onboardingFor(provider({ published: true }), undefined, undefined, {
      services: false,
      hours: false,
    }),
    undefined,
  );
  assert.equal(
    onboardingFor(
      provider({ published: false }),
      [{ name: 'Gel', durationMinutes: 90, priceThb: 890 }],
      undefined,
      { services: true, hours: false },
    )?.stepId,
    'publish',
  );
});

test('hours and services fail closed when data has not loaded', () => {
  const steps = buildBusinessSetupChecklist({
    provider: provider({ published: true }),
    services: undefined,
    hours: undefined,
  });

  assert.equal(steps.find((step) => step.id === 'service')?.done, false);
  assert.equal(steps.find((step) => step.id === 'hours')?.done, false);
  assert.equal(steps.find((step) => step.id === 'publish')?.done, true);
});
