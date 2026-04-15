import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, MapPin, Leaf, Tag, Calendar, ShoppingBag, Truck, CreditCard, Clock, Users, CheckCircle } from 'lucide-react';
import type { EcoListing } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

export default function ListingDetailPage() {
  const { t } = useLanguage();
  const { pubkey, listingId } = useParams<{ pubkey: string; listingId: string }>();
  const [listing, setListing] = useState<EcoListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);

  const TYPE_LABELS: Record<string, string> = {
    product: t('type.product'), subscription: t('type.subscription'), service: t('type.service'), experience: t('type.experience'),
  };

  const tTag = (prefix: string, val: string) => {
    const key = `${prefix}.${val}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : val.replace(/_/g, ' ');
  };

  useEffect(() => {
    fetch('/api/listings')
      .then(r => r.json())
      .then((data: EcoListing[]) => {
        const found = data.find(l => l.pubkey === pubkey && l.listingId === listingId);
        setListing(found || null);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
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
  const unitPubkey = listing.unitRef.split(':')[1];

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
        </div>

        {/* Info */}
        <div className="space-y-5">
          {/* Type badge */}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-sans font-medium bg-primary/10 text-primary">
            {TYPE_LABELS[listing.type] || listing.type}
          </span>

          <h1 className="font-display text-2xl lg:text-3xl font-bold">{listing.title}</h1>

          {/* Price */}
          <div className="text-2xl font-bold text-foreground font-sans">
            {listing.price} {listing.priceCurrency}
            {listing.unit && <span className="text-base font-normal text-muted-foreground"> / {listing.unit}</span>}
          </div>

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
          {listing.stock && (
            <div className="text-sm font-sans text-muted-foreground">
              {t('common.inStock')} <span className="font-medium text-foreground">{listing.stock} {listing.unit}</span>
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
              {t('listingDetail.marketDays')} {listing.marketDays.map(d => d.slice(0, 3)).join(', ')}
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
            <div className="text-sm font-sans text-accent font-medium">Pre-order available</div>
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
            <div className="text-sm font-sans text-muted-foreground">Spray log: {listing.sprayLog}</div>
          )}
          {listing.soilTestYear && (
            <div className="text-sm font-sans text-muted-foreground">Soil test: {listing.soilTestYear}</div>
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
