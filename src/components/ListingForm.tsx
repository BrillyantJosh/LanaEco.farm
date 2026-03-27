import { useState } from 'react';
import { Save, ArrowLeft, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { signNostrEvent } from '@/lib/nostrSigning';
import { publishToRelays, type EcoListing, type BusinessUnit } from '@/lib/nostr';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { useLanguage } from '@/i18n/LanguageContext';

const SALE_UNITS = ['kg', 'piece', 'L', 'g', 'set', 'month', 'visit', 'person'];

const SEASONS = ['spring', 'summer', 'autumn', 'winter', 'year_round'];

const ECO_OPTIONS = [
  'organic', 'biodynamic', 'local', 'regenerative', 'permaculture',
  'no_pesticides', 'grass_fed', 'free_range', 'raw_milk', 'heritage_breed'
];

const CATEGORY_TAGS = [
  'vegetables', 'fruits', 'dairy', 'meat', 'eggs', 'honey',
  'herbs', 'grains', 'preserved', 'drinks', 'mushrooms',
  'flowers', 'seeds', 'other'
];

const MARKET_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

interface ListingFormProps {
  unit: BusinessUnit;
  listing?: EcoListing;
  onBack: () => void;
  onSaved: () => void;
}

function generateListingId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

interface FormState {
  title: string;
  type: string;
  content: string;
  price: string;
  priceCurrency: string;
  saleUnit: string;
  status: string;
  stock: string;
  minOrder: string;
  maxOrder: string;
  preOrder: boolean;
  harvestDate: string;
  harvestSeason: string;
  availableFrom: string;
  availableUntil: string;
  eco: string[];
  cert: string;
  certUrl: string;
  categoryTags: string[];
  delivery: string[];
  deliveryRadiusKm: string;
  marketDays: string[];
  subscriptionInterval: string;
  subscriptionContent: string;
  capacity: string;
  durationMin: string;
  bookingRequired: boolean;
  images: string[];
}

export function ListingForm({ unit, listing, onBack, onSaved }: ListingFormProps) {
  const { session } = useAuth();
  const { params } = useSystemParams();
  const { t } = useLanguage();
  const isEdit = !!listing;

  const LISTING_TYPES = [
    { value: 'product', label: t('type.product') },
    { value: 'subscription', label: t('type.subscription') },
    { value: 'service', label: t('type.service') },
    { value: 'experience', label: t('type.experience') },
  ];

  const STATUS_OPTIONS = [
    { value: 'active', label: t('status.active') },
    { value: 'sold_out', label: t('status.sold_out') },
    { value: 'seasonal', label: t('status.seasonal') },
    { value: 'archived', label: t('status.archived') },
  ];

  const DELIVERY_OPTIONS = [
    { value: 'pickup', label: t('delivery.pickup') },
    { value: 'local_delivery', label: t('delivery.local_delivery') },
    { value: 'farmers_market', label: t('delivery.farmers_market') },
    { value: 'shipping', label: t('delivery.shipping') },
    { value: 'box_scheme', label: t('delivery.box_scheme') },
  ];

  const [form, setForm] = useState<FormState>({
    title: listing?.title || '',
    type: listing?.type || 'product',
    content: listing?.content || '',
    price: listing?.price || '',
    priceCurrency: listing?.priceCurrency || unit.currency || 'EUR',
    saleUnit: listing?.unit || 'kg',
    status: listing?.status || 'active',
    stock: listing?.stock || '',
    minOrder: listing?.minOrder || '',
    maxOrder: listing?.maxOrder || '',
    preOrder: listing?.preOrder === 'true',
    harvestDate: listing?.harvestDate || '',
    harvestSeason: listing?.harvestSeason || '',
    availableFrom: listing?.availableFrom || '',
    availableUntil: listing?.availableUntil || '',
    eco: listing?.eco || [],
    cert: listing?.cert?.[0] || '',
    certUrl: listing?.certUrl?.[0] || '',
    categoryTags: listing?.tags || [],
    delivery: listing?.delivery || [],
    deliveryRadiusKm: listing?.deliveryRadiusKm || '',
    marketDays: listing?.marketDays || [],
    subscriptionInterval: listing?.subscriptionInterval || 'monthly',
    subscriptionContent: listing?.subscriptionContent || '',
    capacity: listing?.capacity || '',
    durationMin: listing?.durationMin || '',
    bookingRequired: listing?.bookingRequired === 'true',
    images: listing?.images || [],
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayItem = (key: 'eco' | 'categoryTags' | 'delivery' | 'marketDays', item: string) => {
    setForm(prev => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item] };
    });
  };

  // Image upload handler — uploads to our server filesystem
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const newImages: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        setError(`File "${file.name}" exceeds 10MB limit`);
        continue;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        // Build full URL for Nostr event
        const fullUrl = `${window.location.origin}${data.url}`;
        newImages.push(fullUrl);
      } catch (err) {
        setError(`Failed to upload "${file.name}"`);
      }
    }

    if (newImages.length > 0) {
      updateField('images', [...form.images, ...newImages]);
    }

    setIsUploading(false);
    // Reset file input
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    updateField('images', form.images.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!session || !params?.relays) return;
    if (!form.title.trim()) { setError(t('form.errorTitle')); return; }
    if (!form.price.trim() || isNaN(parseFloat(form.price))) { setError(t('form.errorPrice')); return; }

    setIsSaving(true);
    setError('');

    try {
      const listingId = listing?.listingId || generateListingId();

      const tags: string[][] = [
        ['d', listingId],
        ['a', `30901:${session.nostrHexId}:${unit.unitId}`],
        ['title', form.title.trim()],
        ['type', form.type],
        ['price', form.price, form.priceCurrency],
        ['unit', form.saleUnit],
        ['status', form.status],
      ];

      if (form.stock) tags.push(['stock', form.stock]);
      if (form.minOrder) tags.push(['min_order', form.minOrder]);
      if (form.maxOrder) tags.push(['max_order', form.maxOrder]);
      if (form.preOrder) tags.push(['pre_order', 'true']);

      if (form.harvestDate) tags.push(['harvest_date', form.harvestDate]);
      if (form.harvestSeason) tags.push(['harvest_season', form.harvestSeason]);
      if (form.availableFrom) tags.push(['available_from', form.availableFrom]);
      if (form.availableUntil) tags.push(['available_until', form.availableUntil]);

      for (const e of form.eco) tags.push(['eco', e]);
      if (form.cert) tags.push(['cert', form.cert]);
      if (form.certUrl) tags.push(['cert_url', form.certUrl]);

      for (const tg of form.categoryTags) tags.push(['t', tg]);

      for (const d of form.delivery) tags.push(['delivery', d]);
      if (form.deliveryRadiusKm) tags.push(['delivery_radius_km', form.deliveryRadiusKm]);
      for (const md of form.marketDays) tags.push(['market_day', md]);

      if (form.type === 'subscription') {
        tags.push(['subscription_interval', form.subscriptionInterval]);
        if (form.subscriptionContent) tags.push(['subscription_content', form.subscriptionContent]);
      }

      if (form.type === 'experience') {
        if (form.capacity) tags.push(['capacity', form.capacity]);
        if (form.durationMin) tags.push(['duration_min', form.durationMin]);
        if (form.bookingRequired) tags.push(['booking_required', 'true']);
      }

      for (const img of form.images) tags.push(['image', img]);

      // Default payment: LanaPays
      tags.push(['payment', 'lana_pay']);

      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        36500,
        form.content.trim(),
        tags
      );

      const result = await publishToRelays(signedEvent, params.relays);

      if (result.success.length > 0) {
        onSaved();
      } else {
        setError(t('form.errorPublish'));
      }
    } catch (err: any) {
      setError(err.message || 'Error saving listing');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-muted rounded-lg transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-lg font-bold font-display">{isEdit ? t('form.editListing') : t('form.newListing')}</h2>
          <p className="text-xs text-muted-foreground font-sans">{unit.name}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm font-sans">{error}</div>
      )}

      <div className="space-y-6">
        {/* === BASIC === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.basic')}</h3>

          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.title')} *</label>
            <input value={form.title} onChange={e => updateField('title', e.target.value)} placeholder={t('form.titlePlaceholder')} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.type')} *</label>
              <select value={form.type} onChange={e => updateField('type', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {LISTING_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.status')}</label>
              <select value={form.status} onChange={e => updateField('status', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.description')}</label>
            <textarea value={form.content} onChange={e => updateField('content', e.target.value)} rows={3} placeholder={t('form.descriptionPlaceholder')} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
          </div>
        </section>

        {/* === PRICING === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.priceUnit')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.price')} *</label>
              <input type="number" step="0.01" value={form.price} onChange={e => updateField('price', e.target.value)} placeholder="2.50" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.currency')}</label>
              <select value={form.priceCurrency} onChange={e => updateField('priceCurrency', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                <option value="EUR">EUR</option>
                <option value="LAN">LAN</option>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.unit')}</label>
              <select value={form.saleUnit} onChange={e => updateField('saleUnit', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {SALE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* === STOCK === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.stockOrders')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.stock')}</label>
              <input type="number" value={form.stock} onChange={e => updateField('stock', e.target.value)} placeholder="200" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.minOrder')}</label>
              <input type="number" value={form.minOrder} onChange={e => updateField('minOrder', e.target.value)} placeholder="1" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.maxOrder')}</label>
              <input type="number" value={form.maxOrder} onChange={e => updateField('maxOrder', e.target.value)} placeholder="50" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-sans">
            <input type="checkbox" checked={form.preOrder} onChange={e => updateField('preOrder', e.target.checked)} className="rounded" />
            {t('form.preOrder')}
          </label>
        </section>

        {/* === SEASON === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.seasonAvailability')}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.season')}</label>
              <select value={form.harvestSeason} onChange={e => updateField('harvestSeason', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                <option value="">—</option>
                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.harvestDate')}</label>
              <input type="date" value={form.harvestDate} onChange={e => updateField('harvestDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.availableFrom')}</label>
              <input type="date" value={form.availableFrom} onChange={e => updateField('availableFrom', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.availableUntil')}</label>
              <input type="date" value={form.availableUntil} onChange={e => updateField('availableUntil', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
        </section>

        {/* === ECO LABELS === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.ecoLabels')}</h3>
          <div className="flex flex-wrap gap-2">
            {ECO_OPTIONS.map(e => (
              <button key={e} type="button" onClick={() => toggleArrayItem('eco', e)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition ${form.eco.includes(e) ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {e.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.certificate')}</label>
              <input value={form.cert} onChange={e => updateField('cert', e.target.value)} placeholder="SI-EKO-001" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.certificateUrl')}</label>
              <input value={form.certUrl} onChange={e => updateField('certUrl', e.target.value)} placeholder="https://..." className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
        </section>

        {/* === CATEGORY TAGS === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.categories')}</h3>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_TAGS.map(tg => (
              <button key={tg} type="button" onClick={() => toggleArrayItem('categoryTags', tg)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition ${form.categoryTags.includes(tg) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {tg}
              </button>
            ))}
          </div>
        </section>

        {/* === DELIVERY === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.delivery')}</h3>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_OPTIONS.map(d => (
              <button key={d.value} type="button" onClick={() => toggleArrayItem('delivery', d.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition ${form.delivery.includes(d.value) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.deliveryRadius')}</label>
              <input type="number" value={form.deliveryRadiusKm} onChange={e => updateField('deliveryRadiusKm', e.target.value)} placeholder="30" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.marketDays')}</label>
            <div className="flex flex-wrap gap-2">
              {MARKET_DAYS.map(d => (
                <button key={d} type="button" onClick={() => toggleArrayItem('marketDays', d)}
                  className={`px-2 py-1 rounded text-xs font-sans transition ${form.marketDays.includes(d) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* === SUBSCRIPTION (conditional) === */}
        {form.type === 'subscription' && (
          <section className="bg-card border rounded-xl p-5 space-y-4">
            <h3 className="font-display font-semibold text-sm">{t('form.subscription')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.interval')}</label>
                <select value={form.subscriptionInterval} onChange={e => updateField('subscriptionInterval', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                  <option value="weekly">{t('form.weekly')}</option>
                  <option value="biweekly">{t('form.biweekly')}</option>
                  <option value="monthly">{t('form.monthly')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.boxContents')}</label>
              <input value={form.subscriptionContent} onChange={e => updateField('subscriptionContent', e.target.value)} placeholder={t('form.boxContentsPlaceholder')} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </section>
        )}

        {/* === EXPERIENCE (conditional) === */}
        {form.type === 'experience' && (
          <section className="bg-card border rounded-xl p-5 space-y-4">
            <h3 className="font-display font-semibold text-sm">{t('form.experience')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.capacity')}</label>
                <input type="number" value={form.capacity} onChange={e => updateField('capacity', e.target.value)} placeholder="12" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">{t('form.duration')}</label>
                <input type="number" value={form.durationMin} onChange={e => updateField('durationMin', e.target.value)} placeholder="180" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-sans">
              <input type="checkbox" checked={form.bookingRequired} onChange={e => updateField('bookingRequired', e.target.checked)} className="rounded" />
              {t('form.bookingRequired')}
            </label>
          </section>
        )}

        {/* === IMAGES (multi-upload to our server) === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">{t('form.images')}</h3>

          {/* Image grid */}
          {form.images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {form.images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                  <img src={img} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload button */}
          <label className={`flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition text-sm font-sans text-muted-foreground ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {isUploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('form.uploading')}</>
            ) : (
              <><Upload className="w-4 h-4" /> {t('form.addImages')}</>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleImageUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
          <p className="text-[10px] text-muted-foreground font-sans">
            {t('form.imagesHint')}
          </p>
        </section>

        {/* === SAVE === */}
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2.5 border rounded-lg text-sm font-sans font-medium hover:bg-muted transition">
            {t('form.cancel')}
          </button>
          <button onClick={handleSave} disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-sans font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? t('form.publishing') : isEdit ? t('form.update') : t('form.publish')}
          </button>
        </div>
      </div>
    </div>
  );
}
