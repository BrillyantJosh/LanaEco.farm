// @vitest-environment node
/**
 * GET /api/listings on lanaeco.farm — the array keeps its shape and gains the
 * Lana Online Shop fields (SPEC §9.3): kind, buyable, notBuyableReason,
 * unitCurrency, unitOwnerHex, unitName, shippingFee, pickup, availableQty.
 * Every listing that cannot be bought says WHY (notBuyableReason), so the
 * product page can tell the shopper instead of showing no button at all.
 * GET /api/listings/:pubkey/:listingId serves the product page.
 *
 * Ported from lanaeco-shop server/routes/listings.test.ts (5 Oct 2026), minus
 * the paged catalogue and the product-detail tags this portal does not use.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { createListingsRouter } from './listings.js';
import { createAdminRouter, ADMIN_HEXES } from './admin.js';
import { initLiveSyncDb, ingestEvent } from '../lib/liveSync.js';
import {
  key, makeDb, seed38888, signed, unitEvent, suspensionEvent, deletionEvent, UNIT_ID, type Key,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

let db: Database.Database;
let app: express.Express;
let owner: Key, processor: Key;

/** Keys of one GET /api/listings array item: the farm's parsed listing, then the shop fields. */
const KEYS = [
  'eventId', 'pubkey', 'createdAt', 'kind', 'content', 'listingId', 'unitRef', 'title', 'type', 'price',
  'priceCurrency', 'unit', 'status', 'stock', 'minOrder', 'maxOrder', 'preOrder', 'harvestDate',
  'harvestSeason', 'availableFrom', 'availableUntil', 'eco', 'cert', 'certUrl', 'tags', 'delivery',
  'deliveryRadiusKm', 'marketDays', 'subscriptionInterval', 'subscriptionContent', 'capacity',
  'durationMin', 'bookingRequired', 'images', 'thumbs', 'payment', 'lud16', 'geoLat', 'geoLon',
  'geoLabel', 'sprayLog', 'soilTestYear', 'youtubeUrl', 'url', 'language', 'cashbackPercent',
  'featured', 'featuredAt', 'buyable', 'notBuyableReason', 'unitCurrency', 'unitOwnerHex', 'unitName',
  'shippingFee', 'pickup', 'availableQty', 'fulfillmentModes', 'freeShippingFrom',
];

const T0 = Math.floor(Date.now() / 1000) - 10_000;

interface L { id: string; title: string; type?: string; price?: string; currency?: string; unit?: string; stock?: string; status?: string; extra?: string[][]; created_at?: number }

/** A producer listing (KIND 36500) as shop.lanapays.us publishes it. */
function listing(o: L) {
  const tags: string[][] = [
    ['d', o.id],
    ['a', `30901:${owner.pk}:${UNIT_ID}`],
    ['title', o.title],
    ['type', o.type ?? 'product'],
    ['price', o.price ?? '5.00', o.currency ?? 'EUR'],
    ['unit', o.unit ?? 'piece'],
    ['status', o.status ?? 'active'],
  ];
  if (o.stock !== undefined) tags.push(['stock', o.stock]);
  tags.push(...(o.extra ?? []));
  return signed(owner, LISTING_KIND, tags, 'Opis izdelka.', o.created_at);
}

const GRANOLA: L = { id: 'granola', title: 'Ekološka BG granola kokos & lešnik', price: '8.90', stock: '10', created_at: T0 + 1, extra: [['eco', 'organic'], ['pre_order', 'false']] };
const APPLES: L = { id: 'apples', title: 'Jabolka', type: 'produce', price: '2.40', unit: 'kg', created_at: T0 + 2, extra: [['harvest_season', 'autumn']] };
const HONEY: L = { id: 'honey', title: 'Cvetlični med', price: '9.00', stock: '0', created_at: T0 + 3 };
const EGGS: L = { id: 'eggs', title: 'Jajca', price: '3,50', created_at: T0 + 4 };
const JUICE: L = { id: 'juice', title: 'Jabolčni sok', price: '4.00', currency: 'USD', unit: 'L', created_at: T0 + 5 };

