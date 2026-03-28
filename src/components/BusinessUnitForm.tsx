import { useState } from 'react';
import { Save, ArrowLeft, Loader2, Plus, Trash2, Wallet, Banknote, CheckCircle, XCircle } from 'lucide-react';
import { ImageUpload } from './ImageUpload';
import { OpeningHoursEditor } from './OpeningHoursEditor';
import { LocationPicker } from './LocationPicker';
import { signNostrEvent } from '@/lib/nostrSigning';
import { publishToRelays, type BusinessUnit } from '@/lib/nostr';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

const CATEGORY_KEYS: { value: string; tKey: TranslationKey }[] = [
  { value: 'Eco Farm', tKey: 'cat.eco_farm' },
  { value: 'Shop', tKey: 'cat.shop' },
  { value: 'Café & Restaurant', tKey: 'cat.cafe' },
  { value: 'Beauty & Wellness', tKey: 'cat.beauty' },
  { value: 'Fashion', tKey: 'cat.fashion' },
  { value: 'Furniture', tKey: 'cat.furniture' },
  { value: 'Construction', tKey: 'cat.construction' },
  { value: 'Event & Workshop', tKey: 'cat.event' },
  { value: 'Accommodation', tKey: 'cat.accommodation' },
  { value: 'Pet', tKey: 'cat.pet' },
  { value: 'Service', tKey: 'cat.service' },
  { value: 'Online', tKey: 'cat.online' },
  { value: 'Other', tKey: 'cat.other' },
];

interface BusinessUnitFormProps {
  unit?: BusinessUnit;
  onBack: () => void;
  onSaved: () => void;
}

function generateUnitId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

interface FormData {
  name: string;
  content: string;
  receiverName: string;
  receiverAddress: string;
  receiverZip: string;
  receiverCity: string;
  receiverCountry: string;
  bankName: string;
  bankAddress: string;
  bankCountry: string;
  bankSwift: string;
  bankAccount: string;
  longitude: string;
  latitude: string;
  country: string;
  currency: string;
  category: string;
  categoryDetail: string;
  images: string[];
  status: string;
  openingHoursJson: string;
  video: string;
  url: string;
  logo: string;
  note: string;
  payoutMethod: string;
  payoutWallet: string;
}

