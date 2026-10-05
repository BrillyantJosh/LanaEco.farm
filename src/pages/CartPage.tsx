/**
 * /kosarica — the cart. One block per producer (shop), because one checkout =
 * one shop = one order = one payment (see lib/cart.ts).
 *
 * Every price, line total, subtotal and shipping fee on this page comes from
 * the server quote for that shop's lines (POST /api/orders/quote), re-asked
 * ~400 ms after the last quantity change. The copy the cart stored when the
 * product was added is drawn only while that quote loads, greyed out, and no
 * total is ever shown from it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2, Minus, Plus, ShoppingBag, ShoppingCart, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageContext';
import { useCart } from '@/contexts/CartContext';
import { limitKind, lineKey, lineTotal, qtyBounds, sumLines, toQuoteLines, type CartLine, type ShopGroup } from '@/lib/cart';
import { fetchCartQuoteAnyMode, itemMatchesLine, QuoteFailure, type Quote } from '@/lib/cartQuote';
import { formatPrice, formatQty } from '@/lib/format';
import type { TranslationKey } from '@/i18n/translations';

const QUOTE_DEBOUNCE_MS = 400;

export default function CartPage() {
  const { t } = useLanguage();
  const { groups } = useCart();

  if (groups.length === 0) {
    return (
      <div className="container mx-auto px-4 py-12 text-center max-w-xl">
        <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <h1 className="font-display text-2xl font-bold mb-2">{t('cart.title')}</h1>
        <p className="text-sm text-muted-foreground font-sans">{t('cart.empty')}</p>
        <Link to="/ponudbe" className="inline-block mt-4 text-sm text-primary hover:underline font-sans">{t('cart.continueShopping')}</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <Link to="/ponudbe" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 font-sans">
        <ArrowLeft className="w-4 h-4" /> {t('cart.continueShopping')}
      </Link>
      <h1 className="font-display text-2xl font-bold mb-2">{t('cart.title')}</h1>
      {groups.length > 1 && (
        <p className="text-sm text-muted-foreground font-sans mb-4" data-testid="separate-orders">{t('cart.separateOrders')}</p>
      )}
      <div className="space-y-6 mt-4">
        {groups.map(g => <ShopCart key={g.unitKey} group={g} />)}
      </div>
    </div>
  );
}

interface QuoteState {
  /** the request (JSON of toQuoteLines) this answer belongs to */
  forKey: string;
  quote: Quote | null;
  failure: QuoteFailure | null;
}

