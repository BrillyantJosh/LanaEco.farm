import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import MyOrdersPage from './MyOrdersPage';
import { rememberOrder } from '@/lib/shopOrder';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  localStorage.clear();
});

const plain = (s: string | null | undefined) => String(s ?? '').replace(/ | /g, ' ');

describe('MyOrdersPage', () => {
  it('totals and quantities in the site language; an older entry without a sale unit keeps the bare number', async () => {
    localStorage.setItem('lanaeco-lang', 'sl');
    const now = Math.floor(Date.now() / 1000);
    rememberOrder({ orderId: 'a'.repeat(24) + '.1', unitId: 'u', unitName: 'Eko kmetija Ana', title: 'Rdeča pesa', qty: 2, saleUnit: 'kg', total: '8.00', currency: 'EUR', createdAt: now - 10, tags: [] });
    rememberOrder({ orderId: 'b'.repeat(24) + '.2', unitId: 'u', unitName: 'Eko kmetija Ana', title: 'Med', qty: 1, total: '9.00', currency: 'EUR', createdAt: now - 20, tags: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<LanguageProvider><MemoryRouter><MyOrdersPage /></MemoryRouter></LanguageProvider>);
    });
    const totals = Array.from(container.querySelectorAll('[data-testid="my-order-total"]')).map(e => plain(e.textContent));
    expect(totals).toEqual(['8,00 €', '9,00 €']);
    expect(container.textContent).toContain('× 2 kg');
    expect(container.textContent).toContain('× 1');
    expect(container.textContent).not.toMatch(/\d EUR/);
  });
});
