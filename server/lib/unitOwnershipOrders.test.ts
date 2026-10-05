// @vitest-environment node
/**
 * A shop is (30901 signer, unit id), never the unit id alone — the online
 * shop side (buyable, quote, orders), ported from lanaeco-shop
 * server/lib/unitOwnership.test.ts on 5 Oct 2026. The catalogue / units-route
 * side is ./unitOwnership.test.ts.
 *
 * - A listing may name only its own signer's shop in its `a` tag
 *   (30901:<pubkey>:<unit id>). A stranger's listing pointing at another
 *   shop showed on that shop's page, in its unit filter and facets, with its
 *   name, and even buyable:true — checkout only rejected it later.
 * - A stranger's 30901 that reuses a shop's unit id is a DIFFERENT unit. It
 *   used to replace the shop's name, currency and owner (last row won), and
 *   on the order side (newest won) it could sign the shop's fulfilments and
 *   move the expected total of its orders.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { createListingsRouter } from '../routes/listings.js';
import { createOrdersRouter } from '../routes/orders.js';
import { initLiveSyncDb, ingestEvent } from './liveSync.js';
import { buildQuote, loadUnitMeta, unitKey, QuoteError } from './onlineShop.js';
import { parseListing } from './parsers.js';
import { bindingString } from './orderResolver.js';
import {
  key, makeDb, seed38888, signed, unitEvent, suspensionEvent, listingEvent, orderEvent,
  purchaseEvent, fulfillmentEvent, orderIdFor, UNIT_ID, LISTING_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let app: express.Express;
let owner: Key, stranger: Key, processor: Key, brain: Key, buyer: Key;
const T = Math.floor(Date.now() / 1000);

/** The stranger's listing, naming (by default) the OWNER's shop in its `a` tag. */
function strangerListing(a = `30901:${owner.pk}:${UNIT_ID}`, listingId = 'fake') {
  return signed(stranger, LISTING_KIND, [
    ['d', listingId], ['a', a], ['title', 'Ponaredek'], ['type', 'product'],
    ['price', '1.00', 'EUR'], ['unit', 'piece'], ['status', 'active'],
  ]);
}

/** The stranger's 30901 reusing the owner's unit id, newer than the owner's. */
function lookAlikeUnit(o: { fee?: string } = {}) {
  return unitEvent(stranger, { name: 'Lažna trgovina', currency: 'USD', fee: o.fee ?? '99.00', created_at: T + 10 });
}

const get = (path: string) => request(app).get(path);
const ids = (items: any[]) => items.map(i => i.listingId);

afterEach(() => {
  delete process.env.SHOP_ORDERS_URL;
});

beforeEach(() => {
  // a broker is configured: buyable reflects the shop alone
  process.env.SHOP_ORDERS_URL = 'http://broker.test';
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); stranger = key(); processor = key(); brain = key(); buyer = key();
  seed38888(db, [brain.pk, processor.pk]);
  ingestEvent(unitEvent(owner, { name: 'Kmetija Ana', fee: '2.50', created_at: T - 100 }));
  ingestEvent(suspensionEvent(processor, owner));
  ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', created_at: T - 50 }));
  app = express();
  app.use(express.json());
  app.use('/api/listings', createListingsRouter(db));
  app.use('/api/orders', createOrdersRouter(db));
});

