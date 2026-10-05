import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import ListingDetailPage from './ListingDetailPage';
import { parseEcoListing } from '@/lib/nostr';
import { cartStore } from '@/contexts/CartContext';
import { CART_STORAGE_KEY } from '@/lib/cart';

// Nothing here reaches a network or a relay: fetch is stubbed.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

// No @testing-library/react in this repo: render with react-dom + act.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PK = '127a50609780fb68cfa8b95cf52f5fb679c9534c835038bca6155f65d198ec35';
const LID = '1e9d5e4bc2a2ce2fc8a4d64fc79f5027';
const UNIT = 'd50eaf61a0b1c2d3e4f5061728394a5b';

/** A producer listing (KIND 36500) as GET /api/listings/:pubkey/:listingId returns it. */
function detail(over: Record<string, unknown> = {}) {
  const { rawEvent: _raw, ...parsed } = parseEcoListing({
    id: 'e'.repeat(64), pubkey: PK, created_at: 1_790_000_000, kind: 36500, sig: 's'.repeat(128),
    content: 'Hrustljava granola s kokosom in lešniki.',
    tags: [
      ['d', LID], ['a', `30901:${PK}:${UNIT}`], ['title', 'Ekološka BG granola kokos & lešnik'], ['type', 'product'],
      ['price', '8.90', 'EUR'], ['unit', 'piece'], ['status', 'active'], ['stock', '20'],
      ['eco', 'organic'], ['harvest_season', 'autumn'], ['delivery', 'pickup'], ['pre_order', 'true'],
      ['image', 'https://img.test/granola.jpg'],
    ],
  } as any);
  return {
    ...parsed,
    kind: 36500,
    cashbackPercent: 5,
    buyable: true,
    notBuyableReason: null,
    unitCurrency: 'EUR',
    unitOwnerHex: PK,
    unitName: 'Kmetija Ana',
    shippingFee: '4.50',
    pickup: true,
    availableQty: 20,
    ...over,
  };
}

/** Where "Kupi zdaj" went: the checkout route with its query. */
function CheckoutProbe() {
  const loc = useLocation();
  return <div data-testid="checkout-page">{loc.pathname + loc.search}</div>;
}

let fetchMock: ReturnType<typeof vi.fn>;
function mockDetail(body: unknown, status = 200) {
  fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
}

let root: Root | null = null;
let container: HTMLDivElement;

async function renderPage(lang: 'sl' | 'en' = 'sl') {
  localStorage.setItem('lanaeco-lang', lang);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LanguageProvider>
        <MemoryRouter initialEntries={[`/ponudba/${PK}/${LID}`]}>
          <Routes>
            <Route path="/ponudba/:pubkey/:listingId" element={<ListingDetailPage />} />
            <Route path="/kosarica" element={<div data-testid="cart-page" />} />
            <Route path="/narocilo/novo/:pubkey/:listingId" element={<CheckoutProbe />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  });
  // let the mocked fetch resolve and the page re-render
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

/** Text with Intl's no-break spaces ('8,90\u00a0€') as plain spaces. */
const plain = (s: string | null | undefined) => String(s ?? '').replace(/\u00a0|\u202f/g, ' ');
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const qtyShown = () => byTestId('detail-qty')?.textContent;
const plusBtn = () => container.querySelector('[role="group"] button[aria-label^="Več"]') as HTMLButtonElement;

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
  vi.unstubAllGlobals();
  localStorage.clear();
  cartStore.resetForTests();
});

