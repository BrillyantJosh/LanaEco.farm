// @vitest-environment node
/**
 * /api/orders — the portal never trusts a price the browser sent, forwards
 * only what the broker contract needs, and never leaks PII.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { createOrdersRouter } from './orders.js';
import { initLiveSyncDb, ingestEvent } from '../lib/liveSync.js';
import { bindingString } from '../lib/orderResolver.js';
import {
  key, makeDb, seed38888, unitEvent, suspensionEvent, listingEvent, orderEvent, deliveryEvent,
  purchaseEvent, fulfillmentEvent, orderIdFor, dumpDb, signed, PII, UNIT_ID, LISTING_ID, type Key, type UnitOpts, type ListingOpts,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let app: express.Express;
let owner: Key, brain: Key, buyer: Key, processor: Key;
let itemA: string;

const BROKER = 'http://broker.test';

function seedShop(unit: UnitOpts = {}, listing: ListingOpts = {}) {
  ingestEvent(unitEvent(owner, { fee: '2.50', pickup: true, ...unit }));
  ingestEvent(suspensionEvent(processor, owner));
  ingestEvent(listingEvent(owner, { price: '5.00', stock: '10', minOrder: '1', maxOrder: '4', ...listing }));
}

function quote(body: any) {
  return request(app).post('/api/orders/quote').send(body);
}

function goodOrder(over: Partial<Parameters<typeof orderEvent>[1]> = {}) {
  const orderId = over.orderId ?? orderIdFor(buyer);
  const order = orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, ...over });
  const delivery = deliveryEvent(buyer, orderId, owner.pk);
  return { orderId, order, delivery };
}

function stubBroker(status = 201, body: any = {}) {
  const fn = vi.fn(async (url: string, init: any) => ({
    status,
    ok: status < 400,
    json: async () => ({ order_id: JSON.parse(init?.body || '{}')?.order?.tags?.[0]?.[1], pay_url: `${BROKER}/pay/tok`, session_id: 'sess_1', expires_at: '2026-09-03T10:00:00Z', ...body }),
  }));
  (globalThis as any).fetch = fn;
  return fn;
}

beforeEach(() => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); brain = key(); buyer = key(); processor = key();
  seed38888(db, [brain.pk, processor.pk]);
  itemA = `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`;
  process.env.SHOP_ORDERS_URL = BROKER;
  // Unset: the portal id at the broker defaults to this portal's own.
  delete process.env.PORTAL_ID;
  process.env.PORTAL_PUBLIC_URL = 'http://localhost:5173';
  app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/orders', createOrdersRouter(db));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
});

describe('POST /api/orders/quote', () => {
  it('prices from the merchant-signed listing; client prices are not an input', async () => {
    seedShop();
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 2, fulfillment: 'shipping', unitPrice: '0.01', total: '0.02' });
    expect(r.status).toBe(200);
    expect(r.body.items[0].unitPrice).toBe('5.00');
    expect(r.body.shipping).toBe('2.50');
    expect(r.body.total).toBe('12.50');
    expect(r.body.currency).toBe('EUR');
    expect(r.body.unitOwnerHex).toBe(owner.pk);
    expect(r.body.fulfillmentModes).toEqual(['shipping', 'pickup']);
    expect(r.body.rawUnitEvent.pubkey).toBe(owner.pk);
    expect(r.body.rawUnitEvent.sig).toBeTruthy();
    expect(Array.isArray(r.body.relays)).toBe(true);
  });
  it('pickup has no shipping fee; free-shipping threshold zeroes it', async () => {
    seedShop({ freeFrom: '20.00' });
    const p = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 2, fulfillment: 'pickup' });
    expect(p.body.shipping).toBe('0.00');
    expect(p.body.total).toBe('10.00');
    const f = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 4, fulfillment: 'shipping' });
    expect(f.body.shipping).toBe('0.00');
    expect(f.body.total).toBe('20.00');
  });
  it('fail-closed: unknown unit', async () => {
    ingestEvent(listingEvent(owner, { price: '5.00' }));
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NOT_BUYABLE');
  });
  it('fail-closed: online_shop tag absent', async () => {
    seedShop({ onlineShop: 'absent' });
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'online_shop_off' });
  });
  it('fail-closed: no KIND 30903 allowlist entry', async () => {
    ingestEvent(unitEvent(owner, { fee: '2.50' }));
    ingestEvent(listingEvent(owner, { price: '5.00' }));
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' });
    expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'registration_inactive' });
  });
  it('currency mismatch between listing and unit', async () => {
    seedShop({}, { currency: 'GBP' });
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CURRENCY_MISMATCH');
  });
  it('sold_out listing / zero stock', async () => {
    seedShop({}, { status: 'sold_out' });
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' })).body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'sold_out' });
    ingestEvent(listingEvent(owner, { price: '5.00', stock: '0', created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' })).body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'sold_out' });
  });
  it('qty bounds: min_order / max_order / stock minus paid', async () => {
    seedShop({}, { minOrder: '2', maxOrder: '4', stock: '3', created_at: 1000 });
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' })).body.code).toBe('QTY_UNAVAILABLE');
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 4, fulfillment: 'shipping' })).body.code).toBe('QTY_UNAVAILABLE');
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 3, fulfillment: 'shipping' })).status).toBe(200);
    // 2 paid since the listing was published → only 1 left
    const paidId = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId: paidId, ownerHex: owner.pk, itemA }));
    ingestEvent(purchaseEvent(brain, { invoiceNumber: paidId, receiptDescription: bindingString(buyer.pk, paidId) }));
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 2, fulfillment: 'shipping' })).body.code).toBe('QTY_UNAVAILABLE');
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 0, fulfillment: 'shipping' })).body.code).toBe('QTY_UNAVAILABLE');
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1.5, fulfillment: 'shipping' })).body.code).toBe('QTY_UNAVAILABLE');
  });
  it('pickup on a unit without online_shop_pickup is rejected', async () => {
    seedShop({ pickup: false });
    const r = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'pickup' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_REQUEST');
  });
});

describe('POST /api/orders', () => {
  it('re-derives the quote and forwards {order, delivery, portal_id} with X-Portal-Id', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ order_id: orderId, pay_url: `${BROKER}/pay/tok`, expires_at: '2026-09-03T10:00:00Z' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BROKER}/api/shop-orders`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Portal-Id']).toBe('lanaeco-farm');
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(['delivery', 'order', 'portal_id']);
    expect(sent.portal_id).toBe('lanaeco-farm');
    // finalizeEvent tags the object with a Symbol(verified) that JSON drops
    expect(sent.order).toEqual(JSON.parse(JSON.stringify(order)));
    expect(sent.delivery).toEqual(JSON.parse(JSON.stringify(delivery)));

    // mirrored locally as placed + unpaid, pay_url kept for the status page
    const row = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) as any;
    expect(row.local_status).toBe('placed');
    expect(row.payment_state).toBe('unpaid');
    expect(row.pay_url).toBe(`${BROKER}/pay/tok`);
  });
  it('re-derivation mismatch → 409 PRICE_MISMATCH (cheaper unit_price)', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { order, delivery } = goodOrder({ unitPrice: '0.01', total: '2.52' });
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRICE_MISMATCH');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('re-derivation mismatch → 409 (shipping fee dropped, total right for pickup but tag says shipping)', async () => {
    seedShop();
    stubBroker(201);
    const { order, delivery } = goodOrder({ shipping: '0.00', total: '10.00' });
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRICE_MISMATCH');
  });
  it('quote gates apply to the order too (currency mismatch, sold out)', async () => {
    seedShop({}, { currency: 'GBP' });
    stubBroker(201);
    const { order, delivery } = goodOrder();
    expect((await request(app).post('/api/orders').send({ order, delivery })).body.code).toBe('CURRENCY_MISMATCH');
    ingestEvent(listingEvent(owner, { price: '5.00', status: 'sold_out', created_at: Math.floor(Date.now() / 1000) + 5 }));
    const g2 = goodOrder();
    expect((await request(app).post('/api/orders').send({ order: g2.order, delivery: g2.delivery })).body.code).toBe('NOT_BUYABLE');
  });
  it('rejects non-empty content, bad signature, stale created_at, wrong pay_by', async () => {
    seedShop();
    stubBroker(201);
    const c = goodOrder({ content: 'x' });
    expect((await request(app).post('/api/orders').send({ order: c.order, delivery: c.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'content' });
    const g = goodOrder();
    const forged = { ...g.order, tags: g.order.tags.map(t => (t[0] === 'total' ? ['total', '0.01', 'EUR'] : t)) };
    expect((await request(app).post('/api/orders').send({ order: forged, delivery: g.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'signature' });
    const old = goodOrder({ created_at: Math.floor(Date.now() / 1000) - 3600 });
    expect((await request(app).post('/api/orders').send({ order: old.order, delivery: old.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'created_at' });
    const pb = goodOrder({ payBy: Math.floor(Date.now() / 1000) + 99999 });
    expect((await request(app).post('/api/orders').send({ order: pb.order, delivery: pb.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'pay_by' });
  });
  it('delivery must bind to the same order and to the unit owner', async () => {
    seedShop();
    stubBroker(201);
    const other = key();
    const { orderId, order } = goodOrder();
    const wrongSigner = deliveryEvent(other, orderId, owner.pk);
    expect((await request(app).post('/api/orders').send({ order, delivery: wrongSigner })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'pubkey' });
    const wrongRecipient = deliveryEvent(buyer, orderId, other.pk);
    expect((await request(app).post('/api/orders').send({ order, delivery: wrongRecipient })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'delivery_d' });
  });
  it('503 ORDERING_UNAVAILABLE when SHOP_ORDERS_URL is unset or unreachable', async () => {
    seedShop();
    const { order, delivery } = goodOrder();
    delete process.env.SHOP_ORDERS_URL;
    expect((await request(app).post('/api/orders').send({ order, delivery })).status).toBe(503);
    process.env.SHOP_ORDERS_URL = BROKER;
    (globalThis as any).fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ORDERING_UNAVAILABLE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
  });
  it('broker errors pass through with their code and nothing is mirrored', async () => {
    seedShop();
    stubBroker(404, { error: 'MERCHANT_NOT_ENROLLED', code: 'MERCHANT_NOT_ENROLLED' });
    const { order, delivery } = goodOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('MERCHANT_NOT_ENROLLED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
  });
  it('caps: a 6th open order for the same buyer key is refused', async () => {
    seedShop({}, { maxOrder: '' , stock: '' });
    stubBroker(201);
    for (let i = 0; i < 5; i++) {
      const g = goodOrder();
      expect((await request(app).post('/api/orders').send({ order: g.order, delivery: g.delivery })).status).toBe(201);
    }
    const g = goodOrder();
    const r = await request(app).post('/api/orders').send({ order: g.order, delivery: g.delivery });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOO_MANY_OPEN_ORDERS');
  });
});

describe('GET /api/orders/:orderId', () => {
  it('public view has no PII and no ciphertext; DB has no PII either', async () => {
    seedShop();
    stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: `Jabolka ×2 · ${bindingString(buyer.pk, orderId)}` }));
    ingestEvent(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', carrier: 'Pošta', tracking: 'RR1' }));

    const r = await request(app).get(`/api/orders/${orderId}`);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const v of [PII.name, PII.email, PII.phone, PII.address.line1, PII.note, delivery.content]) {
      expect(text).not.toContain(v);
    }
    expect(text).not.toContain(delivery.id);
    expect(r.body).toMatchObject({
      orderId, unitId: UNIT_ID, unitName: 'Test Shop', total: '12.50', shipping: '2.50', currency: 'EUR',
      fulfillment: 'shipping', buyerStatus: 'placed', paymentState: 'paid', effectiveStatus: 'shipped',
      carrier: 'Pošta', tracking: 'RR1', lanaAmount: '12500',
    });
    expect(r.body.items[0]).toMatchObject({ a: itemA, qty: 2, unitPrice: '5.00', title: 'Jabolka' });
    expect(r.body.payUrl).toBeUndefined(); // paid → no pay link
    expect(dumpDb(db)).not.toMatch(/Janez|Trubarjeva|example\.com|pozvoni/);
  });
  it('unpaid placed order exposes payUrl; unknown id is 404', async () => {
    seedShop();
    stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    const r = await request(app).get(`/api/orders/${orderId}`);
    expect(r.body.paymentState).toBe('unpaid');
    expect(r.body.payUrl).toBe(`${BROKER}/pay/tok`);
    expect((await request(app).get(`/api/orders/${orderIdFor(buyer)}`)).status).toBe(404);
    expect((await request(app).get(`/api/orders/not-an-id`)).status).toBe(404);
  });
  it('an order placed on another portal is not shown here (its client is another host)', async () => {
    seedShop();
    const id = orderIdFor(buyer);
    // what the relays deliver: a valid order whose checkout ran on lanaeco.shop
    ingestEvent(orderEvent(buyer, { orderId: id, ownerHex: owner.pk, itemA, client: 'lanaeco.shop' }));
    expect(db.prepare('SELECT order_id FROM orders WHERE order_id = ?').get(id)).toBeTruthy();
    expect((await request(app).get(`/api/orders/${id}`)).status).toBe(404);
    // this portal's own host (www. or not) is shown
    process.env.PORTAL_PUBLIC_URL = 'https://www.lanaeco.farm';
    const own = orderIdFor(buyer);
    ingestEvent(orderEvent(buyer, { orderId: own, ownerHex: owner.pk, itemA, client: 'www.lanaeco.farm' }));
    expect((await request(app).get(`/api/orders/${own}`)).status).toBe(200);
    expect((await request(app).get(`/api/orders/${id}`)).status).toBe(404);
    // no PORTAL_PUBLIC_URL: no host to compare with, so nothing is hidden (as POST / then accepts any client)
    delete process.env.PORTAL_PUBLIC_URL;
    expect((await request(app).get(`/api/orders/${id}`)).status).toBe(200);
  });
  it('PORTAL_ID, when set, is the id the broker is told', async () => {
    seedShop();
    process.env.PORTAL_ID = 'lanaeco-farm-test';
    const fetchMock = stubBroker(201);
    const { order, delivery } = goodOrder();
    expect((await request(app).post('/api/orders').send({ order, delivery })).status).toBe(201);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Portal-Id']).toBe('lanaeco-farm-test');
    expect(JSON.parse(init.body).portal_id).toBe('lanaeco-farm-test');
  });
  it('?src=pay asks the broker once but never stores its word as payment', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    fetchMock.mockImplementation(async () => ({ status: 200, ok: true, json: async () => ({ status: 'paid', pay_url: `${BROKER}/pay/tok` }) }));
    const r = await request(app).get(`/api/orders/${orderId}?src=pay`);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BROKER}/api/shop-orders/${orderId}/status`, expect.objectContaining({ method: 'GET' }));
    expect(r.body.paymentState).toBe('unpaid'); // relay 30933 is the only truth
    await request(app).get(`/api/orders/${orderId}?src=pay`);
    expect(fetchMock).toHaveBeenCalledTimes(2); // throttled: create + one status ask
  });
});

describe('cancel / retry', () => {
  it('cancel forwards a buyer-signed cancelled republish and mirrors it', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    fetchMock.mockImplementation(async () => ({ status: 200, ok: true, json: async () => ({ ok: true }) }));
    const cancel = orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, status: 'cancelled', created_at: order.created_at + 5, payBy: order.created_at + 1800 });
    const r = await request(app).post(`/api/orders/${orderId}/cancel`).send({ event: cancel });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BROKER}/api/shop-orders/${orderId}/cancel`, expect.objectContaining({ method: 'POST' }));
    expect((await request(app).get(`/api/orders/${orderId}`)).body.paymentState).toBe('cancelled');
  });
  it('cancel by another key is 403; cancel after payment is 409', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    const other = key();
    const forged = orderEvent(other, { orderId, ownerHex: owner.pk, itemA, status: 'cancelled', created_at: order.created_at + 5 });
    expect((await request(app).post(`/api/orders/${orderId}/cancel`).send({ event: forged })).status).toBe(400); // prefix rule
    ingestEvent(purchaseEvent(brain, { invoiceNumber: orderId, receiptDescription: bindingString(buyer.pk, orderId) }));
    const cancel = orderEvent(buyer, { orderId, ownerHex: owner.pk, itemA, status: 'cancelled', created_at: order.created_at + 5 });
    expect((await request(app).post(`/api/orders/${orderId}/cancel`).send({ event: cancel })).body.code).toBe('NOT_CANCELLABLE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retry needs a NEW id with the supersedes tag and hits retry-payment', async () => {
    seedShop();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = goodOrder();
    await request(app).post('/api/orders').send({ order, delivery });
    const buyer2 = key();
    const newId = orderIdFor(buyer2);
    const order2 = orderEvent(buyer2, { orderId: newId, ownerHex: owner.pk, itemA, supersedes: `36520:${buyer.pk}:${orderId}` });
    const delivery2 = deliveryEvent(buyer2, newId, owner.pk);
    const r = await request(app).post(`/api/orders/${orderId}/retry`).send({ order: order2, delivery: delivery2 });
    expect(r.status).toBe(201);
    expect(r.body.order_id).toBe(newId);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BROKER}/api/shop-orders/${orderId}/retry-payment`, expect.anything());
    // missing supersedes → rejected
    const bare = orderEvent(buyer2, { orderId: orderIdFor(buyer2), ownerHex: owner.pk, itemA });
    const r2 = await request(app).post(`/api/orders/${orderId}/retry`).send({ order: bare, delivery: deliveryEvent(buyer2, bare.tags[0][1], owner.pk) });
    expect(r2.status).toBe(400);
  });

  it('retry of an order our mirror never saw: B_old comes from the supersedes tag and must satisfy the prefix rule', async () => {
    seedShop();
    stubBroker(201);
    const oldBuyer = key();
    const oldId = orderIdFor(oldBuyer); // never POSTed / never mirrored
    const buyer2 = key();
    const good = orderEvent(buyer2, { orderId: orderIdFor(buyer2), ownerHex: owner.pk, itemA, supersedes: `36520:${oldBuyer.pk}:${oldId}` });
    const r = await request(app).post(`/api/orders/${oldId}/retry`).send({ order: good, delivery: deliveryEvent(buyer2, good.tags[0][1], owner.pk) });
    expect(r.status).toBe(201);
    // the NEW key can never pose as B_old (prefix rule fails)
    const bad = orderEvent(buyer2, { orderId: orderIdFor(buyer2), ownerHex: owner.pk, itemA, supersedes: `36520:${buyer2.pk}:${oldId}` });
    const r2 = await request(app).post(`/api/orders/${oldId}/retry`).send({ order: bad, delivery: deliveryEvent(buyer2, bad.tags[0][1], owner.pk) });
    expect(r2.status).toBe(400);
    expect(r2.body.reason).toBe('supersedes');
  });
});

// ─────────────────────────────────────────── cart: several items of ONE shop (SPEC v1.1.0)

describe('cart — one order with several products of one shop', () => {
  const PEARS = 'lst-pears';
  let itemB: string;

  /** Živa-like shop: 5.00 shipping; apples 4.50 / kg, pears 3.98 / piece. */
  function seedCart(unit: UnitOpts = {}) {
    ingestEvent(unitEvent(owner, { fee: '5.00', pickup: true, ...unit }));
    ingestEvent(suspensionEvent(processor, owner));
    ingestEvent(listingEvent(owner, { price: '4.50', stock: '10' }));
    ingestEvent(listingEvent(owner, { listingId: PEARS, title: 'Hruške', price: '3.98', unit: 'piece', stock: '10', maxOrder: '5' }));
    itemB = `${LISTING_KIND}:${owner.pk}:${PEARS}`;
  }
  const lines = (a = 3, b = 2) => [
    { pubkey: owner.pk, listingId: LISTING_ID, qty: a },
    { pubkey: owner.pk, listingId: PEARS, qty: b },
  ];
  /** The two item tags exactly as the quote prices them. */
  const cartItems = (a = '3', b = '2', priceB = '3.98') => [
    ['item', itemA, a, 'kg', '4.50', 'EUR'],
    ['item', itemB, b, 'piece', priceB, 'EUR'],
  ];
  function cartOrder(over: Partial<Parameters<typeof orderEvent>[1]> = {}) {
    return goodOrder({ items: cartItems(), shipping: '5.00', total: '26.46', ...over });
  }

  afterEach(() => { delete process.env.SHOP_MAX_ITEMS; });

  it('quote: Σ(price × qty) + shipping ONCE, in integer cents: 4.50 × 3 + 3.98 × 2 + 5.00 = 26.46', async () => {
    seedCart();
    const r = await quote({ lines: lines(), fulfillment: 'shipping' });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => [i.a, i.qty, i.saleUnit, i.unitPrice])).toEqual([
      [itemA, 3, 'kg', '4.50'],
      [itemB, 2, 'piece', '3.98'],
    ]);
    expect(r.body.shipping).toBe('5.00');
    expect(r.body.total).toBe('26.46');
    expect(r.body.maxItems).toBe(30); // cart on by default since 2 Oct 2026; SHOP_MAX_ITEMS=1 turns it down
  });
  it('quote: request order is kept, and prices the browser sends are no input', async () => {
    seedCart();
    const r = await quote({ lines: [{ ...lines()[1], unitPrice: '0.01' }, { ...lines()[0], price: '0.01' }], fulfillment: 'shipping', total: '0.02' });
    expect(r.body.items.map((i: any) => i.unitPrice)).toEqual(['3.98', '4.50']);
    expect(r.body.total).toBe('26.46');
  });
  it('shipping is decided by the WHOLE subtotal: two lines each under free-from, together over it → 0.00', async () => {
    seedCart({ freeFrom: '20.00' });
    const one = await quote({ lines: [lines()[0]], fulfillment: 'shipping' });
    expect(one.body.shipping).toBe('5.00'); // 13.50 alone
    const r = await quote({ lines: lines(), fulfillment: 'shipping' });
    expect(r.body.shipping).toBe('0.00'); // 13.50 + 7.96 = 21.46
    expect(r.body.total).toBe('21.46');
    expect((await quote({ lines: lines(), fulfillment: 'pickup' })).body.total).toBe('21.46');
  });
  it('the same product twice is refused (stock / max_order could be split around)', async () => {
    seedCart();
    const r = await quote({ lines: [lines()[0], { ...lines()[0], qty: 1 }], fulfillment: 'shipping' });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'duplicate_item', line: 1 });
  });
  it('products of two different shops never share one order', async () => {
    seedCart();
    const other = key();
    ingestEvent(unitEvent(other, { unitId: 'b'.repeat(32), fee: '3.50' }));
    ingestEvent(suspensionEvent(processor, other, 'b'.repeat(32)));
    ingestEvent(listingEvent(other, { unitId: 'b'.repeat(32), listingId: 'lst-x', price: '1.00' }));
    const r = await quote({ lines: [lines()[0], { pubkey: other.pk, listingId: 'lst-x', qty: 1 }], fulfillment: 'shipping' });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'mixed_units', line: 1 });
  });
  it('a line over its limit names the line and the range it accepts', async () => {
    seedCart();
    const r = await quote({ lines: lines(3, 6), fulfillment: 'shipping' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'QTY_UNAVAILABLE', line: 1, min: 1, max: 5 });
    const gone = await quote({ lines: [lines()[0], { pubkey: owner.pk, listingId: 'lst-none', qty: 1 }], fulfillment: 'shipping' });
    expect(gone.body).toMatchObject({ code: 'NOT_BUYABLE', line: 1 });
  });
  it('a refusal about the whole shop names no line (scope shop), so no product is offered for removal', async () => {
    seedCart();
    // The registrar suspends the shop for a while.
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'suspended', Math.floor(Date.now() / 1000) + 5));
    const r = await quote({ lines: lines(), fulfillment: 'shipping', unitId: UNIT_ID });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'registration_inactive', scope: 'shop' });
    expect(r.body.line).toBeUndefined();
    // …the same without unitId (older pages)
    const old = await quote({ lines: lines(), fulfillment: 'shipping' });
    expect(old.body).toMatchObject({ code: 'NOT_BUYABLE', scope: 'shop' });
    expect(old.body.line).toBeUndefined();
  });
  it('a shop that is gone from the mirror is refused for the whole shop', async () => {
    seedCart();
    const r = await quote({ lines: lines(), fulfillment: 'shipping', unitId: 'c'.repeat(32) });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'unit_unknown', scope: 'shop' });
    expect(r.body.line).toBeUndefined();
  });
  it('with the cart\'s unitId, a product that moved to another unit is the line refused — not its neighbours', async () => {
    seedCart();
    const OTHER = 'b'.repeat(32);
    ingestEvent(unitEvent(owner, { unitId: OTHER, fee: '5.00' }));
    ingestEvent(suspensionEvent(processor, owner, OTHER));
    ingestEvent(listingEvent(owner, { listingId: PEARS, unitId: OTHER, title: 'Hruške', price: '3.98', unit: 'piece', stock: '10', created_at: Math.floor(Date.now() / 1000) + 5 }));
    // pears (moved) first: without the shop the later, unmoved line would be blamed
    const blind = await quote({ lines: [lines()[1], lines()[0]], fulfillment: 'shipping' });
    expect(blind.body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'mixed_units', line: 1 });
    const r = await quote({ lines: [lines()[1], lines()[0]], fulfillment: 'shipping', unitId: UNIT_ID });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'unit_changed', line: 0 });
    // the apples alone are still a good quote for this shop
    const ok = await quote({ lines: [lines()[0]], fulfillment: 'shipping', unitId: UNIT_ID });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe('18.50');
  });
  it('at most 30 lines per quote; an empty cart is no request', async () => {
    seedCart();
    const many = Array.from({ length: 31 }, (_, i) => ({ pubkey: owner.pk, listingId: `l${i}`, qty: 1 }));
    expect((await quote({ lines: many, fulfillment: 'shipping' })).body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'too_many_items' });
    expect((await quote({ lines: [], fulfillment: 'shipping' })).body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'lines' });
  });
  it('a one-line cart quote is the same quote as the single-item quote', async () => {
    seedCart();
    const a = await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 2, fulfillment: 'shipping' });
    const b = await quote({ lines: [{ pubkey: owner.pk, listingId: LISTING_ID, qty: 2 }], fulfillment: 'shipping' });
    const strip = (q: any) => { const { payBy: _p, ...rest } = q; return rest; };
    expect(strip(b.body)).toEqual(strip(a.body));
  });

  it('SHOP_MAX_ITEMS=1: a 2-item order is refused and never reaches the broker', async () => {
    process.env.SHOP_MAX_ITEMS = '1';
    seedCart();
    const fetchMock = stubBroker(201);
    const { order, delivery } = cartOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_EVENT', reason: 'too_many_items' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('SHOP_MAX_ITEMS=30: ONE order with both items is re-derived and forwarded; the status page lists both', async () => {
    process.env.SHOP_MAX_ITEMS = '30';
    seedCart();
    const fetchMock = stubBroker(201);
    const { orderId, order, delivery } = cartOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).order.tags.filter((t: string[]) => t[0] === 'item')).toEqual(cartItems());
    const v = await request(app).get(`/api/orders/${orderId}`);
    expect(v.body.items.map((i: any) => [i.title, i.qty, i.unitPrice])).toEqual([['Jabolka', 3, '4.50'], ['Hruške', 2, '3.98']]);
    expect(v.body.total).toBe('26.46');
  });
  it('tampered 2nd line unit_price (even with a matching total) → 409 PRICE_MISMATCH', async () => {
    process.env.SHOP_MAX_ITEMS = '30';
    seedCart();
    const fetchMock = stubBroker(201);
    const { order, delivery } = cartOrder({ items: cartItems('3', '2', '1.00'), total: '20.50' });
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRICE_MISMATCH');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('shape: repeated item, a foreign item owner, or item tags that are not contiguous are refused', async () => {
    process.env.SHOP_MAX_ITEMS = '30';
    seedCart();
    stubBroker(201);
    const dup = cartOrder({ items: [cartItems()[0], cartItems()[0]], total: '32.00' });
    expect((await request(app).post('/api/orders').send({ order: dup.order, delivery: dup.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'duplicate_item', line: 1 });
    const foreign = cartOrder({ items: [cartItems()[0], ['item', `${LISTING_KIND}:${key().pk}:x`, '1', 'piece', '1.00', 'EUR']] });
    expect((await request(app).post('/api/orders').send({ order: foreign.order, delivery: foreign.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'item', line: 1 });
    // an item tag after `shipping` breaks the frozen tag order
    const g = cartOrder({ items: [cartItems()[0]] });
    const moved = orderEvent(buyer, { orderId: g.orderId, ownerHex: owner.pk, itemA, items: [cartItems()[0]], shipping: '5.00', total: '26.46' });
    const tags = moved.tags.filter(t => t[0] !== 'shipping');
    tags.splice(6, 0, ['shipping', '5.00', 'EUR']); // d a p unit_id invoice item shipping …
    tags.splice(7, 0, cartItems()[1]);
    const bad = signedLike(moved, tags);
    expect((await request(app).post('/api/orders').send({ order: bad, delivery: g.delivery })).body).toMatchObject({ code: 'INVALID_EVENT', reason: 'tags' });
  });
  it('the mirror judges a paid cart by EACH item\'s own price: exact → paid, item-1 price for all → amount_mismatch', async () => {
    process.env.SHOP_MAX_ITEMS = '30';
    seedCart();
    stubBroker(201);
    const ok = cartOrder();
    await request(app).post('/api/orders').send({ order: ok.order, delivery: ok.delivery });
    ingestEvent(purchaseEvent(brain, { invoiceNumber: ok.orderId, amount: '26.46', receiptDescription: `Jabolka ×3 (+1) · ${bindingString(buyer.pk, ok.orderId)}` }));
    expect((await request(app).get(`/api/orders/${ok.orderId}`)).body.paymentState).toBe('paid');

    const buyer2 = key();
    const id2 = orderIdFor(buyer2);
    const o2 = orderEvent(buyer2, { orderId: id2, ownerHex: owner.pk, itemA, items: cartItems(), shipping: '5.00', total: '26.46' });
    await request(app).post('/api/orders').send({ order: o2, delivery: deliveryEvent(buyer2, id2, owner.pk) });
    ingestEvent(purchaseEvent(brain, { invoiceNumber: id2, amount: '27.50', receiptDescription: bindingString(buyer2.pk, id2) }));
    expect((await request(app).get(`/api/orders/${id2}`)).body.paymentState).toBe('amount_mismatch');
  });
  it('stock left counts every item line of paid carts', async () => {
    process.env.SHOP_MAX_ITEMS = '30';
    seedCart();
    stubBroker(201);
    // apples are the SECOND line here: 2 × 3.98 + 4 × 4.50 + 5.00 = 30.96
    const ok = cartOrder({ items: [['item', itemB, '2', 'piece', '3.98', 'EUR'], ['item', itemA, '4', 'kg', '4.50', 'EUR']], total: '30.96' });
    expect((await request(app).post('/api/orders').send({ order: ok.order, delivery: ok.delivery })).status).toBe(201);
    ingestEvent(purchaseEvent(brain, { invoiceNumber: ok.orderId, amount: '30.96', receiptDescription: bindingString(buyer.pk, ok.orderId) }));
    expect((await request(app).get(`/api/orders/${ok.orderId}`)).body.paymentState).toBe('paid');
    // apples: stock 10 − 4 paid = 6 left
    expect((await quote({ lines: [{ pubkey: owner.pk, listingId: LISTING_ID, qty: 6 }], fulfillment: 'shipping' })).status).toBe(200);
    const r = await quote({ lines: [{ pubkey: owner.pk, listingId: LISTING_ID, qty: 7 }], fulfillment: 'shipping' });
    expect(r.body).toMatchObject({ code: 'QTY_UNAVAILABLE', line: 0, min: 1, max: 6 });
  });
});

/** Re-sign an event with different tags under the same buyer key (test-only helper). */
function signedLike(ev: { pubkey: string; created_at: number; content: string }, tags: string[][]) {
  if (ev.pubkey !== buyer.pk) throw new Error('signedLike: only the test buyer');
  return signed(buyer, 36520, tags, ev.content, ev.created_at);
}

describe('hand-over on lanaeco.farm: the listing\'s own delivery tag', () => {
  const BEETS = 'lst-beets';
  const itemBeets = () => `${LISTING_KIND}:${owner.pk}:${BEETS}`;
  /** 5.00 shipping; apples (no delivery tag) + beetroot (delivery = pickup only). */
  function seedFarm(unit: UnitOpts = {}, beets: ListingOpts = {}) {
    ingestEvent(unitEvent(owner, { fee: '5.00', pickup: true, ...unit }));
    ingestEvent(suspensionEvent(processor, owner));
    ingestEvent(listingEvent(owner, { price: '5.00' }));
    ingestEvent(listingEvent(owner, { listingId: BEETS, title: 'Rdeča pesa', price: '4.00', delivery: ['pickup'], ...beets }));
  }
  const beets = (qty = 1) => ({ pubkey: owner.pk, listingId: BEETS, qty });

  it('a pickup-only listing is quoted for pickup only: no shipping fee, never as shipped goods', async () => {
    seedFarm();
    const ship = await quote({ ...beets(), fulfillment: 'shipping' });
    expect(ship.status).toBe(400);
    expect(ship.body).toMatchObject({ code: 'INVALID_REQUEST', reason: 'fulfillment' });
    const pick = await quote({ ...beets(2), fulfillment: 'pickup' });
    expect(pick.status).toBe(200);
    expect(pick.body.fulfillmentModes).toEqual(['pickup']);
    expect(pick.body.shipping).toBe('0.00');
    expect(pick.body.total).toBe('8.00');
  });
  it('a pickup-only listing of a shop without online pickup cannot be bought (pickup_only)', async () => {
    seedFarm({ pickup: false });
    for (const fulfillment of ['shipping', 'pickup']) {
      const r = await quote({ ...beets(), fulfillment });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'pickup_only' });
    }
    // the shop's other listing (no delivery tag) is unchanged
    expect((await quote({ pubkey: owner.pk, listingId: LISTING_ID, qty: 1, fulfillment: 'shipping' })).status).toBe(200);
  });
  it('local delivery or shipping in the tag keeps the shop\'s terms; farmers\' market or box scheme alone is pickup', async () => {
    seedFarm({}, { delivery: ['pickup', 'local_delivery'] });
    expect((await quote({ ...beets(), fulfillment: 'shipping' })).body.fulfillmentModes).toEqual(['shipping', 'pickup']);
    ingestEvent(listingEvent(owner, { listingId: BEETS, title: 'Rdeča pesa', price: '4.00', delivery: ['farmers_market', 'box_scheme'], created_at: Math.floor(Date.now() / 1000) + 5 }));
    expect((await quote({ ...beets(), fulfillment: 'shipping' })).body.reason).toBe('fulfillment');
    expect((await quote({ ...beets(), fulfillment: 'pickup' })).body.fulfillmentModes).toEqual(['pickup']);
  });
  it('a cart with one pickup-only line is a pickup order; the pickup-only line is named when pickup is off', async () => {
    seedFarm();
    const cart = [{ pubkey: owner.pk, listingId: LISTING_ID, qty: 1 }, beets()];
    expect((await quote({ lines: cart, fulfillment: 'shipping' })).body.reason).toBe('fulfillment');
    const r = await quote({ lines: cart, fulfillment: 'pickup' });
    expect(r.body.fulfillmentModes).toEqual(['pickup']);
    expect(r.body.total).toBe('9.00');
    ingestEvent(unitEvent(owner, { fee: '5.00', pickup: false, created_at: Math.floor(Date.now() / 1000) + 5 }));
    const off = await quote({ lines: cart, fulfillment: 'shipping' });
    expect(off.body).toMatchObject({ code: 'NOT_BUYABLE', reason: 'pickup_only', line: 1 });
  });
  it('an order that ships a pickup-only listing is refused; the pickup order is forwarded', async () => {
    seedFarm();
    const fetchMock = stubBroker(201);
    const shipped = goodOrder({ items: [['item', itemBeets(), '2', 'kg', '4.00', 'EUR']], shipping: '5.00', total: '13.00' });
    const r = await request(app).post('/api/orders').send({ order: shipped.order, delivery: shipped.delivery });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const picked = goodOrder({ items: [['item', itemBeets(), '2', 'kg', '4.00', 'EUR']], shipping: '0.00', total: '8.00', fulfillment: 'pickup' });
    expect((await request(app).post('/api/orders').send({ order: picked.order, delivery: picked.delivery })).status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('broker that does not know this portal yet', () => {
  it('"unknown portal_id" is told as ordering not switched on, not as "try again"', async () => {
    seedShop();
    stubBroker(400, { error: { code: 'INVALID_EVENT', message: 'unknown portal_id' } });
    const { order, delivery } = goodOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'ORDERING_UNAVAILABLE', reason: 'portal_unknown' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
  });
  it('any other INVALID_EVENT from the broker still passes through', async () => {
    seedShop();
    stubBroker(400, { error: { code: 'INVALID_EVENT', message: 'sig' } });
    const { order, delivery } = goodOrder();
    const r = await request(app).post('/api/orders').send({ order, delivery });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_EVENT');
  });
});
