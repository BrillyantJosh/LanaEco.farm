/**
 * Lana Online Shop — portal order API (SPEC §9.3, §10).
 *
 *   POST /api/orders/quote            price from the LOCAL MIRROR only — one
 *                                     listing, or a cart of ONE shop
 *                                     {lines:[{pubkey,listingId,qty}]}
 *   POST /api/orders                  verify both events, re-derive the
 *                                     quote byte-for-byte, forward to the
 *                                     broker (shop.lanapays.us)
 *   GET  /api/orders/:orderId         public status — NO PII, NO ciphertext
 *   POST /api/orders/:orderId/cancel  forward a buyer-signed cancel republish
 *   POST /api/orders/:orderId/retry   forward a NEW order that supersedes an
 *                                     expired one
 *
 * The portal holds no secrets and never publishes to relays itself; the
 * broker does. Money truth stays the brain-signed 30933 seen on relays
 * (liveSync → orderJoin → resolver) — the broker's "paid" is only a hint
 * that makes us pull 30933 sooner.
 */

import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import { verifyEvent } from 'nostr-tools/pure';
import { parseShopOrder, type ParsedShopOrder } from '../lib/parsers.js';
import {
  buildQuote, buildCartQuote, QuoteError, nowSec, PAY_WINDOW_SEC, loadListing, maxItemsPerOrder,
  MAX_ITEMS_PER_ORDER, type Quote, type QuoteLineRequest,
} from '../lib/onlineShop.js';
import { ORDER_ID_RE, orderIdMatchesPubkey } from '../lib/orderResolver.js';
import { recomputeOrder, upsertOrderEvent } from '../lib/orderJoin.js';
import { getEffectiveRelays, refreshPurchasesForUnit } from '../lib/liveSync.js';
import type { NostrEvent } from '../lib/relaySync.js';

const KIND_ORDER = 36520;
const KIND_DELIVERY = 36522;
const HEX64_RE = /^[0-9a-f]{64}$/;
const CREATED_AT_TOLERANCE = 600;       // ±10 min
const MAX_OPEN_PER_BUYER = 5;
const MAX_OPEN_PER_UNIT = 50;
const BROKER_TIMEOUT_MS = 20_000;
const BROKER_STATUS_TIMEOUT_MS = 5_000;
const BROKER_STATUS_MIN_INTERVAL = 20;  // seconds between broker asks per order
const MAX_DELIVERY_CIPHERTEXT = 16_384;

/**
 * 36520 tag order is frozen (SPEC §2); `supersedes` is optional and last.
 * SPEC v1.1.0: the `item` tag repeats (1..maxItemsPerOrder(), contiguous).
 */
const ORDER_TAGS_BEFORE_ITEMS = ['d', 'a', 'p', 'unit_id', 'invoice_number'];
const ORDER_TAGS_AFTER_ITEMS = ['shipping', 'total', 'fulfillment', 'status', 'pay_by', 'client', 'v'];

class RouteError extends Error {
  constructor(public status: number, public code: string, public reason?: string, public line?: number) {
    super(code);
  }
}

/** This portal's id at the broker (PORTAL_ORIGINS key there); PORTAL_ID env wins. */
function portalId(): string {
  return process.env.PORTAL_ID || 'lanaeco-farm';
}

function normalizeHost(h: string): string {
  return String(h || '').trim().toLowerCase().replace(/^www\./, '');
}

function portalHost(): string | null {
  const raw = process.env.PORTAL_PUBLIC_URL;
  if (!raw) return null;
  try { return normalizeHost(new URL(raw).host); } catch { return null; }
}

function brokerBase(): string | null {
  const raw = (process.env.SHOP_ORDERS_URL || '').trim().replace(/\/+$/, '');
  return raw ? raw : null;
}

function sendError(res: Response, status: number, code: string, reason?: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ ...(reason ? { error: code, code, reason } : { error: code, code }), ...extra });
}

/**
 * `line` (and the accepted qty range) of a refused cart line, or
 * `scope: 'shop'` when the refusal is about the whole shop — public listing
 * and shop facts only.
 */
function lineExtra(err: { line?: number; bounds?: { min: number; max: number | null }; scope?: 'shop' }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof err.line === 'number') out.line = err.line;
  if (err.bounds) { out.min = err.bounds.min; out.max = err.bounds.max; }
  if (err.scope === 'shop') out.scope = 'shop';
  return out;
}

