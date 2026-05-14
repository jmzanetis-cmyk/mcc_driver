// ============================================================
// MCC Driver — Protected Route Guard
// ============================================================

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components';
import { colors } from '@/theme';

export function ProtectedRoute({ children }: React.PropsWithChildren) {
  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: colors.navy,
      }}>
        <Spinner size={32} color={colors.gold} />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/signin" replace />;
  }

  return <>{children}</>;
}
