/**
 * Joins the three relay-sourced sides of an order — buyer 36520, merchant
 * 36521, brain 30933 — through the NORMATIVE resolver and persists the
 * verdict on the `orders` row. Called whenever ANY side arrives (liveSync)
 * and on every status read (so `expired` flips with the clock).
 *
 * Pure DB → DB; no network.
 */

import type Database from 'better-sqlite3';
import { parseUnit, parseShopOrder, type ParsedShopOrder, type ParsedFulfillment, type ParsedPurchase } from './parsers.js';
import type { NostrEvent } from './relaySync.js';
import { MAX_ITEMS_PER_ORDER } from './onlineShop.js';
import {
  resolveOrder, orderIdMatchesPubkey, toCents, usableListingPrice, listingSaleStatus, expectedCents,
  type ResolverResult, type ResolverUnit, type ResolverOrder, type ResolverItem, type SettledPurchase,
} from './orderResolver.js';
import { devTrustedSigners } from './devOverrides.js';

const PROCESSOR_PUBKEY =
  '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';
const TRUSTED_GROUPS = ['LanaPaysUs', 'LanaPays', 'Processor', 'Brain'];
const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * KIND 30933 authors we believe (SPEC §9.3): kind_38888.trusted_signers
 * groups LanaPaysUs | LanaPays | Processor | Brain, else PROCESSOR_PUBKEY.
 * Dev-only LANA_TRUSTED_SIGNERS_OVERRIDE — see ./devOverrides.ts for why it is
 * gated on a loopback relay override rather than on NODE_ENV.
 */
export function loadTrustedSigners(db: Database.Database): Set<string> {
  if (devTrustedSigners.length) return new Set(devTrustedSigners);
  const out = new Set<string>();
  try {
    const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY id DESC LIMIT 1').get() as { trusted_signers: string | null } | undefined;
    const groups = row?.trusted_signers ? JSON.parse(row.trusted_signers) : {};
    if (groups && typeof groups === 'object') {
      for (const g of TRUSTED_GROUPS) {
        const list = (groups as Record<string, unknown>)[g];
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          const hex = String(h || '').toLowerCase();
          if (HEX64_RE.test(hex)) out.add(hex);
        }
      }
    }
  } catch {}
  if (out.size === 0) out.add(PROCESSOR_PUBKEY);
  return out;
}

interface OrderRow {
  order_id: string;
  buyer_pubkey: string;
  unit_id: string;
  order_event_id: string | null;
  order_created_at: number;
  order_json: string;
  fulfillment_json: string | null;
  payment_state: string;
  paid_tx_id: string | null;
  paid_amount: string | null;
  paid_event_id: string | null;
  paid_order_event_id: string | null;
  settled_tx_id: string | null;
  settled_amount: string | null;
  settled_order_event_id: string | null;
}

/**
 * Kinds a 36520 item may point at: the Lana listing kinds 36500–36516 and the
 * NIP-52 calendar listing 31923 — the set the broker (shop.lanapays.us
 * LISTING_KINDS) prices an order from.
 */
export const ORDER_ITEM_KINDS: ReadonlySet<number> = new Set([
  31923, ...Array.from({ length: 17 }, (_, i) => 36500 + i),
]);

/** A whole, positive quantity as the order route writes it. */
const QTY_RE = /^[1-9]\d{0,8}$/;

/**
 * The order route's shape rules (SPEC §2, §10) that need neither the clock
 * nor the mirror, for EVERY 36520 — above all for the ones that never passed
 * POST /api/orders: the buyer's key signs the order, so the buyer can publish
 * a replacement with the same d straight to the relays. Returns why the event
 * is refused, or null.
 *
 * 1..MAX_ITEMS_PER_ORDER (30, SPEC §2 — the protocol cap, NOT the order
 * route's SHOP_MAX_ITEMS gate: lowering that gate must not stop the mirror
 * from taking a newer version of a cart order already placed, e.g. the
 * buyer's cancel) items, each `<listing kind>:<unit owner>:<listing d>` of a
 * listing kind, owned by the unit owner, at most once per order, with a
 * whole positive qty, a 2-decimal price and the order's currency; shipping
 * and total in that currency; known fulfillment / status / version.
 */
