import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, MapPin, Leaf, Loader2, Store, Tag, Globe } from "lucide-react";
import { useLanguage } from '@/i18n/LanguageContext';
import { useCountryFilter } from '@/lib/countryFilter';
import { unitCountry, countryLabel, countryFlag } from '@/lib/locale';

interface EcoUnit {
  unitId: string;
  name: string;
  category: string;
  categoryDetail: string;
  country: string;
  receiverCity: string;
  receiverCountry: string;
  images: string[];
  content: string;
  status: string;
  registeredAt?: number;
  cashbackPercent: number;
}

const NEW_BADGE_WINDOW_DAYS = 30;
function isNew(registeredAt?: number): boolean {
  if (!registeredAt) return false;
  const ageDays = (Date.now() / 1000 - registeredAt) / 86400;
  return ageDays >= 0 && ageDays <= NEW_BADGE_WINDOW_DAYS;
}

export default function FarmersPage() {
  const { t, locale } = useLanguage();
  const [country, setCountry] = useCountryFilter();
  const [units, setUnits] = useState<EcoUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  useEffect(() => {
    fetch('/api/eco-units')
      .then(res => res.json())
      .then((data: EcoUnit[]) => {
        // Preserve server ordering (admin TOP/NEW first). Do NOT re-sort here,
        // or the client would override the admin's TOP ranking.
        setUnits(data.filter(u => u.status === 'active'));
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const categories = Array.from(new Set(units.map(u => u.category).filter(Boolean))).sort();
  const countries = useMemo(() => {
    const codes = new Set<string>();
    for (const u of units) {
      const c = unitCountry(u);
      if (c) codes.add(c);
    }
    return Array.from(codes).map(code => ({ code, label: countryLabel(code, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units, locale]);

  const filtered = units.filter(u => {
    const s = search.toLowerCase();
    const matchesSearch = !search ||
      u.name.toLowerCase().includes(s) ||
      u.category.toLowerCase().includes(s) ||
      (u.content || '').toLowerCase().includes(s) ||
      (u.receiverCity || '').toLowerCase().includes(s);
    const matchesCat = !selectedCategory || u.category === selectedCategory;
    const matchesCountry = !country || unitCountry(u) === country;
    return matchesSearch && matchesCat && matchesCountry;
  });

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="font-display text-3xl md:text-4xl font-bold">{t('farmers.title')}</h1>
      <p className="mt-2 text-muted-foreground font-sans">
        {t('farmers.subtitle')}
      </p>

      {/* Country filter — prominent row */}
      {countries.length > 1 && (
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm font-sans font-medium text-foreground mr-1">
            <Globe className="w-4 h-4 text-primary" />
            <span>{t('country.filter')}:</span>
          </div>
          <button
            type="button"
            onClick={() => setCountry('')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-sans font-medium border-2 transition ${
              country === ''
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-foreground border-muted hover:border-primary/50'
            }`}
          >
            {t('country.all')}
          </button>
          {countries.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCountry(c.code)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-sans font-medium border-2 transition ${
                country === c.code
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card text-foreground border-muted hover:border-primary/50'
              }`}
            >
              <span className="text-base leading-none">{countryFlag(c.code)}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('farmers.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">{t('productsPage.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm font-sans">{t('eco.loadingRelays')}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Store className="w-12 h-12 mb-3 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground mb-1 font-display">
            {search || selectedCategory ? t('common.noResults') : t('eco.noFarms')}
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((unit) => (
            <Link
              key={unit.unitId}
              to={`/enota/${unit.unitId}`}
              className="group bg-card border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              <div className="aspect-[16/10] overflow-hidden bg-muted relative">
                {isNew(unit.registeredAt) && (
                  <span className="absolute top-2 left-2 z-10 px-2.5 py-1 text-[10px] font-sans font-bold uppercase tracking-wider rounded-full bg-emerald-500 text-white shadow-md">
                    {t('badge.new' as any)}
                  </span>
                )}
                {(unit.thumbs?.[0] || unit.images[0]) ? (
                  <img
                    src={(unit.thumbs?.[0] || unit.images[0])}
                    alt={unit.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Store className="w-10 h-10 text-muted-foreground/30" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-display text-base font-semibold text-foreground truncate mb-1">
                  {unit.name}
                </h3>
                {(unit.receiverCity || unit.country) && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground font-sans mb-2">
                    <MapPin className="w-3.5 h-3.5" />
                    {[unit.receiverCity, unit.country].filter(Boolean).join(', ')}
                  </div>
                )}
                {unit.content && (
                  <p className="text-xs text-muted-foreground font-sans line-clamp-2 mb-2">
                    {unit.content}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-full text-sm font-sans font-bold shadow-sm">
                    🌿 {unit.cashbackPercent}% {t('badge.abundance')}
                  </span>
                  {unit.category && (
                    <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-sans font-medium">
                      <Leaf className="w-3 h-3" />
                      {unit.category}
                    </span>
                  )}
                  {unit.categoryDetail && (
                    <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-xs font-sans">
                      <Tag className="w-3 h-3" />
                      {unit.categoryDetail}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
