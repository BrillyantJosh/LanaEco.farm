import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';
import Header from './Header';
import { cartStore } from '@/contexts/CartContext';
import { CART_STORAGE_KEY } from '@/lib/cart';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PK = 'a'.repeat(64);
const UNIT = 'd41e2097fa3942ee9538fe5ded81bf86';
const line = (id: string, unit: string) => ({
  pubkey: PK, listingId: id, unitId: UNIT, qty: 1,
  display: { title: id, image: '', price: '2.00', currency: 'EUR', unit, unitName: 'Kmetija Ana', minOrder: null, maxOrder: null, availableQty: null },
});

let root: Root | null = null;
let container: HTMLDivElement;

async function render(path = '/') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LanguageProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Header />
          </MemoryRouter>
        </AuthProvider>
      </LanguageProvider>,
    );
  });
}

const header = () => container.querySelector('header')!;

beforeEach(() => {
  localStorage.setItem('lanaeco-lang', 'sl');
  localStorage.removeItem(CART_STORAGE_KEY);
  cartStore.resetForTests();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  cartStore.resetForTests();
});

describe('header cart and "Moja naročila"', () => {
  it('a cart icon in the desktop nav AND in the always-visible mobile bar, linking to /kosarica', async () => {
    await render('/ponudbe');
    const carts = Array.from(header().querySelectorAll('a[href="/kosarica"]'));
    expect(carts).toHaveLength(2);
    // the mobile one sits next to the menu button, not inside the collapsible menu
    const mobileBar = carts[1].parentElement!;
    expect(mobileBar.querySelector('button')).not.toBeNull();
    expect(carts[0].getAttribute('aria-label')).toBe('Košarica, 0 izdelkov');
    expect(header().querySelector('[data-testid="header-cart-count"]')).toBeNull();
  });

  it('the badge counts different products and follows the cart live, with Slovenian plurals', async () => {
    await render('/');
    const badge = () => header().querySelector('[data-testid="header-cart-count"]')?.textContent;
    const label = () => header().querySelector('a[href="/kosarica"]')!.getAttribute('aria-label');
    await act(async () => { cartStore.add(line('a', 'kg')); });
    expect(badge()).toBe('1');
    expect(label()).toBe('Košarica, 1 izdelek');
    await act(async () => { cartStore.add({ ...line('a', 'kg'), qty: 3 }); }); // same product: quantity, not a new line
    expect(badge()).toBe('1');
    await act(async () => { cartStore.add(line('b', 'piece')); });
    expect(label()).toBe('Košarica, 2 izdelka');
  });

  it('"Moja naročila" is in the nav, next to the farm\'s own links (and the merchant login stays)', async () => {
    await render('/');
    const navLinks = Array.from(header().querySelectorAll('nav a')).map(a => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(navLinks).toEqual(expect.arrayContaining([
      ['Domov', '/'], ['Pridelovalci', '/kmetje'], ['Ponudbe', '/ponudbe'], ['Smernice', '/smernice'], ['Moja naročila', '/moja-narocila'],
    ]));
    expect(header().querySelector('a[href="https://shop.lanapays.us/login"]')).not.toBeNull();
  });
});
