import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return supabaseUrl.length > 0 && supabaseAnonKey.length > 0;
}

function isWebServer(): boolean {
  return Platform.OS === 'web' && typeof globalThis.window === 'undefined';
}

const authStorage: SupportedStorage = {
  getItem: (key) => {
    if (isWebServer()) {
      return Promise.resolve(null);
    }

    return AsyncStorage.getItem(key);
  },
  setItem: (key, value) => {
    if (isWebServer()) {
      return Promise.resolve();
    }

    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (isWebServer()) {
      return Promise.resolve();
    }

    return AsyncStorage.removeItem(key);
  },
};

const webServer = isWebServer();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: !webServer,
    persistSession: !webServer,
    detectSessionInUrl: false,
  },
});

if (!webServer && isSupabaseConfigured()) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
