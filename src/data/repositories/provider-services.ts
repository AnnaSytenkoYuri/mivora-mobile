import { getCategoryOptions, invalidateCatalogCache, type CategoryOption } from '@/data/repositories/catalog';
import {
  getMyProvider,
  peekCachedMyProvider,
  rememberMyProvider,
} from '@/data/repositories/provider-setup';
import type { BeautyCategorySlug } from '@/data/types';
import {
  UNPUBLISH_TO_REMOVE_LAST_SERVICE,
  canDeleteServiceWhilePublished,
  mapPublishedIntegrityError,
} from '@/lib/published-integrity';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type ManagedService = {
  id: string;
  name: string;
  categoryId: string;
  categorySlug: BeautyCategorySlug;
  categoryLabel: string;
  durationMinutes: number;
  priceThb: number;
};

export type ServiceMutationResult =
  | { ok: true; services: ManagedService[] }
  | { ok: false; message: string };

type ServiceRow = {
  id: string;
  provider_id: string;
  category_id: number | string;
  name: string;
  duration_minutes: number | string;
  price_thb: number | string;
};

const NOT_CONFIGURED = 'Services are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to manage services.';
const NOT_OWNER = 'Create a provider profile before managing services.';

export async function getMyManagedServices(): Promise<ManagedService[]> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    throw new Error(owned.message);
  }

  return loadServicesForProvider(owned.providerId);
}

export async function createMyService(input: {
  name: string;
  categoryId: string;
  priceThb: number;
  durationMinutes: number;
}): Promise<ServiceMutationResult> {
  return mutateOwnedServices(async (providerId) => {
    const prepared = prepareServiceInput(input);
    if (!prepared.ok) {
      return prepared;
    }

    const { error } = await supabase.from('services').insert({
      id: createServiceId(prepared.name),
      provider_id: providerId,
      category_id: prepared.categoryId,
      name: prepared.name,
      duration_minutes: prepared.durationMinutes,
      price_thb: prepared.priceThb,
    });

    if (error) {
      return { ok: false, message: error.message || 'Could not add this service.' };
    }

    return undefined;
  });
}

export async function updateMyService(input: {
  serviceId: string;
  name: string;
  categoryId: string;
  priceThb: number;
  durationMinutes: number;
}): Promise<ServiceMutationResult> {
  return mutateOwnedServices(async (providerId) => {
    const prepared = prepareServiceInput(input);
    if (!prepared.ok) {
      return prepared;
    }

    const { data, error } = await supabase
      .from('services')
      .update({
        category_id: prepared.categoryId,
        name: prepared.name,
        duration_minutes: prepared.durationMinutes,
        price_thb: prepared.priceThb,
      })
      .eq('id', input.serviceId)
      .eq('provider_id', providerId)
      .select('id')
      .maybeSingle();

    if (error) {
      return { ok: false, message: error.message || 'Could not update this service.' };
    }

    if (!data) {
      return { ok: false, message: 'This service could not be updated.' };
    }

    return undefined;
  });
}

export async function deleteMyService(serviceId: string): Promise<ServiceMutationResult> {
  return mutateOwnedServices(async (providerId) => {
    const current = await getMyProvider({ bypassCache: true });
    if (current?.id === providerId && current.published) {
      const remaining = (await loadServicesForProvider(providerId)).filter(
        (service) => service.id !== serviceId,
      );
      if (!canDeleteServiceWhilePublished(true, remaining.length)) {
        return { ok: false, message: UNPUBLISH_TO_REMOVE_LAST_SERVICE };
      }
    }

    const { data, error } = await supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('provider_id', providerId)
      .select('id')
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        message:
          mapPublishedIntegrityError(error.message) ??
          error.message ??
          'Could not delete this service.',
      };
    }

    if (!data) {
      return { ok: false, message: 'This service could not be deleted.' };
    }

    return undefined;
  });
}

async function mutateOwnedServices(
  action: (providerId: string) => Promise<{ ok: false; message: string } | undefined>,
): Promise<ServiceMutationResult> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  try {
    const failed = await action(owned.providerId);
    if (failed) {
      return failed;
    }

    const services = await loadServicesForProvider(owned.providerId);
    await syncStartingPrice(owned.providerId, owned.userId, services);
    await syncProviderCategories(owned.providerId, services);
    await refreshOwnedProviderCache(owned.userId, services);
    invalidateCatalogCache();

    return { ok: true, services };
  } catch (caught: unknown) {
    return {
      ok: false,
      message: caught instanceof Error ? caught.message : 'Could not update services.',
    };
  }
}

