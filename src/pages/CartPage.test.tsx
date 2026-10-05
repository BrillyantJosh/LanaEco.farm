import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import CartPage from './CartPage';
import { cartStore } from '@/contexts/CartContext';
import { CART_STORAGE_KEY, type CartDisplay } from '@/lib/cart';

// No network: fetch is a stub that prices like the server (merchant prices,
// never the cart's stored copy).
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);
const UNIT_A = '1'.repeat(32);
const UNIT_B = '2'.repeat(32);
/** What the merchant signed: listing → [price, sale unit, title, max]. */
const SIGNED: Record<string, [string, string, string, number]> = {
  [`${OWNER_A}:jabolka`]: ['4.50', 'kg', 'Jabolka', 10],
  [`${OWNER_A}:hruske`]: ['3.98', 'kos', 'Hruške', 2],
  [`${OWNER_B}:med`]: ['9.00', 'kos', 'Med', 10],
};
const SHOP: Record<string, { unitId: string; name: string; fee: number }> = {
  [OWNER_A]: { unitId: UNIT_A, name: 'Eko kmetija Ana', fee: 500 },
  [OWNER_B]: { unitId: UNIT_B, name: 'Rastoča jablana', fee: 350 },
};

let maxItems = 30;
let posted: any[] = [];
/** Per-test override of the stub server's answer (shop paused, min_order raised …). */
let override: ((body: any) => { status: number; body: any } | null) | null = null;
const cents = (s: string) => Math.round(Number(s) * 100);
const str = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

function quoteResponse(body: any) {
  const forced = override?.(body);
  if (forced) return forced;
  const lines = body.lines as Array<{ pubkey: string; listingId: string; qty: number }>;
  let sub = 0;
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const s = SIGNED[`${l.pubkey}:${l.listingId}`];
    if (!s) return { status: 409, body: { code: 'NOT_BUYABLE', reason: 'listing_unknown', line: i } };
    if (l.qty > s[3]) return { status: 409, body: { code: 'QTY_UNAVAILABLE', reason: 'qty', line: i, min: 1, max: s[3] } };
    sub += cents(s[0]) * l.qty;
    items.push({ a: `36502:${l.pubkey}:${l.listingId}`, kind: 36502, qty: l.qty, saleUnit: s[1], unitPrice: s[0], currency: 'EUR', title: s[2] });
  }
  const shop = SHOP[lines[0].pubkey];
  return {
    status: 200,
    body: {
      unitId: shop.unitId, unitOwnerHex: lines[0].pubkey, unitName: shop.name, currency: 'EUR', items,
      shipping: str(shop.fee), total: str(sub + shop.fee), fulfillmentModes: ['shipping', 'pickup'], fulfillment: 'shipping',
      payBy: 0, rawUnitEvent: {}, relays: [], maxItems,
    },
  };
}

function display(title: string, price: string, unit: string, shop: string): CartDisplay {
  return { title, image: '', price, currency: 'EUR', unit, unitName: shop, minOrder: null, maxOrder: null, availableQty: null };
}

function seed() {
  // The stored copies carry a tampered price on purpose: it must never be used.
  cartStore.add({ pubkey: OWNER_A, listingId: 'jabolka', unitId: UNIT_A, qty: 3, display: display('Jabolka', '0.01', 'kg', 'Živa') });
  cartStore.add({ pubkey: OWNER_B, listingId: 'med', unitId: UNIT_B, qty: 1, display: display('Med', '9.00', 'kos', 'Rastoča jablana') });
  cartStore.add({ pubkey: OWNER_A, listingId: 'hruske', unitId: UNIT_A, qty: 2, display: display('Hruške', '3.98', 'kos', 'Živa') });
}

let root: Root | null = null;
let container: HTMLDivElement;
let loc = '';
function Probe() { loc = useLocation().pathname; return null; }

async function wait(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}
/** Past the 400 ms debounce, and let the stubbed fetch resolve. */
const settle = async () => { await wait(450); await wait(0); await wait(0); };

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/kosarica']}>
          <Probe />
          <Routes>
            <Route path="/kosarica" element={<CartPage />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  });
}

const shops = () => Array.from(container.querySelectorAll('[data-testid="cart-shop"]')) as HTMLElement[];
const text = (el: Element | null | undefined) => (el?.textContent || '').replace(/ /g, ' ');

beforeEach(() => {
  window.localStorage.setItem('lanaeco-lang', 'sl');
  window.localStorage.removeItem(CART_STORAGE_KEY);
  cartStore.resetForTests();
  maxItems = 30;
  posted = [];
  override = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/orders/quote') {
      posted.push(body);
      const r = quoteResponse(body);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  cartStore.resetForTests();
});

