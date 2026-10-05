/**
 * Lana Online Shop — buyability + quote (SPEC §6, §9.3, §10).
 *
 * Everything here is FAIL-CLOSED and computed from the LOCAL MIRROR of
 * merchant-signed events (30901 / 30903 / listing kinds), never from
 * anything the buyer's browser sends. The quote is the single source the
 * order route re-derives against, byte for byte.
 */

import type Database from 'better-sqlite3';
import { parseUnit, parseListing, type ParsedUnit, type ParsedListing } from './parsers.js';
import type { NostrEvent } from './relaySync.js';
import { toCents, centsToString } from './orderResolver.js';
import { unitKey, listingOwnsUnitRef } from './shopIdentity.js';

export { unitKey, listingOwnsUnitRef };

/**
 * Categories this portal serves (KIND 30901 `category`, lower-cased). The ONE
 * copy: routes/listings.ts, routes/ecoUnits.ts and routes/admin.ts import it,
 * so the catalogue, the units page, the admin views and the buy gate can never
 * disagree about which shops belong to lanaeco.farm.
 */
export const PORTAL_CATEGORIES: ReadonlySet<string> = new Set(['producer', 'eco farm', 'eco farming', 'farmer']);

/** Gateway session lifetime (SPEC §1): pay_by = 36520.created_at + 1800. */
export const PAY_WINDOW_SEC = 1800;

const HEX64_RE = /^[0-9a-f]{64}$/;
const INT_RE = /^\d+$/;

