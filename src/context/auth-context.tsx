import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  getMyProfile,
  upsertMyProfile,
  type ProfileMutationResult,
  type UserProfile,
} from '@/data/repositories/profiles';
import {
  getUserDisplayName,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  type AuthResult,
} from '@/lib/auth';
import { unregisterCurrentDevicePushTokenBestEffort } from '@/lib/push-token-device';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  displayName: string | undefined;
  isLoading: boolean;
  signUp: (input: { name: string; email: string; password: string }) => Promise<AuthResult>;
  signIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  updateFullName: (fullName: string) => Promise<ProfileMutationResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) {
        return;
      }

      setSession(data.session);
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession) {
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const metadataName = getUserDisplayName(user.user_metadata);
    let cancelled = false;

    void (async () => {
      const loaded = await getMyProfile();
      if (cancelled) {
        return;
      }

      if (loaded) {
        setProfile(loaded);
        return;
      }

      if (metadataName) {
        const saved = await upsertMyProfile(metadataName);
        if (!cancelled) {
          setProfile(saved.ok ? saved.profile : null);
        }
        return;
      }

      setProfile(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const signUp = useCallback(async (input: { name: string; email: string; password: string }) => {
    const result = await signUpWithEmail(input);
    if (result.ok && !result.needsEmailConfirmation) {
      const saved = await upsertMyProfile(input.name);
      if (saved.ok) {
        setProfile(saved.profile);
      }
    }

    return result;
  }, []);

  const signIn = useCallback(async (input: { email: string; password: string }) => {
    return signInWithEmail(input);
  }, []);

  const updateFullName = useCallback(async (fullName: string): Promise<ProfileMutationResult> => {
    const result = await upsertMyProfile(fullName);
    if (result.ok) {
      setProfile(result.profile);
    }

    return result;
  }, []);

  const signOut = useCallback(async () => {
    await unregisterCurrentDevicePushTokenBestEffort();
    const result = await signOutUser();
    if (result.ok) {
      setProfile(null);
    }

    return result;
  }, []);

  const displayName = profile?.fullName ?? getUserDisplayName(user?.user_metadata);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      displayName,
      isLoading,
      signUp,
      signIn,
      signOut,
      updateFullName,
    }),
    [session, user, profile, displayName, isLoading, signUp, signIn, signOut, updateFullName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
