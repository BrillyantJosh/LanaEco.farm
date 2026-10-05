// @vitest-environment node
/**
 * The order join: buyer 36520 + brain 30933 + merchant 36521 flowing
 * through liveSync's dispatch into the NORMATIVE resolver. These tests pin
 * the money rules at the mirror level — what a relay delivers is exactly
 * what these events are.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { initLiveSyncDb, ingestEvent } from './liveSync.js';
import { recomputeOrder, loadTrustedSigners, rejudgeLegacyPaidOrders, confirmSettleReview, listSettleReview } from './orderJoin.js';
import { bindingString } from './orderResolver.js';
import { initializeSchema } from '../db/schema.js';
import {
  key, signed, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, orderEvent,
  purchaseEvent, fulfillmentEvent, deletionEvent, orderIdFor, dumpDb, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let owner: Key, staff: Key, brain: Key, buyer: Key, stranger: Key, processor: Key;
let orderId: string;
let itemA: string;

function row(id: string): any {
  return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
}

beforeEach(() => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); staff = key(); brain = key(); buyer = key(); stranger = key(); processor = key();
  seed38888(db, [brain.pk, processor.pk]);
  ingestEvent(unitEvent(owner, { fee: '2.50', staff: [staff.pk] }));
  ingestEvent(suspensionEvent(processor, owner));
  ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', created_at: 1000 }));
  orderId = orderIdFor(buyer);
  itemA = `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`;
  ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA }));
});

describe('trusted signers', () => {
  it('come from kind_38888.trusted_signers, fallback PROCESSOR_PUBKEY', () => {
    expect(loadTrustedSigners(db).has(brain.pk)).toBe(true);
    db.prepare('DELETE FROM kind_38888').run();
    const fb = loadTrustedSigners(db);
    expect(fb.size).toBe(1);
    expect(fb.has('79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692')).toBe(true);
  });
});

describe('36520 mirror', () => {
  it('stores the order unpaid with no PII anywhere in the DB', () => {
    const r = row(orderId);
    expect(r).toBeTruthy();
    expect(r.payment_state).toBe('unpaid');
    expect(r.buyer_pubkey).toBe(buyer.pk);
    expect(dumpDb(db)).not.toMatch(/Janez|Trubarjeva|example\.com/);
  });
  it('rejects a 36520 whose id does not carry the signer prefix', () => {
    const foreign = orderIdFor(stranger);
    ingestEvent(orderEvent(buyer, { orderId: foreign, ownerHex: owner.pk, itemA }));
    expect(row(foreign)).toBeUndefined();
  });
  it('rejects a 36520 with non-empty content (PII must never ride the order)', () => {
    const id2 = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId: id2, ownerHex: owner.pk, itemA, content: 'Janez Novak, Trubarjeva 7' }));
    expect(row(id2)).toBeUndefined();
    expect(dumpDb(db)).not.toMatch(/Trubarjeva/);
  });
  it('newest created_at wins, older republish is ignored', () => {
    const now = Math.floor(Date.now() / 1000);
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, status: 'cancelled', created_at: now + 10 }));
    expect(recomputeOrder(db, orderId)!.paymentState).toBe('cancelled');
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, status: 'placed', created_at: now - 10 }));
    expect(recomputeOrder(db, orderId)!.paymentState).toBe('cancelled');
  });
});

describe('30933 → paid', () => {
  const bind = () => bindingString(buyer.pk, orderId);

  it('exact trusted match pays the order', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: `Jabolka ×2 · ${bind()}` }));
    const r = row(orderId);
    expect(r.payment_state).toBe('paid');
    expect(r.paid_tx_id).toBeTruthy();
    expect(r.paid_lana_amount).toBe('12500');
  });
  it('amount tamper → amount_mismatch, never pending', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bind(), amount: '12.49' }));
    expect(row(orderId).payment_state).toBe('amount_mismatch');
    expect(recomputeOrder(db, orderId)!.pending).toBe(false);
  });
  it('a 30933 carrying the brain pubkey but a forged signature is dropped (money truth is SIGNED)', () => {
    const real = purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bind() });
    // Same pubkey, tampered tag ⇒ id/sig no longer match. A malicious relay could hand us exactly this.
    const forged = { ...real, tags: real.tags.map(t => (t[0] === 'amount' ? ['amount', '12.50'] : [...t])), id: 'f'.repeat(64) };
    ingestEvent(forged);
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchases_30933').get()).toEqual({ n: 0 });
    expect(row(orderId).payment_state).toBe('unpaid');
    const unsigned = { ...real, sig: '0'.repeat(128) };
    ingestEvent(unsigned);
    expect(row(orderId).payment_state).toBe('unpaid');
    ingestEvent(real);
    expect(row(orderId).payment_state).toBe('paid');
  });
  it('untrusted author is not even mirrored', () => {
    ingestEvent(purchaseEvent(stranger, { invoiceNumber: orderId, receiptDescription: bind() }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchases_30933').get()).toEqual({ n: 0 });
    expect(row(orderId).payment_state).toBe('unpaid');
  });
  it('missing binding string (squatted session) stays unpaid', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: 'Jabolka ×2' }));
    expect(row(orderId).payment_state).toBe('unpaid');
  });
  it('a 30933 that lands BEFORE its 36520 settles the order when the order arrives', () => {
    const id2 = orderIdFor(buyer);
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id2, receiptDescription: bindingString(buyer.pk, id2) }));
    ingestEvent(orderEvent(buyer, { orderId: id2, ownerHex: owner.pk, itemA }));
    expect(row(id2).payment_state).toBe('paid');
  });
  it('expected amount follows the merchant-signed listing, not the buyer tags', () => {
    const id2 = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId: id2, ownerHex: owner.pk, itemA, unitPrice: '0.01', total: '2.52' }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id2, receiptDescription: bindingString(buyer.pk, id2), amount: '2.52' }));
    expect(row(id2).payment_state).toBe('amount_mismatch');
    expect(row(id2).expected_total).toBe('12.50');
  });
});

describe('36521 fulfillment', () => {
  beforeEach(() => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
  });
  it('owner-signed shipped becomes the effective status', () => {
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', carrier: 'Pošta', tracking: 'RR123' }));
    const r = row(orderId);
    expect(r.effective_status).toBe('shipped');
    expect(JSON.parse(r.fulfillment_json).tracking).toBe('RR123');
    expect(recomputeOrder(db, orderId)!.pending).toBe(false);
  });
  it('staff `p` hex on the 30901 may sign', () => {
    ingestEvent(fulfillmentEvent(staff, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'packed' }));
    expect(row(orderId).effective_status).toBe('packed');
  });
  it('an owner-signed 36521 whose `p` is not this order\'s buyer is ignored', () => {
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: stranger.pk, ownerHex: owner.pk, status: 'shipped' }));
    expect(row(orderId).fulfillment_event_id).toBeNull();
    expect(row(orderId).effective_status).toBe('paid');
  });
  it('a stranger cannot shadow the merchant (not stored, still pending)', () => {
    const now = Math.floor(Date.now() / 1000);
    ingestEvent(fulfillmentEvent(stranger, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', created_at: now + 100 }));
    expect(row(orderId).fulfillment_event_id).toBeNull();
    expect(row(orderId).effective_status).toBe('paid');
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', created_at: now }));
    expect(row(orderId).effective_status).toBe('shipped');
  });
});

describe('KIND 5 deletions', () => {
  it('unpaid order: buyer deletion removes the row', () => {
    const now = Math.floor(Date.now() / 1000);
    ingestEvent(deletionEvent(buyer, [{ a: `36520:${buyer.pk}:${orderId}` }], now + 1));
    expect(row(orderId)).toBeUndefined();
    // and a late re-delivery cannot resurrect it
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, created_at: now }));
    expect(row(orderId)).toBeUndefined();
  });
  it('paid order: buyer deletion of the 36520 is IGNORED', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    ingestEvent(deletionEvent(buyer, [{ a: `36520:${buyer.pk}:${orderId}` }, { e: row(orderId).order_event_id }], Math.floor(Date.now() / 1000) + 5));
    expect(row(orderId)).toBeTruthy();
    expect(row(orderId).payment_state).toBe('paid');
  });
  it('paid order: merchant deletion of the 36521 is IGNORED', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped' }));
    ingestEvent(deletionEvent(owner, [{ a: `36521:${owner.pk}:${orderId}` }], Math.floor(Date.now() / 1000) + 5));
    expect(row(orderId).effective_status).toBe('shipped');
  });
  it('a stranger cannot delete anything', () => {
    ingestEvent(deletionEvent(stranger, [{ a: `36520:${buyer.pk}:${orderId}` }], Math.floor(Date.now() / 1000) + 5));
    expect(row(orderId)).toBeTruthy();
  });
});

describe('unit / listing arrivals re-verdict', () => {
  it('a republished shipping fee changes the expected total', () => {
    expect(row(orderId).expected_total).toBe('12.50');
    ingestEvent(unitEvent(owner, { fee: '3.00', staff: [staff.pk], created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect(row(orderId).expected_total).toBe('13.00');
  });
  it('a paid order stays paid when the listing price changes afterwards (SPEC §8 step 5a)', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    expect(row(orderId).payment_state).toBe('paid');
    expect(row(orderId).paid_order_event_id).toBe(row(orderId).order_event_id);
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: Math.floor(Date.now() / 1000) + 5 }));
    const r = row(orderId);
    expect(r.payment_state).toBe('paid');
    expect(r.expected_total).toBe('12.50');
    expect(r.price_changed).toBe(1);
    expect(recomputeOrder(db, orderId)!.pending).toBe(true);
  });
  it('…and when the shop changes its shipping fee afterwards', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    ingestEvent(unitEvent(owner, { fee: '3.00', staff: [staff.pk], created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect(row(orderId).payment_state).toBe('paid');
  });
  it('a 36520 the buyer replaced after payment is judged afresh against today\'s prices', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    const firstEvent = row(orderId).order_event_id;
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect(row(orderId).payment_state).toBe('paid');
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, created_at: Math.floor(Date.now() / 1000) + 60 }));
    const r = row(orderId);
    expect(r.order_event_id).not.toBe(firstEvent);
    expect(r.payment_state).toBe('amount_mismatch');
    expect(r.paid_order_event_id).toBeNull();
  });
  it('a database from before step 5a learns which order event each paid row was judged for', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    const id2 = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId: id2, ownerHex: owner.pk, itemA }));
    db.exec('ALTER TABLE orders DROP COLUMN paid_order_event_id');
    initializeSchema(db);
    expect(row(orderId).paid_order_event_id).toBe(row(orderId).order_event_id);
    expect(row(id2).paid_order_event_id).toBeNull();
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect(row(orderId).payment_state).toBe('paid');
  });
  it('unknown unit ⇒ never paid (fail-closed)', () => {
    db.prepare('DELETE FROM business_units WHERE unit_id = ?').run(UNIT_ID);
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    expect(row(orderId).payment_state).not.toBe('paid');
  });
});

/**
 * Review of 2 Oct 2026. The buyer's ephemeral key signs the 36520 and lives in
 * the buyer's browser, so the buyer can sign a REPLACEMENT with the same d and
 * publish it straight to the relays — it never passes POST /api/orders. The
 * mirror must not let such an event price itself.
 */
