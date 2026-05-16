// ============================================================
// MCC Driver — Settings Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getAvailableNavApps, getNavAppName, type NavApp } from '@/services/navigation/navService';
import { PageHeader, Card, Button } from '@/components';
import { colors, borderRadius } from '@/theme';
import { getStarDisplay } from '@/utils/formatters';
import {
  lookupTandemPartner,
  getPreferredPartner,
  savePreferredPartner,
  clearPreferredPartner,
  updateDriverServices,
  deleteMyAccount,
  type PartnerLookupResult,
  type DeleteAccountBlocked,
} from '@/services/api/edgeFunctions';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import { purgeAllOfflineData } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

const KNOWN_PARTNER_KEY = 'mcc_known_partner';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [preferredNav, setPreferredNav] = useState<NavApp>('google_maps');
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // Delete-account two-step state. Step 1 = "are you sure"; step 2 = type CONFIRM.
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState<DeleteAccountBlocked | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePartialWarning, setDeletePartialWarning] = useState<string | null>(null);

  // Known Partner state
  const [partnerEmail, setPartnerEmail] = useState('');
  const [savedPartner, setSavedPartner] = useState<PartnerLookupResult | null>(null);
  const [partnerLookupError, setPartnerLookupError] = useState<string | null>(null);
  const [partnerLookupLoading, setPartnerLookupLoading] = useState(false);

  // Service capability toggles
  const [canDoRideshare, setCanDoRideshare] = useState(driver?.canDoRideshare ?? false);
  const [canDoDelivery, setCanDoDelivery] = useState(driver?.canDoDelivery ?? false);
  const [servicesSaving, setServicesSaving] = useState(false);

  useEffect(() => {
    if (driver) {
      setCanDoRideshare(driver.canDoRideshare ?? false);
      setCanDoDelivery(driver.canDoDelivery ?? false);
    }
  }, [driver?.id]);

  useEffect(() => {
    const saved = localStorage.getItem('mcc_preferred_nav') as NavApp | null;
    if (saved) setPreferredNav(saved);

    // Load preferred partner from server; fall back to localStorage cache if offline
    void getPreferredPartner().then((result) => {
      if (result.success && result.data) {
        setSavedPartner(result.data);
        localStorage.setItem(KNOWN_PARTNER_KEY, JSON.stringify(result.data));
      } else {
        const cached = localStorage.getItem(KNOWN_PARTNER_KEY);
        if (cached) {
          try { setSavedPartner(JSON.parse(cached) as PartnerLookupResult); } catch { /* ignore */ }
        }
      }
    });
  }, []);

  const handleNavChange = (app: NavApp) => {
    setPreferredNav(app);
    localStorage.setItem('mcc_preferred_nav', app);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const openDeleteFlow = () => {
    setDeleteBlocked(null);
    setDeleteError(null);
    setDeletePartialWarning(null);
    setDeleteTyped('');
    setDeleteStep(1);
  };

  const closeDeleteFlow = () => {
    if (deleting) return;
    setDeleteStep(0);
    setDeleteBlocked(null);
    setDeleteError(null);
    setDeletePartialWarning(null);
    setDeleteTyped('');
  };

  // After a 207 (anonymized OK but Supabase auth-user delete failed), the
  // driver row is already gone — retrying hits the no-driver branch, which
  // only attempts the auth-user delete. That's exactly the retry semantics
  // we want here.
  const retryAuthDelete = async () => {
    setDeletePartialWarning(null);
    setDeleting(true);
    const result = await deleteMyAccount();
    setDeleting(false);
    if (result.success) {
      if (result.data.warning) {
        setDeletePartialWarning(result.data.warning);
        return;
      }
      // Fully clean now — close the modal and bounce.
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      try { await signOut(); } catch { /* ignore */ }
      navigate('/', { replace: true });
      return;
    }
    setDeleteError('success' in result ? '' : (result as { error?: string }).error ?? 'Retry failed.');
  };

  const acceptPartialAndExit = async () => {
    // Driver chose to leave even though server-side auth-user deletion is
    // still hanging. Local session has already been torn down in
    // handleConfirmDelete; just bounce to welcome.
    setDeletePartialWarning(null);
    navigate('/', { replace: true });
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteMyAccount();
    setDeleting(false);

    if (result.success) {
      // Clear ALL on-device state before bouncing to welcome — a deleted
      // driver must leave no recoverable residue on the device:
      //  - TanStack Query cache (driver + payout queries)
      //  - SessionStorage (any transient flow state)
      //  - LocalStorage keys we own (preferred partner cache, nav prefs)
      //  - IndexedDB `mcc-driver` (offline active-ride snapshot,
      //    pending-actions queue, cached driver-state)
      //  - Supabase auth session (revokes locally cached tokens; the
      //    server already deleted the auth user, but signOut() also tears
      //    down the Zustand auth store via the AuthProvider listener)
      // Best-effort cleanup steps — each is wrapped because we MUST still
      // bounce the user to welcome even if one step fails, but we log
      // failures so residual on-device data risk is observable.
      try { queryClient.clear(); } catch (err) { logger.warn('account.delete.cleanup.query_clear_failed', err); }
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('mcc_'))
          .forEach((k) => localStorage.removeItem(k));
      } catch (err) { logger.warn('account.delete.cleanup.localstorage_failed', err); }
      try { sessionStorage.clear(); } catch (err) { logger.warn('account.delete.cleanup.sessionstorage_failed', err); }
      try { await purgeAllOfflineData(); } catch (err) { logger.warn('account.delete.cleanup.indexeddb_failed', err); }
      try { await supabase.auth.signOut(); } catch (err) { logger.warn('account.delete.cleanup.supabase_signout_failed', err); }
      try { await signOut(); } catch (err) { logger.warn('account.delete.cleanup.useauth_signout_failed', err); }
      // Partial-success (HTTP 207): the local row is anonymized but the
      // Supabase auth-user delete failed. Surface a dedicated retry UI
      // instead of silently navigating — the driver deserves an explicit
      // path to finish the deletion contract.
      if (result.data.warning) {
        setDeletePartialWarning(result.data.warning);
        return;
      }
      navigate('/', { replace: true });
      return;
    }

    if ('blocked' in result) {
      setDeleteBlocked(result.blocked);
      return;
    }
    setDeleteError(result.error ?? 'Could not delete account. Please try again.');
  };

  const [servicesError, setServicesError] = useState<string | null>(null);

  const handleServiceToggle = async (service: 'rideshare' | 'delivery', value: boolean) => {
    // Optimistically update the toggle
    if (service === 'rideshare') setCanDoRideshare(value);
    else setCanDoDelivery(value);
    setServicesSaving(true);
    setServicesError(null);

    const result = await updateDriverServices(
      service === 'rideshare' ? { canDoRideshare: value } : { canDoDelivery: value }
    );

    setServicesSaving(false);

    if (!result.success) {
      // Roll back the optimistic update
      if (service === 'rideshare') setCanDoRideshare(!value);
      else setCanDoDelivery(!value);
      setServicesError('Failed to save. Please try again.');
    }
  };

  const handlePartnerLookup = async () => {
    const trimmed = partnerEmail.trim();
    if (!trimmed) return;
    setPartnerLookupLoading(true);
    setPartnerLookupError(null);

    // Validate + persist to server in one call
    const result = await savePreferredPartner(trimmed);
    setPartnerLookupLoading(false);

    if (result.success && result.data) {
      setSavedPartner(result.data);
      localStorage.setItem(KNOWN_PARTNER_KEY, JSON.stringify(result.data));
      setPartnerEmail('');
      setPartnerLookupError(null);
    } else {
      // Friendly fall-through: look up for preview without saving if save fails
      const preview = await lookupTandemPartner(trimmed);
      if (preview.success && preview.data && !preview.data.eligible) {
        setPartnerLookupError(
          `Partner found but not eligible — status: ${preview.data.status}, verified: ${String(preview.data.verified)}`,
        );
      } else {
        setPartnerLookupError(result.error ?? 'Partner not found. Enter a valid email or My Car Concierge driver ID.');
      }
    }
  };

  const handleRemovePartner = async () => {
    setSavedPartner(null);
    localStorage.removeItem(KNOWN_PARTNER_KEY);
    await clearPreferredPartner();
  };

  if (!driver) return null;

  const navApps = getAvailableNavApps();

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Settings" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {/* Profile card */}
        <Card style={{ marginBottom: 16 }} padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: colors.surfaceDark, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700, color: colors.gold,
            }}>
              {driver.firstName[0]}{driver.lastName[0]}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy }}>
                {driver.firstName} {driver.lastName}
              </div>
              <div style={{ fontSize: 13, color: colors.textMuted }}>
                {driver.email}
              </div>
              <div style={{ fontSize: 13, color: colors.textMuted }}>
                {driver.phone}
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex', gap: 16, padding: '12px 0',
            borderTop: `1px solid ${colors.borderLight}`,
          }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors.navy }}>{driver.totalRidesCompleted}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Rides</div>
            </div>
            <div style={{ width: 1, background: colors.borderLight }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors.gold }}>{driver.averageRating.toFixed(1)}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{getStarDisplay(driver.averageRating)}</div>
            </div>
            <div style={{ width: 1, background: colors.borderLight }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors.success }}>{Math.round(driver.completionRate * 100)}%</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Completion</div>
            </div>
          </div>
        </Card>

        {/* Driver status */}
        <SectionLabel>Status</SectionLabel>
        <Card style={{ marginBottom: 16 }} padding={14}>
          <SettingRow
            label="Account Status"
            value={
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: driver.status === 'active' ? colors.success : colors.warning,
                background: driver.status === 'active' ? colors.successBg : colors.warningBg,
                padding: '3px 10px', borderRadius: borderRadius.full,
              }}>
                {driver.status.toUpperCase()}
              </span>
            }
          />
          <SettingRow
            label="Driver Type"
            value={driver.partnerId ? '🏢 Partner Driver' : '🚗 Independent'}
          />
          <SettingRow
            label="Member Vehicle Certified"
            value={driver.canDriveMemberVehicle ? '✅ Yes' : '❌ Not yet'}
          />
        </Card>

        {/* Services */}
        <SectionLabel>Services</SectionLabel>
        <Card style={{ marginBottom: 16 }} padding={14}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
            Enable additional service types to receive rideshare and delivery requests.
            {servicesSaving && <span style={{ color: colors.gold, marginLeft: 8 }}>Saving…</span>}
            {servicesError && <span style={{ color: '#c0392b', marginLeft: 8 }}>{servicesError}</span>}
          </div>

          {/* Rideshare toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderBottom: `1px solid ${colors.borderLight}`,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>🚗 Rideshare</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                Pick up and transport passengers in your vehicle — $1.50/mi
              </div>
            </div>
            <button
              onClick={() => void handleServiceToggle('rideshare', !canDoRideshare)}
              disabled={servicesSaving}
              style={{
                width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                background: canDoRideshare ? '#1A6FC4' : colors.borderLight,
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                opacity: servicesSaving ? 0.6 : 1,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, transition: 'left 0.2s',
                left: canDoRideshare ? 24 : 4,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          {/* Delivery toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>📦 Delivery</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                Pick up and deliver parcels and food orders — $2.00/mi
              </div>
            </div>
            <button
              onClick={() => void handleServiceToggle('delivery', !canDoDelivery)}
              disabled={servicesSaving}
              style={{
                width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                background: canDoDelivery ? '#D4680A' : colors.borderLight,
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                opacity: servicesSaving ? 0.6 : 1,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, transition: 'left 0.2s',
                left: canDoDelivery ? 24 : 4,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        </Card>

        {/* Navigation preference */}
        <SectionLabel>Navigation App</SectionLabel>
        <Card style={{ marginBottom: 16 }} padding={14}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
            Choose your preferred navigation app for ride directions
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {navApps.map(app => (
              <button
                key={app}
                onClick={() => handleNavChange(app)}
                style={{
                  flex: 1, padding: '12px 8px', borderRadius: borderRadius.md,
                  border: `2px solid ${preferredNav === app ? colors.gold : colors.border}`,
                  background: preferredNav === app ? colors.warningBg : colors.bgCard,
                  cursor: 'pointer', textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 4 }}>
                  {app === 'google_maps' ? '🗺️' : app === 'waze' ? '🔵' : '🍎'}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 600,
                  color: preferredNav === app ? colors.navy : colors.textMuted,
                }}>
                  {getNavAppName(app)}
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Stripe / Payments */}
        <SectionLabel>Payments</SectionLabel>
        <Card style={{ marginBottom: 16 }} padding={14}>
          <SettingRow
            label="Payment Account"
            value={driver.stripeAccountId ? '✅ Connected' : '⚠️ Not Set Up'}
          />
          {driver.stripeAccountId ? (
            <button
              onClick={() => navigate('/settings/payments')}
              style={{
                marginTop: 8, width: '100%', padding: '10px 0',
                background: colors.bgSecondary, border: 'none',
                borderRadius: borderRadius.sm, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: colors.navy,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              Manage Payout Account →
            </button>
          ) : (
            <>
              <div style={{
                marginTop: 8, padding: 12, background: colors.warningBg,
                borderRadius: borderRadius.sm, fontSize: 12, color: colors.warning,
                marginBottom: 10,
              }}>
                Connect your bank or debit card to receive ride earnings.
              </div>
              <button
                onClick={() => navigate('/settings/payments')}
                style={{
                  width: '100%', padding: '12px 0',
                  background: colors.surfaceDark, border: 'none',
                  borderRadius: borderRadius.sm, cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, color: colors.gold,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                🏦 Set Up Payouts
              </button>
            </>
          )}
        </Card>

        {/* Known Tandem Partner */}
        <SectionLabel>Known Tandem Partner</SectionLabel>
        <Card style={{ marginBottom: 16 }} padding={14}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
            Save a preferred co-driver for tandem jobs. They must be a My Car Concierge–verified ride-along driver.
          </div>

          {savedPartner ? (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: borderRadius.md,
                background: colors.bgSecondary, marginBottom: 10,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: colors.surfaceDark, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: colors.gold,
                  flexShrink: 0,
                }}>
                  {savedPartner.firstName[0]}{savedPartner.lastName[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>
                    {savedPartner.firstName} {savedPartner.lastName}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {savedPartner.email}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {savedPartner.verified && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: colors.navy,
                        background: colors.gold, padding: '1px 6px',
                        borderRadius: borderRadius.full,
                      }}>
                        VERIFIED
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: colors.textMuted }}>
                      ★ {savedPartner.rating.toFixed(1)} · {savedPartner.totalJobs} jobs
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => void handleRemovePartner()}
                style={{
                  width: '100%', padding: '8px 0',
                  background: 'none', border: `1px solid ${colors.borderLight}`,
                  borderRadius: borderRadius.sm, cursor: 'pointer',
                  fontSize: 13, color: colors.error,
                }}
              >
                Remove Partner
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  placeholder="Email or My Car Concierge driver ID"
                  value={partnerEmail}
                  onChange={(e) => setPartnerEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handlePartnerLookup(); }}
                  style={{
                    flex: 1, padding: '10px 12px',
                    borderRadius: borderRadius.sm,
                    border: `1px solid ${colors.border}`,
                    fontSize: 14, background: colors.bgCard,
                    color: colors.textPrimary, outline: 'none',
                  }}
                />
                <button
                  onClick={() => void handlePartnerLookup()}
                  disabled={partnerLookupLoading || !partnerEmail.trim()}
                  style={{
                    padding: '10px 16px',
                    background: colors.surfaceDark, border: 'none',
                    borderRadius: borderRadius.sm, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: colors.gold,
                    opacity: partnerLookupLoading || !partnerEmail.trim() ? 0.5 : 1,
                  }}
                >
                  {partnerLookupLoading ? '...' : 'Find'}
                </button>
              </div>
              {partnerLookupError && (
                <div style={{
                  marginTop: 8, padding: '8px 12px',
                  background: colors.errorBg ?? 'rgba(220,53,69,0.08)',
                  borderRadius: borderRadius.sm,
                  fontSize: 12, color: colors.error,
                }}>
                  {partnerLookupError}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Legal / About */}
        <SectionLabel>About</SectionLabel>
        <Card style={{ marginBottom: 24 }} padding={14}>
          <SettingRow label="App Version" value="1.0.0 (Phase 1)" />
          <SettingRow label="Driver ID" value={driver.id.substring(0, 8) + '...'} />
        </Card>

        {/* Sign out */}
        <Button
          onClick={() => setShowSignOutConfirm(true)}
          variant="secondary"
          fullWidth
          style={{ color: colors.error, borderColor: colors.error }}
        >
          Sign Out
        </Button>

        {/* Delete account (App Store Guideline 5.1.1(v)) */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={openDeleteFlow}
            style={{
              width: '100%', padding: '12px 0',
              background: 'transparent',
              border: `1px solid ${colors.error}`,
              borderRadius: borderRadius.md,
              cursor: 'pointer',
              fontSize: 14, fontWeight: 600, color: colors.error,
            }}
          >
            Delete Account
          </button>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, textAlign: 'center' }}>
            Permanently removes your profile. Ride history is kept for accounting.
          </div>
        </div>

        <div style={{ height: 40 }} /> {/* Bottom spacing */}
      </div>

      {/* Delete account — two-step confirmation */}
      {deleteStep > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: colors.bgOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <Card style={{ maxWidth: 360, width: '100%' }} padding={24}>
            {deletePartialWarning ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 600, color: colors.warning, marginBottom: 8 }}>
                  Almost done — one more step
                </div>
                <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
                  {deletePartialWarning}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button
                    onClick={() => void acceptPartialAndExit()}
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={deleting}
                  >
                    Leave anyway
                  </Button>
                  <Button
                    onClick={() => void retryAuthDelete()}
                    variant="danger"
                    style={{ flex: 1 }}
                    disabled={deleting}
                  >
                    {deleting ? 'Retrying…' : 'Retry'}
                  </Button>
                </div>
              </>
            ) : deleteBlocked ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
                  {deleteBlocked.reason === 'active_ride'
                    ? 'Finish your current ride first'
                    : deleteBlocked.reason === 'pending_payout'
                      ? 'Pending payout in progress'
                      : 'Cash out your earnings first'}
                </div>
                <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
                  {deleteBlocked.message}
                  {deleteBlocked.reason === 'pending_payout' &&
                    deleteBlocked.pendingPayoutAmount !== undefined && (
                      <div style={{ marginTop: 8, color: colors.warning, fontWeight: 600 }}>
                        Pending amount: ${deleteBlocked.pendingPayoutAmount.toFixed(2)}
                      </div>
                    )}
                  {deleteBlocked.reason === 'unpaid_balance' &&
                    deleteBlocked.unpaidBalance !== undefined && (
                      <div style={{ marginTop: 8, color: colors.warning, fontWeight: 600 }}>
                        Unpaid balance: ${deleteBlocked.unpaidBalance.toFixed(2)}
                        {deleteBlocked.unpaidRideCount !== undefined &&
                          ` from ${deleteBlocked.unpaidRideCount} completed ride${deleteBlocked.unpaidRideCount === 1 ? '' : 's'}`}
                      </div>
                    )}
                </div>
                <Button onClick={closeDeleteFlow} variant="secondary" fullWidth>
                  OK
                </Button>
              </>
            ) : deleteStep === 1 ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
                  Delete your account?
                </div>
                <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>
                  This permanently removes your profile from My Car Concierge.
                </div>
                <ul style={{ fontSize: 13, color: colors.textPrimary, paddingLeft: 18, margin: '0 0 16px' }}>
                  <li style={{ marginBottom: 6 }}>You'll stop receiving ride requests immediately.</li>
                  <li style={{ marginBottom: 6 }}>If you have an active ride or unpaid earnings, you'll be asked to finish those first.</li>
                  <li style={{ marginBottom: 6 }}>Your name, contact info, and documents are erased.</li>
                  <li>To drive again you'll have to reapply from scratch.</li>
                </ul>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button onClick={closeDeleteFlow} variant="secondary" style={{ flex: 1 }}>
                    Cancel
                  </Button>
                  <Button onClick={() => setDeleteStep(2)} variant="danger" style={{ flex: 1 }}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 600, color: colors.error, marginBottom: 8 }}>
                  Type DELETE to confirm
                </div>
                <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
                  This cannot be undone. Type <b>DELETE</b> below to permanently
                  remove your account.
                </div>
                <input
                  type="text"
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  placeholder="DELETE"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  disabled={deleting}
                  style={{
                    width: '100%', padding: '10px 12px',
                    borderRadius: borderRadius.sm,
                    border: `1px solid ${colors.border}`,
                    fontSize: 14, background: colors.bgCard,
                    color: colors.textPrimary, outline: 'none',
                    marginBottom: 12,
                  }}
                />
                {deleteError && (
                  <div style={{
                    padding: '8px 12px',
                    background: colors.errorBg ?? 'rgba(220,53,69,0.08)',
                    borderRadius: borderRadius.sm,
                    fontSize: 12, color: colors.error,
                    marginBottom: 12,
                  }}>
                    {deleteError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button
                    onClick={closeDeleteFlow}
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleConfirmDelete()}
                    variant="danger"
                    style={{ flex: 1 }}
                    disabled={deleting || deleteTyped.trim().toUpperCase() !== 'DELETE'}
                  >
                    {deleting ? 'Deleting…' : 'Delete Account'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Sign out confirmation */}
      {showSignOutConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: colors.bgOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <Card style={{ maxWidth: 320, width: '100%' }} padding={24}>
            <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
              Sign out?
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              You'll stop receiving ride requests and will need to sign in again.
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button onClick={() => setShowSignOutConfirm(false)} variant="secondary" style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button onClick={handleSignOut} variant="danger" style={{ flex: 1 }}>
                Sign Out
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helper components
// ============================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0',
      borderBottom: `1px solid ${colors.borderLight}`,
    }}>
      <span style={{ fontSize: 14, color: colors.textPrimary }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: colors.textSecondary }}>{value}</span>
    </div>
  );
}