function isEventShaped(x: unknown): x is NostrEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.pubkey === 'string' && typeof e.sig === 'string'
    && typeof e.kind === 'number' && typeof e.created_at === 'number'
    && typeof e.content === 'string' && Array.isArray(e.tags) && e.tags.length <= 64
    && e.tags.every(t => Array.isArray(t) && t.every(v => typeof v === 'string' && v.length <= 4096));
}

function tagValues(ev: NostrEvent, name: string): string[] {
  return ev.tags.filter(t => t[0] === name).map(t => t[1] || '');
}

function verified(x: unknown, kind: number): NostrEvent {
  if (!isEventShaped(x) || x.kind !== kind) throw new RouteError(400, 'INVALID_EVENT', `kind_${kind}`);
  // Verify a PLAIN copy — nostr-tools caches its verdict under a symbol that
  // survives object spread; never let a cached `true` vouch for this object.
  const plain = { id: x.id, pubkey: x.pubkey, created_at: x.created_at, kind: x.kind, tags: x.tags, content: x.content, sig: x.sig };
  let ok = false;
  try { ok = verifyEvent(plain as any) === true; } catch { ok = false; }
  if (!ok) throw new RouteError(400, 'INVALID_EVENT', 'signature');
  return plain;
}

/** SPEC §2 shape rules that do not need the mirror. */
function checkOrderShape(order: NostrEvent, now: number, expectSupersedes: string | null): ParsedShopOrder {
  if (order.content !== '') throw new RouteError(400, 'INVALID_EVENT', 'content');
  const names = order.tags.map(t => t[0]);
  const itemCount = names.filter(n => n === 'item').length;
  if (itemCount < 1) throw new RouteError(400, 'INVALID_EVENT', 'item');
  if (itemCount > maxItemsPerOrder()) throw new RouteError(400, 'INVALID_EVENT', 'too_many_items');
  const expected = [
    ...ORDER_TAGS_BEFORE_ITEMS,
    ...Array.from({ length: itemCount }, () => 'item'),
    ...ORDER_TAGS_AFTER_ITEMS,
    ...(expectSupersedes ? ['supersedes'] : []),
  ];
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
    throw new RouteError(400, 'INVALID_EVENT', 'tags');
  }
  const p = parseShopOrder(order);
  if (!ORDER_ID_RE.test(p.orderId) || !orderIdMatchesPubkey(p.orderId, order.pubkey)) {
    throw new RouteError(400, 'INVALID_EVENT', 'order_id');
  }
  if (p.invoiceNumber !== p.orderId) throw new RouteError(400, 'INVALID_EVENT', 'invoice_number');
  if (p.version !== '1') throw new RouteError(400, 'INVALID_EVENT', 'v');
  if (p.status !== 'placed') throw new RouteError(400, 'INVALID_EVENT', 'status');
  if (p.fulfillment !== 'shipping' && p.fulfillment !== 'pickup') throw new RouteError(400, 'INVALID_EVENT', 'fulfillment');
  if (!HEX64_RE.test(p.ownerHex) || !/^[0-9a-f]{32}$/.test(p.unitId)) throw new RouteError(400, 'INVALID_EVENT', 'unit');
  if (p.unitRef !== `30901:${p.ownerHex}:${p.unitId}`) throw new RouteError(400, 'INVALID_EVENT', 'a');
  // Every item is the shop's own listing, and each listing appears once: a
  // product split over two lines would slip past its stock and max_order.
  const seenItems = new Set<string>();
  p.items.forEach((it, i) => {
    if (it.ownerHex !== p.ownerHex) throw new RouteError(400, 'INVALID_EVENT', 'item', i);
    if (seenItems.has(it.a)) throw new RouteError(400, 'INVALID_EVENT', 'duplicate_item', i);
    seenItems.add(it.a);
  });
  if (p.payBy !== order.created_at + PAY_WINDOW_SEC) throw new RouteError(400, 'INVALID_EVENT', 'pay_by');
  if (Math.abs(now - order.created_at) > CREATED_AT_TOLERANCE) throw new RouteError(400, 'INVALID_EVENT', 'created_at');
  const host = portalHost();
  if (!p.client || (host && normalizeHost(p.client) !== host)) throw new RouteError(400, 'INVALID_EVENT', 'client');
  if (expectSupersedes && p.supersedes !== expectSupersedes) throw new RouteError(400, 'INVALID_EVENT', 'supersedes');
  return p;
}