describe('CartPage', () => {
  it('empty cart: says so and links back to the products', async () => {
    await render();
    expect(text(container)).toContain('Košarica je prazna.');
    expect(container.querySelector('a[href="/ponudbe"]')?.textContent).toBe('Nadaljuj z nakupovanjem');
  });

  it('one block per shop; every price and total comes from that shop\'s server quote, never from the stored copy', async () => {
    seed();
    await render();
    await settle();
    const [a, b] = shops();
    expect(shops()).toHaveLength(2);
    expect(text(container.querySelector('[data-testid="separate-orders"]'))).toContain('eno naročilo na pridelovalca');
    expect(text(a.querySelector('h2'))).toBe('Eko kmetija Ana');
    // lines: name, unit price / sale unit, quantity, line total
    const rows = Array.from(a.querySelectorAll('[data-testid="cart-line"]'));
    expect(rows.map(r => text(r.querySelector('a + div a, .min-w-0 a')))).toEqual(['Jabolka', 'Hruške']);
    expect(rows.map(r => text(r.querySelector('[data-testid="unit-price"]')))).toEqual(['4,50 € / kg', '3,98 € / kos']);
    expect(rows.map(r => text(r.querySelector('[data-testid="line-qty"]')))).toEqual(['3 kg', '2 kos']);
    expect(rows.map(r => text(r.querySelector('[data-testid="line-total"]')))).toEqual(['13,50 €', '7,96 €']);
    // 4.50 × 3 + 3.98 × 2 = 21.46; + 5.00 shipping = 26.46
    expect(text(a.querySelector('[data-testid="cart-subtotal"]'))).toBe('21,46 €');
    expect(text(a.querySelector('[data-testid="cart-shipping"]'))).toBe('5,00 €');
    expect(text(a.querySelector('[data-testid="cart-total"]'))).toBe('26,46 €');
    expect(text(a)).toContain('Prevzem pri pridelovalcu je brezplačen');
    expect(text(b.querySelector('[data-testid="cart-total"]'))).toBe('12,50 €');
    // ONE quote per shop, carrying only which product and how many
    const byShop = (x: any, y: any) => (x.lines[0].pubkey < y.lines[0].pubkey ? -1 : 1);
    // (+ the shop the cart files them under, so a moved product is blamed alone)
    expect([...posted].sort(byShop)).toEqual([
      { lines: [{ pubkey: OWNER_A, listingId: 'jabolka', qty: 3 }, { pubkey: OWNER_A, listingId: 'hruske', qty: 2 }], fulfillment: 'shipping', unitId: UNIT_A },
      { lines: [{ pubkey: OWNER_B, listingId: 'med', qty: 1 }], fulfillment: 'shipping', unitId: UNIT_B },
    ]);
    expect(JSON.stringify(posted)).not.toContain('0.01');
    // "Na blagajno" per shop → that shop's checkout
    const go = a.querySelector('[data-testid="cart-checkout"]') as HTMLAnchorElement;
    expect(go.textContent).toBe('Na blagajno');
    expect(go.getAttribute('href')).toBe(`/kosarica/narocilo/${OWNER_A}/${UNIT_A}`);
  });

  it('changing a quantity re-asks the server once (debounced) and shows only the new answer', async () => {
    seed();
    await render();
    await settle();
    posted = [];
    const a = shops()[0];
    const plus = a.querySelector('[data-testid="cart-line"] [role="group"] button[aria-label="Več: Jabolka"]') as HTMLButtonElement;
    await act(async () => { plus.click(); });
    await act(async () => { plus.click(); });
    // while the new quote is pending no total is shown from old numbers
    expect(a.querySelector('[data-testid="cart-total"]')).toBeNull();
    expect((a.querySelector('[data-testid="cart-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].lines[0]).toEqual({ pubkey: OWNER_A, listingId: 'jabolka', qty: 5 });
    expect(text(shops()[0].querySelector('[data-testid="cart-total"]'))).toBe('35,46 €'); // 22.50 + 7.96 + 5.00
  });

  it('a line the server refuses is marked with a one-click fix; the shop cannot check out until it is fixed', async () => {
    cartStore.add({ pubkey: OWNER_A, listingId: 'hruske', unitId: UNIT_A, qty: 2, display: display('Hruške', '3.98', 'kos', 'Živa') });
    cartStore.setQty(`${OWNER_A}:hruske`, 4); // the stored copy knew no limit; the server allows 2
    await render();
    await settle();
    const problem = container.querySelector('[data-testid="line-problem"]')!;
    expect(text(problem)).toContain('Na voljo le 2 kos');
    expect((container.querySelector('[data-testid="cart-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    const fix = Array.from(problem.querySelectorAll('button')).find(b => b.textContent?.startsWith('Nastavi na'))!;
    await act(async () => { fix.click(); });
    await settle();
    expect(cartStore.get().lines[0].qty).toBe(2);
    expect(container.querySelector('[data-testid="line-problem"]')).toBeNull();
    expect(container.querySelector('a[data-testid="cart-checkout"]')).not.toBeNull();
  });

  it('a product that is gone offers removal; removing it leaves the rest', async () => {
    cartStore.add({ pubkey: OWNER_A, listingId: 'jabolka', unitId: UNIT_A, qty: 1, display: display('Jabolka', '4.50', 'kg', 'Živa') });
    cartStore.add({ pubkey: OWNER_A, listingId: 'gone', unitId: UNIT_A, qty: 1, display: display('Staro', '1.00', 'kos', 'Živa') });
    await render();
    await settle();
    const problem = container.querySelector('[data-testid="line-problem"]')!;
    expect(text(problem)).toContain('Ni več na voljo');
    await act(async () => { (Array.from(problem.querySelectorAll('button')).find(b => b.textContent === 'Odstrani')!).click(); });
    await settle();
    expect(cartStore.get().lines.map(l => l.listingId)).toEqual(['jabolka']);
    expect(text(container.querySelector('[data-testid="cart-total"]'))).toBe('9,50 €');
  });

  it('while the server still allows one product per order: says so, shows no shop total or blocked button, offers each product on its own', async () => {
    maxItems = 1;
    seed();
    await render();
    await settle();
    const a = shops()[0];
    expect(text(a.querySelector('[data-testid="too-many"]'))).toContain('vsakega naročite z gumbom »Naroči samo ta izdelek«');
    // no "Na blagajno" that cannot be used, and no total of an order that will not exist
    expect(a.querySelector('[data-testid="cart-checkout"]')).toBeNull();
    expect(a.querySelector('[data-testid="cart-total"]')).toBeNull();
    // each line keeps its own price and line total
    expect(Array.from(a.querySelectorAll('[data-testid="line-total"]')).map(x => text(x))).toEqual(['13,50 €', '7,96 €']);
    const alone = Array.from(a.querySelectorAll('[data-testid="order-alone"]')).map(x => x.getAttribute('href'));
    expect(alone).toEqual([
      `/narocilo/novo/${OWNER_A}/jabolka?qty=3&from=cart`,
      `/narocilo/novo/${OWNER_A}/hruske?qty=2&from=cart`,
    ]);
    expect(Array.from(a.querySelectorAll('[data-testid="order-alone"]')).map(x => x.textContent)).toEqual(['Naroči samo ta izdelek', 'Naroči samo ta izdelek']);
    // a one-product shop is not affected
    expect(shops()[1].querySelector('a[data-testid="cart-checkout"]')).not.toBeNull();
    expect(text(shops()[1].querySelector('[data-testid="cart-total"]'))).toBe('12,50 €');
  });

  it('only the minimum is the problem (no upper limit: max null) → "Najmanj 3 kose" with a one-click fix, not "Ni več na voljo"', async () => {
    cartStore.add({ pubkey: OWNER_A, listingId: 'jabolka', unitId: UNIT_A, qty: 1, display: display('Jabolka', '4.50', 'piece', 'Živa') });
    override = (body) => (body.lines[0].qty < 3
      ? { status: 409, body: { code: 'QTY_UNAVAILABLE', reason: 'qty', line: 0, min: 3, max: null } }
      : null);
    await render();
    await settle();
    const problem = container.querySelector('[data-testid="line-problem"]')!;
    expect(text(problem)).toContain('Najmanj 3 kosi');
    expect(text(problem)).not.toContain('Ni več na voljo');
    const fix = Array.from(problem.querySelectorAll('button')).find(b => b.textContent?.startsWith('Nastavi na'))!;
    expect(fix.textContent).toBe('Nastavi na 3 kose');
    await act(async () => { fix.click(); });
    await settle();
    expect(cartStore.get().lines[0]).toMatchObject({ qty: 3 });
    // only the minimum was learnt; no stock limit was invented
    expect(cartStore.get().lines[0].display).toMatchObject({ minOrder: 3, availableQty: null });
    expect(container.querySelector('[data-testid="line-problem"]')).toBeNull();
  });

  it('a shop that cannot take orders right now says so for the whole shop — no product is offered for removal', async () => {
    seed();
    override = (body) => (body.lines[0].pubkey === OWNER_A
      ? { status: 409, body: { code: 'NOT_BUYABLE', reason: 'registration_inactive', scope: 'shop' } }
      : null);
    await render();
    await settle();
    const a = shops()[0];
    expect(text(a.querySelector('[data-testid="shop-problem"]'))).toContain('Ta pridelovalec trenutno ne sprejema spletnih naročil');
    expect(a.querySelector('[data-testid="line-problem"]')).toBeNull();
    expect(cartStore.get().lines).toHaveLength(3);
    // the other shop still checks out
    expect(shops()[1].querySelector('a[data-testid="cart-checkout"]')).not.toBeNull();
  });

  it('the stepper buttons name their product and are 44 px touch targets', async () => {
    seed();
    await render();
    await settle();
    const minus = container.querySelector('button[aria-label="Manj: Hruške"]') as HTMLButtonElement;
    const plus = container.querySelector('button[aria-label="Več: Hruške"]') as HTMLButtonElement;
    expect(minus).not.toBeNull();
    expect(plus).not.toBeNull();
    expect(plus.className).toContain('h-11');
    expect(plus.className).toContain('w-11');
    expect(container.querySelector('button[aria-label="+"]')).toBeNull();
  });

  it('"Odstrani" takes the line out of the cart (and out of storage)', async () => {
    seed();
    await render();
    await settle();
    const remove = container.querySelector('button[aria-label="Odstrani Med"]') as HTMLButtonElement;
    await act(async () => { remove.click(); });
    expect(shops()).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)!).lines.map((l: any) => l.listingId)).toEqual(['jabolka', 'hruske']);
  });
});