export function orderShapeProblem(ev: NostrEvent, p: ParsedShopOrder, maxItems = MAX_ITEMS_PER_ORDER): string | null {
  const itemTags = ev.tags.filter(t => t[0] === 'item');
  if (p.items.length === 0 || itemTags.length !== p.items.length) return 'item';
  if (p.items.length > maxItems) return 'too_many_items';
  if (!p.currency || toCents(p.total) === null) return 'total';
  if (p.shippingCurrency !== p.currency || toCents(p.shippingFee) === null) return 'shipping';
  if (p.fulfillment !== 'shipping' && p.fulfillment !== 'pickup') return 'fulfillment';
  if (p.status !== 'placed' && p.status !== 'cancelled') return 'status';
  if (p.version !== '1') return 'v';
  if (!Number.isInteger(p.payBy) || p.payBy <= 0) return 'pay_by';
  const seen = new Set<string>();
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    const parts = it.a.split(':');
    if (parts.length !== 3 || parts[0] !== String(it.kind) || !ORDER_ITEM_KINDS.has(it.kind)) return 'item_kind';
    if (it.ownerHex !== p.ownerHex || !it.listingId) return 'item';
    if (seen.has(it.a)) return 'duplicate_item';
    seen.add(it.a);
    if (!QTY_RE.test(String(itemTags[i][2] ?? ''))) return 'qty';
    if (toCents(it.unitPrice) === null) return 'unit_price';
    if (it.currency !== p.currency) return 'currency';
  }
  return null;
}

/**
 * Mirror a buyer-signed KIND 36520 (identity = (buyer pubkey, d); newest
 * created_at wins). Fail-closed: the order id MUST carry the buyer's pubkey
 * prefix, content MUST be '' (PII lives only in 36522), `a`/`p`/`unit_id`
 * must agree, and the event must pass orderShapeProblem. An event refused
 * here is not mirrored at all, so a refused replacement leaves the order the
 * mirror already holds as it was. Returns the parsed order when the event was
 * acceptable (whether or not it was newer).
 *
 * Signature verification is the caller's job (relay events are trusted as
 * delivered; the order route verifies before calling).
 */
export function upsertOrderEvent(db: Database.Database, ev: NostrEvent, now = Math.floor(Date.now() / 1000)): ParsedShopOrder | null {
  if (ev.kind !== 36520) return null;
  const parsed = parseShopOrder(ev);
  if (!parsed.orderId || !parsed.contentEmpty) return null;
  if (!orderIdMatchesPubkey(parsed.orderId, ev.pubkey)) return null;
  if (!parsed.unitId || parsed.invoiceNumber !== parsed.orderId) return null;
  if (!HEX64_RE.test(parsed.ownerHex) || parsed.unitRef !== `30901:${parsed.ownerHex}:${parsed.unitId}`) return null;
  if (orderShapeProblem(ev, parsed) !== null) return null;
  db.prepare(`
    INSERT INTO orders (order_id, buyer_pubkey, unit_id, order_event_id, order_created_at, order_json, order_raw, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      order_event_id = excluded.order_event_id,
      order_created_at = excluded.order_created_at,
      order_json = excluded.order_json,
      order_raw = excluded.order_raw,
      fetched_at = excluded.fetched_at
    WHERE excluded.order_created_at > orders.order_created_at
      AND excluded.buyer_pubkey = orders.buyer_pubkey
  `).run(parsed.orderId, ev.pubkey, parsed.unitId, ev.id, ev.created_at, JSON.stringify(parsed), JSON.stringify(ev), now);
  recomputeOrder(db, parsed.orderId, now);
  return parsed;
}

/**
 * The unit the order's `a` tag names — (owner, unit id), never the newest
 * 30901 with that unit id, which a stranger can sign.
 */
function loadUnit(db: Database.Database, ownerHex: string, unitId: string): ResolverUnit | null {
  return loadUnitRow(db, ownerHex, unitId)?.unit ?? null;
}

/** loadUnit plus the id of the 30901 event it was read from. */
function loadUnitRow(db: Database.Database, ownerHex: string, unitId: string): { unit: ResolverUnit; eventId: string } | null {
  const row = db.prepare('SELECT raw_event FROM business_units WHERE pubkey = ? AND unit_id = ?')
    .get(ownerHex, unitId) as { raw_event: string } | undefined;
  if (!row) return null;
  try {
    const ev = JSON.parse(row.raw_event) as NostrEvent;
    const p = parseUnit(ev);
    return {
      unit: {
        ownerHex: String(ev.pubkey || '').toLowerCase(),
        staffHexes: p.staffHexes,
        currency: p.currency,
        shippingFee: p.onlineShopShippingFee || '0.00',
        freeShippingFrom: p.onlineShopFreeFrom ?? null,
        pickup: p.onlineShopPickup === true,
      },
      eventId: String(ev.id || ''),
    };
  } catch {
    return null;
  }
}

/**
 * F3/F4 (round 5, 5 Oct 2026): are this order's OWN numbers exactly the ones
 * the shop's terms give it — `unit` (shipping fee, free-shipping threshold,
 * pickup offer, currency) and `prices` (each item's merchant-signed listing
 * price, in item order)? total === the recomputed expected amount (the
 * resolver's expectedCents), shipping === expected − subtotal, every
 * unit_price === its listing price, and the order, every line and the shop
 * in one currency. false when a price is missing or the amount cannot be
 * computed (e.g. pickup at a shop that does not offer it).
 */