export interface UnitMeta {
  unitId: string;
  /** 30901 signer == the unit owner hex used in every order address. */
  ownerHex: string;
  name: string;
  currency: string;
  category: string;
  status: string;
  onlineShop: boolean;
  shippingFee: string;
  pickup: boolean;
  freeFrom: string | null;
  staffHexes: string[];
  /** Latest KIND 30903 ∈ {active, quota_warning*} and not expired. */
  registrationOk: boolean;
  /** Provider-wide or unit-wide local block. */
  blocked: boolean;
  /** `owner_hex` tag present but different from the signer — never buyable. */
  ownerMismatch: boolean;
  rawEvent: NostrEvent;
  parsed: ParsedUnit;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function registrationActive(status: string | null, activeUntil: number | null, now: number): boolean {
  const s = String(status || '');
  const ok = s === 'active' || s.startsWith('quota_warning');
  return ok && (!activeUntil || activeUntil > now);
}

/**
 * Every mirrored unit, re-parsed from the SIGNED raw event (so rows cached
 * before the online_shop tags existed still parse with the current schema).
 * Keyed by unitKey(signer, unit id).
 */
export function loadUnitMeta(db: Database.Database, now = nowSec()): Map<string, UnitMeta> {
  const out = new Map<string, UnitMeta>();
  const rows = db.prepare(`
    SELECT u.unit_id, u.pubkey, u.raw_event,
           gs.status AS suspension_status,
           gs.active_until AS suspension_active_until
    FROM business_units u
    LEFT JOIN global_suspensions gs ON gs.unit_id = u.unit_id AND gs.owner_pubkey = u.pubkey
  `).all() as Array<{ unit_id: string; pubkey: string; raw_event: string; suspension_status: string | null; suspension_active_until: number | null }>;

  const providerBlocks = new Set<string>();
  const unitBlocks = new Set<string>();
  const blockRows = db.prepare(
    `SELECT target_type, target_pubkey, target_id FROM local_blocks WHERE target_type IN ('provider', 'unit')`
  ).all() as Array<{ target_type: string; target_pubkey: string; target_id: string | null }>;
  for (const b of blockRows) {
    if (b.target_type === 'provider') providerBlocks.add(b.target_pubkey);
    else if (b.target_id) unitBlocks.add(`${b.target_pubkey}:${b.target_id}`);
  }

  for (const r of rows) {
    let ev: NostrEvent;
    try { ev = JSON.parse(r.raw_event); } catch { continue; }
    if (!ev || typeof ev !== 'object' || !Array.isArray(ev.tags)) continue;
    const p = parseUnit(ev);
    const ownerHex = String(ev.pubkey || '').toLowerCase();
    const taggedOwner = String(p.ownerHex || '').toLowerCase();
    out.set(unitKey(r.pubkey, r.unit_id), {
      unitId: r.unit_id,
      ownerHex,
      name: p.name,
      currency: p.currency,
      category: String(p.category || '').trim().toLowerCase(),
      status: p.status || 'active',
      onlineShop: p.onlineShop === true,
      shippingFee: p.onlineShopShippingFee || '0.00',
      pickup: p.onlineShopPickup === true,
      freeFrom: p.onlineShopFreeFrom ?? null,
      staffHexes: p.staffHexes,
      registrationOk: registrationActive(r.suspension_status, r.suspension_active_until, now),
      blocked: providerBlocks.has(r.pubkey) || unitBlocks.has(`${r.pubkey}:${r.unit_id}`),
      ownerMismatch: !!taggedOwner && taggedOwner !== ownerHex,
      rawEvent: ev,
      parsed: p,
    });
  }
  return out;
}

export function loadListing(db: Database.Database, pubkey: string, listingId: string): ParsedListing | null {
  const row = db.prepare(`SELECT raw_event FROM listings WHERE pubkey = ? AND listing_id = ?`)
    .get(pubkey, listingId) as { raw_event: string } | undefined;
  if (!row) return null;
  try {
    const ev = JSON.parse(row.raw_event) as NostrEvent;
    if (!ev || !Array.isArray(ev.tags)) return null;
    return parseListing(ev);
  } catch {
    return null;
  }
}

export function isListingBlocked(db: Database.Database, pubkey: string, listingId: string): boolean {
  const row = db.prepare(
    `SELECT id FROM local_blocks WHERE target_type = 'listing' AND target_pubkey = ? AND target_id = ? LIMIT 1`
  ).get(pubkey, listingId);
  return !!row;
}

export function listingAddress(l: { kind: number; pubkey: string; listingId: string }): string {
  return `${l.kind}:${l.pubkey}:${l.listingId}`;
}

/**
 * stock − Σ qty of PAID orders for this listing placed since the listing
 * event was (re)published. null when the listing has no numeric stock.
 */
export function availableQty(db: Database.Database, listing: ParsedListing): number | null {
  const stock = String(listing.stock || '').trim();
  if (!INT_RE.test(stock)) return null;
  const addr = listingAddress(listing);
  const unitId = listing.unitRef?.split(':')[2] || '';
  const rows = db.prepare(
    `SELECT order_json FROM orders WHERE unit_id = ? AND payment_state = 'paid' AND order_created_at >= ?`
  ).all(unitId, listing.createdAt) as Array<{ order_json: string }>;
  let paid = 0;
  for (const r of rows) {
    try {
      const o = JSON.parse(r.order_json) as { items?: Array<{ a: string; qty: number }> };
      for (const it of o.items || []) {
        if (it.a === addr && Number.isInteger(it.qty) && it.qty > 0) paid += it.qty;
      }
    } catch {}
  }
  return Math.max(0, parseInt(stock, 10) - paid);
}

export type NotBuyableReason =
  | 'unit_unknown' | 'online_shop_off' | 'unit_inactive' | 'registration_inactive'
  | 'category' | 'blocked' | 'owner_mismatch' | 'listing_unknown' | 'listing_inactive'
  | 'sold_out' | 'currency_mismatch' | 'price_invalid'
  /** Not from isBuyable: this portal has no broker (SHOP_ORDERS_URL unset). */
  | 'ordering_unavailable';

/**
 * Can this portal place an order at all? Without SHOP_ORDERS_URL every
 * POST /api/orders answers 503 ORDERING_UNAVAILABLE, so the catalogue must not
 * offer a buy button either (routes/listings.ts): until the broker knows this
 * portal (its PORTAL_ORIGINS) and SHOP_ORDERS_URL is set here, a listing says
 * why it cannot be bought instead of failing at the checkout.
 */
export function orderingConfigured(): boolean {
  return String(process.env.SHOP_ORDERS_URL || '').trim() !== '';
}

export interface Buyability {
  buyable: boolean;
  reason?: NotBuyableReason;
}

/** SPEC §6 — every gate, fail-closed. */
export function isBuyable(
  unit: UnitMeta | undefined,
  listing: ParsedListing | null,
  opts: { listingBlocked?: boolean; availableQty?: number | null } = {},
): Buyability {
  if (!unit) return { buyable: false, reason: 'unit_unknown' };
  if (!unit.onlineShop) return { buyable: false, reason: 'online_shop_off' };
  if (unit.status !== 'active') return { buyable: false, reason: 'unit_inactive' };
  if (!unit.registrationOk) return { buyable: false, reason: 'registration_inactive' };
  if (!PORTAL_CATEGORIES.has(unit.category)) return { buyable: false, reason: 'category' };
  if (unit.blocked || opts.listingBlocked) return { buyable: false, reason: 'blocked' };
  if (unit.ownerMismatch || !HEX64_RE.test(unit.ownerHex)) return { buyable: false, reason: 'owner_mismatch' };
  if (!listing) return { buyable: false, reason: 'listing_unknown' };
  if (listing.status === 'sold_out') return { buyable: false, reason: 'sold_out' };
  if (listing.status !== 'active') return { buyable: false, reason: 'listing_inactive' };
  if (!unit.currency || listing.priceCurrency !== unit.currency) return { buyable: false, reason: 'currency_mismatch' };
  const price = toCents(listing.price);
  if (price === null || price <= 0) return { buyable: false, reason: 'price_invalid' };
  if (opts.availableQty !== undefined && opts.availableQty !== null && opts.availableQty <= 0) {
    return { buyable: false, reason: 'sold_out' };
  }
  return { buyable: true };
}

// ─────────────────────────────────────────── quote (SPEC §9.3)

/**
 * Hard cap on the different products ONE order may carry (SPEC v1.1.0). An
 * order event stays far below the 64-tag cap of the order route: 13 fixed
 * tags + supersedes + 30 items = 44.
 */
export const MAX_ITEMS_PER_ORDER = 30;

/** Upper bound on one line's quantity (whole units). */
export const MAX_LINE_QTY = 10_000;

/**
 * How many different products one order may carry RIGHT NOW. Default
 * MAX_ITEMS_PER_ORDER: the broker (shop.lanapays.us, 6981ca2) and the merchant
 * app (mobile.lanapays.us, fbb2c3d) accept and show cart orders since
 * 2 Oct 2026, and Brilly switched the cart on that day. Env SHOP_MAX_ITEMS
 * turns it back down (SHOP_MAX_ITEMS=1 = one product per order); a value that
 * is set but unreadable also falls back to 1, never up. Quotes still price a
 * whole cart up to MAX_ITEMS_PER_ORDER; only placing the order is gated.
 */
export function maxItemsPerOrder(): number {
  const raw = String(process.env.SHOP_MAX_ITEMS ?? '').trim();
  if (raw === '') return MAX_ITEMS_PER_ORDER;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_ITEMS_PER_ORDER);
}

