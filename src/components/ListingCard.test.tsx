import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ListingCard } from './ListingCard';
import { parseEcoListing } from '@/lib/nostr';
import { cartStore } from '@/contexts/CartContext';
import { CART_STORAGE_KEY } from '@/lib/cart';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PK = 'b'.repeat(64);
const UNIT = 'c1d2e3f4a5b60718293a4b5c6d7e8f90';

/** A producer listing as GET /api/listings returns it (the farm's own shape). */
function listing(over: Record<string, unknown> = {}) {
  const { rawEvent: _raw, ...l } = parseEcoListing({
    id: 'e'.repeat(64), pubkey: PK, created_at: 1_790_000_000, kind: 36500, sig: 's'.repeat(128), content: 'Domača jabolka.',
    tags: [['d', 'jabolka'], ['a', `30901:${PK}:${UNIT}`], ['title', 'Jabolka'], ['type', 'produce'],
      ['price', '2.40', 'EUR'], ['unit', 'kg'], ['status', 'active'], ['stock', '5'], ['image', 'https://img.test/j.jpg']],
  } as any);
  return {
    ...l, kind: 36500, cashbackPercent: 5, buyable: true, notBuyableReason: null, unitCurrency: 'EUR', unitOwnerHex: PK,
    unitName: 'Kmetija Ana', shippingFee: '3.00', pickup: false, availableQty: 5, ...over,
  } as any;
}

let root: Root | null = null;
let container: HTMLDivElement;

async function render(el: React.ReactElement) {
  localStorage.setItem('lanaeco-lang', 'sl');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LanguageProvider><MemoryRouter>{el}</MemoryRouter></LanguageProvider>);
  });
}

const plus = () => container.querySelector('[data-testid="quick-add"]') as HTMLButtonElement | null;

beforeEach(() => {
  window.localStorage.removeItem(CART_STORAGE_KEY);
  cartStore.resetForTests();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  localStorage.clear();
  cartStore.resetForTests();
});

describe('quick "+" on a producer tile', () => {
  it('adds 1 kg without opening the product, with a short toast and a way to the cart', async () => {
    await render(<ListingCard listing={listing()} />);
    const btn = plus()!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Dodaj Jabolka v košarico');
    // a button may not sit inside the tile's link
    expect(btn.closest('a')).toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe(`/ponudba/${PK}/jabolka`);
    await act(async () => { btn.click(); });
    expect(cartStore.get().lines).toEqual([expect.objectContaining({ pubkey: PK, listingId: 'jabolka', unitId: UNIT, qty: 1 })]);
    expect(toast.success).toHaveBeenCalledWith('Dodano v košarico: 1 kg', expect.objectContaining({
      description: 'Jabolka',
      action: expect.objectContaining({ label: 'Odpri košarico' }),
    }));
  });

  it('a minimum order is what one tap adds', async () => {
    await render(<ListingCard listing={listing({ minOrder: '2' })} />);
    await act(async () => { plus()!.click(); });
    expect(cartStore.get().lines[0].qty).toBe(2);
  });

  it('greys out at the stock limit and says why on a tap', async () => {
    await render(<ListingCard listing={listing({ availableQty: 1, stock: '1' })} />);
    await act(async () => { plus()!.click(); });
    expect(plus()!.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { plus()!.click(); });
    expect(cartStore.get().lines[0].qty).toBe(1);
    expect(toast.error).toHaveBeenCalledWith('Več ni na zalogi (največ 1 kg)');
  });

  it('no "+" when the producer does not sell online, the server did not say buyable, sold out, or on the dashboard', async () => {
    for (const over of [
      { buyable: false, notBuyableReason: 'online_shop_off', availableQty: null },
      { buyable: undefined },
      { buyable: false, notBuyableReason: 'sold_out', availableQty: 0, stock: '0' },
      { availableQty: 1, minOrder: '2' },
    ]) {
      await render(<ListingCard listing={listing(over)} />);
      expect(plus(), JSON.stringify(over)).toBeNull();
      act(() => root?.unmount()); container.remove();
    }
    await render(<ListingCard listing={listing()} showActions onEdit={() => {}} onDelete={() => {}} />);
    expect(plus()).toBeNull();
  });

  it('sold out shows the badge, not a stock line; the stock line counts what is left', async () => {
    await render(<ListingCard listing={listing({ buyable: false, notBuyableReason: 'sold_out', availableQty: 0, stock: '0' })} />);
    expect(container.textContent).toContain('Razprodano');
    expect(container.textContent).not.toMatch(/Na zalogi/);
    act(() => root?.unmount()); container.remove();
    await render(<ListingCard listing={listing({ stock: '10', availableQty: 7, unit: 'piece' })} />);
    expect(container.textContent).toContain('Na zalogi: 7 kosov');
  });
});