export function termsPriceOrder(order: ResolverOrder, unit: ResolverUnit, prices: ReadonlyArray<string | null>): boolean {
  if (!unit.ownerHex || !unit.currency || order.currency !== unit.currency) return false;
  if (order.items.length === 0 || prices.length !== order.items.length) return false;
  const priced = order.items.map((it, i) => ({ ...it, listingPrice: prices[i] }));
  const expected = expectedCents({ ...order, items: priced }, unit);
  if (expected === null) return false;
  let subtotal = 0;
  for (let i = 0; i < order.items.length; i++) {
    const it = order.items[i];
    const price = toCents(prices[i]);
    if (price === null || price <= 0 || toCents(it.unitPrice) !== price) return false;
    if (it.currency !== unit.currency || !Number.isInteger(it.qty) || it.qty <= 0) return false;
    subtotal += price * it.qty;
  }
  if (toCents(order.total) !== expected) return false;
  if (order.shipping === undefined || toCents(order.shipping) !== expected - subtotal) return false;
  return true;
}

interface TermsSeenRow {
  shipping_fee: string; free_from: string | null; pickup: number; prices_json: string; total: string;
}

/** order_settle_review reasons of the older-rules re-judge (rejudgeLegacyPaidOrders). */
const LEGACY_REVIEW_REASONS = ['step5_not_paid', 'listing_kind_not_mirrored'] as const;
/** order_settle_review reasons of an order this code judged (round 5). */
const LIVE_REVIEW_REASONS = ['not_computable', 'terms_mismatch'] as const;

/**
 * The merchant-signed listing an order item names, as the money rule reads
 * it: the mirrored listing at (owner, d) of EXACTLY the kind the item names,
 * its price, the currency its own `price` tag signs (NOT parseListing's
 * display default 'EUR' — a price with no currency is no price in any shop;
 * KIND 36511 signs it in a separate `currency` tag, as the broker reads it),
 * its `a` tag and its sale status (listingSaleStatus — the broker's reading,
 * so a KIND 31923 is on sale only with lana-status 'active'). null when not
 * mirrored.
 */
function loadOrderListing(db: Database.Database, kind: number, ownerHex: string, listingId: string):
  { price: string; currency: string; unitRef: string; status: string; createdAt: number } | null {
  const row = db.prepare('SELECT raw_event FROM listings WHERE pubkey = ? AND listing_id = ?')
    .get(ownerHex, listingId) as { raw_event: string } | undefined;
  if (!row) return null;
  try {
    const ev = JSON.parse(row.raw_event) as NostrEvent;
    if (!ev || !Array.isArray(ev.tags) || ev.kind !== kind) return null;
    const tag = (n: string) => ev.tags.find(t => t[0] === n);
    const price = tag('price');
    return {
      price: String(price?.[1] ?? ''),
      currency: String(price?.[2] || (ev.kind === 36511 ? tag('currency')?.[1] || '' : '')),
      unitRef: String(tag('a')?.[1] ?? ''),
      status: listingSaleStatus(ev),
      createdAt: ev.created_at,
    };
  } catch {
    return null;
  }
}

export function loadPurchases(db: Database.Database, unitId: string, invoiceNumber: string): ParsedPurchase[] {
  const rows = db.prepare('SELECT parsed_json FROM purchases_30933 WHERE unit_id = ? AND invoice_number = ?')
    .all(unitId, invoiceNumber) as Array<{ parsed_json: string }>;
  const out: ParsedPurchase[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.parsed_json)); } catch {}
  }
  return out;
}

/** What a recompute may need to know about this portal (rejudgeLegacyPaidOrders). */
export interface RecomputeOptions {
  /**
   * The listing kinds this portal mirrors (liveSync `listingKinds`); absent =
   * every kind. Only used to say WHY an older 'paid' is listed: an order with
   * an item of a kind not mirrored here (another portal's order) cannot be
   * judged by this portal at all, so it is listed as
   * 'listing_kind_not_mirrored' — not as a suspicious 'step5_not_paid'.
   */
  listingKinds?: ReadonlySet<number>;
}

/**
 * Recompute one order. Returns the verdict, or null when the order is not
 * mirrored locally.
 */
