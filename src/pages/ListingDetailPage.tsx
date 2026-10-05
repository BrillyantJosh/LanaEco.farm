import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, MapPin, Leaf, Tag, Calendar, ShoppingBag, Truck, CreditCard, Clock, Users, CheckCircle, ExternalLink, Minus, Plus, ShoppingCart, Info, Store } from 'lucide-react';
import type { EcoListing } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { limitKind, qtyBounds, type CartDisplay } from '@/lib/cart';
import { formatPrice, formatQty } from '@/lib/format';
import { notBuyableKey } from '@/lib/notBuyable';


  function getYouTubeId(url: string): string | null {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&\n?#]+)/);
    return m ? m[1] : null;
  }

export default function ListingDetailPage() {
  const { t, locale } = useLanguage();
  const { pubkey, listingId } = useParams<{ pubkey: string; listingId: string }>();
  const [listing, setListing] = useState<EcoListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [qty, setQty] = useState(1);
  const navigate = useNavigate();
  const cart = useCart();

  const TYPE_LABELS: Record<string, string> = {
    produce: t('type.produce'), product: t('type.product'), subscription: t('type.subscription'), service: t('type.service'), experience: t('type.experience'),
  };

  const tTag = (prefix: string, val: string) => {
    const key = `${prefix}.${val}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : val.replace(/_/g, ' ');
  };

  // One listing from the server — the same visibility and buyable gates as
  // the list (404 = not shown here), not the whole catalogue.
  useEffect(() => {
    if (!pubkey || !listingId) return;
    const ctrl = new AbortController();
    setIsLoading(true);
    setSelectedImage(0);
    fetch(`/api/listings/${encodeURIComponent(pubkey)}/${encodeURIComponent(listingId)}`, { signal: ctrl.signal })
      .then(async r => (r.ok ? ((await r.json()) as EcoListing) : null))
      .then(found => setListing(found))
      .catch(err => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setListing(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setIsLoading(false);
      });
    return () => ctrl.abort();
  }, [pubkey, listingId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <h2 className="font-display text-xl font-bold mb-2">{t('listingDetail.notFound')}</h2>
        <Link to="/ponudbe" className="text-primary hover:underline font-sans text-sm">{t('listingDetail.back')}</Link>
      </div>
    );
  }

  const allImages = [...listing.images, ...listing.thumbs].filter(Boolean);
  const unitId = listing.unitRef.split(':')[2];

  // Lana Online Shop — "Dodaj v košarico" shows ONLY when the server said
  // buyable === true; otherwise the page says why (notBuyableKey).
  const intOr = (v: string | undefined, d: number) => (/^\d+$/.test(String(v || '').trim()) ? parseInt(String(v).trim(), 10) : d);
  const currency = listing.priceCurrency || listing.unitCurrency || '';
  const cartDisplay: CartDisplay = {
    title: listing.title,
    image: listing.images[0] || listing.thumbs[0] || '',
    price: listing.price || '',
    currency,
    unit: listing.unit || '',
    unitName: listing.unitName || '',
    minOrder: /^\d+$/.test(String(listing.minOrder || '').trim()) ? intOr(listing.minOrder, 1) : null,
    maxOrder: /^\d+$/.test(String(listing.maxOrder || '').trim()) ? intOr(listing.maxOrder, 0) : null,
    availableQty: typeof listing.availableQty === 'number' ? listing.availableQty : null,
  };
  const bounds = qtyBounds(cartDisplay);
  const minQty = bounds.min;
  let maxQty = intOr(listing.maxOrder, 99);
  if (typeof listing.availableQty === 'number') maxQty = Math.min(maxQty, listing.availableQty);
  const buyable = listing.buyable === true && maxQty >= minQty && !!unitId;
  // What is already in the cart counts against the limit; a product already
  // in the cart can grow by 1 (its minimum is met).
  const inCart = cart.inCart({ pubkey: listing.pubkey, listingId: listing.listingId });
  const stepMin = inCart > 0 ? 1 : minQty;
  const stepMax = Math.max(0, Math.min(maxQty, bounds.max) - inCart);
  const canAdd = buyable && stepMax >= stepMin;
  const clampedQty = Math.min(Math.max(qty, stepMin), Math.max(stepMin, stepMax));
  // "No more in stock" only when stock is what stops it; a per-order cap says so.
  const limitText = t(limitKind(cartDisplay) === 'order' ? 'cart.maxPerOrder' : 'cart.maxReached', {
    n: formatQty(Math.min(maxQty, bounds.max), listing.unit, locale),
  });
  const addToCart = () => {
    if (!canAdd) return;
    const r = cart.add({ pubkey: listing.pubkey, listingId: listing.listingId, unitId, qty: clampedQty, display: cartDisplay });
    if (r.refused === 'max_reached') { toast.error(limitText); return; }
    if (r.refused === 'too_many_lines') { toast.error(t('cart.tooManyInCart', { n: 30 })); return; }
    if (r.refused) return;
    setQty(1);
    toast.success(t('cart.added', { qty: formatQty(r.added, listing.unit, locale) }), {
      description: listing.title,
      action: { label: t('cart.open'), onClick: () => navigate('/kosarica') },
    });
  };
  // "Kupi zdaj" = THIS product, this quantity, its own order — straight to the
  // checkout, the cart untouched.
  const buyNow = () => {
    if (!canAdd) return;
    navigate(`/narocilo/novo/${listing.pubkey}/${encodeURIComponent(listing.listingId)}?qty=${clampedQty}`);
  };
  // Stock line: the count after paid orders when the server knows it, else
  // the published tag; nothing when sold out — the reason already says so.
  const stockTag = String(listing.stock ?? '').trim();
  const soldOut = listing.availableQty === 0 || stockTag === '0' || listing.notBuyableReason === 'sold_out';
  const stockText = soldOut || !stockTag ? ''
    : typeof listing.availableQty === 'number' ? formatQty(listing.availableQty, listing.unit, locale)
    : /^\d+$/.test(stockTag) ? formatQty(parseInt(stockTag, 10), listing.unit, locale)
    : `${stockTag} ${listing.unit ? tTag('lunit', listing.unit) : ''}`.trim();
  // Not buyable: always say why. Buyable for the server but less in stock
  // than the smallest order gets the general text (still a reason).
  const notBuyableText = buyable ? null : t(notBuyableKey(listing.buyable === true ? null : listing.notBuyableReason));
  const shippingFee = String(listing.shippingFee || '0.00');

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <Link to="/ponudbe" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 font-sans">
        <ArrowLeft className="w-4 h-4" /> {t('listingDetail.back')}
      </Link>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Image gallery */}
        <div>
          {allImages.length > 0 ? (
            <div>
              <div className="relative aspect-square rounded-xl overflow-hidden bg-muted mb-3">
                <img src={allImages[selectedImage]} alt={listing.title} className="w-full h-full object-cover" />
                {allImages.length > 1 && (
                  <>
                    <button
                      onClick={() => setSelectedImage((selectedImage - 1 + allImages.length) % allImages.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/65 text-white rounded-full p-1.5 transition"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setSelectedImage((selectedImage + 1) % allImages.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/65 text-white rounded-full p-1.5 transition"
                      aria-label="Next image"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
              {allImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {allImages.map((img, i) => (
                    <button key={i} onClick={() => setSelectedImage(i)}
                      className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${i === selectedImage ? 'border-primary' : 'border-transparent'}`}>
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="aspect-square rounded-xl bg-muted flex items-center justify-center">
              <ShoppingBag className="w-16 h-16 text-muted-foreground/30" />
            </div>
          )}
          {/* YouTube video */}
          {listing.youtubeUrl && getYouTubeId(listing.youtubeUrl) && (
            <div className="mt-4 aspect-video rounded-xl overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${getYouTubeId(listing.youtubeUrl)}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={listing.title}
              />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-5">
          {/* Type badge */}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-sans font-medium bg-primary/10 text-primary">
            {tTag('type', listing.type)}
          </span>

          <h1 className="font-display text-2xl lg:text-3xl font-bold">{listing.title}</h1>

          {/* Price */}
          <div className="text-2xl font-bold text-foreground font-sans">
            {formatPrice(listing.price, currency, locale)}
            {listing.unit && <span className="text-base font-normal text-muted-foreground"> / {tTag('lunit', listing.unit)}</span>}
          </div>

          {/* Buy (Lana Online Shop) — several products, one order per producer */}
          {buyable ? (
            <div className="space-y-2" data-testid="buy-block">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center rounded-lg border" role="group" aria-label={t('shop.qty')}>
                  <button type="button" onClick={() => setQty(Math.max(stepMin, clampedQty - 1))} disabled={!canAdd || clampedQty <= stepMin}
                    className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={t('cart.fewerAria', { title: listing.title })}>
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="min-w-[2.5rem] text-center text-sm font-sans font-medium" data-testid="detail-qty">{canAdd ? clampedQty : 0}</span>
                  <button type="button" onClick={() => setQty(Math.min(stepMax, clampedQty + 1))} disabled={!canAdd || clampedQty >= stepMax}
                    className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={t('cart.moreAria', { title: listing.title })}>
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <Button type="button" onClick={addToCart} disabled={!canAdd} title={canAdd ? undefined : limitText} data-testid="add-to-cart">
                  <ShoppingCart className="w-4 h-4" /> {t('cart.add')}
                </Button>
                {canAdd && (
                  <Button type="button" variant="outline" onClick={buyNow} data-testid="buy-now">
                    {t('cart.buyNow')}
                  </Button>
                )}
              </div>
              {inCart > 0 && (
                <p className="text-sm font-sans text-muted-foreground" data-testid="in-cart">
                  {t('cart.inCart', { n: formatQty(inCart, listing.unit, locale) })}
                  {' · '}
                  <Link to="/kosarica" className="text-primary hover:underline">{t('cart.open')}</Link>
                  {!canAdd && <span> · {limitText}</span>}
                </p>
              )}
              {/* What the producer charges for delivery, and whether pickup is offered */}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-sans text-muted-foreground" data-testid="shipping-terms">
                <span className="inline-flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" />
                  {shippingFee === '0.00' ? t('shop.shippingFree') : t('shop.shippingFee', { fee: formatPrice(shippingFee, currency, locale) })}
                </span>
                {listing.pickup && (
                  <span className="inline-flex items-center gap-1"><Store className="w-3.5 h-3.5" /> {t('shop.pickupAvailable')}</span>
                )}
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm font-sans text-muted-foreground" role="status" data-testid="not-buyable">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{notBuyableText}</span>
            </p>
          )}

          {/* Description */}
          {listing.content && (
            <p className="text-sm text-muted-foreground font-sans leading-relaxed whitespace-pre-wrap">{listing.content}</p>
          )}

          {/* Eco labels */}
          {listing.eco.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('listingDetail.ecoLabels')}</h3>
              <div className="flex flex-wrap gap-2">
                {listing.eco.map(e => (
                  <span key={e} className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs font-sans font-medium">
                    <Leaf className="w-3 h-3" /> {tTag('eco', e)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Certificates */}
          {listing.cert.length > 0 && (
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-sans">{listing.cert.join(', ')}</span>
            </div>
          )}

          {/* Category tags */}
          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map(tg => (
                <span key={tg} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs font-sans">
                  <Tag className="w-3 h-3" /> {tTag('cat', tg)}
                </span>
              ))}
            </div>
          )}

          {/* Stock */}
          {stockText && (
            <div className="text-sm font-sans text-muted-foreground">
              {t('common.inStock')} <span className="font-medium text-foreground">{stockText}</span>
              {listing.minOrder && <span> (min: {listing.minOrder})</span>}
              {listing.maxOrder && <span> (max: {listing.maxOrder})</span>}
            </div>
          )}

          {/* Season */}
          {(listing.harvestSeason || listing.availableFrom) && (
            <div className="flex items-center gap-2 text-sm font-sans text-muted-foreground">
              <Calendar className="w-4 h-4" />
              {listing.harvestSeason && <span className="capitalize">{tTag('season', listing.harvestSeason)}</span>}
              {listing.availableFrom && listing.availableUntil && (
                <span>{listing.availableFrom} — {listing.availableUntil}</span>
              )}
            </div>
          )}

          {/* Delivery */}
          {listing.delivery.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('listingDetail.delivery')}</h3>
              <div className="flex flex-wrap gap-2">
                {listing.delivery.map(d => (
                  <span key={d} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-sans">
                    <Truck className="w-3 h-3" /> {tTag('delivery', d)}
                  </span>
                ))}
              </div>
              {listing.deliveryRadiusKm && (
                <p className="text-xs text-muted-foreground font-sans mt-1">{t('listingDetail.radius', { km: listing.deliveryRadiusKm })}</p>
              )}
            </div>
          )}

          {/* Market days */}
          {listing.marketDays.length > 0 && (
            <div className="text-sm font-sans text-muted-foreground">
              <Clock className="w-4 h-4 inline mr-1" />
              {t('listingDetail.marketDays')} {listing.marketDays.map(d => { const key = `day.${d}` as any; const tr = t(key); return tr !== key ? tr : d.slice(0, 3); }).join(', ')}
            </div>
          )}

          {/* Subscription info */}
          {listing.type === 'subscription' && listing.subscriptionInterval && (
            <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
              <h3 className="font-display font-semibold text-sm mb-1">{t('listingDetail.subscription')}</h3>
              <p className="text-sm font-sans">{t('listingDetail.interval')}: {listing.subscriptionInterval}</p>
              {listing.subscriptionContent && (
                <p className="text-sm font-sans text-muted-foreground mt-1">{listing.subscriptionContent}</p>
              )}
            </div>
          )}

          {/* Experience / Activity / Event details — show whenever these fields exist */}
          {(listing.capacity || listing.durationMin || listing.bookingRequired === 'true') && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 space-y-1">
              {listing.capacity && (
                <p className="text-sm font-sans"><Users className="w-3.5 h-3.5 inline mr-1" />{t('listingDetail.capacity', { n: listing.capacity })}</p>
              )}
              {listing.durationMin && (
                <p className="text-sm font-sans"><Clock className="w-3.5 h-3.5 inline mr-1" />{t('listingDetail.duration', { min: listing.durationMin })}</p>
              )}
              {listing.bookingRequired === 'true' && (
                <p className="text-sm font-sans text-purple-700">{t('listingDetail.bookingRequired')}</p>
              )}
            </div>
          )}

          {/* Pre-order */}
          {listing.preOrder === 'true' && (
            <div className="text-sm font-sans text-accent font-medium">{t('listingDetail.preOrder' as any)}</div>
          )}

          {/* Location override */}
          {listing.geoLat && listing.geoLon && (
            <div className="text-sm font-sans text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 inline mr-1" />
              {listing.geoLabel || `${listing.geoLat}, ${listing.geoLon}`}
            </div>
          )}

          {/* Transparency */}
          {listing.sprayLog && (
            <div className="text-sm font-sans text-muted-foreground">{t('listingDetail.sprayLog' as any)} {listing.sprayLog}</div>
          )}
          {listing.soilTestYear && (
            <div className="text-sm font-sans text-muted-foreground">{t('listingDetail.soilTest' as any)} {listing.soilTestYear}</div>
          )}

          {/* Payment */}
          {listing.payment.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('listingDetail.payment')}</h3>
              <div className="flex flex-wrap gap-2">
                {listing.payment.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted rounded-full text-xs font-sans">
                    <CreditCard className="w-3 h-3" /> {tTag('pay', p)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Website URL */}
              {listing.url && (
                <div className="pt-2">
                  <a
                    href={listing.url.startsWith('http') ? listing.url : `https://${listing.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary font-sans hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {listing.url}
                  </a>
                </div>
              )}

          {/* Link to farm */}
          <div className="pt-4 border-t">
            <Link to={`/enota/${unitId}`}
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-sans font-medium">
              <MapPin className="w-4 h-4" /> {t('listingDetail.viewFarm')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
