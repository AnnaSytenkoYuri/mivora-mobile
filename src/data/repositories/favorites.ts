import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type FavoriteRow = {
  provider_id: string;
};

export async function fetchMyFavoriteProviderIds(): Promise<string[]> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('favorites')
    .select('provider_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return uniqueProviderIds((data as FavoriteRow[]).map((row) => row.provider_id));
}

export async function addFavorite(providerId: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return;
  }

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', userId)
    .eq('provider_id', providerId)
    .maybeSingle();

  if (existing) {
    return;
  }

  await supabase.from('favorites').insert({
    user_id: userId,
    provider_id: providerId,
  });
}

export async function removeFavorite(providerId: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return;
  }

  await supabase.from('favorites').delete().eq('user_id', userId).eq('provider_id', providerId);
}

async function getAuthenticatedUserId(): Promise<string | undefined> {
  if (!isSupabaseConfigured()) {
    return undefined;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return undefined;
  }

  return data.user.id;
}

function uniqueProviderIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}