/** SPEC §4 — 36522 must bind to this order and this unit owner; ciphertext only. */
function checkDeliveryShape(delivery: NostrEvent, order: NostrEvent, parsed: ParsedShopOrder, recipientHex: string): void {
  if (delivery.pubkey !== order.pubkey) throw new RouteError(400, 'INVALID_EVENT', 'pubkey');
  const d = tagValues(delivery, 'd')[0] || '';
  if (d !== `${parsed.orderId}__${recipientHex}`) throw new RouteError(400, 'INVALID_EVENT', 'delivery_d');
  if (tagValues(delivery, 'a')[0] !== `36520:${order.pubkey}:${parsed.orderId}`) throw new RouteError(400, 'INVALID_EVENT', 'delivery_a');
  if (tagValues(delivery, 'p')[0] !== recipientHex) throw new RouteError(400, 'INVALID_EVENT', 'delivery_p');
  if (tagValues(delivery, 'unit_id')[0] !== parsed.unitId) throw new RouteError(400, 'INVALID_EVENT', 'delivery_unit');
  if (tagValues(delivery, 'encryption')[0] !== 'nip44') throw new RouteError(400, 'INVALID_EVENT', 'encryption');
  if (tagValues(delivery, 'v')[0] !== '1') throw new RouteError(400, 'INVALID_EVENT', 'delivery_v');
  const ct = delivery.content;
  if (!ct || ct.length > MAX_DELIVERY_CIPHERTEXT || !/^[A-Za-z0-9+/=]+$/.test(ct)) {
    throw new RouteError(400, 'INVALID_EVENT', 'ciphertext');
  }
}

/**
 * Re-derive the quote from the order tags (every item, in TAG order) and
 * require byte-equality on every money / identity field of every item. The
 * buyer's numbers are never trusted.
 */
function rederive(db: Database.Database, order: NostrEvent, parsed: ParsedShopOrder, now: number): Quote {
  const itemTags = order.tags.filter(t => t[0] === 'item');
  let quote: Quote;
  try {
    quote = buildCartQuote(db, {
      lines: parsed.items.map(it => ({ pubkey: it.ownerHex, listingId: it.listingId, qty: it.qty })),
      fulfillment: parsed.fulfillment,
    }, now);
  } catch (err) {
    if (err instanceof QuoteError) throw new RouteError(err.status, err.code, err.reason, err.line);
    throw err;
  }
  const itemsSame = quote.items.length === parsed.items.length && parsed.items.every((item, i) => {
    const q = quote.items[i];
    return item.a === q.a &&
      itemTags[i][2] === String(q.qty) &&
      item.saleUnit === q.saleUnit &&
      item.unitPrice === q.unitPrice &&
      item.currency === quote.currency;
  });
  const same =
    parsed.unitId === quote.unitId &&
    parsed.ownerHex === quote.unitOwnerHex &&
    itemsSame &&
    parsed.shippingFee === quote.shipping &&
    parsed.shippingCurrency === quote.currency &&
    parsed.total === quote.total &&
    parsed.currency === quote.currency;
  if (!same) throw new RouteError(409, 'PRICE_MISMATCH');
  return quote;
}

function checkCaps(db: Database.Database, buyerPubkey: string, unitId: string, now: number): void {
  const open = `payment_state = 'unpaid' AND json_extract(order_json, '$.status') = 'placed' AND json_extract(order_json, '$.payBy') > ?`;
  const byBuyer = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE buyer_pubkey = ? AND ${open}`).get(buyerPubkey, now) as { n: number };
  if (byBuyer.n >= MAX_OPEN_PER_BUYER) throw new RouteError(409, 'TOO_MANY_OPEN_ORDERS', 'buyer');
  const byUnit = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE unit_id = ? AND ${open}`).get(unitId, now) as { n: number };
  if (byUnit.n >= MAX_OPEN_PER_UNIT) throw new RouteError(409, 'TOO_MANY_OPEN_ORDERS', 'unit');
}

interface Submission {
  order: NostrEvent;
  delivery: NostrEvent;
  parsed: ParsedShopOrder;
  quote: Quote;
}

