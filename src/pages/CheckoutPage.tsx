/**
 * Lana Online Shop — checkout. ONE order of ONE shop:
 *
 *   /kosarica/narocilo/:ownerHex/:unitId   that shop's lines from the cart
 *   /narocilo/novo/:pubkey/:listingId?qty  one product (old links, SPEC §9.3,
 *                                          "Naroči samo ta izdelek" from the cart)
 *
 * Flow: quote from OUR server (prices come from the merchant-signed listings,
 * never from this page or the cart) → ephemeral key + order id → sign 36520
 * with EVERY line (no PII) + 36522 (NIP-44 to the unit owner, recipient =
 * verifyEvent(raw30901).pubkey) → POST /api/orders → top-level navigation to
 * the gateway pay_url. The cart lines of this order leave the cart only once
 * the broker answered with a pay_url; on any failure the cart is untouched.
 *
 * `?supersedes=<oldOrderId>` turns this into a retry-after-expiry: a NEW
 * order id with the `supersedes` tag, posted to /api/orders/:old/retry. On
 * the cart route it rebuilds ALL items of the old order (not the cart).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock, ShoppingBag, Truck, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  newOrderIdentity, buildOrderEvent, buildDeliveryEvent, saveOrderKey, rememberOrder, pubkeyForOrderKey,
  type DeliveryDetails,
} from '@/lib/shopOrder';
import {
  validateCheckout, normalizeEmail, normalizePhone, CHECKOUT_FIELD_ORDER,
  type CheckoutField, type CheckoutForm, type Fulfillment,
} from '@/lib/checkoutValidation';
import { useCart, cartStore } from '@/contexts/CartContext';
import { lineKey, lineTotal, shopKey, sumLines, toQuoteLines } from '@/lib/cart';
import { fetchCartQuote, sameQuote, QuoteFailure, type Quote, type QuoteLine } from '@/lib/cartQuote';
import { formatPrice } from '@/lib/format';

/** The old order's items (public view) as quote lines — for a retry of a cart order. */
async function linesOfOrder(orderId: string, ownerHex: string): Promise<QuoteLine[]> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : [];
  const out: QuoteLine[] = [];
  for (const it of items) {
    const parts = String(it?.a || '').split(':');
    if (parts.length < 3 || parts[1] !== ownerHex || !Number.isInteger(it?.qty)) continue;
    out.push({ pubkey: parts[1], listingId: parts.slice(2).join(':'), qty: it.qty });
  }
  return out;
}