export class QuoteError extends Error {
  constructor(
    public status: number,
    public code: string,
    public reason?: string,
    /** index of the request line the refusal is about (cart quotes) */
    public line?: number,
    /** for QTY_UNAVAILABLE: the quantity range this line accepts right now */
    public bounds?: { min: number; max: number | null },
    /**
     * 'shop' when the refusal is about the whole shop (paused, registration
     * lapsed, blocked …), never about one product: no `line` is named then,
     * so a cart never tells the shopper to remove products that are fine.
     */
    public scope?: 'shop',
  ) {
    super(code);
  }
}

export interface QuoteItem {
  a: string;
  kind: number;
  qty: number;
  saleUnit: string;
  unitPrice: string;
  currency: string;
  title: string;
}

export interface Quote {
  unitId: string;
  unitOwnerHex: string;
  unitName: string;
  currency: string;
  items: QuoteItem[];
  shipping: string;
  total: string;
  fulfillmentModes: string[];
  fulfillment: string;
  payBy: number;
  rawUnitEvent: NostrEvent;
  /** Internal — the listing event the FIRST line's price came from. */
  listingCreatedAt: number;
}

export interface QuoteRequest {
  pubkey: string;
  listingId: string;
  qty: number;
  fulfillment: string;
}

export interface QuoteLineRequest {
  pubkey: string;
  listingId: string;
  qty: number;
}

