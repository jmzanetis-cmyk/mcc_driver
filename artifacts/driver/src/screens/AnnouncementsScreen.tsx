// ============================================================
// MCC Driver — Announcements Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { formatDate, formatTime } from '@/utils/formatters';

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: string;
  published_at: string;
  read: boolean;
}

const TYPE_META: Record<string, { icon: string; color: string; bg: string }> = {
  news:        { icon: '📢', color: colors.navy,    bg: 'rgba(27,42,74,0.08)' },
  tip:         { icon: '💡', color: colors.gold,    bg: 'rgba(201,168,76,0.08)' },
  event:       { icon: '📅', color: colors.info,    bg: 'rgba(59,130,246,0.08)' },
  recognition: { icon: '🏆', color: colors.success, bg: 'rgba(34,197,94,0.08)' },
};

export function AnnouncementsScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAndMarkRead = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch(apiUrl('/announcements'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json() as { announcements: Announcement[] };
      setItems(json.announcements);

      // Mark all unread as read
      const unread = json.announcements.filter((a) => !a.read);
      await Promise.all(unread.map((a) =>
        fetch(apiUrl(`/announcements/${a.id}/read`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {}),
      ));
      // Flip local state
      if (unread.length > 0) {
        setItems((prev) => prev.map((a) => ({ ...a, read: true })));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAndMarkRead(); }, [fetchAndMarkRead]);

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="What's New" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Card padding={32}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Nothing yet</div>
              <div style={{ fontSize: 13 }}>Platform updates and news will appear here.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item) => {
              const meta = TYPE_META[item.type] ?? TYPE_META.news!;
              return (
                <Card
                  key={item.id}
                  padding={16}
                  style={{
                    border: `1px solid ${item.read ? colors.border : meta.color}`,
                    background: item.read ? colors.bgCard : meta.bg,
                    position: 'relative',
                  }}
                >
                  {!item.read && (
                    <div style={{
                      position: 'absolute', top: 14, right: 14,
                      width: 8, height: 8, borderRadius: '50%',
                      background: meta.color,
                    }} />
                  )}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700, color: colors.navy,
                        marginBottom: 4,
                      }}>
                        {item.title}
                      </div>
                      <div style={{
                        fontSize: 13, color: colors.textSecondary,
                        lineHeight: 1.55, marginBottom: 10,
                      }}>
                        {item.body}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {formatDate(item.published_at)} at {formatTime(item.published_at)}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