export function recomputeOrder(db: Database.Database, orderId: string, now = Math.floor(Date.now() / 1000), opts: RecomputeOptions = {}): ResolverResult | null {
  const row = db.prepare(
    `SELECT order_id, buyer_pubkey, unit_id, order_event_id, order_created_at, order_json, fulfillment_json,
            payment_state, paid_tx_id, paid_amount, paid_event_id, paid_order_event_id,
            settled_tx_id, settled_amount, settled_order_event_id
       FROM orders WHERE order_id = ?`
  ).get(orderId) as OrderRow | undefined;
  if (!row) return null;

  let order: ParsedShopOrder;
  try { order = JSON.parse(row.order_json); } catch { return null; }
  let fulfillment: ParsedFulfillment | null = null;
  if (row.fulfillment_json) {
    try { fulfillment = JSON.parse(row.fulfillment_json); } catch { fulfillment = null; }
  }

  // Unknown unit ⇒ fail-closed: the resolver pays nothing — not even a
  // settled (step 5a) order — for an empty owner / currency.
  const knownRow = loadUnitRow(db, order.ownerHex, row.unit_id);
  const knownUnit = knownRow?.unit ?? null;
  const unit: ResolverUnit = knownUnit
    || { ownerHex: '', staffHexes: [], currency: '', shippingFee: '0.00', freeShippingFrom: null, pickup: false };

  // EVERY item is priced by its own current listing (SPEC v1.1.0): applying
  // items[0]'s price to all items would judge a correctly paid cart
  // amount_mismatch. A listing prices an item only when it is usable for THIS
  // order (SPEC v1.1.2 step 2: mirrored with the kind the item names, on sale,
  // a positive price in the shop's currency, its `a` naming the order's shop);
  // else null — the expected amount cannot be computed and the order is not
  // paid (SPEC v1.1.1): the buyer-signed unit_price is never money.
  const orderUnitRef = `30901:${order.ownerHex}:${row.unit_id}`;
  const eventId = row.order_event_id || '';
  const items: ResolverItem[] = order.items.map(i => {
    const listing = i.ownerHex && i.listingId ? loadOrderListing(db, i.kind, i.ownerHex, i.listingId) : null;
    const usable = knownUnit ? usableListingPrice(listing, unit.currency, orderUnitRef) : null;
    return {
      a: i.a, qty: i.qty, unitPrice: i.unitPrice, currency: i.currency,
      listingPrice: usable,
      listingCreatedAt: usable !== null && listing ? listing.createdAt : null,
    };
  });
  const resolverOrder: ResolverOrder = {
    d: order.orderId,
    pubkey: order.pubkey,
    createdAt: order.createdAt,
    unitId: order.unitId,
    status: order.status,
    fulfillment: order.fulfillment,
    items,
    shipping: order.shippingFee,
    total: order.total,
    currency: order.currency,
    payBy: order.payBy,
  };

  // F3/F4 (round 5): the merchant's terms under which THIS 36520 event was
  // right to the cent, kept once — the first time this mirror sees every
  // listing on sale, the shop known and the order's own numbers equal to the
  // ones today's terms give (termsPriceOrder). Never a price alone (the round-4
  // order_listing_prices): the fee, free-from and pickup of the same moment.
  if (eventId && knownRow && items.every(it => it.listingPrice !== null)
    && termsPriceOrder(resolverOrder, unit, items.map(it => it.listingPrice ?? null))) {
    db.prepare(`
      INSERT INTO order_terms_seen (order_event_id, shipping_fee, free_from, pickup, unit_event_id, prices_json, total, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_event_id) DO NOTHING
    `).run(
      eventId, unit.shippingFee, unit.freeShippingFrom ?? null, unit.pickup ? 1 : 0, knownRow.eventId,
      JSON.stringify(Object.fromEntries(items.map(it => [it.a, it.listingPrice]))), order.total, now,
    );
  }

  // SPEC §8 step 5a: the purchase that settled THIS 36520 event (same id)
  // keeps it paid through a later price, shipping-fee or pickup change; a
  // replaced order is judged afresh. Kept apart from paid_* (see schema.ts).
  const settledPurchase: SettledPurchase | null = row.settled_tx_id && row.settled_amount
    && row.order_event_id && row.settled_order_event_id === row.order_event_id
    ? { txId: row.settled_tx_id, amount: row.settled_amount } : null;

  // An older-rules 'paid' (no settled_*: every paid verdict of this code
  // writes them), or one rejudgeLegacyPaidOrders listed and Brilly has not
  // settled yet: judged by step 5 (and its pin) alone — never by the terms
  // seen for its event (round 5).
  const legacyPaid = row.payment_state === 'paid' && !row.settled_tx_id;
  const legacy = legacyPaid || !!db.prepare(
    `SELECT 1 FROM order_settle_review WHERE order_id = ? AND cleared_at IS NULL AND reason IN (${LEGACY_REVIEW_REASONS.map(() => '?').join(', ')})`,
  ).get(orderId, ...LEGACY_REVIEW_REASONS);

  const purchases = loadPurchases(db, row.unit_id, order.orderId);
  const trustedSigners = loadTrustedSigners(db);
  const judge = (o: ResolverOrder, u: ResolverUnit): ResolverResult => resolveOrder({
    order: o,
    purchases: purchases.map(p => ({
      pubkey: p.pubkey,
      eventId: p.eventId,
      createdAt: p.createdAt,
      txId: p.txId,
      unitId: p.unitId,
      invoiceNumber: p.invoiceNumber,
      receiptDescription: p.receiptDescription,
      amount: p.amount,
      currency: p.currency,
      lanaAmount: p.lanaAmount,
      paymentType: p.paymentType,
      status: p.status,
      customerHex: p.customerHex,
      txHash: p.txHash || undefined,
    })),
    fulfillment: fulfillment
      ? { pubkey: fulfillment.pubkey, createdAt: fulfillment.createdAt, status: fulfillment.status, paymentRef: fulfillment.paymentRef, carrier: fulfillment.carrier, tracking: fulfillment.tracking }
      : null,
    unit: u,
    trustedSigners,
    now,
    settledPurchase,
  });

  // Attempt 1: today's terms. Attempt 2, only when that is amount_mismatch:
  // the terms seen for THIS event (order_terms_seen) — its shipping fee,
  // free-from, pickup and item prices; the shop's owner, staff and currency
  // stay today's. An honest order stays payable when the shop changed its
  // terms before the 30933 was seen; a replacement that never matched the
  // merchant's terms has no row and gains nothing.
  let result = judge(resolverOrder, unit);
  if (result.paymentState === 'amount_mismatch' && !legacy && eventId && knownUnit) {
    const seen = db.prepare('SELECT shipping_fee, free_from, pickup, prices_json, total FROM order_terms_seen WHERE order_event_id = ?')
      .get(eventId) as TermsSeenRow | undefined;
    let prices: Record<string, unknown> | null = null;
    try { prices = seen ? JSON.parse(seen.prices_json) : null; } catch { prices = null; }
    if (seen && prices && typeof prices === 'object' && seen.total === order.total) {
      const seenUnit: ResolverUnit = { ...unit, shippingFee: seen.shipping_fee, freeShippingFrom: seen.free_from, pickup: seen.pickup === 1 };
      const seenItems = items.map(it => {
        const p = (prices as Record<string, unknown>)[it.a];
        return { ...it, listingPrice: typeof p === 'string' ? p : null };
      });
      const second = judge({ ...resolverOrder, items: seenItems }, seenUnit);
      if (second.paymentState === 'paid') result = second;
    }
  }

  const paidPurchase = result.paidBy
    ? purchases.find(p => p.eventId === result.paidBy!.eventId) || null
    : null;

  // The settled memory: set by a paid verdict, kept through a verdict reached
  // without the shop (the pin cannot apply to an unknown unit, but the order
  // was settled and is paid again when the 30901 is back), cleared by any
  // other verdict (a cancelled purchase, a replaced 36520, …).
  const paid = result.paymentState === 'paid' && !!result.paidBy;
  const settled = paid
    ? { txId: result.paidBy!.txId, amount: result.paidBy!.amount, orderEventId: row.order_event_id }
    : !knownUnit
      ? { txId: row.settled_tx_id, amount: row.settled_amount, orderEventId: row.settled_order_event_id }
      : { txId: null, amount: null, orderEventId: null };

  db.prepare(`
    UPDATE orders SET
      payment_state = ?, effective_status = ?, expected_total = ?, price_changed = ?,
      paid_tx_id = ?, paid_event_id = ?, paid_at = ?, paid_amount = ?, paid_lana_amount = ?, paid_tx_hash = ?,
      paid_order_event_id = ?, settled_tx_id = ?, settled_amount = ?, settled_order_event_id = ?, resolved_at = ?
    WHERE order_id = ?
  `).run(
    result.paymentState,
    result.effectiveStatus,
    result.expected,
    result.priceChanged ? 1 : 0,
    result.paidBy?.txId ?? null,
    result.paidBy?.eventId ?? null,
    paidPurchase ? paidPurchase.createdAt : null,
    result.paidBy?.amount ?? null,
    result.paidBy?.lanaAmount ?? null,
    result.paidBy?.txHash ?? null,
    paid ? row.order_event_id : null,
    settled.txId, settled.amount, settled.orderEventId,
    now,
    orderId,
  );

  // A 'paid' the older rules stored (no settled_*: every paid verdict of this
  // code writes them) that step 5 does not pay now is listed for Brilly, not
  // paid; a later paid verdict — or Brilly's confirmation of the entry
  // (confirmSettleReview) — clears it. No order-time terms exist here for
  // such a row (order_terms_seen is this code's, and is never tried for it),
  // so an honest order repriced, taken off sale or deleted since, or whose
  // shop changed its shipping or pickup terms since, is listed too: nothing
  // stored can tell it from a buyer's replacement.
  //
  // Round 5: an order this code judged is listed as well when a verified
  // 30933 pays exactly the order's own total and the verdict is still
  // amount_mismatch — 'not_computable' (no expected amount: a listing or the
  // shop unknown, off sale, pickup not offered) or 'terms_mismatch'. Such an
  // order may be honest (its terms changed before this mirror ever saw it
  // match) or a buyer's replacement at the same total; Brilly tells them apart
  // against what the broker took. Cleared once the order is paid or no
  // candidate 30933 is left. The entry's listed_at stays while the same event
  // stays listed, so settle-review.ts can leave out what is younger than 1 h.
  if (legacyPaid && !paid) {
    const kinds = opts.listingKinds;
    const reason = kinds && order.items.some(i => !kinds.has(i.kind)) ? 'listing_kind_not_mirrored' : 'step5_not_paid';
    db.prepare(`
      INSERT INTO order_settle_review (order_id, order_event_id, old_paid_tx_id, old_paid_amount, verdict, expected_total, reason, listed_at, cleared_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(order_id) DO UPDATE SET
        order_event_id = excluded.order_event_id, old_paid_tx_id = excluded.old_paid_tx_id,
        old_paid_amount = excluded.old_paid_amount, verdict = excluded.verdict,
        expected_total = excluded.expected_total, reason = excluded.reason, listed_at = excluded.listed_at,
        cleared_at = NULL, confirmed_at = NULL
    `).run(orderId, row.order_event_id, row.paid_tx_id, row.paid_amount, result.paymentState, result.expected, reason, now);
    if (reason === 'listing_kind_not_mirrored') {
      console.log(`[orders] order ${orderId.slice(0, 12)}…: 'paid' under the older rules; an item's listing kind is not mirrored by this portal, so it is not judged here (${result.paymentState}) — listed in order_settle_review as listing_kind_not_mirrored`);
    } else {
      console.warn(`[orders] order ${orderId.slice(0, 12)}…: 'paid' under the older rules, ${result.paymentState} under SPEC v1.1.2 — not paid, listed in order_settle_review`);
    }
  } else if (paid) {
    db.prepare('UPDATE order_settle_review SET cleared_at = ? WHERE order_id = ? AND cleared_at IS NULL').run(now, orderId);
  } else if (!legacy) {
    const cand = result.paidBy;
    const totalCents = toCents(order.total);
    if (!cand) {
      db.prepare(`UPDATE order_settle_review SET cleared_at = ? WHERE order_id = ? AND cleared_at IS NULL AND reason IN (${LIVE_REVIEW_REASONS.map(() => '?').join(', ')})`)
        .run(now, orderId, ...LIVE_REVIEW_REASONS);
    } else if (result.paymentState === 'amount_mismatch' && totalCents !== null && totalCents === toCents(cand.amount)) {
      const reason = result.expected === '' ? 'not_computable' : 'terms_mismatch';
      const listed = db.prepare(`
        INSERT INTO order_settle_review (order_id, order_event_id, old_paid_tx_id, old_paid_amount, verdict, expected_total, reason, listed_at, cleared_at, confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(order_id) DO UPDATE SET
          listed_at = CASE WHEN order_settle_review.cleared_at IS NULL AND order_settle_review.order_event_id IS excluded.order_event_id
                           THEN order_settle_review.listed_at ELSE excluded.listed_at END,
          order_event_id = excluded.order_event_id, old_paid_tx_id = excluded.old_paid_tx_id,
          old_paid_amount = excluded.old_paid_amount, verdict = excluded.verdict,
          expected_total = excluded.expected_total, reason = excluded.reason,
          cleared_at = NULL, confirmed_at = NULL
        WHERE order_settle_review.cleared_at IS NOT NULL
           OR order_settle_review.order_event_id IS NOT excluded.order_event_id
           OR order_settle_review.old_paid_tx_id IS NOT excluded.old_paid_tx_id
           OR order_settle_review.old_paid_amount IS NOT excluded.old_paid_amount
           OR order_settle_review.reason IS NOT excluded.reason
           OR order_settle_review.expected_total IS NOT excluded.expected_total
      `).run(orderId, row.order_event_id, cand.txId, cand.amount, result.paymentState, result.expected, reason, now);
      if (listed.changes > 0) {
        console.warn(`[orders] order ${orderId.slice(0, 12)}…: a verified 30933 pays its total, verdict amount_mismatch (${reason}) — not paid, listed in order_settle_review`);
      }
    }
  }
  return result;
}