function validateSubmission(db: Database.Database, body: any, now: number, expectSupersedes: string | null): Submission {
  const order = verified(body?.order, KIND_ORDER);
  const delivery = verified(body?.delivery, KIND_DELIVERY);
  const parsed = checkOrderShape(order, now, expectSupersedes);
  const quote = rederive(db, order, parsed, now);
  checkDeliveryShape(delivery, order, parsed, quote.unitOwnerHex);
  checkCaps(db, order.pubkey, quote.unitId, now);
  return { order, delivery, parsed, quote };
}

async function brokerFetch(path: string, init: RequestInit, timeoutMs: number): Promise<globalThis.Response | null> {
  const base = brokerBase();
  if (!base) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
  } catch (err: any) {
    console.error(`[orders] broker ${path} unreachable:`, err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(r: globalThis.Response): Promise<any> {
  try { return await r.json(); } catch { return {}; }
}

/**
 * Broker error passthrough — same code, never the broker's free text.
 *
 * The broker answers `{ error: { code, message } }`, so reading only a STRING
 * `body.error` collapsed every refusal to a bare BROKER_ERROR and hid the
 * reason from both the shopper and the log (it cost an E2E debugging round to
 * find that a 409 was really OUT_OF_STOCK). The message is still never
 * forwarded — it is only logged server-side.
 */
function passThrough(res: Response, status: number, body: any): void {
  const code =
    (typeof body?.error?.code === 'string' && body.error.code)
    || (typeof body?.code === 'string' && body.code)
    || (typeof body?.error === 'string' && body.error)
    || 'BROKER_ERROR';
  const detail = typeof body?.error?.message === 'string' ? body.error.message : '';
  if (detail) console.warn(`[orders] broker ${status} ${code}: ${detail.slice(0, 200)}`);
  // The broker does not know this portal (its PORTAL_ORIGINS has no entry
  // for PORTAL_ID): no retry can succeed, so the shopper is told ordering is
  // not switched on here — not "try again".
  if (status === 400 && code === 'INVALID_EVENT' && detail === 'unknown portal_id') {
    console.warn(`[orders] the broker does not know portal id '${portalId()}' — add it to the broker's PORTAL_ORIGINS`);
    sendError(res, 503, 'ORDERING_UNAVAILABLE', 'portal_unknown');
    return;
  }
  sendError(res, status >= 400 && status < 600 ? status : 502, code);
}

async function forwardCreate(db: Database.Database, res: Response, path: string, sub: Submission, now: number): Promise<void> {
  const r = await brokerFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Portal-Id': portalId() },
    body: JSON.stringify({ order: sub.order, delivery: sub.delivery, portal_id: portalId() }),
  }, BROKER_TIMEOUT_MS);
  if (!r) { sendError(res, 503, 'ORDERING_UNAVAILABLE'); return; }
  const body = await readJson(r);
  if (r.status !== 201 && r.status !== 200) { passThrough(res, r.status, body); return; }

  // Broker accepted (and will publish 36520 + 36522). Mirror the order
  // locally now so the status page is live before the relay echo arrives.
  upsertOrderEvent(db, sub.order, now);
  db.prepare(`
    UPDATE orders SET local_status = 'placed', pay_url = ?, session_id = ?, expires_at = ?
    WHERE order_id = ?
  `).run(
    typeof body.pay_url === 'string' ? body.pay_url : null,
    typeof body.session_id === 'string' ? body.session_id : null,
    typeof body.expires_at === 'string' ? body.expires_at : null,
    sub.parsed.orderId,
  );
  res.status(r.status).json({
    order_id: sub.parsed.orderId,
    pay_url: typeof body.pay_url === 'string' ? body.pay_url : null,
    expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
  });
}

interface OrderRow {
  order_id: string;
  buyer_pubkey: string;
  unit_id: string;
  order_created_at: number;
  order_json: string;
  fulfillment_json: string | null;
  payment_state: string;
  effective_status: string | null;
  paid_tx_id: string | null;
  paid_at: number | null;
  paid_lana_amount: string | null;
  paid_tx_hash: string | null;
  price_changed: number;
  local_status: string | null;
  pay_url: string | null;
  expires_at: string | null;
  broker_checked_at: number;
}

function loadOrderRow(db: Database.Database, orderId: string): OrderRow | undefined {
  return db.prepare(`
    SELECT order_id, buyer_pubkey, unit_id, order_created_at, order_json, fulfillment_json,
           payment_state, effective_status, paid_tx_id, paid_at, paid_lana_amount, paid_tx_hash,
           price_changed, local_status, pay_url, expires_at, broker_checked_at
    FROM orders WHERE order_id = ?
  `).get(orderId) as OrderRow | undefined;
}