async function requireOwnedProvider(): Promise<
  { ok: true; userId: string; providerId: string } | { ok: false; message: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const { data, error } = await supabase
    .from('providers')
    .select('id')
    .eq('owner_id', user.id)
    .order('name')
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || NOT_OWNER };
  }

  if (!data?.id) {
    return { ok: false, message: NOT_OWNER };
  }

  return { ok: true, userId: user.id, providerId: data.id as string };
}

async function loadServicesForProvider(providerId: string): Promise<ManagedService[]> {
  const [servicesResult, categories] = await Promise.all([
    supabase
      .from('services')
      .select('id, provider_id, category_id, name, duration_minutes, price_thb')
      .eq('provider_id', providerId)
      .order('name'),
    getCategoryOptions(),
  ]);

  if (servicesResult.error) {
    throw new Error(servicesResult.error.message || 'Could not load services.');
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return ((servicesResult.data ?? []) as ServiceRow[]).flatMap((row) => {
    const mapped = mapManagedService(row, categoryById);
    return mapped ? [mapped] : [];
  });
}

function mapManagedService(
  row: ServiceRow,
  categoryById: Map<string, CategoryOption>,
): ManagedService | undefined {
  const category = categoryById.get(String(row.category_id));
  const durationMinutes = asNumber(row.duration_minutes);
  const priceThb = asNumber(row.price_thb);

  if (!category || durationMinutes === undefined || priceThb === undefined) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    categoryId: category.id,
    categorySlug: category.slug,
    categoryLabel: category.label,
    durationMinutes,
    priceThb,
  };
}

function prepareServiceInput(input: {
  name: string;
  categoryId: string;
  priceThb: number;
  durationMinutes: number;
}):
  | { ok: true; name: string; categoryId: number | string; priceThb: number; durationMinutes: number }
  | { ok: false; message: string } {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, message: 'Service name is required.' };
  }

  if (input.categoryId.length === 0) {
    return { ok: false, message: 'Choose a category.' };
  }

  if (!Number.isInteger(input.priceThb) || input.priceThb <= 0) {
    return { ok: false, message: 'Price must be a whole number greater than 0.' };
  }

  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return { ok: false, message: 'Duration must be a whole number of minutes greater than 0.' };
  }

  return {
    ok: true,
    name,
    categoryId: /^\d+$/.test(input.categoryId) ? Number(input.categoryId) : input.categoryId,
    priceThb: input.priceThb,
    durationMinutes: input.durationMinutes,
  };
}

async function syncStartingPrice(
  providerId: string,
  userId: string,
  services: ManagedService[],
): Promise<void> {
  const startingPrice = services.reduce<number | null>((lowest, service) => {
    if (lowest === null || service.priceThb < lowest) {
      return service.priceThb;
    }

    return lowest;
  }, null);

  const { error } = await supabase
    .from('providers')
    .update({ starting_price_thb: startingPrice })
    .eq('id', providerId)
    .eq('owner_id', userId);

  if (error) {
    throw new Error(error.message || 'Could not update starting price.');
  }
}

async function syncProviderCategories(providerId: string, services: ManagedService[]): Promise<void> {
  const categoryIds = [...new Set(services.map((service) => service.categoryId))];
  const { data: existing, error: existingError } = await supabase
    .from('provider_categories')
    .select('category_id')
    .eq('provider_id', providerId);

  if (existingError) {
    return;
  }

  const current = new Set((existing ?? []).map((row) => String((row as { category_id: number | string }).category_id)));
  const next = new Set(categoryIds);

  const toRemove = [...current].filter((id) => !next.has(id));
  const toAdd = [...next].filter((id) => !current.has(id));

  if (toRemove.length > 0) {
    await supabase.from('provider_categories').delete().eq('provider_id', providerId).in(
      'category_id',
      toRemove.map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
    );
  }

  if (toAdd.length > 0) {
    await supabase.from('provider_categories').insert(
      toAdd.map((categoryId) => ({
        provider_id: providerId,
        category_id: /^\d+$/.test(categoryId) ? Number(categoryId) : categoryId,
      })),
    );
  }
}

async function refreshOwnedProviderCache(userId: string, services: ManagedService[]): Promise<void> {
  const cached = peekCachedMyProvider(userId);
  const startingPrice = services.reduce<number | undefined>((lowest, service) => {
    if (lowest === undefined || service.priceThb < lowest) {
      return service.priceThb;
    }

    return lowest;
  }, undefined);

  if (cached) {
    rememberMyProvider(userId, {
      ...cached,
      startingPriceThb: startingPrice,
      serviceCount: services.length,
      published: cached.published,
    });
    return;
  }

  await getMyProvider({ bypassCache: true });
}

function createServiceId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 8);

  return slug.length > 0 ? `${slug}-${suffix}` : `service-${suffix}`;
}

function asNumber(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
