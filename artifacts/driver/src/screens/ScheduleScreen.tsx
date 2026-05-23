// ============================================================
// MCC Driver — Schedule Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { formatCurrency, formatDistance, getScenarioLabel, formatDate, formatTime } from '@/utils/formatters';

interface ScheduledRide {
  id: string;
  scheduled_at: string;
  status: 'pending' | 'accepted';
  rides: {
    id: string;
    scenario: string;
    tier: string;
    pickup_address: string;
    dropoff_address: string;
    estimated_fare: number;
    estimated_distance_miles: number;
    service_type: string | null;
  } | null;
}

export function ScheduleScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [schedule, setSchedule] = useState<ScheduledRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);

  const fetchSchedule = async () => {
    if (!driver) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl('/schedule'), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const j = await res.json() as { schedule: ScheduledRide[] };
        setSchedule(j.schedule);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchSchedule(); }, [driver?.id]);

  const handleAccept = async (scheduleId: string) => {
    setAccepting(scheduleId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl('/schedule/accept'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ scheduleId }),
      });
      if (res.ok) {
        setSchedule((prev) =>
          prev.map((s) => s.id === scheduleId ? { ...s, status: 'accepted' } : s),
        );
      }
    } finally {
      setAccepting(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Schedule" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
        ) : schedule.length === 0 ? (
          <Card padding={32}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No upcoming rides</div>
              <div style={{ fontSize: 13 }}>Advance bookings assigned to you will appear here.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {schedule.map((s) => {
              if (!s.rides) return null;
              const ride = s.rides;
              const isAccepted = s.status === 'accepted';
              return (
                <Card key={s.id} padding={16}>
                  {/* Date/time header */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${colors.border}`,
                  }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>
                        {formatDate(s.scheduled_at)}
                      </div>
                      <div style={{ fontSize: 13, color: colors.textMuted }}>
                        at {formatTime(s.scheduled_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: isAccepted ? colors.success : colors.warning,
                      background: isAccepted ? colors.successBg : colors.warningBg,
                      padding: '3px 10px', borderRadius: borderRadius.full,
                      textTransform: 'uppercase',
                    }}>
                      {isAccepted ? '✓ Accepted' : 'Pending'}
                    </span>
                  </div>

                  {/* Ride details */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
                      {getScenarioLabel(ride.scenario)}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>
                      📍 {ride.pickup_address.split(',').slice(0, 2).join(',')}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textMuted }}>
                      🏁 {ride.dropoff_address.split(',').slice(0, 2).join(',')}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
                    <span>💰 {formatCurrency(ride.estimated_fare)}</span>
                    <span>📏 {formatDistance(ride.estimated_distance_miles)}</span>
                  </div>

                  {!isAccepted && (
                    <Button
                      onClick={() => void handleAccept(s.id)}
                      loading={accepting === s.id}
                      variant="primary"
                      fullWidth
                      size="md"
                    >
                      Accept This Booking
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