/**
 * SPEC v1.1.2 §8 step 5a, at start-up: every 'paid' row without settled_*
 * holds a verdict of the older rules (see schema.ts) and is judged again by
 * step 5 alone — recomputeOrder passes no pin for it. Paid now ⇒ settled_*
 * are written; not paid ⇒ the row takes the new verdict and is listed in
 * order_settle_review: `listed` with reason step5_not_paid (for Brilly to
 * check — confirmSettleReview restores an honest one), `notMirrored` with
 * reason listing_kind_not_mirrored (an item of a listing kind outside
 * opts.listingKinds). Idempotent: after one pass no such row is left.
 */
export function rejudgeLegacyPaidOrders(
  db: Database.Database,
  now = Math.floor(Date.now() / 1000),
  opts: RecomputeOptions = {},
): { judged: number; paid: number; listed: number; notMirrored: number } {
  const ids = (db.prepare("SELECT order_id FROM orders WHERE payment_state = 'paid' AND settled_tx_id IS NULL")
    .all() as Array<{ order_id: string }>).map(r => r.order_id);
  const reasonOf = db.prepare('SELECT reason FROM order_settle_review WHERE order_id = ? AND cleared_at IS NULL');
  let paid = 0, notMirrored = 0;
  for (const id of ids) {
    if (recomputeOrder(db, id, now, opts)?.paymentState === 'paid') { paid++; continue; }
    if ((reasonOf.get(id) as { reason: string } | undefined)?.reason === 'listing_kind_not_mirrored') notMirrored++;
  }
  const out = { judged: ids.length, paid, listed: ids.length - paid - notMirrored, notMirrored };
  if (ids.length > 0) console.log(`[orders] v1.1.2 re-judge of older 'paid' verdicts: judged=${out.judged} paid=${out.paid} listed_for_review=${out.listed} listing_kind_not_mirrored=${out.notMirrored}`);
  return out;
}

