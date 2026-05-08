import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

const ADMIN_HEXES = [
  '16a970069d63ca1f739c4e3b9a5f34bca6a93ead182dbf1e438a801aa03f4ef3',
  '56e8670aa65491f8595dc3a71c94aa7445dcdca755ca5f77c07218498a362061',
];

export function isAdminHex(hex: string | undefined | null): boolean {
  if (!hex) return false;
  return ADMIN_HEXES.includes(hex.toLowerCase());
}

export default function AdminProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!isAdminHex(session.nostrHexId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-lg border p-8 text-center">
          <h2 className="text-2xl font-display font-bold mb-3">Not authorized</h2>
          <p className="text-sm text-muted-foreground font-sans">
            Your account does not have admin privileges on this portal.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