export interface CartQuoteRequest {
  lines: QuoteLineRequest[];
  fulfillment: string;
  /**
   * The shop the cart files these lines under (cart page, cart checkout).
   * With it, a line whose listing has moved to another unit is refused as
   * THAT line ('unit_changed') instead of the later lines being blamed
   * ('mixed_units'), and a shop that is gone is refused for the whole shop.
   */
  unitId?: string;
}

/**
 * isBuyable reasons that are about the unit, not about one listing: a cart
 * line must not be blamed (and offered for removal) for them.
 */
const SHOP_LEVEL_REASONS = new Set<NotBuyableReason>([
  'online_shop_off', 'unit_inactive', 'registration_inactive', 'category', 'owner_mismatch',
]);

export function fulfillmentModes(unit: UnitMeta): string[] {
  return unit.pickup ? ['shipping', 'pickup'] : ['shipping'];
}

/**
 * Compute the only quote this portal will ever accept for (listing, qty,
 * fulfillment). Throws QuoteError with the SPEC codes. Exactly a one-line
 * buildCartQuote — a single-item quote is unchanged by the cart.
 */
export function buildQuote(db: Database.Database, req: QuoteRequest, now = nowSec()): Quote {
  return buildCartQuote(db, { lines: [{ pubkey: req.pubkey, listingId: req.listingId, qty: req.qty }], fulfillment: req.fulfillment }, now);
}

/**
 * The only quote this portal accepts for a cart of ONE shop: 1..30 lines, all
 * of the same shop (unitKey), each listing at most once — a product split
 * over two lines would slip past its own stock and max_order. Every line
 * passes the same fail-closed gates and quantity bounds as a single-item
 * quote. Money in integer cents: subtotal = Σ price × qty, shipping ONCE from
 * that subtotal, total = subtotal + shipping. Items come back in REQUEST
 * order (the order route re-derives in tag order and compares byte for byte).
 */
