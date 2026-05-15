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

export function SettingsScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const [preferredNav, setPreferredNav] = useState<NavApp>('google_maps');
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mcc_preferred_nav') as NavApp | null;
    if (saved) setPreferredNav(saved);
  }, []);

  const handleNavChange = (app: NavApp) => {
    setPreferredNav(app);
    localStorage.setItem('mcc_preferred_nav', app);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
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
              background: colors.navy, display: 'flex',
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
                  background: colors.navy, border: 'none',
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

        <div style={{ height: 40 }} /> {/* Bottom spacing */}
      </div>

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