describe('a buyer-signed replacement 36520 (straight to the relays) cannot price itself', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const PEARS = 'lst-pears';
  let t0: number;

  /** E1 = 2 × apples at 5.00 + 2.50 shipping = 12.50, paid by a trusted 30933 and pinned (step 5a). */
  beforeEach(() => {
    ingestEvent(listingEvent(owner, { listingId: PEARS, title: 'Hruske', price: '50.00', stock: '100', created_at: 1000 }));
    orderId = orderIdFor(buyer);
    t0 = now();
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, created_at: t0 }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', expected_total: '12.50' });
    expect(row(orderId).paid_order_event_id).toBe(row(orderId).order_event_id);
  });
  function replace(items: string[][], total = '12.50') {
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, items, total, created_at: t0 + 5 }));
    return row(orderId);
  }

  it('the real pears listing under ANOTHER listing kind (36503) is unknown, so the order is not paid', () => {
    const r = replace([['item', `36503:${owner.pk}:${PEARS}`, '10', 'kg', '1.00', 'EUR']]);
    expect(JSON.parse(r.order_json).items[0].kind).toBe(36503);
    expect(r.payment_state).not.toBe('paid');
    expect(r.paid_order_event_id).toBeNull();
    expect(recomputeOrder(db, orderId)!.pending).toBe(false);
  });

  it('apples plus "free" pears under another kind: not paid', () => {
    const r = replace([
      ['item', itemA, '2', 'kg', '5.00', 'EUR'],
      ['item', `36503:${owner.pk}:${PEARS}`, '10', 'kg', '0.00', 'EUR'],
    ]);
    expect(r.payment_state).not.toBe('paid');
  });

  it('the real pears address at the buyer\'s price: judged on the merchant\'s 50.00', () => {
    const r = replace([['item', `${LISTING_KIND}:${owner.pk}:${PEARS}`, '10', 'kg', '1.00', 'EUR']]);
    expect(r).toMatchObject({ payment_state: 'amount_mismatch', expected_total: '502.50', paid_order_event_id: null });
  });

  it('a replacement the order route would refuse is not mirrored: the paid E1 stays as it was', () => {
    const e1 = row(orderId).order_event_id;
    const refused: Array<[string, string[][]]> = [
      ['another owner\'s listing', [['item', `${LISTING_KIND}:${buyer.pk}:${PEARS}`, '10', 'kg', '1.00', 'EUR']]],
      ['the same listing twice', [['item', itemA, '1', 'kg', '5.00', 'EUR'], ['item', itemA, '1', 'kg', '5.00', 'EUR']]],
      ['a line in another currency', [['item', itemA, '2', 'kg', '5.00', 'GBP']]],
      ['not a listing kind', [['item', `30901:${owner.pk}:${UNIT_ID}`, '1', 'kg', '1.00', 'EUR']]],
      ['an empty listing d', [['item', `${LISTING_KIND}:${owner.pk}:`, '1', 'kg', '1.00', 'EUR']]],
      ['a fractional quantity', [['item', itemA, '1.5', 'kg', '5.00', 'EUR']]],
      ['a malformed price', [['item', itemA, '2', 'kg', '5', 'EUR'], ['item', `${LISTING_KIND}:${owner.pk}:${PEARS}`, '1', 'kg', 'abc', 'EUR']]],
    ];
    for (const [why, items] of refused) {
      const r = replace(items);
      expect(r.order_event_id, why).toBe(e1);
      expect(r.payment_state, why).toBe('paid');
    }
  });

  it('more than 30 lines (the SPEC cap) are not mirrored either', () => {
    const e1 = row(orderId).order_event_id;
    const many = Array.from({ length: 31 }, (_, i) => ['item', `${LISTING_KIND}:${owner.pk}:x${i}`, '1', 'kg', '1.00', 'EUR']);
    expect(replace(many, '33.50').order_event_id).toBe(e1);
  });

  it('SHOP_MAX_ITEMS gates placing an order, not the mirror: the buyer\'s cancel of a placed cart order lands', () => {
    const prev = process.env.SHOP_MAX_ITEMS;
    const b = key();
    const id = orderIdFor(b);
    const cart = [['item', itemA, '1', 'kg', '5.00', 'EUR'], ['item', `${LISTING_KIND}:${owner.pk}:${PEARS}`, '1', 'kg', '50.00', 'EUR']];
    try {
      delete process.env.SHOP_MAX_ITEMS;
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, items: cart, total: '57.50', created_at: t0 }));
      expect(row(id)).toMatchObject({ payment_state: 'unpaid' });
      process.env.SHOP_MAX_ITEMS = '1';
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, items: cart, total: '57.50', status: 'cancelled', created_at: t0 + 5 }));
      expect(JSON.parse(row(id).order_json).status).toBe('cancelled');
      expect(row(id).payment_state).toBe('cancelled');
    } finally {
      if (prev === undefined) delete process.env.SHOP_MAX_ITEMS; else process.env.SHOP_MAX_ITEMS = prev;
    }
  });

  it('an order whose listing is not mirrored is not paid, and heals when the listing lands', () => {
    const b = key();
    const id = orderIdFor(b);
    const LATE = 'lst-late';
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: `${LISTING_KIND}:${owner.pk}:${LATE}`, unitPrice: '0.10', total: '2.70' }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '2.70' }));
    expect(row(id).payment_state).toBe('amount_mismatch');
    ingestEvent(listingEvent(owner, { listingId: LATE, price: '0.10', stock: '10', created_at: 1000 }));
    expect(row(id).payment_state).toBe('paid');
  });

  it('a pinned paid order is not paid once its shop is gone from the mirror (fail-closed)', () => {
    ingestEvent(deletionEvent(owner, [{ a: `30901:${owner.pk}:${UNIT_ID}` }]));
    expect(db.prepare('SELECT COUNT(*) AS n FROM business_units WHERE unit_id = ?').get(UNIT_ID)).toEqual({ n: 0 });
    const v = recomputeOrder(db, orderId)!;
    expect(v.paymentState).not.toBe('paid');
    expect(v.pending).toBe(false);
    expect(row(orderId).payment_state).not.toBe('paid');
  });
});

