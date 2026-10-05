// @vitest-environment node
/**
 * Round 5 (5 Oct 2026), F3/F4: the merchant's terms under which ONE 36520
 * event was right to the cent (order_terms_seen) keep an honest order
 * payable when the shop raises a price or the fee, drops free shipping or
 * turns pickup off BEFORE the mirror sees the 30933. Today's terms are tried
 * first; the seen ones only on amount_mismatch, never for an older-rules
 * 'paid'. A buyer's replacement that never matched the merchant's terms has
 * no such row. And order_settle_review lists every order whose verified
 * 30933 pays the order's own total but whose verdict is amount_mismatch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { initLiveSyncDb, ingestEvent } from './liveSync.js';
import {
  recomputeOrder, rejudgeLegacyPaidOrders, confirmSettleReview, listSettleReview, settleReviewView, termsPriceOrder,
  SETTLE_REVIEW_MIN_AGE_SEC,
} from './orderJoin.js';
import { bindingString, type ResolverOrder, type ResolverUnit } from './orderResolver.js';
import { initializeSchema } from '../db/schema.js';
import { parseConfirmArgs } from '../scripts/settle-review.js';
import {
  key, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, orderEvent, purchaseEvent,
  orderIdFor, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let owner: Key, brain: Key, buyer: Key, processor: Key;
let orderId: string;
let itemA: string;
const now = () => Math.floor(Date.now() / 1000);

const row = (id: string): any => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
const view = (id: string) => {
  const r = row(id);
  return { st: r.payment_state, exp: r.expected_total, pinned: r.settled_order_event_id === r.order_event_id && !!r.settled_tx_id };
};
const seen = (eventId: string): any => db.prepare('SELECT * FROM order_terms_seen WHERE order_event_id = ?').get(eventId);
const review = (id: string): any => db.prepare('SELECT * FROM order_settle_review WHERE order_id = ?').get(id);
const pay = (b: Key, id: string, amount: string, o: Partial<Parameters<typeof purchaseEvent>[1]> = {}) =>
  ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount, ...o }));

/** A shop of its own: 30901 + the registrar's 30903 + one listing (lst-apples) at 5.00. */
function shop(unitOpts: Parameters<typeof unitEvent>[1] = {}) {
  const o = key(), b = key();
  ingestEvent(unitEvent(o, { created_at: now() - 100, ...unitOpts }));
  ingestEvent(suspensionEvent(processor, o));
  ingestEvent(listingEvent(o, { price: '5.00', stock: '100', created_at: 1000 }));
  return { o, b, id: orderIdFor(b), a: `${LISTING_KIND}:${o.pk}:${LISTING_ID}` };
}

beforeEach(() => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); brain = key(); buyer = key(); processor = key();
  seed38888(db, [brain.pk, processor.pk]);
  ingestEvent(unitEvent(owner, { fee: '2.50', created_at: now() - 100 }));
  ingestEvent(suspensionEvent(processor, owner));
  ingestEvent(listingEvent(owner, { price: '5.00', stock: '100', created_at: 1000 }));
  orderId = orderIdFor(buyer);
  itemA = `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`;
  // E1 = 2 × 5.00 + 2.50 shipping = 12.50, as the order route takes it
  ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, created_at: now() - 60 }));
});

