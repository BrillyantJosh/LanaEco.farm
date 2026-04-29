import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, Globe, Tag, Leaf, ChevronLeft, ChevronRight, X, ExternalLink, ShoppingBag, Loader2, Mail, Phone } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

interface EcoUnit {
  eventId: string;
  pubkey: string;
  createdAt: number;
  unitId: string;
  name: string;
  ownerHex: string;
  country: string;
  currency: string;
  category: string;
  categoryDetail: string;
  images: string[];
  status: string;
  longitude: string;
  latitude: string;
  logo: string;
  video: string;
  url: string;
  email: string;
  phone: string;
  note: string;
  openingHoursJson: string;
  receiverName: string;
  receiverCity: string;
  receiverCountry: string;
  content: string;
}

interface EcoListing {
  listingId: string;
  pubkey: string;
  title: string;
  type: string;
  price: string;
  priceCurrency: string;
  unit: string;
  content: string;
  images: string[];
  eco: string[];
  tags: string[];
  status: string;
}



interface OpeningHours {
  [day: string]: { enabled: boolean; open: string; close: string };
}

export default function UnitDetailPage() {
  const { t } = useLanguage();
  const tTag = (prefix: string, val: string) => {
    const key = `${prefix}.${val}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : val.replace(/_/g, ' ');
  };
  const { unitId } = useParams<{ unitId: string }>();
  const [unit, setUnit] = useState<EcoUnit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [listings, setListings] = useState<EcoListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);

  const dayLabels: Record<string, string> = {
    mon: t('unit.monday'),
    tue: t('unit.tuesday'),
    wed: t('unit.wednesday'),
    thu: t('unit.thursday'),
    fri: t('unit.friday'),
    sat: t('unit.saturday'),
    sun: t('unit.sunday'),
  };

  useEffect(() => {
    const fetchUnit = async () => {
      try {
        const res = await fetch('/api/eco-units');
        const units: EcoUnit[] = await res.json();
        const found = units.find(u => u.unitId === unitId);
        setUnit(found || null);
      } catch (e) {
        console.error('Failed to fetch unit:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUnit();

    // Fetch listings for this unit
    fetch('/api/listings?unit=' + unitId)
      .then(r => r.json())
      .then((data: EcoListing[]) => setListings(data.filter(l => l.status === 'active')))
      .catch(() => {})
      .finally(() => setListingsLoading(false));
  }, [unitId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground font-sans">{t('common.loading')}</div>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <p className="text-lg text-muted-foreground font-sans mb-4">{t('unit.notFound')}</p>
        <Link to="/" className="text-primary font-sans hover:underline">{t('common.backToHome')}</Link>
      </div>
    );
  }

  const images = unit.images.filter(Boolean);
  const heroImage = images[0] || null;
  const galleryImages = images.slice(1);

  let openingHours: OpeningHours | null = null;
  try {
    if (unit.openingHoursJson) {
      const parsed = JSON.parse(unit.openingHoursJson);
      const week = (parsed.week || parsed) as Record<string, unknown>;
      openingHours = {};
      for (const [key, slots] of Object.entries(week)) {
        if (Array.isArray(slots) && slots.length > 0) {
          openingHours[key] = { enabled: true, open: (slots[0] as any).open || '', close: (slots[0] as any).close || '' };
        } else if (Array.isArray(slots)) {
          openingHours[key] = { enabled: false, open: '', close: '' };
        }
      }
    }
  } catch {}

  const hasLocation = unit.latitude && unit.longitude &&
    parseFloat(unit.latitude) !== 0 && parseFloat(unit.longitude) !== 0;

  return (
    <div className="pb-16">
      {/* Hero image */}
      {heroImage && (
        <div className="relative w-full h-[40vh] md:h-[50vh] overflow-hidden">
          <img
            src={heroImage}
            alt={unit.name}
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => setLightboxIdx(0)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
            <div className="container mx-auto">
              <Link to="/" className="inline-flex items-center gap-1 text-primary-foreground/80 text-sm font-sans mb-3 hover:text-primary-foreground">
                <ArrowLeft className="w-4 h-4" /> {t('common.back')}
              </Link>
              <h1 className="font-display text-3xl md:text-5xl font-bold text-primary-foreground">
                {unit.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {unit.category && (
                  <span className="inline-flex items-center gap-1 bg-primary/80 text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                    <Leaf className="w-3.5 h-3.5" />
                    {unit.category}
                    {unit.categoryDetail ? ` / ${unit.categoryDetail}` : ''}
                  </span>
                )}
                {(unit.receiverCity || unit.country) && (
                  <span className="inline-flex items-center gap-1 bg-primary-foreground/20 text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                    <MapPin className="w-3.5 h-3.5" />
                    {[unit.receiverCity, unit.country].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No hero fallback */}
      {!heroImage && (
        <div className="bg-primary/10 py-16">
          <div className="container mx-auto px-4">
            <Link to="/" className="inline-flex items-center gap-1 text-muted-foreground text-sm font-sans mb-3 hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> {t('common.back')}
            </Link>
            <h1 className="font-display text-3xl md:text-5xl font-bold text-foreground">{unit.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {unit.category && (
                <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-sans">
                  <Leaf className="w-3.5 h-3.5" />
                  {unit.category}
                </span>
              )}
              {(unit.receiverCity || unit.country) && (
                <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm font-sans">
                  <MapPin className="w-3.5 h-3.5" />
                  {[unit.receiverCity, unit.country].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 mt-8">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Main content — left 2 cols */}
          <div className="md:col-span-2 space-y-8">
            {/* Description */}
            {unit.content && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-3">{t('unit.aboutUs')}</h2>
                <p className="text-muted-foreground font-sans leading-relaxed whitespace-pre-line">
                  {unit.content}
                </p>
              </section>
            )}

            {unit.note && (
              <section className="bg-primary/5 border border-primary/20 rounded-xl p-5">
                <p className="text-sm font-sans text-foreground italic">"{unit.note}"</p>
              </section>
            )}

            {/* Gallery */}
            {galleryImages.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-4">{t('unit.gallery')}</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {galleryImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition"
                      onClick={() => setLightboxIdx(idx + 1)}
                    >
                      <img src={img} alt={`${unit.name} ${idx + 2}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Listings */}
            {!listingsLoading && listings.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-primary" />
                  Listings ({listings.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {listings.map(listing => (
                    <Link
                      key={`${listing.pubkey}-${listing.listingId}`}
                      to={`/ponudba/${listing.pubkey}/${listing.listingId}`}
                      className="group bg-card border rounded-xl overflow-hidden hover:shadow-md transition"
                    >
                      {listing.images[0] && (
                        <div className="aspect-[16/9] overflow-hidden bg-muted">
                          <img src={listing.images[0]} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-sans font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                              {tTag('type', listing.type)}
                            </span>
                            <span className="text-xs font-sans font-bold text-white bg-green-600 px-2.5 py-1 rounded-full shadow-sm">
                              🌿 {(listing as any).cashbackPercent || 5}%
                            </span>
                          </div>
                          <span className="text-sm font-semibold font-sans">
                            {listing.price} {listing.priceCurrency}
                            {listing.unit && <span className="text-xs font-normal text-muted-foreground">/{listing.unit}</span>}
                          </span>
                        </div>
                        <h3 className="font-display text-sm font-semibold truncate">{listing.title}</h3>
                        {listing.eco.length > 0 && (
                          <div className="flex gap-1 mt-1.5">
                            {listing.eco.slice(0, 2).map(e => (
                              <span key={e} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[9px] font-sans">
                                <Leaf className="w-2 h-2" />{tTag('eco', e)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {listingsLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-sans py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('dash.loadingListings')}
              </div>
            )}
          </div>

          {/* Sidebar — right col */}
          <div className="space-y-6">
            {/* Info card */}
            <div className="bg-card border rounded-xl p-5 space-y-4">
              <h3 className="font-display text-lg font-semibold">{t('unit.details')}</h3>

              {unit.category && (
                <div className="flex items-start gap-3">
                  <Tag className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">{t('unit.category')}</p>
                    <p className="text-sm font-sans font-medium">{unit.category}{unit.categoryDetail ? ` / ${unit.categoryDetail}` : ''}</p>
                  </div>
                </div>
              )}

              {(unit.receiverCity || unit.country) && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">{t('unit.location')}</p>
                    <p className="text-sm font-sans font-medium">{[unit.receiverCity, unit.receiverCountry || unit.country].filter(Boolean).join(', ')}</p>
                  </div>
                </div>
              )}

              {unit.currency && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground font-sans">{t('unit.currency')}</p>
                    <p className="text-sm font-sans font-medium">{unit.currency}</p>
                  </div>
                </div>
              )}

              {(unit.email || unit.phone) && (
                <div className="flex flex-col gap-2 pt-1">
                  {unit.email && (
                    <a
                      href={`mailto:${unit.email}`}
                      className="inline-flex items-center gap-1.5 text-sm text-primary font-sans hover:underline break-all"
                    >
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      {unit.email}
                    </a>
                  )}
                  {unit.phone && (
                    <a
                      href={`tel:${unit.phone.replace(/\s+/g, '')}`}
                      className="inline-flex items-center gap-1.5 text-sm text-primary font-sans hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      {unit.phone}
                    </a>
                  )}
                </div>
              )}

              {unit.url && (
                <a
                  href={unit.url.startsWith('http') ? unit.url : `https://${unit.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary font-sans hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t('unit.visitWebsite')}
                </a>
              )}
            </div>

            {/* Opening hours */}
            {openingHours && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  {t('unit.openingHours')}
                </h3>
                <div className="space-y-2">
                  {Object.entries(dayLabels).map(([key, label]) => {
                    const day = openingHours?.[key];
                    return (
                      <div key={key} className="flex justify-between text-sm font-sans">
                        <span className={day?.enabled ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                        <span className={day?.enabled ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                          {day?.enabled ? `${day.open} – ${day.close}` : t('unit.closed')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Logo */}
            {unit.logo && (
              <div className="bg-card border rounded-xl p-5 flex justify-center">
                <img src={unit.logo} alt={`${unit.name} logo`} className="max-h-24 object-contain" />
              </div>
            )}

            {/* Video */}
            {unit.video && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-sm font-semibold mb-3">Video</h3>
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <iframe
                    src={(() => { const m = unit.video.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/); return m ? `https://www.youtube.com/embed/${m[1]}` : unit.video; })()}
                    className="w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    title={`${unit.name} video`}
                  />
                </div>
              </div>
            )}

            {/* Map */}
            {hasLocation && (
              <div className="bg-card border rounded-xl p-5">
                <h3 className="font-display text-sm font-semibold mb-3">{t('unit.location')}</h3>
                <div className="aspect-square rounded-lg overflow-hidden border">
                  <iframe
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(unit.longitude!) - 0.01},${parseFloat(unit.latitude!) - 0.005},${parseFloat(unit.longitude!) + 0.01},${parseFloat(unit.latitude!) + 0.005}&layer=mapnik&marker=${unit.latitude},${unit.longitude}`}
                    className="w-full h-full"
                    title={t('unit.location')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && images.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={() => setLightboxIdx(null)}
          >
            <X className="w-6 h-6" />
          </button>

          {images.length > 1 && (
            <>
              <button
                className="absolute left-4 text-white/80 hover:text-white p-2"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + images.length) % images.length); }}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                className="absolute right-4 text-white/80 hover:text-white p-2"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % images.length); }}
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}

          <img
            src={images[lightboxIdx]}
            alt={`${unit.name} ${lightboxIdx + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 text-white/60 text-sm font-sans">
            {lightboxIdx + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}
