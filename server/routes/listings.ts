import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { parseListing } from '../lib/parsers.js';
import {
  loadUnitMeta, isBuyable, availableQty, unitKey, listingOwnsUnitRef, orderingConfigured, PORTAL_CATEGORIES,
  type Buyability,
} from '../lib/onlineShop.js';

// The categories this portal serves live in lib/onlineShop.ts (one copy for
// the catalogue, the units page, the admin views and the buy gate).
export { PORTAL_CATEGORIES };

const DEFAULT_CASHBACK = 5;

/**
 * Every listing this portal shows, newest first, in the shape GET
 * /api/listings has always returned — plus the Lana Online Shop fields
 * (SPEC §9.3): kind, buyable, notBuyableReason, unitCurrency, unitOwnerHex,
 * unitName, shippingFee, pickup, availableQty.
 *
 * Filters out:
 *   - listings whose unit is globally suspended (KIND 30903 with status='suspended' and not expired)
 *   - listings whose provider OR specific listing is locally blocked (admin moderation)
 *   - listings whose status != 'active'
 *
 * `buyable` is computed per request from the merchant-signed raw events
 * (fail-closed, lib/onlineShop.ts isBuyable) and availableQty from PAID
 * orders, so neither is ever cached.
 */
function visibleListings(db: Database.Database, now: number): any[] {
  const rows = db
    .prepare(
      `
      SELECT
        l.parsed_json,
        l.raw_event,
        l.unit_id,
        l.pubkey,
        l.listing_id,
        fp.lana_discount_per,
        fp.status AS fee_status,
        gs.unit_id AS suspended_unit_id,
        gs.status AS suspension_status,
        gs.active_until AS suspension_active_until
      FROM listings l
      LEFT JOIN fee_policies fp ON fp.unit_id = l.unit_id AND fp.owner_pubkey = l.pubkey
      LEFT JOIN global_suspensions gs ON gs.unit_id = l.unit_id AND gs.owner_pubkey = l.pubkey
      ORDER BY l.event_created_at DESC
    `
    )
    .all() as any[];

  // Build set of units (unitKey: signer + unit id) whose category matches
  // this portal — listings whose unit isn't in this set are excluded. A
  // listing's unit is its SIGNER's 30901, never another key's 30901 that
  // reuses the unit id.
  const allowedUnits = new Set<string>();
  const unitRows = db
    .prepare(`SELECT pubkey, unit_id, parsed_json FROM business_units`)
    .all() as any[];
  for (const u of unitRows) {
    try {
      const p = JSON.parse(u.parsed_json);
      const cat = String(p.category || '').trim().toLowerCase();
      if (p.status && p.status !== 'active') continue; // archived/non-active unit → hide its listings too
      if (PORTAL_CATEGORIES.has(cat)) allowedUnits.add(unitKey(u.pubkey, u.unit_id));
    } catch {}
  }
  // Online-shop metadata per unit (re-parsed from the signed 30901):
  // currency, owner hex, shipping fee, pickup, staff, registration gate.
  const unitMeta = loadUnitMeta(db, now);
  const ordering = orderingConfigured();

  // Build sets of locally blocked: provider-wide / unit-wide / specific-listing
  const providerBlocks = new Set<string>();
  const unitBlocks = new Set<string>();
  const listingBlocks = new Set<string>();
  const blockRows = db
    .prepare(
      `SELECT target_type, target_pubkey, target_id FROM local_blocks`
    )
    .all() as any[];
  for (const b of blockRows) {
    if (b.target_type === 'provider') {
      providerBlocks.add(b.target_pubkey);
    } else if (b.target_type === 'unit' && b.target_id) {
      unitBlocks.add(`${b.target_pubkey}:${b.target_id}`);
    } else if (b.target_type === 'listing' && b.target_id) {
      listingBlocks.add(`${b.target_pubkey}:${b.target_id}`);
    }
  }

  // Map listing-level features only — unit-level features apply only to
  // providers (NOT inherited to their listings). Each listing must be
  // explicitly marked TOP/NEW via the Listings tab to be featured.
  type Feat = { type: string; createdAt: number };
  const listingFeatures = new Map<string, Feat>();
  const featureRows = db
    .prepare(
      `SELECT target_pubkey, target_id, feature_type, created_at FROM local_features
       WHERE target_type = 'listing' AND target_id IS NOT NULL`
    )
    .all() as any[];
  for (const f of featureRows) {
    listingFeatures.set(
      `${f.target_pubkey}:${f.target_id}`,
      { type: f.feature_type, createdAt: f.created_at || 0 }
    );
  }

  const listings: any[] = [];
  for (const r of rows) {
    // global suspension check
    // Strict allowlist: a unit is public ONLY if its latest KIND 30903
    // has status='active' (and any expiry hasn't passed). Hides
    // pending / suspended / frozen-label / rejected / quota_blocked /
    // quota_warning_80, plus any unit that never received a KIND 30903.
    const statusActive =
      (r.suspension_status === 'active' || String(r.suspension_status || '').startsWith('quota_warning')) &&
      (!r.suspension_active_until || r.suspension_active_until > now);
    if (!statusActive) continue;
    // portal category filter (skip listings whose unit isn't in this portal's categories)
    if (!allowedUnits.has(unitKey(r.pubkey, r.unit_id))) continue;
    // local block check
    if (providerBlocks.has(r.pubkey)) continue;
    if (unitBlocks.has(`${r.pubkey}:${r.unit_id}`)) continue;
    if (listingBlocks.has(`${r.pubkey}:${r.listing_id}`)) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(r.parsed_json);
    } catch {
      continue;
    }
    if (parsed.status && parsed.status !== 'active') continue;
    if (!parsed.title) continue;
    // `a` must name the signer's own shop. liveSync no longer stores other
    // listings; this keeps out rows mirrored before it checked.
    if (!listingOwnsUnitRef(r.pubkey, parsed.unitRef)) continue;

    const cashback =
      r.fee_status === 'active' &&
      r.lana_discount_per > 0 &&
      r.lana_discount_per <= 20
        ? r.lana_discount_per
        : DEFAULT_CASHBACK;

    // Only listing-level features apply (no inheritance from unit-level)
    const listingFeat = listingFeatures.get(`${r.pubkey}:${r.listing_id}`) || null;

    // Lana Online Shop (SPEC §9.3): buyable + the unit facts the checkout
    // needs, from the SIGNED raw event (always the current parser's
    // shape). Fail-closed — anything missing ⇒ buyable:false.
    let fresh: ReturnType<typeof parseListing> | null = null;
    try { fresh = parseListing(JSON.parse(r.raw_event)); } catch { fresh = null; }
    const meta = unitMeta.get(unitKey(r.pubkey, r.unit_id));
    const avail = meta?.onlineShop && fresh ? availableQty(db, fresh) : null;
    let gate: Buyability = isBuyable(meta, fresh, { availableQty: avail });
    // Buyable for the shop, but this portal cannot place the order yet.
    if (gate.buyable && !ordering) gate = { buyable: false, reason: 'ordering_unavailable' };

    listings.push({
      ...parsed,
      kind: fresh?.kind ?? parsed.kind ?? null,
      cashbackPercent: cashback,
      featured: listingFeat?.type || null,
      featuredAt: listingFeat?.createdAt || 0,
      buyable: gate.buyable,
      notBuyableReason: gate.buyable ? null : gate.reason,
      unitCurrency: meta?.currency || null,
      unitOwnerHex: meta?.ownerHex || null,
      unitName: meta?.name || null,
      shippingFee: meta?.shippingFee || '0.00',
      pickup: meta?.pickup === true,
      availableQty: avail,
    });
  }
  return listings;
}

