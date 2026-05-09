import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  ShieldCheck,
  Loader2,
  EyeOff,
  Eye,
  Search,
  Trash2,
  AlertTriangle,
  Package,
  Store,
  Ban,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
} from 'lucide-react';

const PAGE_SIZE = 50;
// Categories considered "shop" on this portal (lanaeco.farm is producer-focused).
const SHOP_CATEGORIES = new Set(['producer', 'eco farm', 'farmer']);

interface AdminUnit {
  unitId: string;
  pubkey: string;
  name: string;
  category: string;
  country: string;
  receiverCity?: string;
  images?: string[];
  logo?: string;
  globalSuspension: { reason: string; activeUntil: number | null } | null;
  localBlockId: number | null;     // provider-wide block id
  unitBlockId: number | null;      // single-unit block id
  topFeatureId: number | null;
  newFeatureId: number | null;
}

interface AdminListing {
  listingId: string;
  pubkey: string;
  title: string;
  type: string;
  price: string;
  priceCurrency: string;
  images?: string[];
  thumbs?: string[];
  globallySuspended: boolean;
  localBlockId: number | null;
  providerBlockId: number | null;
  topFeatureId: number | null;
  newFeatureId: number | null;
}

interface BlockRow {
  id: number;
  target_type: 'provider' | 'listing';
  target_pubkey: string;
  target_id: string | null;
  blocked_by_hex: string;
  reason: string | null;
  created_at: number;
}

type Tab = 'providers' | 'listings' | 'blocks';

