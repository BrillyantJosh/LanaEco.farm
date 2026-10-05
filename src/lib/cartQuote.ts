/**
 * POST /api/orders/quote for a cart of ONE shop. The server prices every
 * line from the merchant-signed listing; the page shows only these numbers.
 */
import type { NostrEvent } from './shopOrder';

export interface QuoteLine {
  pubkey: string;
  listingId: string;
  qty: number;
}

export interface QuoteItem {
  a: string;
  kind: number;
  qty: number;
  saleUnit: string;
  unitPrice: string;
  currency: string;
  title: string;
}

export interface Quote {
  unitId: string;
  unitOwnerHex: string;
  unitName: string;
  currency: string;
  items: QuoteItem[];
  shipping: string;
  total: string;
  fulfillmentModes: string[];
  fulfillment: string;
  payBy: number;
  rawUnitEvent: NostrEvent;
  relays: string[];
  /** How many different products ONE order may carry right now (older servers: absent = 1). */
  maxItems?: number;
}

/**
 * A refused quote: the server's code, and for a cart which line and its
 * accepted range (`max: null` = no upper limit) — or `scope: 'shop'` when the
 * whole shop cannot take orders right now (no line is to blame).
 */
export class QuoteFailure extends Error {
  constructor(
    public code: string,
    public reason?: string,
    public line?: number,
    public min?: number,
    public max?: number | null,
    public scope?: 'shop',
  ) {
    super(code);
  }
}

/**
 * Price these lines of ONE shop. `unitId` = the shop the cart files them
 * under: a product that has moved to another unit is then refused as its own
 * line, never blamed on its neighbours.
 */
export async function fetchCartQuote(lines: QuoteLine[], fulfillment: 'shipping' | 'pickup', signal?: AbortSignal, unitId?: string): Promise<Quote> {
  const res = await fetch('/api/orders/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Only which product and how many — never a price.
    body: JSON.stringify({
      lines: lines.map(l => ({ pubkey: l.pubkey, listingId: l.listingId, qty: l.qty })),
      fulfillment,
      ...(unitId ? { unitId } : {}),
    }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new QuoteFailure(
      String(body?.code || `HTTP_${res.status}`),
      typeof body?.reason === 'string' ? body.reason : undefined,
      typeof body?.line === 'number' ? body.line : undefined,
      typeof body?.min === 'number' ? body.min : undefined,
      typeof body?.max === 'number' || body?.max === null ? body.max : undefined,
      body?.scope === 'shop' ? 'shop' : undefined,
    );
  }
  return body as Quote;
}

/** Does a quote item belong to this request line? (a = '<kind>:<pubkey>:<listing id>') */
export function itemMatchesLine(item: Pick<QuoteItem, 'a'> | undefined, line: QuoteLine): boolean {
  if (!item) return false;
  const parts = String(item.a || '').split(':');
  return parts.length >= 3 && parts[1] === line.pubkey && parts.slice(2).join(':') === line.listingId;
}

/** Same money and items — what decides whether the shopper must look again before signing. */
export function sameQuote(a: Quote | null, b: Quote | null): boolean {
  if (!a || !b) return false;
  if (a.total !== b.total || a.shipping !== b.shipping || a.currency !== b.currency || a.items.length !== b.items.length) return false;
  return a.items.every((it, i) => {
    const o = b.items[i];
    return it.a === o.a && it.qty === o.qty && it.unitPrice === o.unitPrice && it.saleUnit === o.saleUnit && it.currency === o.currency;
  });
}
