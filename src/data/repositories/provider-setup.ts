import { invalidateCatalogCache } from '@/data/repositories/catalog';
import { fetchMyWorkingHours, type WeekdayHoursDraft } from '@/data/repositories/provider-working-hours';
import type { ProviderKind } from '@/data/types';
import { hasConfiguredWeeklyHours } from '@/lib/business-setup-checklist';
import {
  SET_HOURS_BEFORE_PUBLISHING,
  UNPUBLISH_TO_REMOVE_COVER,
  canRemoveCoverWhilePublished,
  mapPublishedIntegrityError,
} from '@/lib/published-integrity';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type CreatedProviderProfile = {
  id: string;
  kind: ProviderKind;
  name: string;
  bio: string;
  area: string;
  city: string;
  address: string;
};

export type OwnedProviderProfile = CreatedProviderProfile & {
  imageUrl: string;
  startingPriceThb: number | undefined;
  serviceCount: number;
  published: boolean;
  latitude?: number;
  longitude?: number;
};

export type ProviderSetupResult =
  | { ok: true; provider: CreatedProviderProfile }
  | { ok: false; message: string };

export type ProviderUpdateResult =
  | { ok: true; provider: OwnedProviderProfile }
  | { ok: false; message: string };

export type CoverPhotoFile = {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
};

export type CoverPhotoResult =
  | { ok: true; provider: OwnedProviderProfile; warning?: string }
  | { ok: false; message: string };

type ProviderSetupInput = {
  kind: ProviderKind;
  name: string;
  city: string;
  area: string;
  address?: string;
  bio: string;
};

const NOT_CONFIGURED = 'Provider setup is unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to become a provider.';
const COVER_BUCKET = 'provider-covers';
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

let cachedUserId: string | undefined;
let cachedProvider: OwnedProviderProfile | null | undefined;

export function peekCachedMyProvider(userId: string): OwnedProviderProfile | null | undefined {
  if (cachedUserId !== userId) {
    return undefined;
  }

  return cachedProvider;
}

export function rememberMyProvider(userId: string, provider: OwnedProviderProfile | null): void {
  cachedUserId = userId;
  cachedProvider = provider;
}

export function invalidateMyProviderCache(): void {
  cachedUserId = undefined;
  cachedProvider = undefined;
}

const OWNED_PROVIDER_COLUMNS =
  'id, kind, name, bio, area, city, address, latitude, longitude, image_url, starting_price_thb, published';

type OwnedProviderRow = {
  id: string;
  kind: string | null;
  name: string | null;
  bio: string | null;
  area: string | null;
  city: string | null;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  image_url: string | null;
  starting_price_thb: number | string | null;
  published?: boolean | null;
};

export async function getMyProvider(options?: {
  bypassCache?: boolean;
}): Promise<OwnedProviderProfile | undefined> {
  if (!isSupabaseConfigured()) {
    return undefined;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return undefined;
  }

  if (cachedUserId !== undefined && cachedUserId !== user.id) {
    invalidateMyProviderCache();
  }

  if (!options?.bypassCache && cachedUserId === user.id && cachedProvider !== undefined) {
    return cachedProvider ?? undefined;
  }

  const { data, error } = await supabase
    .from('providers')
    .select(OWNED_PROVIDER_COLUMNS)
    .eq('owner_id', user.id)
    .order('name')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Could not load your business profile.');
  }

  if (!data) {
    rememberMyProvider(user.id, null);
    return undefined;
  }

  const mapped = mapOwnedProviderRow(data as OwnedProviderRow);
  if (!mapped) {
    rememberMyProvider(user.id, null);
    return undefined;
  }

  const { count, error: servicesError } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', mapped.id);

  if (servicesError) {
    throw new Error(servicesError.message || 'Could not load your business profile.');
  }

  const provider = {
    ...mapped,
    serviceCount: count ?? 0,
  };
  rememberMyProvider(user.id, provider);
  return provider;
}