/**
 * GET /api/listings — read from local SQLite (populated by liveSync).
 * Filters: unit, type, buyable=1, t, eco, search.
 *
 * GET /api/listings/:pubkey/:listingId — one visible listing (product page);
 * 404 when it is not visible here.
 */
export function createListingsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      res.json(applyFilters(visibleListings(db, now), req.query));
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      res.json([]);
    }
  });

  router.get('/:pubkey/:listingId', (req: Request, res: Response) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const pubkey = String(req.params.pubkey || '');
      const listingId = String(req.params.listingId || '');
      const found = visibleListings(db, now).find(l => l.pubkey === pubkey && l.listingId === listingId);
      if (!found) {
        res.status(404).json({ error: 'listing_not_found' });
        return;
      }
      res.json(found);
    } catch (error) {
      console.error('Failed to fetch listing:', error);
      res.status(500).json({ error: 'internal' });
    }
  });

  return router;
}

function applyFilters(listings: any[], query: any) {
  let result = [...listings];

  if (query.unit) {
    const unitRef = String(query.unit);
    result = result.filter(
      (l) =>
        (l.unitRef && l.unitRef.includes(unitRef)) ||
        l.unitRef?.split(':')[2] === unitRef
    );
  }

  if (query.type) {
    result = result.filter((l) => l.type === query.type);
  }

  if (query.buyable === '1' || query.buyable === 'true') {
    result = result.filter((l) => l.buyable === true);
  }

  if (query.t) {
    const t = String(query.t);
    result = result.filter((l) => Array.isArray(l.tags) && l.tags.includes(t));
  }

  if (query.eco) {
    const eco = String(query.eco);
    result = result.filter((l) => Array.isArray(l.eco) && l.eco.includes(eco));
  }

  if (query.search) {
    const s = String(query.search).toLowerCase();
    result = result.filter(
      (l) =>
        (l.title || '').toLowerCase().includes(s) ||
        (l.content || '').toLowerCase().includes(s) ||
        (Array.isArray(l.tags) && l.tags.some((t: string) => t.toLowerCase().includes(s)))
    );
  }

  // Sort: TOP first, NEW second, then by feature-recency (most-recently-marked
  // wins among same TOP/NEW), then by cashback desc, then by listing date desc
  const featureRank = (f: string | null | undefined) =>
    f === 'new' ? 0 : f === 'top' ? 1 : 2;
  result.sort((a, b) => {
    const fa = featureRank(a.featured);
    const fb = featureRank(b.featured);
    if (fa !== fb) return fa - fb;
    // Same feature rank — within TOP or NEW, prefer the most recently featured
    if (a.featured && b.featured) {
      const fta = a.featuredAt || 0;
      const ftb = b.featuredAt || 0;
      if (ftb !== fta) return ftb - fta;
    }
    const ca = a.cashbackPercent || DEFAULT_CASHBACK;
    const cb = b.cashbackPercent || DEFAULT_CASHBACK;
    if (cb !== ca) return cb - ca;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return result;
}
