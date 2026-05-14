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
  const driver = useAuthStore((s) => s.driver);

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

  if (!session) return <Navigate to="/signin" replace />;

  // No driver profile yet — send them through the application flow
  if (!driver) return <Navigate to="/apply" replace />;

  // Pending approval — must wait at /pending
  if (driver.status === 'pending_approval') return <Navigate to="/pending" replace />;

  // Suspended or deactivated — block access entirely
  if (driver.status === 'suspended' || driver.status === 'deactivated') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