/** True unless PORTAL_PUBLIC_URL is set and the order's `client` names another host. */
function isThisPortalsOrder(row: OrderRow): boolean {
  const host = portalHost();
  if (!host) return true;
  let client = '';
  try { client = String(JSON.parse(row.order_json)?.client || ''); } catch { client = ''; }
  return normalizeHost(client) === host;
}

/** Public view — NO PII, NO ciphertext, no buyer key material beyond what relays already carry. */
function orderView(db: Database.Database, row: OrderRow): Record<string, unknown> {
  let o: ParsedShopOrder | null = null;
  try { o = JSON.parse(row.order_json); } catch { o = null; }
  let f: any = null;
  if (row.fulfillment_json) { try { f = JSON.parse(row.fulfillment_json); } catch { f = null; } }
  const unitName = (db.prepare('SELECT parsed_json FROM business_units WHERE pubkey = ? AND unit_id = ?')
    .get(o?.ownerHex || '', row.unit_id) as { parsed_json: string } | undefined);
  let name = '';
  try { name = unitName ? String(JSON.parse(unitName.parsed_json).name || '') : ''; } catch { name = ''; }
  const items = (o?.items || []).map(it => {
    const listing = it.ownerHex && it.listingId ? loadListing(db, it.ownerHex, it.listingId) : null;
    return { a: it.a, kind: it.kind, qty: it.qty, saleUnit: it.saleUnit, unitPrice: it.unitPrice, currency: it.currency, title: listing?.title || '' };
  });
  const unpaidPlaced = row.payment_state === 'unpaid' && o?.status === 'placed';
  return {
    orderId: row.order_id,
    unitId: row.unit_id,
    unitName: name,
    client: o?.client || '',
    items,
    shipping: o?.shippingFee || '0.00',
    total: o?.total || '',
    currency: o?.currency || '',
    fulfillment: o?.fulfillment || '',
    buyerStatus: o?.status || '',
    paymentState: row.payment_state,
    paidAt: row.paid_at ?? null,
    txId: row.paid_tx_id ?? null,
    txHash: row.paid_tx_hash || null,
    lanaAmount: row.paid_lana_amount ?? null,
    effectiveStatus: row.effective_status || row.payment_state,
    priceChanged: row.price_changed === 1,
    carrier: f?.carrier || null,
    tracking: f?.tracking || null,
    shippedAt: f?.shippedAt || null,
    deliveredAt: f?.deliveredAt || null,
    createdAt: row.order_created_at,
    payBy: o?.payBy ?? null,
    ...(unpaidPlaced && row.pay_url ? { payUrl: row.pay_url, expiresAt: row.expires_at } : {}),
  };
}

/**
 * `?src=pay` landing: ask the broker once (cheap) and, if it says paid,
 * pull 30933 from relays right away. The broker's word itself is never
 * stored as payment state.
 */
async function maybeAskBroker(db: Database.Database, row: OrderRow, now: number): Promise<void> {
  if (row.payment_state !== 'unpaid') return;
  if (now - row.broker_checked_at < BROKER_STATUS_MIN_INTERVAL) return;
  db.prepare('UPDATE orders SET broker_checked_at = ? WHERE order_id = ?').run(now, row.order_id);
  const r = await brokerFetch(`/api/shop-orders/${encodeURIComponent(row.order_id)}/status`, { method: 'GET' }, BROKER_STATUS_TIMEOUT_MS);
  if (!r || !r.ok) return;
  const body = await readJson(r);
  if (typeof body.pay_url === 'string' || typeof body.expires_at === 'string') {
    db.prepare('UPDATE orders SET pay_url = COALESCE(?, pay_url), expires_at = COALESCE(?, expires_at) WHERE order_id = ?')
      .run(typeof body.pay_url === 'string' ? body.pay_url : null, typeof body.expires_at === 'string' ? body.expires_at : null, row.order_id);
  }
  if (body.status === 'paid') {
    try { await refreshPurchasesForUnit(row.unit_id, row.order_created_at - 60); } catch {}
  }
}

