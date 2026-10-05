// @vitest-environment node
/**
 * The order mirror on the live subscription, against a loopback relay (never
 * a production one), with this portal's listing kinds (36500 only).
 *
 * - 36520 / 36521 are asked for from any author, 30933 only from the KIND
 *   38888 trusted signers.
 * - Every portal's 36520 arrives on that subscription. lanaeco.farm keeps
 *   only orders for the listing kind it mirrors: an order for another
 *   portal's listings (lanaeco.shop's 36502) has no listing here to price it,
 *   so it could only be called amount_mismatch and, once its 30933 landed,
 *   be put on Brilly's settle-review list as not_computable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { startLiveSync, stopLiveSync } from './liveSync.js';
import { bindingString } from './orderResolver.js';
import {
  key, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, orderEvent, purchaseEvent,
  orderIdFor, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';
import { fakeRelay, asksFor, type FakeRelay } from '../test/fakeRelay.js';

let db: Database.Database;
let relay: FakeRelay | undefined;
let owner: Key, processor: Key, brain: Key, buyer: Key, otherBuyer: Key;

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 20));
  }
}

beforeEach(() => {
  db = makeDb();
  owner = key(); processor = key(); brain = key(); buyer = key(); otherBuyer = key();
  seed38888(db, [processor.pk, brain.pk]);
});

afterEach(async () => {
  stopLiveSync();
  await relay?.close();
  relay = undefined;
});

describe('order mirror on the live subscription', () => {
  it('asks for 36520 / 36521 from anyone and 30933 only from the trusted signers', async () => {
    const r = relay = await fakeRelay(() => []);
    await startLiveSync(db, { listingKinds: [LISTING_KIND], relays: [r.url] });
    await until(() => r.filters.some(f => asksFor(f, 30933)));
    const orders = r.filters.filter(f => asksFor(f, 36520));
    expect(orders.length).toBeGreaterThan(0);
    for (const f of orders) {
      expect(f.kinds.sort()).toEqual([36520, 36521]);
      expect(f.authors).toBeUndefined();
    }
    for (const f of r.filters.filter(f => asksFor(f, 30933))) {
      expect(new Set(f.authors)).toEqual(new Set([processor.pk, brain.pk]));
    }
    // 36522 (the buyer's delivery details) is never asked for
    expect(r.filters.some(f => asksFor(f, 36522))).toBe(false);
  });

  it('keeps this portal\'s order, and leaves another portal\'s order (36502) out — also once it is paid', async () => {
    const farmId = orderIdFor(buyer);
    const shopId = orderIdFor(otherBuyer);
    const farmOrder = orderEvent(buyer, { orderId: farmId, ownerHex: owner.pk, itemA: `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`, client: 'www.lanaeco.farm' });
    const shopOrder = orderEvent(otherBuyer, { orderId: shopId, ownerHex: owner.pk, itemA: `36502:${owner.pk}:${LISTING_ID}`, client: 'lanaeco.shop' });
    const pays = (b: Key, id: string) => purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id) });
    relay = await fakeRelay(f => [
      ...(asksFor(f, 30901) ? [unitEvent(owner, { fee: '2.50' })] : []),
      ...(asksFor(f, 30903) ? [suspensionEvent(processor, owner)] : []),
      ...(asksFor(f, LISTING_KIND) ? [listingEvent(owner, { price: '5.00' })] : []),
      ...(asksFor(f, 36520) ? [farmOrder, shopOrder] : []),
      ...(asksFor(f, 30933) ? [pays(buyer, farmId), pays(otherBuyer, shopId)] : []),
    ]);
    await startLiveSync(db, { listingKinds: [LISTING_KIND], relays: [relay.url] });
    await until(() => (db.prepare('SELECT payment_state FROM orders WHERE order_id = ?').get(farmId) as any)?.payment_state === 'paid'
      && !!db.prepare('SELECT 1 FROM purchases_30933 WHERE invoice_number = ?').get(shopId));
    await new Promise(r => setTimeout(r, 100));
    expect(db.prepare('SELECT order_id, unit_id, payment_state FROM orders').all())
      .toEqual([{ order_id: farmId, unit_id: UNIT_ID, payment_state: 'paid' }]);
    expect(db.prepare('SELECT order_id FROM order_settle_review').all()).toEqual([]);
  });
});
