import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { LanguageProvider } from '@/i18n/LanguageContext';
import OrderStatusPage from './OrderStatusPage';
import { rememberOrder, saveOrderKey } from '@/lib/shopOrder';

// No network: fetch is stubbed; the page never publishes (the portal server
// forwards a cancel to the broker).
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sk = generateSecretKey();
const BUYER = getPublicKey(sk);
const ORDER_ID = `${BUYER.slice(0, 24)}.${'0'.repeat(32)}`;
const OWNER = 'a'.repeat(64);

function view(over: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID, unitId: '1'.repeat(32), unitName: 'Eko kmetija Ana', client: 'www.lanaeco.farm',
    items: [
      { a: `36500:${OWNER}:pesa`, kind: 36500, qty: 2, saleUnit: 'kg', unitPrice: '4.00', currency: 'EUR', title: 'Rdeča pesa' },
      { a: `36500:${OWNER}:jajca`, kind: 36500, qty: 3, saleUnit: 'piece', unitPrice: '0.50', currency: 'EUR', title: 'Jajca' },
    ],
    shipping: '0.00', total: '9.50', currency: 'EUR', fulfillment: 'pickup', buyerStatus: 'placed',
    paymentState: 'unpaid', paidAt: null, txId: null, txHash: null, lanaAmount: null, effectiveStatus: 'placed',
    carrier: null, tracking: null, shippedAt: null, deliveredAt: null, createdAt: 1_790_000_000, payBy: null,
    ...over,
  };
}

let answers: Array<{ status: number; body: any }>;
let calls: string[];
let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.setItem('lanaeco-lang', 'sl');
  answers = [];
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const a = answers.length > 1 ? answers.shift()! : answers[0];
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  }));
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
        <MemoryRouter initialEntries={[`/narocilo/${ORDER_ID}`]}>
          <Routes>
            <Route path="/narocilo/:orderId" element={<OrderStatusPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  });
  await flush();
}

const plain = (s: string | null | undefined) => String(s ?? '').replace(/ | /g, ' ');

describe('OrderStatusPage', () => {
  it('amounts and quantities in the site language, as in the cart and checkout', async () => {
    answers = [{ status: 200, body: view() }];
    await renderPage();
    const lines = Array.from(container.querySelectorAll('[data-testid="order-line"]')).map(l => plain(l.textContent));
    expect(lines[0]).toContain('Rdeča pesa × 2 kg');
    expect(lines[0]).toContain('2 kg × 4,00 €');
    expect(lines[0]).toContain('8,00 €');
    expect(lines[1]).toContain('Jajca × 3 kosi');
    expect(plain(container.querySelector('[data-testid="order-total"]')?.textContent)).toBe('9,50 €');
    expect(container.textContent).not.toMatch(/\d EUR/);
  });

  it('while unpaid it polls every 10 s (the route allows 120 per 15 min), not every 5 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    answers = [{ status: 200, body: view() }];
    await renderPage();
    const first = calls.length;
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(calls.length).toBe(first);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await flush();
    expect(calls.length).toBe(first + 1);
  });

  it('a 429 is not swallowed: the page says it checks again shortly, and waits 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    answers = [{ status: 200, body: view() }, { status: 429, body: {} }];
    await renderPage();
    expect(container.querySelector('[data-testid="refresh-paused"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(container.querySelector('[data-testid="refresh-paused"]')?.textContent).toBe('Stanje bomo kmalu znova preverili …');
    const n = calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(calls.length).toBe(n);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(calls.length).toBe(n + 1);
  });

  it('a refused cancel is told in Slovenian, never as a bare code', async () => {
    saveOrderKey(ORDER_ID, bytesToHex(sk));
    rememberOrder({
      orderId: ORDER_ID, unitId: '1'.repeat(32), unitName: 'Eko kmetija Ana', title: 'Rdeča pesa', qty: 2,
      total: '9.50', currency: 'EUR', createdAt: 1_790_000_000,
      tags: [['d', ORDER_ID], ['a', `30901:${OWNER}:${'1'.repeat(32)}`], ['status', 'placed']],
    });
    answers = [{ status: 200, body: view() }];
    await renderPage();
    const cancel = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Prekliči naročilo')!;
    expect(cancel).toBeDefined();
    for (const [status, code, text] of [
      [409, 'NOT_CANCELLABLE', 'Tega naročila ni več mogoče preklicati.'],
      [429, undefined, 'Trenutno je preveč zahtev. Počakajte minuto in poskusite znova.'],
      [502, 'BROKER_ERROR', 'Naročila ni bilo mogoče preklicati. Poskusite znova.'],
    ] as const) {
      vi.mocked(toast.error).mockClear();
      answers = [{ status, body: code ? { code } : {} }, { status: 200, body: view() }];
      await act(async () => { cancel.click(); });
      await flush();
      expect(toast.error).toHaveBeenCalledWith(text);
    }
  });
});