// ─── Brilly's word on an order step 5 does not pay ─────────────────────

export interface SettleReviewEntry {
  order_id: string; order_event_id: string | null; old_paid_tx_id: string | null; old_paid_amount: string | null;
  verdict: string; expected_total: string | null; reason: string; listed_at: number; cleared_at: number | null; confirmed_at: number | null;
  /** the order as mirrored now */
  current_event_id: string | null; payment_state: string | null; unit_id: string | null; order_json: string | null;
}

/** Open entries of order_settle_review with the order as mirrored now, oldest first; optionally of one reason. */
export function listSettleReview(db: Database.Database, reason?: string): SettleReviewEntry[] {
  return db.prepare(`
    SELECT r.order_id, r.order_event_id, r.old_paid_tx_id, r.old_paid_amount, r.verdict, r.expected_total, r.reason,
           r.listed_at, r.cleared_at, r.confirmed_at,
           o.order_event_id AS current_event_id, o.payment_state, o.unit_id, o.order_json
      FROM order_settle_review r LEFT JOIN orders o ON o.order_id = r.order_id
     WHERE r.cleared_at IS NULL AND (? IS NULL OR r.reason = ?)
     ORDER BY r.listed_at, r.order_id
  `).all(reason ?? null, reason ?? null) as SettleReviewEntry[];
}

