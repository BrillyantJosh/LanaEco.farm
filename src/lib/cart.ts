/**
 * Shopping cart — pure state functions + localStorage (de)serialisation.
 *
 * The cart holds products of any number of shops. ONE checkout = ONE shop =
 * one KIND 36520 = one payment (the order's `a`/`p`, the encrypted 36522,
 * shipping and currency all name one shop), so lines are grouped by shop key
 * `<owner hex>:<unit id>` — the same key as server/lib/onlineShop.ts unitKey.
 *
 * MONEY: nothing here is a price anyone pays. `display` is a copy of what the
 * tile showed, for drawing the cart while the server quote loads; it is never
 * sent anywhere. toQuoteLines() sends only {pubkey, listingId, qty} — the
 * server prices every line from the merchant-signed listing.
 *
 * Quantities are whole numbers in the listing's sale unit (kos, kg, piece):
 * the listing format has no step tag, and the order route takes integers.
 */

export const CART_STORAGE_KEY = 'lana_shop_cart_v1';
/** Different products in one shop's part of the cart (= one order, SPEC v1.1.0). */
export const MAX_LINES_PER_SHOP = 30;
export const MAX_LINES_TOTAL = 60;
/** Same upper bound as the server quote (server/lib/onlineShop.ts MAX_LINE_QTY). */
export const MAX_LINE_QTY = 10_000;
/** Lines older than this are dropped on load (prices and stock move). */
export const LINE_TTL_SEC = 30 * 24 * 3600;

const HEX64_RE = /^[0-9a-f]{64}$/;

/** What the tile showed — for drawing only, never a price that is paid or sent. */
export interface CartDisplay {
  title: string;
  image: string;
  price: string;
  currency: string;
  /** sale unit (kos, kg, piece …) */
  unit: string;
  /** shop name */
  unitName: string;
  minOrder: number | null;
  maxOrder: number | null;
  availableQty: number | null;
}

export interface CartLine {
  pubkey: string;
  listingId: string;
  /** '<owner hex>:<unit id>' */
  unitKey: string;
  unitId: string;
  qty: number;
  /** unix seconds */
  addedAt: number;
  display: CartDisplay;
}

export interface CartState {
  v: 1;
  lines: CartLine[];
}

export interface CartLineInput {
  pubkey: string;
  listingId: string;
  unitId: string;
  qty: number;
  display: CartDisplay;
}

export type AddRefusal = 'invalid' | 'max_reached' | 'too_many_lines';

export interface AddResult {
  state: CartState;
  /** how many were really added (0 when refused) */
  added: number;
  /** the line's quantity afterwards */
  qty: number;
  /** set when the request was cut down to the line's maximum */
  clampedTo: number | null;
  refused?: AddRefusal;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function emptyCart(): CartState {
  return { v: 1, lines: [] };
}

export function lineKey(l: { pubkey: string; listingId: string }): string {
  return `${l.pubkey}:${l.listingId}`;
}

export function shopKey(pubkey: string, unitId: string): string {
  return `${String(pubkey || '').toLowerCase()}:${unitId || ''}`;
}

function wholeOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  const s = String(v ?? '').trim();
  return /^\d{1,6}$/.test(s) ? parseInt(s, 10) : null;
}

/**
 * The quantity range a line accepts: [max(1, min_order), min(max_order,
 * stock left, 10 000)]. max < min means the product cannot be ordered now.
 */
export function qtyBounds(d: Pick<CartDisplay, 'minOrder' | 'maxOrder' | 'availableQty'>): { min: number; max: number } {
  const min = Math.max(1, d.minOrder ?? 1);
  let max = MAX_LINE_QTY;
  if (d.maxOrder !== null && d.maxOrder !== undefined && d.maxOrder > 0) max = Math.min(max, d.maxOrder);
  if (d.availableQty !== null && d.availableQty !== undefined) max = Math.min(max, d.availableQty);
  return { min, max };
}

/**
 * Which limit stops a line at qtyBounds().max: 'stock' when it is what is
 * left in stock, 'order' when it is the merchant's max_order (or the cart's
 * own per-line cap) — "no more in stock" is wrong for a product capped per
 * order while 50 are on the shelf.
 */
