// ============================================================
// MCC Driver — Realtime Manager
// ============================================================
// Centralizes Supabase Realtime channel lifecycle.
// Prevents duplicate subscriptions and handles cleanup.
// ============================================================

import { supabase } from '@/services/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

class RealtimeManager {
  private subscriptions = new Map<string, RealtimeChannel>();

  subscribe(key: string, channel: RealtimeChannel): RealtimeChannel {
    this.unsubscribe(key);
    this.subscriptions.set(key, channel);
    return channel;
  }

  unsubscribe(key: string): void {
    const existing = this.subscriptions.get(key);
    if (existing) {
      supabase.removeChannel(existing);
      this.subscriptions.delete(key);
    }
  }

  has(key: string): boolean {
    return this.subscriptions.has(key);
  }

  cleanup(): void {
    this.subscriptions.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.subscriptions.clear();
  }
}

export const realtimeManager = new RealtimeManager();