describe('ListingDetailPage — the listing', () => {
  it('asks the server for ONE listing, not the whole list', async () => {
    mockDetail(detail());
    await renderPage();
    expect(container.querySelector('h1')?.textContent).toBe('Ekološka BG granola kokos & lešnik');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/listings/${PK}/${LID}`);
  });

  it('keeps the farm sections: eco labels, season, delivery, pre-order, the producer link', async () => {
    mockDetail(detail());
    await renderPage();
    expect(plain(container.textContent)).toContain('8,90 €');
    expect(container.textContent).toContain('Eko oznake');
    expect(container.textContent).toContain('Na zalogi: 20 kosov');
    expect(container.querySelector(`a[href="/enota/${UNIT}"]`)).not.toBeNull();
    expect(container.textContent).toMatch(/[Pp]rednaročilo/);
  });

  it('404 → not found', async () => {
    mockDetail({ error: 'listing_not_found' }, 404);
    await renderPage();
    expect(container.querySelector('h2')?.textContent).toBe('Ponudba ni najdena');
    expect(byTestId('buy-block')).toBeNull();
  });
});

describe('ListingDetailPage — a reason instead of a missing button', () => {
  it('the producer has not turned on online selling: says so (the live granola case)', async () => {
    mockDetail(detail({ buyable: false, notBuyableReason: 'online_shop_off', availableQty: null }));
    await renderPage();
    expect(button('Dodaj v košarico')).toBeUndefined();
    expect(button('Kupi zdaj')).toBeUndefined();
    expect(byTestId('not-buyable')?.textContent).toBe('Ta ponudnik še ne prodaja po spletu.');
  });

  it('English site: "This producer does not sell online yet."', async () => {
    mockDetail(detail({ buyable: false, notBuyableReason: 'online_shop_off', availableQty: null }));
    await renderPage('en');
    expect(byTestId('not-buyable')?.textContent).toBe('This producer does not sell online yet.');
  });

  it('sold out: "Razprodano" and no stock line', async () => {
    mockDetail(detail({ stock: '0', availableQty: 0, buyable: false, notBuyableReason: 'sold_out' }));
    await renderPage();
    expect(byTestId('not-buyable')?.textContent).toBe('Razprodano');
    expect(container.textContent).not.toMatch(/Na zalogi/);
  });

  it('every other reason — and an older server that sends none — still says something', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ buyable: false, notBuyableReason: 'currency_mismatch' }, 'Spletni nakup ni mogoč: valuta ponudbe se razlikuje od valute pridelovalca'],
      [{ buyable: false, notBuyableReason: 'ordering_unavailable' }, 'Spletno naročanje na lanaeco.farm še ni vklopljeno.'],
      [{ buyable: false, notBuyableReason: 'registration_inactive' }, 'Ni na voljo za spletni nakup'],
      [{ buyable: undefined, notBuyableReason: undefined }, 'Ni na voljo za spletni nakup'],
      // buyable, but less left than the smallest order
      [{ buyable: true, availableQty: 1, minOrder: '2' }, 'Ni na voljo za spletni nakup'],
    ];
    for (const [over, text] of cases) {
      mockDetail(detail(over));
      await renderPage();
      expect(button('Dodaj v košarico'), JSON.stringify(over)).toBeUndefined();
      expect(byTestId('not-buyable')?.textContent, JSON.stringify(over)).toBe(text);
      act(() => root?.unmount()); container.remove();
    }
  });
});

describe('ListingDetailPage — "Dodaj v košarico" and "Kupi zdaj"', () => {
  it('adds the chosen quantity to the cart, says so, and links to the cart', async () => {
    mockDetail(detail({ availableQty: 5, stock: '5' }));
    await renderPage();
    expect(byTestId('not-buyable')).toBeNull();
    await act(async () => { plusBtn().click(); });
    expect(qtyShown()).toBe('2');
    await act(async () => { button('Dodaj v košarico')!.click(); });
    expect(cartStore.get().lines).toEqual([expect.objectContaining({ pubkey: PK, listingId: LID, qty: 2, unitId: UNIT })]);
    expect(toast.success).toHaveBeenCalledWith('Dodano v košarico: 2 kosa', expect.anything());
    expect(byTestId('in-cart')?.textContent).toContain('V košarici: 2 kosa');
    expect(container.querySelector('[data-testid="in-cart"] a[href="/kosarica"]')?.textContent).toBe('Odpri košarico');
    // the cart is in localStorage: survives a reload
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)!).lines[0].qty).toBe(2);
  });

  it('shows the producer\'s shipping fee and that pickup is possible', async () => {
    mockDetail(detail());
    await renderPage();
    const terms = plain(byTestId('shipping-terms')?.textContent);
    expect(terms).toContain('Poštnina: 4,50 €');
    expect(terms).toContain('Možen prevzem pri pridelovalcu');
    act(() => root?.unmount()); container.remove();
    mockDetail(detail({ shippingFee: '0.00', pickup: false }));
    await renderPage();
    expect(byTestId('shipping-terms')?.textContent).toBe('Brez poštnine');
  });

  it('what is already in the cart counts against the stock', async () => {
    mockDetail(detail({ stock: '3', availableQty: 3 }));
    await renderPage();
    await act(async () => { plusBtn().click(); });
    await act(async () => { button('Dodaj v košarico')!.click(); }); // 2 in cart, 1 left
    expect(qtyShown()).toBe('1');
    expect(plusBtn().disabled).toBe(true);
    await act(async () => { button('Dodaj v košarico')!.click(); }); // 3 in cart, none left
    expect(cartStore.get().lines[0].qty).toBe(3);
    expect(button('Dodaj v košarico')!.disabled).toBe(true);
    expect(byTestId('in-cart')?.textContent).toContain('Več ni na zalogi (največ 3 kosi)');
  });

  it('"Kupi zdaj" orders THIS product at the chosen quantity on its own — the cart is left as it was', async () => {
    mockDetail(detail({ stock: '5', availableQty: 5 }));
    await renderPage();
    await act(async () => { plusBtn().click(); });
    await act(async () => { button('Kupi zdaj')!.click(); });
    expect(cartStore.get().lines).toEqual([]);
    expect(byTestId('checkout-page')?.textContent).toBe(`/narocilo/novo/${PK}/${LID}?qty=2`);
  });
});
