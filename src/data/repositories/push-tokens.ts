import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type PushTokenMutationResult = { ok: true } | { ok: false; message: string };

export async function registerMyPushToken(
  token: string,
  platform: 'ios' | 'android',
): Promise<PushTokenMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Push tokens are unavailable until Supabase is configured.' };
  }

  const { error } = await supabase.rpc('register_my_push_token', {
    p_token: token,
    p_platform: platform,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

export async function unregisterMyPushToken(token: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  await supabase.rpc('unregister_my_push_token', {
    p_token: token,
  });
}
