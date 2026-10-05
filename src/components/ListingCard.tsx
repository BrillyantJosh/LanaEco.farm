import { Link, useNavigate } from 'react-router-dom';
import { Leaf, ShoppingBag, Calendar, Tag, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { EcoListing } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { formatPrice, formatQty } from '@/lib/format';
import { useCart } from '@/contexts/CartContext';
import { limitKind, qtyBounds, type CartDisplay } from '@/lib/cart';

const TYPE_COLORS: Record<string, string> = {
  product: 'bg-primary/10 text-primary',
  subscription: 'bg-accent/10 text-accent',
  service: 'bg-blue-50 text-blue-700',
  experience: 'bg-purple-50 text-purple-700',
};

interface ListingCardProps {
  listing: EcoListing;
  showActions?: boolean;
  onEdit?: (listing: EcoListing) => void;
  onDelete?: (listing: EcoListing) => void;
  isDeleting?: boolean;
}

/** min_order / max_order arrive as tag strings: a whole number, else null. */
function wholeOrNull(v: unknown): number | null {
  const s = String(v ?? '').trim();
  return /^\d{1,6}$/.test(s) ? parseInt(s, 10) : null;
}

/** The online-shop facts a tile needs, from the listing the server sent. */
function shopView(l: EcoListing) {
  const stock = String(l.stock ?? '').trim();
  const availableQty = typeof l.availableQty === 'number' ? l.availableQty : null;
  const soldOut = availableQty === 0 || stock === '0' || l.notBuyableReason === 'sold_out';
  return {
    image: l.images[0] || l.thumbs[0] || '',
    currency: l.priceCurrency || l.unitCurrency || '',
    soldOut,
    availableQty,
    unitId: String(l.unitRef || '').split(':')[2] || '',
    unitName: l.unitName || '',
    minOrder: wholeOrNull(l.minOrder),
    maxOrder: wholeOrNull(l.maxOrder),
  };
}

/**
 * The quick "+" on a tile: adds the product's smallest order (1 kos, 1 kg —
 * or its min_order) to the cart and says so in a short toast. A sibling of
 * the tile's link, never inside it (a button may not sit in an <a>).
 */
function QuickAdd({ listing, v }: { listing: EcoListing; v: ReturnType<typeof shopView> }) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const cart = useCart();
  const display: CartDisplay = {
    title: listing.title,
    image: v.image,
    price: String(listing.price ?? ''),
    currency: v.currency,
    unit: listing.unit || '',
    unitName: v.unitName,
    minOrder: v.minOrder,
    maxOrder: v.maxOrder,
    availableQty: v.availableQty,
  };
  const { min, max } = qtyBounds(display);
  const have = cart.inCart({ pubkey: listing.pubkey, listingId: listing.listingId });
  const full = have >= max;
  const step = have > 0 ? 1 : min;
  const unitWord = (n: number) => formatQty(n, listing.unit, locale);
  // "No more in stock" only when stock is what stops it; a per-order cap says so.
  const fullText = t(limitKind(display) === 'order' ? 'cart.maxPerOrder' : 'cart.maxReached', { n: unitWord(max) });

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // A full "+" stays tappable (aria-disabled, not disabled): on a phone there
    // is no tooltip, so the tap itself explains why nothing was added.
    if (full) { toast.error(fullText); return; }
    const r = cart.add({ pubkey: listing.pubkey, listingId: listing.listingId, unitId: v.unitId, qty: step, display });
    if (r.refused === 'max_reached') { toast.error(fullText); return; }
    if (r.refused === 'too_many_lines') { toast.error(t('cart.tooManyInCart', { n: 30 })); return; }
    if (r.refused) return;
    toast.success(t('cart.added', { qty: unitWord(r.added) }), {
      description: listing.title,
      action: { label: t('cart.open'), onClick: () => navigate('/kosarica') },
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={full || undefined}
      aria-label={full ? `${t('cart.addAria', { title: listing.title })} – ${fullText}` : t('cart.addAria', { title: listing.title })}
      title={full ? fullText : t('cart.add')}
      data-testid="quick-add"
      className="pointer-events-auto absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-primary"
    >
      <Plus className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/**
 * Buy only what the server said is buyable (an older server sends nothing),
 * and only while at least the minimum order is in stock.
 */
function canQuickAdd(listing: EcoListing, v: ReturnType<typeof shopView>): boolean {
  const minQty = Math.max(1, v.minOrder ?? 1);
  return listing.buyable === true && !v.soldOut && (v.availableQty === null || v.availableQty >= minQty) && !!v.unitId;
}

/**
 * The quick "+" for any listing tile: an absolutely placed box (`frame` =
 * its position and size, e.g. the tile's photo) with the "+" on its
 * bottom-right corner. Renders nothing unless the listing can be bought.
 * The tile's wrapper must be `relative`, and the "+" a sibling of its link.
 */
export function QuickAddOverlay({ listing, frame }: { listing: EcoListing; frame: string }) {
  const v = shopView(listing);
  if (!canQuickAdd(listing, v)) return null;
  return (
    <div className={`pointer-events-none absolute ${frame}`}>
      <QuickAdd listing={listing} v={v} />
    </div>
  );
}

export function ListingCard({ listing, showActions, onEdit, onDelete, isDeleting }: ListingCardProps) {
  const { t, locale } = useLanguage();
  const v = shopView(listing);

  const TYPE_LABELS: Record<string, string> = {
    produce: t('type.produce'),
    product: t('type.product'),
    subscription: t('type.subscription'),
    service: t('type.service'),
    experience: t('type.experience'),
  };

  const tTag = (prefix: string, val: string) => {
    const key = `${prefix}.${val}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : val.replace(/_/g, ' ');
  };

  const mainImage = listing.images[0] || listing.thumbs[0];

  const isTopDeal = ((listing as any).cashbackPercent || 5) >= 15;

  const card = (
    <div className={`rounded-xl overflow-hidden hover:shadow-md transition group ${isTopDeal ? 'bg-green-50 border-2 border-green-300 ring-2 ring-green-100' : 'bg-card border'}`}>
      {/* Image */}
      {mainImage ? (
        <div className="aspect-[4/3] overflow-hidden bg-muted relative">
          {v.soldOut && (
            <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-foreground/80 text-background text-[11px] font-sans font-semibold">
              {t('shop.soldOut')}
            </span>
          )}
          <img
            src={mainImage}
            alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-muted flex items-center justify-center relative">
          {v.soldOut && (
            <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-foreground/80 text-background text-[11px] font-sans font-semibold">
              {t('shop.soldOut')}
            </span>
          )}
          <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
        </div>
      )}

      <div className="p-4">
        {/* Type badge + price (row 1) */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-sans font-medium whitespace-nowrap ${TYPE_COLORS[listing.type] || 'bg-muted text-muted-foreground'}`}>
            {tTag('type', listing.type)}
          </span>
          {listing.price && (
            <span className="text-sm font-semibold text-foreground font-sans whitespace-nowrap text-right">
              {formatPrice(listing.price, v.currency, locale)}
              {listing.unit && <span className="text-xs text-muted-foreground font-normal">/{tTag('lunit', listing.unit)}</span>}
            </span>
          )}
        </div>
        {/* Cashback badge (row 2) */}
        <div className="mb-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-sans font-bold bg-green-600 text-white shadow-sm whitespace-nowrap">
            🌿 {(listing as any).cashbackPercent || 5}% {t('badge.abundance')}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-display text-base font-semibold text-foreground truncate mb-1">
          {listing.title}
        </h3>

        {/* Description snippet */}
        {listing.content && (
          <p className="text-xs text-muted-foreground font-sans line-clamp-2 mb-2">
            {listing.content}
          </p>
        )}

        {/* Eco badges */}
        {listing.eco.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {listing.eco.slice(0, 3).map(e => (
              <span key={e} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-sans font-medium">
                <Leaf className="w-2.5 h-2.5" />
                {tTag('eco', e)}
              </span>
            ))}
            {listing.eco.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{listing.eco.length - 3}</span>
            )}
          </div>
        )}

        {/* Category tags */}
        {listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {listing.tags.slice(0, 3).map(tg => (
              <span key={tg} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-sans">
                <Tag className="w-2.5 h-2.5" />
                {tTag('cat', tg)}
              </span>
            ))}
          </div>
        )}

        {/* Season / availability */}
        {(listing.harvestSeason || listing.availableFrom) && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-sans mb-2">
            <Calendar className="w-3 h-3" />
            {listing.harvestSeason && <span>{tTag('season', listing.harvestSeason)}</span>}
            {listing.availableFrom && listing.availableUntil && (
              <span>{listing.availableFrom} — {listing.availableUntil}</span>
            )}
          </div>
        )}

        {/* Stock — what is left after paid orders when the server knows it;
            sold out is the badge on the image */}
        {listing.stock && !v.soldOut && (
          <div className="text-[10px] text-muted-foreground font-sans">
            {t('common.inStock')}{' '}
            {/^\d+$/.test(String(listing.stock).trim())
              ? formatQty(v.availableQty ?? parseInt(String(listing.stock).trim(), 10), listing.unit, locale)
              : `${listing.stock} ${listing.unit ? tTag('lunit', listing.unit) : ''}`}
          </div>
        )}

        {/* Actions (dashboard mode) */}
        {showActions && (
          <div className="flex gap-2 mt-3 pt-3 border-t">
            <button
              onClick={(e) => { e.preventDefault(); onEdit?.(listing); }}
              className="flex-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-sans font-medium hover:bg-primary/90 transition"
            >
              {t('common.edit')}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); onDelete?.(listing); }}
              disabled={isDeleting}
              className="px-3 py-1.5 bg-destructive/10 text-destructive rounded-lg text-xs font-sans font-medium hover:bg-destructive/20 transition disabled:opacity-50"
            >
              {isDeleting ? '...' : t('common.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (showActions) return card;

  return (
    <div className="relative">
      <Link to={`/ponudba/${listing.pubkey}/${listing.listingId}`} className="block">
        {card}
      </Link>
      {/* Same 4:3 box as the photo, so the "+" sits on its bottom-right corner. */}
      <QuickAddOverlay listing={listing} frame="inset-x-0 top-0 aspect-[4/3]" />
    </div>
  );
}