export function limitKind(d: Pick<CartDisplay, 'maxOrder' | 'availableQty'>): 'stock' | 'order' {
  const stock = d.availableQty !== null && d.availableQty !== undefined ? d.availableQty : null;
  const perOrder = d.maxOrder !== null && d.maxOrder !== undefined && d.maxOrder > 0 ? Math.min(d.maxOrder, MAX_LINE_QTY) : MAX_LINE_QTY;
  return stock !== null && stock < perOrder ? 'stock' : 'order';
}

function cleanDisplay(d: Partial<CartDisplay> | null | undefined): CartDisplay {
  const str = (v: unknown, max = 300) => String(v ?? '').slice(0, max);
  return {
    title: str(d?.title),
    image: str(d?.image, 2000),
    price: str(d?.price, 32),
    currency: str(d?.currency, 8),
    unit: str(d?.unit, 32),
    unitName: str(d?.unitName),
    minOrder: wholeOrNull(d?.minOrder),
    maxOrder: wholeOrNull(d?.maxOrder),
    availableQty: wholeOrNull(d?.availableQty),
  };
}

function validIdentity(pubkey: unknown, listingId: unknown, unitId: unknown): boolean {
  return typeof pubkey === 'string' && HEX64_RE.test(pubkey)
    && typeof listingId === 'string' && listingId.length > 0 && listingId.length <= 200
    && typeof unitId === 'string' && unitId.length > 0 && unitId.length <= 64;
}

/**
 * Add `qty` of a product: merged with its existing line (one line per
 * product), the result clamped to the line's range. A new product needs at
 * least its minimum, and room in its shop (30) and in the cart (60).
 */
export function addLine(state: CartState, input: CartLineInput, now = nowSec()): AddResult {
  const pubkey = String(input.pubkey || '').toLowerCase();
  if (!validIdentity(pubkey, input.listingId, input.unitId) || !Number.isInteger(input.qty) || input.qty < 1) {
    return { state, added: 0, qty: 0, clampedTo: null, refused: 'invalid' };
  }
  const display = cleanDisplay(input.display);
  const key = lineKey({ pubkey, listingId: input.listingId });
  const idx = state.lines.findIndex(l => lineKey(l) === key);
  const existing = idx >= 0 ? state.lines[idx] : null;
  const { min, max } = qtyBounds(display);
  const current = existing?.qty ?? 0;
  if (max < min || current >= max) {
    return { state, added: 0, qty: current, clampedTo: null, refused: 'max_reached' };
  }
  const wanted = Math.max(current + input.qty, min);
  const next = Math.min(wanted, max);
  const clampedTo = next < wanted ? next : null;

  if (existing) {
    const lines = state.lines.slice();
    lines[idx] = { ...existing, qty: next, display };
    return { state: { v: 1, lines }, added: next - current, qty: next, clampedTo };
  }
  const sk = shopKey(pubkey, input.unitId);
  const sameShop = state.lines.filter(l => l.unitKey === sk).length;
  if (sameShop >= MAX_LINES_PER_SHOP || state.lines.length >= MAX_LINES_TOTAL) {
    return { state, added: 0, qty: 0, clampedTo: null, refused: 'too_many_lines' };
  }
  const line: CartLine = { pubkey, listingId: input.listingId, unitKey: sk, unitId: input.unitId, qty: next, addedAt: now, display };
  return { state: { v: 1, lines: [...state.lines, line] }, added: next, qty: next, clampedTo };
}

/** Set a line's quantity, clamped to its range (never below 1). */
export function setQty(state: CartState, key: string, qty: number): CartState {
  if (!Number.isFinite(qty)) return state;
  let changed = false;
  const lines = state.lines.map(l => {
    if (lineKey(l) !== key) return l;
    const { min, max } = qtyBounds(l.display);
    let q = Math.trunc(qty);
    // Orderable: keep inside [min, max]. Not orderable right now (max < min,
    // e.g. sold out): only ever lower it — the cart page offers removal.
    q = max >= min ? Math.min(Math.max(q, min), max) : Math.min(q, l.qty);
    q = Math.max(1, q);
    if (q === l.qty) return l;
    changed = true;
    return { ...l, qty: q };
  });
  return changed ? { v: 1, lines } : state;
}

