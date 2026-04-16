import { useState, useEffect } from 'react';
import { Search, Filter, Loader2, ShoppingBag } from 'lucide-react';
import { ListingCard } from '@/components/ListingCard';
import type { EcoListing } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

const CATEGORY_FILTERS = [
  'vegetables', 'fruits', 'dairy', 'meat', 'eggs', 'honey',
  'herbs', 'grains', 'preserved', 'drinks', 'mushrooms', 'flowers', 'seeds'
];

export default function ListingsPage() {
  const { t, locale } = useLanguage();
  const [listings, setListings] = useState<EcoListing[]>([]);
  const [filtered, setFiltered] = useState<EcoListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [unitCountryMap, setUnitCountryMap] = useState<Record<string, string>>({});

  const TYPE_FILTERS = [
    { value: '', label: t('listingsPage.all') },
    { value: 'product', label: t('listingsPage.products') },
    { value: 'subscription', label: t('listingsPage.subscriptions') },
    { value: 'service', label: t('listingsPage.services') },
    { value: 'experience', label: t('listingsPage.experiences') },
  ];

  useEffect(() => {
    fetch('/api/listings')
      .then(r => r.json())
      .then((data: EcoListing[]) => {
        setListings(data);
        setFiltered(data);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // Fetch unit country data for language-based filtering
  useEffect(() => {
    fetch('/api/eco-units')
      .then(r => r.json())
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data.forEach((u: any) => { if (u.unitId) map[u.unitId] = u.country || ''; });
        setUnitCountryMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let result = listings;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(l =>
        l.title.toLowerCase().includes(s) ||
        l.content.toLowerCase().includes(s) ||
        l.tags.some((t: string) => t.toLowerCase().includes(s))
      );
    }
    if (typeFilter) result = result.filter(l => l.type === typeFilter);
    if (categoryFilter) result = result.filter(l => l.tags.includes(categoryFilter));
    // Country filter — SL locale: only SI units; EN locale: only non-SI units (empty country = show always)
    result = result.filter((l: any) => {
      const isSI = (v: string) => ['SI','SLO','SLOVENIA','SLOVENIJA','SL'].includes(v.trim().toUpperCase());
      const unitId = (l.unitRef || '').split(':')[2] || '';
      const country = unitCountryMap[unitId] || '';
      if (!country) return true; // no country set → show for all locales
      if (locale === 'sl') return isSI(country);
      if (locale === 'en') return !isSI(country);
      return true;
    });
    // Sort by cashback % descending — best deals first
    result.sort((a: any, b: any) => (b.cashbackPercent || 5) - (a.cashbackPercent || 5));
    setFiltered(result);
  }, [search, typeFilter, categoryFilter, listings, locale, unitCountryMap]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold mb-2">{t('listingsPage.title')}</h1>
        <p className="text-muted-foreground font-sans">{t('listingsPage.subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('listingsPage.search')}
            className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm font-sans"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 border rounded-lg text-sm font-sans">
          {TYPE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 border rounded-lg text-sm font-sans">
          <option value="">{t('listingsPage.allCategories')}</option>
          {CATEGORY_FILTERS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm font-sans">{t('listingsPage.loading')}</p>
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ShoppingBag className="w-12 h-12 mb-3 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground mb-1 font-display">{t('listingsPage.noFound')}</p>
          <p className="text-sm font-sans">{t('listingsPage.tryFilters')}</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground font-sans mb-4">{(() => {
            const n = filtered.length;
            const key = (n === 1 ? 'listingsPage.count1' : n === 2 ? 'listingsPage.count2' : 'listingsPage.count') as TranslationKey;
            const fallback = t(key);
            return fallback !== key ? t(key, { count: n }) : t('listingsPage.count', { count: n });
          })()}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(listing => (
              <ListingCard key={`${listing.pubkey}-${listing.listingId}`} listing={listing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
