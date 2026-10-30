import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AuthResult =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; message: string };

const CONFIG_ERROR =
  'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to a .env file, then restart Expo.';

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: CONFIG_ERROR };
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name,
      },
    },
  });

  if (error) {
    return { ok: false, message: mapAuthError(error.message) };
  }

  if (data.user && !data.session) {
    return { ok: true, needsEmailConfirmation: true };
  }

  return { ok: true, needsEmailConfirmation: false };
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: CONFIG_ERROR };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    return { ok: false, message: mapAuthError(error.message) };
  }

  return { ok: true, needsEmailConfirmation: false };
}

export async function signOutUser(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: CONFIG_ERROR };
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, message: mapAuthError(error.message) };
  }

  return { ok: true, needsEmailConfirmation: false };
}

export function getUserDisplayName(metadata: Record<string, unknown> | undefined): string | undefined {
  const name = metadata?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
}

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  if (lower.includes('user already registered')) {
    return 'An account with this email already exists.';
  }

  if (lower.includes('password')) {
    return 'Password must be at least 6 characters.';
  }

  return message;
}
