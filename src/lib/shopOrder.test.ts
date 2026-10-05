import { describe, it, expect, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils';
import {
  newOrderIdentity, buildOrderEvent, buildDeliveryEvent, buildCancelEvent, ORDER_ID_RE,
  saveOrderKey, loadOrderKey, rememberOrder, listStoredOrders, pruneExpiredOrders, PAY_WINDOW_SEC,
  type OrderInput, type DeliveryDetails,
} from './shopOrder';

const UNIT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function unitEvent(sk: Uint8Array, unitId = UNIT_ID) {
  return finalizeEvent({
    kind: 30901,
    created_at: 1_700_000_000,
    content: '',
    tags: [['d', unitId], ['unit_id', unitId], ['name', 'Test'], ['currency', 'EUR'], ['online_shop', 'true']],
  }, sk) as any;
}

const details: DeliveryDetails = {
  name: 'Janez Novak', email: 'janez@example.com', phone: '+386 40 111 222',
  address: { line1: 'Trubarjeva 7', city: 'Ljubljana', postcode: '1000', country: 'SI' }, note: 'pozvoni',
};

function orderInput(id: ReturnType<typeof newOrderIdentity>, ownerHex: string, over: Partial<OrderInput> = {}): OrderInput {
  return {
    orderId: id.orderId, unitOwnerHex: ownerHex, unitId: UNIT_ID,
    items: [{ a: `36502:${ownerHex}:lst1`, qty: 2, saleUnit: 'kg', unitPrice: '5.00', currency: 'EUR' }],
    shipping: '2.50', total: '12.50', currency: 'EUR', fulfillment: 'shipping', status: 'placed', client: 'www.lanaeco.farm',
    ...over,
  };
}

beforeEach(() => window.localStorage.clear());

describe('order identity', () => {
  it('order id = pubkey[0:24].32hex and matches ORDER_ID_RE / gateway ORDER_ID_RE', () => {
    const id = newOrderIdentity();
    expect(id.orderId).toMatch(ORDER_ID_RE);
    expect(id.orderId.length).toBe(57);
    expect(id.orderId.slice(0, 24)).toBe(id.pubkey.slice(0, 24));
    expect(id.orderId).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(getPublicKey(hexToBytes(id.privHex))).toBe(id.pubkey);
  });
});

describe('KIND 36520', () => {
  it('tags in the exact SPEC §2 order, content empty, valid signature', () => {
    const owner = generateSecretKey();
    const ownerHex = getPublicKey(owner);
    const id = newOrderIdentity();
    const ev = buildOrderEvent(id.privHex, orderInput(id, ownerHex));
    expect(verifyEvent(ev as any)).toBe(true);
    expect(ev.kind).toBe(36520);
    expect(ev.pubkey).toBe(id.pubkey);
    expect(ev.content).toBe('');
    expect(ev.tags.map(t => t[0])).toEqual([
      'd', 'a', 'p', 'unit_id', 'invoice_number', 'item', 'shipping', 'total', 'fulfillment', 'status', 'pay_by', 'client', 'v',
    ]);
    expect(ev.tags).toEqual([
      ['d', id.orderId],
      ['a', `30901:${ownerHex}:${UNIT_ID}`],
      ['p', ownerHex],
      ['unit_id', UNIT_ID],
      ['invoice_number', id.orderId],
      ['item', `36502:${ownerHex}:lst1`, '2', 'kg', '5.00', 'EUR'],
      ['shipping', '2.50', 'EUR'],
      ['total', '12.50', 'EUR'],
      ['fulfillment', 'shipping'],
      ['status', 'placed'],
      ['pay_by', String(ev.created_at + PAY_WINDOW_SEC)],
      ['client', 'www.lanaeco.farm'],
      ['v', '1'],
    ]);
  });
  it('a cart order: every item tag together where the single item was, in the given order (SPEC v1.1.0)', () => {
    const ownerHex = getPublicKey(generateSecretKey());
    const id = newOrderIdentity();
    const items = [
      { a: `36502:${ownerHex}:lst1`, qty: 3, saleUnit: 'kg', unitPrice: '4.50', currency: 'EUR' },
      { a: `36502:${ownerHex}:lst2`, qty: 2, saleUnit: 'kos', unitPrice: '3.98', currency: 'EUR' },
    ];
    const ev = buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items, shipping: '5.00', total: '26.46' }));
    expect(verifyEvent(ev as any)).toBe(true);
    expect(ev.tags.map(t => t[0])).toEqual([
      'd', 'a', 'p', 'unit_id', 'invoice_number', 'item', 'item', 'shipping', 'total', 'fulfillment', 'status', 'pay_by', 'client', 'v',
    ]);
    expect(ev.tags.filter(t => t[0] === 'item')).toEqual([
      ['item', `36502:${ownerHex}:lst1`, '3', 'kg', '4.50', 'EUR'],
      ['item', `36502:${ownerHex}:lst2`, '2', 'kos', '3.98', 'EUR'],
    ]);
    expect(ev.tags.find(t => t[0] === 'total')).toEqual(['total', '26.46', 'EUR']);
    // cancel copies every item
    const cancel = buildCancelEvent(id.privHex, ev.tags);
    expect(cancel.tags.filter(t => t[0] === 'item')).toEqual(ev.tags.filter(t => t[0] === 'item'));
  });
  it('refuses an order with no item, more than 30, the same listing twice, or another shop\'s listing', () => {
    const ownerHex = getPublicKey(generateSecretKey());
    const id = newOrderIdentity();
    const line = (n: number) => ({ a: `36502:${ownerHex}:l${n}`, qty: 1, saleUnit: 'kos', unitPrice: '1.00', currency: 'EUR' });
    expect(() => buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items: [] }))).toThrow(/1\.\.30/);
    expect(() => buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items: Array.from({ length: 31 }, (_, i) => line(i)) }))).toThrow(/1\.\.30/);
    expect(() => buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items: Array.from({ length: 30 }, (_, i) => line(i)) }))).not.toThrow();
    expect(() => buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items: [line(1), line(1)] }))).toThrow(/twice/);
    expect(() => buildOrderEvent(id.privHex, orderInput(id, ownerHex, { items: [line(1), { ...line(2), a: `36502:${'e'.repeat(64)}:x` }] }))).toThrow(/this shop/);
  });
  it('supersedes goes last and only when given; a foreign order id is refused', () => {
    const ownerHex = getPublicKey(generateSecretKey());
    const id = newOrderIdentity();
    const ev = buildOrderEvent(id.privHex, orderInput(id, ownerHex, { supersedes: `36520:${'b'.repeat(64)}:${'b'.repeat(24)}.${'c'.repeat(32)}` }));
    expect(ev.tags[ev.tags.length - 1][0]).toBe('supersedes');
    const other = newOrderIdentity();
    expect(() => buildOrderEvent(other.privHex, orderInput(id, ownerHex))).toThrow();
  });
  it('cancel republish keeps every tag but status, signed by the same key', () => {
    const ownerHex = getPublicKey(generateSecretKey());
    const id = newOrderIdentity();
    const placed = buildOrderEvent(id.privHex, orderInput(id, ownerHex));
    const cancel = buildCancelEvent(id.privHex, placed.tags);
    expect(verifyEvent(cancel as any)).toBe(true);
    expect(cancel.pubkey).toBe(placed.pubkey);
    expect(cancel.content).toBe('');
    expect(cancel.tags.find(t => t[0] === 'status')).toEqual(['status', 'cancelled']);
    expect(cancel.tags.filter(t => t[0] !== 'status')).toEqual(placed.tags.filter(t => t[0] !== 'status'));
  });
});