/** Reasons settle-review.ts shows without --all: what Brilly has to look at. */
export const SETTLE_REVIEW_REASONS: ReadonlySet<string> = new Set(['step5_not_paid', ...LIVE_REVIEW_REASONS]);
/** An entry younger than this is left out without --all: the mirror may still be catching up. */
export const SETTLE_REVIEW_MIN_AGE_SEC = 3600;

/**
 * What settle-review.ts lists. Without `all`: the open entries of
 * SETTLE_REVIEW_REASONS listed at least SETTLE_REVIEW_MIN_AGE_SEC ago — a
 * shop that left the mirror for a minute, or a 30933 that landed before its
 * listing, lists an order for a moment; `hidden` counts what is left out.
 * With `all`: every open entry (also listing_kind_not_mirrored — another
 * portal's orders).
 */
export function settleReviewView(db: Database.Database, now: number, all: boolean): { shown: SettleReviewEntry[]; hidden: number } {
  const open = listSettleReview(db);
  if (all) return { shown: open, hidden: 0 };
  const shown = open.filter(e => SETTLE_REVIEW_REASONS.has(e.reason) && now - e.listed_at >= SETTLE_REVIEW_MIN_AGE_SEC);
  return { shown, hidden: open.length - shown.length };
}

export type ConfirmSettleReviewResult =
  | { ok: true; paymentState: 'paid'; expected: string }
  | {
    ok: false;
    reason: 'no_open_entry' | 'order_replaced' | 'event_mismatch' | 'not_taken_event' | 'no_old_payment' | 'total_mismatch' | 'unit_unknown' | 'not_paid';
    paymentState?: string;
  };

class ConfirmNotPaid extends Error {}

