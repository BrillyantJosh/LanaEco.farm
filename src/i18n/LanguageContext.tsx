import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { translations, type Locale, type TranslationKey } from './translations';

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

function detectLocale(): Locale {
  // 1. URL ?lang= overrides everything (so links like /?lang=en work)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    if (urlLang === 'sl' || urlLang === 'en') {
      try { localStorage.setItem('lanaeco-lang', urlLang); } catch {}
      return urlLang;
    }
  }

  // 2. localStorage
  const saved = typeof window !== 'undefined' ? localStorage.getItem('lanaeco-lang') : null;
  if (saved === 'sl' || saved === 'en') return saved;

  // 3. Auto-detect from browser
  const browserLang = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)) || 'en';
  return browserLang.startsWith('sl') ? 'sl' : 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('lanaeco-lang', newLocale);
    document.documentElement.lang = newLocale;
  }, []);

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    const localeText = translations[locale]?.[key];
    const enText = translations.en[key];
    let text = localeText !== undefined ? localeText : enText !== undefined ? enText : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
