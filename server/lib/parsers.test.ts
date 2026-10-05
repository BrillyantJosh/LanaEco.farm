// @vitest-environment node
/**
 * The parsers the online shop reads (SPEC §2/§3/§6/§7): a 30901's online-shop
 * tags (absent = off, fail-closed), a listing's kind (the 36520 `item`
 * address), and the 36520 / 36521 / 30933 join fields.
 */
import { describe, it, expect } from 'vitest';
import { parseUnit, parseListing, parseShopOrder, parseFulfillment, parsePurchase } from './parsers.js';
import {
  key, unitEvent, listingEvent, orderEvent, fulfillmentEvent, purchaseEvent, signed, orderIdFor, UNIT_ID, LISTING_ID,
} from '../test/fixtures.js';
import { LISTING_KIND } from '../test/portal.js';

const owner = key();
const buyer = key();

describe('parseUnit — KIND 30901 online-shop opt-in', () => {
  it('absent tags: not selling online, no fee, no pickup', () => {
    const p = parseUnit(unitEvent(owner, { onlineShop: 'absent' }));
    expect(p).toMatchObject({ onlineShop: false, onlineShopShippingFee: '0.00', onlineShopPickup: false, onlineShopFreeFrom: null, staffHexes: [] });
  });

  it('online_shop true with fee, pickup, free-from and staff', () => {
    const staff = key().pk;
    const p = parseUnit(unitEvent(owner, { fee: '4.5', pickup: true, freeFrom: '50', staff: [staff, 'not-a-hex'] }));
    expect(p).toMatchObject({ onlineShop: true, onlineShopShippingFee: '4.50', onlineShopPickup: true, onlineShopFreeFrom: '50.00', staffHexes: [staff] });
  });

  it('only the exact string "true" turns it on; a malformed fee falls back to 0.00', () => {
    const ev = signed(owner, 30901, [['d', UNIT_ID], ['unit_id', UNIT_ID], ['online_shop', 'yes'], ['online_shop_shipping_fee', '4,50']]);
    expect(parseUnit(ev)).toMatchObject({ onlineShop: false, onlineShopShippingFee: '0.00' });
  });
});

describe('parseListing — the kind is kept', () => {
  it('a producer listing parses with kind 36500 and its farm fields', () => {
    const p = parseListing(listingEvent(owner, { price: '8.90', stock: '12', unit: 'kg' }));
    expect(p).toMatchObject({ kind: LISTING_KIND, listingId: LISTING_ID, price: '8.90', priceCurrency: 'EUR', stock: '12', unit: 'kg', unitRef: `30901:${owner.pk}:${UNIT_ID}` });
  });
});

describe('parseShopOrder / parseFulfillment / parsePurchase', () => {
  const orderId = orderIdFor(buyer);
  const itemA = `${LISTING_KIND}:${owner.pk}:${LISTING_ID}`;

  it('a 36520 cart: every item tag, shipping and total with their currency', () => {
    const ev = orderEvent(buyer, {
      orderId, ownerHex: owner.pk, itemA,
      items: [['item', itemA, '2', 'kg', '5.00', 'EUR'], ['item', `${LISTING_KIND}:${owner.pk}:honey`, '1', 'piece', '9.00', 'EUR']],
      shipping: '2.50', total: '21.50', client: 'www.lanaeco.farm',
    });
    const p = parseShopOrder(ev);
    expect(p).toMatchObject({
      orderId, unitRef: `30901:${owner.pk}:${UNIT_ID}`, ownerHex: owner.pk, unitId: UNIT_ID, invoiceNumber: orderId,
      shippingFee: '2.50', shippingCurrency: 'EUR', total: '21.50', currency: 'EUR', fulfillment: 'shipping',
      status: 'placed', payBy: ev.created_at + 1800, client: 'www.lanaeco.farm', version: '1', contentEmpty: true,
    });
    expect(p.items).toEqual([
      { a: itemA, kind: LISTING_KIND, ownerHex: owner.pk, listingId: LISTING_ID, qty: 2, saleUnit: 'kg', unitPrice: '5.00', currency: 'EUR' },
      { a: `${LISTING_KIND}:${owner.pk}:honey`, kind: LISTING_KIND, ownerHex: owner.pk, listingId: 'honey', qty: 1, saleUnit: 'piece', unitPrice: '9.00', currency: 'EUR' },
    ]);
  });

  it('a 36521 names the order and the unit apart', () => {
    const p = parseFulfillment(fulfillmentEvent(owner, { orderId, buyerPubkey: buyer.pk, ownerHex: owner.pk, status: 'shipped', carrier: 'Pošta', tracking: 'RR1' }));
    expect(p).toMatchObject({ orderId, orderRef: `36520:${buyer.pk}:${orderId}`, unitRef: `30901:${owner.pk}:${UNIT_ID}`, buyerPubkey: buyer.pk, status: 'shipped', carrier: 'Pošta', tracking: 'RR1', refund: null });
  });

  it('a 30933 keeps only the join tags', () => {
    const brain = key();
    const p = parsePurchase(purchaseEvent(brain, { txId: 'tx1', invoiceNumber: orderId, receiptDescription: 'x', amount: '21.50', lanaAmount: '21500' }));
    expect(p).toMatchObject({ txId: 'tx1', unitId: UNIT_ID, invoiceNumber: orderId, receiptDescription: 'x', amount: '21.50', currency: 'EUR', lanaAmount: '21500', status: 'processing' });
  });
});