export function buildCartQuote(db: Database.Database, req: CartQuoteRequest, now = nowSec()): Quote {
  const raw = Array.isArray(req?.lines) ? req.lines : null;
  if (!raw || raw.length < 1 || raw.length > MAX_ITEMS_PER_ORDER) {
    throw new QuoteError(400, 'INVALID_REQUEST', raw && raw.length > MAX_ITEMS_PER_ORDER ? 'too_many_items' : 'lines');
  }

  // 1. Shape of every line (no mirror needed), in request order.
  const lines: QuoteLineRequest[] = [];
  const seen = new Set<string>();
  raw.forEach((l, i) => {
    const pubkey = String(l?.pubkey || '').toLowerCase();
    const listingId = String(l?.listingId || '');
    if (!HEX64_RE.test(pubkey) || !listingId || listingId.length > 200) {
      throw new QuoteError(400, 'INVALID_REQUEST', 'listing', i);
    }
    const qty = l?.qty as number;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY) {
      throw new QuoteError(409, 'QTY_UNAVAILABLE', 'qty', i);
    }
    const key = `${pubkey}:${listingId}`;
    if (seen.has(key)) throw new QuoteError(400, 'INVALID_REQUEST', 'duplicate_item', i);
    seen.add(key);
    lines.push({ pubkey, listingId, qty });
  });
  if (req.fulfillment !== 'shipping' && req.fulfillment !== 'pickup') {
    throw new QuoteError(400, 'INVALID_REQUEST', 'fulfillment');
  }

  const wantUnitId = typeof req.unitId === 'string' && req.unitId ? req.unitId.slice(0, 64) : null;

  // 2. Every line against the merchant-signed mirror.
  const units = loadUnitMeta(db, now);
  let shop: UnitMeta | null = null;
  let shopKey = '';
  let firstListingCreatedAt = 0;
  let subtotal = 0;
  const items: QuoteItem[] = [];
  lines.forEach((l, i) => {
    const listing = loadListing(db, l.pubkey, l.listingId);
    if (!listing) throw new QuoteError(409, 'NOT_BUYABLE', 'listing_unknown', i);
    const unitId = listing.unitRef?.split(':')[2] || '';
    const key = unitKey(l.pubkey, unitId);
    if (wantUnitId !== null) {
      const wantKey = unitKey(l.pubkey, wantUnitId);
      if (!units.has(wantKey)) throw new QuoteError(409, 'NOT_BUYABLE', 'unit_unknown', undefined, undefined, 'shop');
      // This product is now sold by another unit: refuse IT, not its neighbours.
      if (key !== wantKey) throw new QuoteError(409, 'NOT_BUYABLE', 'unit_changed', i);
    }
    const unit = units.get(key);
    if (!unit || unit.ownerHex !== l.pubkey || !listingOwnsUnitRef(l.pubkey, listing.unitRef)) {
      throw new QuoteError(409, 'NOT_BUYABLE', 'unit_unknown', i);
    }
    // One order = one shop = one currency, one shipping fee, one payment.
    if (shop && key !== shopKey) throw new QuoteError(400, 'INVALID_REQUEST', 'mixed_units', i);

    const avail = availableQty(db, listing);
    const gate = isBuyable(unit, listing, { listingBlocked: isListingBlocked(db, l.pubkey, l.listingId), availableQty: avail });
    if (!gate.buyable) {
      if (gate.reason === 'currency_mismatch') throw new QuoteError(409, 'CURRENCY_MISMATCH', gate.reason, i);
      // A paused or lapsed shop refuses every line alike: name no line.
      const shopLevel = !!gate.reason && (SHOP_LEVEL_REASONS.has(gate.reason) || (gate.reason === 'blocked' && unit.blocked));
      if (shopLevel) throw new QuoteError(409, 'NOT_BUYABLE', gate.reason, undefined, undefined, 'shop');
      throw new QuoteError(409, 'NOT_BUYABLE', gate.reason, i);
    }

    // qty bounds: integer ≥ max(1, min_order) ≤ min(max_order, available)
    const minOrder = INT_RE.test(String(listing.minOrder || '').trim()) ? parseInt(listing.minOrder, 10) : 1;
    let maxOrder = INT_RE.test(String(listing.maxOrder || '').trim()) ? parseInt(listing.maxOrder, 10) : Infinity;
    if (avail !== null) maxOrder = Math.min(maxOrder, avail);
    const min = Math.max(1, minOrder);
    if (l.qty < min || l.qty > maxOrder) {
      throw new QuoteError(409, 'QTY_UNAVAILABLE', 'qty', i, {
        min,
        max: Number.isFinite(maxOrder) ? Math.min(maxOrder, MAX_LINE_QTY) : null,
      });
    }

    if (!shop) { shop = unit; shopKey = key; firstListingCreatedAt = listing.createdAt; }
    const priceCents = toCents(listing.price) as number; // isBuyable guarantees > 0
    subtotal += priceCents * l.qty;
    items.push({
      a: listingAddress(listing),
      kind: listing.kind,
      qty: l.qty,
      saleUnit: listing.unit || 'piece',
      unitPrice: centsToString(priceCents),
      currency: unit.currency,
      title: listing.title,
    });
  });

  const unit = shop as unknown as UnitMeta;
  const modes = fulfillmentModes(unit);
  if (!modes.includes(req.fulfillment)) throw new QuoteError(400, 'INVALID_REQUEST', 'fulfillment');

  // Shipping ONCE per order, from the subtotal of ALL lines.
  let shippingCents = 0;
  if (req.fulfillment === 'shipping') {
    const fee = toCents(unit.shippingFee) ?? 0;
    const freeFrom = toCents(unit.freeFrom);
    shippingCents = freeFrom !== null && subtotal >= freeFrom ? 0 : fee;
  }
  const total = subtotal + shippingCents;

  return {
    unitId: unit.unitId,
    unitOwnerHex: unit.ownerHex,
    unitName: unit.name,
    currency: unit.currency,
    items,
    shipping: centsToString(shippingCents),
    total: centsToString(total),
    fulfillmentModes: modes,
    fulfillment: req.fulfillment,
    payBy: now + PAY_WINDOW_SEC,
    rawUnitEvent: unit.rawEvent,
    listingCreatedAt: firstListingCreatedAt,
  };
}