export function createOrdersRouter(db: Database.Database): Router {
  const router = Router();
  // 60/min: the cart page re-quotes (debounced) while the shopper changes
  // quantities; a quote is a read of the local mirror only.
  const quoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
  const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  const viewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

  // POST /api/orders/quote {pubkey, listingId, qty, fulfillment}
  //                        | {lines:[{pubkey, listingId, qty}], fulfillment, unitId?}
  // `maxItems` = how many different products one ORDER may carry right now
  // (SHOP_MAX_ITEMS); a cart quote may price up to MAX_ITEMS_PER_ORDER lines.
  // fulfillment 'auto' (the cart page, the checkout's first quote): shipping
  // when every line can be shipped, else pickup — a pickup-only farm product
  // is never shipped; the quote's `fulfillment` says which was priced. Only
  // a quote takes 'auto': an order names shipping or pickup.
  router.post('/quote', quoteLimiter, (req: Request, res: Response) => {
    const b = req.body || {};
    const toQty = (v: unknown) => (typeof v === 'number' ? v : parseInt(String(v ?? ''), 10));
    const isCart = Array.isArray(b.lines);
    try {
      const wanted = String(b.fulfillment || 'shipping');
      const price = (fulfillment: string): Quote => (isCart
        ? buildCartQuote(db, {
          lines: (b.lines as unknown[]).slice(0, MAX_ITEMS_PER_ORDER + 1).map((l: any): QuoteLineRequest => ({
            pubkey: String(l?.pubkey || ''),
            listingId: String(l?.listingId || ''),
            qty: toQty(l?.qty),
          })),
          fulfillment,
          ...(typeof b.unitId === 'string' && b.unitId ? { unitId: b.unitId } : {}),
        })
        : buildQuote(db, {
          pubkey: String(b.pubkey || ''),
          listingId: String(b.listingId || ''),
          qty: toQty(b.qty),
          fulfillment,
        }));
      let quote: Quote;
      if (wanted === 'auto') {
        try {
          quote = price('shipping');
        } catch (err) {
          if (!(err instanceof QuoteError && err.code === 'INVALID_REQUEST' && err.reason === 'fulfillment')) throw err;
          quote = price('pickup');
        }
      } else {
        quote = price(wanted);
      }
      const { listingCreatedAt: _omit, ...pub } = quote;
      res.json({ ...pub, maxItems: maxItemsPerOrder(), relays: getEffectiveRelays(db) });
    } catch (err) {
      if (err instanceof QuoteError) {
        sendError(res, err.status, err.code, err.reason, isCart ? { ...lineExtra(err), maxItems: maxItemsPerOrder() } : {});
        return;
      }
      console.error('[orders] quote failed:', (err as Error).message);
      sendError(res, 500, 'QUOTE_FAILED');
    }
  });

  // POST /api/orders {order, delivery}
  router.post('/', createLimiter, async (req: Request, res: Response) => {
    const now = nowSec();
    let sub: Submission;
    try {
      sub = validateSubmission(db, req.body, now, null);
    } catch (err) {
      if (err instanceof RouteError) { sendError(res, err.status, err.code, err.reason, lineExtra(err)); return; }
      console.error('[orders] create failed:', (err as Error).message);
      sendError(res, 500, 'ORDER_FAILED');
      return;
    }
    if (!brokerBase()) { sendError(res, 503, 'ORDERING_UNAVAILABLE'); return; }
    await forwardCreate(db, res, '/api/shop-orders', sub, now);
  });

  // GET /api/orders/:orderId
  router.get('/:orderId', viewLimiter, async (req: Request, res: Response) => {
    const orderId = String(req.params.orderId || '');
    if (!ORDER_ID_RE.test(orderId)) { sendError(res, 404, 'NOT_FOUND'); return; }
    const now = nowSec();
    let row = loadOrderRow(db, orderId);
    if (!row) { sendError(res, 404, 'NOT_FOUND'); return; }
    // An order placed on another portal is not shown here: its status page
    // and its pay link belong to that portal (PORTAL_PUBLIC_URL set ⇒ the
    // 36520 `client` must be this host, as POST / requires).
    if (!isThisPortalsOrder(row)) { sendError(res, 404, 'NOT_FOUND'); return; }
    recomputeOrder(db, orderId, now);
    row = loadOrderRow(db, orderId)!;
    if (req.query.src === 'pay') {
      await maybeAskBroker(db, row, now);
      recomputeOrder(db, orderId, now);
      row = loadOrderRow(db, orderId)!;
    }
    res.json(orderView(db, row));
  });

  // POST /api/orders/:orderId/cancel {event}
  router.post('/:orderId/cancel', createLimiter, async (req: Request, res: Response) => {
    const orderId = String(req.params.orderId || '');
    if (!ORDER_ID_RE.test(orderId)) { sendError(res, 404, 'NOT_FOUND'); return; }
    let event: NostrEvent;
    try {
      event = verified(req.body?.event, KIND_ORDER);
      if (event.content !== '') throw new RouteError(400, 'INVALID_EVENT', 'content');
      const p = parseShopOrder(event);
      if (p.orderId !== orderId || !orderIdMatchesPubkey(orderId, event.pubkey)) throw new RouteError(400, 'INVALID_EVENT', 'order_id');
      if (p.status !== 'cancelled') throw new RouteError(400, 'INVALID_EVENT', 'status');
      const row = loadOrderRow(db, orderId);
      if (row) {
        if (row.buyer_pubkey !== event.pubkey) throw new RouteError(403, 'FORBIDDEN');
        if (event.created_at <= row.order_created_at) throw new RouteError(400, 'INVALID_EVENT', 'created_at');
        if (row.payment_state === 'paid' || row.payment_state === 'amount_mismatch') throw new RouteError(409, 'NOT_CANCELLABLE');
      }
    } catch (err) {
      if (err instanceof RouteError) { sendError(res, err.status, err.code, err.reason); return; }
      sendError(res, 400, 'INVALID_EVENT');
      return;
    }
    if (!brokerBase()) { sendError(res, 503, 'ORDERING_UNAVAILABLE'); return; }
    const r = await brokerFetch(`/api/shop-orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal-Id': portalId() },
      body: JSON.stringify({ event }),
    }, BROKER_TIMEOUT_MS);
    if (!r) { sendError(res, 503, 'ORDERING_UNAVAILABLE'); return; }
    const body = await readJson(r);
    if (!r.ok) { passThrough(res, r.status, body); return; }
    upsertOrderEvent(db, event, nowSec());
    res.json({ order_id: orderId, status: 'cancelled' });
  });

  // POST /api/orders/:orderId/retry {order, delivery} — NEW id, supersedes tag
  router.post('/:orderId/retry', createLimiter, async (req: Request, res: Response) => {
    const oldId = String(req.params.orderId || '');
    if (!ORDER_ID_RE.test(oldId)) { sendError(res, 404, 'NOT_FOUND'); return; }
    const now = nowSec();
    let sub: Submission;
    try {
      const oldRow = loadOrderRow(db, oldId);
      const order = req.body?.order;
      if (!isEventShaped(order)) throw new RouteError(400, 'INVALID_EVENT');
      if (oldRow && (oldRow.payment_state === 'paid' || oldRow.payment_state === 'amount_mismatch')) {
        throw new RouteError(409, 'NOT_RETRYABLE');
      }
      // B_old: from our mirror when we have the old order; otherwise (mirror
      // gap) from the supersedes tag itself, which must still satisfy the
      // §1 prefix rule against D_old. The NEW order's key is never B_old.
      let oldBuyer = oldRow?.buyer_pubkey || '';
      if (!oldBuyer) {
        const m = /^36520:([0-9a-f]{64}):(.+)$/.exec(tagValues(order, 'supersedes')[0] || '');
        if (!m || m[2] !== oldId || !orderIdMatchesPubkey(oldId, m[1])) throw new RouteError(400, 'INVALID_EVENT', 'supersedes');
        oldBuyer = m[1];
      }
      sub = validateSubmission(db, req.body, now, `36520:${oldBuyer}:${oldId}`);
      if (sub.parsed.orderId === oldId) throw new RouteError(400, 'INVALID_EVENT', 'order_id');
    } catch (err) {
      if (err instanceof RouteError) { sendError(res, err.status, err.code, err.reason, lineExtra(err)); return; }
      console.error('[orders] retry failed:', (err as Error).message);
      sendError(res, 500, 'ORDER_FAILED');
      return;
    }
    if (!brokerBase()) { sendError(res, 503, 'ORDERING_UNAVAILABLE'); return; }
    await forwardCreate(db, res, `/api/shop-orders/${encodeURIComponent(oldId)}/retry-payment`, sub, now);
  });

  return router;
}
