import { useState, useCallback, useEffect } from 'react';

const KEY = 'lana-country-filter';

/**
 * Persistent country filter (raw country string from unit data — empty = all).
 * Stored in localStorage so the choice persists across pages and tabs.
 */
export function useCountryFilter(): [string, (c: string) => void] {
  const [country, setCountryState] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  });

  const setCountry = useCallback((c: string) => {
    setCountryState(c);
    try {
      if (c) localStorage.setItem(KEY, c);
      else localStorage.removeItem(KEY);
    } catch {}
  }, []);

  // Cross-tab / cross-component sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === KEY) {
        setCountryState(localStorage.getItem(KEY) || '');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return [country, setCountry];
}
