import { useState } from 'react';
import { Save, ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { ImageUpload } from './ImageUpload';
import { signNostrEvent } from '@/lib/nostrSigning';
import { publishToRelays, type EcoListing, type BusinessUnit } from '@/lib/nostr';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';

const LISTING_TYPES = [
  { value: 'product', label: 'Izdelek' },
  { value: 'subscription', label: 'Naročnina' },
  { value: 'service', label: 'Storitev' },
  { value: 'experience', label: 'Doživetje' },
];

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

const DELIVERY_OPTIONS = [
  { value: 'pickup', label: 'Prevzem' },
  { value: 'local_delivery', label: 'Lokalna dostava' },
  { value: 'farmers_market', label: 'Tržnica' },
  { value: 'shipping', label: 'Pošiljanje' },
  { value: 'box_scheme', label: 'Zabojček' },
];

const PAYMENT_OPTIONS = [
  { value: 'lana_pay', label: 'LanaPay' },
  { value: 'cash', label: 'Gotovina' },
  { value: 'bank', label: 'Banka' },
  { value: 'lightning', label: 'Lightning' },
  { value: 'lan_token', label: 'LAN Token' },
];

const MARKET_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktivno' },
  { value: 'sold_out', label: 'Razprodano' },
  { value: 'seasonal', label: 'Sezonsko' },
  { value: 'archived', label: 'Arhivirano' },
];

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
  payment: string[];
  lud16: string;
}