function seedFarm(unit: Parameters<typeof unitEvent>[1] = {}) {
  ingestEvent(unitEvent(owner, { name: 'Kmetija Test', fee: '4.50', pickup: true, ...unit }));
  ingestEvent(suspensionEvent(processor, owner));
  for (const l of [GRANOLA, APPLES, HONEY, EGGS, JUICE]) ingestEvent(listing(l));
}

const get = (path: string) => request(app).get(path);
const ids = (items: any[]) => items.map(i => i.listingId);
const byId = (items: any[]) => Object.fromEntries(items.map((l: any) => [l.listingId, l]));

beforeEach(() => {
  db = makeDb();
  initLiveSyncDb(db);
  owner = key(); processor = key();
  seed38888(db, [processor.pk]);
  process.env.SHOP_ORDERS_URL = 'http://broker.test';
  app = express();
  app.use(express.json());
  app.use('/api/listings', createListingsRouter(db));
  app.use('/api/admin', createAdminRouter(db));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SHOP_ORDERS_URL;
});

describe('GET /api/listings — the array with the online-shop fields', () => {
  it('every item has the farm listing keys plus the SPEC §9.3 fields, in this order', async () => {
    seedFarm();
    const r = await get('/api/listings');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(5);
    for (const item of r.body) expect(Object.keys(item)).toEqual(KEYS);
  });

  it('newest first; buyable and the reason come from the merchant-signed events', async () => {
    seedFarm();
    const r = await get('/api/listings');
    expect(ids(r.body)).toEqual(['juice', 'eggs', 'honey', 'apples', 'granola']);
    const by = byId(r.body);
    expect(by.granola).toMatchObject({
      buyable: true, notBuyableReason: null, availableQty: 10, kind: LISTING_KIND, unitName: 'Kmetija Test',
      unitCurrency: 'EUR', unitOwnerHex: owner.pk, shippingFee: '4.50', pickup: true, cashbackPercent: 5,
    });
    expect(by.apples).toMatchObject({ buyable: true, availableQty: null, unit: 'kg', harvestSeason: 'autumn' });
    expect(by.honey).toMatchObject({ buyable: false, notBuyableReason: 'sold_out', availableQty: 0 });
    expect(by.eggs).toMatchObject({ buyable: false, notBuyableReason: 'price_invalid' });
    expect(by.juice).toMatchObject({ buyable: false, notBuyableReason: 'currency_mismatch' });
  });

  it('a producer that has not turned on online selling: every listing says online_shop_off', async () => {
    seedFarm({ onlineShop: 'absent' });
    const r = await get('/api/listings');
    expect(r.body).toHaveLength(5);
    for (const l of r.body) {
      expect(l).toMatchObject({ buyable: false, notBuyableReason: 'online_shop_off', availableQty: null, unitName: 'Kmetija Test' });
    }
    expect((await get('/api/listings?buyable=1')).body).toEqual([]);
  });

  it('the filters still answer arrays, and buyable=1 keeps only what can be bought', async () => {
    seedFarm();
    expect((await get(`/api/listings?unit=${UNIT_ID}`)).body).toHaveLength(5);
    expect(ids((await get('/api/listings?buyable=1')).body)).toEqual(['apples', 'granola']);
    expect(ids((await get('/api/listings?buyable=true')).body)).toEqual(['apples', 'granola']);
    expect(ids((await get('/api/listings?eco=organic')).body)).toEqual(['granola']);
    expect(ids((await get('/api/listings?search=granola')).body)).toEqual(['granola']);
    expect(ids((await get('/api/listings?type=produce')).body)).toEqual(['apples']);
  });

  it('no broker configured (SHOP_ORDERS_URL unset): nothing is offered for sale, and it says why', async () => {
    delete process.env.SHOP_ORDERS_URL;
    seedFarm();
    const by = byId((await get('/api/listings')).body);
    expect(by.granola).toMatchObject({ buyable: false, notBuyableReason: 'ordering_unavailable', availableQty: 10 });
    expect(by.apples).toMatchObject({ buyable: false, notBuyableReason: 'ordering_unavailable' });
    // the merchant's own reasons still win: they say more than "not yet here"
    expect(by.honey.notBuyableReason).toBe('sold_out');
    expect(by.juice.notBuyableReason).toBe('currency_mismatch');
    expect((await get('/api/listings?buyable=1')).body).toEqual([]);
  });

  it('availableQty comes from PAID orders at request time', async () => {
    seedFarm();
    expect(byId((await get('/api/listings')).body).granola).toMatchObject({ availableQty: 10, buyable: true });
    db.prepare(`INSERT INTO orders (order_id, buyer_pubkey, unit_id, order_created_at, order_json, payment_state, fetched_at)
                VALUES ('o1', 'b', ?, ?, ?, 'paid', 0)`)
      .run(UNIT_ID, T0 + 100, JSON.stringify({ items: [{ a: `${LISTING_KIND}:${owner.pk}:granola`, qty: 10 }] }));
    expect(byId((await get('/api/listings')).body).granola).toMatchObject({ availableQty: 0, buyable: false, notBuyableReason: 'sold_out' });
  });

  it('hidden stays hidden: archived listing, suspended unit, a unit of another category', async () => {
    seedFarm();
    ingestEvent(listing({ id: 'old', title: 'Arhivirano', status: 'archived', created_at: T0 + 6 }));
    expect(ids((await get('/api/listings')).body)).not.toContain('old');
    ingestEvent(unitEvent(owner, { name: 'Trgovina', category: 'shop', created_at: Math.floor(Date.now() / 1000) + 1 }));
    expect((await get('/api/listings')).body).toEqual([]);
    ingestEvent(unitEvent(owner, { name: 'Kmetija Test', created_at: Math.floor(Date.now() / 1000) + 2 }));
    expect((await get('/api/listings')).body).toHaveLength(5);
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'suspended', Math.floor(Date.now() / 1000) + 3));
    expect((await get('/api/listings')).body).toEqual([]);
  });
});

