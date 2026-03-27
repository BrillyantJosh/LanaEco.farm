import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { useLanguage } from '@/i18n/LanguageContext';
import { KeyRound, Loader2, Eye, EyeOff, Leaf } from 'lucide-react';

export default function LoginPage() {
  const { t } = useLanguage();
  const [wif, setWif] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const { params, isLoading: paramsLoading } = useSystemParams();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!wif.trim()) {
      setError(t('login.errorEmpty'));
      return;
    }

    if (!params?.relays || params.relays.length === 0) {
      setError('System is still connecting. Please wait a moment and try again.');
      return;
    }

    setIsLoading(true);

    try {
      await login(wif, params.relays, rememberMe);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorInvalid'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg border p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Leaf className="w-7 h-7 text-primary" />
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {t('nav.brand')}
            </h1>
            <p className="text-sm text-muted-foreground font-sans mt-1">
              {t('login.title')}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="wif"
                className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5 font-sans"
              >
                <KeyRound className="w-4 h-4 text-primary" />
                {t('login.wifLabel')}
              </label>
              <div className="relative">
                <input
                  id="wif"
                  type={showWif ? 'text' : 'password'}
                  placeholder={t('login.wifPlaceholder')}
                  value={wif}
                  onChange={(e) => setWif(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 pr-11 border rounded-lg font-mono text-sm bg-background text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowWif(!showWif)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                  tabIndex={-1}
                >
                  {showWif ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-sans">
                {t('login.wifHint')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isLoading}
                className="w-4 h-4 text-primary rounded border-muted-foreground/30 focus:ring-primary accent-primary"
              />
              <label
                htmlFor="rememberMe"
                className="text-sm text-muted-foreground cursor-pointer font-sans"
              >
                {t('login.remember')}
              </label>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm font-sans">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || paramsLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition font-sans font-medium"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : paramsLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting to relays...
                </>
              ) : (
                t('login.submit')
              )}
            </button>
          </form>

          {/* Register button */}
          <div className="mt-5">
            <p className="text-sm text-muted-foreground font-sans text-center mb-3">
              {t('login.noProfile')}
            </p>
            <Link
              to="/register"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition font-sans font-medium"
            >
              {t('login.register')}
            </Link>
          </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t text-center">
            <p className="text-xs text-muted-foreground font-sans">
              {params?.relays
                ? t('login.connectedRelays', { count: params.relays.length })
                : 'Connecting to Nostr relays...'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
