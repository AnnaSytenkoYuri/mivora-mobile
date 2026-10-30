import { useEffect, useRef, useState, type DependencyList } from 'react';

function toKey(deps: DependencyList): string {
  return JSON.stringify(deps);
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  identity: DependencyList = deps,
  options?: { enabled?: boolean },
): {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
} {
  const enabled = options?.enabled ?? true;
  const identityKey = toKey(identity);
  const [data, setData] = useState<T | undefined>(undefined);
  const [dataIdentity, setDataIdentity] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [errorIdentity, setErrorIdentity] = useState<string | undefined>();
  const dataIdentityRef = useRef<string | undefined>(undefined);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const runIdentity = identityKey;
    const generation = { current: true };

    setErrorIdentity((current) => (current === runIdentity ? undefined : current));

    void loaderRef
      .current()
      .then((next) => {
        if (cancelled || !generation.current) {
          return;
        }

        dataIdentityRef.current = runIdentity;
        setData(next);
        setDataIdentity(runIdentity);
        setError(undefined);
        setErrorIdentity(undefined);
      })
      .catch((caught: unknown) => {
        if (cancelled || !generation.current) {
          return;
        }

        if (dataIdentityRef.current === runIdentity) {
          return;
        }

        setError(caught instanceof Error ? caught.message : 'Could not load catalog.');
        setErrorIdentity(runIdentity);
      });

    return () => {
      cancelled = true;
      generation.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies the load identity via deps
  }, [...deps, identityKey, enabled]);

  const resolved = dataIdentity === identityKey || errorIdentity === identityKey;

  return {
    data: dataIdentity === identityKey ? data : undefined,
    loading: !resolved,
    error: errorIdentity === identityKey ? error : undefined,
  };
}