describe('GET /api/listings/:pubkey/:listingId — product page', () => {
  it('returns the same object the list has, with the reason when it cannot be bought', async () => {
    seedFarm({ onlineShop: 'absent' });
    const list = byId((await get('/api/listings')).body);
    const r = await get(`/api/listings/${owner.pk}/granola`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(list.granola);
    expect(r.body).toMatchObject({ title: GRANOLA.title, price: '8.90', buyable: false, notBuyableReason: 'online_shop_off' });
  });

  it('404 for unknown, archived, blocked or suspended listings', async () => {
    seedFarm();
    expect((await get(`/api/listings/${owner.pk}/nope`)).status).toBe(404);
    expect((await get(`/api/listings/${'0'.repeat(64)}/granola`)).status).toBe(404);
    expect((await get(`/api/listings/${owner.pk}/granola`)).status).toBe(200);
    ingestEvent(listing({ ...GRANOLA, status: 'archived', created_at: T0 + 50 }));
    expect((await get(`/api/listings/${owner.pk}/granola`)).status).toBe(404);
    const admin = { 'x-admin-hex': ADMIN_HEXES[0] };
    const b = await request(app).post('/api/admin/block').set(admin)
      .send({ target_type: 'listing', target_pubkey: owner.pk, target_id: 'apples' });
    expect(b.status).toBe(200);
    expect((await get(`/api/listings/${owner.pk}/apples`)).status).toBe(404);
    ingestEvent(suspensionEvent(processor, owner, UNIT_ID, 'quota_blocked', Math.floor(Date.now() / 1000) + 1));
    expect((await get(`/api/listings/${owner.pk}/eggs`)).status).toBe(404);
  });
});

describe('how a listing can be handed over (its own delivery tag)', () => {
  const BEETS: L = { id: 'beets', title: 'Rdeča pesa', price: '4.00', unit: 'kg', created_at: T0 + 6, extra: [['delivery', 'pickup']] };
  const BOX: L = { id: 'box', title: 'Zabojček', price: '20.00', created_at: T0 + 7, extra: [['delivery', 'pickup'], ['delivery', 'local_delivery']] };

  it('pickup-only listings say so; a listing without the tag keeps the shop\'s terms; the free-shipping threshold is shown', async () => {
    seedFarm({ freeFrom: '30.00' });
    ingestEvent(listing(BEETS));
    ingestEvent(listing(BOX));
    const by = byId((await get('/api/listings')).body);
    expect(by.beets).toMatchObject({ buyable: true, fulfillmentModes: ['pickup'], freeShippingFrom: '30.00' });
    expect(by.box).toMatchObject({ buyable: true, fulfillmentModes: ['shipping', 'pickup'] });
    expect(by.granola).toMatchObject({ buyable: true, fulfillmentModes: ['shipping', 'pickup'], shippingFee: '4.50' });
  });

  it('a pickup-only listing of a shop without online pickup is not buyable, with its own reason', async () => {
    seedFarm({ pickup: false });
    ingestEvent(listing(BEETS));
    const by = byId((await get('/api/listings')).body);
    expect(by.beets).toMatchObject({ buyable: false, notBuyableReason: 'pickup_only', fulfillmentModes: [] });
    expect(by.granola).toMatchObject({ buyable: true, fulfillmentModes: ['shipping'], freeShippingFrom: null });
  });
});

describe('every write shows on the next request', () => {
  it('a new listing, a republish and a KIND 5', async () => {
    seedFarm();
    ingestEvent(listing({ id: 'new', title: 'Novo', created_at: T0 + 60 }));
    expect(ids((await get('/api/listings')).body)).toContain('new');
    ingestEvent(listing({ ...APPLES, title: 'Jabolka idared', created_at: T0 + 61 }));
    expect((await get(`/api/listings/${owner.pk}/apples`)).body.title).toBe('Jabolka idared');
    ingestEvent(deletionEvent(owner, [{ a: `${LISTING_KIND}:${owner.pk}:new` }], Math.floor(Date.now() / 1000) + 1));
    expect(ids((await get('/api/listings')).body)).not.toContain('new');
  });

  it('turning online selling off (or on) changes buyable at once', async () => {
    seedFarm();
    expect((await get(`/api/listings/${owner.pk}/granola`)).body.buyable).toBe(true);
    const now = Math.floor(Date.now() / 1000);
    ingestEvent(unitEvent(owner, { name: 'Kmetija Test', onlineShop: false, created_at: now + 1 }));
    expect((await get(`/api/listings/${owner.pk}/granola`)).body)
      .toMatchObject({ buyable: false, notBuyableReason: 'online_shop_off', availableQty: null });
    ingestEvent(unitEvent(owner, { name: 'Kmetija Test', fee: '3.00', created_at: now + 2 }));
    expect((await get(`/api/listings/${owner.pk}/granola`)).body).toMatchObject({ buyable: true, shippingFee: '3.00', pickup: false });
  });

  it('admin block / unblock and TOP feature take effect immediately', async () => {
    seedFarm();
    const admin = { 'x-admin-hex': ADMIN_HEXES[0] };
    const b = await request(app).post('/api/admin/block').set(admin)
      .send({ target_type: 'listing', target_pubkey: owner.pk, target_id: 'granola' });
    expect(b.status).toBe(200);
    expect(ids((await get('/api/listings')).body)).not.toContain('granola');
    await request(app).delete(`/api/admin/block/${b.body.id}`).set(admin);
    expect(ids((await get('/api/listings')).body)).toContain('granola');
    await request(app).post('/api/admin/feature').set(admin)
      .send({ target_type: 'listing', target_pubkey: owner.pk, target_id: 'granola', feature_type: 'top' });
    expect(ids((await get('/api/listings')).body)[0]).toBe('granola');
  });

  it('a 30903 active_until passing hides the unit without a new event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-10-05T10:00:00Z');
    vi.setSystemTime(start);
    const now = Math.floor(start.getTime() / 1000);
    ingestEvent(unitEvent(owner, { created_at: now - 100 }));
    ingestEvent(signed(processor, 30903, [['d', UNIT_ID], ['unit_id', UNIT_ID], ['a', `30901:${owner.pk}:${UNIT_ID}`], ['status', 'active'], ['active_until', String(now + 30)]], '', now - 50));
    ingestEvent(listing({ ...GRANOLA, created_at: now - 10 }));
    expect((await get('/api/listings')).body).toHaveLength(1);
    vi.setSystemTime(new Date(start.getTime() + 31_000));
    expect((await get('/api/listings')).body).toHaveLength(0);
  });
});