export async function createMyProvider(input: ProviderSetupInput): Promise<ProviderSetupResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const kind = input.kind;
  const name = input.name.trim();
  const city = input.city.trim();
  const area = input.area.trim();
  const address = normalizeOptionalAddress(input.address);
  const bio = input.bio.trim();

  if (kind !== 'specialist' && kind !== 'salon') {
    return { ok: false, message: 'Choose Specialist or Salon.' };
  }

  if (name.length === 0) {
    return { ok: false, message: 'Business name is required.' };
  }

  if (city.length === 0) {
    return { ok: false, message: 'City is required.' };
  }

  if (area.length === 0) {
    return { ok: false, message: 'Area is required.' };
  }

  if (bio.length === 0) {
    return { ok: false, message: 'Bio is required.' };
  }

  const { data, error } = await supabase
    .from('providers')
    .insert({
      id: createProviderId(name),
      kind,
      name,
      bio,
      area,
      city,
      address,
      rating: 0,
      review_count: 0,
      featured: false,
      owner_id: user.id,
    })
    .select('id, kind, name, bio, area, city, address')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, message: 'A provider with this name already exists. Try a slightly different business name.' };
    }

    return { ok: false, message: error?.message ?? 'Could not create your provider profile.' };
  }

  const provider = {
    id: data.id,
    kind,
    name: data.name,
    bio: data.bio ?? bio,
    area: data.area ?? area,
    city: data.city ?? city,
    address: typeof data.address === 'string' ? data.address.trim() : address ?? '',
  };

  rememberMyProvider(user.id, {
    ...provider,
    imageUrl: '',
    startingPriceThb: undefined,
    serviceCount: 0,
    published: false,
  });

  return {
    ok: true,
    provider,
  };
}

export async function updateMyProvider(input: ProviderSetupInput): Promise<ProviderUpdateResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: 'Sign in to edit your business profile.' };
  }

  const kind = input.kind;
  const name = input.name.trim();
  const city = input.city.trim();
  const area = input.area.trim();
  const address = normalizeOptionalAddress(input.address);
  const bio = input.bio.trim();

  if (kind !== 'specialist' && kind !== 'salon') {
    return { ok: false, message: 'Choose Specialist or Salon.' };
  }

  if (name.length === 0) {
    return { ok: false, message: 'Business name is required.' };
  }

  if (city.length === 0) {
    return { ok: false, message: 'City is required.' };
  }

  if (area.length === 0) {
    return { ok: false, message: 'Area is required.' };
  }

  if (bio.length === 0) {
    return { ok: false, message: 'Bio is required.' };
  }

  const owned = await getMyProvider({ bypassCache: true });
  if (!owned) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const { data, error } = await supabase
    .from('providers')
    .update({
      kind,
      name,
      bio,
      area,
      city,
      address,
    })
    .eq('id', owned.id)
    .eq('owner_id', user.id)
    .select(OWNED_PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'A provider with this name already exists. Try a slightly different business name.' };
    }

    return {
      ok: false,
      message:
        mapPublishedIntegrityError(error.message) ??
        error.message ??
        'Could not save your business profile.',
    };
  }

  if (!data) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const mapped = mapOwnedProviderRow(data as OwnedProviderRow);
  if (!mapped) {
    return { ok: false, message: 'Could not save your business profile.' };
  }

  const cached = peekCachedMyProvider(user.id);
  const provider: OwnedProviderProfile = {
    ...mapped,
    startingPriceThb: mapped.startingPriceThb ?? cached?.startingPriceThb,
    serviceCount: cached?.serviceCount ?? mapped.serviceCount,
  };

  rememberMyProvider(user.id, provider);
  invalidateCatalogCache();

  return { ok: true, provider };
}

