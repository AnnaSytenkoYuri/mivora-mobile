import { providerMatchesCity, type CityId } from '@/constants/cities';
import type {
  BeautyCategorySlug,
  Category,
  PortfolioItem,
  Provider,
  ProviderKind,
  ProviderSearchFilterOptions,
  ProviderSearchFilters,
  Review,
  Service,
} from '@/data/types';
import { bookedProviderServiceQueryError } from '@/lib/booking-catalog-state';
import { comparePortfolioOrder } from '@/lib/portfolio-order';
import { filterProviders } from '@/lib/provider-search';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const CATALOG_UNAVAILABLE = 'Catalog is unavailable right now.';
const KIND_ORDER: ProviderKind[] = ['salon', 'specialist'];
const CATEGORY_SLUGS: BeautyCategorySlug[] = [
  'nails',
  'hair',
  'lashes',
  'brows',
  'makeup',
  'massage',
  'facial',
  'waxing',
  'other',
];

type CategoryRow = {
  id: number | string;
  slug: string;
  name: string;
  icon: string | null;
};

type ProviderRow = {
  id: string;
  kind: string | null;
  name: string | null;
  bio: string | null;
  area: string | null;
  city: string | null;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  rating: number | string | null;
  review_count: number | string | null;
  starting_price_thb: number | string | null;
  image_url: string | null;
  featured: boolean | null;
  published?: boolean | null;
};

type ProviderCategoryRow = {
  provider_id: string;
  category_id: number | string;
};

type ServiceRow = {
  id: string;
  provider_id: string;
  category_id: number | string;
  name: string;
  duration_minutes: number | string;
  price_thb: number | string;
};

type PortfolioRow = {
  id: number | string;
  provider_id: string;
  image_url: string;
  sort_order?: number | string | null;
};

type ReviewRow = {
  id: number | string;
  provider_id: string;
  author_name: string;
  rating: number | string;
  text: string;
  review_date: string;
};

type CatalogData = {
  categories: Category[];
  providers: Provider[];
};

let catalogPromise: Promise<CatalogData> | undefined;
const bookedServiceCache = new Map<string, BookedProviderService>();

export function invalidateCatalogCache(): void {
  catalogPromise = undefined;
  bookedServiceCache.clear();
}

export async function getCategories(): Promise<Category[]> {
  const catalog = await loadCatalog();
  return catalog.categories;
}

export type CategoryOption = Category & {
  id: string;
};

export async function getCategoryOptions(): Promise<CategoryOption[]> {
  if (!isSupabaseConfigured()) {
    throw new Error(CATALOG_UNAVAILABLE);
  }

  const { data, error } = await supabase.from('categories').select('id, slug, name').order('id');
  if (error) {
    throw new Error(error.message || CATALOG_UNAVAILABLE);
  }

  const options: CategoryOption[] = [];
  for (const row of (data ?? []) as CategoryRow[]) {
    const slug = parseCategorySlug(row.slug);
    if (!slug) {
      continue;
    }

    options.push({
      id: String(row.id),
      slug,
      label: row.name,
    });
  }

  return options;
}

export async function getProviders(): Promise<Provider[]> {
  const catalog = await loadCatalog();
  return catalog.providers;
}

export async function getHomeProviders(cityId: CityId): Promise<{
  providers: Provider[];
  featuredOnly: boolean;
}> {
  const inCity = (await getProviders()).filter((provider) => providerMatchesCity(provider, cityId));
  const featured = inCity.filter((provider) => provider.featured);
  if (featured.length > 0) {
    return { providers: featured, featuredOnly: true };
  }

  return { providers: inCity, featuredOnly: false };
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  const categories = await getCategories();
  return categories.find((category) => category.slug === slug);
}

export async function getProvidersByCategory(slug: string, cityId?: CityId): Promise<Provider[]> {
  const category = await getCategoryBySlug(slug);
  if (!category) {
    return [];
  }

  const providers = await getProviders();
  return providers.filter(
    (provider) =>
      provider.categories.includes(category.slug) &&
      (cityId === undefined || providerMatchesCity(provider, cityId)),
  );
}

