import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { AuthProvider } from '@/features/auth/provider/AuthProvider';
import { ProtectedRoute } from '@/features/auth/guards/ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components';
import { colors } from '@/theme';
import './theme/global.css';

import { ActiveRideWatcher } from '@/components/ActiveRideWatcher';
import { LocationTracker } from '@/components/LocationTracker';
import { SignInScreen } from '@/screens/SignInScreen';
import { ApplicationScreen } from '@/screens/ApplicationScreen';
import { PendingScreen } from '@/screens/PendingScreen';
import { RideAlongApplyScreen } from '@/screens/RideAlongApplyScreen';
import { RideAlongPendingScreen } from '@/screens/RideAlongPendingScreen';
import { RideAlongDashboardScreen } from '@/screens/RideAlongDashboardScreen';
import { MemberApprovalScreen } from '@/screens/MemberApprovalScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { NavigateScreen } from '@/screens/NavigateScreen';
import { RideCompleteScreen } from '@/screens/RideCompleteScreen';
import { EarningsScreen } from '@/screens/EarningsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { AIChatScreen } from '@/screens/AIChatScreen';
import { InstantPayScreen } from '@/screens/InstantPayScreen';
import { TipScreen } from '@/screens/TipScreen';
import { RelocationScreen } from '@/screens/RelocationScreen';
import { NotificationsScreen } from '@/screens/NotificationsScreen';
import { SafetyScreen } from '@/screens/SafetyScreen';
import { DriverProfileScreen } from '@/screens/DriverProfileScreen';
import { DocumentsScreen } from '@/screens/DocumentsScreen';
import { PerformanceScreen } from '@/screens/PerformanceScreen';
import { PromotionsScreen } from '@/screens/PromotionsScreen';
import { SetupPaymentsScreen } from '@/screens/SetupPaymentsScreen';
import { PrivacyScreen } from '@/screens/legal/PrivacyScreen';
import { TermsScreen } from '@/screens/legal/TermsScreen';
import { SupportScreen as LegalSupportScreen } from '@/screens/legal/SupportScreen';
import { EnvBadge } from '@/components/EnvBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useColorScheme } from '@/hooks/useColorScheme';
import { OfflineBanner } from '@/components/OfflineBanner';
import { NetworkResyncBridge } from '@/components/NetworkResyncBridge';
import { AppStatusBridge } from '@/components/AppStatusBridge';

function AuthRedirect() {
  const { isLoading, isAuthenticated, driver } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: colors.surfaceDark,
      }}>
        <img
          src="/driver/mcc-driver-logo.png"
          alt="My Car Concierge Driver"
          style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 16 }}
        />
        <Spinner size={24} color={colors.gold} />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  if (!driver) return <Navigate to="/apply" replace />;
  if (driver.status === 'pending_approval') return <Navigate to="/pending" replace />;

  if (driver.status === 'suspended' || driver.status === 'deactivated') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, background: colors.bgPrimary,
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
          Account {driver.status === 'suspended' ? 'Suspended' : 'Deactivated'}
        </div>
        <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', maxWidth: 300 }}>
          Contact My Car Concierge support for more information.
        </div>
      </div>
    );
  }

  return <Navigate to="/home" replace />;
}


export default function App() {
  useColorScheme();
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <QueryProvider>
        <AuthProvider>
          <ActiveRideWatcher />
          <LocationTracker />
          <NetworkResyncBridge />
          <OfflineBanner />
          <EnvBadge />
          <div
            style={{
              position: 'fixed',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              right: 16,
              zIndex: 80,
            }}
          >
            <ThemeToggle />
          </div>
          <AppStatusBridge>
          <Routes>
            <Route path="/signin" element={<SignInScreen />} />
            <Route path="/apply" element={<ApplicationScreen />} />
            <Route path="/pending" element={<PendingScreen />} />
            <Route path="/ride-along-apply" element={<RideAlongApplyScreen />} />
            <Route path="/ride-along-pending" element={<RideAlongPendingScreen />} />
            <Route path="/ride-along" element={<RideAlongDashboardScreen />} />
            <Route path="/tandem-match/:tandemJobId/approve" element={<MemberApprovalScreen />} />
            <Route path="/home" element={<ProtectedRoute><HomeScreen /></ProtectedRoute>} />
            <Route path="/ride/:rideId/navigate" element={<ProtectedRoute><NavigateScreen /></ProtectedRoute>} />
            <Route path="/ride/:rideId/complete" element={<ProtectedRoute><RideCompleteScreen /></ProtectedRoute>} />
            <Route path="/ride/:rideId/tip" element={<ProtectedRoute><TipScreen /></ProtectedRoute>} />
            <Route path="/ride/:rideId/relocation" element={<ProtectedRoute><RelocationScreen /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationsScreen /></ProtectedRoute>} />
            <Route path="/safety" element={<ProtectedRoute><SafetyScreen /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><DriverProfileScreen /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute><DocumentsScreen /></ProtectedRoute>} />
            <Route path="/performance" element={<ProtectedRoute><PerformanceScreen /></ProtectedRoute>} />
            <Route path="/promotions" element={<ProtectedRoute><PromotionsScreen /></ProtectedRoute>} />
            <Route path="/earnings" element={<ProtectedRoute><EarningsScreen /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsScreen /></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute><AIChatScreen /></ProtectedRoute>} />
            <Route path="/instant-pay" element={<ProtectedRoute><InstantPayScreen /></ProtectedRoute>} />
            <Route path="/settings/payments" element={<ProtectedRoute><SetupPaymentsScreen /></ProtectedRoute>} />
            <Route path="/scheduled" element={<Navigate to="/home" replace />} />
            {/* Public legal routes — required by App Store Connect for the
                Privacy Policy URL, Terms of Use URL, and Support URL fields.
                These resolve over HTTPS via the deployed driver app domain
                and are linked from SignIn, Application, and Settings. */}
            <Route path="/legal/privacy" element={<PrivacyScreen />} />
            <Route path="/legal/terms" element={<TermsScreen />} />
            <Route path="/legal/support" element={<LegalSupportScreen />} />
            <Route path="*" element={<AuthRedirect />} />
          </Routes>
          </AppStatusBridge>
        </AuthProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}
