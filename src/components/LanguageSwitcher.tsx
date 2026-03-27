import { useLanguage } from '@/i18n/LanguageContext';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex items-center bg-muted rounded-lg overflow-hidden text-xs font-sans font-medium">
      <button
        onClick={() => setLocale('en')}
        className={`px-2 py-1 transition ${locale === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale('sl')}
        className={`px-2 py-1 transition ${locale === 'sl' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        SL
      </button>
    </div>
  );
}