export async function updateMyProviderLocation(input: {
  latitude: number;
  longitude: number;
}): Promise<ProviderUpdateResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: 'Sign in to set your business location.' };
  }

  if (!isFiniteCoordinate(input.latitude, -90, 90) || !isFiniteCoordinate(input.longitude, -180, 180)) {
    return { ok: false, message: 'Choose a valid map location before confirming.' };
  }

  const owned = await getMyProvider({ bypassCache: true });
  if (!owned) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const { data, error } = await supabase
    .from('providers')
    .update({
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .eq('id', owned.id)
    .eq('owner_id', user.id)
    .select(OWNED_PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: error.message ?? 'Could not save your business location.',
    };
  }

  if (!data) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const mapped = mapOwnedProviderRow(data as OwnedProviderRow);
  if (!mapped) {
    return { ok: false, message: 'Could not save your business location.' };
  }

  const cached = peekCachedMyProvider(user.id);
  const provider: OwnedProviderProfile = {
    ...mapped,
    startingPriceThb: mapped.startingPriceThb ?? cached?.startingPriceThb,
    serviceCount: cached?.serviceCount ?? mapped.serviceCount,
  };

  rememberMyProvider(user.id, provider);
  invalidateCatalogCache();

  return { ok: true, provider };
}

export function getProviderPublishChecklist(provider: OwnedProviderProfile): {
  label: string;
  done: boolean;
}[] {
  return [
    { label: 'Business name', done: provider.name.trim().length > 0 },
    { label: 'Provider type', done: provider.kind === 'salon' || provider.kind === 'specialist' },
    { label: 'City', done: provider.city.trim().length > 0 },
    { label: 'Area', done: provider.area.trim().length > 0 },
    { label: 'Bio', done: provider.bio.trim().length > 0 },
    { label: 'Cover photo', done: provider.imageUrl.trim().length > 0 },
    { label: 'At least one service', done: provider.serviceCount > 0 },
  ];
}

export function isProviderReadyToPublish(
  provider: OwnedProviderProfile,
  hours?: readonly WeekdayHoursDraft[],
): boolean {
  if (!getProviderPublishChecklist(provider).every((item) => item.done)) {
    return false;
  }

  return hours !== undefined && hasConfiguredWeeklyHours(hours);
}

export async function publishMyProvider(): Promise<ProviderUpdateResult> {
  return setMyProviderPublished(true);
}

export async function unpublishMyProvider(): Promise<ProviderUpdateResult> {
  return setMyProviderPublished(false);
}

async function setMyProviderPublished(published: boolean): Promise<ProviderUpdateResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: 'Sign in to update your listing.' };
  }

  const owned = await getMyProvider({ bypassCache: true });
  if (!owned) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  if (published) {
    let hours;
    try {
      hours = await fetchMyWorkingHours();
    } catch (caught: unknown) {
      return {
        ok: false,
        message: caught instanceof Error ? caught.message : SET_HOURS_BEFORE_PUBLISHING,
      };
    }

    if (!hasConfiguredWeeklyHours(hours)) {
      return { ok: false, message: SET_HOURS_BEFORE_PUBLISHING };
    }

    if (!isProviderReadyToPublish(owned, hours)) {
      return {
        ok: false,
        message: 'Finish every profile item before publishing. Portfolio is optional.',
      };
    }
  }

  const { data, error } = await supabase
    .from('providers')
    .update({ published })
    .eq('id', owned.id)
    .eq('owner_id', user.id)
    .select(OWNED_PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: mapPublishedIntegrityError(error.message) ?? mapPublishError(error.message),
    };
  }

  if (!data) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const mapped = mapOwnedProviderRow(data as OwnedProviderRow);
  if (!mapped) {
    return { ok: false, message: 'Could not update your listing.' };
  }

  const cached = peekCachedMyProvider(user.id);
  const provider: OwnedProviderProfile = {
    ...mapped,
    startingPriceThb: mapped.startingPriceThb ?? cached?.startingPriceThb,
    serviceCount: cached?.serviceCount ?? mapped.serviceCount,
  };

  rememberMyProvider(user.id, provider);
  invalidateCatalogCache();
  return { ok: true, provider };
}

function mapPublishError(message: string | undefined): string {
  const text = message ?? '';
  if (text.toLowerCase().includes('cannot be published')) {
    return 'Finish your profile, add a service, and set weekly working hours before publishing. Portfolio is optional.';
  }

  return text.length > 0 ? text : 'Could not update your listing.';
}