describe('a listing may name only its signer\'s own shop', () => {
  it('a stranger\'s listing naming another shop is not mirrored', () => {
    ingestEvent(strangerListing());
    expect(db.prepare('SELECT COUNT(*) AS n FROM listings WHERE pubkey = ?').get(stranger.pk)).toEqual({ n: 0 });
  });

  it('the shop\'s own listing is still mirrored, even with the pubkey in capitals', async () => {
    const caps = signed(owner, LISTING_KIND, [
      ['d', 'caps'], ['a', `30901:${owner.pk.toUpperCase()}:${UNIT_ID}`], ['title', 'Hruške'], ['type', 'product'],
      ['price', '3.00', 'EUR'], ['unit', 'kg'], ['status', 'active'],
    ]);
    ingestEvent(caps);
    const r = await get('/api/listings');
    expect(ids(r.body).sort()).toEqual(['caps', LISTING_ID].sort());
    expect(r.body.find((l: any) => l.listingId === 'caps')).toMatchObject({ buyable: true, unitName: 'Kmetija Ana' });
    expect(buildQuote(db, { pubkey: owner.pk, listingId: 'caps', qty: 1, fulfillment: 'shipping' }).unitName).toBe('Kmetija Ana');
  });

  it('a row mirrored before the check stays out of the catalogue, the unit filter, buyable=1, the product page and the quote', async () => {
    const ev = strangerListing();
    db.prepare(`
      INSERT INTO listings (pubkey, listing_id, unit_id, event_id, event_created_at, parsed_json, raw_event, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stranger.pk, 'fake', UNIT_ID, ev.id, ev.created_at, JSON.stringify(parseListing(ev)), JSON.stringify(ev), T);

    expect(ids((await get('/api/listings')).body)).toEqual([LISTING_ID]);
    expect(ids((await get(`/api/listings?unit=${UNIT_ID}`)).body)).toEqual([LISTING_ID]);
    expect(ids((await get('/api/listings?buyable=1')).body)).toEqual([LISTING_ID]);
    expect((await get(`/api/listings/${stranger.pk}/fake`)).status).toBe(404);
    expect(() => buildQuote(db, { pubkey: stranger.pk, listingId: 'fake', qty: 1, fulfillment: 'shipping' }))
      .toThrow(QuoteError);
  });
});

describe('a stranger\'s 30901 reusing the unit id is a different unit', () => {
  beforeEach(() => {
    ingestEvent(lookAlikeUnit());
  });

  it('the shop keeps its name, currency, owner and buyability in the catalogue', async () => {
    const [l] = (await get('/api/listings')).body;
    expect(l).toMatchObject({
      listingId: LISTING_ID, unitName: 'Kmetija Ana', unitCurrency: 'EUR', unitOwnerHex: owner.pk,
      shippingFee: '2.50', buyable: true,
    });
  });

  it('checkout still quotes from the shop\'s own 30901', () => {
    const q = buildQuote(db, { pubkey: owner.pk, listingId: LISTING_ID, qty: 2, fulfillment: 'shipping' });
    expect(q).toMatchObject({ unitName: 'Kmetija Ana', unitOwnerHex: owner.pk, currency: 'EUR', shipping: '2.50', total: '12.50' });
  });

  it('loadUnitMeta keeps both units, each under its signer', () => {
    const m = loadUnitMeta(db);
    expect(m.size).toBe(2);
    expect(m.get(unitKey(owner.pk, UNIT_ID))).toMatchObject({ name: 'Kmetija Ana', currency: 'EUR', ownerHex: owner.pk });
    expect(m.get(unitKey(stranger.pk, UNIT_ID))).toMatchObject({ name: 'Lažna trgovina', currency: 'USD', ownerHex: stranger.pk });
  });
});

describe('an order reads the unit its `a` tag names (owner + unit id)', () => {
  let orderId: string;
  const row = () => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) as any;

  beforeEach(() => {
    orderId = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA: `${LISTING_KIND}:${owner.pk}:${LISTING_ID}` }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    ingestEvent(lookAlikeUnit());
  });

  it('the expected total and the payment stay on the shop\'s shipping fee', () => {
    expect(row()).toMatchObject({ expected_total: '12.50', payment_state: 'paid' });
  });

  it('the stranger cannot sign a fulfilment for the shop\'s order', () => {
    ingestEvent(fulfillmentEvent(stranger, { orderId, buyerPubkey: buyer.pk, ownerHex: stranger.pk, status: 'cancelled', created_at: T + 20 }));
    expect(row().fulfillment_event_id).toBeNull();
    expect(row().effective_status).toBe('paid');
  });

  it('the shop owner\'s fulfilment still counts', () => {
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', created_at: T + 20 }));
    expect(row().effective_status).toBe('shipped');
  });

  it('the order page shows the shop\'s name', async () => {
    const r = await get(`/api/orders/${orderId}`);
    expect(r.status).toBe(200);
    expect(r.body.unitName).toBe('Kmetija Ana');
  });
});
