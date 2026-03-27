import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { useLanguage } from '@/i18n/LanguageContext';
import { fetchBusinessUnits, parseBusinessUnit, publishToRelays, fetchSuspensions, fetchListings, parseEcoListing, type BusinessUnit, type UnitSuspension, type EcoListing } from '@/lib/nostr';
import { signNostrEvent } from '@/lib/nostrSigning';
import { BusinessUnitCard } from '@/components/BusinessUnitCard';
import { BusinessUnitForm } from '@/components/BusinessUnitForm';
import { StaffManager } from '@/components/StaffManager';
import { ListingCard } from '@/components/ListingCard';
import { ListingForm } from '@/components/ListingForm';
import { Plus, Loader2, LogOut, Store, RefreshCw, Leaf, ArrowLeft, ShoppingBag } from 'lucide-react';

export default function DashboardPage() {
  const { t } = useLanguage();
  const { session, logout } = useAuth();
  const { params } = useSystemParams();
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingUnit, setEditingUnit] = useState<BusinessUnit | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [staffUnit, setStaffUnit] = useState<BusinessUnit | null>(null);
  const [suspensions, setSuspensions] = useState<Record<string, UnitSuspension>>({});

  // Listings state
  const [listingsUnit, setListingsUnit] = useState<BusinessUnit | null>(null);
  const [listings, setListings] = useState<EcoListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [showListingForm, setShowListingForm] = useState(false);
  const [editingListing, setEditingListing] = useState<EcoListing | undefined>(undefined);
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null);

  const loadUnits = async () => {
    if (!session || !params?.relays) return;
    setIsLoading(true);
    try {
      const events = await fetchBusinessUnits(session.nostrHexId, params.relays);
      const parsed = events.map(parseBusinessUnit);
      parsed.sort((a, b) => a.name.localeCompare(b.name));
      setUnits(parsed);

      const unitIds = parsed.map(u => u.unitId).filter(Boolean);
      if (unitIds.length > 0) {
        const susps = await fetchSuspensions(unitIds, params.relays);
        setSuspensions(susps);
      }
    } catch (error) {
      console.error('Failed to fetch business units:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadListings = async (unit: BusinessUnit) => {
    if (!session || !params?.relays) return;
    setListingsLoading(true);
    try {
      const events = await fetchListings(params.relays, { authors: [session.nostrHexId] });
      const parsed = events.map(parseEcoListing);
      // Filter to this unit's listings
      const unitRef = `30901:${session.nostrHexId}:${unit.unitId}`;
      const unitListings = parsed.filter(l => l.unitRef === unitRef);
      unitListings.sort((a, b) => b.createdAt - a.createdAt);
      setListings(unitListings);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setListingsLoading(false);
    }
  };

  useEffect(() => { loadUnits(); }, [session, params]);

  const handleEdit = (unit: BusinessUnit) => { setEditingUnit(unit); setShowForm(true); };
  const handleCreate = () => { setEditingUnit(undefined); setShowForm(true); };
  const handleSaved = () => { setShowForm(false); setEditingUnit(undefined); setTimeout(loadUnits, 2000); };
  const handleBack = () => { setShowForm(false); setEditingUnit(undefined); };

  const handleDelete = async (unit: BusinessUnit) => {
    if (!session || !params?.relays) return;
    if (!window.confirm(t('dash.deleteConfirm', { name: unit.name }))) return;
    setDeletingUnitId(unit.unitId);
    try {
      const tags: string[][] = [['e', unit.eventId], ['a', `30901:${session.nostrHexId}:${unit.unitId}`]];
      const signedEvent = signNostrEvent(session.nostrPrivateKey, 5, `Deleting: ${unit.name}`, tags);
      const result = await publishToRelays(signedEvent, params.relays);
      if (result.success.length > 0) setUnits(prev => prev.filter(u => u.unitId !== unit.unitId));
      else alert(t('dash.deleteFailed'));
    } catch { alert(t('dash.deleteFailed')); }
    finally { setDeletingUnitId(null); }
  };

  const handleStaff = (unit: BusinessUnit) => { setStaffUnit(unit); };
  const handleStaffSaved = () => { setStaffUnit(null); setTimeout(loadUnits, 2000); };

  // Listings handlers
  const handleListings = (unit: BusinessUnit) => { setListingsUnit(unit); loadListings(unit); };
  const handleListingBack = () => { setListingsUnit(null); setListings([]); setShowListingForm(false); setEditingListing(undefined); };
  const handleListingCreate = () => { setEditingListing(undefined); setShowListingForm(true); };
  const handleListingEdit = (listing: EcoListing) => { setEditingListing(listing); setShowListingForm(true); };
  const handleListingSaved = () => { setShowListingForm(false); setEditingListing(undefined); if (listingsUnit) setTimeout(() => loadListings(listingsUnit), 2000); };
  const handleListingFormBack = () => { setShowListingForm(false); setEditingListing(undefined); };

  const handleListingDelete = async (listing: EcoListing) => {
    if (!session || !params?.relays) return;
    if (!window.confirm(t('dash.deleteListingConfirm', { name: listing.title }))) return;
    setDeletingListingId(listing.listingId);
    try {
      const tags: string[][] = [['e', listing.eventId], ['a', `36500:${session.nostrHexId}:${listing.listingId}`]];
      const signedEvent = signNostrEvent(session.nostrPrivateKey, 5, `Deleting listing: ${listing.title}`, tags);
      const result = await publishToRelays(signedEvent, params.relays);
      if (result.success.length > 0) setListings(prev => prev.filter(l => l.listingId !== listing.listingId));
      else alert(t('dash.deleteFailed'));
    } catch { alert(t('dash.deleteFailed')); }
    finally { setDeletingListingId(null); }
  };

  const exchangeRateText = params?.exchange_rates?.EUR ? `1 LANA = ${params.exchange_rates.EUR} EUR` : null;

  // === LISTING FORM VIEW ===
  if (showListingForm && listingsUnit) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <ListingForm unit={listingsUnit} listing={editingListing} onBack={handleListingFormBack} onSaved={handleListingSaved} />
      </div>
    );
  }

  // === LISTINGS VIEW (per unit) ===
  if (listingsUnit) {
    return (
      <div className="min-h-screen bg-background">
        <header className="bg-card border-b sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={handleListingBack} className="p-2 hover:bg-muted rounded-lg transition">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-bold text-foreground font-display">{t('dash.listings')}</h1>
                <p className="text-xs text-muted-foreground font-sans">{listingsUnit.name}</p>
              </div>
            </div>
            <button onClick={handleListingCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium">
              <Plus className="w-4 h-4" /> {t('dash.newListing')}
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          {listingsLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm font-sans">{t('dash.loadingListings')}</p>
            </div>
          )}

          {!listingsLoading && listings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <ShoppingBag className="w-12 h-12 mb-3 text-muted-foreground/40" />
              <p className="text-base font-medium text-foreground mb-1 font-display">{t('dash.noListings')}</p>
              <p className="text-sm font-sans mb-4">{t('dash.noListingsDesc')}</p>
              <button onClick={handleListingCreate}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium">
                <Plus className="w-4 h-4" /> {t('dash.createListing')}
              </button>
            </div>
          )}

          {!listingsLoading && listings.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map(listing => (
                <ListingCard key={listing.listingId} listing={listing} showActions
                  onEdit={handleListingEdit} onDelete={handleListingDelete}
                  isDeleting={deletingListingId === listing.listingId} />
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // === UNIT FORM VIEW ===
  if (showForm) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <BusinessUnitForm unit={editingUnit} onBack={handleBack} onSaved={handleSaved} />
      </div>
    );
  }

  // === MAIN DASHBOARD ===
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Leaf className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground font-display">{t('nav.brand')}</h1>
              <p className="text-xs text-muted-foreground font-sans">
                {session?.profileDisplayName || session?.profileName || session?.walletId?.slice(0, 12) + '...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {exchangeRateText && (
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">{exchangeRateText}</span>
            )}
            <button onClick={logout} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition font-sans">
              <LogOut className="w-4 h-4" /> {t('nav.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground font-display">
            {t('dash.units')}
            {!isLoading && <span className="text-sm font-normal text-muted-foreground ml-2 font-sans">({units.length})</span>}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={loadUnits} disabled={isLoading} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition" title={t('common.refresh')}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={handleCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium">
              <Plus className="w-4 h-4" /> {t('dash.newUnit')}
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm font-sans">{t('dash.loadingUnits')}</p>
          </div>
        )}

        {!isLoading && units.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Store className="w-12 h-12 mb-3 text-muted-foreground/40" />
            <p className="text-base font-medium text-foreground mb-1 font-display">{t('dash.noUnits')}</p>
            <p className="text-sm font-sans mb-4">{t('dash.noUnitsDesc')}</p>
            <button onClick={handleCreate} className="flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium">
              <Plus className="w-4 h-4" /> {t('dash.createUnit')}
            </button>
          </div>
        )}

        {!isLoading && units.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {units.map(unit => (
              <BusinessUnitCard key={unit.unitId} unit={unit}
                onEdit={handleEdit} onDelete={handleDelete} onStaff={handleStaff}
                onListings={handleListings}
                isDeleting={deletingUnitId === unit.unitId}
                suspension={suspensions[unit.unitId] || null} />
            ))}
          </div>
        )}

        {exchangeRateText && (
          <div className="sm:hidden mt-6 text-center">
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">{exchangeRateText}</span>
          </div>
        )}
      </main>

      {staffUnit && <StaffManager unit={staffUnit} onClose={() => setStaffUnit(null)} onSaved={handleStaffSaved} />}
    </div>
  );
}
