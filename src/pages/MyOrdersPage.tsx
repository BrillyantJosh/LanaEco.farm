/**
 * /moja-narocila — orders placed from THIS browser (localStorage only; the
 * buyer never logs in). Each entry links to the public status page.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import { listStoredOrders, pruneExpiredOrders, type StoredOrder } from '@/lib/shopOrder';
import { formatPrice, formatQty } from '@/lib/format';

export default function MyOrdersPage() {
  const { t, locale } = useLanguage();
  const [orders, setOrders] = useState<StoredOrder[]>([]);

  useEffect(() => {
    pruneExpiredOrders();
    setOrders(listStoredOrders().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }, []);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-6">{t('myOrders.title')}</h1>
      {orders.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground font-sans">{t('myOrders.empty')}</p>
          <Link to="/ponudbe" className="inline-block mt-4 text-sm text-primary hover:underline font-sans">{t('order.backToShop')}</Link>
        </div>
      ) : (
        <ul className="rounded-xl border bg-card divide-y">
          {orders.map(o => (
            <li key={o.orderId}>
              <Link to={`/narocilo/${o.orderId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition">
                <div className="flex-1 min-w-0">
                  {/* Only the title shortens: "× 2 + še 1" always stays visible,
                      so a cart order never looks like a single product. */}
                  <div className="flex min-w-0 items-baseline gap-1 text-sm font-sans font-medium">
                    <span className="min-w-0 truncate">{o.title}</span>
                    <span className="shrink-0 whitespace-nowrap">
                      × {formatQty(o.qty, o.saleUnit, locale)}
                      {(o.items?.length ?? 1) > 1 && (
                        <span className="text-muted-foreground font-normal" data-testid="more-items"> {t('myOrders.moreItems', { n: (o.items?.length ?? 1) - 1 })}</span>
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground font-sans truncate">
                    {o.unitName} · {new Date((o.createdAt || 0) * 1000).toLocaleString(locale === 'sl' ? 'sl-SI' : 'en-GB')}
                  </div>
                </div>
                <div className="text-sm font-sans font-medium whitespace-nowrap" data-testid="my-order-total">{formatPrice(o.total, o.currency, locale)}</div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
