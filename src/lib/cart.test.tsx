import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addLine, emptyCart, groupByShop, lineKey, lineTotal, parseCart, qtyBounds, removeLines, serializeCart, setQty,
  sumLines, toQuoteLines, updateLimits, CART_STORAGE_KEY, LINE_TTL_SEC, MAX_LINES_PER_SHOP, MAX_LINES_TOTAL,
  type CartDisplay, type CartLineInput,
  limitKind,
} from './cart';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cartStore, useCart } from '@/contexts/CartContext';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const UNIT_A = '1'.repeat(32);
const UNIT_B = '2'.repeat(32);
const NOW = 1_800_000_000;

function display(over: Partial<CartDisplay> = {}): CartDisplay {
  return { title: 'Jabolka', image: '', price: '4.50', currency: 'EUR', unit: 'kg', unitName: 'Živa', minOrder: null, maxOrder: null, availableQty: null, ...over };
}
function input(over: Partial<CartLineInput> = {}, d: Partial<CartDisplay> = {}): CartLineInput {
  return { pubkey: A, listingId: 'lst1', unitId: UNIT_A, qty: 1, display: display(d), ...over };
}

describe('cart reducer', () => {
  it('adds a product once and merges a second add into its quantity', () => {
    let r = addLine(emptyCart(), input(), NOW);
    expect(r).toMatchObject({ added: 1, qty: 1, clampedTo: null });
    r = addLine(r.state, input({ qty: 2 }), NOW);
    expect(r.state.lines).toHaveLength(1);
    expect(r.state.lines[0]).toMatchObject({ qty: 3, unitKey: `${A}:${UNIT_A}`, addedAt: NOW });
    expect(r.added).toBe(2);
  });
  it('a new product starts at its min_order; quantities never pass max_order or the stock left', () => {
    let r = addLine(emptyCart(), input({}, { minOrder: 2, maxOrder: 5, availableQty: 4 }), NOW);
    expect(r.qty).toBe(2); // 1 asked, minimum 2
    r = addLine(r.state, input({ qty: 10 }, { minOrder: 2, maxOrder: 5, availableQty: 4 }), NOW);
    expect(r).toMatchObject({ qty: 4, clampedTo: 4, added: 2 });
    r = addLine(r.state, input({}, { minOrder: 2, maxOrder: 5, availableQty: 4 }), NOW);
    expect(r).toMatchObject({ refused: 'max_reached', added: 0, qty: 4 });
    expect(addLine(emptyCart(), input({}, { availableQty: 0 }), NOW).refused).toBe('max_reached');
    expect(qtyBounds(display({ minOrder: 0, maxOrder: null, availableQty: null }))).toEqual({ min: 1, max: 10_000 });
  });
  it('refuses broken identities and quantities', () => {
    expect(addLine(emptyCart(), input({ pubkey: 'nothex' }), NOW).refused).toBe('invalid');
    expect(addLine(emptyCart(), input({ listingId: '' }), NOW).refused).toBe('invalid');
    expect(addLine(emptyCart(), input({ qty: 1.5 }), NOW).refused).toBe('invalid');
    expect(addLine(emptyCart(), input({ qty: 0 }), NOW).refused).toBe('invalid');
  });
  it('at most 30 different products per shop and 60 in the cart', () => {
    let s = emptyCart();
    for (let i = 0; i < MAX_LINES_PER_SHOP; i++) s = addLine(s, input({ listingId: `a${i}` }), NOW).state;
    expect(addLine(s, input({ listingId: 'one-more' }), NOW).refused).toBe('too_many_lines');
    // another shop still has room…
    for (let i = 0; i < MAX_LINES_TOTAL - MAX_LINES_PER_SHOP; i++) s = addLine(s, input({ pubkey: B, unitId: UNIT_B, listingId: `b${i}` }), NOW).state;
    expect(s.lines).toHaveLength(MAX_LINES_TOTAL);
    // …until the whole cart is full
    expect(addLine(s, input({ pubkey: 'c'.repeat(64), unitId: UNIT_B, listingId: 'c' }), NOW).refused).toBe('too_many_lines');
  });
  it('setQty clamps to the line range; removeLines drops only the given lines', () => {
    let s = addLine(emptyCart(), input({}, { minOrder: 2, maxOrder: 6 }), NOW).state;
    s = addLine(s, input({ listingId: 'lst2' }), NOW).state;
    const k1 = lineKey({ pubkey: A, listingId: 'lst1' });
    expect(setQty(s, k1, 99).lines[0].qty).toBe(6);
    expect(setQty(s, k1, 1).lines[0].qty).toBe(2);
    expect(setQty(s, k1, 2)).toBe(s); // unchanged → same object
    const sold = updateLimits(s, k1, { availableQty: 0 });
    expect(setQty(sold, k1, 5).lines[0].qty).toBe(2); // not orderable now: never raised
    const left = removeLines(s, [k1]);
    expect(left.lines.map(l => l.listingId)).toEqual(['lst2']);
  });
  it('groups by shop (owner + unit id), in the order shops were added', () => {
    let s = emptyCart();
    s = addLine(s, input({ pubkey: B, unitId: UNIT_B, listingId: 'x' }, { unitName: 'Rastoča jablana' }), NOW).state;
    s = addLine(s, input({ listingId: 'y' }), NOW).state;
    s = addLine(s, input({ pubkey: B, unitId: UNIT_B, listingId: 'z' }), NOW).state;
    // same owner, other unit = another shop
    s = addLine(s, input({ unitId: UNIT_B, listingId: 'w' }), NOW).state;
    const g = groupByShop(s);
    expect(g.map(x => [x.unitKey, x.lines.map(l => l.listingId)])).toEqual([
      [`${B}:${UNIT_B}`, ['x', 'z']],
      [`${A}:${UNIT_A}`, ['y']],
      [`${A}:${UNIT_B}`, ['w']],
    ]);
    expect(g[0].unitName).toBe('Rastoča jablana');
  });
  it('toQuoteLines sends which product and how many — never a price, even a tampered one', () => {
    const s = addLine(emptyCart(), input({ qty: 3 }, { price: '0.01' }), NOW).state;
    const q = toQuoteLines(s.lines);
    expect(q).toEqual([{ pubkey: A, listingId: 'lst1', qty: 3 }]);
    expect(JSON.stringify(q)).not.toContain('0.01');
  });
  it('money helpers work in integer cents: 4.50 × 3 + 3.98 × 2 = 21.46', () => {
    expect(lineTotal('4.50', 3)).toBe('13.50');
    expect(lineTotal('3.98', 2)).toBe('7.96');
    expect(lineTotal('0.10', 3)).toBe('0.30'); // 0.1 × 3 is not 0.30000000000000004 here
    expect(sumLines([{ unitPrice: '4.50', qty: 3 }, { unitPrice: '3.98', qty: 2 }])).toBe('21.46');
    expect(lineTotal('abc', 1)).toBe('');
    expect(sumLines([{ unitPrice: '1,00', qty: 1 }])).toBe('');
  });
});

