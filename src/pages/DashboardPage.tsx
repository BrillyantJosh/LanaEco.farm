import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { fetchBusinessUnits, parseBusinessUnit, type BusinessUnit } from '@/lib/nostr';
import { LogOut, Loader2, Store, RefreshCw, Leaf, MapPin, Tag } from 'lucide-react';

export default function DashboardPage() {
  const { session, logout } = useAuth();
  const { params } = useSystemParams();
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadUnits = async () => {
    if (!session || !params?.relays) return;

    setIsLoading(true);
    try {
      const events = await fetchBusinessUnits(session.nostrHexId, params.relays);
      const parsed = events.map(parseBusinessUnit);
      parsed.sort((a, b) => a.name.localeCompare(b.name));
      setUnits(parsed);
    } catch (error) {
      console.error('Failed to fetch business units:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUnits();
  }, [session, params]);

  // Build exchange rate display string
  const exchangeRateText = params?.exchange_rates?.EUR
    ? `1 LANA = ${params.exchange_rates.EUR} EUR`
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Leaf className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground font-display">
                Eko Imenik
              </h1>
              <p className="text-xs text-muted-foreground font-sans">
                {session?.profileDisplayName || session?.profileName || session?.walletId?.slice(0, 12) + '...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {exchangeRateText && (
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                {exchangeRateText}
              </span>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition font-sans"
            >
              <LogOut className="w-4 h-4" />
              Odjava
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground font-display">
            Trgovske enote
            {!isLoading && (
              <span className="text-sm font-normal text-muted-foreground ml-2 font-sans">
                ({units.length})
              </span>
            )}
          </h2>
          <button
            onClick={loadUnits}
            disabled={isLoading}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition"
            title="Osveži"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-card border rounded-xl p-5 animate-pulse"
              >
                <div className="h-5 bg-muted rounded w-3/4 mb-3" />
                <div className="h-4 bg-muted rounded w-1/2 mb-2" />
                <div className="h-4 bg-muted rounded w-2/3 mb-4" />
                <div className="flex gap-2">
                  <div className="h-6 bg-muted rounded-full w-16" />
                  <div className="h-6 bg-muted rounded-full w-14" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && units.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Store className="w-12 h-12 mb-3 text-muted-foreground/40" />
            <p className="text-base font-medium text-foreground mb-1 font-display">
              Nimate še nobene trgovske enote
            </p>
            <p className="text-sm font-sans mb-4">
              Ustvarite svojo prvo enoto na LanaPays Shop.
            </p>
            <a
              href="https://shop.lanapays.us"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium"
            >
              <Store className="w-4 h-4" />
              Odpri LanaPays Shop
            </a>
          </div>
        )}

        {/* Grid of business unit cards */}
        {!isLoading && units.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {units.map((unit) => (
              <div
                key={unit.unitId}
                className="bg-card border rounded-xl p-5 hover:shadow-md transition"
              >
                {/* Unit name */}
                <h3 className="font-display text-base font-semibold text-foreground truncate mb-2">
                  {unit.name || 'Brez imena'}
                </h3>

                {/* Country & currency */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground font-sans mb-3">
                  {unit.country && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {unit.country}
                    </span>
                  )}
                  {unit.currency && (
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {unit.currency}
                    </span>
                  )}
                </div>

                {/* Category */}
                {unit.category && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground font-sans mb-3">
                    <Tag className="w-3 h-3" />
                    {unit.category}
                    {unit.categoryDetail ? ` / ${unit.categoryDetail}` : ''}
                  </div>
                )}

                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-sans font-medium ${
                      unit.status === 'active'
                        ? 'bg-primary/10 text-primary'
                        : unit.status === 'paused'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {unit.status === 'active'
                      ? 'Aktivna'
                      : unit.status === 'paused'
                        ? 'Premor'
                        : unit.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Exchange rate on mobile */}
        {exchangeRateText && (
          <div className="sm:hidden mt-6 text-center">
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
              {exchangeRateText}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
