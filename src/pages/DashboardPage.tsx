import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { fetchBusinessUnits, parseBusinessUnit, publishToRelays, fetchSuspensions, type BusinessUnit, type UnitSuspension } from '@/lib/nostr';
import { signNostrEvent } from '@/lib/nostrSigning';
import { BusinessUnitCard } from '@/components/BusinessUnitCard';
import { BusinessUnitForm } from '@/components/BusinessUnitForm';
import { StaffManager } from '@/components/StaffManager';
import { Plus, Loader2, LogOut, Store, RefreshCw, Leaf } from 'lucide-react';

export default function DashboardPage() {
  const { session, logout } = useAuth();
  const { params } = useSystemParams();
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingUnit, setEditingUnit] = useState<BusinessUnit | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [staffUnit, setStaffUnit] = useState<BusinessUnit | null>(null);
  const [suspensions, setSuspensions] = useState<Record<string, UnitSuspension>>({});

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

  useEffect(() => {
    loadUnits();
  }, [session, params]);

  const handleEdit = (unit: BusinessUnit) => {
    setEditingUnit(unit);
    setShowForm(true);
  };

  const handleCreate = () => {
    setEditingUnit(undefined);
    setShowForm(true);
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditingUnit(undefined);
    setTimeout(loadUnits, 2000);
  };

  const handleBack = () => {
    setShowForm(false);
    setEditingUnit(undefined);
  };

  const handleDelete = async (unit: BusinessUnit) => {
    if (!session || !params?.relays) return;

    const confirmed = window.confirm(
      `Ali ste prepričani, da želite izbrisati "${unit.name}"?\n\nTo bo objavilo dogodek izbrisa (KIND 5) na vse relaje.`
    );
    if (!confirmed) return;

    setDeletingUnitId(unit.unitId);
    try {
      const tags: string[][] = [
        ['e', unit.eventId],
        ['a', `30901:${session.nostrHexId}:${unit.unitId}`],
      ];

      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        5,
        `Deleting business unit: ${unit.name}`,
        tags
      );

      const result = await publishToRelays(signedEvent, params.relays);

      if (result.success.length > 0) {
        setUnits(prev => prev.filter(u => u.unitId !== unit.unitId));
      } else {
        alert('Objava izbrisa ni uspela. Poskusite znova.');
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Izbris ni uspel. Poskusite znova.');
    } finally {
      setDeletingUnitId(null);
    }
  };

  const handleStaff = (unit: BusinessUnit) => {
    setStaffUnit(unit);
  };

  const handleStaffSaved = () => {
    setStaffUnit(null);
    setTimeout(loadUnits, 2000);
  };

  const exchangeRateText = params?.exchange_rates?.EUR
    ? `1 LANA = ${params.exchange_rates.EUR} EUR`
    : null;

  if (showForm) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <BusinessUnitForm
          unit={editingUnit}
          onBack={handleBack}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Leaf className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground font-display">Eko Imenik</h1>
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

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground font-display">
            Trgovske enote
            {!isLoading && (
              <span className="text-sm font-normal text-muted-foreground ml-2 font-sans">({units.length})</span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={loadUnits}
              disabled={isLoading}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition"
              title="Osveži"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium"
            >
              <Plus className="w-4 h-4" />
              Nova enota
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm font-sans">Nalaganje enot iz relejev...</p>
          </div>
        )}

        {!isLoading && units.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Store className="w-12 h-12 mb-3 text-muted-foreground/40" />
            <p className="text-base font-medium text-foreground mb-1 font-display">Nimate še nobene trgovske enote</p>
            <p className="text-sm font-sans mb-4">Ustvarite svojo prvo eko kmetijsko enoto.</p>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition text-sm font-sans font-medium"
            >
              <Plus className="w-4 h-4" />
              Ustvari enoto
            </button>
          </div>
        )}

        {!isLoading && units.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {units.map(unit => (
              <BusinessUnitCard
                key={unit.unitId}
                unit={unit}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onStaff={handleStaff}
                isDeleting={deletingUnitId === unit.unitId}
                suspension={suspensions[unit.unitId] || null}
              />
            ))}
          </div>
        )}

        {exchangeRateText && (
          <div className="sm:hidden mt-6 text-center">
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
              {exchangeRateText}
            </span>
          </div>
        )}
      </main>

      {staffUnit && (
        <StaffManager
          unit={staffUnit}
          onClose={() => setStaffUnit(null)}
          onSaved={handleStaffSaved}
        />
      )}
    </div>
  );
}