/**
 * Brilly confirms ONE open entry of order_settle_review as honest (round 3,
 * 2 Oct 2026; round 5, 5 Oct 2026): after checking the order against what
 * the broker took and checked at order time (shop.lanapays.us
 * server/scripts/order-as-taken.ts), he names its order id, the 36520 event
 * id he checked and the event id the broker took. The entry's purchase
 * (old_paid_tx_id, old_paid_amount — the one the older rules had paid it
 * with, or the candidate 30933 of a round-5 entry) becomes the step-5a pin
 * (settled_*) of exactly that event and the order is judged at once — so it
 * is paid only while the NEWEST version of that 30933 still pays that amount
 * for this order; a later cancellation un-pays it, as it un-pays every pin.
 *
 * Refused, with nothing written, when no entry is open for the order, the
 * mirrored 36520 is no longer the event that was listed (the buyer replaced
 * it since: that is another order), the event id given is not the mirrored
 * one, the broker took another event (a buyer's replacement at the same
 * total is not what the broker checked), the entry holds no payment, the
 * order's own total is not the pinned amount, the shop is not mirrored, or
 * the resolver does not pay the order with that pin. Never called by the app
 * itself (server/scripts/settle-review.ts).
 */
export function confirmSettleReview(
  db: Database.Database,
  orderId: string,
  expectEventId: string,
  takenEventId: string,
  now = Math.floor(Date.now() / 1000),
): ConfirmSettleReviewResult {
  const entry = db.prepare('SELECT * FROM order_settle_review WHERE order_id = ? AND cleared_at IS NULL').get(orderId) as
    { order_event_id: string | null; old_paid_tx_id: string | null; old_paid_amount: string | null } | undefined;
  if (!entry) return { ok: false, reason: 'no_open_entry' };
  const row = db.prepare('SELECT order_event_id, order_json, unit_id FROM orders WHERE order_id = ?').get(orderId) as
    { order_event_id: string | null; order_json: string; unit_id: string } | undefined;
  if (!row || !entry.order_event_id || entry.order_event_id !== row.order_event_id) return { ok: false, reason: 'order_replaced' };
  if (!expectEventId || expectEventId !== row.order_event_id) return { ok: false, reason: 'event_mismatch' };
  if (!takenEventId || takenEventId !== expectEventId) return { ok: false, reason: 'not_taken_event' };
  const cents = toCents(entry.old_paid_amount);
  if (!entry.old_paid_tx_id || cents === null || cents <= 0) return { ok: false, reason: 'no_old_payment' };
  let parsed: Partial<ParsedShopOrder> = {};
  try { parsed = JSON.parse(row.order_json) as ParsedShopOrder; } catch { parsed = {}; }
  if (toCents(parsed.total ?? null) !== cents) return { ok: false, reason: 'total_mismatch' };
  if (!loadUnit(db, String(parsed.ownerHex || ''), row.unit_id)) return { ok: false, reason: 'unit_unknown' };
  let result: ResolverResult | null = null;
  try {
    db.transaction(() => {
      db.prepare('UPDATE orders SET settled_tx_id = ?, settled_amount = ?, settled_order_event_id = ? WHERE order_id = ?')
        .run(entry.old_paid_tx_id, entry.old_paid_amount, row.order_event_id, orderId);
      result = recomputeOrder(db, orderId, now);
      if (result?.paymentState !== 'paid') throw new ConfirmNotPaid();
      db.prepare('UPDATE order_settle_review SET confirmed_at = ? WHERE order_id = ?').run(now, orderId);
    })();
  } catch (e) {
    if (e instanceof ConfirmNotPaid) return { ok: false, reason: 'not_paid', paymentState: (result as ResolverResult | null)?.paymentState };
    throw e;
  }
  return { ok: true, paymentState: 'paid', expected: (result as ResolverResult | null)?.expected ?? '' };
}

/** A 30933 landed — recompute every order it could settle. */
export function recomputeOrdersForPurchase(db: Database.Database, unitId: string, invoiceNumber: string, now?: number): void {
  const rows = db.prepare('SELECT order_id FROM orders WHERE unit_id = ? AND order_id = ?')
    .all(unitId, invoiceNumber) as Array<{ order_id: string }>;
  for (const r of rows) recomputeOrder(db, r.order_id, now);
}

/** A 30901 / listing landed — its orders' expected amounts may have moved. */
export function recomputeOrdersForUnit(db: Database.Database, unitId: string, now?: number): void {
  const rows = db.prepare('SELECT order_id FROM orders WHERE unit_id = ?')
    .all(unitId) as Array<{ order_id: string }>;
  for (const r of rows) recomputeOrder(db, r.order_id, now);
}

/** Money exists for this order (paid OR amount_mismatch) — deletions are ignored. */
export function orderHasMoney(db: Database.Database, orderId: string): boolean {
  const row = db.prepare('SELECT payment_state FROM orders WHERE order_id = ?').get(orderId) as { payment_state: string } | undefined;
  return !!row && (row.payment_state === 'paid' || row.payment_state === 'amount_mismatch');
}
