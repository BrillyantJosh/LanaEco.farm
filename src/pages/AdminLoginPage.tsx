import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { isAdminHex } from '@/components/AdminProtectedRoute';
import { ShieldCheck, KeyRound, Loader2, Eye, EyeOff, ScanLine } from 'lucide-react';

const QrScanner = lazy(() => import('@/components/QrScanner'));

export default function AdminLoginPage() {
  const [wif, setWif] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const { login, session } = useAuth();
  const { params, isLoading: paramsLoading } = useSystemParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (session && isAdminHex(session.nostrHexId)) {
      navigate('/admin', { replace: true });
    }
  }, [session, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!wif.trim()) {
      setError('Please enter your WIF private key');
      return;
    }
    setIsLoading(true);
    try {
      // Login (no relay profile lookup needed for admins — just derive hex)
      await login(wif, [], true);
      // Re-read latest session from localStorage to check hex
      const stored = localStorage.getItem('lana_pays_session');
      const parsed = stored ? JSON.parse(stored) : null;
      if (!parsed?.nostrHexId || !isAdminHex(parsed.nostrHexId)) {
        setError('This key does not have admin privileges on this portal.');
        return;
      }
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid WIF key');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg border p-8">
          <div className="text-center mb-8">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <ShieldCheck className="w-7 h-7 text-primary" />
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Admin sign in
            </h1>
            <p className="text-sm text-muted-foreground font-sans mt-1">
              Enter your WIF private key to access the admin panel.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="wif"
                className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5 font-sans"
              >
                <KeyRound className="w-4 h-4 text-primary" />
                WIF private key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="wif"
                    type={showWif ? 'text' : 'password'}
                    placeholder="T..."
                    value={wif}
                    onChange={(e) => setWif(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-4 py-2.5 pr-11 border rounded-lg font-mono text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWif(!showWif)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showWif ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowQrScanner(true)}
                  disabled={isLoading}
                  title="Skeniraj QR kodo z WIF ključem"
                  className="px-3 border rounded-lg bg-muted/30 hover:bg-muted text-foreground disabled:opacity-50 flex items-center justify-center"
                >
                  <ScanLine className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-sans">
                Vnesi ročno ali skeniraj QR kodo.
              </p>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm font-sans">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || paramsLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition font-sans font-medium"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t text-center">
            <p className="text-xs text-muted-foreground font-sans">
              {params?.relays
                ? `Connected to ${params.relays.length} relays`
                : 'Connecting...'}
            </p>
          </div>
        </div>
      </div>

      {showQrScanner && (
        <Suspense fallback={null}>
          <QrScanner
            onScan={(value) => {
              setWif(value.trim());
              setShowQrScanner(false);
            }}
            onClose={() => setShowQrScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