describe('KIND 36522', () => {
  it('encrypts to verifyEvent(raw30901).pubkey; decrypts with the recipient key and NOT with another', () => {
    const owner = generateSecretKey();
    const ownerHex = getPublicKey(owner);
    const id = newOrderIdentity();
    const ev = buildDeliveryEvent(id.privHex, { orderId: id.orderId, unitId: UNIT_ID, rawUnitEvent: unitEvent(owner), details });
    expect(verifyEvent(ev as any)).toBe(true);
    expect(ev.kind).toBe(36522);
    expect(ev.tags).toEqual([
      ['d', `${id.orderId}__${ownerHex}`],
      ['a', `36520:${id.pubkey}:${id.orderId}`],
      ['p', ownerHex],
      ['unit_id', UNIT_ID],
      ['encryption', 'nip44'],
      ['v', '1'],
    ]);
    // nothing readable leaks into tags or content
    const flat = JSON.stringify(ev);
    for (const v of ['Janez', 'Trubarjeva', 'example.com', 'pozvoni']) expect(flat).not.toContain(v);

    const ck = nip44.v2.utils.getConversationKey(owner, ev.pubkey);
    const plain = JSON.parse(nip44.v2.decrypt(ev.content, ck));
    expect(plain).toEqual({ v: 1, ...details });

    const stranger = generateSecretKey();
    const wrong = nip44.v2.utils.getConversationKey(stranger, ev.pubkey);
    expect(() => nip44.v2.decrypt(ev.content, wrong)).toThrow();
  });
  it('refuses to build without e-mail AND phone (the seller needs both to confirm the order)', () => {
    const owner = generateSecretKey();
    const id = newOrderIdentity();
    const build = (d: DeliveryDetails) => buildDeliveryEvent(id.privHex, { orderId: id.orderId, unitId: UNIT_ID, rawUnitEvent: unitEvent(owner), details: d });
    const { email: _e, ...noEmail } = details;
    const { phone: _p, ...noPhone } = details;
    expect(() => build(noEmail)).toThrow(/email and phone/);
    expect(() => build(noPhone)).toThrow(/email and phone/);
    expect(() => build({ ...details, email: '   ' })).toThrow(/email and phone/);
    expect(() => build({ ...details, phone: '' })).toThrow(/email and phone/);
    expect(() => build(details)).not.toThrow();
  });
  it('refuses a tampered / wrong-unit 30901 (recipient must come from a verified event)', () => {
    const owner = generateSecretKey();
    const id = newOrderIdentity();
    const tampered = { ...unitEvent(owner), pubkey: 'f'.repeat(64) };
    expect(() => buildDeliveryEvent(id.privHex, { orderId: id.orderId, unitId: UNIT_ID, rawUnitEvent: tampered, details })).toThrow();
    const otherUnit = unitEvent(owner, 'b'.repeat(32));
    expect(() => buildDeliveryEvent(id.privHex, { orderId: id.orderId, unitId: UNIT_ID, rawUnitEvent: otherUnit, details })).toThrow();
  });
});

describe('localStorage', () => {
  it('stores the hex privkey under lana_shop_order_key_<id>, prunes after 30 days', () => {
    const id = newOrderIdentity();
    saveOrderKey(id.orderId, id.privHex);
    expect(window.localStorage.getItem(`lana_shop_order_key_${id.orderId}`)).toBe(id.privHex);
    expect(loadOrderKey(id.orderId)).toBe(id.privHex);
    const now = Math.floor(Date.now() / 1000);
    rememberOrder({ orderId: id.orderId, unitId: UNIT_ID, unitName: 'T', title: 'Jabolka', qty: 2, total: '12.50', currency: 'EUR', createdAt: now - 31 * 86400, tags: [] });
    expect(listStoredOrders()).toHaveLength(1);
    pruneExpiredOrders(now);
    expect(listStoredOrders()).toHaveLength(0);
    expect(loadOrderKey(id.orderId)).toBeNull();
  });
});