export async function getProviderById(id: string): Promise<Provider | undefined> {
  const providers = await getProviders();
  return providers.find((provider) => provider.id === id);
}

export async function getProviderService(
  providerId: string,
  serviceId: string,
): Promise<{ provider: Provider; service: Service } | undefined> {
  const provider = await getProviderById(providerId);
  const service = provider?.services.find((item) => item.id === serviceId);

  if (!provider || !service) {
    return undefined;
  }

  return { provider, service };
}

export type BookedProviderService = {
  provider: Provider;
  service: Service;
  canViewPublicProfile: boolean;
};

export async function getBookedProviderService(
  providerId: string,
  serviceId: string,
): Promise<BookedProviderService> {
  const cacheKey = `${providerId}:${serviceId}`;
  const cached = bookedServiceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loaded = await loadBookedProviderService(providerId, serviceId);
  bookedServiceCache.set(cacheKey, loaded);
  return loaded;
}

async function loadBookedProviderService(
  providerId: string,
  serviceId: string,
): Promise<BookedProviderService> {
  if (!isSupabaseConfigured()) {
    return {
      provider: fallbackProvider(providerId.length > 0 ? providerId : 'unknown'),
      service: fallbackService(serviceId.length > 0 ? serviceId : 'unknown'),
      canViewPublicProfile: false,
    };
  }

  const [providerResult, serviceResult] = await Promise.all([
    providerId
      ? supabase
          .from('providers')
          .select(
            'id, kind, name, bio, area, city, address, latitude, longitude, rating, review_count, starting_price_thb, image_url, featured, published',
          )
          .eq('id', providerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    serviceId
      ? supabase
          .from('services')
          .select('id, provider_id, category_id, name, duration_minutes, price_thb')
          .eq('id', serviceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const queryError = bookedProviderServiceQueryError(
    providerResult.error?.message,
    serviceResult.error?.message,
  );
  if (queryError) {
    throw new Error(queryError);
  }

  const providerRow = (providerResult.data ?? undefined) as ProviderRow | undefined;
  const mappedProvider = providerRow
    ? mapProviderRow(providerRow, {
        categories: [],
        services: [],
        portfolio: [],
        reviews: [],
      })
    : undefined;

  const provider =
    mappedProvider ??
    fallbackProvider(providerId.length > 0 ? providerId : 'unknown');

  const serviceRow = (serviceResult.data ?? undefined) as ServiceRow | undefined;
  const mappedService = serviceRow ? mapServiceRowForBooking(serviceRow) : undefined;
  const service = mappedService ?? fallbackService(serviceId.length > 0 ? serviceId : 'unknown');

  return {
    provider,
    service,
    canViewPublicProfile: mappedProvider?.published === true,
  };
}

export async function getProvidersByIds(ids: string[]): Promise<Provider[]> {
  if (ids.length === 0) {
    return [];
  }

  const resolved: Provider[] = [];

  for (const id of ids) {
    const provider = await getProviderById(id);
    if (provider) {
      resolved.push(provider);
    }
  }

  return resolved;
}

export async function getSearchFilterOptions(
  cityId?: CityId,
): Promise<ProviderSearchFilterOptions> {
  const { categories, providers } = await loadCatalog();
  const scoped = cityId ? providers.filter((provider) => providerMatchesCity(provider, cityId)) : providers;
  const areas = [...new Set(scoped.map((provider) => provider.area).filter((area) => area.length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );
  const kinds = KIND_ORDER.filter((kind) => scoped.some((provider) => provider.kind === kind));
  const maxPricesThb = [...new Set(scoped.map((provider) => provider.startingPriceThb))].sort(
    (a, b) => a - b,
  );

  return {
    categories,
    areas,
    kinds,
    maxPricesThb,
  };
}

export async function searchProviders(filters: ProviderSearchFilters = {}): Promise<Provider[]> {
  const { categories, providers } = await loadCatalog();
  const cityId = filters.cityId;
  const scoped = cityId
    ? providers.filter((provider) => providerMatchesCity(provider, cityId))
    : providers;

  return filterProviders(scoped, categories, { ...filters, cityId: undefined });
}

function loadCatalog(): Promise<CatalogData> {
  if (!catalogPromise) {
    catalogPromise = fetchCatalog().catch((error: unknown) => {
      catalogPromise = undefined;
      throw error;
    });
  }

  return catalogPromise;
}

async function fetchCatalog(): Promise<CatalogData> {
  if (!isSupabaseConfigured()) {
    throw new Error(CATALOG_UNAVAILABLE);
  }

  const [
    categoriesResult,
    providersResult,
    providerCategoriesResult,
    servicesResult,
    portfolioResult,
    reviewsResult,
  ] = await Promise.all([
    supabase.from('categories').select('id, slug, name, icon').order('id'),
    supabase
      .from('providers')
      .select(
        'id, kind, name, bio, area, city, address, latitude, longitude, rating, review_count, starting_price_thb, image_url, featured, published',
      )
      .eq('published', true),
    supabase.from('provider_categories').select('provider_id, category_id'),
    supabase
      .from('services')
      .select('id, provider_id, category_id, name, duration_minutes, price_thb'),
    supabase
      .from('provider_portfolio')
      .select('id, provider_id, image_url, sort_order')
      .order('sort_order')
      .order('id'),
    supabase
      .from('reviews')
      .select('id, provider_id, author_name, rating, text, review_date')
      .order('review_date', { ascending: false }),
  ]);

  const firstError =
    categoriesResult.error ??
    providersResult.error ??
    providerCategoriesResult.error ??
    servicesResult.error ??
    portfolioResult.error ??
    reviewsResult.error;

  if (firstError) {
    throw new Error(firstError.message || CATALOG_UNAVAILABLE);
  }

  const categoryById = new Map<string, Category>();
  const categories: Category[] = [];

  for (const row of (categoriesResult.data ?? []) as CategoryRow[]) {
    const slug = parseCategorySlug(row.slug);
    if (!slug) {
      continue;
    }

    const category = { slug, label: row.name };
    categoryById.set(String(row.id), category);
    if (!categories.some((item) => item.slug === slug)) {
      categories.push(category);
    }
  }

  const slugsByProviderId = new Map<string, BeautyCategorySlug[]>();
  for (const row of (providerCategoriesResult.data ?? []) as ProviderCategoryRow[]) {
    const category = categoryById.get(String(row.category_id));
    if (!category) {
      continue;
    }

    const current = slugsByProviderId.get(row.provider_id) ?? [];
    if (!current.includes(category.slug)) {
      current.push(category.slug);
    }
    slugsByProviderId.set(row.provider_id, current);
  }

  const servicesByProviderId = new Map<string, Service[]>();
  for (const row of (servicesResult.data ?? []) as ServiceRow[]) {
    const service = mapServiceRow(row, categoryById);
    if (!service) {
      continue;
    }

    const current = servicesByProviderId.get(row.provider_id) ?? [];
    current.push(service);
    servicesByProviderId.set(row.provider_id, current);
  }

  const portfolioRowsByProviderId = new Map<string, PortfolioRow[]>();
  for (const row of (portfolioResult.data ?? []) as PortfolioRow[]) {
    const current = portfolioRowsByProviderId.get(row.provider_id) ?? [];
    current.push(row);
    portfolioRowsByProviderId.set(row.provider_id, current);
  }

  const portfolioByProviderId = new Map<string, PortfolioItem[]>();
  for (const [providerId, rows] of portfolioRowsByProviderId) {
    const items: PortfolioItem[] = [];
    const ordered = [...rows].sort((left, right) =>
      comparePortfolioOrder(
        { id: String(left.id), sortOrder: Number(left.sort_order) || 0 },
        { id: String(right.id), sortOrder: Number(right.sort_order) || 0 },
      ),
    );
    for (const row of ordered) {
      const item = mapPortfolioRow(row);
      if (item) {
        items.push(item);
      }
    }
    portfolioByProviderId.set(providerId, items);
  }

  const reviewsByProviderId = new Map<string, Review[]>();
  for (const row of (reviewsResult.data ?? []) as ReviewRow[]) {
    const review = mapReviewRow(row);
    if (!review) {
      continue;
    }

    const current = reviewsByProviderId.get(row.provider_id) ?? [];
    current.push(review);
    reviewsByProviderId.set(row.provider_id, current);
  }

  const providers = ((providersResult.data ?? []) as ProviderRow[])
    .map((row) =>
      mapProviderRow(row, {
        categories: slugsByProviderId.get(row.id) ?? [],
        services: servicesByProviderId.get(row.id) ?? [],
        portfolio: portfolioByProviderId.get(row.id) ?? [],
        reviews: reviewsByProviderId.get(row.id) ?? [],
      }),
    )
    .filter((provider): provider is Provider => provider !== undefined)
    .filter((provider) => provider.published === true);

  return { categories, providers };
}

function mapProviderRow(
  row: ProviderRow,
  related: {
    categories: BeautyCategorySlug[];
    services: Service[];
    portfolio: PortfolioItem[];
    reviews: Review[];
  },
): Provider | undefined {
  const kind = parseProviderKind(row.kind);
  const name = row.name?.trim();

  if (!kind || !row.id || !name) {
    return undefined;
  }

  const derivedStartingPrice = related.services.reduce<number | undefined>((lowest, service) => {
    if (lowest === undefined || service.priceThb < lowest) {
      return service.priceThb;
    }

    return lowest;
  }, undefined);

  return {
    id: row.id,
    kind,
    name,
    bio: row.bio?.trim() ?? '',
    categories: related.categories,
    area: row.area?.trim() ?? '',
    city: row.city?.trim() ?? '',
    address: row.address?.trim() ?? '',
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
    rating: asNumber(row.rating) ?? 0,
    reviewCount: asNumber(row.review_count) ?? 0,
    startingPriceThb: asNumber(row.starting_price_thb) ?? derivedStartingPrice ?? 0,
    imageUrl: row.image_url?.trim() ?? '',
    featured: row.featured === true,
    published: row.published === true,
    services: related.services,
    portfolio: related.portfolio,
    reviews: related.reviews,
  };
}

function mapServiceRowForBooking(row: ServiceRow): Service | undefined {
  const durationMinutes = asNumber(row.duration_minutes) ?? 0;
  const priceThb = asNumber(row.price_thb) ?? 0;
  const name = row.name?.trim();
  if (!row.id || !name) {
    return undefined;
  }

  return {
    id: row.id,
    name,
    category: 'other',
    durationMinutes,
    priceThb,
  };
}

function fallbackProvider(id: string): Provider {
  return {
    id,
    kind: 'specialist',
    name: 'This provider is no longer available',
    bio: '',
    categories: [],
    area: '',
    city: '',
    address: '',
    rating: 0,
    reviewCount: 0,
    startingPriceThb: 0,
    imageUrl: '',
    featured: false,
    published: false,
    services: [],
    portfolio: [],
    reviews: [],
  };
}

function fallbackService(id: string): Service {
  return {
    id,
    name: 'This service is no longer available',
    category: 'other',
    durationMinutes: 0,
    priceThb: 0,
  };
}

function mapServiceRow(
  row: ServiceRow,
  categoryById: Map<string, Category>,
): Service | undefined {
  const category = categoryById.get(String(row.category_id))?.slug;
  const durationMinutes = asNumber(row.duration_minutes);
  const priceThb = asNumber(row.price_thb);

  if (!category || durationMinutes === undefined || priceThb === undefined) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    category,
    durationMinutes,
    priceThb,
  };
}

function mapPortfolioRow(row: PortfolioRow): PortfolioItem | undefined {
  if (!row.image_url) {
    return undefined;
  }

  return {
    id: String(row.id),
    imageUrl: row.image_url,
  };
}

function mapReviewRow(row: ReviewRow): Review | undefined {
  const rating = asNumber(row.rating);
  if (rating === undefined) {
    return undefined;
  }

  return {
    id: String(row.id),
    authorName: row.author_name,
    rating,
    text: row.text,
    createdAt: row.review_date,
  };
}

function parseCategorySlug(value: string): BeautyCategorySlug | undefined {
  return CATEGORY_SLUGS.includes(value as BeautyCategorySlug)
    ? (value as BeautyCategorySlug)
    : undefined;
}

function parseProviderKind(value: string | null): ProviderKind | undefined {
  if (value === 'salon' || value === 'specialist') {
    return value;
  }

  return undefined;
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
