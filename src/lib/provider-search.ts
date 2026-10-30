import type { Category, Provider, ProviderSearchFilters } from '../data/types';

export function filterProviders(
  providers: Provider[],
  categories: Category[],
  filters: ProviderSearchFilters = {},
): Provider[] {
  const serviceQuery = normalize(filters.serviceQuery ?? '');
  const locationQuery = normalize(filters.locationQuery ?? '');

  return providers.filter((provider) => {
    if (filters.cityId && normalize(provider.city) !== filters.cityId) {
      return false;
    }

    if (serviceQuery && !matchesServiceQuery(provider, categories, serviceQuery)) {
      return false;
    }

    if (locationQuery && !matchesLocationQuery(provider, locationQuery)) {
      return false;
    }

    if (filters.categorySlug && !provider.categories.includes(filters.categorySlug)) {
      return false;
    }

    if (filters.area && provider.area !== filters.area) {
      return false;
    }

    if (filters.kind && provider.kind !== filters.kind) {
      return false;
    }

    if (filters.maxPriceThb != null && provider.startingPriceThb > filters.maxPriceThb) {
      return false;
    }

    return true;
  });
}

function matchesServiceQuery(provider: Provider, categories: Category[], query: string): boolean {
  if (normalize(provider.name).includes(query)) {
    return true;
  }

  if (provider.services.some((service) => normalize(service.name).includes(query))) {
    return true;
  }

  return provider.categories.some((slug) => {
    if (slug.includes(query)) {
      return true;
    }

    const category = categories.find((item) => item.slug === slug);
    return category ? normalize(category.label).includes(query) : false;
  });
}

function matchesLocationQuery(provider: Provider, query: string): boolean {
  return (
    normalize(provider.area).includes(query) ||
    normalize(provider.city).includes(query) ||
    normalize(provider.address ?? '').includes(query)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