/** Correct what the cart knows about a line's limits (from a server answer). */
export function updateLimits(state: CartState, key: string, limits: Partial<Pick<CartDisplay, 'availableQty' | 'maxOrder' | 'minOrder'>>): CartState {
  let changed = false;
  const lines = state.lines.map(l => {
    if (lineKey(l) !== key) return l;
    changed = true;
    return { ...l, display: cleanDisplay({ ...l.display, ...limits }) };
  });
  return changed ? { v: 1, lines } : state;
}

export function removeLine(state: CartState, key: string): CartState {
  return removeLines(state, [key]);
}

export function removeLines(state: CartState, keys: string[]): CartState {
  const drop = new Set(keys);
  const lines = state.lines.filter(l => !drop.has(lineKey(l)));
  return lines.length === state.lines.length ? state : { v: 1, lines };
}

export interface ShopGroup {
  unitKey: string;
  ownerHex: string;
  unitId: string;
  unitName: string;
  currency: string;
  lines: CartLine[];
}

/** One group per shop, shops and lines in the order they were first added. */
export function groupByShop(state: CartState): ShopGroup[] {
  const map = new Map<string, ShopGroup>();
  for (const l of state.lines) {
    let g = map.get(l.unitKey);
    if (!g) {
      g = { unitKey: l.unitKey, ownerHex: l.pubkey, unitId: l.unitId, unitName: l.display.unitName, currency: l.display.currency, lines: [] };
      map.set(l.unitKey, g);
    }
    g.lines.push(l);
  }
  return Array.from(map.values());
}

/** The ONLY thing the cart ever sends: which product, how many. Never a price. */
export function toQuoteLines(lines: CartLine[]): Array<{ pubkey: string; listingId: string; qty: number }> {
  return lines.map(l => ({ pubkey: l.pubkey, listingId: l.listingId, qty: l.qty }));
}

export function quantityInCart(state: CartState, key: string): number {
  return state.lines.find(l => lineKey(l) === key)?.qty ?? 0;
}

/**
 * Read a stored cart. Anything unreadable — broken JSON, another version, a
 * line with a bad key or quantity — is dropped rather than trusted; lines
 * older than 30 days go too.
 */
export function parseCart(raw: string | null | undefined, now = nowSec()): CartState {
  if (!raw) return emptyCart();
  let data: any;
  try { data = JSON.parse(raw); } catch { return emptyCart(); }
  if (!data || data.v !== 1 || !Array.isArray(data.lines)) return emptyCart();
  let state = emptyCart();
  for (const l of data.lines.slice(0, MAX_LINES_TOTAL)) {
    if (!l || typeof l !== 'object') continue;
    if (!validIdentity(l.pubkey, l.listingId, l.unitId)) continue;
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_LINE_QTY) continue;
    const addedAt = Number.isInteger(l.addedAt) ? l.addedAt : 0;
    if (now - addedAt > LINE_TTL_SEC) continue;
    const key = lineKey(l);
    if (state.lines.some(x => lineKey(x) === key)) continue;
    const sk = shopKey(l.pubkey, l.unitId);
    if (state.lines.filter(x => x.unitKey === sk).length >= MAX_LINES_PER_SHOP) continue;
    state = { v: 1, lines: [...state.lines, { pubkey: l.pubkey, listingId: l.listingId, unitKey: sk, unitId: l.unitId, qty: l.qty, addedAt, display: cleanDisplay(l.display) }] };
  }
  return state;
}

export function serializeCart(state: CartState): string {
  return JSON.stringify({ v: 1, lines: state.lines });
}

/** Integer-cents product of a 2-decimal price string and a whole quantity, as '12.34'; '' when unreadable. */
export function lineTotal(unitPrice: string, qty: number): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(unitPrice ?? '').trim());
  if (!m || !Number.isInteger(qty) || qty < 0) return '';
  const cents = (Number(m[1]) * 100 + Number(((m[2] || '') + '00').slice(0, 2))) * qty;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Σ unitPrice × qty in integer cents, as '12.34'; '' when any line is unreadable. */
export function sumLines(items: Array<{ unitPrice: string; qty: number }>): string {
  let cents = 0;
  for (const it of items) {
    const t = lineTotal(it.unitPrice, it.qty);
    if (!t) return '';
    const [w, f] = t.split('.');
    cents += Number(w) * 100 + Number(f);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
