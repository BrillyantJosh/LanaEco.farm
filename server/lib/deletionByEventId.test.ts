// @vitest-environment node
/**
 * F1 (round 5, 5 Oct 2026): a KIND 5 that names a 30901 or a listing ONLY by
 * its event id (`e` — what Lana Wallet "My events" publishes) must not let
 * the relay's rebroadcast of an older version take its place: an older,
 * cheaper listing price, or an older shipping fee / pickup offer. The
 * deletion tombstones the address at the deleted version's created_at; a
 * deletion that lands before its target refuses the target and every older
 * version when it lands; only the target's own author can delete it; and
 * the shop's orders are judged again at once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initLiveSyncDb, ingestEvent } from './liveSync.js';
import { bindingString } from './orderResolver.js';
import {
  key, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, orderEvent, purchaseEvent,
  deletionEvent, orderIdFor, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';
import type { NostrEvent } from './relaySync.js';

let db: Database.Database;
let owner: Key, brain: Key, buyer: Key, stranger: Key, processor: Key;
let unitNow: NostrEvent;
let v1: NostrEvent;
const now = () => Math.floor(Date.now() / 1000);
const itemA = () => `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`;

const row = (id: string): any => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
const listingRow = (): any => db.prepare('SELECT event_id, event_created_at, parsed_json FROM listings WHERE pubkey = ? AND listing_id = ?').get(owner.pk, LISTING_ID);
const unitRows = (): number => (db.prepare('SELECT COUNT(*) AS n FROM business_units WHERE pubkey = ? AND unit_id = ?').get(owner.pk, UNIT_ID) as { n: number }).n;
const tombstone = (kind: number, pk: string, d: string): any => db.prepare('SELECT tombstone_created_at FROM tombstones WHERE kind = ? AND pubkey = ? AND d_tag = ?').get(kind, pk, d);
const pay = (b: Key, id: string, amount: string) =>
  ingestEvent(purchaseEvent(brain, { invoiceNumber: id, receiptDescription: bindingString(b.pk, id), amount }));

beforeEach(() => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); brain = key(); buyer = key(); stranger = key(); processor = key();
  seed38888(db, [brain.pk, processor.pk]);
  unitNow = unitEvent(owner, { fee: '2.50', created_at: now() - 50 });
  ingestEvent(unitNow);
  ingestEvent(suspensionEvent(processor, owner));
  v1 = listingEvent(owner, { price: '5.00', stock: '100', created_at: 1000 });
  ingestEvent(v1);
});

describe('F1 — a KIND 5 by event id (`e` only)', () => {
  it('W1: deleting the current listing version by `e`, then the relay rebroadcasting the older cheaper one — the older one prices nothing', () => {
    const v2 = listingEvent(owner, { price: '50.00', stock: '100', created_at: 2000 });
    ingestEvent(v2);
    expect(listingRow().event_id).toBe(v2.id);
    const orderId = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA: itemA(), qty: '1', unitPrice: '50.00', total: '52.50', created_at: now() - 10 }));
    pay(buyer, orderId, '52.50');
    expect(row(orderId).payment_state).toBe('paid');

    ingestEvent(deletionEvent(owner, [{ e: v2.id }], now()));
    expect(listingRow()).toBeUndefined();
    expect(tombstone(LISTING_KIND, owner.pk, LISTING_ID)).toEqual({ tombstone_created_at: 2000 });
    ingestEvent(v1); // the relay's copy of the older, cheaper version
    expect(listingRow()).toBeUndefined();

    // the buyer's replacement at the old price, same total: nothing prices it
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA: itemA(), qty: '10', unitPrice: '5.00', total: '52.50', created_at: now() + 5 }));
    expect(row(orderId)).toMatchObject({ payment_state: 'amount_mismatch', expected_total: '' });
  });

  it('a deletion that lands before its target refuses the target and every older version', () => {
    const v2 = listingEvent(owner, { price: '50.00', stock: '100', created_at: 2000 });
    ingestEvent(deletionEvent(owner, [{ e: v2.id }], now()));
    expect(listingRow().event_id).toBe(v1.id); // the mirror has not seen v2 yet
    expect(db.prepare('SELECT author, event_id FROM deleted_event_refs').all()).toEqual([{ author: owner.pk, event_id: v2.id }]);

    ingestEvent(v2);
    expect(listingRow()).toBeUndefined(); // neither v2 nor the older v1 it replaced
    expect(tombstone(LISTING_KIND, owner.pk, LISTING_ID)).toEqual({ tombstone_created_at: 2000 });
    ingestEvent(v1);
    expect(listingRow()).toBeUndefined();

    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: itemA(), qty: '10', unitPrice: '5.00', total: '52.50' }));
    pay(b, id, '52.50');
    expect(row(id)).toMatchObject({ payment_state: 'amount_mismatch', expected_total: '' });
  });

  it('…the same for a 30901: deleting the shop\'s current version by `e` does not bring back an older fee / pickup offer', () => {
    const older = unitEvent(owner, { fee: '0.00', pickup: true, created_at: now() - 100 });
    ingestEvent(older); // older than the mirrored one: not taken
    expect(unitRows()).toBe(1);
    ingestEvent(deletionEvent(owner, [{ e: unitNow.id }], now()));
    expect(unitRows()).toBe(0);
    expect(tombstone(30901, owner.pk, UNIT_ID)).toEqual({ tombstone_created_at: unitNow.created_at });
    ingestEvent(older); // rebroadcast
    expect(unitRows()).toBe(0);

    // a pickup order (no shipping) the older version would have priced
    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: itemA(), shipping: '0.00', total: '10.00', fulfillment: 'pickup' }));
    pay(b, id, '10.00');
    expect(row(id).payment_state).not.toBe('paid');

    // …and a 30901 deleted by `e` before it lands is refused, with every older version
    const o2 = key();
    const u1 = unitEvent(o2, { fee: '0.00', pickup: true, created_at: now() - 100 });
    const u2 = unitEvent(o2, { fee: '2.50', pickup: false, created_at: now() - 50 });
    ingestEvent(u1);
    ingestEvent(deletionEvent(o2, [{ e: u2.id }], now()));
    ingestEvent(u2);
    ingestEvent(u1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM business_units WHERE pubkey = ?').get(o2.pk) as { n: number }).n).toBe(0);
  });

  it('a newer re-listing (and a newer 30901) after an `e` deletion is taken as usual', () => {
    const v2 = listingEvent(owner, { price: '50.00', stock: '100', created_at: 2000 });
    ingestEvent(v2);
    ingestEvent(deletionEvent(owner, [{ e: v2.id }], now()));
    const v3 = listingEvent(owner, { price: '6.00', stock: '100', created_at: 3000 });
    ingestEvent(v3);
    expect(listingRow().event_id).toBe(v3.id);
    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: itemA(), qty: '2', unitPrice: '6.00', total: '14.50' }));
    pay(b, id, '14.50');
    expect(row(id).payment_state).toBe('paid');

    // a version deleted before it landed blocks only itself and what is older
    const v4 = listingEvent(owner, { price: '7.00', stock: '100', created_at: 4000 });
    const v5 = listingEvent(owner, { price: '8.00', stock: '100', created_at: 5000 });
    ingestEvent(deletionEvent(owner, [{ e: v4.id }], now()));
    ingestEvent(v4);
    expect(listingRow()).toBeUndefined();
    ingestEvent(v5);
    expect(listingRow().event_id).toBe(v5.id);

    ingestEvent(deletionEvent(owner, [{ e: unitNow.id }], now()));
    expect(unitRows()).toBe(0);
    const u3 = unitEvent(owner, { fee: '3.00', created_at: now() + 5 });
    ingestEvent(u3);
    expect(unitRows()).toBe(1);
  });

  it('a stranger\'s `e` deletion deletes nothing — not the row, not a tombstone, not a later landing', () => {
    ingestEvent(deletionEvent(stranger, [{ e: v1.id }, { e: unitNow.id }], now()));
    expect(listingRow().event_id).toBe(v1.id);
    expect(unitRows()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()).toEqual({ n: 0 });

    const v2 = listingEvent(owner, { price: '6.00', stock: '100', created_at: 2000 });
    ingestEvent(deletionEvent(stranger, [{ e: v2.id }], now()));
    ingestEvent(v2);
    expect(listingRow().event_id).toBe(v2.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tombstones').get()).toEqual({ n: 0 });
  });

  it('the shop\'s orders are judged again as soon as a listing or the 30901 is deleted (`e` and `a`)', () => {
    const b = key(), id = orderIdFor(b);
    ingestEvent(orderEvent(b, { orderId: id, ownerHex: owner.pk, itemA: itemA() }));
    expect(row(id).expected_total).toBe('12.50');
    ingestEvent(deletionEvent(owner, [{ e: v1.id }], now()));
    expect(row(id).expected_total).toBe(''); // no status read in between

    const v2 = listingEvent(owner, { price: '5.00', stock: '100', created_at: 2000 });
    ingestEvent(v2);
    expect(row(id).expected_total).toBe('12.50');
    ingestEvent(deletionEvent(owner, [{ a: itemA() }], now() + 1));
    expect(row(id).expected_total).toBe('');

    const v3 = listingEvent(owner, { price: '5.00', stock: '100', created_at: now() + 10 });
    ingestEvent(v3);
    expect(row(id).expected_total).toBe('12.50');
    pay(b, id, '12.50');
    expect(row(id).payment_state).toBe('paid');
    ingestEvent(deletionEvent(owner, [{ e: unitNow.id }], now()));
    expect(row(id).payment_state).toBe('amount_mismatch'); // shop unknown: never paid, the pin is kept
    expect(row(id).settled_order_event_id).toBe(row(id).order_event_id);
  });
});