/**
 * Second review of 2 Oct 2026 (SPEC v1.1.2). Each case: E1 is placed and paid
 * as the order route would take it; E2 is the buyer's replacement with the
 * same d, published straight to the relays.
 */
describe('SPEC v1.1.2 — the mirror pays only the merchant\'s own numbers', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const view = (id: string) => {
    const r = row(id);
    return { st: r.payment_state, exp: r.expected_total, pinned: r.settled_order_event_id === r.order_event_id && !!r.settled_tx_id };
  };
  function shop(unitOpts: Parameters<typeof unitEvent>[1]) {
    const o = key(), b = key();
    ingestEvent(unitEvent(o, unitOpts));
    ingestEvent(suspensionEvent(processor, o, unitOpts?.unitId ?? UNIT_ID));
    return { o, b, id: orderIdFor(b), t0: now() };
  }
  const pay = (b: Key, id: string, amount: string, currency = 'EUR', o: Partial<Parameters<typeof purchaseEvent>[1]> = {}) =>
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount, currency, ...o }));

  it('D: the same line re-signed with the buyer\'s unit_price 500.00 and total 1002.50 is not paid', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, saleUnit: 'crate', unitPrice: '500.00', total: '1002.50', created_at: now() + 5 }));
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '12.50', pinned: false });
    expect(recomputeOrder(db, orderId)!.pending).toBe(false);
  });

  it('A: a EUR-priced listing in a HUF shop does not price a HUF order', () => {
    const s = shop({ currency: 'HUF', fee: '0.00', pickup: true });
    ingestEvent(listingEvent(s.o, { listingId: 'paprika', price: '10.00', currency: 'HUF', unit: 'piece', created_at: 1000 }));
    ingestEvent(listingEvent(s.o, { listingId: 'truffle', price: '10.00', currency: 'EUR', unit: 'piece', created_at: 1000 }));
    const o = (l: string, at: number) => orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: `${LISTING_KIND}:${s.o.pk}:${l}`, qty: '2', unitPrice: '10.00', currency: 'HUF', shipping: '0.00', total: '20.00', fulfillment: 'pickup', created_at: at });
    ingestEvent(o('paprika', s.t0));
    pay(s.b, s.id, '20.00', 'HUF');
    expect(view(s.id).st).toBe('paid');
    ingestEvent(o('truffle', s.t0 + 5));
    expect(view(s.id)).toMatchObject({ st: 'amount_mismatch', exp: '' });
  });

  it('B: the same owner\'s listing of ANOTHER shop does not price this order', () => {
    const s = shop({ currency: 'HUF', fee: '0.00', pickup: true });
    const UNIT_B = 'b'.repeat(32);
    ingestEvent(unitEvent(s.o, { unitId: UNIT_B, currency: 'EUR', fee: '0.00', pickup: true }));
    ingestEvent(suspensionEvent(processor, s.o, UNIT_B));
    ingestEvent(listingEvent(s.o, { listingId: 'paprika', price: '10.00', currency: 'HUF', created_at: 1000 }));
    ingestEvent(listingEvent(s.o, { listingId: 'wine', unitId: UNIT_B, price: '10.00', currency: 'HUF', created_at: 1000 }));
    const o = (l: string, at: number) => orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: `${LISTING_KIND}:${s.o.pk}:${l}`, qty: '2', unitPrice: '10.00', currency: 'HUF', shipping: '0.00', total: '20.00', fulfillment: 'pickup', created_at: at });
    ingestEvent(o('paprika', s.t0));
    pay(s.b, s.id, '20.00', 'HUF');
    expect(view(s.id).st).toBe('paid');
    ingestEvent(o('wine', s.t0 + 5));
    expect(view(s.id)).toMatchObject({ st: 'amount_mismatch', exp: '' });
  });

  it('C: 1000 × a listing priced 0.00 added to the paid line: not paid', () => {
    ingestEvent(listingEvent(owner, { listingId: 'gift', price: '0.00', created_at: 1000 }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, items: [['item', itemA, '2', 'kg', '5.00', 'EUR'], ['item', `${LISTING_KIND}:${owner.pk}:gift`, '1000', 'kg', '0.00', 'EUR']], created_at: now() + 5 }));
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '' });
  });

  it('E: pickup at a shop that offers shipping only is not computable — and paid where pickup is offered', () => {
    for (const pickup of [false, true]) {
      const s = shop({ fee: '2.50', pickup, unitId: pickup ? 'c'.repeat(32) : 'e'.repeat(32) });
      const unitId = pickup ? 'c'.repeat(32) : 'e'.repeat(32);
      ingestEvent(listingEvent(s.o, { unitId, price: '2.50', created_at: 1000 }));
      const a = `${LISTING_KIND}:${s.o.pk}:${LISTING_ID}`;
      ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, unitId, itemA: a, qty: '4', unitPrice: '2.50', total: '12.50', created_at: s.t0 }));
      ingestEvent(purchaseEvent(brain, { unitId, invoiceNumber: s.id, receiptDescription: bindingString(s.b.pk, s.id), amount: '12.50' }));
      expect(view(s.id).st, String(pickup)).toBe('paid');
      ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, unitId, itemA: a, qty: '5', unitPrice: '2.50', shipping: '0.00', total: '12.50', fulfillment: 'pickup', created_at: s.t0 + 5 }));
      expect(view(s.id).st, String(pickup)).toBe(pickup ? 'paid' : 'amount_mismatch');
    }
  });

  it('a listing priced with no currency is no price, whatever the display default says', () => {
    const s = shop({ fee: '0.00', pickup: true });
    ingestEvent(signed(s.o, LISTING_KIND, [['d', 'nocur'], ['a', `30901:${s.o.pk}:${UNIT_ID}`], ['title', 'X'], ['price', '5.00'], ['status', 'active']], '', 1000));
    ingestEvent(orderEvent(s.b, { orderId: s.id, ownerHex: s.o.pk, itemA: `${LISTING_KIND}:${s.o.pk}:nocur`, qty: '1', shipping: '0.00', total: '5.00', fulfillment: 'pickup', created_at: s.t0 }));
    pay(s.b, s.id, '5.00');
    expect(view(s.id)).toMatchObject({ st: 'amount_mismatch', exp: '' });
  });

  it('an honest order whose listing is deleted after it was placed is still paid at the merchant\'s price', () => {
    // mirrored with its listing known (5.00) → the merchant deletes the listing inside the pay window → the 30933 lands
    expect(row(orderId).payment_state).toBe('unpaid');
    ingestEvent(deletionEvent(owner, [{ a: itemA }]));
    expect(db.prepare('SELECT COUNT(*) AS n FROM listings WHERE listing_id = ?').get(LISTING_ID)).toEqual({ n: 0 });
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
  });

  it('…but a replacement naming that deleted listing never had a price: not paid', () => {
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    ingestEvent(deletionEvent(owner, [{ a: itemA }]));
    // E2: the same address, the buyer's own numbers — a new event, judged with no listing
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, qty: '10', unitPrice: '1.00', total: '12.50', created_at: now() + 5 }));
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '', pinned: false });
  });

  it('a settled order survives its shop leaving the mirror: not paid while it is gone, paid again when it is back (legit-eco6)', () => {
    const t0 = now() - 60;
    const b = key();
    const id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, created_at: t0 }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '12.50' }));
    expect(view(id)).toMatchObject({ st: 'paid', pinned: true });
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: t0 + 10 }));
    expect(view(id)).toMatchObject({ st: 'paid', exp: '12.50' });
    ingestEvent(deletionEvent(owner, [{ a: `30901:${owner.pk}:${UNIT_ID}` }], now() + 20));
    expect(db.prepare('SELECT COUNT(*) AS n FROM business_units WHERE unit_id = ?').get(UNIT_ID)).toEqual({ n: 0 });
    recomputeOrder(db, id); // e.g. the buyer opens the status page
    expect(row(id).payment_state).not.toBe('paid');
    expect(row(id).settled_order_event_id).toBe(row(id).order_event_id);
    ingestEvent(unitEvent(owner, { fee: '2.50', staff: [staff.pk], created_at: now() + 30 }));
    expect(view(id)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
  });

  it('the brain re-signs the same purchase later (publish retry): a settled order stays paid after a reprice', () => {
    const T = now() - 60;
    ingestEvent(purchaseEvent(brain, { txId: 'tx-a', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50', created_at: T }));
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: now() + 5 }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50' });
    ingestEvent(purchaseEvent(brain, { txId: 'tx-a', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50', created_at: T + 60 }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchases_30933').get()).toEqual({ n: 1 });
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    // …and a cancelled version of it still un-pays the order
    ingestEvent(purchaseEvent(brain, { txId: 'tx-a', invoiceNumber: orderId, receiptDescription: '', amount: '12.50', status: 'cancelled', created_at: T + 120 }));
    expect(view(orderId)).toMatchObject({ st: 'unpaid', pinned: false });
  });

  it('a cancellation signed in the same second as the payment lands, whichever id is lower (probe-tie)', () => {
    for (const lower of [true, false]) {
      const b = key();
      const id = orderIdFor(b);
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA }));
      const T = now();
      const tx = `tx-${lower}`;
      const proc = purchaseEvent(brain, { txId: tx, invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '12.50', created_at: T });
      let cancel = proc;
      for (let i = 0; i < 4096; i++) { // a stored id near 0 or f…: 64 tries missed ~1 run in 65
        cancel = purchaseEvent(brain, { txId: tx, invoiceNumber: id, receiptDescription: '', amount: '12.50', status: 'cancelled', lanaAmount: String(i), created_at: T });
        if ((cancel.id < proc.id) === lower) break;
      }
      expect(cancel.id < proc.id).toBe(lower);
      ingestEvent(proc);
      expect(view(id).st).toBe('paid');
      ingestEvent(cancel);
      expect(view(id).st, `cancel id lower: ${lower}`).toBe('unpaid');
      // the processing copy arriving again changes nothing
      ingestEvent(proc);
      expect(view(id).st).toBe('unpaid');
    }
  });

  it('brain key rotation: the NEW trusted key\'s cancel retires the OLD key\'s payment of the same tx id (third review, p2)', () => {
    const newBrain = key();
    seed38888(db, [brain.pk, processor.pk, newBrain.pk]);
    const T = now() - 60;
    ingestEvent(purchaseEvent(brain, { txId: 'tx-rot', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50', created_at: T }));
    expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true });
    ingestEvent(purchaseEvent(newBrain, { txId: 'tx-rot', invoiceNumber: orderId, receiptDescription: '', amount: '12.50', status: 'cancelled', created_at: T + 60 }));
    // the mirror keeps one row per (signer, tx id): both versions are there, the resolver keeps the newest
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchases_30933 WHERE tx_id = ?').get('tx-rot')).toEqual({ n: 2 });
    expect(view(orderId)).toMatchObject({ st: 'unpaid', pinned: false });
  });

  /**
   * A database from before v1.1.2: the settled_* columns do not exist yet and
   * the row holds the verdict the OLDER rules reached (what origin/main
   * stored — probe x1/p1 phase A printed it). The settled_* columns are
   * dropped and the row is set back to that verdict.
   */
  function asOlderRulesLeftIt(id: string, verdict?: { amount: string }) {
    if (verdict) {
      const p = db.prepare('SELECT tx_id, event_id FROM purchases_30933 WHERE invoice_number = ?').get(id) as { tx_id: string; event_id: string };
      db.prepare(`UPDATE orders SET payment_state = 'paid', effective_status = 'paid', expected_total = ?, paid_tx_id = ?,
                    paid_event_id = ?, paid_amount = ?, paid_order_event_id = order_event_id WHERE order_id = ?`)
        .run(verdict.amount, p.tx_id, p.event_id, verdict.amount, id);
    }
    for (const c of ['settled_tx_id', 'settled_amount', 'settled_order_event_id']) db.exec(`ALTER TABLE orders DROP COLUMN ${c}`);
    initializeSchema(db);
  }
  const review = (id: string) => db.prepare('SELECT verdict, expected_total, old_paid_amount, cleared_at FROM order_settle_review WHERE order_id = ?').get(id) as any;

  it('an older-rules \'paid\' is never carried into the pin: the replacement that named an unknown listing is not paid (third review, x1/p1)', () => {
    ingestEvent(purchaseEvent(brain, { txId: 'tx-old', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true });
    // E2, straight to the relays: lst-gold — a listing the mirror does not know — at the buyer's own 5.00.
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA: `${LISTING_KIND}:${owner.pk}:lst-gold`, unitPrice: '5.00', created_at: now() + 5 }));
    expect(view(orderId).st).toBe('amount_mismatch');
    // …which the older rules priced at the buyer's 5.00 and called paid (A2).
    asOlderRulesLeftIt(orderId, { amount: '12.50' });
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', settled_tx_id: null, settled_amount: null, settled_order_event_id: null });
    expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 1, paid: 0, listed: 1, notMirrored: 0 });
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '', pinned: false });
    expect(row(orderId).pending ?? 0).toBeFalsy();
    expect(review(orderId)).toMatchObject({ verdict: 'amount_mismatch', old_paid_amount: '12.50', cleared_at: null });
    // the merchant's real lst-gold lands at 500.00: judged on it, still not paid (B2 / control C2)
    ingestEvent(listingEvent(owner, { listingId: 'lst-gold', title: 'Zlato', price: '500.00', stock: '100', created_at: now() + 20 }));
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '1002.50', pinned: false });
    expect(review(orderId).cleared_at).toBeNull();
    // idempotent: nothing older is left to judge
    expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 0, paid: 0, listed: 0, notMirrored: 0 });
  });

  it('an honest older-rules \'paid\' is settled by step 5 at start-up and then survives a reprice', () => {
    ingestEvent(purchaseEvent(brain, { txId: 'tx-old', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    asOlderRulesLeftIt(orderId);
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', settled_tx_id: null });
    initLiveSyncDb(db); // the start-up path (startLiveSync runs the same re-judge before any request)
    expect(row(orderId)).toMatchObject({ settled_tx_id: 'tx-old', settled_amount: '12.50', settled_order_event_id: row(orderId).order_event_id });
    expect(review(orderId)).toBeUndefined();
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: now() + 5 }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
  });

  it('an older-rules \'paid\' the mirror cannot judge at start-up is listed, and cleared once step 5 pays it', () => {
    ingestEvent(purchaseEvent(brain, { txId: 'tx-old', invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    asOlderRulesLeftIt(orderId);
    db.prepare('DELETE FROM business_units WHERE unit_id = ?').run(UNIT_ID);
    expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 1, paid: 0, listed: 1, notMirrored: 0 });
    expect(row(orderId).payment_state).not.toBe('paid');
    expect(review(orderId)).toMatchObject({ old_paid_amount: '12.50', cleared_at: null });
    ingestEvent(unitEvent(owner, { fee: '2.50', staff: [staff.pk], created_at: now() + 30 }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    expect(review(orderId).cleared_at).toBeGreaterThan(0);
  });
});

/**
 * Fourth review of 2 Oct 2026 (x2/p1). A shop keeps old, merchant-signed
 * listings it has taken off sale (status inactive / sold_out / deleted /
 * draft) — e.g. last year's honey at 5.00 beside today's at 50.00. The order
 * route refuses such a listing, so an order naming one never passed it: it
 * is the buyer's own replacement and must not be priced by it.
 */
describe('fourth review — only a listing on sale prices an order', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const view = (id: string) => {
    const r = row(id);
    return { st: r.payment_state, exp: r.expected_total, pinned: r.settled_order_event_id === r.order_event_id && !!r.settled_tx_id, pending: recomputeOrder(db, id)!.pending };
  };

  it('a replacement naming the shop\'s off-sale cheaper listing is not paid (inactive, sold_out, deleted, draft)', () => {
    for (const status of ['inactive', 'sold_out', 'deleted', 'draft']) {
      const o = key(), b = key();
      ingestEvent(unitEvent(o, { fee: '2.50' }));
      ingestEvent(suspensionEvent(processor, o));
      ingestEvent(listingEvent(o, { listingId: 'honey-2026', title: 'Med', price: '50.00', stock: '100', created_at: 1000 }));
      ingestEvent(listingEvent(o, { listingId: 'honey-2024', title: 'Med', price: '5.00', status, created_at: 900 }));
      const id = orderIdFor(b);
      const t0 = now();
      const NEW = `${LISTING_KIND}:${o.pk}:honey-2026`, OLD = `${LISTING_KIND}:${o.pk}:honey-2024`;
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: o.pk, itemA: NEW, qty: '1', unitPrice: '50.00', total: '52.50', created_at: t0 }));
      ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '52.50' }));
      expect(view(id), status).toMatchObject({ st: 'paid', exp: '52.50', pinned: true, pending: true });
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: o.pk, itemA: '', items: [['item', OLD, '10', 'kg', '5.00', 'EUR']], total: '52.50', created_at: t0 + 5 }));
      expect(JSON.parse(row(id).order_json).items[0].a, status).toBe(OLD);
      expect(view(id), status).toMatchObject({ st: 'amount_mismatch', exp: '', pinned: false, pending: false });
    }
  });

  it('a calendar listing (KIND 31923) sells only with lana-status \'active\', as the broker reads it', () => {
    const t0 = now();
    for (const lanaStatus of [null, 'published', 'draft', 'active']) {
      const b = key(), id = orderIdFor(b);
      const d = `ev-${lanaStatus}`;
      const tags = [['d', d], ['a', `30901:${owner.pk}:${UNIT_ID}`], ['title', 'Delavnica'], ['t', 'lana-event'], ['price', '5.00', 'EUR']];
      if (lanaStatus) tags.push(['lana-status', lanaStatus]);
      ingestEvent(signed(owner, 31923, tags, '', 1000));
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: `31923:${owner.pk}:${d}`, created_at: t0 }));
      ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '12.50' }));
      expect(view(id).st, String(lanaStatus)).toBe(lanaStatus === 'active' ? 'paid' : 'amount_mismatch');
    }
  });

  it('an honest order whose listing sells out after it was placed is still paid at the merchant\'s price', () => {
    // mirrored with its listing on sale (5.00) → the merchant marks it sold_out → the 30933 lands
    expect(row(orderId).payment_state).toBe('unpaid');
    ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', status: 'sold_out', created_at: now() + 1 }));
    expect(JSON.parse((db.prepare('SELECT parsed_json FROM listings WHERE pubkey = ? AND listing_id = ?').get(owner.pk, LISTING_ID) as any).parsed_json).status).toBe('sold_out');
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId), amount: '12.50' }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    // …and a paid order stays paid when its listing goes off sale afterwards (step 5a)
    const b = key(), id = orderIdFor(b);
    ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', status: 'active', created_at: now() + 2 }));
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA, created_at: now() }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount: '12.50' }));
    expect(view(id)).toMatchObject({ st: 'paid', pinned: true });
    ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', status: 'inactive', created_at: now() + 3 }));
    expect(view(id)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true, pending: true });
  });
});