export async function uploadMyProviderCoverPhoto(file: CoverPhotoFile): Promise<CoverPhotoResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const session = await requireOwnedProvider();
  if (!session.ok) {
    return session;
  }

  const { user, owned } = session;
  const previousUrl = owned.imageUrl;
  const prepared = await prepareCoverUpload(file);
  if (!prepared.ok) {
    return prepared;
  }

  const objectPath = `${owned.id}/cover-${Date.now()}.${prepared.ext}`;
  const { error: uploadError } = await supabase.storage.from(COVER_BUCKET).upload(objectPath, prepared.body, {
    contentType: prepared.mimeType,
    upsert: false,
  });

  if (uploadError) {
    return { ok: false, message: uploadError.message || 'Could not upload the cover photo.' };
  }

  const publicUrl = publicCoverUrl(objectPath);
  const saved = await persistOwnedImageUrl(user.id, owned.id, publicUrl);
  if (!saved.ok) {
    await supabase.storage.from(COVER_BUCKET).remove([objectPath]);
    return saved;
  }

  const cleanup = await removeCoverObjects(owned.id, previousUrl, [objectPath]);
  return cleanup.ok
    ? { ok: true, provider: saved.provider }
    : { ok: true, provider: saved.provider, warning: cleanup.message };
}

export async function removeMyProviderCoverPhoto(): Promise<CoverPhotoResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const session = await requireOwnedProvider();
  if (!session.ok) {
    return session;
  }

  const { user, owned } = session;
  if (!canRemoveCoverWhilePublished(owned.published)) {
    return { ok: false, message: UNPUBLISH_TO_REMOVE_COVER };
  }

  if (owned.imageUrl.length === 0) {
    return { ok: true, provider: owned };
  }

  const saved = await persistOwnedImageUrl(user.id, owned.id, null);
  if (!saved.ok) {
    return saved;
  }

  const cleanup = await removeCoverObjects(owned.id, owned.imageUrl);
  return cleanup.ok
    ? { ok: true, provider: saved.provider }
    : { ok: true, provider: saved.provider, warning: cleanup.message };
}

async function requireOwnedProvider():
  Promise<
    | { ok: true; user: { id: string }; owned: OwnedProviderProfile }
    | { ok: false; message: string }
  > {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: 'Sign in to change your cover photo.' };
  }

  const owned = await getMyProvider({ bypassCache: true });
  if (!owned) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  return { ok: true, user, owned };
}

async function persistOwnedImageUrl(
  userId: string,
  providerId: string,
  imageUrl: string | null,
): Promise<ProviderUpdateResult> {
  const { data, error } = await supabase
    .from('providers')
    .update({ image_url: imageUrl })
    .eq('id', providerId)
    .eq('owner_id', userId)
    .select(OWNED_PROVIDER_COLUMNS)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message:
        mapPublishedIntegrityError(error.message) ??
        error.message ??
        'Could not save the cover photo.',
    };
  }

  if (!data) {
    return { ok: false, message: 'No business profile was found for this account.' };
  }

  const mapped = mapOwnedProviderRow(data as OwnedProviderRow);
  if (!mapped) {
    return { ok: false, message: 'Could not save the cover photo.' };
  }

  const cached = peekCachedMyProvider(userId);
  const provider: OwnedProviderProfile = {
    ...mapped,
    startingPriceThb: mapped.startingPriceThb ?? cached?.startingPriceThb,
    serviceCount: cached?.serviceCount ?? mapped.serviceCount,
  };

  rememberMyProvider(userId, provider);
  invalidateCatalogCache();
  return { ok: true, provider };
}

async function prepareCoverUpload(
  file: CoverPhotoFile,
): Promise<{ ok: true; body: Uint8Array; mimeType: string; ext: string } | { ok: false; message: string }> {
  if (typeof file.fileSize === 'number' && file.fileSize > COVER_MAX_BYTES) {
    return { ok: false, message: 'Cover photos must be 5 MB or smaller.' };
  }

  const mimeType = normalizeCoverMime(file.mimeType, file.uri);
  if (!mimeType) {
    return { ok: false, message: 'Use a JPEG, PNG, or WebP image.' };
  }

  let body: Uint8Array;
  try {
    const response = await fetch(file.uri);
    if (!response.ok) {
      return { ok: false, message: 'Could not read the selected photo.' };
    }
    body = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, message: 'Could not read the selected photo.' };
  }

  if (body.byteLength > COVER_MAX_BYTES) {
    return { ok: false, message: 'Cover photos must be 5 MB or smaller.' };
  }

  if (body.byteLength === 0) {
    return { ok: false, message: 'The selected photo is empty.' };
  }

  return { ok: true, body, mimeType, ext: extensionForMime(mimeType) };
}