describe('F3/F4 — an honest order stays payable when the shop changes its terms before the 30933 is seen', () => {
  it('the terms an order was right under are kept for its event, and only then', () => {
    expect(seen(row(orderId).order_event_id)).toMatchObject({ shipping_fee: '2.50', free_from: null, pickup: 0, total: '12.50' });
    expect(JSON.parse(seen(row(orderId).order_event_id).prices_json)).toEqual({ [itemA]: '5.00' });
    expect(row(orderId).payment_state).toBe('unpaid');
  });

  it('W5: pickup turned off before the 30933 — still paid', () => {
    const s = shop({ fee: '2.50', pickup: true });
    ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: s.a, shipping: '0.00', total: '10.00', fulfillment: 'pickup', created_at: now() - 60 }));
    ingestEvent(unitEvent(s.o, { fee: '2.50', pickup: false, created_at: now() }));
    expect(row(s.id).expected_total).toBe(''); // today a pickup order of this shop cannot be computed
    pay(s.b, s.id, '10.00');
    expect(view(s.id)).toMatchObject({ st: 'paid', exp: '10.00', pinned: true });
    expect(recomputeOrder(db, s.id)!.pending).toBe(true);
    expect(listSettleReview(db)).toEqual([]);
    expect(seen(row(s.id).order_event_id)).toMatchObject({ pickup: 1, shipping_fee: '2.50', total: '10.00' });
  });

  it('W6: a price raised, the fee raised, or free shipping removed before the 30933 — still paid', () => {
    for (const change of ['price', 'fee', 'free_from'] as const) {
      const free = change === 'free_from';
      const s = shop({ fee: '2.50', ...(free ? { freeFrom: '10.00' } : {}) });
      const total = free ? '10.00' : '12.50';
      ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: s.a, shipping: free ? '0.00' : '2.50', total, created_at: now() - 60 }));
      if (change === 'price') ingestEvent(listingEvent(s.o, { price: '6.00', stock: '100', created_at: now() }));
      if (change === 'fee') ingestEvent(unitEvent(s.o, { fee: '3.00', created_at: now() }));
      if (change === 'free_from') ingestEvent(unitEvent(s.o, { fee: '2.50', created_at: now() }));
      expect(row(s.id).expected_total, change).not.toBe(total);
      pay(s.b, s.id, total);
      expect(view(s.id), change).toMatchObject({ st: 'paid', exp: total, pinned: true });
      expect(seen(row(s.id).order_event_id), change).toMatchObject({ shipping_fee: '2.50', free_from: free ? '10.00' : null, total });
      // pinned: the next touch keeps it paid
      ingestEvent(listingEvent(s.o, { price: '7.00', stock: '100', created_at: now() + 5 }));
      expect(view(s.id), change).toMatchObject({ st: 'paid', exp: total, pinned: true });
    }
    expect(listSettleReview(db)).toEqual([]);
  });

  it('a replacement that never matched the merchant\'s terms gets no row and is never paid', () => {
    const e1 = row(orderId).order_event_id;
    // E2 straight to the relays: the apples at the buyer's 1.00, same total
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, qty: '10', unitPrice: '1.00', total: '12.50', created_at: now() }));
    const e2 = row(orderId).order_event_id;
    expect(e2).not.toBe(e1);
    pay(buyer, orderId, '12.50');
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '52.50', pinned: false });
    expect(seen(e2)).toBeUndefined();
    expect(seen(e1)).toBeTruthy(); // E1's terms are E1's, not the order id's
    ingestEvent(unitEvent(owner, { fee: '3.00', created_at: now() + 1 }));
    ingestEvent(unitEvent(owner, { fee: '2.50', created_at: now() + 2 }));
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', pinned: false });
    expect(seen(e2)).toBeUndefined();
  });

  it('ON CONFLICT DO NOTHING: the first terms seen for an event stay, whatever matches later', () => {
    const e1 = row(orderId).order_event_id;
    const first = seen(e1);
    // other terms that give E1 the same numbers: pickup offered, free shipping from 100.00
    const later = unitEvent(owner, { fee: '2.50', pickup: true, freeFrom: '100.00', created_at: now() + 5 });
    ingestEvent(later);
    recomputeOrder(db, orderId, now() + 100);
    expect(seen(e1)).toEqual(first);
    expect(seen(e1)).toMatchObject({ pickup: 0, free_from: null });
    expect(seen(e1).unit_event_id).not.toBe(later.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_terms_seen').get()).toEqual({ n: 1 });
  });

  it('order_listing_prices is no longer read or written', () => {
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '100', created_at: now() }));
    pay(buyer, orderId, '12.50');
    expect(row(orderId).payment_state).toBe('paid');
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_listing_prices').get()).toEqual({ n: 0 });
    // a price stored there by round 4 prices nothing
    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, unitPrice: '6.00', total: '14.50' }));
    db.prepare("INSERT INTO order_listing_prices (order_event_id, item_a, price, listing_created_at, seen_at) VALUES (?, ?, '1.00', 1, 1)").run(row(id).order_event_id, itemA);
    pay(b, id, '4.50');
    expect(row(id).payment_state).toBe('amount_mismatch');
  });

  it('termsPriceOrder: total, shipping, every line price and one currency', () => {
    const unit: ResolverUnit = { ownerHex: 'o'.repeat(64), staffHexes: [], currency: 'EUR', shippingFee: '2.50', freeShippingFrom: '20.00', pickup: false };
    const o = (over: Partial<ResolverOrder> = {}): ResolverOrder => ({
      d: 'x', pubkey: 'p', createdAt: 1, unitId: 'u', status: 'placed', fulfillment: 'shipping', payBy: 2,
      items: [{ a: 'A', qty: 2, unitPrice: '5.00', currency: 'EUR' }, { a: 'B', qty: 1, unitPrice: '3.00', currency: 'EUR' }],
      shipping: '2.50', total: '15.50', currency: 'EUR', ...over,
    });
    expect(termsPriceOrder(o(), unit, ['5.00', '3.00'])).toBe(true);
    expect(termsPriceOrder(o(), unit, ['5.00', null])).toBe(false);
    expect(termsPriceOrder(o(), unit, ['5.00'])).toBe(false);
    expect(termsPriceOrder(o({ total: '15.51' }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o({ shipping: '0.00' }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o({ shipping: undefined }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o(), unit, ['4.00', '4.00'])).toBe(false); // same subtotal, other line prices
    expect(termsPriceOrder(o({ currency: 'HUF' }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o(), { ...unit, currency: '' }, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o({ items: [{ a: 'A', qty: 2, unitPrice: '5.00', currency: 'GBP' }, { a: 'B', qty: 1, unitPrice: '3.00', currency: 'EUR' }] }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o({ fulfillment: 'pickup', shipping: '0.00', total: '13.00' }), unit, ['5.00', '3.00'])).toBe(false);
    expect(termsPriceOrder(o({ fulfillment: 'pickup', shipping: '0.00', total: '13.00' }), { ...unit, pickup: true }, ['5.00', '3.00'])).toBe(true);
    expect(termsPriceOrder(o({ items: [{ a: 'A', qty: 4, unitPrice: '5.00', currency: 'EUR' }], shipping: '0.00', total: '20.00' }), unit, ['5.00'])).toBe(true);
  });

  /**
   * The buyer can already publish a replacement at the moment he chooses —
   * after paying, during the merchant's sale — and it is paid (step 5 at
   * today's terms) and pinned. The terms seen for an event give him nothing
   * more: the same replacement, with the 30933 landing only after the sale
   * ended, ends in exactly the same verdict.
   */
  it('equivalence: a replacement during a sale ends the same whether the 30933 lands before or after the sale', () => {
    const run = (payFirst: boolean) => {
      const s = shop({ fee: '2.50' });
      ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: s.a, created_at: now() - 60 })); // E1: 12.50
      if (payFirst) pay(s.b, s.id, '12.50');
      ingestEvent(listingEvent(s.o, { price: '2.50', stock: '100', created_at: now() - 30 })); // the sale
      ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: s.a, qty: '4', unitPrice: '2.50', total: '12.50', created_at: now() - 20 })); // E2
      ingestEvent(listingEvent(s.o, { price: '5.00', stock: '100', created_at: now() - 10 })); // the sale ends
      if (!payFirst) pay(s.b, s.id, '12.50');
      const r = row(s.id);
      return { ...view(s.id), lines: JSON.parse(r.order_json).items.map((i: any) => [i.qty, i.unitPrice]), pending: recomputeOrder(db, s.id)!.pending, listed: !!review(s.id) };
    };
    const before = run(true);   // what the buyer can do today
    const after = run(false);   // what the seen terms allow
    expect(before).toEqual({ st: 'paid', exp: '12.50', pinned: true, lines: [[4, '2.50']], pending: true, listed: false });
    expect(after).toEqual(before);
  });
});

