import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string) {
  const subscribe = useCallback((changed: () => void) => {
    const media = window.matchMedia?.(query);
    media?.addEventListener('change', changed);
    return () => media?.removeEventListener('change', changed);
  }, [query]);
  const snapshot = useCallback(() => window.matchMedia?.(query).matches ?? false, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export const mobileLayoutQuery = '(max-width: 767px)';