function normalizeCoverMime(mimeType: string | null | undefined, uri: string): string | undefined {
  const fromMime = mimeType?.trim().toLowerCase();
  if (fromMime === 'image/jpg') {
    return 'image/jpeg';
  }
  if (fromMime === 'image/jpeg' || fromMime === 'image/png' || fromMime === 'image/webp') {
    return fromMime;
  }

  const path = uri.split('?')[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? COVER_MIME_BY_EXT[ext] : undefined;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function publicCoverUrl(objectPath: string): string {
  const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(objectPath);
  const base = data.publicUrl.split('?')[0];
  return `${base}?v=${Date.now()}`;
}

function objectPathFromPublicUrl(url: string, providerId: string): string | undefined {
  const marker = `/object/public/${COVER_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) {
    return undefined;
  }

  const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0] ?? '');
  if (!path.startsWith(`${providerId}/`) || path.includes('..')) {
    return undefined;
  }

  return path;
}

async function removeCoverObjects(
  providerId: string,
  previousUrl: string,
  keepPaths: string[] = [],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const keep = new Set(keepPaths);
  const paths = new Set<string>();
  const fromUrl = objectPathFromPublicUrl(previousUrl, providerId);
  if (fromUrl && !keep.has(fromUrl)) {
    paths.add(fromUrl);
  }

  const { data: listed, error: listError } = await supabase.storage.from(COVER_BUCKET).list(providerId);
  if (!listError) {
    for (const item of listed ?? []) {
      const path = `${providerId}/${item.name}`;
      if (!keep.has(path)) {
        paths.add(path);
      }
    }
  }

  if (paths.size === 0) {
    return { ok: true };
  }

  const { error } = await supabase.storage.from(COVER_BUCKET).remove([...paths]);
  if (error) {
    return {
      ok: false,
      message: 'The cover photo was updated, but the previous file could not be deleted.',
    };
  }

  return { ok: true };
}

function mapOwnedProviderRow(row: OwnedProviderRow): OwnedProviderProfile | undefined {
  const kind = row.kind === 'salon' || row.kind === 'specialist' ? row.kind : undefined;
  const name = row.name?.trim();
  if (!kind || !row.id || !name) {
    return undefined;
  }

  const startingPrice =
    typeof row.starting_price_thb === 'number'
      ? row.starting_price_thb
      : typeof row.starting_price_thb === 'string' && row.starting_price_thb.length > 0
        ? Number(row.starting_price_thb)
        : undefined;

  return {
    id: row.id,
    kind,
    name,
    bio: row.bio?.trim() ?? '',
    area: row.area?.trim() ?? '',
    city: row.city?.trim() ?? '',
    address: row.address?.trim() ?? '',
    ...ownedCoordinatePair(row.latitude, row.longitude),
    imageUrl: row.image_url?.trim() ?? '',
    startingPriceThb: startingPrice !== undefined && Number.isFinite(startingPrice) ? startingPrice : undefined,
    serviceCount: 0,
    published: row.published === true,
  };
}

function isFiniteCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function parseOwnedCoordinate(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function ownedCoordinatePair(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): { latitude?: number; longitude?: number } {
  const lat = parseOwnedCoordinate(latitude);
  const lng = parseOwnedCoordinate(longitude);
  if (lat === undefined || lng === undefined) {
    return {};
  }

  return { latitude: lat, longitude: lng };
}

function normalizeOptionalAddress(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function createProviderId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);

  return slug.length > 0 ? `${slug}-${suffix}` : `provider-${suffix}`;
}