function ShopCart({ group }: { group: ShopGroup }) {
  const { t, locale } = useLanguage();
  const cart = useCart();
  const linesKey = useMemo(() => JSON.stringify(toQuoteLines(group.lines)), [group.lines]);
  const [state, setState] = useState<QuoteState>({ forKey: '', quote: null, failure: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      // Shipping when the products allow it; a pickup-only product (farm)
      // makes the whole order pickup — priced without a shipping fee.
      fetchCartQuoteAnyMode(JSON.parse(linesKey), 'shipping', ctl.signal, group.unitId)
        .then(quote => { if (!ctl.signal.aborted) setState({ forKey: linesKey, quote, failure: null }); })
        .catch(err => {
          if (ctl.signal.aborted) return;
          const failure = err instanceof QuoteFailure ? err : new QuoteFailure('NETWORK');
          setState({ forKey: linesKey, quote: null, failure });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [linesKey, retry, group.unitId]);

  const fresh = state.forKey === linesKey;
  const loading = !fresh;
  const lines = JSON.parse(linesKey) as ReturnType<typeof toQuoteLines>;
  // A quote counts only when it is for exactly these lines, in this order.
  const quote = fresh && state.quote && state.quote.items.length === lines.length && lines.every((l, i) => itemMatchesLine(state.quote!.items[i], l))
    ? state.quote : null;
  const failure = fresh ? state.failure : null;
  const failedLine = failure && typeof failure.line === 'number' ? failure.line : null;
  // Refused for the whole shop (paused, registration lapsed …): no line is to blame.
  const shopRefused = !!failure && failedLine === null && (failure.scope === 'shop' || failure.code === 'NOT_BUYABLE');
  const maxItems = quote?.maxItems ?? 1;
  // More products than ONE order may carry right now: each is ordered on its
  // own (its own order, payment and shipping), so no shop total is shown —
  // it would be the total of no order at all.
  const tooMany = !!quote && group.lines.length > maxItems;
  const shopName = quote?.unitName || group.unitName;
  const currency = quote?.currency || group.currency;
  const canPickup = !!quote?.fulfillmentModes?.includes('pickup');
  const pickupOnly = !!quote && !quote.fulfillmentModes?.includes('shipping');

  return (
    <section className="rounded-xl border bg-card" aria-labelledby={`shop-${group.unitKey}`} data-testid="cart-shop">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id={`shop-${group.unitKey}`} className="font-display text-lg font-semibold truncate">{shopName}</h2>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label={t('common.loading')} />}
      </header>

      <ul className="divide-y" aria-busy={loading}>
        {group.lines.map((l, i) => (
          <CartRow
            key={lineKey(l)}
            line={l}
            item={quote?.items[i] || null}
            loading={loading}
            failure={failedLine === i ? failure : null}
            orderAlone={tooMany ? `/narocilo/novo/${l.pubkey}/${encodeURIComponent(l.listingId)}?qty=${l.qty}&from=cart` : null}
          />
        ))}
      </ul>

      <footer className="border-t px-4 py-4 space-y-2 text-sm font-sans">
        {failure && failedLine === null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive" role="alert" data-testid="shop-problem">
            <span>{shopRefused ? t('cart.shopUnavailable') : t('cart.quoteError')}</span>
            <Button size="sm" variant="outline" onClick={() => setRetry(n => n + 1)}>{t('cart.retry')}</Button>
          </div>
        )}
        {quote && !tooMany && (
          <>
            <div className="flex justify-between">
              <span>{t('cart.subtotal')}</span>
              <span data-testid="cart-subtotal">{formatPrice(sumLines(quote.items), currency, locale)}</span>
            </div>
            {pickupOnly ? (
              <p className="text-xs text-muted-foreground" data-testid="cart-pickup-only">{t('cart.pickupOnly')}</p>
            ) : (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('checkout.shippingFee')}</span>
                  <span data-testid="cart-shipping">{formatPrice(quote.shipping, currency, locale)}</span>
                </div>
                {canPickup && <p className="text-xs text-muted-foreground">{t('cart.pickupFree')}</p>}
              </>
            )}
            <div className="flex justify-between font-bold border-t pt-2">
              <span>{t('checkout.total')}</span>
              <span data-testid="cart-total">{formatPrice(quote.total, currency, locale)}</span>
            </div>
          </>
        )}
        {tooMany && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" role="status" data-testid="too-many">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {maxItems === 1 ? t('cart.oneItemOnly') : t('cart.tooManyLines', { n: maxItems })}
          </p>
        )}
        {!tooMany && (
          <div className="flex justify-end pt-1">
            {quote && !failure ? (
              <Button asChild>
                <Link to={`/kosarica/narocilo/${group.ownerHex}/${group.unitId}`} aria-label={t('cart.checkoutAria', { shop: shopName })} data-testid="cart-checkout">
                  {t('cart.checkout')}
                </Link>
              </Button>
            ) : (
              <Button disabled data-testid="cart-checkout">{t('cart.checkout')}</Button>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}

function CartRow({ line, item, loading, failure, orderAlone }: {
  line: CartLine;
  item: Quote['items'][number] | null;
  loading: boolean;
  failure: QuoteFailure | null;
  orderAlone: string | null;
}) {
  const { t, locale } = useLanguage();
  const cart = useCart();
  const key = lineKey(line);
  const d = line.display;
  const { min, max } = qtyBounds(d);
  const maxText = (n: number) => t(limitKind(d) === 'order' ? 'cart.maxPerOrder' : 'cart.maxReached', { n: formatQty(n, unit, locale) });
  const unit = item?.saleUnit || d.unit;
  const unitLabel = (() => {
    const k = `lunit.${unit}` as TranslationKey;
    const v = t(k);
    return v !== k ? v : unit;
  })();
  const currency = item?.currency || d.currency;
  const title = item?.title || d.title;

  // What the server said about THIS line: a quantity it would accept (one
  // click sets it), or that the product cannot be ordered now (remove it).
  // `max: null` from the server = no upper limit (no stock tag, no max_order):
  // only the minimum can be the problem then.
  const qtyFail = failure?.code === 'QTY_UNAVAILABLE';
  const serverMin = qtyFail && typeof failure!.min === 'number' ? failure!.min : null;
  const serverMax = qtyFail && typeof failure!.max === 'number' ? failure!.max : null;
  const orderable = serverMin !== null && (serverMax === null || (serverMax >= serverMin && serverMax > 0));
  const fixTo = !orderable ? null
    : line.qty < serverMin! ? serverMin!
    : serverMax !== null && line.qty > serverMax ? serverMax
    : null;

  return (
    <li className="flex gap-3 px-4 py-3" data-testid="cart-line" data-key={key}>
      <Link to={`/ponudba/${line.pubkey}/${line.listingId}`} className="shrink-0">
        {d.image ? (
          <img src={d.image} alt="" className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg border bg-white object-contain p-1" loading="lazy" decoding="async" />
        ) : (
          <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg bg-muted flex items-center justify-center"><ShoppingBag className="w-6 h-6 text-muted-foreground/40" /></div>
        )}
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/ponudba/${line.pubkey}/${line.listingId}`} className="font-sans text-sm font-medium leading-snug hover:text-primary line-clamp-2">{title}</Link>
          <span className={`whitespace-nowrap text-sm font-sans font-semibold ${loading || !item ? 'text-muted-foreground/60' : ''}`} data-testid="line-total">
            {item ? formatPrice(lineTotal(item.unitPrice, item.qty), currency, locale) : (d.price ? formatPrice(lineTotal(d.price, line.qty), currency, locale) : '…')}
          </span>
        </div>
        <p className={`text-xs font-sans ${loading || !item ? 'text-muted-foreground/60' : 'text-muted-foreground'}`} data-testid="unit-price">
          {formatPrice(item?.unitPrice || d.price, currency, locale)} / {unitLabel}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {/* 44 px touch targets; each button names its product for screen readers. */}
          <div className="inline-flex items-center rounded-lg border" role="group" aria-label={t('shop.qty')}>
            <button type="button" onClick={() => cart.setQty(key, line.qty - 1)} disabled={line.qty <= Math.max(1, min)}
              className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={t('cart.fewerAria', { title })}>
              <Minus className="w-4 h-4" />
            </button>
            <span className="min-w-[2.75rem] text-center text-sm font-sans font-medium" data-testid="line-qty">{formatQty(line.qty, unit, locale)}</span>
            <button type="button" onClick={() => cart.setQty(key, line.qty + 1)} disabled={line.qty >= max}
              title={line.qty >= max ? maxText(max) : undefined}
              className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={t('cart.moreAria', { title })}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <button type="button" onClick={() => cart.remove(key)} className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-sans text-muted-foreground hover:text-destructive"
            aria-label={t('cart.removeAria', { title })}>
            <Trash2 className="w-3.5 h-3.5" /> {t('cart.remove')}
          </button>
          {orderAlone && !failure && (
            <Button asChild size="sm" variant="outline" className="min-h-[44px]">
              <Link to={orderAlone} data-testid="order-alone">{t('cart.orderThisOnly')}</Link>
            </Button>
          )}
        </div>
        {line.qty >= max && max >= min && !failure && (
          <p className="text-xs font-sans text-muted-foreground" data-testid="line-limit">{maxText(max)}</p>
        )}
        {failure && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-sans text-destructive" role="alert" data-testid="line-problem">
            <AlertTriangle className="w-3.5 h-3.5" />
            {fixTo !== null ? (
              <>
                <span>
                  {fixTo === serverMin && line.qty < fixTo
                    ? t('cart.minQty', { n: formatQty(fixTo, unit, locale) })
                    : t('cart.onlyAvailable', { n: formatQty(fixTo, unit, locale) })}
                </span>
                <Button size="sm" variant="outline" className="min-h-[44px] px-3 text-xs"
                  onClick={() => {
                    // The cart learns the limit, so its stepper stops there
                    // too (no upper limit known → only the minimum).
                    cart.updateLimits(key, serverMax === null ? { minOrder: serverMin } : { availableQty: serverMax, minOrder: serverMin });
                    cart.setQty(key, fixTo);
                  }}>
                  {t('cart.setTo', { n: formatQty(fixTo, unit, locale, 'acc') })}
                </Button>
              </>
            ) : (
              <>
                <span>{failure.reason === 'pickup_only' ? t('shop.pickupOnly') : t('cart.lineUnavailable')}</span>
                <Button size="sm" variant="outline" className="min-h-[44px] px-3 text-xs" onClick={() => cart.remove(key)}>{t('cart.remove')}</Button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
