import type { CityId } from '@/constants/cities';

export type BeautyCategorySlug =
  | 'nails'
  | 'hair'
  | 'lashes'
  | 'brows'
  | 'makeup'
  | 'massage'
  | 'facial'
  | 'waxing'
  | 'other';

export type ProviderKind = 'specialist' | 'salon';

export type ProviderSearchFilters = {
  serviceQuery?: string;
  locationQuery?: string;
  cityId?: CityId;
  categorySlug?: BeautyCategorySlug | null;
  area?: string | null;
  kind?: ProviderKind | null;
  maxPriceThb?: number | null;
};

export type ProviderSearchFilterOptions = {
  categories: Category[];
  areas: string[];
  kinds: ProviderKind[];
  maxPricesThb: number[];
};

export type Category = {
  slug: BeautyCategorySlug;
  label: string;
};

export type Service = {
  id: string;
  name: string;
  category: BeautyCategorySlug;
  durationMinutes: number;
  priceThb: number;
};

export type PortfolioItem = {
  id: string;
  imageUrl: string;
  caption?: string;
};

export type Review = {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  createdAt: string;
};

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'completed'
  | 'cancelled';

export type Booking = {
  id: string;
  providerId: string;
  serviceId: string;
  date: string;
  time: string;
  createdAt: string;
  status: BookingStatus;
  durationMinutes?: number;
};

export type User = {
  id: string;
  name: string;
  avatarUrl?: string;
  city: string;
  favoriteProviderIds: string[];
};

export type Provider = {
  id: string;
  kind: ProviderKind;
  name: string;
  bio: string;
  categories: BeautyCategorySlug[];
  area: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating: number;
  reviewCount: number;
  startingPriceThb: number;
  imageUrl: string;
  featured: boolean;
  published?: boolean;
  services: Service[];
  portfolio: PortfolioItem[];
  reviews: Review[];
};