export default function AdminPage() {
  const { session, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('providers');
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingBlock, setPendingBlock] = useState<{
    // 'provider' = the user clicked Hide on Providers tab — modal asks: this unit only / all from provider
    // 'listing'  = the user clicked Hide on Listings tab — modal asks: this listing only / all from provider
    source: 'provider' | 'listing';
    // Selected scope at submit time:
    //  'unit'     — block just this single business unit (all its listings hide too)
    //  'listing'  — block just this single listing
    //  'provider' — block all units and all listings of this pubkey
    scope?: 'provider' | 'listing' | 'unit';
    pubkey: string;
    unitId?: string;        // required for unit-scope (set when source='provider')
    listingId?: string;     // required for listing-scope (set when source='listing')
    label: string;          // listing title or unit name
    providerName?: string;  // shown when source=listing, for context
  } | null>(null);
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [shopOnly, setShopOnly] = useState(true);

  // Reset page when tab, search or filter changes
  useEffect(() => {
    setPage(1);
  }, [tab, search, shopOnly]);

  const adminHex = session?.nostrHexId || '';

  const headers = useCallback(
    () => ({ 'X-Admin-Hex': adminHex, 'Content-Type': 'application/json' }),
    [adminHex]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, l, b] = await Promise.all([
        fetch('/api/admin/units', { headers: headers() }).then((r) => r.json()),
        fetch('/api/admin/listings', { headers: headers() }).then((r) => r.json()),
        fetch('/api/admin/blocks', { headers: headers() }).then((r) => r.json()),
      ]);
      setUnits(Array.isArray(u) ? u : []);
      setListings(Array.isArray(l) ? l : []);
      setBlocks(Array.isArray(b) ? b : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const submitBlock = async () => {
    if (!pendingBlock) return;
    // Resolve scope: must be set by user choice (or default for legacy)
    const scope: 'provider' | 'listing' | 'unit' =
      pendingBlock.scope ||
      (pendingBlock.source === 'provider' ? 'provider' : 'listing');
    try {
      const body: any = {
        target_type: scope,
        target_pubkey: pendingBlock.pubkey,
        reason: reason.trim() || null,
      };
      if (scope === 'listing') {
        if (!pendingBlock.listingId) throw new Error('Missing listing id');
        body.target_id = pendingBlock.listingId;
      } else if (scope === 'unit') {
        if (!pendingBlock.unitId) throw new Error('Missing unit id');
        body.target_id = pendingBlock.unitId;
      }
      const res = await fetch('/api/admin/block', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to block');
      }
      setPendingBlock(null);
      setReason('');
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeBlock = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/block/${id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove block');
      }
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleFeature = async (
    target_type: 'provider' | 'listing' | 'unit',
    target_pubkey: string,
    target_id: string | null,
    feature_type: 'top' | 'new',
    existingId: number | null
  ) => {
    try {
      if (existingId) {
        const res = await fetch(`/api/admin/feature/${existingId}`, {
          method: 'DELETE',
          headers: headers(),
        });
        if (!res.ok) throw new Error('Failed to remove feature');
      } else {
        const body: any = { target_type, target_pubkey, feature_type };
        if ((target_type === 'listing' || target_type === 'unit') && target_id) {
          body.target_id = target_id;
        }
        const res = await fetch('/api/admin/feature', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to set feature');
        }
      }
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const truncate = (s: string, n = 16) =>
    s.length > n ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;

  const filteredUnits = useMemo(() => {
    return units.filter((u) => {
      if (shopOnly && !SHOP_CATEGORIES.has(String(u.category || '').trim().toLowerCase())) {
        return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (u.name || '').toLowerCase().includes(q) ||
        u.pubkey.toLowerCase().includes(q) ||
        (u.unitId || '').toLowerCase().includes(q)
      );
    });
  }, [units, search, shopOnly]);

  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (l.title || '').toLowerCase().includes(q) ||
        l.pubkey.toLowerCase().includes(q) ||
        (l.listingId || '').toLowerCase().includes(q)
      );
    });
  }, [listings, search]);

  // Pagination — pick the right list based on tab
  const activeList: any[] =
    tab === 'providers' ? filteredUnits : tab === 'listings' ? filteredListings : blocks;
  const totalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const paginatedUnits = filteredUnits.slice(startIdx, endIdx);
  const paginatedListings = filteredListings.slice(startIdx, endIdx);
  const paginatedBlocks = blocks.slice(startIdx, endIdx);

  const firstImage = (item: AdminUnit | AdminListing): string | null => {
    if ((item as AdminUnit).logo) return (item as AdminUnit).logo as string;
    const imgs = item.images || (item as AdminListing).thumbs || [];
    return imgs && imgs.length > 0 ? imgs[0] : null;
  };

  const Thumb = ({ src, alt }: { src: string | null; alt: string }) =>
    src ? (
      <div className="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-muted">
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={(e) => {
            const img = e.currentTarget;
            img.style.display = 'none';
            const fallback = img.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <div className="absolute inset-0 hidden items-center justify-center">
          <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
        </div>
      </div>
    ) : (
      <div className="w-12 h-12 flex-shrink-0 rounded-md bg-muted flex items-center justify-center">
        <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
      </div>
    );

  const Pagination = () =>
    totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm font-sans">
        <span className="text-xs text-muted-foreground">
          {startIdx + 1}–{Math.min(endIdx, activeList.length)} of {activeList.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 border rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 text-xs">
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 border rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-primary" />
          <div>
            <h1 className="font-display text-2xl font-bold">Admin panel</h1>
            <p className="text-xs text-muted-foreground font-sans">
              Signed in as {truncate(adminHex, 12)}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted font-sans"
        >
          Sign out
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg text-sm font-sans flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {(
          [
            ['providers', 'Providers', Store, filteredUnits.length],
            ['listings', 'Listings', Package, filteredListings.length],
            ['blocks', 'Active blocks', Ban, blocks.length],
          ] as [Tab, string, any, number][]
        ).map(([key, label, Icon, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-sans border-b-2 transition ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{count}</span>
          </button>
        ))}
      </div>

      {/* Search + filter */}
      {tab !== 'blocks' && (
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, title, or pubkey..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-lg font-sans text-sm bg-background"
            />
          </div>
          {tab === 'providers' && (
            <label className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-card text-sm font-sans cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shopOnly}
                onChange={(e) => setShopOnly(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Shops only
            </label>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === 'providers' ? (
        <div className="space-y-2">
          {filteredUnits.length === 0 && (
            <p className="text-sm text-muted-foreground font-sans text-center py-8">
              No providers found.
            </p>
          )}
          {paginatedUnits.map((u) => (
            <div
              key={`${u.pubkey}:${u.unitId}`}
              className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-card"
            >
              <Thumb src={firstImage(u)} alt={u.name || u.unitId} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{u.name || '(unnamed)'}</span>
                  {u.topFeatureId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-sans font-bold">
                      ★ TOP
                    </span>
                  )}
                  {u.newFeatureId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-sans font-bold">
                      NEW
                    </span>
                  )}
                  {u.globalSuspension && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-sans">
                      globally suspended
                    </span>
                  )}
                  {u.localBlockId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-sans">
                      provider hidden
                    </span>
                  )}
                  {u.unitBlockId && !u.localBlockId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-sans">
                      this shop hidden
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {u.pubkey}
                </p>
                <p className="text-xs text-muted-foreground font-sans">
                  {u.category} • {u.country} {u.receiverCity ? `• ${u.receiverCity}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() =>
                    toggleFeature('unit', u.pubkey, u.unitId, 'top', u.topFeatureId)
                  }
                  title={u.topFeatureId ? 'Remove TOP' : 'Mark as TOP'}
                  className={`px-2 py-1.5 text-[11px] border rounded-lg font-sans font-bold flex items-center gap-1 transition ${
                    u.topFeatureId
                      ? 'bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200'
                      : 'bg-card border-muted-foreground/20 text-muted-foreground hover:border-amber-300 hover:text-amber-700'
                  }`}
                >
                  ★ TOP
                </button>
                <button
                  onClick={() =>
                    toggleFeature('unit', u.pubkey, u.unitId, 'new', u.newFeatureId)
                  }
                  title={u.newFeatureId ? 'Remove NEW' : 'Mark as NEW'}
                  className={`px-2 py-1.5 text-[11px] border rounded-lg font-sans font-bold flex items-center gap-1 transition ${
                    u.newFeatureId
                      ? 'bg-blue-100 border-blue-400 text-blue-800 hover:bg-blue-200'
                      : 'bg-card border-muted-foreground/20 text-muted-foreground hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  NEW
                </button>
                {u.localBlockId ? (
                  <button
                    onClick={() => removeBlock(u.localBlockId!)}
                    className="px-3 py-1.5 text-xs border border-green-600/30 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-sans flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Show all
                  </button>
                ) : u.unitBlockId ? (
                  <button
                    onClick={() => removeBlock(u.unitBlockId!)}
                    className="px-3 py-1.5 text-xs border border-green-600/30 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-sans flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Show
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      setPendingBlock({
                        source: 'provider',
                        // No default scope — user picks in modal
                        pubkey: u.pubkey,
                        unitId: u.unitId,
                        label: u.name || u.unitId,
                      })
                    }
                    title="Hide this unit or the entire provider"
                    className="px-3 py-1.5 text-xs border border-orange-600/30 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 font-sans flex items-center gap-1 whitespace-nowrap"
                  >
                    <EyeOff className="w-3.5 h-3.5" /> Hide
                  </button>
                )}
              </div>
            </div>
          ))}
          <Pagination />
        </div>
      ) : tab === 'listings' ? (
        <div className="space-y-2">
          {filteredListings.length === 0 && (
            <p className="text-sm text-muted-foreground font-sans text-center py-8">
              No listings found.
            </p>
          )}
          {paginatedListings.map((l) => (
            <div
              key={`${l.pubkey}:${l.listingId}`}
              className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-card"
            >
              <Thumb src={firstImage(l)} alt={l.title || l.listingId} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{l.title || '(untitled)'}</span>
                  {l.topFeatureId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-sans font-bold">
                      ★ TOP
                    </span>
                  )}
                  {l.newFeatureId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-sans font-bold">
                      NEW
                    </span>
                  )}
                  {l.providerBlockId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-sans">
                      provider hidden
                    </span>
                  )}
                  {l.localBlockId && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-sans">
                      listing hidden
                    </span>
                  )}
                  {l.globallySuspended && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-sans">
                      globally suspended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-sans">
                  {l.type} • {l.price} {l.priceCurrency}
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {l.pubkey} / {l.listingId}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() =>
                    toggleFeature('listing', l.pubkey, l.listingId, 'top', l.topFeatureId)
                  }
                  title={l.topFeatureId ? 'Remove TOP' : 'Mark as TOP'}
                  className={`px-2 py-1.5 text-[11px] border rounded-lg font-sans font-bold transition ${
                    l.topFeatureId
                      ? 'bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200'
                      : 'bg-card border-muted-foreground/20 text-muted-foreground hover:border-amber-300 hover:text-amber-700'
                  }`}
                >
                  ★ TOP
                </button>
                <button
                  onClick={() =>
                    toggleFeature('listing', l.pubkey, l.listingId, 'new', l.newFeatureId)
                  }
                  title={l.newFeatureId ? 'Remove NEW' : 'Mark as NEW'}
                  className={`px-2 py-1.5 text-[11px] border rounded-lg font-sans font-bold transition ${
                    l.newFeatureId
                      ? 'bg-blue-100 border-blue-400 text-blue-800 hover:bg-blue-200'
                      : 'bg-card border-muted-foreground/20 text-muted-foreground hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  NEW
                </button>
                {l.localBlockId ? (
                  <button
                    onClick={() => removeBlock(l.localBlockId!)}
                    className="px-3 py-1.5 text-xs border border-green-600/30 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-sans flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Show
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const provider = units.find((u) => u.pubkey === l.pubkey);
                      setPendingBlock({
                        source: 'listing',
                        // No default scope — user must pick in modal
                        pubkey: l.pubkey,
                        listingId: l.listingId,
                        label: l.title || l.listingId,
                        providerName: provider?.name || '',
                      });
                    }}
                    className="px-3 py-1.5 text-xs border border-orange-600/30 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 font-sans flex items-center gap-1"
                  >
                    <EyeOff className="w-3.5 h-3.5" /> Hide
                  </button>
                )}
              </div>
            </div>
          ))}
          <Pagination />
        </div>
      ) : (
        // Blocks tab
        <div className="space-y-2">
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground font-sans text-center py-8">
              No active blocks.
            </p>
          )}
          {paginatedBlocks.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-sans">
                    {b.target_type}
                  </span>
                  <span className="font-mono text-xs">{truncate(b.target_pubkey)}</span>
                  {b.target_id && (
                    <span className="font-mono text-xs text-muted-foreground">
                      / {b.target_id}
                    </span>
                  )}
                </div>
                {b.reason && (
                  <p className="text-xs text-muted-foreground font-sans mt-1">
                    Reason: {b.reason}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground font-sans">
                  Blocked {new Date(b.created_at * 1000).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => removeBlock(b.id)}
                className="px-3 py-1.5 text-xs border border-red-600/30 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 font-sans flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          ))}
          <Pagination />
        </div>
      )}

      {/* Block modal */}
      {pendingBlock && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={() => {
            setPendingBlock(null);
            setReason('');
          }}
        >
          <div
            className="bg-card rounded-xl shadow-xl border max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Step 1: scope choice (source=listing OR source=provider) */}
            {!pendingBlock.scope ? (
              <>
                <h2 className="font-display text-lg font-bold mb-2">
                  What do you want to hide?
                </h2>
                <p className="text-sm font-sans mb-4">
                  {pendingBlock.source === 'listing' ? 'Listing' : 'Shop'}:{' '}
                  <strong>"{pendingBlock.label}"</strong>
                  {pendingBlock.providerName && (
                    <>
                      <br />
                      <span className="text-muted-foreground text-xs">
                        from provider: {pendingBlock.providerName}
                      </span>
                    </>
                  )}
                </p>

                {(() => {
                  const isShopUnit = (cat: string) =>
                    SHOP_CATEGORIES.has(String(cat || '').trim().toLowerCase());
                  const visibleUnits = units.filter(
                    (u) => u.pubkey === pendingBlock.pubkey && isShopUnit(u.category)
                  );
                  const providerListingsCount = listings.filter(
                    (x) => x.pubkey === pendingBlock.pubkey
                  ).length;
                  const providerUnitsCount = visibleUnits.length;
                  return (
                    <div className="space-y-2 mb-2">
                      {/* Single-narrow option: this listing OR this shop */}
                      <button
                        onClick={() =>
                          setPendingBlock({
                            ...pendingBlock,
                            scope: pendingBlock.source === 'listing' ? 'listing' : 'unit',
                          })
                        }
                        className="w-full text-left p-3 border rounded-lg hover:bg-muted/30 hover:border-primary/40 transition group"
                      >
                        <div className="font-sans font-semibold text-sm">
                          {pendingBlock.source === 'listing'
                            ? 'Only this listing'
                            : 'Only this shop (business unit)'}
                        </div>
                        <div className="text-xs text-muted-foreground font-sans mt-0.5">
                          {pendingBlock.source === 'listing' ? (
                            <>
                              Hide just <strong>"{pendingBlock.label}"</strong>. Other listings and shops from the same provider remain visible.
                            </>
                          ) : (
                            <>
                              Hide just <strong>"{pendingBlock.label}"</strong> (and any of its listings). Other shops from the same provider remain visible.
                            </>
                          )}
                        </div>
                      </button>

                      {/* Provider-wide option */}
                      <button
                        onClick={() =>
                          setPendingBlock({ ...pendingBlock, scope: 'provider' })
                        }
                        className="w-full text-left p-3 border rounded-lg hover:bg-orange-50 hover:border-orange-400 transition"
                      >
                        <div className="font-sans font-semibold text-sm">
                          Everything from this provider
                        </div>
                        <div className="text-xs text-orange-700/80 font-sans mt-0.5">
                          ⚠️ Hides{' '}
                          <strong>{providerUnitsCount}</strong> shop(s) and{' '}
                          <strong>{providerListingsCount}</strong> listing(s)
                          from this provider on lanaeco.farm.
                        </div>
                      </button>
                    </div>
                  );
                })()}

                <button
                  onClick={() => {
                    setPendingBlock(null);
                    setReason('');
                  }}
                  className="w-full mt-3 px-3 py-2 border rounded-lg text-sm font-sans hover:bg-muted"
                >
                  Cancel
                </button>
              </>
            ) : (
              /* Step 2 (or direct from Providers tab): confirm with optional reason */
              <>
                <h2 className="font-display text-lg font-bold mb-2">
                  {pendingBlock.scope === 'provider'
                    ? 'Hide entire provider'
                    : pendingBlock.scope === 'unit'
                    ? 'Hide single shop'
                    : 'Hide single listing'}
                </h2>
                <p className="text-sm font-sans mb-2">
                  <strong>"{pendingBlock.label}"</strong>
                </p>
                {pendingBlock.scope === 'provider' ? (
                  (() => {
                    const isShopUnit = (cat: string) =>
                      SHOP_CATEGORIES.has(String(cat || '').trim().toLowerCase());
                    const visibleUnitIds = new Set(
                      units
                        .filter(
                          (x) => x.pubkey === pendingBlock.pubkey && isShopUnit(x.category)
                        )
                        .map((x) => x.unitId)
                    );
                    const u = visibleUnitIds.size;
                    const l = listings.filter(
                      (x) => x.pubkey === pendingBlock.pubkey
                    ).length;
                    return (
                      <div className="mb-4 p-3 bg-orange-50 border border-orange-300 rounded-lg text-sm font-sans text-orange-900">
                        <strong>
                          ⚠️ This will hide {u} shop(s) and {l} listing(s) from this provider
                        </strong>{' '}
                        on lanaeco.farm until you unhide it.
                        <br />
                        <span className="text-xs opacity-80">
                          Only this portal is affected — other Lana portals (lana.pet, lana.fashion, etc.) are unaffected.
                        </span>
                      </div>
                    );
                  })()
                ) : pendingBlock.scope === 'unit' ? (
                  <p className="text-sm text-muted-foreground font-sans mb-4">
                    Only this <strong>one shop (business unit)</strong> and any of its listings will be hidden on lanaeco.farm. Other shops from the same provider will still appear.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground font-sans mb-4">
                    Only this <strong>one</strong> listing will be hidden on lanaeco.farm. Other listings from the same provider will still appear.
                  </p>
                )}
                <label className="block text-xs font-sans text-muted-foreground mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-sans bg-background mb-4"
                  placeholder="Internal note..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // Always go back to scope-choice step.
                      setPendingBlock({ ...pendingBlock, scope: undefined });
                    }}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm font-sans hover:bg-muted"
                  >
                    Back
                  </button>
                  <button
                    onClick={submitBlock}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-sans font-medium hover:bg-orange-700"
                  >
                    Confirm hide
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
