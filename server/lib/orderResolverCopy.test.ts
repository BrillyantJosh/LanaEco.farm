// @vitest-environment node
/**
 * orderResolver.ts is ONE file kept byte-identical in lanaeco.shop
 * (lanaeco-shop), lanaeco.farm (LanaEco.farm, since 5 Oct 2026), the
 * merchant app (lana-pays.us-mobile) and the payment broker (lana-pays-shop):
 * each judges a shop order's payment by itself, so a copy that drifts judges
 * the same order differently. The same constant is asserted in all four
 * repos; a change to the resolver changes SPEC §8 first and this constant in
 * all four at once.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** sha256 of server/lib/orderResolver.ts — the same in every copy (SPEC v1.1.2, 2 Oct 2026). */
export const ORDER_RESOLVER_SHA256 = '025236780df21c02d439792d19a4c97b0108a9ea25610b33c07c969e7ac1a417';

describe('the shared order resolver', () => {
  it('is byte-identical to the copy in the other repos', () => {
    const sha = createHash('sha256').update(readFileSync(new URL('./orderResolver.ts', import.meta.url))).digest('hex');
    expect(sha).toBe(ORDER_RESOLVER_SHA256);
  });
});
