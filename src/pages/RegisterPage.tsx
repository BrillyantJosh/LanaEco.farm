import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { convertWifToIds } from '@/lib/crypto';
import { signNostrEvent } from '@/lib/nostrSigning';
import { publishToRelays } from '@/lib/nostr';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { KeyRound, Loader2, CheckCircle2, XCircle, ArrowLeft, UserPlus, Wallet, AlertTriangle, Camera } from 'lucide-react';
import QrScanner from '@/components/QrScanner';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'sl', name: 'Slovenian - Slovenščina' },
  { code: 'de', name: 'German - Deutsch' },
  { code: 'es', name: 'Spanish - Español' },
  { code: 'fr', name: 'French - Français' },
  { code: 'it', name: 'Italian - Italiano' },
  { code: 'pt', name: 'Portuguese - Português' },
  { code: 'nl', name: 'Dutch - Nederlands' },
  { code: 'hr', name: 'Croatian - Hrvatski' },
  { code: 'sr', name: 'Serbian - Srpski' },
  { code: 'bs', name: 'Bosnian - Bosanski' },
  { code: 'pl', name: 'Polish - Polski' },
  { code: 'cs', name: 'Czech - Čeština' },
  { code: 'sk', name: 'Slovak - Slovenčina' },
  { code: 'ru', name: 'Russian - Русский' },
  { code: 'tr', name: 'Turkish - Türkçe' },
  { code: 'ja', name: 'Japanese - 日本語' },
  { code: 'zh', name: 'Chinese - 中文' },
  { code: 'ko', name: 'Korean - 한국어' },
  { code: 'ar', name: 'Arabic - العربية' },
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'BRL', 'INR', 'MXN', 'PLN', 'CZK', 'HRK', 'RSD', 'TRY', 'RUB'];

interface DerivedIds {
  walletId: string;
  walletIdCompressed?: string;
  walletIdUncompressed?: string;
  isCompressed?: boolean;
  nostrHexId: string;
  nostrNpubId: string;
  nostrPrivateKey: string;
}