/**
 * Round 3 of 2 Oct 2026. The portal has no order-time terms for an order the
 * older rules judged 'paid' (order_terms_seen is this code's, and is never
 * tried for such a row — round 5),
 * and no stored price could tell an honest order from a buyer's replacement
 * anyway. So an honest older 'paid' that step 5 does not pay now — repriced,
 * off sale, deleted, other pickup terms — is listed, and Brilly restores it
 * by confirming exactly the 36520 event he checked against the broker
 * (confirmSettleReview, server/scripts/settle-review.ts). Another portal's
 * order (a listing kind this portal does not mirror) is listed apart.
 */
describe('round 3 — an older \'paid\' step 5 does not pay is listed; Brilly confirms an honest one', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const view = (id: string) => {
    const r = row(id);
    return { st: r.payment_state, exp: r.expected_total, pinned: r.settled_order_event_id === r.order_event_id && !!r.settled_tx_id };
  };
  const review = (id: string) => db.prepare('SELECT verdict, expected_total, old_paid_amount, old_paid_tx_id, reason, cleared_at, confirmed_at FROM order_settle_review WHERE order_id = ?').get(id) as any;
  /** What origin/main left: 'paid' by the older rules, no settled_* and no price memory (both are this code's). */
  function fromBeforeThisCode() {
    for (const c of ['settled_tx_id', 'settled_amount', 'settled_order_event_id']) db.exec(`ALTER TABLE orders DROP COLUMN ${c}`);
    initializeSchema(db);
    db.prepare('DELETE FROM order_listing_prices').run();
    db.prepare('DELETE FROM order_terms_seen').run();
  }
  const payOld = (id = orderId, b = buyer, amount = '12.50', txId = 'tx-old') =>
    ingestEvent(purchaseEvent(brain, { txId, invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount }));

  it('an honest older \'paid\' repriced since is listed, not paid — and paid and pinned once Brilly confirms exactly that event (r3/marjan-eco P2)', () => {
    payOld();
    expect(view(orderId)).toMatchObject({ st: 'paid', pinned: true });
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: now() + 5 }));
    fromBeforeThisCode();
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', settled_tx_id: null });
    expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 1, paid: 0, listed: 1, notMirrored: 0 });
    expect(view(orderId)).toMatchObject({ st: 'amount_mismatch', exp: '14.50', pinned: false });
    expect(review(orderId)).toMatchObject({ verdict: 'amount_mismatch', old_paid_amount: '12.50', old_paid_tx_id: 'tx-old', reason: 'step5_not_paid', cleared_at: null, confirmed_at: null });
    expect(listSettleReview(db, 'step5_not_paid').map(e => [e.order_id, e.order_event_id, e.current_event_id])).toEqual([[orderId, row(orderId).order_event_id, row(orderId).order_event_id]]);
    expect(confirmSettleReview(db, orderId, row(orderId).order_event_id, row(orderId).order_event_id)).toEqual({ ok: true, paymentState: 'paid', expected: '12.50' });
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    expect(row(orderId)).toMatchObject({ settled_tx_id: 'tx-old', settled_amount: '12.50' });
    expect(review(orderId).cleared_at).toBeGreaterThan(0);
    expect(review(orderId).confirmed_at).toBeGreaterThan(0);
    expect(listSettleReview(db)).toEqual([]);
    // the pin holds through the next touch (another reprice) …
    ingestEvent(listingEvent(owner, { price: '7.00', stock: '10', created_at: now() + 10 }));
    expect(view(orderId)).toMatchObject({ st: 'paid', exp: '12.50', pinned: true });
    // … and the brain's cancellation of that purchase un-pays it, as it un-pays every pin
    ingestEvent(purchaseEvent(brain, { txId: 'tx-old', invoiceNumber: orderId, receiptDescription: '', amount: '12.50', status: 'cancelled', created_at: now() + 60 }));
    expect(view(orderId)).toMatchObject({ st: 'unpaid', pinned: false });
  });

  it('a confirmation is refused, with nothing written: no entry, another event id, a cancelled purchase, an order the buyer replaced since', () => {
    payOld();
    ingestEvent(listingEvent(owner, { price: '6.00', stock: '10', created_at: now() + 5 }));
    fromBeforeThisCode();
    const e1 = row(orderId).order_event_id;
    expect(confirmSettleReview(db, orderId, e1, e1)).toEqual({ ok: false, reason: 'no_open_entry' });
    expect(row(orderId)).toMatchObject({ payment_state: 'paid', settled_tx_id: null });
    rejudgeLegacyPaidOrders(db);
    expect(confirmSettleReview(db, orderId, 'f'.repeat(64), 'f'.repeat(64))).toEqual({ ok: false, reason: 'event_mismatch' });
    expect(row(orderId)).toMatchObject({ payment_state: 'amount_mismatch', settled_tx_id: null, settled_order_event_id: null });
    // the brain cancelled that purchase since: no pay, the row and the entry stay as they were
    ingestEvent(purchaseEvent(brain, { txId: 'tx-old', invoiceNumber: orderId, receiptDescription: '', amount: '12.50', status: 'cancelled', created_at: now() + 60 }));
    const before = row(orderId);
    expect(before.payment_state).toBe('unpaid');
    expect(confirmSettleReview(db, orderId, e1, e1)).toEqual({ ok: false, reason: 'not_paid', paymentState: 'unpaid' });
    expect(row(orderId)).toEqual(before);
    expect(review(orderId)).toMatchObject({ cleared_at: null, confirmed_at: null });
    // a replacement the buyer published after it was listed is another order
    const b2 = key(), id2 = orderIdFor(b2);
    ingestEvent(orderEvent(b2, { orderId: id2, ownerHex: owner.pk, itemA, unitPrice: '6.00', total: '14.50', created_at: now() - 60 }));
    payOld(id2, b2, '14.50', 'tx-2');
    ingestEvent(listingEvent(owner, { price: '8.00', stock: '10', created_at: now() + 20 }));
    expect(view(id2)).toMatchObject({ st: 'paid', pinned: true });
    fromBeforeThisCode();
    rejudgeLegacyPaidOrders(db);
    const listedEvent = row(id2).order_event_id;
    ingestEvent(orderEvent(b2, { orderId: id2, ownerHex: owner.pk, itemA, unitPrice: '8.00', total: '18.50', created_at: now() + 30 }));
    expect(row(id2).order_event_id).not.toBe(listedEvent);
    expect(confirmSettleReview(db, id2, listedEvent, listedEvent)).toEqual({ ok: false, reason: 'order_replaced' });
    expect(confirmSettleReview(db, id2, row(id2).order_event_id, row(id2).order_event_id)).toEqual({ ok: false, reason: 'order_replaced' });
    expect(view(id2)).toMatchObject({ st: 'amount_mismatch', pinned: false });
  });

  it('an honest older \'paid\' whose listing sold out or was deleted, or whose shop stopped pickup, is listed and can be confirmed (r3/marjan-eco P3–P5)', () => {
    const made: Array<{ c: string; id: string; amount: string }> = [];
    for (const c of ['sold_out', 'deleted', 'pickup_off']) {
      const o = key(), b = key(), id = orderIdFor(b);
      ingestEvent(unitEvent(o, { fee: '2.50', pickup: true, created_at: now() - 100 }));
      ingestEvent(suspensionEvent(processor, o));
      ingestEvent(listingEvent(o, { price: '5.00', stock: '10', created_at: 1000 }));
      const a = `${LISTING_KIND}:${o.pk}:${LISTING_ID}`;
      const pickup = c === 'pickup_off';
      const amount = pickup ? '10.00' : '12.50';
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: o.pk, itemA: a, fulfillment: pickup ? 'pickup' : 'shipping', shipping: pickup ? '0.00' : '2.50', total: amount, created_at: now() }));
      payOld(id, b, amount, `tx-${c}`);
      expect(view(id), c).toMatchObject({ st: 'paid', pinned: true });
      if (c === 'sold_out') ingestEvent(listingEvent(o, { price: '5.00', stock: '10', status: 'sold_out', created_at: 1001 }));
      if (c === 'deleted') ingestEvent(deletionEvent(o, [{ a }], now() + 5));
      if (c === 'pickup_off') ingestEvent(unitEvent(o, { fee: '2.50', pickup: false, created_at: now() }));
      expect(view(id), c).toMatchObject({ st: 'paid', pinned: true }); // this code's pin holds it
      made.push({ c, id, amount });
    }
    fromBeforeThisCode();
    expect(rejudgeLegacyPaidOrders(db)).toEqual({ judged: 3, paid: 0, listed: 3, notMirrored: 0 });
    for (const m of made) {
      expect(view(m.id), m.c).toMatchObject({ st: 'amount_mismatch', exp: '', pinned: false });
      expect(review(m.id), m.c).toMatchObject({ reason: 'step5_not_paid', old_paid_amount: m.amount, cleared_at: null });
      expect(confirmSettleReview(db, m.id, row(m.id).order_event_id, row(m.id).order_event_id), m.c).toEqual({ ok: true, paymentState: 'paid', expected: m.amount });
      expect(view(m.id), m.c).toMatchObject({ st: 'paid', exp: m.amount, pinned: true });
    }
  });

  it('an older \'paid\' of a listing kind this portal does not mirror is listed apart, not logged as suspicious (r3/eco-foreign)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const b = key(), id = orderIdFor(b);
      ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: `36511:${owner.pk}:session-1`, qty: '1', saleUnit: 'session', unitPrice: '40.00', total: '42.50' }));
      payOld(id, b, '42.50', 'tx-f');
      expect(row(id).payment_state).toBe('amount_mismatch'); // this code never prices it here
      // …what the older rules stored: 'paid' at the buyer's 40.00
      db.prepare(`UPDATE orders SET payment_state = 'paid', effective_status = 'paid', expected_total = '42.50', paid_tx_id = 'tx-f',
                    paid_amount = '42.50', paid_order_event_id = order_event_id WHERE order_id = ?`).run(id);
      fromBeforeThisCode();
      warn.mockClear();
      expect(rejudgeLegacyPaidOrders(db, now(), { listingKinds: new Set([LISTING_KIND]) })).toEqual({ judged: 1, paid: 0, listed: 0, notMirrored: 1 });
      expect(row(id)).toMatchObject({ payment_state: 'amount_mismatch', settled_tx_id: null });
      expect(review(id)).toMatchObject({ reason: 'listing_kind_not_mirrored', old_paid_amount: '42.50', cleared_at: null });
      expect(warn).not.toHaveBeenCalled();
      expect(listSettleReview(db, 'step5_not_paid')).toEqual([]);
      expect(listSettleReview(db).map(e => e.reason)).toEqual(['listing_kind_not_mirrored']);
    } finally {
      warn.mockRestore();
    }
  });
});
