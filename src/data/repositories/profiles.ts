import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type UserProfile = {
  id: string;
  fullName: string;
  createdAt: string;
};

export type ProfileMutationResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; message: string };

type ProfileRow = {
  id: string;
  created_at: string;
  full_name: string | null;
};

export async function getMyProfile(): Promise<UserProfile | undefined> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return undefined;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, created_at, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return undefined;
  }

  return mapProfileRow(data as ProfileRow);
}

export async function upsertMyProfile(fullName: string): Promise<ProfileMutationResult> {
  const userId = await getAuthenticatedUserId();
  const trimmed = fullName.trim();
  if (!userId) {
    return { ok: false, message: 'Sign in to edit your profile.' };
  }

  if (trimmed.length === 0) {
    return { ok: false, message: 'Name is required.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        full_name: trimmed,
      },
      { onConflict: 'id' },
    )
    .select('id, created_at, full_name')
    .single();

  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Could not save your profile.' };
  }

  const profile = mapProfileRow(data as ProfileRow);
  if (!profile) {
    return { ok: false, message: 'Could not save your profile.' };
  }

  return { ok: true, profile };
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

function mapProfileRow(row: ProfileRow): UserProfile | undefined {
  const fullName = row.full_name?.trim();
  if (!fullName) {
    return undefined;
  }

  return {
    id: row.id,
    fullName,
    createdAt: row.created_at,
  };
}