describe('a legacy (older-rules) \'paid\' never uses the terms seen for its event', () => {
  it('rejudge lists it step5_not_paid although those terms would pay it, and the entry keeps its reason', () => {
    const e1 = row(orderId).order_event_id;
    ingestEvent(unitEvent(owner, { fee: '3.00', created_at: now() }));
    pay(buyer, orderId, '12.50', { txId: 'tx-old' });
    expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true }); // this code: paid by E1's seen terms
    // what origin/main left: 'paid', no settled_* (the terms row stays — the worst case)
    for (const c of ['settled_tx_id', 'settled_amount', 'settled_order_event_id']) db.exec(`ALTER TABLE orders DROP COLUMN ${c}`);
    initializeSchema(db);
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', settled_tx_id: null });
    expect(seen(e1)).toMatchObject({ shipping_fee: '2.50', total: '12.50' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 1, paid: 0, listed: 1, notMirrored: 0 });
      expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '13.00', pinned: false });
      expect(review(orderId)).toMatchObject({ reason: 'step5_not_paid', old_paid_tx_id: 'tx-old', cleared_at: null });
      // later touches: still step 5 alone, still the legacy reason
      recomputeOrder(db, orderId, now() + 10);
      ingestEvent(listingEvent(owner, { price: '5.00', stock: '100', created_at: now() + 20 }));
      expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', pinned: false });
      expect(review(orderId)).toMatchObject({ reason: 'step5_not_paid', cleared_at: null });
      // Brilly confirms it against the broker: paid by the pin
      expect(confirmSettleReview(db, orderId, e1, e1)).toEqual({ ok: true, paymentState: 'paid', expected: '12.50' });
      expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('round 5 — order_settle_review lists every verified payment of the order\'s own total that step 5 does not pay', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  /** The mirror sees E only after the merchant repriced (the broker took it at 5.00): never right under terms it saw. */
  function stuckOrder() {
    const s = shop({ fee: '2.50' });
    ingestEvent(listingEvent(s.o, { price: '6.00', stock: '100', created_at: now() - 30 }));
    ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: s.a, created_at: now() - 60 }));
    pay(s.b, s.id, '12.50', { txId: `tx-${s.id.slice(-6)}` });
    return s;
  }

  it('terms_mismatch: listed with the candidate 30933, its listed_at kept, cleared once paid', () => {
    const s = stuckOrder();
    expect(view(s.id)).toMatchObject({ st: 'amount_mismatch', exp: '14.50' });
    const r1 = review(s.id);
    expect(r1).toMatchObject({ reason: 'terms_mismatch', verdict: 'amount_mismatch', expected_total: '14.50', old_paid_amount: '12.50', old_paid_tx_id: `tx-${s.id.slice(-6)}`, order_event_id: row(s.id).order_event_id, cleared_at: null });
    recomputeOrder(db, s.id, now() + 500);
    expect(review(s.id).listed_at).toBe(r1.listed_at);
    ingestEvent(listingEvent(s.o, { price: '5.00', stock: '100', created_at: now() }));
    expect(view(s.id)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    expect(review(s.id).cleared_at).toBeGreaterThan(0);
    expect(listSettleReview(db)).toEqual([]);
  });

  it('not_computable: a listing the mirror does not know; cleared when it lands and pays', () => {
    const b = key(), id = orderIdFor(b);
    const LATE = 'lst-late';
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: `${LISTING_KIND}:${owner.pk}:${LATE}`, unitPrice: '0.10', total: '2.70' }));
    pay(b, id, '2.70');
    expect(review(id)).toMatchObject({ reason: 'not_computable', expected_total: '', old_paid_amount: '2.70', cleared_at: null });
    ingestEvent(listingEvent(owner, { listingId: LATE, price: '0.10', stock: '10', created_at: 1000 }));
    expect(row(id).payment_state).toBe('paid');
    expect(review(id).cleared_at).toBeGreaterThan(0);
  });

  it('not listed when the order\'s own total is not what the 30933 pays', () => {
    pay(buyer, orderId, '12.50');
    expect(row(orderId).payment_state).toBe('paid');
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, saleUnit: 'crate', unitPrice: '500.00', total: '1002.50', created_at: now() + 5 }));
    expect(row(orderId).payment_state).toBe('amount_mismatch');
    expect(review(orderId)).toBeUndefined();
  });

  it('cleared when no candidate 30933 is left (the brain cancels the payment)', () => {
    const s = stuckOrder();
    expect(review(s.id).cleared_at).toBeNull();
    pay(s.b, s.id, '12.50', { txId: `tx-${s.id.slice(-6)}`, status: 'cancelled', receiptDescription: '', created_at: now() + 60 });
    expect(row(s.id).payment_state).toBe('unpaid');
    expect(review(s.id).cleared_at).toBeGreaterThan(0);
    expect(listSettleReview(db)).toEqual([]);
  });

  it('settle-review.ts: an entry younger than an hour is left out without --all; listing_kind_not_mirrored only with --all', () => {
    const s = stuckOrder();
    const listedAt = review(s.id).listed_at;
    expect(settleReviewView(db, listedAt + 10, false)).toEqual({ shown: [], hidden: 1 });
    expect(settleReviewView(db, listedAt + 10, true).shown.map(e => e.order_id)).toEqual([s.id]);
    expect(settleReviewView(db, listedAt + SETTLE_REVIEW_MIN_AGE_SEC, false).shown.map(e => [e.order_id, e.reason])).toEqual([[s.id, 'terms_mismatch']]);
    db.prepare(`INSERT INTO order_settle_review (order_id, order_event_id, old_paid_tx_id, old_paid_amount, verdict, expected_total, reason, listed_at)
                VALUES ('other', 'ev', 'tx', '1.00', 'amount_mismatch', '', 'listing_kind_not_mirrored', 1)`).run();
    expect(settleReviewView(db, listedAt + SETTLE_REVIEW_MIN_AGE_SEC, false)).toMatchObject({ hidden: 1 });
    expect(settleReviewView(db, listedAt + SETTLE_REVIEW_MIN_AGE_SEC, true).shown.map(e => e.reason).sort()).toEqual(['listing_kind_not_mirrored', 'terms_mismatch']);
  });

  it('a shop that leaves the mirror for a moment lists its paid order only briefly (hidden, then cleared)', () => {
    pay(buyer, orderId, '12.50');
    const unit = db.prepare('SELECT raw_event FROM business_units WHERE unit_id = ?').get(UNIT_ID) as { raw_event: string };
    db.prepare('DELETE FROM business_units WHERE unit_id = ?').run(UNIT_ID);
    const t = now();
    recomputeOrder(db, orderId, t);
    expect(review(orderId)).toMatchObject({ reason: 'not_computable', cleared_at: null });
    expect(settleReviewView(db, t + 60, false).shown).toEqual([]);
    ingestEvent(JSON.parse(unit.raw_event));
    expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true });
    expect(review(orderId).cleared_at).toBeGreaterThan(0);
  });

  it('confirm needs the event the broker took', () => {
    const s = stuckOrder();
    const ev = row(s.id).order_event_id;
    const before = row(s.id);
    for (const taken of ['f'.repeat(64), '']) {
      expect(confirmSettleReview(db, s.id, ev, taken)).toEqual({ ok: false, reason: 'not_taken_event' });
      expect(row(s.id)).toEqual(before);
    }
    expect(confirmSettleReview(db, s.id, ev, ev)).toEqual({ ok: true, paymentState: 'paid', expected: '12.50' });
    expect(view(s.id)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    expect(review(s.id).confirmed_at).toBeGreaterThan(0);
  });

  it('confirm needs the order\'s own total to be the paid amount (an older \'paid\' of a buyer-made total)', () => {
    // the older rules paid this order: 12.50 at the listing price, while its own total is the buyer's 1002.50
    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, unitPrice: '500.00', total: '1002.50' }));
    pay(b, id, '12.50', { txId: 'tx-d' });
    db.prepare(`UPDATE orders SET payment_state = 'paid', effective_status = 'paid', paid_tx_id = 'tx-d', paid_amount = '12.50',
                  settled_tx_id = NULL, settled_amount = NULL, settled_order_event_id = NULL WHERE order_id = ?`).run(id);
    rejudgeLegacyPaidOrders(db);
    expect(review(id)).toMatchObject({ reason: 'step5_not_paid', old_paid_amount: '12.50', cleared_at: null });
    const ev2 = row(id).order_event_id;
    const before2 = row(id);
    expect(confirmSettleReview(db, id, ev2, ev2)).toEqual({ ok: false, reason: 'total_mismatch' });
    expect(row(id)).toEqual(before2);
  });

  it('settle-review.ts confirm needs --taken', () => {
    expect(parseConfirmArgs(['o', 'e'])).toBeNull();
    expect(parseConfirmArgs(['o', 'e', '--taken'])).toBeNull();
    expect(parseConfirmArgs(['o', '--taken', 't'])).toBeNull();
    expect(parseConfirmArgs(['o', 'e', '--taken', 't'])).toEqual({ orderId: 'o', eventId: 'e', takenEventId: 't' });
    expect(parseConfirmArgs(['--taken', 't', 'o', 'e'])).toEqual({ orderId: 'o', eventId: 'e', takenEventId: 't' });
  });
});
