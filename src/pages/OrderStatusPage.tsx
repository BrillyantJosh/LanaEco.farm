/**
 * /narocilo/:orderId — PUBLIC order status (no PII anywhere in the view).
 *
 * Polls GET /api/orders/:id every 5 s while unpaid, every 30 s afterwards.
 * `?src=pay` (set by the gateway return_url) is passed through to the
 * server as a hint ONLY — nothing on this page trusts gateway URL params;
 * the payment state always comes from our server's relay-derived verdict.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Loader2, AlertTriangle, XCircle, ExternalLink, Truck, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageContext';
import { buildCancelEvent, getStoredOrder, loadOrderKey } from '@/lib/shopOrder';
import type { TranslationKey } from '@/i18n/translations';
import { lineTotal } from '@/lib/cart';

interface OrderView {
  orderId: string;
  unitId: string;
  unitName: string;
  client: string;
  items: Array<{ a: string; kind: number; qty: number; saleUnit: string; unitPrice: string; currency: string; title: string }>;
  shipping: string;
  total: string;
  currency: string;
  fulfillment: string;
  buyerStatus: string;
  paymentState: 'unpaid' | 'paid' | 'amount_mismatch' | 'expired' | 'cancelled';
  paidAt: number | null;
  txId: string | null;
  txHash: string | null;
  lanaAmount: string | null;
  effectiveStatus: string;
  priceChanged?: boolean;
  carrier: string | null;
  tracking: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: number;
  payBy: number | null;
  payUrl?: string;
}

const STEP_ORDER = ['placed', 'paid', 'shipped', 'delivered'] as const;
const STEP_KEYS: Record<(typeof STEP_ORDER)[number], TranslationKey> = {
  placed: 'order.placed', paid: 'order.paid', shipped: 'order.shipped', delivered: 'order.delivered',
};

function reachedStep(v: OrderView): number {
  if (v.paymentState !== 'paid') return 0;
  const s = v.effectiveStatus;
  if (s === 'delivered' || s === 'completed') return 3;
  if (s === 'shipped') return 2;
  return 1;
}

export default function OrderStatusPage() {
  const { t } = useLanguage();
  const { orderId = '' } = useParams<{ orderId: string }>();
  const [params] = useSearchParams();
  const [view, setView] = useState<OrderView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const firstLoad = useRef(true);
  const stored = getStoredOrder(orderId);
  const hasKey = !!loadOrderKey(orderId);

  const load = useCallback(async () => {
    const hint = firstLoad.current && params.get('src') === 'pay' ? '?src=pay' : '';
    firstLoad.current = false;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}${hint}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) return;
      const body = (await res.json()) as OrderView;
      setView(body);
      setNotFound(false);
    } catch {}
  }, [orderId, params]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ms = !view || view.paymentState === 'unpaid' ? 5000 : 30000;
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [load, view?.paymentState]);

  const cancel = async () => {
    const privHex = loadOrderKey(orderId);
    if (!privHex || !stored?.tags?.length || cancelling) return;
    setCancelling(true);
    try {
      const event = buildCancelEvent(privHex, stored.tags);
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.code || `HTTP_${res.status}`);
      }
      await load();
    } catch (err: any) {
      toast.error(String(err?.message || err));
    } finally {
      setCancelling(false);
    }
  };

  if (notFound) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <h2 className="font-display text-xl font-bold mb-2">{t('listingDetail.notFound')}</h2>
        <Link to="/ponudbe" className="text-primary hover:underline font-sans text-sm">{t('order.backToShop')}</Link>
      </div>
    );
  }
  if (!view) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const step = reachedStep(view);
  const item = view.items[0];
  const listingPath = item?.a?.split(':');
  // Pay again = a NEW order superseding this one, with EVERY item of it;
  // only offered where this order's key lives (the supersedes tag needs the
  // old buyer pubkey). One item keeps the old product route; a cart order
  // goes through the shop's checkout, which rebuilds all of its items.
  const retryPath = !hasKey || !listingPath || listingPath.length < 3
    ? null
    : view.items.length === 1
      ? `/narocilo/novo/${listingPath[1]}/${listingPath.slice(2).join(':')}?qty=${item.qty}&supersedes=${encodeURIComponent(orderId)}`
      : `/kosarica/narocilo/${listingPath[1]}/${view.unitId}?supersedes=${encodeURIComponent(orderId)}`;
  const terminalBad = view.effectiveStatus === 'rejected' || view.effectiveStatus === 'refunded';

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <Link to="/ponudbe" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 font-sans">
        <ArrowLeft className="w-4 h-4" /> {t('order.backToShop')}
      </Link>

      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h1 className="font-display text-2xl font-bold">{t('order.title')}</h1>
        <span className="text-xs font-mono text-muted-foreground truncate">{orderId.slice(-12)}</span>
      </div>
      <p className="text-sm text-muted-foreground font-sans mb-6">{view.unitName}</p>

      {/* State banner */}
      {view.paymentState === 'unpaid' && (
        <div className="rounded-lg border bg-card p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-sans"><Loader2 className="w-4 h-4 animate-spin text-primary" /> {t('order.awaitingPayment')}</span>
          <div className="flex gap-2">
            {view.payUrl && (
              <Button asChild size="sm"><a href={view.payUrl}>{t('order.payNow')}</a></Button>
            )}
            {hasKey && stored?.tags?.length ? (
              <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>{t('order.cancel')}</Button>
            ) : null}
          </div>
        </div>
      )}
      {view.paymentState === 'amount_mismatch' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-4 mb-6 flex items-start gap-2 text-sm font-sans">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {t('order.amountMismatch')}
        </div>
      )}
      {view.paymentState === 'expired' && (
        <div className="rounded-lg border bg-muted p-4 mb-6 flex flex-wrap items-center justify-between gap-3 text-sm font-sans">
          <span className="inline-flex items-center gap-2"><XCircle className="w-4 h-4 text-muted-foreground" /> {t('order.expired')}</span>
          {retryPath && <Button asChild size="sm"><Link to={retryPath}>{t('order.payAgain')}</Link></Button>}
        </div>
      )}
      {view.paymentState === 'cancelled' && (
        <div className="rounded-lg border bg-muted p-4 mb-6 flex items-center gap-2 text-sm font-sans">
          <XCircle className="w-4 h-4 text-muted-foreground" /> {t('order.cancelled')}
        </div>
      )}
      {terminalBad && (
        <div className="rounded-lg border bg-muted p-4 mb-6 flex items-center gap-2 text-sm font-sans">
          <XCircle className="w-4 h-4 text-muted-foreground" /> {view.effectiveStatus === 'rejected' ? t('order.rejected') : t('order.refunded')}
        </div>
      )}

      {/* Steps */}
      {!terminalBad && view.paymentState !== 'cancelled' && (
        <ol className="rounded-xl border bg-card divide-y mb-6">
          {STEP_ORDER.map((s, i) => {
            const done = i <= step;
            const label = s === 'delivered' && view.effectiveStatus === 'completed' ? t('order.completed') : t(STEP_KEYS[s]);
            return (
              <li key={s} className="flex items-center gap-3 px-4 py-3 text-sm font-sans">
                {done ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5 text-muted-foreground/40" />}
                <span className={done ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
                {s === 'paid' && done && view.txHash && (
                  <a href={`https://chainz.cryptoid.info/lana/tx.dws?${view.txHash}.htm`} target="_blank" rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="w-3 h-3" /> {t('order.viewTx')}
                  </a>
                )}
                {s === 'shipped' && done && (view.carrier || view.tracking) && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Truck className="w-3 h-3" />
                    {view.carrier && <span>{t('order.carrier')}: {view.carrier}</span>}
                    {view.tracking && <span>· {t('order.tracking')}: {/^https?:\/\//.test(view.tracking)
                      ? <a href={view.tracking} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{view.tracking}</a>
                      : view.tracking}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Items */}
      <div className="rounded-xl border bg-card p-4 space-y-2 text-sm font-sans">
        {view.items.map((it, i) => (
          <div key={i} className="flex justify-between gap-3" data-testid="order-line">
            <span className="min-w-0">
              {it.title || it.a} × {it.qty}
              <span className="block text-xs text-muted-foreground">{it.qty} × {it.unitPrice} {it.currency}</span>
            </span>
            <span className="whitespace-nowrap">{lineTotal(it.unitPrice, it.qty) || it.unitPrice} {it.currency}</span>
          </div>
        ))}
        <div className="flex justify-between text-muted-foreground">
          <span>{t('checkout.shippingFee')}</span>
          <span>{view.shipping} {view.currency}</span>
        </div>
        <div className="flex justify-between font-bold border-t pt-2">
          <span>{t('order.total')}</span>
          <span>{view.total} {view.currency}</span>
        </div>
        {view.lanaAmount && view.paymentState === 'paid' && (
          <div className="text-xs text-muted-foreground">{view.lanaAmount} LANA</div>
        )}
      </div>
    </div>
  );
}
