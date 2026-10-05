import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ITEMS_PER_ORDER, maxItemsPerOrder } from './onlineShop';

describe('maxItemsPerOrder — the cart gate', () => {
  afterEach(() => { delete process.env.SHOP_MAX_ITEMS; });

  it('unset: the cart is on (one order may carry up to MAX_ITEMS_PER_ORDER products)', () => {
    delete process.env.SHOP_MAX_ITEMS;
    expect(maxItemsPerOrder()).toBe(MAX_ITEMS_PER_ORDER);
    process.env.SHOP_MAX_ITEMS = '   ';
    expect(maxItemsPerOrder()).toBe(MAX_ITEMS_PER_ORDER);
  });

  it('SHOP_MAX_ITEMS=1 turns it back to one product per order', () => {
    process.env.SHOP_MAX_ITEMS = '1';
    expect(maxItemsPerOrder()).toBe(1);
  });

  it('a set but unreadable value falls back to 1, never up', () => {
    for (const v of ['0', '-3', 'abc', 'NaN']) {
      process.env.SHOP_MAX_ITEMS = v;
      expect(maxItemsPerOrder()).toBe(1);
    }
  });

  it('never above MAX_ITEMS_PER_ORDER', () => {
    process.env.SHOP_MAX_ITEMS = '500';
    expect(maxItemsPerOrder()).toBe(MAX_ITEMS_PER_ORDER);
  });
});