export function ListingForm({ unit, listing, onBack, onSaved }: ListingFormProps) {
  const { session } = useAuth();
  const { params } = useSystemParams();
  const isEdit = !!listing;

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
    payment: listing?.payment || ['lana_pay'],
    lud16: listing?.lud16 || '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayItem = (key: 'eco' | 'categoryTags' | 'delivery' | 'payment' | 'marketDays', item: string) => {
    setForm(prev => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item] };
    });
  };

  const handleSave = async () => {
    if (!session || !params?.relays) return;
    if (!form.title.trim()) { setError('Vnesite naslov ponudbe'); return; }
    if (!form.price.trim() || isNaN(parseFloat(form.price))) { setError('Vnesite veljavno ceno'); return; }

    setIsSaving(true);
    setError('');

    try {
      const listingId = listing?.listingId || generateListingId();

      // Build tags per spec
      const tags: string[][] = [
        ['d', listingId],
        ['a', `30901:${session.nostrHexId}:${unit.unitId}`],
        ['title', form.title.trim()],
        ['type', form.type],
        ['price', form.price, form.priceCurrency],
        ['unit', form.saleUnit],
        ['status', form.status],
      ];

      // Stock & availability
      if (form.stock) tags.push(['stock', form.stock]);
      if (form.minOrder) tags.push(['min_order', form.minOrder]);
      if (form.maxOrder) tags.push(['max_order', form.maxOrder]);
      if (form.preOrder) tags.push(['pre_order', 'true']);

      // Season
      if (form.harvestDate) tags.push(['harvest_date', form.harvestDate]);
      if (form.harvestSeason) tags.push(['harvest_season', form.harvestSeason]);
      if (form.availableFrom) tags.push(['available_from', form.availableFrom]);
      if (form.availableUntil) tags.push(['available_until', form.availableUntil]);

      // Eco labels
      for (const e of form.eco) tags.push(['eco', e]);
      if (form.cert) tags.push(['cert', form.cert]);
      if (form.certUrl) tags.push(['cert_url', form.certUrl]);

      // Category tags
      for (const t of form.categoryTags) tags.push(['t', t]);

      // Delivery
      for (const d of form.delivery) tags.push(['delivery', d]);
      if (form.deliveryRadiusKm) tags.push(['delivery_radius_km', form.deliveryRadiusKm]);
      for (const md of form.marketDays) tags.push(['market_day', md]);

      // Subscription
      if (form.type === 'subscription') {
        tags.push(['subscription_interval', form.subscriptionInterval]);
        if (form.subscriptionContent) tags.push(['subscription_content', form.subscriptionContent]);
      }

      // Experience
      if (form.type === 'experience') {
        if (form.capacity) tags.push(['capacity', form.capacity]);
        if (form.durationMin) tags.push(['duration_min', form.durationMin]);
        if (form.bookingRequired) tags.push(['booking_required', 'true']);
      }

      // Images
      for (const img of form.images) tags.push(['image', img]);

      // Payment
      for (const p of form.payment) tags.push(['payment', p]);
      if (form.lud16) tags.push(['lud16', form.lud16]);

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
        setError('Objava ni uspela na noben relay. Poskusite znova.');
      }
    } catch (err: any) {
      setError(err.message || 'Napaka pri shranjevanju');
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
          <h2 className="text-lg font-bold font-display">{isEdit ? 'Uredi ponudbo' : 'Nova ponudba'}</h2>
          <p className="text-xs text-muted-foreground font-sans">{unit.name}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm font-sans">{error}</div>
      )}

      <div className="space-y-6">
        {/* === BASIC === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Osnovni podatki</h3>

          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Naslov *</label>
            <input value={form.title} onChange={e => updateField('title', e.target.value)} placeholder="npr. Bio jabolka Jonagold" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Vrsta *</label>
              <select value={form.type} onChange={e => updateField('type', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {LISTING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Status</label>
              <select value={form.status} onChange={e => updateField('status', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Opis</label>
            <textarea value={form.content} onChange={e => updateField('content', e.target.value)} rows={3} placeholder="Podroben opis ponudbe..." className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
          </div>
        </section>

        {/* === PRICING === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Cena in enota</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Cena *</label>
              <input type="number" step="0.01" value={form.price} onChange={e => updateField('price', e.target.value)} placeholder="2.50" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Valuta</label>
              <select value={form.priceCurrency} onChange={e => updateField('priceCurrency', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                <option value="EUR">EUR</option>
                <option value="LAN">LAN</option>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Enota</label>
              <select value={form.saleUnit} onChange={e => updateField('saleUnit', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                {SALE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* === STOCK === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Zaloga in naročila</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Zaloga</label>
              <input type="number" value={form.stock} onChange={e => updateField('stock', e.target.value)} placeholder="200" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Min naročilo</label>
              <input type="number" value={form.minOrder} onChange={e => updateField('minOrder', e.target.value)} placeholder="1" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Max naročilo</label>
              <input type="number" value={form.maxOrder} onChange={e => updateField('maxOrder', e.target.value)} placeholder="50" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-sans">
            <input type="checkbox" checked={form.preOrder} onChange={e => updateField('preOrder', e.target.checked)} className="rounded" />
            Prednaročilo možno
          </label>
        </section>

        {/* === SEASON === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Sezona in razpoložljivost</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Sezona</label>
              <select value={form.harvestSeason} onChange={e => updateField('harvestSeason', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                <option value="">—</option>
                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Datum pobiranja</label>
              <input type="date" value={form.harvestDate} onChange={e => updateField('harvestDate', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Na voljo od</label>
              <input type="date" value={form.availableFrom} onChange={e => updateField('availableFrom', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Na voljo do</label>
              <input type="date" value={form.availableUntil} onChange={e => updateField('availableUntil', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
        </section>

        {/* === ECO LABELS === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Eko oznake in certifikati</h3>
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
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Certifikat</label>
              <input value={form.cert} onChange={e => updateField('cert', e.target.value)} placeholder="SI-EKO-001" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Certifikat URL</label>
              <input value={form.certUrl} onChange={e => updateField('certUrl', e.target.value)} placeholder="https://..." className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
        </section>

        {/* === CATEGORY TAGS === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Kategorije</h3>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_TAGS.map(t => (
              <button key={t} type="button" onClick={() => toggleArrayItem('categoryTags', t)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition ${form.categoryTags.includes(t) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* === DELIVERY === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Dostava</h3>
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
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Radij dostave (km)</label>
              <input type="number" value={form.deliveryRadiusKm} onChange={e => updateField('deliveryRadiusKm', e.target.value)} placeholder="30" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Tržni dnevi</label>
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
            <h3 className="font-display font-semibold text-sm">Naročnina</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Interval</label>
                <select value={form.subscriptionInterval} onChange={e => updateField('subscriptionInterval', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-sans">
                  <option value="weekly">Tedensko</option>
                  <option value="biweekly">Dvotedensko</option>
                  <option value="monthly">Mesečno</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Vsebina paketa</label>
              <input value={form.subscriptionContent} onChange={e => updateField('subscriptionContent', e.target.value)} placeholder="Mešana sezonska zelenjava ~8 kg + 6 jajc" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
            </div>
          </section>
        )}

        {/* === EXPERIENCE (conditional) === */}
        {form.type === 'experience' && (
          <section className="bg-card border rounded-xl p-5 space-y-4">
            <h3 className="font-display font-semibold text-sm">Doživetje</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Kapaciteta</label>
                <input type="number" value={form.capacity} onChange={e => updateField('capacity', e.target.value)} placeholder="12" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">Trajanje (min)</label>
                <input type="number" value={form.durationMin} onChange={e => updateField('durationMin', e.target.value)} placeholder="180" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-sans">
              <input type="checkbox" checked={form.bookingRequired} onChange={e => updateField('bookingRequired', e.target.checked)} className="rounded" />
              Rezervacija obvezna
            </label>
          </section>
        )}

        {/* === IMAGES === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Slike</h3>
          <ImageUpload
            images={form.images}
            onImagesChange={(imgs) => updateField('images', imgs)}
          />
        </section>

        {/* === PAYMENT === */}
        <section className="bg-card border rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Plačilo</h3>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_OPTIONS.map(p => (
              <button key={p.value} type="button" onClick={() => toggleArrayItem('payment', p.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition ${form.payment.includes(p.value) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-sans font-medium text-muted-foreground mb-1">LanaPay / Lightning naslov</label>
            <input value={form.lud16} onChange={e => updateField('lud16', e.target.value)} placeholder="farm@lanaeco.farm" className="w-full px-3 py-2 border rounded-lg text-sm font-sans" />
          </div>
        </section>

        {/* === SAVE === */}
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2.5 border rounded-lg text-sm font-sans font-medium hover:bg-muted transition">
            Prekliči
          </button>
          <button onClick={handleSave} disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-sans font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Shranjujem...' : isEdit ? 'Posodobi ponudbo' : 'Objavi ponudbo'}
          </button>
        </div>
      </div>
    </div>
  );
}