export function BusinessUnitForm({ unit, onBack, onSaved }: BusinessUnitFormProps) {
  const { session } = useAuth();
  const { t } = useLanguage();
  const { params } = useSystemParams();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<keyof FormData>>(new Set());

  const [form, setForm] = useState<FormData>({
    name: unit?.name || '',
    content: unit?.content || '',
    receiverName: unit?.receiverName || '',
    receiverAddress: unit?.receiverAddress || '',
    receiverZip: unit?.receiverZip || '',
    receiverCity: unit?.receiverCity || '',
    receiverCountry: unit?.receiverCountry || '',
    bankName: unit?.bankName || '',
    bankAddress: unit?.bankAddress || '',
    bankCountry: unit?.bankCountry || '',
    bankSwift: unit?.bankSwift || '',
    bankAccount: unit?.bankAccount || '',
    longitude: unit?.longitude || '',
    latitude: unit?.latitude || '',
    country: unit?.country || '',
    currency: unit?.currency || session?.profileCurrency || 'EUR',
    category: unit?.category || CATEGORY_KEYS[0].value,
    categoryDetail: unit?.categoryDetail || '',
    images: unit?.images?.length ? [...unit.images] : [],
    status: unit?.status || 'active',
    openingHoursJson: unit?.openingHoursJson || '',
    video: unit?.video || '',
    url: unit?.url || '',
    logo: unit?.logo || '',
    note: unit?.note || '',
    payoutMethod: unit?.payoutMethod || 'fiat',
    payoutWallet: unit?.payoutWallet || '',
  });

  const unitId = unit?.unitId || generateUnitId();

  // Wallet validation state — if editing a unit that already has a LANA wallet, mark as pre-verified
  const [walletCheckStatus, setWalletCheckStatus] = useState<'idle' | 'checking' | 'registered' | 'not_registered' | 'error'>(
    unit?.payoutMethod === 'lana' && unit?.payoutWallet ? 'registered' : 'idle'
  );
  const [walletCheckError, setWalletCheckError] = useState<string | null>(null);

  const checkWalletRegistration = async (walletAddress: string) => {
    if (!walletAddress || !/^L[a-zA-Z0-9]{25,34}$/.test(walletAddress)) {
      setWalletCheckStatus('error');
      setWalletCheckError(t('buf.walletInvalid'));
      return;
    }

    setWalletCheckStatus('checking');
    setWalletCheckError(null);

    try {
      const res = await fetch('/api/register/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: walletAddress }),
      });
      const data = await res.json();

      if (!res.ok) {
        setWalletCheckStatus('error');
        setWalletCheckError(data.error || t('buf.walletVerifyFailed'));
        return;
      }

      if (data.registered) {
        setWalletCheckStatus('registered');
      } else {
        setWalletCheckStatus('not_registered');
        setWalletCheckError(t('buf.walletNotRegistered'));
      }
    } catch {
      setWalletCheckStatus('error');
      setWalletCheckError(t('buf.walletCheckFailed'));
    }
  };

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    // Reset wallet check when wallet address changes
    if (field === 'payoutWallet') {
      setWalletCheckStatus('idle');
      setWalletCheckError(null);
    }
  };

  const handleImageUpload = (url: string) => {
    if (url) {
      setForm(prev => ({ ...prev, images: [...prev.images, url] }));
    }
  };

  const removeImage = (index: number) => {
    setForm(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !params?.relays) return;

    // Validate required fields
    const required: (keyof FormData)[] = [
      'name', 'receiverName', 'receiverAddress', 'receiverZip',
      'receiverCity', 'receiverCountry', 'bankName', 'bankAddress',
      'bankCountry', 'bankSwift', 'bankAccount', 'longitude',
      'latitude', 'country', 'currency', 'category', 'categoryDetail'
    ];

    const missing = new Set<keyof FormData>();
    for (const field of required) {
      if (!form[field] || (typeof form[field] === 'string' && !(form[field] as string).trim())) {
        missing.add(field);
      }
    }

    // Validate LANA payout wallet if method is "lana"
    if (form.payoutMethod === 'lana') {
      if (!form.payoutWallet.trim()) {
        missing.add('payoutWallet' as keyof FormData);
      }
      if (walletCheckStatus !== 'registered') {
        setError(t('buf.walletRequired'));
        return;
      }
    }

    if (missing.size > 0 || form.images.length === 0) {
      setInvalidFields(missing);
      setError(`${t('buf.fillRequired')}${form.images.length === 0 ? ' ' + t('buf.addImage') : ''}`);
      // Scroll to first error
      const firstInvalid = document.querySelector('[data-invalid="true"]');
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setInvalidFields(new Set());

    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      // Build tags
      const tags: string[][] = [
        ['d', unitId],
        ['unit_id', unitId],
        ['name', form.name],
        ['owner_hex', session.nostrHexId],
        ['p', session.nostrHexId],
        ['receiver_name', form.receiverName],
        ['receiver_address', form.receiverAddress],
        ['receiver_zip', form.receiverZip],
        ['receiver_city', form.receiverCity],
        ['receiver_country', form.receiverCountry],
        ['bank_name', form.bankName],
        ['bank_address', form.bankAddress],
        ['bank_country', form.bankCountry],
        ['bank_swift', form.bankSwift],
        ['bank_account', form.bankAccount],
        ['longitude', form.longitude],
        ['latitude', form.latitude],
        ['country', form.country],
        ['currency', form.currency],
        ['category', form.category],
        ['category_detail', form.categoryDetail],
        ['status', form.status],
        ['lanapays_payout_method', form.payoutMethod],
      ];

      // Add LANA wallet if payout method is "lana"
      if (form.payoutMethod === 'lana' && form.payoutWallet) {
        tags.push(['lanapays_payout_wallet', form.payoutWallet]);
      }

      // Add images
      for (const img of form.images) {
        tags.push(['image', img]);
      }

      // Optional fields
      if (form.openingHoursJson) tags.push(['opening_hours_json', form.openingHoursJson]);
      if (form.video) tags.push(['video', form.video]);
      if (form.url) tags.push(['url', form.url]);
      if (form.logo) tags.push(['logo', form.logo]);
      if (form.note) tags.push(['note', form.note]);

      // Sign event
      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        30901,
        form.content,
        tags
      );

      // Publish to relays
      const result = await publishToRelays(signedEvent, params.relays);

      if (result.success.length > 0) {
        // If creating a new unit, also publish KIND 30902 fee policy
        if (!unit) {
          try {
            const feeRes = await fetch('/api/fee-policy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                unitId,
                ownerHex: session.nostrHexId,
                unitName: form.name,
              }),
            });
            const feeData = await feeRes.json();
            if (feeData.success) {
              setSuccess(t('buf.publishedWithFee', { n: result.success.length, f: feeData.relaysSuccess.length }));
            } else {
              setSuccess(t('buf.publishedFeeWarn', { n: result.success.length }));
            }
          } catch {
            setSuccess(t('buf.publishedFeeReqFail', { n: result.success.length }));
          }
        } else {
          setSuccess(t('buf.published', { n: result.success.length }));
        }
        setTimeout(() => onSaved(), 2000);
      } else {
        setError(t('buf.publishFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('buf.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const inputBase = "w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
  const inputClass = (field?: keyof FormData) =>
    `${inputBase} border ${field && invalidFields.has(field) ? 'border-red-500 bg-red-50 dark:border-red-700 dark:bg-red-900/20' : 'border-gray-300 dark:border-gray-600'}`;
  const labelClass = (field?: keyof FormData) =>
    `block text-sm font-medium mb-1 ${field && invalidFields.has(field) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`;

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('buf.backToList')}
      </button>

      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
        {unit ? t('buf.editTitle') : t('buf.createTitle')}
      </h2>

      {/* Default fee policy info (only on create) */}
      {!unit && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
          <h4 className="font-semibold text-blue-800 dark:text-blue-300 text-sm mb-1">{t('buf.feeTitle')}</h4>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            {t('buf.feeDesc')}
          </p>
          <div className="mt-2 text-sm">
            <span className="text-blue-600 dark:text-blue-400 font-medium">{t('buf.fee')}</span>{' '}
            <span className="font-bold text-blue-900 dark:text-blue-200">5.00%</span>
            <span className="text-blue-600 dark:text-blue-400 ml-1">{t('buf.feeSame')}</span>
          </div>
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-2">
            {t('buf.feeNote')}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.basicInfo')}</h3>

          <div data-invalid={invalidFields.has('name') || undefined}>
            <label className={labelClass('name')}>{t('buf.businessName')} *</label>
            <input className={inputClass('name')} value={form.name} onChange={e => updateField('name', e.target.value)} placeholder="Lana Café Ljubljana" />
          </div>

          <div>
            <label className={labelClass()}>{t('buf.description')}</label>
            <textarea className={inputClass()} rows={3} value={form.content} onChange={e => updateField('content', e.target.value)} placeholder={t('buf.descPlaceholder')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass('category')}>{t('buf.category')} *</label>
              <select className={inputClass('category')} value={form.category} onChange={e => updateField('category', e.target.value)}>
                {CATEGORY_KEYS.map(c => <option key={c.value} value={c.value}>{t(c.tKey)}</option>)}
              </select>
            </div>
            <div data-invalid={invalidFields.has('categoryDetail') || undefined}>
              <label className={labelClass('categoryDetail')}>{t('buf.categoryDetail')} *</label>
              <input className={inputClass('categoryDetail')} value={form.categoryDetail} onChange={e => updateField('categoryDetail', e.target.value)} placeholder="Organic Coffee" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div data-invalid={invalidFields.has('country') || undefined}>
              <label className={labelClass('country')}>{t('buf.countryIso')} *</label>
              <input className={inputClass('country')} value={form.country} onChange={e => updateField('country', e.target.value)} placeholder="SI" maxLength={2} />
            </div>
            <div data-invalid={invalidFields.has('currency') || undefined}>
              <label className={labelClass('currency')}>{t('buf.currency')} *</label>
              <input className={inputClass('currency')} value={form.currency} onChange={e => updateField('currency', e.target.value)} placeholder="EUR" maxLength={3} />
            </div>
            <div>
              <label className={labelClass()}>{t('buf.status')}</label>
              <select className={inputClass()} value={form.status} onChange={e => updateField('status', e.target.value)}>
                <option value="active">{t('buf.statusActive')}</option>
                <option value="paused">{t('buf.statusPaused')}</option>
                <option value="archived">{t('buf.statusArchived')}</option>
              </select>
            </div>
          </div>
        </section>

        {/* Receiver Info */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.receiverInfo')}</h3>

          <div data-invalid={invalidFields.has('receiverName') || undefined}>
            <label className={labelClass('receiverName')}>{t('buf.receiverName')} *</label>
            <input className={inputClass('receiverName')} value={form.receiverName} onChange={e => updateField('receiverName', e.target.value)} placeholder="Lana Café d.o.o." />
          </div>

          <div data-invalid={invalidFields.has('receiverAddress') || undefined}>
            <label className={labelClass('receiverAddress')}>{t('buf.address')} *</label>
            <input className={inputClass('receiverAddress')} value={form.receiverAddress} onChange={e => updateField('receiverAddress', e.target.value)} placeholder="Slovenska cesta 10" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div data-invalid={invalidFields.has('receiverZip') || undefined}>
              <label className={labelClass('receiverZip')}>{t('buf.zip')} *</label>
              <input className={inputClass('receiverZip')} value={form.receiverZip} onChange={e => updateField('receiverZip', e.target.value)} placeholder="1000" />
            </div>
            <div data-invalid={invalidFields.has('receiverCity') || undefined}>
              <label className={labelClass('receiverCity')}>{t('buf.city')} *</label>
              <input className={inputClass('receiverCity')} value={form.receiverCity} onChange={e => updateField('receiverCity', e.target.value)} placeholder="Ljubljana" />
            </div>
            <div data-invalid={invalidFields.has('receiverCountry') || undefined}>
              <label className={labelClass('receiverCountry')}>{t('buf.countryIso')} *</label>
              <input className={inputClass('receiverCountry')} value={form.receiverCountry} onChange={e => updateField('receiverCountry', e.target.value)} placeholder="SI" maxLength={2} />
            </div>
          </div>
        </section>

        {/* Bank Info */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.bankDetails')}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-invalid={invalidFields.has('bankName') || undefined}>
              <label className={labelClass('bankName')}>{t('buf.bankName')} *</label>
              <input className={inputClass('bankName')} value={form.bankName} onChange={e => updateField('bankName', e.target.value)} placeholder="LanaBank" />
            </div>
            <div data-invalid={invalidFields.has('bankSwift') || undefined}>
              <label className={labelClass('bankSwift')}>{t('buf.bankSwift')} *</label>
              <input className={inputClass('bankSwift')} value={form.bankSwift} onChange={e => updateField('bankSwift', e.target.value)} placeholder="LNBASI2X" />
            </div>
          </div>

          <div data-invalid={invalidFields.has('bankAddress') || undefined}>
            <label className={labelClass('bankAddress')}>{t('buf.bankAddress')} *</label>
            <input className={inputClass('bankAddress')} value={form.bankAddress} onChange={e => updateField('bankAddress', e.target.value)} placeholder="Cankarjeva 12, Ljubljana" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-invalid={invalidFields.has('bankCountry') || undefined}>
              <label className={labelClass('bankCountry')}>{t('buf.bankCountryIso')} *</label>
              <input className={inputClass('bankCountry')} value={form.bankCountry} onChange={e => updateField('bankCountry', e.target.value)} placeholder="SI" maxLength={2} />
            </div>
            <div data-invalid={invalidFields.has('bankAccount') || undefined}>
              <label className={labelClass('bankAccount')}>{t('buf.bankAccount')} *</label>
              <input className={inputClass('bankAccount')} value={form.bankAccount} onChange={e => updateField('bankAccount', e.target.value)} placeholder="SI56192000012345678" />
            </div>
          </div>
        </section>

        {/* Payout Method */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.payoutTitle')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('buf.payoutDesc')}
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                updateField('payoutMethod', 'fiat');
                setWalletCheckStatus('idle');
                setWalletCheckError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition text-sm font-medium ${
                form.payoutMethod === 'fiat'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <Banknote className="w-5 h-5" />
              {t('buf.payoutFiat')}
            </button>
            <button
              type="button"
              onClick={() => updateField('payoutMethod', 'lana')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition text-sm font-medium ${
                form.payoutMethod === 'lana'
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <Wallet className="w-5 h-5" />
              {t('buf.payoutLana')}
            </button>
          </div>

          {form.payoutMethod === 'fiat' && (
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-400">
              {t('buf.payoutFiatNote')}
            </div>
          )}

          {form.payoutMethod === 'lana' && (
            <div className="space-y-3">
              <div>
                <label className={labelClass()}>{t('buf.lanaWallet')} *</label>
                <div className="flex gap-2">
                  <input
                    className={`${inputBase} border ${
                      walletCheckStatus === 'registered' ? 'border-green-500 bg-green-50 dark:bg-green-900/30' :
                      walletCheckStatus === 'not_registered' || walletCheckStatus === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-900/30' :
                      'border-gray-300 dark:border-gray-600'
                    } flex-1`}
                    value={form.payoutWallet}
                    onChange={e => updateField('payoutWallet', e.target.value)}
                    placeholder="LWmqx4aQvPbcR6gTknPLSupnz..."
                  />
                  <button
                    type="button"
                    disabled={!form.payoutWallet.trim() || walletCheckStatus === 'checking'}
                    onClick={() => checkWalletRegistration(form.payoutWallet)}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                  >
                    {walletCheckStatus === 'checking' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : t('buf.verify')}
                  </button>
                </div>
              </div>

              {walletCheckStatus === 'registered' && (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  {t('buf.walletRegistered')}
                </div>
              )}

              {(walletCheckStatus === 'not_registered' || walletCheckStatus === 'error') && walletCheckError && (
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {walletCheckError}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Location */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5">
          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            onLocationChange={(lat, lng) => setForm(prev => ({ ...prev, latitude: lat, longitude: lng }))}
          />
        </section>

        {/* Images */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.images')} *</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('buf.imagesDesc')}</p>

          <div className="flex flex-wrap gap-3">
            {form.images.map((img, i) => (
              <div key={i} className="relative">
                <img src={img} alt={`Image ${i + 1}`} className="w-24 h-24 object-cover rounded-lg border" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <ImageUpload onUpload={handleImageUpload} label="" />
          </div>
        </section>

        {/* Optional */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('buf.optionalFields')}</h3>

          <div>
            <label className={labelClass()}>{t('buf.logo')}</label>
            <ImageUpload
              onUpload={(url) => updateField('logo', url)}
              currentUrl={form.logo || undefined}
              label=""
            />
          </div>

          <div>
            <label className={labelClass()}>{t('buf.videoUrl')}</label>
            <input className={inputClass()} value={form.video} onChange={e => updateField('video', e.target.value)} placeholder="https://..." />
          </div>

          <div>
            <label className={labelClass()}>{t('buf.publicUrl')}</label>
            <input className={inputClass()} value={form.url} onChange={e => updateField('url', e.target.value)} placeholder="https://lanapays.us/unit/..." />
          </div>

          <div>
            <label className={labelClass()}>{t('buf.note')}</label>
            <textarea className={inputClass()} rows={2} value={form.note} onChange={e => updateField('note', e.target.value)} placeholder={t('buf.notePlaceholder')} />
          </div>

          <OpeningHoursEditor
            value={form.openingHoursJson}
            onChange={(json) => updateField('openingHoursJson', json)}
          />
        </section>

        {/* Error / Success */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">
            {success}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('buf.publishing')}
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              {unit ? t('buf.update') : t('buf.create')}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
