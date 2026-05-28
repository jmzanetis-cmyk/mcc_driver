import React, { lazy, Suspense } from 'react';
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
import { EnvBadge } from '@/components/EnvBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useColorScheme } from '@/hooks/useColorScheme';
import { OfflineBanner } from '@/components/OfflineBanner';
import { NetworkResyncBridge } from '@/components/NetworkResyncBridge';
import { AppStatusBridge } from '@/components/AppStatusBridge';

const SignInScreen = lazy(() => import('@/screens/SignInScreen').then(m => ({ default: m.SignInScreen })));
const ApplicationScreen = lazy(() => import('@/screens/ApplicationScreen').then(m => ({ default: m.ApplicationScreen })));
const PendingScreen = lazy(() => import('@/screens/PendingScreen').then(m => ({ default: m.PendingScreen })));
const RideAlongApplyScreen = lazy(() => import('@/screens/RideAlongApplyScreen').then(m => ({ default: m.RideAlongApplyScreen })));
const RideAlongPendingScreen = lazy(() => import('@/screens/RideAlongPendingScreen').then(m => ({ default: m.RideAlongPendingScreen })));
const RideAlongDashboardScreen = lazy(() => import('@/screens/RideAlongDashboardScreen').then(m => ({ default: m.RideAlongDashboardScreen })));
const MemberApprovalScreen = lazy(() => import('@/screens/MemberApprovalScreen').then(m => ({ default: m.MemberApprovalScreen })));
const HomeScreen = lazy(() => import('@/screens/HomeScreen').then(m => ({ default: m.HomeScreen })));
const NavigateScreen = lazy(() => import('@/screens/NavigateScreen').then(m => ({ default: m.NavigateScreen })));
const RideCompleteScreen = lazy(() => import('@/screens/RideCompleteScreen').then(m => ({ default: m.RideCompleteScreen })));
const EarningsScreen = lazy(() => import('@/screens/EarningsScreen').then(m => ({ default: m.EarningsScreen })));
const SettingsScreen = lazy(() => import('@/screens/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const AIChatScreen = lazy(() => import('@/screens/AIChatScreen').then(m => ({ default: m.AIChatScreen })));
const InstantPayScreen = lazy(() => import('@/screens/InstantPayScreen').then(m => ({ default: m.InstantPayScreen })));
const TipScreen = lazy(() => import('@/screens/TipScreen').then(m => ({ default: m.TipScreen })));
const RelocationScreen = lazy(() => import('@/screens/RelocationScreen').then(m => ({ default: m.RelocationScreen })));
const NotificationsScreen = lazy(() => import('@/screens/NotificationsScreen').then(m => ({ default: m.NotificationsScreen })));
const SafetyScreen = lazy(() => import('@/screens/SafetyScreen').then(m => ({ default: m.SafetyScreen })));
const DriverProfileScreen = lazy(() => import('@/screens/DriverProfileScreen').then(m => ({ default: m.DriverProfileScreen })));
const DocumentsScreen = lazy(() => import('@/screens/DocumentsScreen').then(m => ({ default: m.DocumentsScreen })));
const PerformanceScreen = lazy(() => import('@/screens/PerformanceScreen').then(m => ({ default: m.PerformanceScreen })));
const PromotionsScreen = lazy(() => import('@/screens/PromotionsScreen').then(m => ({ default: m.PromotionsScreen })));
const ScheduleScreen = lazy(() => import('@/screens/ScheduleScreen').then(m => ({ default: m.ScheduleScreen })));
const ScheduledJobsMapScreen = lazy(() => import('@/screens/ScheduledJobsMapScreen').then(m => ({ default: m.ScheduledJobsMapScreen })));
const HelpScreen = lazy(() => import('@/screens/HelpScreen').then(m => ({ default: m.HelpScreen })));
const TrainingHubScreen = lazy(() => import('@/screens/TrainingHubScreen').then(m => ({ default: m.TrainingHubScreen })));
const TrainingModuleScreen = lazy(() => import('@/screens/TrainingModuleScreen').then(m => ({ default: m.TrainingModuleScreen })));
const TrainingLessonScreen = lazy(() => import('@/screens/TrainingLessonScreen').then(m => ({ default: m.TrainingLessonScreen })));
const CoDriverEvalScreen = lazy(() => import('@/screens/CoDriverEvalScreen').then(m => ({ default: m.CoDriverEvalScreen })));
const SetupPaymentsScreen = lazy(() => import('@/screens/SetupPaymentsScreen').then(m => ({ default: m.SetupPaymentsScreen })));
const MileageScreen = lazy(() => import('@/screens/MileageScreen').then(m => ({ default: m.MileageScreen })));
const ExpensesScreen = lazy(() => import('@/screens/ExpensesScreen').then(m => ({ default: m.ExpensesScreen })));
const TaxEstimatorScreen = lazy(() => import('@/screens/TaxEstimatorScreen').then(m => ({ default: m.TaxEstimatorScreen })));
const LeaderboardScreen = lazy(() => import('@/screens/LeaderboardScreen').then(m => ({ default: m.LeaderboardScreen })));
const PrivacyScreen = lazy(() => import('@/screens/legal/PrivacyScreen').then(m => ({ default: m.PrivacyScreen })));
const TermsScreen = lazy(() => import('@/screens/legal/TermsScreen').then(m => ({ default: m.TermsScreen })));
const LegalSupportScreen = lazy(() => import('@/screens/legal/SupportScreen').then(m => ({ default: m.SupportScreen })));
const VehicleInspectionScreen = lazy(() => import('@/screens/VehicleInspectionScreen').then(m => ({ default: m.VehicleInspectionScreen })));
const ReferAndEarnScreen = lazy(() => import('@/screens/ReferAndEarnScreen').then(m => ({ default: m.ReferAndEarnScreen })));
const AnnouncementsScreen = lazy(() => import('@/screens/AnnouncementsScreen').then(m => ({ default: m.AnnouncementsScreen })));
const MyDocumentsScreen = lazy(() => import('@/screens/MyDocumentsScreen').then(m => ({ default: m.MyDocumentsScreen })));

function ScreenFallback() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: colors.surfaceDark,
    }}>
      <Spinner size={32} color={colors.gold} />
    </div>
  );
}

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
          <Suspense fallback={<ScreenFallback />}>
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
            <Route path="/ride/:rideId/inspection/:phase" element={<ProtectedRoute><VehicleInspectionScreen /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationsScreen /></ProtectedRoute>} />
            <Route path="/safety" element={<ProtectedRoute><SafetyScreen /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><DriverProfileScreen /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute><DocumentsScreen /></ProtectedRoute>} />
            <Route path="/performance" element={<ProtectedRoute><PerformanceScreen /></ProtectedRoute>} />
            <Route path="/promotions" element={<ProtectedRoute><PromotionsScreen /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><ScheduleScreen /></ProtectedRoute>} />
            <Route path="/scheduled-jobs" element={<ProtectedRoute><ScheduledJobsMapScreen /></ProtectedRoute>} />
            <Route path="/help" element={<ProtectedRoute><HelpScreen /></ProtectedRoute>} />
            <Route path="/training" element={<ProtectedRoute><TrainingHubScreen /></ProtectedRoute>} />
            <Route path="/training/module/:slug" element={<ProtectedRoute><TrainingModuleScreen /></ProtectedRoute>} />
            <Route path="/training/lesson/:lessonId" element={<ProtectedRoute><TrainingLessonScreen /></ProtectedRoute>} />
            <Route path="/ride/:rideId/eval-codriver" element={<ProtectedRoute><CoDriverEvalScreen /></ProtectedRoute>} />
            <Route path="/earnings" element={<ProtectedRoute><EarningsScreen /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsScreen /></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute><AIChatScreen /></ProtectedRoute>} />
            <Route path="/instant-pay" element={<ProtectedRoute><InstantPayScreen /></ProtectedRoute>} />
            <Route path="/settings/payments" element={<ProtectedRoute><SetupPaymentsScreen /></ProtectedRoute>} />
            <Route path="/mileage" element={<ProtectedRoute><MileageScreen /></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute><ExpensesScreen /></ProtectedRoute>} />
            <Route path="/tax-estimator" element={<ProtectedRoute><TaxEstimatorScreen /></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardScreen /></ProtectedRoute>} />
            <Route path="/refer" element={<ProtectedRoute><ReferAndEarnScreen /></ProtectedRoute>} />
            <Route path="/announcements" element={<ProtectedRoute><AnnouncementsScreen /></ProtectedRoute>} />
            <Route path="/my-documents" element={<ProtectedRoute><MyDocumentsScreen /></ProtectedRoute>} />
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
          </Suspense>
          </AppStatusBridge>
        </AuthProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}