export default function Register() {
  const navigate = useNavigate();
  const { params } = useSystemParams();

  // Step management
  const [step, setStep] = useState<'wif' | 'form'>('wif');

  // QR Scanner
  const [showQrScanner, setShowQrScanner] = useState(false);

  // Step 1: WIF + registration check
  const [wif, setWif] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [derivedIds, setDerivedIds] = useState<DerivedIds | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);

  // Step 2: Profile form
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [walletRegStatus, setWalletRegStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    display_name: '',
    about: '',
    location: '',
    country: '',
    currency: 'EUR',
    language: 'en',
    whoAreYou: 'Human',
    orgasmic_profile: '',
    statement_of_responsibility: '',
  });

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Step 1: Check WIF and registration
  const handleCheckWif = async () => {
    if (!wif.trim()) {
      setCheckError('Please enter your WIF private key');
      return;
    }

    setIsChecking(true);
    setCheckError(null);
    setIsRegistered(false);

    try {
      // 1. Derive keys from WIF
      const ids = await convertWifToIds(wif);
      setDerivedIds(ids);

      // 2. Check both wallet IDs against registration API
      const walletsToCheck = [ids.walletId];
      // Also check the other wallet format
      if (ids.isCompressed && ids.walletIdUncompressed) {
        walletsToCheck.push(ids.walletIdUncompressed);
      } else if (!ids.isCompressed && ids.walletIdCompressed) {
        walletsToCheck.push(ids.walletIdCompressed);
      }

      for (const walletId of walletsToCheck) {
        const res = await fetch('/api/register/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: walletId })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Registration check failed');
        }

        if (data.registered) {
          setIsRegistered(true);
          return;
        }
      }

      // Not registered — proceed to form
      setStep('form');

    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'Check failed');
    } finally {
      setIsChecking(false);
    }
  };

  // Step 2: Publish KIND 0 profile
  const handlePublishProfile = async () => {
    if (!derivedIds || !params?.relays) return;

    // Validate required fields
    const requiredFields = [
      { key: 'name', label: 'Name' },
      { key: 'display_name', label: 'Display Name' },
      { key: 'about', label: 'About' },
      { key: 'location', label: 'Location' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Currency' },
      { key: 'language', label: 'Language' },
      { key: 'orgasmic_profile', label: 'Orgasmic Profile' },
      { key: 'statement_of_responsibility', label: 'Statement of Responsibility' },
    ];

    for (const { key, label } of requiredFields) {
      if (!(form as any)[key]?.trim()) {
        setPublishError(`${label} is required`);
        return;
      }
    }

    if (form.country.length !== 2) {
      setPublishError('Country must be a 2-letter ISO code (e.g., SI, US, DE)');
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      // Build KIND 0 content
      const profileContent = {
        name: form.name.trim(),
        display_name: form.display_name.trim(),
        about: form.about.trim(),
        location: form.location.trim(),
        country: form.country.toUpperCase().trim(),
        currency: form.currency,
        language: form.language,
        lanoshi2lash: '10000',
        lanaWalletID: derivedIds.walletId,
        whoAreYou: form.whoAreYou,
        orgasmic_profile: form.orgasmic_profile.trim(),
        statement_of_responsibility: form.statement_of_responsibility.trim(),
      };

      // Build tags
      const tags: string[][] = [
        ['lang', form.language],
      ];

      // Sign KIND 0 event
      const signedEvent = signNostrEvent(
        derivedIds.nostrPrivateKey,
        0,
        JSON.stringify(profileContent),
        tags
      );

      // Publish to all relays
      const result = await publishToRelays(signedEvent, params.relays);

      if (result.success.length === 0) {
        setPublishError('Failed to publish to any relay. Please try again.');
        return;
      }

      // KIND 0 published — now register the wallet via check_wallet
      setWalletRegStatus('Registering wallet...');

      try {
        const regRes = await fetch('/api/register/wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_id: derivedIds.walletId,
            nostr_id_hex: derivedIds.nostrHexId
          })
        });

        const regData = await regRes.json();

        if (!regRes.ok) {
          // Wallet registration failed but KIND 0 was published — warn but don't block
          console.error('Wallet registration failed:', regData);
          setWalletRegStatus(`Profile published. Wallet registration warning: ${regData.error || 'unknown error'}`);
        } else if (regData.success) {
          setWalletRegStatus(`Wallet registered: ${regData.message}`);
        } else {
          // Non-virgin or rejected
          setWalletRegStatus(`Profile published. Wallet: ${regData.message || 'registration pending'}`);
        }
      } catch (walletErr) {
        console.error('Wallet registration request failed:', walletErr);
        setWalletRegStatus('Profile published. Wallet registration could not be completed.');
      }

      setPublishSuccess(true);
      // Redirect to login after 4 seconds (extra time to read wallet status)
      setTimeout(() => navigate('/login'), 4000);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Publishing failed');
    } finally {
      setIsPublishing(false);
    }
  };

  const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-start py-8 px-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-3">
            <UserPlus className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create Profile</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Register your LanaCoin wallet on the Nostr network</p>
        </div>

        {/* Wallet creation notice */}
        {step === 'wif' && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl p-5 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-2 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-bold text-base">
                  Nimate denarnice? / Don't have a wallet?
                </p>
                <p>
                  Denarnico si lahko ustvarite na{' '}
                  <a href="https://www.offlinelana.org" target="_blank" rel="noopener noreferrer"
                    className="text-blue-700 dark:text-blue-400 font-bold underline underline-offset-2 text-base">
                    www.offlinelana.org
                  </a>
                </p>
                <div className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded-lg p-3 mt-2">
                  <p className="font-bold text-red-800 dark:text-red-300">
                    Natisnite in shranite svoj zasebni ključ!
                  </p>
                  <p className="text-red-700 dark:text-red-400 mt-1">
                    Nihče ne hrani kopije vašega ključa. Če ga izgubite, je nemogoče obnoviti vaš profil in sredstva. Vaš ključ, vaša odgovornost.
                  </p>
                  <p className="text-red-700 dark:text-red-400 mt-1 italic text-xs">
                    Print and save your private key! Nobody keeps a copy. If you lose it, your profile and funds are gone forever.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: WIF Check */}
        {step === 'wif' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border p-6 space-y-5">
            <div>
              <label className={labelClass}>
                <KeyRound className="w-4 h-4 inline mr-1.5" />
                WIF Private Key
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  className={inputClass + " font-mono flex-1"}
                  placeholder="Enter WIF key..."
                  value={wif}
                  onChange={e => setWif(e.target.value)}
                  disabled={isChecking}
                />
                <button
                  type="button"
                  onClick={() => setShowQrScanner(true)}
                  disabled={isChecking}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-lg transition disabled:opacity-50"
                  title="Scan QR code"
                >
                  <Camera className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your private key is processed locally and never sent to any server.</p>
            </div>

            {/* Derived wallet info */}
            {derivedIds && !isRegistered && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="font-medium">Wallet Type:</span>
                  <span className={derivedIds.isCompressed ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}>
                    {derivedIds.isCompressed ? 'Staking (Compressed)' : 'Dominate (Uncompressed)'}
                  </span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 font-mono break-all">
                  Primary: {derivedIds.walletId}
                </div>
              </div>
            )}

            {/* Already registered */}
            {isRegistered && derivedIds && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-300">This wallet is already registered</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                      The wallet <code className="text-xs bg-amber-100 dark:bg-amber-900/40 px-1 rounded">{derivedIds.walletId}</code> is already registered in the Lana ecosystem. You can proceed to log in.
                    </p>
                  </div>
                </div>
                <Link
                  to="/login"
                  className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
                >
                  Go to Login
                </Link>
              </div>
            )}

            {/* Error */}
            {checkError && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{checkError}</span>
              </div>
            )}

            {/* Check button */}
            {!isRegistered && (
              <button
                onClick={handleCheckWif}
                disabled={isChecking || !wif.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking registration...
                  </>
                ) : (
                  'Check Registration'
                )}
              </button>
            )}

            <div className="text-center text-sm text-gray-500 dark:text-gray-400">
              Already have a profile?{' '}
              <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline">Login here</Link>
            </div>
          </div>
        )}

        {/* Step 2: Profile Form */}
        {step === 'form' && derivedIds && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('wif')}
              className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            {/* Wallet info bar */}
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
              <span className="font-medium text-blue-800 dark:text-blue-300">Wallet:</span>{' '}
              <code className="text-xs text-blue-700 dark:text-blue-400">{derivedIds.walletId}</code>
            </div>

            {/* Success */}
            {publishSuccess && (
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">Profile created successfully!</p>
                  {walletRegStatus && (
                    <p className="text-sm text-green-700 dark:text-green-400 mt-1">{walletRegStatus}</p>
                  )}
                  <p className="text-sm text-green-700 dark:text-green-400 mt-1">Redirecting to login...</p>
                </div>
              </div>
            )}

            {!publishSuccess && (
              <>
                {/* Basic Info */}
                <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Basic Information</h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Name *</label>
                      <input className={inputClass} value={form.name} onChange={e => updateField('name', e.target.value)} placeholder="john_doe" />
                    </div>
                    <div>
                      <label className={labelClass}>Display Name *</label>
                      <input className={inputClass} value={form.display_name} onChange={e => updateField('display_name', e.target.value)} placeholder="John Doe" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>About *</label>
                    <textarea className={inputClass} rows={3} value={form.about} onChange={e => updateField('about', e.target.value)} placeholder="Tell us about yourself..." />
                  </div>

                  <div>
                    <label className={labelClass}>Location *</label>
                    <input className={inputClass} value={form.location} onChange={e => updateField('location', e.target.value)} placeholder="Ljubljana, Slovenia" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>Country (ISO) *</label>
                      <input className={inputClass} value={form.country} onChange={e => updateField('country', e.target.value.toUpperCase())} placeholder="SI" maxLength={2} />
                    </div>
                    <div>
                      <label className={labelClass}>Currency *</label>
                      <select className={inputClass} value={form.currency} onChange={e => updateField('currency', e.target.value)}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Language *</label>
                      <select className={inputClass} value={form.language} onChange={e => updateField('language', e.target.value)}>
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    </div>
                  </div>
                </section>

                {/* Orgasmic Profile */}
                <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Orgasmic Profile</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Things that bring you joy — activities, passions, and pursuits that make you happy.</p>
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={form.orgasmic_profile}
                    onChange={e => updateField('orgasmic_profile', e.target.value)}
                    placeholder="Coding, hiking in the Alps, cooking Italian food, playing guitar..."
                  />
                </section>

                {/* Statement of Responsibility */}
                <section className="bg-white dark:bg-gray-800 rounded-xl border p-5 space-y-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Statement of Responsibility</h3>
                  <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
                    <strong>Mandatory:</strong> Please write in your own words that you accept unconditional self-responsibility. This is a personal declaration — no templates or auto-fill. Must be written in English.
                  </div>
                  <textarea
                    className={inputClass}
                    rows={4}
                    value={form.statement_of_responsibility}
                    onChange={e => updateField('statement_of_responsibility', e.target.value)}
                    placeholder="Write your personal statement of unconditional self-responsibility here..."
                  />
                </section>

                {/* Error */}
                {publishError && (
                  <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                    <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{publishError}</span>
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handlePublishProfile}
                  disabled={isPublishing}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {walletRegStatus || 'Publishing profile to relays...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Create Profile
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* QR Scanner Modal */}
      {showQrScanner && (
        <QrScanner
          onScan={(value) => {
            setWif(value);
            setShowQrScanner(false);
          }}
          onClose={() => setShowQrScanner(false)}
        />
      )}
    </div>
  );
}