describe('cart persistence', () => {
  it('round-trips through localStorage JSON', () => {
    const s = addLine(emptyCart(), input({ qty: 2 }), NOW).state;
    expect(parseCart(serializeCart(s), NOW)).toEqual(s);
  });
  it('broken JSON, another version or a non-array is an empty cart', () => {
    expect(parseCart('{', NOW).lines).toEqual([]);
    expect(parseCart(JSON.stringify({ v: 2, lines: [] }), NOW).lines).toEqual([]);
    expect(parseCart(JSON.stringify({ v: 1, lines: 'x' }), NOW).lines).toEqual([]);
    expect(parseCart(null, NOW).lines).toEqual([]);
  });
  it('drops bad lines, duplicates and lines older than 30 days; keeps the good ones', () => {
    const good = { pubkey: A, listingId: 'ok', unitId: UNIT_A, qty: 2, addedAt: NOW - 10, display: display() };
    const raw = JSON.stringify({ v: 1, lines: [
      good,
      { ...good }, // duplicate
      { ...good, listingId: 'old', addedAt: NOW - LINE_TTL_SEC - 1 },
      { ...good, listingId: 'bad-qty', qty: 0 },
      { ...good, listingId: 'frac', qty: 1.5 },
      { ...good, listingId: 'huge', qty: 10_001 },
      { ...good, listingId: 'bad-key', pubkey: 'XYZ' },
      { ...good, listingId: 'x'.repeat(201) },
      null,
    ] });
    const s = parseCart(raw, NOW);
    expect(s.lines.map(l => l.listingId)).toEqual(['ok']);
    expect(s.lines[0].unitKey).toBe(`${A}:${UNIT_A}`); // recomputed, not trusted
  });
});

describe('cart store (useCart)', () => {
  beforeEach(() => { window.localStorage.removeItem(CART_STORAGE_KEY); cartStore.resetForTests(); });
  afterEach(() => { window.localStorage.removeItem(CART_STORAGE_KEY); cartStore.resetForTests(); });

  it('writes every change to localStorage and reads it back after a reload', () => {
    cartStore.add(input({ qty: 2 }));
    const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || '{}');
    expect(stored.lines[0]).toMatchObject({ pubkey: A, listingId: 'lst1', qty: 2 });
    cartStore.resetForTests(); // "reload"
    expect(cartStore.get().lines[0].qty).toBe(2);
  });
  it('keeps working in memory when storage throws (private window, blocked site data)', () => {
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      const r = cartStore.add(input());
      expect(r.added).toBe(1);
      expect(cartStore.get().lines).toHaveLength(1);
    } finally {
      window.localStorage.setItem = orig;
    }
  });
  it('follows another tab through the storage event', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    function Count() { return <span id="n">{useCart().count}</span>; }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<Count />); });
    expect(el.textContent).toBe('0');
    const other = addLine(emptyCart(), input({ listingId: 'from-other-tab', qty: 4 }), Math.floor(Date.now() / 1000)).state;
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: CART_STORAGE_KEY, newValue: serializeCart(other) }));
    });
    expect(el.textContent).toBe('1');
    expect(cartStore.get().lines.map(l => [l.listingId, l.qty])).toEqual([['from-other-tab', 4]]);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '{}' }));
    });
    expect(el.textContent).toBe('1');
    act(() => root.unmount());
    el.remove();
  });
});

describe('limitKind — which limit stops a line', () => {
  it('stock when stock is lower than the per-order cap, else the per-order cap', () => {
    expect(limitKind({ maxOrder: null, availableQty: 2 })).toBe('stock');
    expect(limitKind({ maxOrder: 3, availableQty: 50 })).toBe('order');
    expect(limitKind({ maxOrder: 5, availableQty: 5 })).toBe('order');
    expect(limitKind({ maxOrder: 5, availableQty: 4 })).toBe('stock');
    expect(limitKind({ maxOrder: null, availableQty: null })).toBe('order');
  });
});