export default function CheckoutPage() {
  const { t, locale } = useLanguage();
  const params = useParams<{ pubkey: string; listingId: string; ownerHex: string; unitId: string }>();
  const fromCart = !!params.ownerHex;
  const ownerHex = String(params.ownerHex || '').toLowerCase();
  const pubkey = params.pubkey || '';
  const listingId = params.listingId || '';
  const [search] = useSearchParams();
  const supersedes = search.get('supersedes') || '';
  // Retry-after-expiry needs `36520:<B_old>:<D_old>`; B_old comes from the
  // old order's key in THIS browser (the public view never carries it).
  const supersededBuyer = supersedes ? pubkeyForOrderKey(supersedes) : null;
  const retryBlocked = !!supersedes && !supersededBuyer;
  const singleQty = Math.max(1, parseInt(search.get('qty') || '1', 10) || 1);
  const cart = useCart();

  // The lines of THIS order: the shop's cart lines, the old order's items
  // (retry on the cart route), or the one product of the old route.
  const [retryLines, setRetryLines] = useState<QuoteLine[] | null>(null);
  useEffect(() => {
    if (!fromCart || !supersedes) return;
    let alive = true;
    linesOfOrder(supersedes, ownerHex).then(l => alive && setRetryLines(l)).catch(() => alive && setRetryLines([]));
    return () => { alive = false; };
  }, [fromCart, supersedes, ownerHex]);
  const group = fromCart ? cart.groups.find(g => g.unitKey === shopKey(ownerHex, params.unitId || '')) : undefined;
  const lines: QuoteLine[] | null = useMemo(() => {
    if (!fromCart) return [{ pubkey, listingId, qty: singleQty }];
    if (supersedes) return retryLines;
    return group ? toQuoteLines(group.lines) : [];
  }, [fromCart, pubkey, listingId, singleQty, supersedes, retryLines, group]);
  const linesKey = lines ? JSON.stringify(lines) : '';
  /** Lines that came out of the cart leave it once the order exists. */
  const cartKeys = (fromCart && !supersedes) || (!fromCart && search.get('from') === 'cart')
    ? (lines || []).map(lineKey) : [];
  const backTo = fromCart ? '/kosarica' : `/ponudba/${pubkey}/${listingId}`;
  /** The shop the cart files these lines under — a moved product is then refused as its own line. */
  const quoteUnitId = fromCart ? params.unitId || undefined : undefined;
  /** Other shops' products in the cart: they stay there (one order = one shop). */
  const otherShops = fromCart && cart.groups.some(g => g.unitKey !== shopKey(ownerHex, params.unitId || ''));

  const [fulfillment, setFulfillment] = useState<Fulfillment>('shipping');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<CheckoutForm>({ name: '', email: '', phone: '', line1: '', line2: '', city: '', postcode: '', country: '', note: '' });
  // A field's message shows once the shopper has left it, or after the
  // first "Nadaljuj" — never while the form is still untouched.
  const [touched, setTouched] = useState<Partial<Record<CheckoutField, boolean>>>({});
  const [showAll, setShowAll] = useState(false);
  // Set once the order exists: its lines then leave the cart, and the page
  // must not re-quote an emptied cart while the browser leaves for pay_url.
  const placed = useRef(false);

  const set = (k: keyof CheckoutForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!linesKey || placed.current) return; // the old order's items are still loading / order placed
    const current = JSON.parse(linesKey) as QuoteLine[];
    if (current.length === 0) { setQuote(null); setQuoteError('EMPTY'); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetchCartQuote(current, fulfillment, undefined, quoteUnitId)
      .then(q => {
        if (!alive) return;
        setQuote(q);
        setQuoteError(null);
      })
      .catch(err => {
        if (!alive) return;
        setQuote(null);
        // A producer that has not turned on online selling is told apart.
        setQuoteError(err instanceof QuoteFailure && err.reason === 'online_shop_off' ? 'ONLINE_SHOP_OFF' : String(err?.message || 'NOT_BUYABLE'));
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [linesKey, fulfillment, quoteUnitId]);

  const canPickup = quote?.fulfillmentModes?.includes('pickup') ?? false;
  const items = quote?.items ?? [];
  // How many different products ONE order may carry right now (server gate).
  const maxItems = quote?.maxItems ?? 1;
  const tooMany = items.length > maxItems;

  useEffect(() => {
    if (quote && !canPickup && fulfillment === 'pickup') setFulfillment('shipping');
  }, [quote, canPickup, fulfillment]);

  // Name, e-mail and phone always; the address only when shipping.
  const errors = useMemo(() => validateCheckout(form, fulfillment), [form, fulfillment]);
  const formValid = Object.keys(errors).length === 0;
  const shownError = (f: CheckoutField) => (showAll || touched[f] ? errors[f] : undefined);
  /** Props that tie an input to its message (screen readers read it with the field). */
  const fieldA11y = (f: CheckoutField, required: boolean) => {
    const err = shownError(f);
    return {
      required,
      'aria-required': required,
      'aria-invalid': !!err,
      ...(err ? { 'aria-describedby': `co-${f}-err` } : {}),
      onBlur: () => setTouched(tc => (tc[f] ? tc : { ...tc, [f]: true })),
    };
  };
  const fieldError = (f: CheckoutField) => {
    const err = shownError(f);
    return err ? <p id={`co-${f}-err`} role="alert" className="mt-1 text-xs font-sans text-destructive">{t(err)}</p> : null;
  };

  const quoteErrorText = (code: string) => {
    if (code === 'EMPTY') return t('cart.empty');
    if (code === 'ONLINE_SHOP_OFF') return t('shop.onlineShopOff');
    if (code === 'CURRENCY_MISMATCH') return t('shop.currencyMismatch');
    if (code === 'QTY_UNAVAILABLE') return t('shop.soldOut');
    return t('shop.notBuyable');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || retryBlocked || !lines?.length || tooMany) return;
    if (!formValid) {
      // Say what is missing instead of a silently greyed-out button; nothing
      // is quoted, signed or sent.
      setShowAll(true);
      toast.error(t('checkout.fixErrors'));
      const first = CHECKOUT_FIELD_ORDER.find(f => errors[f]);
      const el = first ? (document.getElementById(`co-${first}`) as HTMLInputElement | null) : null;
      if (el) {
        el.scrollIntoView?.({ block: 'center' });
        el.focus({ preventScroll: true });
      }
      return;
    }
    setSubmitting(true);
    try {
      // Fresh quote right before signing — the prices the server will
      // re-derive against are the ones we put in the tags. If they moved
      // since the summary was drawn, show the new numbers and sign nothing.
      const q = await fetchCartQuote(lines, fulfillment, undefined, quoteUnitId);
      if (!sameQuote(q, quote)) {
        setQuote(q);
        toast.error(t('cart.priceChanged'));
        setSubmitting(false);
        return;
      }
      const id = newOrderIdentity();
      const order = buildOrderEvent(id.privHex, {
        orderId: id.orderId,
        unitOwnerHex: q.unitOwnerHex,
        unitId: q.unitId,
        // EVERY line, exactly as the server quoted it, in its order.
        items: q.items.map(qi => ({ a: qi.a, qty: qi.qty, saleUnit: qi.saleUnit, unitPrice: qi.unitPrice, currency: qi.currency })),
        shipping: q.shipping,
        total: q.total,
        currency: q.currency,
        fulfillment,
        status: 'placed',
        client: window.location.host,
        ...(supersedes && supersededBuyer ? { supersedes: `36520:${supersededBuyer}:${supersedes}` } : {}),
      });
      const details: DeliveryDetails = {
        name: form.name.trim(),
        // Always present (validated above): the seller needs both.
        email: normalizeEmail(form.email),
        phone: normalizePhone(form.phone),
        address: {
          line1: form.line1.trim(),
          ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
          city: form.city.trim(),
          postcode: form.postcode.trim(),
          country: form.country.trim(),
        },
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      };
      const delivery = buildDeliveryEvent(id.privHex, { orderId: id.orderId, unitId: q.unitId, rawUnitEvent: q.rawUnitEvent, details });

      const path = supersedes ? `/api/orders/${encodeURIComponent(supersedes)}/retry` : '/api/orders';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, delivery }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.pay_url) {
        // Nothing is stored and the cart keeps every line.
        const code = body?.code || `HTTP_${res.status}`;
        // This portal has no broker yet: say so instead of a bare error code.
        toast.error(code === 'ORDERING_UNAVAILABLE' ? t('shop.orderingUnavailable') : `${t('checkout.failed')} (${code})`);
        setSubmitting(false);
        return;
      }
      // Only now does the key become worth keeping.
      saveOrderKey(id.orderId, id.privHex);
      rememberOrder({
        orderId: id.orderId,
        unitId: q.unitId,
        unitName: q.unitName,
        title: q.items[0].title,
        qty: q.items[0].qty,
        items: q.items.map(qi => ({ title: qi.title, qty: qi.qty })),
        total: q.total,
        currency: q.currency,
        createdAt: order.created_at,
        payUrl: body.pay_url,
        tags: order.tags,
      });
      // The order exists (the broker gave a pay_url): these lines leave the
      // cart; other shops' lines stay.
      placed.current = true;
      if (cartKeys.length) cartStore.removeLines(cartKeys);
      // Top-level navigation to the hosted checkout (CORS irrelevant).
      window.location.assign(body.pay_url);
    } catch (err: any) {
      console.error('[checkout]', err?.message || err);
      toast.error(t('checkout.failed'));
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 font-sans">
        <ArrowLeft className="w-4 h-4" /> {fromCart ? t('checkout.backToCart') : t('common.back')}
      </Link>
      {/* Which shop this order is for, before the form — on a phone the
          summary (with the shop name) sits below the whole form. */}
      <h1 className={`font-display text-2xl font-bold ${otherShops ? 'mb-2' : 'mb-6'}`} data-testid="checkout-title">
        {quote?.unitName ? t('checkout.titleShop', { shop: quote.unitName }) : t('checkout.title')}
      </h1>
      {otherShops && (
        <p className="mb-6 text-sm font-sans text-muted-foreground" data-testid="other-shops-stay">{t('checkout.otherShopsStay')}</p>
      )}

      {loading && !quote && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {quoteError && !quote && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm font-sans text-destructive">
          {quoteErrorText(quoteError)}
        </div>
      )}
      {retryBlocked && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 mb-6 text-sm font-sans text-destructive">
          {t('checkout.failed')}
        </div>
      )}

      {quote && items.length > 0 && (
        // noValidate: our own Slovenian messages under each field, not the
        // browser's bubbles in the browser's language.
        <form onSubmit={submit} noValidate className="grid md:grid-cols-5 gap-8">
          <div className="md:col-span-3 space-y-6">
            {/* Fulfillment */}
            <fieldset>
              <legend className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('checkout.fulfillment')}</legend>
              <div className="flex gap-2">
                <button type="button" onClick={() => setFulfillment('shipping')}
                  className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-sans transition ${fulfillment === 'shipping' ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted'}`}>
                  <Truck className="w-4 h-4" /> {t('checkout.shipping')}
                </button>
                {canPickup && (
                  <button type="button" onClick={() => setFulfillment('pickup')}
                    className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-sans transition ${fulfillment === 'pickup' ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted'}`}>
                    <Store className="w-4 h-4" /> {t('checkout.pickup')}
                  </button>
                )}
              </div>
            </fieldset>

            {/* Contact + address */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="co-name">{t('checkout.name')} *</Label>
                <Input id="co-name" value={form.name} onChange={set('name')} autoComplete="name" {...fieldA11y('name', true)} />
                {fieldError('name')}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="co-email">{t('checkout.email')} *</Label>
                  <Input id="co-email" type="email" inputMode="email" value={form.email} onChange={set('email')} autoComplete="email" {...fieldA11y('email', true)} />
                  {fieldError('email')}
                </div>
                <div>
                  <Label htmlFor="co-phone">{t('checkout.phone')} *</Label>
                  <Input id="co-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" {...fieldA11y('phone', true)} />
                  {fieldError('phone')}
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-sans">{t('checkout.contactWhy')}</p>
              <div>
                <Label htmlFor="co-line1">{t('checkout.address')}{fulfillment === 'shipping' ? ' *' : ''}</Label>
                <Input id="co-line1" value={form.line1} onChange={set('line1')} autoComplete="address-line1" {...fieldA11y('line1', fulfillment === 'shipping')} />
                {fieldError('line1')}
              </div>
              <div>
                <Label htmlFor="co-line2">{t('checkout.address2')}</Label>
                <Input id="co-line2" value={form.line2} onChange={set('line2')} autoComplete="address-line2" />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="co-postcode">{t('checkout.postcode')}{fulfillment === 'shipping' ? ' *' : ''}</Label>
                  <Input id="co-postcode" value={form.postcode} onChange={set('postcode')} autoComplete="postal-code" {...fieldA11y('postcode', fulfillment === 'shipping')} />
                  {fieldError('postcode')}
                </div>
                <div>
                  <Label htmlFor="co-city">{t('checkout.city')}{fulfillment === 'shipping' ? ' *' : ''}</Label>
                  <Input id="co-city" value={form.city} onChange={set('city')} autoComplete="address-level2" {...fieldA11y('city', fulfillment === 'shipping')} />
                  {fieldError('city')}
                </div>
                <div>
                  <Label htmlFor="co-country">{t('checkout.country')}{fulfillment === 'shipping' ? ' *' : ''}</Label>
                  <Input id="co-country" value={form.country} onChange={set('country')} autoComplete="country" {...fieldA11y('country', fulfillment === 'shipping')} />
                  {fieldError('country')}
                </div>
              </div>
              <div>
                <Label htmlFor="co-note">{t('checkout.note')}</Label>
                <Input id="co-note" value={form.note} onChange={set('note')} />
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground font-sans">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {t('checkout.privacy')}
              </p>
            </div>
          </div>

          {/* Summary */}
          <aside className="md:col-span-2">
            <div className="rounded-xl border bg-card p-4 space-y-3 sticky top-24">
              <h2 className="font-display font-semibold">{t('checkout.summary')}</h2>
              <p className="text-sm text-muted-foreground font-sans">{quote.unitName}</p>
              <ul className="space-y-2" data-testid="checkout-items">
                {items.map(it => (
                  <li key={it.a} className="text-sm font-sans">
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex items-start gap-2 min-w-0"><ShoppingBag className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" /> <span className="line-clamp-2">{it.title}</span></span>
                      <span className="whitespace-nowrap font-medium">{formatPrice(lineTotal(it.unitPrice, it.qty), it.currency, locale)}</span>
                    </div>
                    <div className="pl-6 text-xs text-muted-foreground">{it.qty} × {formatPrice(it.unitPrice, it.currency, locale)}</div>
                  </li>
                ))}
              </ul>
              {items.length > 1 && (
                <div className="flex items-center justify-between text-sm font-sans border-t pt-2">
                  <span>{t('cart.subtotal')}</span>
                  <span>{formatPrice(sumLines(items), quote.currency, locale)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm font-sans">
                <span>{t('checkout.shippingFee')}</span>
                <span>{formatPrice(quote.shipping, quote.currency, locale)}</span>
              </div>
              <div className="flex items-center justify-between font-sans font-bold border-t pt-3">
                <span>{t('checkout.total')}</span>
                <span data-testid="checkout-total">{formatPrice(quote.total, quote.currency, locale)}</span>
              </div>
              {tooMany && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-sans text-amber-900" role="status">
                  {maxItems === 1 ? t('checkout.oneItemOnly') : t('cart.tooManyLines', { n: maxItems })}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting || loading || retryBlocked || tooMany}>
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('checkout.publishing')}</> : t('checkout.continue')}
              </Button>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
