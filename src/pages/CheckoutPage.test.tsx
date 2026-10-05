import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { LanguageProvider } from '@/i18n/LanguageContext';
import CheckoutPage from './CheckoutPage';
import { cartStore } from '@/contexts/CartContext';
import { CART_STORAGE_KEY } from '@/lib/cart';
import { listStoredOrders } from '@/lib/shopOrder';

// Nothing here reaches a network or a relay: fetch is stubbed, and the page
// itself never publishes (the portal server forwards to the broker).
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

// No @testing-library/react in this repo: render with react-dom + act.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const UNIT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const owner = generateSecretKey();
const OWNER_HEX = getPublicKey(owner);
const UNIT_EVENT = finalizeEvent({
  kind: 30901,
  created_at: 1_700_000_000,
  content: '',
  tags: [['d', UNIT_ID], ['unit_id', UNIT_ID], ['name', 'Test'], ['currency', 'EUR'], ['online_shop', 'true']],
}, owner);

function quoteFor(fulfillment: string) {
  return {
    unitId: UNIT_ID,
    unitOwnerHex: OWNER_HEX,
    unitName: 'Eko kmetija Test',
    currency: 'EUR',
    items: [{ a: `36502:${OWNER_HEX}:lst1`, kind: 36502, qty: 1, saleUnit: 'piece', unitPrice: '5.00', currency: 'EUR', title: 'Jabolka' }],
    shipping: fulfillment === 'pickup' ? '0.00' : '2.50',
    total: fulfillment === 'pickup' ? '5.00' : '7.50',
    fulfillmentModes: ['shipping', 'pickup'],
    fulfillment,
    payBy: Math.floor(Date.now() / 1000) + 1800,
    rawUnitEvent: UNIT_EVENT,
    relays: [],
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let posted: Array<{ url: string; body: any }>;

beforeEach(() => {
  localStorage.setItem('lanaeco-lang', 'sl');
  posted = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/orders/quote') {
      return { ok: true, status: 200, json: async () => quoteFor(body.fulfillment) };
    }
    posted.push({ url, body });
    return { ok: true, status: 200, json: async () => ({ pay_url: 'https://pay.test/checkout/x' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(toast.error).mockClear();
});

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LanguageProvider>
        <MemoryRouter initialEntries={[`/narocilo/novo/${OWNER_HEX}/lst1?qty=1`]}>
          <Routes>
            <Route path="/narocilo/novo/:pubkey/:listingId" element={<CheckoutPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  });
  await flush();
  expect(container.querySelector('form')).not.toBeNull();
}

const input = (id: string) => container.querySelector(`#co-${id}`) as HTMLInputElement;

async function type(id: string, value: string) {
  const el = input(id);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function blur(id: string) {
  const el = input(id);
  await act(async () => { el.focus(); });
  await act(async () => { el.blur(); });
}

async function choosePickup() {
  const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Prevzem pri pridelovalcu'))!;
  await act(async () => { btn.click(); });
  await flush();
}

async function submit() {
  const btn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
  expect(btn.disabled).toBe(false); // never silently greyed out for a missing field
  await act(async () => { btn.click(); });
  await flush();
}

const errorOf = (id: string) => container.querySelector(`#co-${id}-err`)?.textContent || null;
const orderPosts = () => posted.filter(p => p.url === '/api/orders' || /\/api\/orders\/.+\/retry$/.test(p.url));

describe('CheckoutPage — e-mail and phone are required', () => {
  it('labels mark e-mail and phone as required, with a reason the seller needs them', async () => {
    await renderPage();
    expect(container.querySelector('label[for="co-email"]')?.textContent).toContain('*');
    expect(container.querySelector('label[for="co-phone"]')?.textContent).toContain('*');
    expect(input('email').required).toBe(true);
    expect(input('phone').required).toBe(true);
    expect(container.textContent).toContain('Pridelovalec potrebuje vaš e-naslov in telefon');
    // no message before the shopper has done anything
    expect(errorOf('email')).toBeNull();
    expect(errorOf('phone')).toBeNull();
  });

  it('pickup with only a name: says what is missing and sends NOTHING', async () => {
    await renderPage();
    await choosePickup();
    await type('name', 'Ana Kupec');
    const quoteCalls = fetchMock.mock.calls.length;
    await submit();
    expect(errorOf('email')).toBe('Vpišite e-poštni naslov.');
    expect(errorOf('phone')).toBe('Vpišite telefonsko številko.');
    expect(input('email').getAttribute('aria-invalid')).toBe('true');
    expect(input('phone').getAttribute('aria-invalid')).toBe('true');
    expect(input('email').getAttribute('aria-describedby')).toBe('co-email-err');
    expect(input('name').getAttribute('aria-invalid')).toBe('false');
    // pickup: the address is not required
    expect(errorOf('line1')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Izpolnite označena polja.');
    // no fresh quote, no signing, no order
    expect(fetchMock.mock.calls.length).toBe(quoteCalls);
    expect(orderPosts()).toHaveLength(0);
    // focus goes to the first field that needs attention
    expect(document.activeElement).toBe(input('email'));
  });

  it('a wrong e-mail / phone format gets its own message', async () => {
    await renderPage();
    await choosePickup();
    await type('name', 'Ana Kupec');
    await type('email', 'ana@primer');
    await type('phone', '12 34');
    await submit();
    expect(errorOf('email')).toBe('E-poštni naslov ni pravilen (npr. ime@primer.si).');
    expect(errorOf('phone')).toMatch(/^Vpišite telefonsko številko s številkami/);
    expect(orderPosts()).toHaveLength(0);
  });

  it('a field shows its message once the shopper leaves it empty, and drops it when fixed', async () => {
    await renderPage();
    await blur('email');
    expect(errorOf('email')).toBe('Vpišite e-poštni naslov.');
    expect(errorOf('phone')).toBeNull(); // not touched yet
    await type('email', 'ana@primer.si');
    expect(errorOf('email')).toBeNull();
    expect(input('email').getAttribute('aria-invalid')).toBe('false');
  });

  it('shipping without an address: the address fields say they are required', async () => {
    await renderPage();
    await type('name', 'Ana Kupec');
    await type('email', 'ana@primer.si');
    await type('phone', '040 123 456');
    await submit();
    for (const f of ['line1', 'postcode', 'city', 'country']) {
      expect(errorOf(f), f).toBe('To polje je obvezno.');
      expect(input(f).getAttribute('aria-invalid'), f).toBe('true');
    }
    expect(errorOf('email')).toBeNull();
    expect(errorOf('phone')).toBeNull();
    expect(orderPosts()).toHaveLength(0);
    expect(document.activeElement).toBe(input('line1'));
  });

  it('valid pickup: one order, e-mail and phone reach the seller inside the encrypted 36522; 36520 unchanged', async () => {
    await renderPage();
    await choosePickup();
    await type('name', '  Ana Kupec ');
    await type('email', '  ana@primer.si ');
    await type('phone', ' 040  123 456 ');
    await submit();
    expect(toast.error).not.toHaveBeenCalled();
    const orders = orderPosts();
    expect(orders).toHaveLength(1);
    expect(orders[0].url).toBe('/api/orders');
    const { order, delivery } = orders[0].body;
    // 36520: frozen SPEC §2 tag order, no PII, content empty
    expect(order.kind).toBe(36520);
    expect(order.content).toBe('');
    expect(order.tags.map((t: string[]) => t[0])).toEqual([
      'd', 'a', 'p', 'unit_id', 'invoice_number', 'item', 'shipping', 'total', 'fulfillment', 'status', 'pay_by', 'client', 'v',
    ]);
    expect(order.tags.find((t: string[]) => t[0] === 'fulfillment')).toEqual(['fulfillment', 'pickup']);
    expect(JSON.stringify(order)).not.toMatch(/primer\.si|Ana Kupec/);
    // 36522: only the seller can read it — and it carries e-mail + phone
    expect(delivery.kind).toBe(36522);
    expect(JSON.stringify(delivery)).not.toContain('primer.si');
    const ck = nip44.v2.utils.getConversationKey(owner, delivery.pubkey);
    const plain = JSON.parse(nip44.v2.decrypt(delivery.content, ck));
    expect(plain.v).toBe(1);
    expect(plain.name).toBe('Ana Kupec');
    expect(plain.email).toBe('ana@primer.si');
    expect(plain.phone).toBe('040 123 456');
  });
});

describe('CheckoutPage — the cart of one shop becomes ONE order', () => {
  const OTHER_HEX = 'e'.repeat(64);
  const OTHER_UNIT = 'f'.repeat(32);
  const ITEMS = [
    { a: `36502:${OWNER_HEX}:lst1`, kind: 36502, qty: 3, saleUnit: 'kg', unitPrice: '4.50', currency: 'EUR', title: 'Jabolka' },
    { a: `36502:${OWNER_HEX}:lst2`, kind: 36502, qty: 2, saleUnit: 'kos', unitPrice: '3.98', currency: 'EUR', title: 'Hruške' },
  ];
  function cartQuote(fulfillment: string, over: Record<string, unknown> = {}) {
    return {
      ...quoteFor(fulfillment), items: ITEMS, maxItems: 30,
      shipping: fulfillment === 'pickup' ? '0.00' : '5.00', total: fulfillment === 'pickup' ? '21.46' : '26.46',
      ...over,
    };
  }
  let quoteBodies: any[];
  let quoteImpl: (body: any, n: number) => any;
  let orderStatus: number;
  const disp = (title: string) => ({ title, image: '', price: '0.01', currency: 'EUR', unit: 'kg', unitName: 'Test', minOrder: null, maxOrder: null, availableQty: null });

  beforeEach(() => {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    cartStore.resetForTests();
    // tampered stored prices (0.01): they must never reach an order
    cartStore.add({ pubkey: OWNER_HEX, listingId: 'lst1', unitId: UNIT_ID, qty: 3, display: disp('Jabolka') });
    cartStore.add({ pubkey: OTHER_HEX, listingId: 'other', unitId: OTHER_UNIT, qty: 1, display: disp('Drugje') });
    cartStore.add({ pubkey: OWNER_HEX, listingId: 'lst2', unitId: UNIT_ID, qty: 2, display: disp('Hruške') });
    quoteBodies = [];
    quoteImpl = (body) => cartQuote(body.fulfillment);
    orderStatus = 201;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url === '/api/orders/quote') {
        quoteBodies.push(body);
        return { ok: true, status: 200, json: async () => quoteImpl(body, quoteBodies.length) };
      }
      posted.push({ url, body });
      return orderStatus < 400
        ? { ok: true, status: orderStatus, json: async () => ({ pay_url: 'https://pay.test/checkout/x' }) }
        : { ok: false, status: orderStatus, json: async () => ({ code: 'PRICE_MISMATCH' }) };
    });
  });
  afterEach(() => { window.localStorage.removeItem(CART_STORAGE_KEY); cartStore.resetForTests(); });

  async function renderCart() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LanguageProvider>
          <MemoryRouter initialEntries={[`/kosarica/narocilo/${OWNER_HEX}/${UNIT_ID}`]}>
            <Routes>
              <Route path="/kosarica/narocilo/:ownerHex/:unitId" element={<CheckoutPage />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>,
      );
    });
    await flush();
    expect(container.querySelector('form')).not.toBeNull();
  }
  async function fillPickup() {
    await choosePickup();
    await type('name', 'Ana Kupec');
    await type('email', 'ana@primer.si');
    await type('phone', '040 123 456');
  }

  it('summary lists every line (qty × price = line total), then shipping and the total — all from the quote', async () => {
    await renderCart();
    const items = Array.from(container.querySelectorAll('[data-testid="checkout-items"] li')).map(li => (li.textContent || '').replace(/\u00a0/g, ' ').trim());
    expect(items).toEqual(['Jabolka13,50 €3 × 4,50 €', 'Hruške7,96 €2 × 3,98 €']);
    expect((container.querySelector('[data-testid="checkout-total"]')?.textContent || '').replace(/\u00a0/g, ' ')).toBe('26,46 €');
    expect(container.querySelector('a[href="/kosarica"]')?.textContent).toContain('Nazaj v košarico');
    // only this shop's lines were quoted, and only which product + how many (+ the shop they are filed under)
    expect(quoteBodies[0]).toEqual({ lines: [{ pubkey: OWNER_HEX, listingId: 'lst1', qty: 3 }, { pubkey: OWNER_HEX, listingId: 'lst2', qty: 2 }], fulfillment: 'shipping', unitId: UNIT_ID });
  });

  it('the heading names the shop, and says the other shops\' products stay in the cart', async () => {
    await renderCart();
    expect(container.querySelector('[data-testid="checkout-title"]')?.textContent).toBe(`Naročilo – ${quoteFor('shipping').unitName}`);
    expect(container.querySelector('[data-testid="other-shops-stay"]')?.textContent).toBe('Izdelki drugih pridelovalcev ostanejo v košarici in jih naročite posebej.');
    // a cart holding only this shop's products needs no such line
    await act(async () => { cartStore.remove(`${OTHER_HEX}:other`); });
    await flush();
    expect(container.querySelector('[data-testid="other-shops-stay"]')).toBeNull();
  });

  it('signs ONE 36520 with both items as quoted; after pay_url only this shop\'s lines leave the cart', async () => {
    await renderCart();
    await fillPickup();
    await submit();
    expect(toast.error).not.toHaveBeenCalled();
    const orders = orderPosts();
    expect(orders).toHaveLength(1);
    const { order } = orders[0].body;
    expect(order.tags.map((t: string[]) => t[0])).toEqual([
      'd', 'a', 'p', 'unit_id', 'invoice_number', 'item', 'item', 'shipping', 'total', 'fulfillment', 'status', 'pay_by', 'client', 'v',
    ]);
    expect(order.tags.filter((t: string[]) => t[0] === 'item')).toEqual([
      ['item', `36502:${OWNER_HEX}:lst1`, '3', 'kg', '4.50', 'EUR'],
      ['item', `36502:${OWNER_HEX}:lst2`, '2', 'kos', '3.98', 'EUR'],
    ]);
    expect(order.tags.find((t: string[]) => t[0] === 'total')).toEqual(['total', '21.46', 'EUR']);
    expect(JSON.stringify(order)).not.toContain('0.01');
    // the other shop stays in the cart
    expect(cartStore.get().lines.map(l => l.listingId)).toEqual(['other']);
    expect(listStoredOrders()[0]).toMatchObject({ title: 'Jabolka', qty: 3, items: [{ title: 'Jabolka', qty: 3 }, { title: 'Hruške', qty: 2 }], total: '21.46' });
  });

  it('a refused order stores nothing and leaves the cart as it was', async () => {
    orderStatus = 409;
    await renderCart();
    await fillPickup();
    await submit();
    expect(orderPosts()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith('Naročila ni bilo mogoče oddati. Poskusite znova. (PRICE_MISMATCH)');
    expect(cartStore.get().lines.map(l => l.listingId)).toEqual(['lst1', 'other', 'lst2']);
    expect(listStoredOrders()).toEqual([]);
  });

  it('a price that moved after the summary was drawn: nothing is signed, the new total is shown', async () => {
    quoteImpl = (body, n) => (n <= 2 ? cartQuote(body.fulfillment) : cartQuote(body.fulfillment, {
      items: [ITEMS[0], { ...ITEMS[1], unitPrice: '4.20' }], total: '22.90',
    }));
    await renderCart();
    await fillPickup(); // quote 2 = pickup
    await submit(); // quote 3 = fresh, different
    expect(orderPosts()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('Cena se je medtem spremenila — preverite povzetek.');
    expect((container.querySelector('[data-testid="checkout-total"]')?.textContent || '').replace(/\u00a0/g, ' ')).toBe('22,90 €');
    expect(cartStore.get().lines).toHaveLength(3);
  });

  it('"Naroči samo ta izdelek" (old one-product route, from=cart): one item, and only that line leaves the cart', async () => {
    quoteImpl = (body) => ({ ...quoteFor(body.fulfillment), items: [ITEMS[0]], total: '13.50', shipping: '0.00', maxItems: 1 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LanguageProvider>
          <MemoryRouter initialEntries={[`/narocilo/novo/${OWNER_HEX}/lst1?qty=3&from=cart`]}>
            <Routes>
              <Route path="/narocilo/novo/:pubkey/:listingId" element={<CheckoutPage />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>,
      );
    });
    await flush();
    expect(quoteBodies[0]).toEqual({ lines: [{ pubkey: OWNER_HEX, listingId: 'lst1', qty: 3 }], fulfillment: 'shipping' });
    await fillPickup();
    await submit();
    const { order } = orderPosts()[0].body;
    expect(order.tags.filter((t: string[]) => t[0] === 'item')).toEqual([['item', `36502:${OWNER_HEX}:lst1`, '3', 'kg', '4.50', 'EUR']]);
    expect(cartStore.get().lines.map(l => l.listingId)).toEqual(['other', 'lst2']);
  });

  it('while the server allows one product per order, a two-product order cannot be sent', async () => {
    quoteImpl = (body) => cartQuote(body.fulfillment, { maxItems: 1 });
    await renderCart();
    expect(container.textContent).toContain('Zaenkrat eno naročilo vsebuje en izdelek. Vrnite se v košarico in vsak izdelek naročite posebej.');
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
