import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { convertWifToIds } from '@/lib/crypto';
import { SimplePool } from 'nostr-tools';

declare global {
  interface Document {
    wasDiscarded?: boolean;
  }
}

export interface UserSession {
  lanaPrivateKey: string;
  walletId: string;
  walletIdCompressed?: string;
  walletIdUncompressed?: string;
  isCompressed?: boolean;
  nostrHexId: string;
  nostrNpubId: string;
  nostrPrivateKey: string;
  lanaWalletID?: string;
  profileName?: string;
  profileDisplayName?: string;
  profileCountry?: string;
  profileCurrency?: string;
  expiresAt: number;
}

interface AuthContextType {
  session: UserSession | null;
  isLoading: boolean;
  login: (wif: string, relays?: string[], rememberMe?: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'lana_pays_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isSessionValid = (s: UserSession): boolean => s.expiresAt > Date.now();

  const loadSessionFromStorage = useCallback((): UserSession | null => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed: UserSession = JSON.parse(stored);
        if (isSessionValid(parsed)) return parsed;
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (error) {
      console.error('Failed to parse stored session:', error);
    }
    return null;
  }, []);

  useEffect(() => {
    const loaded = loadSessionFromStorage();
    if (loaded) {
      setSession(loaded);
      console.log('Session loaded, expires:', new Date(loaded.expiresAt));
    }
    setIsLoading(false);
  }, [loadSessionFromStorage]);

  // Chrome Memory Saver restore
  useEffect(() => {
    if (document.wasDiscarded) {
      const loaded = loadSessionFromStorage();
      if (loaded) setSession(loaded);
    }
  }, [loadSessionFromStorage]);

  // Save session on tab background
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && session) {
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [session]);

  // Cross-tab sync
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        if (e.newValue === null) {
          setSession(null);
        } else {
          try {
            const updated: UserSession = JSON.parse(e.newValue);
            if (isSessionValid(updated)) setSession(updated);
          } catch {}
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = async (wif: string, relays?: string[], rememberMe: boolean = false) => {
    const derivedIds = await convertWifToIds(wif);
    let lanaWalletID: string | undefined;
    let profileName: string | undefined;
    let profileDisplayName: string | undefined;
    let profileCountry: string | undefined;
    let profileCurrency: string | undefined;

    if (relays && relays.length > 0) {
      const pool = new SimplePool();
      try {
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 5000)
        );

        const profileEvent = await Promise.race([
          pool.get(relays, {
            kinds: [0],
            authors: [derivedIds.nostrHexId],
            limit: 1
          }),
          timeoutPromise
        ]);

        if (profileEvent && profileEvent.kind === 0) {
          try {
            const content = JSON.parse(profileEvent.content);
            lanaWalletID = content.lanaWalletID;
            profileName = content.name;
            profileDisplayName = content.display_name;
            profileCountry = content.country;
            profileCurrency = content.currency;
          } catch {}
        } else {
          throw new Error('Profile not found. Please create your profile first.');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          pool.close(relays);
          throw new Error('Unable to verify profile. Network timeout. Please try again.');
        }
        if (error instanceof Error && error.message.includes('Profile not found')) {
          pool.close(relays);
          throw error;
        }
        throw new Error('Profile not found. Please create your profile first.');
      } finally {
        pool.close(relays);
      }
    }

    const expirationDays = rememberMe ? 90 : 30;
    const userSession: UserSession = {
      lanaPrivateKey: derivedIds.lanaPrivateKey,
      walletId: derivedIds.walletId,
      walletIdCompressed: derivedIds.walletIdCompressed,
      walletIdUncompressed: derivedIds.walletIdUncompressed,
      isCompressed: derivedIds.isCompressed,
      nostrHexId: derivedIds.nostrHexId,
      nostrNpubId: derivedIds.nostrNpubId,
      nostrPrivateKey: derivedIds.nostrPrivateKey,
      lanaWalletID,
      profileName,
      profileDisplayName,
      profileCountry,
      profileCurrency,
      expiresAt: Date.now() + (expirationDays * 24 * 60 * 60 * 1000)
    };

    setSession(userSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(SESSION_KEY);
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
