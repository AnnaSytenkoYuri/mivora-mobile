import type { PortfolioItem } from '@/data/types';
import { invalidateCatalogCache } from '@/data/repositories/catalog';
import { PORTFOLIO_PHOTO_LIMIT, mapPortfolioLimitError } from '@/lib/portfolio-limit';
import {
  comparePortfolioOrder,
  mapPortfolioReorderError,
  parsePortfolioPhotoId,
  type PortfolioOrderDirection,
} from '@/lib/portfolio-order';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export const MAX_PORTFOLIO_PHOTOS = PORTFOLIO_PHOTO_LIMIT;

export type PortfolioPhotoFile = {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
};

export type PortfolioMutationResult =
  | { ok: true; items: PortfolioItem[]; warning?: string }
  | { ok: false; message: string };

type PortfolioRow = {
  id: number | string;
  provider_id: string;
  image_url: string | null;
  sort_order?: number | string | null;
};

const NOT_CONFIGURED = 'Portfolio is unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to manage your portfolio.';
const NOT_OWNER = 'Create a provider profile before managing your portfolio.';
const PORTFOLIO_BUCKET = 'provider-portfolio';
const PORTFOLIO_MAX_BYTES = 5 * 1024 * 1024;
const PORTFOLIO_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function getMyPortfolio(): Promise<PortfolioItem[]> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    throw new Error(owned.message);
  }

  return loadPortfolioForProvider(owned.providerId);
}

export async function addMyPortfolioPhoto(file: PortfolioPhotoFile): Promise<PortfolioMutationResult> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const existing = await loadPortfolioForProvider(owned.providerId);
  if (existing.length >= MAX_PORTFOLIO_PHOTOS) {
    return { ok: false, message: `You can add up to ${MAX_PORTFOLIO_PHOTOS} portfolio photos.` };
  }

  const prepared = await preparePortfolioUpload(file);
  if (!prepared.ok) {
    return prepared;
  }

  const objectPath = `${owned.providerId}/item-${Date.now()}.${prepared.ext}`;
  const { error: uploadError } = await supabase.storage.from(PORTFOLIO_BUCKET).upload(objectPath, prepared.body, {
    contentType: prepared.mimeType,
    upsert: false,
  });

  if (uploadError) {
    return { ok: false, message: uploadError.message || 'Could not upload the portfolio photo.' };
  }

  const imageUrl = publicPortfolioUrl(objectPath);
  const { data, error } = await supabase
    .from('provider_portfolio')
    .insert({
      provider_id: owned.providerId,
      image_url: imageUrl,
    })
    .select('id, provider_id, image_url, sort_order')
    .maybeSingle();

  if (error || !data) {
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([objectPath]);
    return {
      ok: false,
      message:
        mapPortfolioLimitError(error?.message) ??
        error?.message ??
        'Could not save the portfolio photo.',
    };
  }

  invalidateCatalogCache();
  return { ok: true, items: await loadPortfolioForProvider(owned.providerId) };
}

export async function deleteMyPortfolioPhoto(itemId: string): Promise<PortfolioMutationResult> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const { data, error } = await supabase
    .from('provider_portfolio')
    .delete()
    .eq('id', itemId)
    .eq('provider_id', owned.providerId)
    .select('id, image_url')
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || 'Could not delete this photo.' };
  }

  if (!data) {
    return { ok: false, message: 'This photo could not be deleted.' };
  }

  invalidateCatalogCache();
  const items = await loadPortfolioForProvider(owned.providerId);
  const objectPath = objectPathFromPublicUrl(data.image_url ?? '', owned.providerId);
  if (!objectPath) {
    return {
      ok: true,
      items,
      warning: 'The photo was removed, but the stored file could not be deleted.',
    };
  }

  const { error: removeError } = await supabase.storage.from(PORTFOLIO_BUCKET).remove([objectPath]);
  if (removeError) {
    return {
      ok: true,
      items,
      warning: 'The photo was removed, but the stored file could not be deleted.',
    };
  }

  return { ok: true, items };
}

export async function moveMyPortfolioPhoto(
  itemId: string,
  direction: PortfolioOrderDirection,
): Promise<PortfolioMutationResult> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const photoId = parsePortfolioPhotoId(itemId);
  if (photoId === undefined) {
    return { ok: false, message: 'This photo could not be moved.' };
  }

  const { error } = await supabase.rpc('move_my_portfolio_photo', {
    p_photo_id: photoId,
    p_direction: direction,
  });

  if (error) {
    return {
      ok: false,
      message:
        mapPortfolioReorderError(error.message) ?? error.message ?? 'Could not move this photo.',
    };
  }

  invalidateCatalogCache();
  return { ok: true, items: await loadPortfolioForProvider(owned.providerId) };
}

async function requireOwnedProvider(): Promise<
  { ok: true; providerId: string } | { ok: false; message: string }
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

  return { ok: true, providerId: data.id as string };
}

async function loadPortfolioForProvider(providerId: string): Promise<PortfolioItem[]> {
  const { data, error } = await supabase
    .from('provider_portfolio')
    .select('id, provider_id, image_url, sort_order')
    .eq('provider_id', providerId)
    .order('sort_order')
    .order('id');

  if (error) {
    throw new Error(error.message || 'Could not load your portfolio.');
  }

  const items: PortfolioItem[] = [];
  const ordered = [...((data ?? []) as PortfolioRow[])].sort((left, right) =>
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

  return items;
}

function mapPortfolioRow(row: PortfolioRow): PortfolioItem | undefined {
  const imageUrl = row.image_url?.trim();
  if (!imageUrl) {
    return undefined;
  }

  return {
    id: String(row.id),
    imageUrl,
  };
}

async function preparePortfolioUpload(
  file: PortfolioPhotoFile,
): Promise<{ ok: true; body: Uint8Array; mimeType: string; ext: string } | { ok: false; message: string }> {
  if (typeof file.fileSize === 'number' && file.fileSize > PORTFOLIO_MAX_BYTES) {
    return { ok: false, message: 'Portfolio photos must be 5 MB or smaller.' };
  }

  const mimeType = normalizePortfolioMime(file.mimeType, file.uri);
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

  if (body.byteLength > PORTFOLIO_MAX_BYTES) {
    return { ok: false, message: 'Portfolio photos must be 5 MB or smaller.' };
  }

  if (body.byteLength === 0) {
    return { ok: false, message: 'The selected photo is empty.' };
  }

  return { ok: true, body, mimeType, ext: extensionForMime(mimeType) };
}

function normalizePortfolioMime(mimeType: string | null | undefined, uri: string): string | undefined {
  const fromMime = mimeType?.trim().toLowerCase();
  if (fromMime === 'image/jpg') {
    return 'image/jpeg';
  }
  if (fromMime === 'image/jpeg' || fromMime === 'image/png' || fromMime === 'image/webp') {
    return fromMime;
  }

  const path = uri.split('?')[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? PORTFOLIO_MIME_BY_EXT[ext] : undefined;
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

function publicPortfolioUrl(objectPath: string): string {
  const { data } = supabase.storage.from(PORTFOLIO_BUCKET).getPublicUrl(objectPath);
  const base = data.publicUrl.split('?')[0];
  return `${base}?v=${Date.now()}`;
}

function objectPathFromPublicUrl(url: string, providerId: string): string | undefined {
  const marker = `/object/public/${PORTFOLIO_BUCKET}/`;
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
