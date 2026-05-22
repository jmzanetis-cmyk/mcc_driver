import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatDateTime } from '@/utils/formatters';

const TYPE_META: Record<string, { icon: string; color: string }> = {
  payout_success:  { icon: '💸', color: colors.success },
  tip_received:    { icon: '💝', color: colors.gold },
  rating_received: { icon: '⭐', color: colors.gold },
  ride_request:    { icon: '🚗', color: colors.navy },
  system:          { icon: '📢', color: colors.textMuted },
};

export function NotificationsScreen() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markRead, markAllRead, fetchNotifications } = useNotifications();

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader
        title="Notifications"
        onBack={() => navigate('/home')}
        rightAction={
          unreadCount > 0 ? (
            <button
              onClick={() => void markAllRead()}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: colors.gold,
                padding: '4px 8px', fontFamily: 'inherit',
              }}
            >
              Mark all read
            </button>
          ) : undefined
        }
      />

      <div style={{ padding: 20 }}>
        {loading && notifications.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spinner color={colors.textMuted} />
          </div>
        ) : notifications.length === 0 ? (
          <Card padding={32}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No notifications yet</div>
              <div style={{ fontSize: 13 }}>Payouts, tips, and ride updates will appear here.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notifications.map((notif) => {
              const meta = TYPE_META[notif.type] ?? TYPE_META.system!;
              return (
                <button
                  key={notif.id}
                  onClick={() => { if (!notif.read) void markRead(notif.id); }}
                  style={{
                    width: '100%', textAlign: 'left',
                    border: `1px solid ${notif.read ? colors.borderLight : colors.gold}`,
                    borderRadius: borderRadius.md,
                    background: notif.read ? colors.bgCard : 'rgba(201,152,46,0.06)',
                    padding: 14, cursor: notif.read ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}
                >
                  {/* Icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                    background: `${meta.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                  }}>
                    {meta.icon}
                  </div>

                  {/* Body */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: notif.read ? 500 : 700, color: colors.navy }}>
                        {notif.title}
                      </div>
                      {!notif.read && (
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: colors.gold, flexShrink: 0, marginTop: 4,
                        }} />
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 3, lineHeight: 1.4 }}>
                      {notif.body}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                      {formatDateTime(notif.createdAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && (
          <Button
            onClick={() => void fetchNotifications()}
            variant="ghost"
            fullWidth
            size="sm"
            style={{ marginTop: 16, color: colors.textMuted }}
          >
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
