import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_CITY_ID, cityLabel, type CityId } from '@/constants/cities';
import { loadSelectedCityId, saveSelectedCityId } from '@/lib/city-storage';

type SelectedCityContextValue = {
  cityId: CityId;
  cityLabel: string;
  setCityId: (cityId: CityId) => void;
};

const SelectedCityContext = createContext<SelectedCityContextValue | null>(null);

export function SelectedCityProvider({ children }: { children: ReactNode }) {
  const [cityId, setCityIdState] = useState<CityId>(DEFAULT_CITY_ID);

  useEffect(() => {
    let cancelled = false;

    void loadSelectedCityId().then((loaded) => {
      if (!cancelled) {
        setCityIdState(loaded);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setCityId = useCallback((next: CityId) => {
    setCityIdState(next);
    void saveSelectedCityId(next);
  }, []);

  const value = useMemo(
    () => ({
      cityId,
      cityLabel: cityLabel(cityId),
      setCityId,
    }),
    [cityId, setCityId],
  );

  return <SelectedCityContext.Provider value={value}>{children}</SelectedCityContext.Provider>;
}

export function useSelectedCity(): SelectedCityContextValue {
  const context = useContext(SelectedCityContext);
  if (!context) {
    throw new Error('useSelectedCity must be used within SelectedCityProvider.');
  }

  return context;
}
